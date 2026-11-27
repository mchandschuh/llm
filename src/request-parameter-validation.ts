import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { promiseHooks } from 'node:v8';
import { createContext, Script, type Context } from 'node:vm';
import { boundedMessage, LlmFailure } from './errors.js';
import type { InlineJsonSchema, JsonObject } from './types.js';

const METADATA = 'x-llm-req-parameter';
const VALIDATION_KEYS = new Set(['function', 'message', 'remediation']);
const RESULT_KEYS = new Set(['valid', 'errors']);
const RESULT_ERROR_KEYS = new Set(['message', 'path', 'remediation']);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

/** Maximum synchronous run time of one validation function call. */
export const PARAMETER_VALIDATION_TIMEOUT_MS = 1000;

/** Maximum number of bytes `context.fs.readText` returns. */
export const PARAMETER_VALIDATION_READ_LIMIT_BYTES = 1024 * 1024;

/** Maximum number of errors one validation result object may report. */
export const PARAMETER_VALIDATION_MAX_ERRORS = 20;

/** Maximum length of a reported message, remediation, or path; longer text is truncated. */
export const PARAMETER_VALIDATION_MAX_TEXT_LENGTH = 500;

/** One error entry of a validation result object returned by a validation function. */
export interface ParameterValidationResultError {
  /** What is wrong with the parameter. */
  readonly message: string;
  /** Parameter path the error refers to; defaults to the validator's `context.path`. */
  readonly path?: string;
  /** How a user or agent can fix the parameter. */
  readonly remediation?: string;
}

/** The well-defined object a validation function may return instead of a boolean or string. */
export type ParameterValidationResult =
  | { readonly valid: true; readonly errors?: readonly [] }
  | { readonly valid: false; readonly errors: readonly ParameterValidationResultError[] };

/** One normalized parameter problem carried by {@link ParameterValidationFailure}. */
export interface ParameterValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly remediation?: string;
}

/**
 * Raised when a validation function rejects the resolved parameters. `issues`
 * lists what is wrong and, when the validator supplied it, how to fix it.
 */
export class ParameterValidationFailure extends LlmFailure {
  readonly issues: readonly ParameterValidationIssue[];

  constructor(issues: readonly ParameterValidationIssue[]) {
    if (issues.length === 0) throw new TypeError('ParameterValidationFailure requires at least one issue.');
    const normalized = issues.map((entry) => Object.freeze(issue(entry.path, entry.message, entry.remediation)));
    const more = normalized.length > 1 ? ` (${normalized.length - 1} more issue${normalized.length > 2 ? 's' : ''})` : '';
    // Truncate the first issue, not the count, so the summary always says how many issues follow.
    super('CONFIGURATION_INVALID', 'configuration', `${parameterIssueMessage(normalized[0]!).slice(0, SUMMARY_LENGTH - more.length)}${more}`);
    this.name = 'ParameterValidationFailure';
    this.issues = Object.freeze(normalized);
  }
}

const SUMMARY_LENGTH = 500;

/**
 * The user-facing message for one issue, as used in llm req error output. Issue
 * fields are already sanitized, so the full bounded message is kept.
 */
export function parameterIssueMessage(issue: ParameterValidationIssue): string {
  return `Request parameters are invalid. Validation of '${issue.path || '<root>'}' failed: ${issue.message}`;
}

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

/** One validation path segment: a property name, or every array element. */
const ARRAY_ITEMS = Symbol('array-items');
type ValidatorSegment = string | typeof ARRAY_ITEMS;

interface ParameterValidator {
  readonly location: string;
  readonly segments: readonly ValidatorSegment[];
  readonly node: Record<string, unknown>;
  readonly message?: string;
  readonly remediation?: string;
  readonly script: Script;
}

function metadataFailure(location: string, message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', boundedMessage(`Custom validation metadata at '${location}' is invalid. ${message}`));
}

/** True when text still has visible characters after control characters are removed. */
function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.replace(/[\u0000-\u001f\u007f]/gu, '').trim().length > 0;
}

/** Sanitize and redact through boundedMessage, then apply the per-field length bound. */
function boundedText(text: string): string {
  return boundedMessage(text).slice(0, PARAMETER_VALIDATION_MAX_TEXT_LENGTH);
}

/** The root path is `''`; any other path is sanitized and redacted like other issue text. */
function boundedPath(path: string): string {
  return hasText(path) ? boundedText(path) : '';
}

