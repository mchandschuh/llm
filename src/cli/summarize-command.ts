import { lstat, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { complete } from '../complete.js';
import { LlmFailure } from '../errors.js';
import { resolveRequestsDirectory, type RequestsDirectoryResolutionOptions } from '../requests-config.js';
import { parseSchema } from '../schema.js';
import { REQUEST_SCHEMA, type LlmOutput, type LlmProvider, type LlmRequest, type ReferenceFile, type Thinking } from '../types.js';
import { debugSink, printResponse, type OutputWriter } from './output.js';
import type { ResponseFormat } from './arguments.js';
import { readSummarizeSettings, resolveSummarizeSettings } from './summarize-settings.js';

const SUMMARIZE_DIRECTORY = 'summarize';
const PROMPT_FILE = 'summarize.prompt.md';
const OUTPUT_SCHEMA_FILE = 'summarize.outputSchema.json';
const CONTENT_FILE = 'content';

export interface SummarizeCommandOptions extends RequestsDirectoryResolutionOptions {
  readonly path?: string;
  readonly content?: string;
  readonly debug: boolean;
  readonly format?: ResponseFormat;
  readonly requestDirectory?: string;
  readonly provider?: LlmProvider;
  readonly providerName?: string;
  readonly model?: string;
  readonly thinking?: Thinking;
  readonly write?: OutputWriter;
  readonly writeError?: OutputWriter;
}

interface PreparedRequest {
  readonly request: LlmRequest;
  readonly configurationRoot: string;
  readonly temporaryRoot?: string;
}

interface PreparedSource {
  readonly files: readonly ReferenceFile[];
  readonly configurationRoot: string;
  readonly temporaryRoot?: string;
}

function assetPath(requestDirectory: string, name: string): string {
  return resolve(requestDirectory, SUMMARIZE_DIRECTORY, name);
}

async function readRequestAssets(requestDirectory: string): Promise<{ readonly prompt: string; readonly outputSchema: Record<string, unknown>; readonly settings: ReturnType<typeof resolveSummarizeSettings> }> {
  const prompt = await readFile(assetPath(requestDirectory, PROMPT_FILE), 'utf8');
  const settings = resolveSummarizeSettings(await readSummarizeSettings(requestDirectory));
  let outputSchema: unknown;
  try {
    outputSchema = JSON.parse(await readFile(assetPath(requestDirectory, OUTPUT_SCHEMA_FILE), 'utf8')) as unknown;
  } catch {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'The llm summarize output schema could not be read or parsed.');
  }
  if (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'The llm summarize output schema must be a JSON object.');
  }
  parseSchema(outputSchema as Record<string, unknown>, assetPath(requestDirectory, OUTPUT_SCHEMA_FILE));
  return { prompt, outputSchema: outputSchema as Record<string, unknown>, settings };
}

function sourceFile(relativePath: string): ReferenceFile {
  return {
    name: relativePath.split(sep).join('__'),
    path: relativePath,
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
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(root, absolutePath);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (entry.isSymbolicLink()) {
        try {
          if ((await stat(absolutePath)).isFile()) paths.push(relativePath);
        } catch {
          // Broken links and links to inaccessible targets are not request files.
        }
        continue;
      }
      if (entry.isFile()) paths.push(relativePath);
    }
  }
  await visit(root);
  return paths.sort((left, right) => left < right ? -1 : left > right ? 1 : 0).map(sourceFile);
}

async function prepareSource(options: SummarizeCommandOptions): Promise<PreparedSource> {
  if (options.path !== undefined) {
    const absolutePath = resolve(process.cwd(), options.path);
    const info = await lstat(absolutePath);
    if (info.isSymbolicLink()) {
      if (!(await stat(absolutePath)).isFile()) throw new LlmFailure('SOURCE_RESOLUTION_FAILED', 'source-resolution', 'Configured sources must be regular files.');
      return { files: [sourceFile(basename(absolutePath))], configurationRoot: dirname(absolutePath) };
    }
    if (info.isDirectory()) return { files: await collectDirectoryFiles(absolutePath), configurationRoot: absolutePath };
    if (!info.isFile()) throw new LlmFailure('SOURCE_RESOLUTION_FAILED', 'source-resolution', 'Configured sources must be regular files.');
    return {
      files: [sourceFile(basename(absolutePath))],
      configurationRoot: dirname(absolutePath),
    };
  }
  if (options.content !== undefined) {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), 'llm-summarize-'));
    try {
      await writeFile(resolve(temporaryRoot, CONTENT_FILE), options.content, 'utf8');
    } catch (error) {
      await rm(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
    return {
      files: [{
        name: CONTENT_FILE,
        path: CONTENT_FILE,
        type: 'text/plain',
        purpose: 'Content supplied by the --content command-line option; this is not a filesystem file.',
      }],
      configurationRoot: temporaryRoot,
      temporaryRoot,
    };
  }
  throw new LlmFailure('REQUEST_INVALID', 'request', 'Exactly one of --path or --content is required.');
}

function rawSummary(output: LlmOutput | null): string | undefined {
  if (!output) return undefined;
  if (typeof output.value === 'string') return output.value;
  if (output.value && typeof output.value === 'object' && !Array.isArray(output.value) && 'summary' in output.value) {
    const summary = (output.value as { readonly summary?: unknown }).summary;
    if (typeof summary === 'string') return summary;
  }
  return undefined;
}

export async function buildSummarizeRequest(options: Pick<SummarizeCommandOptions, 'path' | 'content' | 'providerName' | 'model' | 'thinking'> & { readonly requestDirectory: string }): Promise<PreparedRequest> {
  const assets = await readRequestAssets(options.requestDirectory);
  const source = await prepareSource(options as SummarizeCommandOptions);
  const settings = resolveSummarizeSettings(assets.settings, { provider: options.providerName, model: options.model, thinking: options.thinking });
  return {
    request: {
      schema: REQUEST_SCHEMA,
      provider: settings.provider,
      model: settings.model,
      thinking: settings.thinking,
      task: 'Summarize the content of all supplied files.',
      systemPrompt: null,
      files: source.files,
      outputSchema: assets.outputSchema,
    },
    configurationRoot: source.configurationRoot,
    ...(source.temporaryRoot ? { temporaryRoot: source.temporaryRoot } : {}),
  };
}

export async function runSummarizeCommand(options: SummarizeCommandOptions): Promise<number> {
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(`${text}\n`));
  let temporaryRoot: string | undefined;
  try {
    const requestDirectory = options.requestDirectory ?? await resolveRequestsDirectory(options);
    const prepared = await buildSummarizeRequest({ path: options.path, content: options.content, providerName: options.providerName, model: options.model, thinking: options.thinking, requestDirectory });
    temporaryRoot = prepared.temporaryRoot;
    const result = await complete(prepared.request, {
      configurationRoot: prepared.configurationRoot,
      allowFinalSymlinkFiles: options.path !== undefined,
      debug: debugSink(options.debug),
      provider: options.provider,
    });
    return printResponse(result, options.format ?? 'raw', rawSummary(result.output), options.write, options.writeError);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The llm summarize command could not be completed.';
    writeError(JSON.stringify({ status: 'configuration_error', errors: [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message }] }));
    return 1;
  } finally {
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}