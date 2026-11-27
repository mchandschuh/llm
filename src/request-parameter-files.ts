import { lstat, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { boundedMessage, LlmFailure } from './errors.js';
import type { InlineJsonSchema, JsonObject, ReferenceFile } from './types.js';

const FILE_METADATA = 'x-llm-req-parameter';
const MIME_TYPE = /^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+$/u;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const FILE_METADATA_KEYS = new Set(['mode', 'name', 'type', 'purpose', 'encoding']);

export interface ParameterFileMetadata {
  readonly mode: 'path' | 'content';
  readonly name?: string;
  readonly type: string;
  readonly purpose: string;
  readonly encoding?: 'utf8' | 'base64';
}

export interface ParameterFileBinding {
  readonly path: string;
  readonly metadata: ParameterFileMetadata;
  readonly array?: boolean;
}

interface ParsedParameterFileMetadata {
  readonly metadata: ParameterFileMetadata;
  readonly array: boolean;
}

export interface PreparedReferenceFiles {
  readonly files: readonly ReferenceFile[];
  readonly temporaryRoot?: string;
}

function parameterFileFailure(message: string): LlmFailure {
  return new LlmFailure('CONFIGURATION_INVALID', 'configuration', boundedMessage(`Schema-declared file bindings are invalid. ${message}`));
}

function sourceFailure(message: string): LlmFailure {
  return new LlmFailure('SOURCE_RESOLUTION_FAILED', 'source-resolution', boundedMessage(message));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw parameterFileFailure(`${field} must be a non-empty string.`);
  return value;
}

function assertMimeType(type: string): void {
  if (!MIME_TYPE.test(type)) throw parameterFileFailure(`file.type '${type}' must be a valid MIME type.`);
}

function parseMetadata(node: Record<string, unknown>, path: string): ParsedParameterFileMetadata | undefined {
  if (!Object.prototype.hasOwnProperty.call(node, FILE_METADATA)) return undefined;
  const extension = node[FILE_METADATA];
  if (!isRecord(extension)) throw parameterFileFailure(`${FILE_METADATA} at '${path}' must be an object containing only file.`);
  const extensionKeys = Object.keys(extension);
  if (extensionKeys.length !== 1 || extensionKeys[0] !== 'file' || !isRecord(extension.file)) {
    throw parameterFileFailure(`${FILE_METADATA} at '${path}' contains unsupported custom validation metadata or another member.`);
  }
  const file = extension.file;
  for (const key of Object.keys(file)) {
    if (!FILE_METADATA_KEYS.has(key)) throw parameterFileFailure(`file metadata at '${path}' contains unsupported member '${key}'.`);
  }
  const mode = assertString(file.mode, `file.mode at '${path}'`);
  if (mode !== 'path' && mode !== 'content') throw parameterFileFailure(`file.mode at '${path}' must be path or content.`);
  const type = assertString(file.type, `file.type at '${path}'`);
  assertMimeType(type);
  const purpose = assertString(file.purpose, `file.purpose at '${path}'`);
  const name = file.name === undefined ? undefined : assertString(file.name, `file.name at '${path}'`);
  if (name !== undefined && !FILE_NAME.test(name)) throw parameterFileFailure(`file.name at '${path}' must be a safe file name.`);
  if (mode === 'content' && name === undefined) throw parameterFileFailure(`file.name at '${path}' is required for content bindings.`);
  const encoding = file.encoding === undefined ? undefined : assertString(file.encoding, `file.encoding at '${path}'`);
  if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'base64') throw parameterFileFailure(`file.encoding at '${path}' must be utf8 or base64.`);
  const unsupportedComposition = Object.keys(node).some((key) => ['$ref', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else'].includes(key));
  const array = node.type === 'array';
  const stringArray = array && isRecord(node.items) && node.items.type === 'string'
    && !Object.keys(node.items).some((key) => ['$ref', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else'].includes(key));
  if ((node.type !== 'string' && !stringArray) || unsupportedComposition) {
    throw parameterFileFailure(`file metadata at '${path}' is supported only on a scalar string schema node or a string array schema node.`);
  }
  return {
    metadata: {
      mode,
      type,
      purpose,
      ...(name === undefined ? {} : { name }),
      ...(encoding === undefined ? {} : { encoding }),
    },
    array: stringArray,
  };
}

function walkSchema(node: Record<string, unknown>, path: string, allowBinding: boolean, bindings: ParameterFileBinding[]): void {
  const parsedMetadata = parseMetadata(node, path);
  if (parsedMetadata !== undefined) {
    if (!allowBinding) throw parameterFileFailure(`file metadata at '${path}' is not supported in this schema position.`);
    bindings.push({
      path,
      metadata: parsedMetadata.metadata,
      ...(parsedMetadata.array ? { array: true } : {}),
    });
  }

  const properties = node.properties;
  if (isRecord(properties)) {
    for (const [property, child] of Object.entries(properties)) {
      if (isRecord(child)) walkSchema(child, path ? `${path}.${property}` : property, allowBinding, bindings);
      else throw parameterFileFailure(`The schema node for '${path ? `${path}.${property}` : property}' must be an object.`);
    }
  }

  for (const keyword of ['items', 'additionalProperties', 'prefixItems', '$defs', 'definitions', 'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', 'else']) {
    const value = node[keyword];
    if (isRecord(value)) {
      walkSchema(value, path, false, bindings);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item)) walkSchema(item, path, false, bindings);
      }
    }
  }
}

export function validateParameterFileSchema(schema: InlineJsonSchema | undefined): readonly ParameterFileBinding[] {
  if (schema === undefined) return [];
  const bindings: ParameterFileBinding[] = [];
  walkSchema(schema as Record<string, unknown>, '', true, bindings);
  return bindings;
}

function valueAtPath(parameters: JsonObject, path: string): unknown {
  let current: unknown = parameters;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
}

function sourceFile(path: string, type: string, purpose: string, encoding?: 'utf8' | 'base64', root?: string): ReferenceFile {
  const absolutePath = resolve(path);
  const relativePath = root === undefined ? undefined : relative(root, absolutePath);
  return {
    name: relativePath && !relativePath.startsWith('..') ? relativePath.split(sep).join('__') : basename(absolutePath),
    path: absolutePath,
    type,
    purpose,
    ...(encoding === undefined ? {} : { encoding }),
  };
}

async function collectDirectoryFiles(root: string, type: string, purpose: string, encoding?: 'utf8' | 'base64'): Promise<readonly ReferenceFile[]> {
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      throw sourceFailure('A configured file directory could not be read.');
    }
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isSymbolicLink()) {
        try {
          if ((await stat(path)).isFile()) paths.push(path);
        } catch {
          // Broken links and inaccessible targets are not input files.
        }
      } else if (entry.isFile()) {
        paths.push(path);
      }
    }
  }

  await visit(root);
  return paths.sort().map((path) => sourceFile(path, type, purpose, encoding, root));
}