function issue(path: string, message: string, remediation?: string): ParameterValidationIssue {
  return {
    path: boundedPath(path),
    message: boundedText(message),
    ...(remediation === undefined ? {} : { remediation: boundedText(remediation) }),
  };
}

function validationFailure(path: string, message: string, remediation?: string): ParameterValidationFailure {
  return new ParameterValidationFailure([issue(path, message, remediation)]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Append a property name using the parameter path grammar; names that are not identifiers use `["name"]`. */
function appendProperty(path: string, property: string): string {
  if (!IDENTIFIER.test(property)) return `${path}[${JSON.stringify(property)}]`;
  return path ? `${path}.${property}` : property;
}

function displayLocation(segments: readonly ValidatorSegment[]): string {
  let location = '';
  for (const segment of segments) location = segment === ARRAY_ITEMS ? `${location}[]` : appendProperty(location, segment);
  return location || '<root>';
}

function isolatedContext(globals: Record<string, unknown>): Context {
  return createContext(globals, { codeGeneration: { strings: false, wasm: false }, microtaskMode: 'afterEvaluate' });
}

/** The vm timeout error is created in the context realm, so match its own `code` data property. */
function isTimeout(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ERR_SCRIPT_EXECUTION_TIMEOUT';
}

/**
 * Read a thrown value's message without running validator code on the host:
 * only own data properties are read, so getters never execute outside the
 * vm timeout. Errors from the vm realm fail `instanceof Error`, so this does
 * not depend on it.
 */
function thrownMessage(error: unknown, fallback: string): string {
  if (isTimeout(error)) return `the validation function exceeded the ${PARAMETER_VALIDATION_TIMEOUT_MS} ms timeout.`;
  if (typeof error === 'string') return error || fallback;
  if ((typeof error === 'object' || typeof error === 'function') && error !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'message');
    if (descriptor !== undefined && typeof descriptor.value === 'string' && descriptor.value.length > 0) return descriptor.value;
  }
  return fallback;
}

function functionSource(value: unknown, location: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (Array.isArray(value) && value.length > 0 && value.every((line) => typeof line === 'string')) return value.join('\n');
  throw metadataFailure(location, 'validation.function must be a non-empty string or an array of strings.');
}

function compileValidator(source: string, location: string): Script {
  const filename = `validation.function at ${location}`;
  let definition: Script;
  let invocation: Script;
  try {
    // The array literal makes a stray `)` or `;` in the source a syntax error.
    definition = new Script(`'use strict'; [(${source}\n)];`, { filename });
    invocation = new Script(`'use strict'; (${source}\n)(__llmValue, __llmContext);`, { filename });
  } catch (error) {
    throw metadataFailure(location, `validation.function is not valid JavaScript: ${thrownMessage(error, 'syntax error')}.`);
  }
  let evaluated: unknown;
  try {
    evaluated = runHandlingPromises(definition, isolatedContext({}), () => undefined);
  } catch (error) {
    throw metadataFailure(location, `validation.function could not be evaluated: ${thrownMessage(error, 'evaluation error')}`);
  }
  const candidate = Array.isArray(evaluated) || (typeof evaluated === 'object' && evaluated !== null)
    ? Object.getOwnPropertyDescriptor(evaluated, '0')?.value
    : undefined;
  if (typeof candidate !== 'function') throw metadataFailure(location, 'validation.function must be a JavaScript function expression.');
  if (/^class\b/u.test(Function.prototype.toString.call(candidate))) {
    throw metadataFailure(location, 'validation.function must be a callable function expression, not a class.');
  }
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
  for (const key of ['message', 'remediation'] as const) {
    if (validation[key] !== undefined && !hasText(validation[key])) {
      throw metadataFailure(location, `validation.${key} must be a non-empty string.`);
    }
  }
  return {
    location,
    segments,
    node,
    ...(validation.message === undefined ? {} : { message: validation.message as string }),
    ...(validation.remediation === undefined ? {} : { remediation: validation.remediation as string }),
    script: compileValidator(functionSource(validation.function, location), location),
  };
}

/** JSON Schema keywords (draft-07 and 2020-12) whose value is one subschema or an array of subschemas. */
const SUBSCHEMA_KEYWORDS = [
  'additionalItems', 'additionalProperties', 'allOf', 'anyOf', 'contains', 'else', 'if', 'not', 'oneOf',
  'prefixItems', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties',
] as const;
/** JSON Schema keywords whose value maps names to subschemas. */
const SUBSCHEMA_MAP_KEYWORDS = ['$defs', 'definitions', 'dependencies', 'dependentSchemas', 'patternProperties'] as const;

/** Subschemas in positions where validators are not supported, including tuple-form `items`. */
function unsupportedPositionChildren(node: Record<string, unknown>): readonly unknown[] {
  const children: unknown[] = [];
  for (const keyword of SUBSCHEMA_KEYWORDS) {
    const value = node[keyword];
    if (Array.isArray(value)) children.push(...value);
    else if (isRecord(value)) children.push(value);
  }
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    const value = node[keyword];
    if (isRecord(value)) children.push(...Object.values(value));
  }
  if (Array.isArray(node.items)) children.push(...node.items);
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
 * schema declaration order. Malformed metadata and unsupported positions fail
 * closed before any value is validated. Schemas reached only through an
 * external `$ref` are not inspected.
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
        next.push({ path: appendProperty(instance.path, segment), value: instance.value[segment] });
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
  const stats = (path: string) => {
    try {
      return statSync(resolvePath(path));
    } catch {
      return undefined;
    }
  };
  return Object.freeze({
    resolve: resolvePath,
    exists: (path: string) => existsSync(resolvePath(path)),
    isFile: (path: string) => stats(path)?.isFile() === true,
    isDirectory: (path: string) => stats(path)?.isDirectory() === true,
    readText: (path: string) => {
      const absolute = resolvePath(path);
      const file = statSync(absolute);
      if (!file.isFile()) throw new Error(`Not a regular file: ${path}`);
      if (file.size > PARAMETER_VALIDATION_READ_LIMIT_BYTES) throw new Error(`File exceeds the ${PARAMETER_VALIDATION_READ_LIMIT_BYTES}-byte read limit: ${path}`);
      return readFileSync(absolute, 'utf8');
    },
  });
}

