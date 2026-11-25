import { lstat, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { completeRequest } from '../request.js';
import { constructRequestParameters, type RequestParameterAssignment } from '../request-parameters.js';
import { resolveRequestsDirectory } from '../requests-config.js';
import { loadRequestDirectory } from '../request-directory.js';
import { boundedMessage } from '../errors.js';
import { RESPONSE_SCHEMA, type LlmResponse, type LlmProvider, type ReferenceFile } from '../types.js';
import { debugSink, printResponse, type OutputWriter } from './output.js';
import type { ResponseFormat } from './arguments.js';

export interface RequestCommandOptions {
  readonly requestName: string;
  readonly parameters?: string;
  readonly assignments?: readonly RequestParameterAssignment[];
  readonly sourcePath?: string;
  readonly sourceContent?: string;
  readonly debug: boolean;
  readonly format?: ResponseFormat;
  readonly provider?: LlmProvider;
  readonly write?: OutputWriter;
  readonly writeError?: OutputWriter;
}

interface PreparedFiles {
  readonly files?: readonly ReferenceFile[];
  readonly temporaryRoot?: string;
}

function sourceFile(path: string, root?: string): ReferenceFile {
  const absolutePath = resolve(path);
  const relativePath = root === undefined ? undefined : relative(root, absolutePath);
  return {
    name: relativePath && !relativePath.startsWith('..') ? relativePath.split(sep).join('__') : basename(absolutePath),
    path: absolutePath,
    type: 'text/plain',
    purpose: 'Text file supplied by the --path command-line option.',
  };
}

async function collectDirectoryFiles(root: string): Promise<readonly ReferenceFile[]> {
  const paths: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isSymbolicLink()) {
        try {
          if ((await stat(path)).isFile()) paths.push(path);
        } catch {
          // Broken links and inaccessible targets are not additional input files.
        }
      } else if (entry.isFile()) {
        paths.push(path);
      }
    }
  }

  await visit(root);
  return paths.sort().map((path) => sourceFile(path, root));
}

async function prepareFiles(options: Pick<RequestCommandOptions, 'sourcePath' | 'sourceContent'>): Promise<PreparedFiles> {
  if (options.sourcePath !== undefined) {
    const path = resolve(process.cwd(), options.sourcePath);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      if (!(await stat(path)).isFile()) throw new Error('Configured --path input must resolve to a regular file or directory.');
      return { files: [sourceFile(path)] };
    }
    if (info.isDirectory()) return { files: await collectDirectoryFiles(path) };
    if (!info.isFile()) throw new Error('Configured --path input must be a regular file or directory.');
    return { files: [sourceFile(path)] };
  }
  if (options.sourceContent !== undefined) {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'llm-request-'));
    try {
      const path = join(temporaryRoot, 'content');
      await writeFile(path, options.sourceContent, 'utf8');
      return {
        files: [{ name: 'content', path, type: 'text/plain', purpose: 'Content supplied by the --content command-line option.' }],
        temporaryRoot,
      };
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }
  return {};
}

function responseFromProvider(content: string | null): LlmResponse {
  return {
    schema: RESPONSE_SCHEMA,
    status: 'success',
    output: { $type: 'string', schema: null, value: content ?? '' },
    failedAttempts: 0,
    iterations: 1,
    toolRounds: 0,
    toolCalls: 0,
    toolResults: [],
    errors: [],
  };
}

export async function runRequestCommand(options: RequestCommandOptions): Promise<number> {
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(`${text}\n`));
  let temporaryRoot: string | undefined;
  try {
    const requestsDirectory = await resolveRequestsDirectory();
    const loaded = await loadRequestDirectory(requestsDirectory, options.requestName);
    const defaults = loaded.assets.defaults?.value.parameters;
    const parameters = constructRequestParameters({
      schema: loaded.assets.parametersSchema?.value,
      schemaPath: loaded.assets.parametersSchema?.path,
      defaults: defaults && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults as Record<string, unknown> : undefined,
      parameters: options.parameters,
      assignments: options.assignments,
      schemaRoots: [requestsDirectory],
    });
    const preparedFiles = await prepareFiles(options);
    temporaryRoot = preparedFiles.temporaryRoot;
    const result = await completeRequest({
      requestName: options.requestName,
      parameters,
      files: preparedFiles.files,
      debug: debugSink(options.debug),
      provider: options.provider,
    });
    return printResponse(responseFromProvider(result.content), options.format ?? 'raw', result.content ?? '', options.write, writeError);
  } catch (error) {
    const message = boundedMessage(error instanceof Error ? error.message : 'The llm req command could not be completed.');
    writeError(`${JSON.stringify({ status: 'configuration_error', errors: [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message }] })}\n`);
    return 1;
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}