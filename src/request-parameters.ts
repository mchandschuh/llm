import { boundedMessage, LlmFailure } from './errors.js';
import { createJsonSchemaRegistry, type JsonSchemaRegistry } from 'schema-validate';
import type { InlineJsonSchema, JsonObject } from './types.js';

export interface RequestParameterAssignment {
  readonly path: string;
  readonly value: string;
}

export interface RequestParameterOptions {
  readonly schema?: InlineJsonSchema;
  readonly schemaPath?: string;
  readonly schemaRoots?: readonly string[];
  readonly schemaRegistry?: JsonSchemaRegistry;
  readonly defaults?: JsonObject;
  readonly parameters?: string | JsonObject;
  readonly assignments?: readonly RequestParameterAssignment[];
}

export type ParameterPathSegment = string | number;

const RESERVED_ROOT = 'parameter';

function parameterFailure(message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', boundedMessage(`Request parameters are invalid. ${message}`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasUnsupportedMetadata(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasUnsupportedMetadata);
  if (!isRecord(value)) return false;
  if (Object.prototype.hasOwnProperty.call(value, 'x-llm-req-parameter')) return true;
  return Object.values(value).some(hasUnsupportedMetadata);
}

function segmentName(segment: ParameterPathSegment): string {
  return typeof segment === 'number' ? `[${segment}]` : segment;
}

function canonicalPath(segments: readonly ParameterPathSegment[]): string {
  const [root, ...rest] = segments;
  return [String(root), ...rest.map(segmentName)].join('.');
}

function readIdentifier(source: string, start: number): { readonly value: string; readonly next: number } | undefined {
  const match = /^[A-Za-z_][A-Za-z0-9_-]*/u.exec(source.slice(start));
  return match ? { value: match[0], next: start + match[0].length } : undefined;
}

function readDotSegment(source: string, start: number): { readonly value: string; readonly next: number } | undefined {
  const match = /^(?:[A-Za-z_][A-Za-z0-9_-]*|[0-9]+)/u.exec(source.slice(start));
  return match ? { value: match[0], next: start + match[0].length } : undefined;
}

function parseBracket(source: string, start: number): { readonly value: ParameterPathSegment; readonly next: number } {
  const end = source.indexOf(']', start + 1);
  if (end === -1 || end === start + 1) throw parameterFailure(`Assignment path '${source}' contains an invalid bracket segment.`);
  const value = source.slice(start + 1, end);
  if (/^\d+$/u.test(value)) {
    const index = Number(value);
    if (!Number.isSafeInteger(index)) throw parameterFailure(`Assignment path '${source}' contains an invalid array index.`);
    return { value: index, next: end + 1 };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(value)) throw parameterFailure(`Assignment path '${source}' contains an invalid map key.`);
  return { value, next: end + 1 };
}

export function parseParameterPath(path: string): readonly ParameterPathSegment[] {
  if (typeof path !== 'string' || path.length === 0) throw parameterFailure('Assignment paths must be non-empty strings.');
  const first = readIdentifier(path, 0);
  if (!first) throw parameterFailure(`Assignment path '${path}' has an invalid root.`);
  const segments: ParameterPathSegment[] = [first.value];
  let cursor = first.next;
  while (cursor < path.length) {
    const token = path[cursor];
    if (token === '.') {
      const dotSegment = readDotSegment(path, cursor + 1);
      if (!dotSegment) throw parameterFailure(`Assignment path '${path}' contains an empty or invalid segment.`);
      segments.push(/^[0-9]+$/u.test(dotSegment.value) ? Number(dotSegment.value) : dotSegment.value);
      cursor = dotSegment.next;
      continue;
    }
    if (token === '[') {
      const bracket = parseBracket(path, cursor);
      segments.push(bracket.value);
      cursor = bracket.next;
      continue;
    }
    throw parameterFailure(`Assignment path '${path}' contains an invalid separator.`);
  }
  return segments;
}

function schemaType(schema: Record<string, unknown>): string | undefined {
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.type)) return schema.type.find((type): type is string => type !== 'null' && typeof type === 'string');
  for (const key of ['anyOf', 'oneOf']) {
    const alternatives = schema[key];
    if (Array.isArray(alternatives)) {
      const candidate = alternatives.find((item): item is Record<string, unknown> => isRecord(item) && schemaType(item) !== undefined);
      if (candidate) return schemaType(candidate);
    }
  }
  return undefined;
}