/**
 * Run a script synchronously and handle every promise it created.
 *
 * Promises created inside a validator context are still tracked by the
 * process-wide rejection tracker, so an unhandled rejection would otherwise
 * surface after validation returned and could terminate the process. While the
 * script runs, `promiseHooks.onInit` collects each promise it creates. Once it
 * returns, a rejection handler is attached to each one, which suppresses the
 * unhandled-rejection event and reports the reason to `onRejected`.
 */
function runHandlingPromises(script: Script, context: Context, onRejected: (reason: unknown) => void): unknown {
  const created: Promise<unknown>[] = [];
  const stop = promiseHooks.onInit((promise) => { created.push(promise); });
  try {
    return script.runInContext(context, { timeout: PARAMETER_VALIDATION_TIMEOUT_MS });
  } finally {
    stop();
    for (const promise of created) {
      try {
        Promise.prototype.then.call(promise, undefined, onRejected);
      } catch {
        // A promise whose `constructor` was tampered with cannot be observed; it is trusted bundle code.
      }
    }
  }
}

const INVALID_RESULT = 'validation.function must synchronously return true, false, undefined, a non-empty failure message, or a validation result object; asynchronous validators are not supported.';

/**
 * Read an own data property without running accessors. Returns `undefined`
 * when the property is absent; an accessor is a malformed result.
 */
function ownData(target: object, key: string, location: string, label: string, propertyLabel = `${label}.${key}`): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw metadataFailure(location, `${propertyLabel} must be a data property, not an accessor.`);
  return descriptor.value;
}

function assertOwnKeys(target: object, allowed: ReadonlySet<string>, location: string, label: string): void {
  for (const key of Reflect.ownKeys(target)) {
    if (typeof key !== 'string' || !allowed.has(key)) throw metadataFailure(location, `${label} contains unsupported member '${String(key)}'.`);
  }
}

/** Require visible text; paths may also be exactly `''` for the root. */
function resultText(value: unknown, location: string, label: string, allowRoot = false): string {
  if (allowRoot && value === '') return value;
  if (!hasText(value)) throw metadataFailure(location, `${label} must be a non-empty string${allowRoot ? " or '' for the root" : ''}.`);
  return value;
}

