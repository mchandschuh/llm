import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ErrorObject, type ValidateFunction } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { boundedMessage, LlmFailure } from './errors.js';
import type { InlineJsonSchema, LlmRequestV2, LlmResponse, LlmResponseV2 } from './types.js';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;

const requestSchemaPath = fileURLToPath(new URL('../schemas/request/v1/request.schema.json', import.meta.url));
const responseSchemaPathValue = fileURLToPath(new URL('../schemas/response/v1/response.schema.json', import.meta.url));
const requestSchemaV2Path = fileURLToPath(new URL('../schemas/request/v2/request.schema.json', import.meta.url));
const responseSchemaV2Path = fileURLToPath(new URL('../schemas/response/v2/response.schema.json', import.meta.url));
const requestSchema = JSON.parse(await readFile(requestSchemaPath, 'utf8')) as Record<string, unknown>;
const responseSchema = JSON.parse(await readFile(responseSchemaPathValue, 'utf8')) as Record<string, unknown>;
const requestSchemaV2 = JSON.parse(await readFile(requestSchemaV2Path, 'utf8')) as Record<string, unknown>;
const responseSchemaV2 = JSON.parse(await readFile(responseSchemaV2Path, 'utf8')) as Record<string, unknown>;

function createSchemaValidator(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

const requestValidator = createSchemaValidator().compile(requestSchema);
const responseValidator = createSchemaValidator().compile(responseSchema);
const requestValidatorV2 = createSchemaValidator().compile(requestSchemaV2);
const responseValidatorV2 = createSchemaValidator().compile(responseSchemaV2);

export interface SchemaValidationError {
  readonly instancePath: string;
  readonly message: string;
}

function validationErrors(errors: ErrorObject[] | null | undefined): SchemaValidationError[] {
  return (errors ?? []).slice(0, 10).map((error) => ({
    instancePath: error.instancePath,
    message: error.message ?? 'Schema validation failed.',
  }));
}

export function assertRequestShape(value: unknown): asserts value is Record<string, unknown> {
  if (!requestValidator(value)) {
    throw new LlmFailure('REQUEST_INVALID', 'request', `Request validation failed: ${validationErrors(requestValidator.errors).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
  }
}

export function validateResponse(value: LlmResponse): void {
  if (!responseValidator(value)) {
    throw new Error(`Internal response contract failure: ${validationErrors(responseValidator.errors).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
  }
}

export function assertRequestV2Shape(value: unknown): asserts value is LlmRequestV2 {
  if (!requestValidatorV2(value)) {
    throw new LlmFailure('REQUEST_INVALID', 'request', `Request validation failed: ${validationErrors(requestValidatorV2.errors).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
  }
}

export function validateResponseV2(value: LlmResponseV2): void {
  if (!responseValidatorV2(value)) {
    throw new Error(`Internal response v2 contract failure: ${validationErrors(responseValidatorV2.errors).map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ')}`);
  }
}

export interface LoadedSchema {
  readonly schema: Record<string, unknown>;
  readonly name: string;
  readonly path?: string;
  readonly validator: ValidateFunction;
}

export function parseSchema(source: string | InlineJsonSchema, path?: string): LoadedSchema {
  let parsed: unknown;
  if (typeof source === 'string') {
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'A configured JSON Schema is not valid JSON.');
    }
  } else {
    parsed = source;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'A configured JSON Schema must be a JSON object.');
  }
  try {
    const schema = parsed as Record<string, unknown>;
    const validator = createSchemaValidator().compile(schema);
    const name = typeof schema.$id === 'string' ? schema.$id : path ?? 'inline-schema';
    return { schema, name, path, validator };
  } catch {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'A configured JSON Schema could not be compiled.');
  }
}

export function assertMatchesSchema(value: unknown, loaded: LoadedSchema, code: 'TASK_SCHEMA_VALIDATION_FAILED' | 'OUTPUT_SCHEMA_VALIDATION_FAILED' | 'TOOL_SCHEMA_VALIDATION_FAILED', phase: 'request' | 'output-validation' | 'tool-validation'): void {
  if (!loaded.validator(value)) {
    const errors = validationErrors(loaded.validator.errors)
      .map((error) => `${error.instancePath || '/'} ${error.message}`)
      .join('; ');
    throw new LlmFailure(code, phase, boundedMessage(`Value does not satisfy the configured schema: ${errors}`));
  }
}

export function responseSchemaPath(): string {
  return fileURLToPath(new URL('../schemas/response/v1/response.schema.json', import.meta.url));
}

export function loadResponseSchema(): Record<string, unknown> {
  return responseSchema;
}