function propertySchema(schema: Record<string, unknown>, segment: ParameterPathSegment): Record<string, unknown> | undefined {
  const type = schemaType(schema);
  if (type === 'array') {
    if (typeof segment !== 'number') return undefined;
    return isRecord(schema.items) ? schema.items : undefined;
  }
  if (typeof segment === 'number') return undefined;
  const properties = schema.properties;
  if (isRecord(properties) && isRecord(properties[segment])) return properties[segment];
  if (isRecord(schema.additionalProperties)) return schema.additionalProperties;
  return schema.additionalProperties === true ? {} : undefined;
}

function schemaAtPath(schema: Record<string, unknown>, segments: readonly ParameterPathSegment[]): Record<string, unknown> | undefined {
  let current: Record<string, unknown> | undefined = schema;
  for (const segment of segments) {
    if (!current) return undefined;
    current = propertySchema(current, segment);
  }
  return current;
}

function parseJsonValue(path: string, value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw parameterFailure(`Object or array assignment '${path}' must be valid JSON.`);
  }
}

function convertAssignmentValue(path: string, value: string, schema: Record<string, unknown>): unknown {
  const type = schemaType(schema);
  if (type === 'object' || type === 'array') {
    const parsed = parseJsonValue(path, value);
    if (type === 'object' && !isRecord(parsed)) throw parameterFailure(`Assignment '${path}' must contain a JSON object.`);
    if (type === 'array' && !Array.isArray(parsed)) throw parameterFailure(`Assignment '${path}' must contain a JSON array.`);
    return parsed;
  }
  if (type === 'boolean') {
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw parameterFailure(`Assignment '${path}' must be true or false.`);
  }
  if (type === 'integer' || type === 'number') {
    if (value.trim() === '') throw parameterFailure(`Assignment '${path}' must be a number.`);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || (type === 'integer' && !Number.isInteger(parsed))) throw parameterFailure(`Assignment '${path}' must be a ${type}.`);
    return parsed;
  }
  if (type === 'null') {
    if (value !== 'null') throw parameterFailure(`Assignment '${path}' must be null.`);
    return null;
  }
  if (type === undefined || type === 'string') return value;
  throw parameterFailure(`Assignment '${path}' has an unsupported schema type.`);
}

function mergeObjects(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(base[key]) && isRecord(value)) mergeObjects(base[key] as Record<string, unknown>, value);
    else base[key] = clone(value);
  }
  return base;
}

function validationMessage(errors: readonly { readonly instancePath?: string; readonly path?: string; readonly message: string }[]): string {
  return errors.slice(0, 10).map((error) => `${error.instancePath ?? error.path ?? '$'} ${error.message}`).join('; ');
}

function resolveSchema(options: RequestParameterOptions, registry: JsonSchemaRegistry): InlineJsonSchema {
  if (!options.schema) throw parameterFailure('A parameter schema is required when parameters are supplied.');
  const documentPath = options.schemaPath ?? 'parameters.schema.json';
  const report = registry.validateSchema(options.schema, { documentPath, rules: [] });
  if (!report.valid) throw parameterFailure(`The parameter schema is not a valid JSON Schema object: ${validationMessage(report.findings)}.`);
  return options.schema;
}

function validateInstance(value: JsonObject, schema: InlineJsonSchema, registry: JsonSchemaRegistry, documentPath: string, schemaRoots: readonly string[] | undefined): void {
  const report = registry.validateInstance(schema, value, { documentPath, schemaRoots });
  if (!report.valid) throw parameterFailure(`The resolved parameters do not satisfy the parameter schema: ${validationMessage(report.errors)}.`);
}

function assertKnownPath(schema: Record<string, unknown>, segments: readonly ParameterPathSegment[], path: string): Record<string, unknown> {
  const target = schemaAtPath(schema, segments);
  if (!target) throw parameterFailure(`Assignment path '${path}' is not allowed by the parameter schema.`);
  return target;
}

function assertNoAssignmentConflicts(assignments: readonly { readonly path: string; readonly segments: readonly ParameterPathSegment[] }[]): void {
  const seen = new Set<string>();
  for (const assignment of assignments) {
    const canonical = canonicalPath(assignment.segments);
    if (seen.has(canonical)) throw parameterFailure(`Assignment path '${assignment.path}' is duplicated.`);
    seen.add(canonical);
    for (const other of seen) {
      if (other === canonical) continue;
      if (canonical.startsWith(`${other}.`) || other.startsWith(`${canonical}.`)) throw parameterFailure(`Assignment paths '${assignment.path}' and '${other}' conflict.`);
    }
  }
}