/** Parse a returned validation result object into issues; `[]` means valid. */
function resultIssues(result: object, validator: ParameterValidator, path: string): readonly ParameterValidationIssue[] {
  const location = validator.location;
  assertOwnKeys(result, RESULT_KEYS, location, 'The validation result');
  const valid = ownData(result, 'valid', location, 'The validation result');
  if (typeof valid !== 'boolean') throw metadataFailure(location, 'The validation result must have a boolean valid member.');
  const errors = ownData(result, 'errors', location, 'The validation result');
  if (errors !== undefined && !Array.isArray(errors)) throw metadataFailure(location, 'The validation result errors member must be an array.');
  const length = errors === undefined ? 0 : ownData(errors, 'length', location, 'The validation result errors') as number;
  if (valid) {
    if (length !== 0) throw metadataFailure(location, 'A validation result with valid: true must not contain errors.');
    return [];
  }
  if (length === 0 || length > PARAMETER_VALIDATION_MAX_ERRORS) {
    throw metadataFailure(location, `A validation result with valid: false must contain 1 to ${PARAMETER_VALIDATION_MAX_ERRORS} errors.`);
  }
  const indexes = new Set(['length', ...Array.from({ length }, (_, index) => String(index))]);
  assertOwnKeys(errors as object, indexes, location, 'The validation result errors');
  const issues: ParameterValidationIssue[] = [];
  for (let index = 0; index < length; index += 1) {
    const label = `The validation result errors[${index}]`;
    const entry = ownData(errors as object, String(index), location, 'The validation result errors', label);
    if (!isRecord(entry)) throw metadataFailure(location, `${label} must be an object.`);
    assertOwnKeys(entry, RESULT_ERROR_KEYS, location, label);
    const message = resultText(ownData(entry, 'message', location, label), location, `${label}.message`);
    const entryPath = ownData(entry, 'path', location, label);
    const remediation = ownData(entry, 'remediation', location, label);
    issues.push(issue(
      entryPath === undefined ? path : resultText(entryPath, location, `${label}.path`, true),
      message,
      remediation === undefined ? undefined : resultText(remediation, location, `${label}.remediation`),
    ));
  }
  return issues;
}

function outcome(result: unknown, validator: ParameterValidator, path: string): LlmFailure | undefined {
  if (result === true || result === undefined) return undefined;
  if (result === false) return validationFailure(path, validator.message ?? 'the value was rejected by its validation function.', validator.remediation);
  if (hasText(result)) return validationFailure(path, result, validator.remediation);
  // Promises and other objects without an own `valid` member are not result objects.
  if (isRecord(result) && Object.getOwnPropertyDescriptor(result, 'valid') !== undefined) {
    const issues = resultIssues(result, validator, path);
    return issues.length === 0 ? undefined : new ParameterValidationFailure(issues);
  }
  return metadataFailure(validator.location, INVALID_RESULT);
}

/**
 * Run every declared validation function against the resolved parameters in
 * schema declaration order. Values absent from `parameters` are skipped. The
 * first failure rejects with a bounded `CONFIGURATION_INVALID` error.
 *
 * Each call runs synchronously in a fresh `node:vm` context without Node
 * globals or string code generation. This limits accidental access; it is not
 * a security boundary, so request bundles must be trusted.
 */
export async function runParameterValidators(schema: InlineJsonSchema | undefined, parameters: JsonObject, request: ParameterValidationRequest): Promise<void> {
  const validators = discoverParameterValidators(schema);
  if (validators.length === 0) return;
  const workingDirectory = resolve(request.workingDirectory ?? process.cwd());
  const frozenParameters = frozenCopy(parameters);
  const fs = fileSystem(workingDirectory);
  const requestIdentity = Object.freeze({ name: request.name, directory: request.directory });
  let rejection: LlmFailure | undefined;
  let failure: LlmFailure | undefined;
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
      const onRejected = (reason: unknown): void => {
        rejection ??= validationFailure(instance.path, `the validation function left a rejected promise: ${thrownMessage(reason, 'a promise was rejected.')}`);
      };
      try {
        const result = runHandlingPromises(validator.script, isolatedContext({ __llmValue: instance.value, __llmContext: context }), onRejected);
        failure = outcome(result, validator, instance.path);
      } catch (error) {
        failure = error instanceof LlmFailure
          ? error
          : validationFailure(instance.path, thrownMessage(error, 'the validation function threw an error.'));
      }
      if (failure !== undefined) break;
    }
    if (failure !== undefined) break;
  }
  // Rejection handlers attached by runHandlingPromises run on a later turn.
  await new Promise<void>((done) => setImmediate(done));
  failure ??= rejection;
  if (failure !== undefined) throw failure;
}
