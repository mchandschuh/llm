import { boundedMessage, LlmFailure } from './errors.js';
import { parseParameterPath, type ParameterPathSegment } from './request-parameters.js';
import type { JsonObject } from './types.js';

const PLACEHOLDER = /(?<!\$)\$\$\{([^{}]+)\}\$\$(?!\$)/gu;

function variableFailure(message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', boundedMessage(`Request variable substitution failed. ${message}`));
}

function readValue(parameters: JsonObject, segments: readonly ParameterPathSegment[], path: string): unknown {
  let current: unknown = parameters;
  for (const segment of segments) {
    if (Array.isArray(current)) {
      if (typeof segment !== 'number' || segment < 0 || segment >= current.length || !(segment in current)) {
        throw variableFailure(`Variable '${path}' is not defined.`);
      }
      current = current[segment];
    } else if (current && typeof current === 'object') {
      const record = current as Record<string, unknown>;
      const key = String(segment);
      if (!Object.prototype.hasOwnProperty.call(record, key)) throw variableFailure(`Variable '${path}' is not defined.`);
      current = record[key];
    } else {
      throw variableFailure(`Variable '${path}' is not defined.`);
    }
  }
  return current;
}

function serializeValue(path: string, value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('value is not serializable');
    return serialized;
  } catch {
    throw variableFailure(`Variable '${path}' is not serializable.`);
  }
}

export function substituteRequestVariables(source: string, parameters: JsonObject): string {
  if (typeof source !== 'string') throw variableFailure('Substitution input must be text.');
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw variableFailure('Substitution parameters must be an object.');
  return source.replace(PLACEHOLDER, (match, path: string) => {
    let segments: readonly ParameterPathSegment[];
    try {
      segments = parseParameterPath(path);
    } catch {
      throw variableFailure(`Variable '${path}' has an invalid path.`);
    }
    return serializeValue(path, readValue(parameters, segments, path));
  });
}

export function substituteRequestAssets<T extends Record<string, string>>(assets: T, parameters: JsonObject): T {
  return Object.fromEntries(Object.entries(assets).map(([key, value]) => [key, substituteRequestVariables(value, parameters)])) as T;
}