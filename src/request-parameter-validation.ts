import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, Script } from 'node:vm';
import { boundedMessage, LlmFailure } from './errors.js';
import type { InlineJsonSchema, JsonObject } from './types.js';

const METADATA = 'x-llm-req-parameter';
const VALIDATION_KEYS = new Set(['function', 'message']);

/** Maximum synchronous run time of one validation function call. */
export const PARAMETER_VALIDATION_TIMEOUT_MS = 1000;

/** Maximum number of bytes `context.fs.readText` returns. */
export const PARAMETER_VALIDATION_READ_LIMIT_BYTES = 1024 * 1024;

/** Read-only filesystem helpers exposed to validation functions. Relative paths resolve from `workingDirectory`. */
export interface ParameterValidationFileSystem {
  resolve(path: string): string;
  exists(path: string): boolean;
  isFile(path: string): boolean;
  isDirectory(path: string): boolean;
  readText(path: string): string;
}

/** The second argument of an `x-llm-req-parameter.validation.function`. Every member is frozen. */
export interface ParameterValidationContext {
  /** Concrete parameter path such as `sections[0].title`; the empty string for the schema root. */
  readonly path: string;
  readonly value: unknown;
  /** Deep-frozen copy of the complete resolved parameter object. */
  readonly parameters: JsonObject;
  /** Deep-frozen copy of the schema node that declares the validator. */
  readonly schema: JsonObject;
  readonly request: { readonly name: string; readonly directory: string };
  readonly workingDirectory: string;
  readonly fs: ParameterValidationFileSystem;
}

export interface ParameterValidationRequest {
  readonly name: string;
  readonly directory: string;
  readonly workingDirectory?: string;
}

/** One validation path segment: a property name, or `[]` for every array element. */
type ValidatorSegment = string | typeof ARRAY_ITEMS;
const ARRAY_ITEMS = Symbol('array-items');

interface ParameterValidator {
  readonly location: string;
  readonly segments: readonly ValidatorSegment[];
  readonly node: Record<string, unknown>;
  readonly message?: string;
  readonly script: Script;
}

function metadataFailure(location: string, message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', boundedMessage(`Custom validation metadata at '${location}' is invalid. ${message}`));
}

function validationFailure(path: string, message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', boundedMessage(`Request parameters are invalid. Validation of '${path || '<root>'}' failed: ${message}`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function displayLocation(segments: readonly ValidatorSegment[]): string {
  let location = '';
  for (const segment of segments) {
    location += segment === ARRAY_ITEMS ? '[]' : location ? `.${segment}` : segment;
  }
  return location || '<root>';
}

