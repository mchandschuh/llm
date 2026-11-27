import { readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { boundedMessage, LlmFailure } from '../errors.js';
import { loadRequestDirectory, locateRequest, type LoadedRequestDirectory } from '../request-directory.js';
import { resolveRequestDirectories } from '../requests-config.js';
import type { OutputWriter } from './output.js';

/** Usage lines shared by `llm --help`, `llm req -h`, and request help. */
export const REQUEST_USAGE_LINES = [
  'llm req <request-name> [--parameters <json>] [--p-<path> <value>] [--format=full|raw] [--debug]',
  'llm req <request-name> -h|--help',
  'llm req -h|--help',
] as const;

const MAX_PARAMETER_DEPTH = 6;

type Schema = Record<string, unknown>;

export interface RequestListingEntry {
  readonly name: string;
  readonly description: string;
}

export interface UnavailableRequestEntry {
  readonly name: string;
  readonly reason: string;
}

/** A request name found in more than one configured request directory. */
export interface DuplicateRequestEntry {
  readonly name: string;
  readonly directories: readonly string[];
}

export interface DiscoveredRequests {
  readonly available: readonly RequestListingEntry[];
  readonly unavailable: readonly UnavailableRequestEntry[];
  readonly duplicates: readonly DuplicateRequestEntry[];
}

export interface RequestHelpCommandOptions {
  /** Absent for the request listing; present for one request's parameter help. */
  readonly requestName?: string;
  /** Injected request directories; the configured directories are used when absent. */
  readonly requestsDirectories?: readonly string[];
  readonly write?: OutputWriter;
  readonly writeError?: OutputWriter;
}

function isRecord(value: unknown): value is Schema {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function compareNames(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The request description: parameters-schema description, then title, then a fixed fallback. */
export function requestDescription(loaded: LoadedRequestDirectory): string {
  const schema = loaded.assets.parametersSchema?.value as Schema | undefined;
  for (const key of ['description', 'title']) {
    const value = schema?.[key];
    if (typeof value === 'string' && oneLine(value).length > 0) return oneLine(value);
  }
  return 'No description.';
}

function reason(error: unknown): string {
  return boundedMessage(error instanceof Error ? error.message : 'The request could not be loaded.');
}

/**
 * Load every request directory under each configured request directory,
 * separating loadable from unavailable requests. A name present in more than
 * one directory is reported only as a duplicate, because `llm req <name>`
 * rejects it as ambiguous.
 */
export async function discoverRequests(requestsDirectories: readonly string[]): Promise<DiscoveredRequests> {
  const locations = new Map<string, string[]>();
  for (const directory of requestsDirectories) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || !(entry.isDirectory() || entry.isSymbolicLink())) continue;
      locations.set(entry.name, [...(locations.get(entry.name) ?? []), directory]);
    }
  }
  const available: RequestListingEntry[] = [];
  const unavailable: UnavailableRequestEntry[] = [];
  const duplicates: DuplicateRequestEntry[] = [];
  for (const name of [...locations.keys()].sort(compareNames)) {
    const directories = locations.get(name)!;
    if (directories.length > 1) {
      duplicates.push({ name, directories });
      continue;
    }
    try {
      available.push({ name, description: requestDescription(await loadRequestDirectory(directories[0]!, name)) });
    } catch (error) {
      unavailable.push({ name, reason: reason(error) });
    }
  }
  return { available, unavailable, duplicates };
}

function aligned(entries: readonly { readonly name: string; readonly text: string }[]): string[] {
  const width = Math.max(...entries.map((entry) => entry.name.length));
  return entries.map((entry) => `  ${entry.name.padEnd(width)}  ${entry.text}`);
}

export function renderRequestListing(requestsDirectories: readonly string[], discovered: DiscoveredRequests): string {
  const { available, unavailable, duplicates } = discovered;
  const single = requestsDirectories.length === 1;
  const lines = [
    `Usage: ${REQUEST_USAGE_LINES[0]}`,
    ...REQUEST_USAGE_LINES.slice(1).map((line) => `       ${line}`),
    '',
    `Run a named request bundle from the configured request ${single ? 'directory' : 'directories'}.`,
    '',
    ...(single
      ? [`Requests directory: ${requestsDirectories[0]}`]
      : ['Request directories:', ...requestsDirectories.map((directory) => `  ${directory}`)]),
    '',
  ];
  if (available.length === 0) lines.push('No requests are available.');
  else lines.push('Available requests:', ...aligned(available.map((entry) => ({ name: entry.name, text: entry.description }))));
  if (unavailable.length > 0) {
    lines.push('', 'Unavailable requests:', ...aligned(unavailable.map((entry) => ({ name: entry.name, text: entry.reason }))));
  }
  if (duplicates.length > 0) {
    lines.push(
      '',
      "Duplicate requests (ambiguous; 'llm req <name>' fails until only one directory provides the name):",
      ...aligned(duplicates.map((entry) => ({ name: entry.name, text: entry.directories.join(', ') }))),
    );
  }
  lines.push('', "Run 'llm req <request-name> -h' to list a request's parameters.");
  return `${lines.join('\n')}\n`;
}