function assignValue(target: Record<string, unknown>, segments: readonly ParameterPathSegment[], value: unknown, path: string, schema: Record<string, unknown>): void {
  let current: unknown = target;
  let currentSchema = schema;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const currentType = schemaType(currentSchema);
    if (currentType === 'array' && typeof segment !== 'number') throw parameterFailure(`Assignment path '${path}' requires an array index.`);
    if (currentType === 'object' && typeof segment !== 'string') throw parameterFailure(`Assignment path '${path}' requires an object property.`);
    const childSchema = propertySchema(currentSchema, segment);
    if (!childSchema) throw parameterFailure(`Assignment path '${path}' is not allowed by the parameter schema.`);
    const childType = schemaType(childSchema);
    if (childType !== 'object' && childType !== 'array') throw parameterFailure(`Assignment path '${path}' crosses a scalar value.`);
    if (typeof current !== 'object' || current === null) throw parameterFailure(`Assignment path '${path}' crosses a scalar value.`);
    const container = current as Record<string, unknown> | unknown[];
    if (Array.isArray(container)) {
      const arrayIndex = segment as number;
      if (arrayIndex < 0 || arrayIndex > container.length) throw parameterFailure(`Assignment path '${path}' contains a sparse or invalid array index.`);
      if (container[arrayIndex] === undefined) container[arrayIndex] = childType === 'array' ? [] : {};
      current = container[arrayIndex];
    } else {
      const key = String(segment);
      if (container[key] === undefined) container[key] = childType === 'array' ? [] : {};
      current = container[key];
    }
    currentSchema = childSchema;
  }
  const finalSegment = segments[segments.length - 1]!;
  const currentType = schemaType(currentSchema);
  if (currentType === 'array' && typeof finalSegment !== 'number') throw parameterFailure(`Assignment path '${path}' requires an array index.`);
  if (currentType === 'object' && typeof finalSegment !== 'string') throw parameterFailure(`Assignment path '${path}' requires an object property.`);
  if (Array.isArray(current)) {
    if (typeof finalSegment !== 'number' || finalSegment < 0 || finalSegment > current.length) throw parameterFailure(`Assignment path '${path}' contains a sparse or invalid array index.`);
    current[finalSegment] = value;
  } else if (isRecord(current)) {
    current[String(finalSegment)] = value;
  } else {
    throw parameterFailure(`Assignment path '${path}' crosses a scalar value.`);
  }
}

export function constructRequestParameters(options: RequestParameterOptions): JsonObject {
  const defaults = options.defaults ?? {};
  if (!isRecord(defaults)) throw parameterFailure('Parameter defaults must be a JSON object.');
  const assignments = options.assignments ?? [];
  const registry = options.schemaRegistry ?? createJsonSchemaRegistry({ schemaRoots: options.schemaRoots, rules: [] });
  if (!options.schema) {
    if (Object.keys(defaults).length > 0 || options.parameters !== undefined || assignments.length > 0) throw parameterFailure('A parameter schema is required when parameters are supplied.');
    return {};
  }
  const resolvedSchema = resolveSchema(options, registry);
  if (hasUnsupportedMetadata(resolvedSchema)) throw parameterFailure('x-llm-req-parameter custom validation metadata is not supported by this boundary.');
  const rootSchema = resolvedSchema;
  const result: Record<string, unknown> = {};
  mergeObjects(result, defaults);
  if (options.parameters !== undefined) {
    let full: unknown = options.parameters;
    if (typeof full === 'string') full = parseJsonValue('--parameters', full);
    if (!isRecord(full)) throw parameterFailure('--parameters must contain a JSON object.');
    mergeObjects(result, full);
  }
  const parsedAssignments = assignments.map((assignment) => {
    if (!assignment || typeof assignment.path !== 'string' || typeof assignment.value !== 'string') throw parameterFailure('Assignments must contain string path and value fields.');
    const segments = parseParameterPath(assignment.path);
    if (segments[0] === RESERVED_ROOT) throw parameterFailure(`Assignment path '${assignment.path}' uses reserved root '${RESERVED_ROOT}'.`);
    const targetSchema = assertKnownPath(rootSchema, segments, assignment.path);
    return { ...assignment, segments, converted: convertAssignmentValue(assignment.path, assignment.value, targetSchema) };
  });
  assertNoAssignmentConflicts(parsedAssignments);
  for (const assignment of parsedAssignments) assignValue(result, assignment.segments, assignment.converted, assignment.path, rootSchema);
  validateInstance(result, resolvedSchema, registry, options.schemaPath ?? 'parameters.schema.json', options.schemaRoots);
  return result;
}