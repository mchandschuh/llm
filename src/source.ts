import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { LlmFailure } from './errors.js';
import type { ResolvedSource } from './types.js';

const FORBIDDEN_NAME = /^(?:\.env(?:\..*)?|credentials|secrets)$/i;

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

async function readCandidate(candidate: string, root: string): Promise<ResolvedSource | undefined> {
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
  let value: string;
  try {
    value = await readFile(canonicalPath, 'utf8');
  } catch {
    throw sourceFailure('The configured source is not readable UTF-8 text.');
  }
  return { value, path: candidate };
}

export async function resolveSource(source: string, root: string): Promise<ResolvedSource> {
  if (typeof source !== 'string' || source.length === 0) throw sourceFailure('Configured source values must be non-empty strings.');
  if (isAbsolute(source) || isTraversal(source) || hasForbiddenSegment(source)) assertSafeCandidate(source);
  const file = await readCandidate(source, root);
  return file ?? { value: source };
}

export async function resolveRequiredFile(source: string, root: string): Promise<ResolvedSource & { readonly path: string }> {
  const resolved = await readCandidate(source, root);
  if (!resolved?.path) throw sourceFailure('Configured reference files must resolve to regular files.');
  return resolved as ResolvedSource & { readonly path: string };
}