/** Quote a command-line value only when the shell would otherwise split or expand it. */
function shellValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(text) ? text : `'${text.replace(/'/gu, "'\\''")}'`;
}

function typeLabel(schema: Schema): string {
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map((value) => JSON.stringify(value)).join(', ')}`;
  if ('const' in schema) return `the constant ${JSON.stringify(schema.const)}`;
  if (typeof schema.$ref === 'string') return `see ${schema.$ref}`;
  if (Array.isArray(schema.type)) return schema.type.join(' | ');
  if (typeof schema.type === 'string') return schema.type;
  if (isRecord(schema.properties)) return 'object';
  return 'any JSON value';
}

function valueAt(source: unknown, segments: readonly string[]): { readonly found: boolean; readonly value?: unknown } {
  let current = source;
  for (const segment of segments) {
    if (!isRecord(current) || !(segment in current)) return { found: false };
    current = current[segment];
  }
  return { found: true, value: current };
}

function fileBindingLines(schema: Schema): string[] {
  const metadata = schema['x-llm-req-parameter'];
  if (!isRecord(metadata)) return [];
  const lines: string[] = [];
  if (isRecord(metadata.file)) {
    const file = metadata.file;
    const details = [`${String(file.mode)} mode`, String(file.type)];
    if (typeof file.name === 'string') details.push(`name ${file.name}`);
    if (typeof file.encoding === 'string') details.push(`encoding ${file.encoding}`);
    const mode = file.mode === 'path'
      ? 'the value is a file or directory path whose contents are sent to the request'
      : 'the value is sent to the request as file content';
    lines.push(`File binding: ${details.join(', ')}; ${mode}.`);
    if (typeof file.purpose === 'string') lines.push(`File purpose: ${oneLine(file.purpose)}`);
  }
  if (isRecord(metadata.validation)) {
    lines.push('Validation: checked by an inline validation function before the request runs.');
    if (typeof metadata.validation.message === 'string') lines.push(`Validation message: ${oneLine(metadata.validation.message)}`);
  }
  return lines;
}

interface ParameterContext {
  readonly defaults: unknown;
  readonly lines: string[];
}

function describeParameter(context: ParameterContext, flagPath: string, defaultPath: readonly string[] | undefined, schema: Schema, required: boolean, depth: number): void {
  const isObject = isRecord(schema.properties);
  const isArray = schema.type === 'array' || (Array.isArray(schema.type) && schema.type.includes('array'));
  const placeholder = isObject ? '<json-object>' : isArray ? '<json-array>' : '<value>';
  context.lines.push(`  --p-${flagPath} ${placeholder}`);
  const detail = (text: string): void => {
    context.lines.push(`      ${text}`);
  };
  const defaulted = defaultPath === undefined ? { found: false } : valueAt(context.defaults, defaultPath);
  const status = required ? 'Required' : 'Optional';
  detail(`Type: ${typeLabel(schema)}. ${status}.${defaulted.found ? ` Default: ${JSON.stringify(defaulted.value)} (from defaults.json).` : ''}`);
  if (typeof schema.description === 'string' && oneLine(schema.description)) detail(oneLine(schema.description));
  if (isObject) detail(`Accepts a JSON object, or set its properties individually as --p-${flagPath}.<property>.`);
  if (isArray) detail(`Accepts a JSON array, or set elements individually as --p-${flagPath}[<index>].`);
  for (const line of fileBindingLines(schema)) detail(line);
  if (Array.isArray(schema.examples)) {
    for (const example of schema.examples) detail(`Example: --p-${flagPath} ${shellValue(example)}`);
  }
  if (depth >= MAX_PARAMETER_DEPTH) return;
  if (isObject) {
    const requiredChildren = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : []);
    for (const [name, child] of Object.entries(schema.properties as Schema)) {
      if (!isRecord(child)) continue;
      describeParameter(context, `${flagPath}.${name}`, defaultPath === undefined ? undefined : [...defaultPath, name], child, requiredChildren.has(name), depth + 1);
    }
  }
  if (isArray && isRecord(schema.items) && (isRecord(schema.items.properties) || schema.items.type === 'array')) {
    describeParameter(context, `${flagPath}[<index>]`, undefined, schema.items, false, depth + 1);
  } else if (isArray && isRecord(schema.items) && schema.items.type !== undefined) {
    context.lines.push(`  --p-${flagPath}[<index>] <value>`);
    context.lines.push(`      Type: ${typeLabel(schema.items)}. One array element.`);
  }
}

function requirementGroups(schema: Schema): string[] {
  const lines: string[] = [];
  for (const [keyword, label] of [['oneOf', 'Exactly one of'], ['anyOf', 'At least one of']] as const) {
    const alternatives = schema[keyword];
    if (!Array.isArray(alternatives)) continue;
    const groups = alternatives
      .filter(isRecord)
      .map((alternative) => (Array.isArray(alternative.required) ? alternative.required.filter((name): name is string => typeof name === 'string') : []))
      .filter((names) => names.length > 0)
      .map((names) => names.map((name) => `--p-${name}`).join(' + '));
    if (groups.length > 0) lines.push(`  ${label}: ${groups.join(', ')}`);
  }
  return lines;
}

export function renderRequestHelp(loaded: LoadedRequestDirectory): string {
  const { requestName, assets } = loaded;
  const schema = assets.parametersSchema?.value as Schema | undefined;
  const defaults = assets.defaults?.value as Schema | undefined;
  const lines: string[] = [];
  if (schema === undefined) {
    lines.push(`Usage: llm req ${requestName} [--format=full|raw] [--debug]`, '', requestDescription(loaded), '', 'This request accepts no parameters.');
  } else {
    lines.push(`Usage: llm req ${requestName} [--parameters <json>] [--p-<path> <value>] [--format=full|raw] [--debug]`, '', requestDescription(loaded), '');
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter((name): name is string => typeof name === 'string') : []);
    const context: ParameterContext = { defaults: defaults?.parameters, lines };
    const entries = Object.entries(properties).filter((entry): entry is [string, Schema] => isRecord(entry[1]));
    if (entries.length === 0) {
      lines.push('This request declares no parameters.');
    } else {
      lines.push('Parameters:');
      for (const [name, child] of entries) describeParameter(context, name, [name], child, required.has(name), 1);
    }
    const groups = requirementGroups(schema);
    if (groups.length > 0) lines.push('', 'Constraints:', ...groups);
    lines.push(
      '',
      'Set parameters individually with --p-<path> <value>, or all at once with --parameters <json>.',
      'Precedence: defaults.json parameters, then --parameters, then --p- assignments in command-line order.',
      `Parameter schema: ${basename(assets.parametersSchema!.path)}`,
    );
  }
  const settings = Object.entries(defaults ?? {}).filter(([key]) => key !== 'parameters');
  if (settings.length > 0) {
    lines.push('', `Request settings (from ${basename(assets.defaults!.path)}):`, ...settings.map(([key, value]) => `  ${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`));
  }
  return `${lines.join('\n')}\n`;
}

/** Run `llm req -h` or `llm req <request-name> -h`. Help is read-only and never creates a provider. */
export async function runRequestHelpCommand(options: RequestHelpCommandOptions = {}): Promise<number> {
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(text));
  try {
    const requestsDirectories = options.requestsDirectories ?? await resolveRequestDirectories();
    if (options.requestName === undefined) {
      write(renderRequestListing(requestsDirectories, await discoverRequests(requestsDirectories)));
    } else {
      const requestsDirectory = await locateRequest(requestsDirectories, options.requestName);
      write(renderRequestHelp(await loadRequestDirectory(requestsDirectory, options.requestName)));
    }
    return 0;
  } catch (error) {
    const code = error instanceof LlmFailure ? error.code : 'CONFIGURATION_INVALID';
    const phase = error instanceof LlmFailure ? error.phase : 'configuration';
    writeError(`${JSON.stringify({ status: 'configuration_error', errors: [{ code, phase, message: reason(error) }] })}\n`);
    return 1;
  }
}