function isolatedContext(globals: Record<string, unknown>) {
  return createContext(globals, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
}

function functionSource(value: unknown, location: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (Array.isArray(value) && value.length > 0 && value.every((line) => typeof line === 'string')) return value.join('\n');
  throw metadataFailure(location, 'validation.function must be a non-empty string or an array of strings.');
}

function compileValidator(source: string, location: string): Script {
  let definition: Script;
  let invocation: Script;
  try {
    definition = new Script(`'use strict'; typeof (${source}\n);`, { filename: `validation.function at ${location}` });
    invocation = new Script(`'use strict'; (${source}\n)(__llmValue, __llmContext);`, { filename: `validation.function at ${location}` });
  } catch (error) {
    throw metadataFailure(location, `validation.function is not valid JavaScript: ${error instanceof Error ? error.message : 'syntax error'}.`);
  }
  let kind: unknown;
  try {
    kind = definition.runInContext(isolatedContext({}), { timeout: PARAMETER_VALIDATION_TIMEOUT_MS });
  } catch (error) {
    throw metadataFailure(location, `validation.function could not be evaluated: ${error instanceof Error ? error.message : 'evaluation error'}.`);
  }
  if (kind !== 'function') throw metadataFailure(location, 'validation.function must be a JavaScript function expression.');
  return invocation;
}

function parseValidation(node: Record<string, unknown>, segments: readonly ValidatorSegment[], allowed: boolean): ParameterValidator | undefined {
  const extension = node[METADATA];
  if (!isRecord(extension) || !Object.prototype.hasOwnProperty.call(extension, 'validation')) return undefined;
  const location = displayLocation(segments);
  if (!allowed) throw metadataFailure(location, 'validation is supported only on the schema root, properties, and array items.');
  const validation = extension.validation;
  if (!isRecord(validation)) throw metadataFailure(location, 'validation must be an object.');
  for (const key of Object.keys(validation)) {
    if (!VALIDATION_KEYS.has(key)) throw metadataFailure(location, `validation contains unsupported member '${key}'.`);
  }
  if (validation.message !== undefined && (typeof validation.message !== 'string' || validation.message.length === 0)) {
    throw metadataFailure(location, 'validation.message must be a non-empty string.');
  }
  return {
    location,
    segments,
    node,
    ...(validation.message === undefined ? {} : { message: validation.message }),
    script: compileValidator(functionSource(validation.function, location), location),
  };
}

/** Keywords whose value is one subschema or an array of subschemas. */
const UNSUPPORTED_SUBSCHEMA_KEYWORDS = ['additionalProperties', 'prefixItems', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else'] as const;
/** Keywords whose value maps names to subschemas. */
const UNSUPPORTED_SUBSCHEMA_MAP_KEYWORDS = ['patternProperties', 'dependentSchemas', '$defs', 'definitions'] as const;

function unsupportedPositionChildren(node: Record<string, unknown>): readonly unknown[] {
  const children: unknown[] = [];
  for (const keyword of UNSUPPORTED_SUBSCHEMA_KEYWORDS) {
    const value = node[keyword];
    if (Array.isArray(value)) children.push(...value);
    else if (isRecord(value)) children.push(value);
  }
  for (const keyword of UNSUPPORTED_SUBSCHEMA_MAP_KEYWORDS) {
    const value = node[keyword];
    if (isRecord(value)) children.push(...Object.values(value));
  }
  return children;
}

function walk(node: Record<string, unknown>, segments: readonly ValidatorSegment[], allowed: boolean, validators: ParameterValidator[]): void {
  const validator = parseValidation(node, segments, allowed);
  if (validator !== undefined) validators.push(validator);
  if (isRecord(node.properties)) {
    for (const [property, child] of Object.entries(node.properties)) {
      if (isRecord(child)) walk(child, [...segments, property], allowed, validators);
    }
  }
  if (isRecord(node.items)) walk(node.items, [...segments, ARRAY_ITEMS], allowed, validators);
  for (const child of unsupportedPositionChildren(node)) {
    if (isRecord(child)) walk(child, segments, false, validators);
  }
}

/**
 * Discover and compile every `x-llm-req-parameter.validation` declaration in
 * schema declaration order. Malformed metadata fails closed before any value is
 * validated.
 */
export function discoverParameterValidators(schema: InlineJsonSchema | undefined): readonly ParameterValidator[] {
  if (schema === undefined) return [];
  const validators: ParameterValidator[] = [];
  walk(schema as Record<string, unknown>, [], true, validators);
  return validators;
}

interface ValidationInstance {
  readonly path: string;
  readonly value: unknown;
}

function instances(parameters: JsonObject, segments: readonly ValidatorSegment[]): readonly ValidationInstance[] {
  let current: ValidationInstance[] = [{ path: '', value: parameters }];
  for (const segment of segments) {
    const next: ValidationInstance[] = [];
    for (const instance of current) {
      if (segment === ARRAY_ITEMS) {
        if (!Array.isArray(instance.value)) continue;
        instance.value.forEach((value, index) => next.push({ path: `${instance.path}[${index}]`, value }));
      } else if (isRecord(instance.value) && Object.prototype.hasOwnProperty.call(instance.value, segment)) {
        next.push({ path: instance.path ? `${instance.path}.${segment}` : segment, value: instance.value[segment] });
      }
    }
    current = next;
  }
  return current;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function frozenCopy<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function fileSystem(workingDirectory: string): ParameterValidationFileSystem {
  const resolvePath = (path: string): string => {
    if (typeof path !== 'string' || path.length === 0) throw new TypeError('A path must be a non-empty string.');
    return resolve(workingDirectory, path);
  };
  const kind = (path: string) => {
    try {
      return statSync(resolvePath(path));
    } catch {
      return undefined;
    }
  };
  return Object.freeze({
    resolve: resolvePath,
    exists: (path: string) => existsSync(resolvePath(path)),
    isFile: (path: string) => kind(path)?.isFile() === true,
    isDirectory: (path: string) => kind(path)?.isDirectory() === true,
    readText: (path: string) => {
      const absolute = resolvePath(path);
      const stats = statSync(absolute);
      if (!stats.isFile()) throw new Error(`Not a regular file: ${path}`);
      if (stats.size > PARAMETER_VALIDATION_READ_LIMIT_BYTES) throw new Error(`File exceeds the ${PARAMETER_VALIDATION_READ_LIMIT_BYTES}-byte read limit: ${path}`);
      return readFileSync(absolute, 'utf8');
    },
  });
}

function isThenable(value: unknown): boolean {
  return (typeof value === 'object' || typeof value === 'function') && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function thrownMessage(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    const message = (error as { message: string }).message;
    if (/Script execution timed out/u.test(message)) return `the validation function exceeded the ${PARAMETER_VALIDATION_TIMEOUT_MS} ms timeout.`;
    return message || 'the validation function threw an error.';
  }
  return typeof error === 'string' && error ? error : 'the validation function threw an error.';
}

/**
 * Run every declared validation function against the resolved parameters in
 * schema declaration order. Values absent from `parameters` are skipped. The
 * first failure throws a bounded `CONFIGURATION_INVALID` error.
 *
 * Each call runs synchronously in a fresh `node:vm` context without Node
 * globals or string code generation. This limits accidental access; it is not
 * a security boundary, so request bundles must be trusted.
 */
export function runParameterValidators(schema: InlineJsonSchema | undefined, parameters: JsonObject, request: ParameterValidationRequest): void {
  const validators = discoverParameterValidators(schema);
  if (validators.length === 0) return;
  const workingDirectory = resolve(request.workingDirectory ?? process.cwd());
  const frozenParameters = frozenCopy(parameters);
  const fs = fileSystem(workingDirectory);
  const requestIdentity = Object.freeze({ name: request.name, directory: request.directory });
  for (const validator of validators) {
    const schemaNode = frozenCopy(validator.node) as JsonObject;
    for (const instance of instances(frozenParameters, validator.segments)) {
      const context: ParameterValidationContext = Object.freeze({
        path: instance.path,
        value: instance.value,
        parameters: frozenParameters,
        schema: schemaNode,
        request: requestIdentity,
        workingDirectory,
        fs,
      });
      let result: unknown;
      try {
        result = validator.script.runInContext(isolatedContext({ __llmValue: instance.value, __llmContext: context }), { timeout: PARAMETER_VALIDATION_TIMEOUT_MS });
      } catch (error) {
        throw validationFailure(instance.path, thrownMessage(error));
      }
      if (result === true || result === undefined) continue;
      if (result === false) throw validationFailure(instance.path, validator.message ?? 'the value was rejected by its validation function.');
      if (typeof result === 'string' && result.length > 0) throw validationFailure(instance.path, result);
      throw metadataFailure(validator.location, isThenable(result)
        ? 'validation.function must return synchronously; asynchronous validators are not supported.'
        : 'validation.function must return true, false, undefined, or a non-empty failure message.');
    }
  }
}
