import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { LlmFailure } from './errors.js';
import type { FileEncoding, ResolvedSource } from './types.js';

const FORBIDDEN_NAME = /^(?:\.env(?:\..*)?|credentials|secrets)$/i;
const MIME_TYPE = /^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9!#$&^_.+-]+$/u;
const UTF8_MIME_TYPES = new Set([
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/rtf',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'text/css',
  'text/csv',
  'text/html',
  'text/javascript',
  'text/markdown',
  'text/plain',
  'text/xml',
]);

function sourceFailure(message: string): LlmFailure {
  return new LlmFailure('SOURCE_RESOLUTION_FAILED', 'source-resolution', message);
}

function hasForbiddenSegment(path: string): boolean {
  return path.split(/[\\/]/u).some((segment) => FORBIDDEN_NAME.test(segment));
}

function isTraversal(path: string): boolean {
  return path.split(/[\\/]/u).some((segment) => segment === '..');
}

function assertSafeCandidate(candidate: string): void {
  if (!candidate || isAbsolute(candidate) || isTraversal(candidate) || hasForbiddenSegment(candidate)) {
    throw sourceFailure('The configured source path is not permitted.');
  }
}

interface ResolvedCandidate {
  readonly path: string;
  readonly canonicalPath: string;
}

async function readCandidate(candidate: string, root: string): Promise<ResolvedCandidate | undefined> {
  assertSafeCandidate(candidate);
  const absolute = resolve(root, candidate);
  const relativeCandidate = relative(resolve(root), absolute);
  let current = resolve(root);
  for (const segment of relativeCandidate.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw sourceFailure('Symbolic-link sources are not permitted.');
    } catch (error) {
      if (error instanceof LlmFailure) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw sourceFailure('The configured source could not be inspected.');
    }
  }
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
    throw sourceFailure('The configured source could not be inspected.');
  }
  if (info.isSymbolicLink()) throw sourceFailure('Symbolic-link sources are not permitted.');
  if (!info.isFile()) throw sourceFailure('Configured sources must be regular files.');
  let canonicalRoot: string;
  let canonicalPath: string;
  try {
    [canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(absolute)]);
  } catch {
    throw sourceFailure('The configured source could not be resolved.');
  }
  const escaped = relative(canonicalRoot, canonicalPath).startsWith('..') || isAbsolute(relative(canonicalRoot, canonicalPath));
  if (escaped || hasForbiddenSegment(relative(canonicalRoot, canonicalPath))) throw sourceFailure('The configured source is outside the permitted root.');
  return { path: candidate, canonicalPath };
}

function assertMimeType(type: string): void {
  if (!MIME_TYPE.test(type)) throw sourceFailure('Reference file types must be valid MIME types.');
}

function imageSignatureMatches(type: string, bytes: Uint8Array): boolean {
  if (type === 'image/png') return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  if (type === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === 'image/gif') return bytes.length >= 6 && /^(?:GIF87a|GIF89a)$/u.test(new TextDecoder().decode(bytes.subarray(0, 6)));
  if (type === 'image/webp') return bytes.length >= 12 && new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP';
  return true;
}

function encodingFor(type: string): FileEncoding {
  return type.startsWith('text/') || UTF8_MIME_TYPES.has(type) ? 'utf8' : 'base64';
}

async function readFileAttachment(candidate: string, type: string, encoding: FileEncoding | undefined, root: string): Promise<ResolvedSource & { readonly path: string; readonly encoding: FileEncoding }> {
  assertMimeType(type);
  const resolved = await readCandidate(candidate, root);
  if (!resolved?.path) throw sourceFailure('Configured reference files must resolve to regular files.');
  let bytes: Buffer;
  try {
    bytes = await readFile(resolved.canonicalPath);
  } catch {
    throw sourceFailure('The configured reference file is not readable.');
  }
  const selectedEncoding = encoding ?? encodingFor(type);
  if (type.startsWith('image/') && selectedEncoding !== 'base64') {
    throw sourceFailure('Image reference files must use base64 encoding.');
  }
  if (selectedEncoding === 'base64' && type.startsWith('image/') && !imageSignatureMatches(type, bytes)) {
    throw sourceFailure('The reference file content does not match its image MIME type.');
  }
  return {
    value: selectedEncoding === 'base64' ? bytes.toString('base64') : bytes.toString('utf8'),
    path: resolved.path,
    encoding: selectedEncoding,
  };
}

export async function resolveSource(source: string, root: string): Promise<ResolvedSource> {
  if (typeof source !== 'string' || source.length === 0) throw sourceFailure('Configured source values must be non-empty strings.');
  if (isAbsolute(source) || isTraversal(source) || hasForbiddenSegment(source)) assertSafeCandidate(source);
  const file = await readCandidate(source, root);
  if (!file) return { value: source };
  try {
    return { value: await readFile(file.canonicalPath, 'utf8'), path: file.path };
  } catch {
    throw sourceFailure('The configured source is not readable UTF-8 text.');
  }
}

export async function resolveRequiredFile(source: string, root: string, type = 'text/plain', encoding?: FileEncoding): Promise<ResolvedSource & { readonly path: string; readonly encoding: FileEncoding }> {
  return readFileAttachment(source, type, encoding, root);
}