async function preparePathFiles(path: string, type: string, purpose: string, encoding?: 'utf8' | 'base64'): Promise<readonly ReferenceFile[]> {
  const absolutePath = resolve(process.cwd(), path);
  let info;
  try {
    info = await lstat(absolutePath);
  } catch {
    throw sourceFailure('A configured file path does not exist or could not be inspected.');
  }
  if (info.isSymbolicLink()) {
    let target;
    try {
      target = await stat(absolutePath);
    } catch {
      throw sourceFailure('A configured symbolic-link file could not be resolved.');
    }
    if (!target.isFile()) throw sourceFailure('Configured file paths must resolve to regular files or directories.');
    return [sourceFile(absolutePath, type, purpose, encoding)];
  }
  if (info.isDirectory()) return collectDirectoryFiles(absolutePath, type, purpose, encoding);
  if (!info.isFile()) throw sourceFailure('Configured file paths must resolve to regular files or directories.');
  return [sourceFile(absolutePath, type, purpose, encoding)];
}

function indexedFileName(name: string, index: number): string {
  const extension = name.lastIndexOf('.');
  return extension > 0 ? `${name.slice(0, extension)}-${index}${name.slice(extension)}` : `${name}-${index}`;
}

async function createContentFile(root: string, content: string, metadata: ParameterFileMetadata, index?: number): Promise<ReferenceFile> {
  const name = index === undefined ? metadata.name! : indexedFileName(metadata.name!, index);
  const path = join(root, name);
  try {
    await writeFile(path, content, 'utf8');
  } catch {
    throw sourceFailure('A schema-declared content file could not be created.');
  }
  return {
    name,
    path,
    type: metadata.type,
    purpose: metadata.purpose,
    ...(metadata.encoding === undefined ? {} : { encoding: metadata.encoding }),
  };
}

export async function materializeParameterFiles(schema: InlineJsonSchema | undefined, parameters: JsonObject): Promise<PreparedReferenceFiles> {
  const bindings = validateParameterFileSchema(schema);
  if (bindings.length === 0) return { files: [] };
  let temporaryRoot: string | undefined;
  const files: ReferenceFile[] = [];
  try {
    for (const binding of bindings) {
      const value = valueAtPath(parameters, binding.path);
      if (value === undefined) continue;
      if (binding.array === true && !Array.isArray(value)) throw parameterFileFailure(`The value for '${binding.path}' must be an array of non-empty strings.`);
      const values: readonly unknown[] = binding.array === true ? value as readonly unknown[] : [value];
      for (const [index, item] of values.entries()) {
        if (typeof item !== 'string' || item.length === 0) {
          throw parameterFileFailure(binding.array === true ? `The value for '${binding.path}[${index}]' must be a non-empty string.` : `The value for '${binding.path}' must be a non-empty string.`);
        }
        if (binding.metadata.mode === 'path') {
          files.push(...await preparePathFiles(item, binding.metadata.type, binding.metadata.purpose, binding.metadata.encoding));
        } else {
          temporaryRoot ??= await mkdtemp(join(tmpdir(), 'llm-request-parameter-files-'));
          files.push(await createContentFile(temporaryRoot, item, binding.metadata, binding.array === true ? index : undefined));
        }
      }
    }
    return {
      files,
      ...(temporaryRoot === undefined ? {} : { temporaryRoot }),
    };
  } catch (error) {
    if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}
