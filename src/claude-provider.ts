import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, isAbsolute, join, resolve } from 'node:path';
import { boundedMessage, LlmFailure } from './errors.js';
import { DEFAULT_SYSTEM_PROMPT } from './normalize.js';
import type {
  InlineJsonSchema,
  LlmChatMessage,
  LlmProvider,
  ProviderCompletionRequest,
  ProviderCompletionResponse,
  ProviderValidationResult,
  Thinking,
  ToolCall,
  ToolDefinition,
} from './types.js';

/** Environment variable that overrides the Claude Code executable (default: `claude` on PATH). */
export const CLAUDE_EXECUTABLE_ENV = 'LLM_CLAUDE_EXECUTABLE';

/** Positional prompt; the request itself is written to stdin, as in `cat request | claude -p "<instruction>"`. */
export const CLAUDE_INSTRUCTION = 'Complete the request provided on standard input. Follow its instructions and reply only as it specifies.';

/** Claude Code caps piped stdin at 10 MB. */
export const CLAUDE_MAX_STDIN_BYTES = 10 * 1024 * 1024;

/** Environment variable that overrides the per-completion timeout in milliseconds. */
export const CLAUDE_TIMEOUT_ENV = 'LLM_CLAUDE_TIMEOUT_MS';

/** Default per-completion timeout, so a stalled CLI cannot hang a completion forever. */
export const CLAUDE_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/** Grace period between SIGTERM and SIGKILL when the process must be stopped. */
const KILL_GRACE_MS = 5000;

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

const EFFORT: Readonly<Record<Thinking, string>> = { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh' };

export interface ClaudeProviderOptions {
  /** Executable name or path; defaults to `LLM_CLAUDE_EXECUTABLE`, then `claude` on PATH. */
  readonly executable?: string;
  /** Environment for executable resolution and the child process; defaults to `process.env`. */
  readonly environment?: NodeJS.ProcessEnv;
  /** Per-completion timeout in milliseconds; defaults to `LLM_CLAUDE_TIMEOUT_MS`, then 10 minutes. */
  readonly timeoutMs?: number;
}

/** The JSON result envelope printed by `claude -p --output-format json`. Only the members this adapter reads. */
interface ClaudeResultEnvelope {
  readonly subtype?: unknown;
  readonly is_error?: unknown;
  readonly result?: unknown;
  readonly structured_output?: unknown;
}

function failure(message: string, cause?: unknown): LlmFailure {
  return new LlmFailure('PROVIDER_REQUEST_FAILED', 'provider', boundedMessage(message), cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve the Claude Code executable to an absolute path, or `undefined` when it cannot be found. */
export function resolveClaudeExecutable(options: ClaudeProviderOptions = {}): string | undefined {
  const environment = options.environment ?? process.env;
  const configured = options.executable ?? environment[CLAUDE_EXECUTABLE_ENV] ?? 'claude';
  if (configured.length === 0) return undefined;
  if (isAbsolute(configured) || configured.includes('/') || configured.includes('\\')) {
    const path = isAbsolute(configured) ? configured : resolve(configured);
    return isExecutableFile(path) ? path : undefined;
  }
  // On Windows a bare name is found through PATHEXT (claude.exe). Shell shims such as claude.cmd are not
  // spawned, because that would need a shell; point LLM_CLAUDE_EXECUTABLE at claude.exe instead.
  const extensions = process.platform === 'win32'
    ? ['', ...(environment.PATHEXT ?? '.EXE').split(';').filter((extension) => extension && extension.toUpperCase() !== '.CMD' && extension.toUpperCase() !== '.BAT')]
    : [''];
  for (const directory of (environment.PATH ?? environment.Path ?? '').split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${configured}${extension}`);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function timeoutFor(options: ClaudeProviderOptions): number {
  const configured = options.timeoutMs ?? Number((options.environment ?? process.env)[CLAUDE_TIMEOUT_ENV] ?? CLAUDE_DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(configured) || configured <= 0) {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', `${CLAUDE_TIMEOUT_ENV} must be a positive integer number of milliseconds.`);
  }
  return configured;
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

function attribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function parseToolInputSchema(tool: ToolDefinition): InlineJsonSchema {
  let parsed: unknown;
  try {
    parsed = JSON.parse(tool.inputSchema);
  } catch {
    throw new LlmFailure('TOOL_SCHEMA_INVALID', 'configuration', `Tool '${tool.name}' inputSchema must be valid JSON.`);
  }
  if (!isRecord(parsed)) throw new LlmFailure('TOOL_SCHEMA_INVALID', 'configuration', `Tool '${tool.name}' inputSchema must be a JSON Schema object.`);
  return parsed;
}

function tools(request: ProviderCompletionRequest): readonly ToolDefinition[] {
  return request.toolOptions?.tools ?? [];
}

/** System prompt: chat system messages when present, otherwise the request system prompt, otherwise the default. */
function systemPrompt(request: ProviderCompletionRequest): string {
  const fromMessages = request.messages.filter((message) => message.role === 'system').map((message) => message.content);
  if (request.messages.length > 0 && fromMessages.length > 0) return fromMessages.join('\n\n');
  return request.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
}

function renderMessage(message: Exclude<LlmChatMessage, { role: 'system' }>): string {
  if (message.role === 'user') return `  <message role="user">${cdata(message.content)}</message>`;
  if (message.role === 'tool') return `  <message role="tool" toolCallId="${attribute(message.toolCallId)}">${cdata(message.content)}</message>`;
  const calls = message.toolCalls.length === 0 ? '' : `<toolCalls>${cdata(JSON.stringify(message.toolCalls))}</toolCalls>`;
  return `  <message role="assistant"><content>${cdata(message.content ?? '')}</content>${calls}</message>`;
}

/** Turns after the first user message, whose content `llmPrompt` already carries. */
function laterTurns(request: ProviderCompletionRequest): readonly Exclude<LlmChatMessage, { role: 'system' }>[] {
  const first = request.messages.findIndex((message) => message.role === 'user');
  if (first === -1) return [];
  return request.messages.slice(first + 1).filter((message): message is Exclude<LlmChatMessage, { role: 'system' }> => message.role !== 'system');
}

const TOOL_INSTRUCTIONS = [
  'You may call the tools listed in <tools>. Reply with the structured output only.',
  'To call tools, set "decision" to "continue" and list "toolCalls". Each call needs a unique "id", a "name" from <tools>, and "arguments" that satisfy that tool\'s inputSchema.',
  'Tool results arrive in later turns as <message role="tool"> or in <toolResults>.',
  'When no further tool calls are needed, set "decision" to "stop" and put the final answer in "output".',
].join('\n');

/** The stdin document: the shared llmPrompt followed by turn history, tool definitions, and tool results. */
export function projectClaudePrompt(request: ProviderCompletionRequest): string {
  const sections = [request.llmPrompt];
  const turns = laterTurns(request);
  if (turns.length > 0) sections.push(`<conversation>\n${turns.map(renderMessage).join('\n')}\n</conversation>`);
  if (request.toolOptions !== undefined) {
    const definitions = tools(request).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: parseToolInputSchema(tool) }));
    sections.push(`<tools>${cdata(JSON.stringify(definitions))}</tools>`);
    // Like the OpenRouter projection, toolResults are replayed only when there is no message history to carry them.
    if (request.messages.length === 0 && (request.toolResults ?? []).length > 0) sections.push(`<toolResults>${cdata(JSON.stringify(request.toolResults))}</toolResults>`);
    sections.push(`<responseInstructions>${cdata(TOOL_INSTRUCTIONS)}</responseInstructions>`);
  }
  return sections.join('\n\n');
}

function isObjectRoot(schema: InlineJsonSchema): boolean {
  return schema.type === 'object';
}

/**
 * Rewrite local JSON-pointer refs (`#`, `#/...`) so a schema keeps resolving
 * after it is moved to `#/$defs/<key>` of a new root document.
 */
function relocateRefs(value: unknown, base: string): unknown {
  if (Array.isArray(value)) return value.map((item) => relocateRefs(item, base));
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (key === '$ref' && typeof child === 'string' && (child === '#' || child.startsWith('#/'))) return [key, `${base}${child.slice(1)}`];
    return [key, relocateRefs(child, base)];
  }));
}

/**
 * Collects caller schemas embedded in a generated `--json-schema` document.
 * Each one moves to `#/$defs/<key>`: local refs are rewritten to the new
 * location, while a schema with its own `$id` is its own resource and is kept
 * as is. `$schema` is dropped from embedded copies because it is only valid at
 * a resource root.
 */
class EmbeddedSchemas {
  private readonly definitions: Record<string, unknown> = {};

  embed(key: string, schema: InlineJsonSchema): InlineJsonSchema {
    const { $schema: _dialect, ...rest } = schema;
    this.definitions[key] = typeof schema.$id === 'string' ? schema : relocateRefs(rest, `#/$defs/${key}`);
    return { $ref: `#/$defs/${key}` };
  }

  root(schema: InlineJsonSchema): InlineJsonSchema {
    return Object.keys(this.definitions).length === 0 ? schema : { ...schema, $defs: this.definitions };
  }
}

/** The schema passed as `--json-schema`, and how to turn `structured_output` back into a response. */
interface ResponseShape {
  readonly schema?: InlineJsonSchema;
  readonly read: (envelope: ClaudeResultEnvelope) => ProviderCompletionResponse;
}

function structuredOutput(envelope: ClaudeResultEnvelope): unknown {
  if (!Object.hasOwn(envelope, 'structured_output') || envelope.structured_output === undefined || envelope.structured_output === null) {
    throw failure('The claude CLI returned no structured output that satisfies the requested schema.');
  }
  return envelope.structured_output;
}

function finalContent(output: unknown, outputSchema: InlineJsonSchema | undefined): string {
  if (outputSchema !== undefined) return JSON.stringify(output);
  if (typeof output !== 'string') throw failure('The claude CLI returned a non-text final output.');
  return output;
}

function toolCallInvalid(message: string): LlmFailure {
  return new LlmFailure('TOOL_CALL_INVALID', 'provider', message);
}

/**
 * The tool envelope keeps a flat object root (no root-level composition) and
 * uses only widely supported keywords; the stop/continue combination rules are
 * enforced when the reply is read.
 */
function toolShape(request: ProviderCompletionRequest): ResponseShape {
  const outputSchema = request.outputSchema;
  const definitions = tools(request);
  const embedded = new EmbeddedSchemas();
  const output = outputSchema === undefined ? { type: 'string' } : embedded.embed('output', outputSchema);
  const callSchemas = definitions.map((tool, index) => ({
    type: 'object',
    additionalProperties: false,
    required: ['id', 'name', 'arguments'],
    properties: {
      id: { type: 'string' },
      name: { const: tool.name },
      arguments: embedded.embed(`tool${index}`, parseToolInputSchema(tool)),
    },
  }));
  const properties: Record<string, unknown> = {
    decision: { type: 'string', enum: definitions.length > 0 ? ['stop', 'continue'] : ['stop'] },
    output,
  };
  if (definitions.length > 0) properties.toolCalls = { type: 'array', items: { anyOf: callSchemas } };
  return {
    schema: embedded.root({ type: 'object', additionalProperties: false, required: ['decision'], properties }),
    read(envelope) {
      const value = structuredOutput(envelope);
      if (!isRecord(value)) throw toolCallInvalid('The claude CLI returned a tool envelope that is not an object.');
      if (value.decision === 'stop') {
        if (!Object.hasOwn(value, 'output')) throw failure('The claude CLI returned a stop decision without output.');
        return { content: finalContent(value.output, outputSchema), toolCalls: [], decision: 'stop' };
      }
      if (value.decision !== 'continue' || !Array.isArray(value.toolCalls) || value.toolCalls.length === 0) {
        throw toolCallInvalid('The claude CLI returned an invalid tool-call envelope.');
      }
      const known = new Set(definitions.map((tool) => tool.name));
      const calls: ToolCall[] = value.toolCalls.map((call: unknown) => {
        if (!isRecord(call) || typeof call.id !== 'string' || call.id.length === 0 || typeof call.name !== 'string' || !known.has(call.name) || !isRecord(call.arguments)) {
          throw toolCallInvalid('The claude CLI returned an incomplete tool call.');
        }
        return { id: call.id, name: call.name, arguments: call.arguments };
      });
      return { content: null, toolCalls: [calls], decision: 'continue' };
    },
  };
}

function responseShape(request: ProviderCompletionRequest): ResponseShape {
  const outputSchema = request.outputSchema;
  if (request.toolOptions !== undefined) return toolShape(request);
  if (outputSchema === undefined) {
    return {
      read(envelope) {
        if (typeof envelope.result !== 'string') throw failure('The claude CLI returned no text result.');
        return { content: envelope.result, toolCalls: [], decision: 'stop' };
      },
    };
  }
  if (isObjectRoot(outputSchema)) {
    return { schema: outputSchema, read: (envelope) => ({ content: JSON.stringify(structuredOutput(envelope)), toolCalls: [], decision: 'stop' }) };
  }
  // Structured output needs an object root; wrap other schemas and unwrap the value.
  const embedded = new EmbeddedSchemas();
  return {
    schema: embedded.root({ type: 'object', additionalProperties: false, required: ['value'], properties: { value: embedded.embed('value', outputSchema) } }),
    read(envelope) {
      const value = structuredOutput(envelope);
      if (!isRecord(value) || !Object.hasOwn(value, 'value')) throw failure('The claude CLI returned structured output without the wrapped value.');
      return { content: JSON.stringify(value.value), toolCalls: [], decision: 'stop' };
    },
  };
}

/** Command-line arguments for one completion. The positional instruction comes first because tool flags are variadic. */
export function claudeArguments(request: ProviderCompletionRequest, schema?: InlineJsonSchema): readonly string[] {
  return [
    '-p', CLAUDE_INSTRUCTION,
    '--output-format', 'json',
    '--model', request.model,
    '--effort', EFFORT[request.thinking] ?? 'high',
    '--system-prompt', systemPrompt(request),
    '--safe-mode',
    '--tools', '',
    '--strict-mcp-config',
    '--disallowedTools', 'mcp__*',
    '--no-session-persistence',
    ...(schema === undefined ? [] : ['--json-schema', JSON.stringify(schema)]),
  ];
}

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

function abortError(): Error {
  const error = new Error('The claude request was cancelled.');
  error.name = 'AbortError';
  return error;
}

function run(executable: string, args: readonly string[], input: string, request: ProviderCompletionRequest, environment: NodeJS.ProcessEnv, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    if (request.signal?.aborted) {
      reject(abortError());
      return;
    }
    const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], env: environment, signal: request.signal });
    let killTimer: NodeJS.Timeout | undefined;
    let timedOut = false;
    // SIGTERM first; escalate to SIGKILL if the process ignores it.
    const stop = (): void => {
      if (killTimer !== undefined) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    timeout.unref();
    request.signal?.addEventListener('abort', stop, { once: true });
    const settle = (): void => {
      clearTimeout(timeout);
      if (killTimer !== undefined) clearTimeout(killTimer);
      request.signal?.removeEventListener('abort', stop);
    };
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        overflow = true;
        stop();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes < MAX_STDERR_BYTES) stderr.push(chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes));
      stderrBytes += chunk.length;
    });
    child.on('error', (error) => {
      settle();
      reject(error.name === 'AbortError' || request.signal?.aborted ? abortError() : failure('The claude CLI could not be started.', error));
    });
    child.on('close', (code, signal) => {
      settle();
      if (request.signal?.aborted) return reject(abortError());
      if (timedOut) return reject(failure(`The claude CLI did not finish within ${timeoutMs} ms.`));
      if (overflow) return reject(failure('The claude CLI output exceeded the 32 MiB limit.'));
      resolvePromise({ code, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.on('error', () => {
      // A child that exits before reading stdin is reported through its exit status.
    });
    child.stdin.end(input);
  });
}

function parseEnvelope(result: ProcessResult): ClaudeResultEnvelope {
  let envelope: unknown;
  try {
    envelope = JSON.parse(result.stdout.trim());
  } catch {
    const detail = result.stderr.trim() || result.stdout.trim();
    if (result.code !== 0) throw failure(`The claude CLI exited with ${result.code ?? result.signal}${detail ? `: ${detail}` : '.'}`);
    throw failure('The claude CLI returned an invalid JSON result envelope.');
  }
  if (!isRecord(envelope)) throw failure('The claude CLI returned an invalid JSON result envelope.');
  const subtype = typeof envelope.subtype === 'string' ? envelope.subtype : undefined;
  if (envelope.is_error === true || subtype?.startsWith('error') === true || result.code !== 0) {
    const detail = typeof envelope.result === 'string' && envelope.result ? `: ${envelope.result}` : '.';
    throw failure(`The claude CLI reported ${subtype ?? `exit status ${result.code ?? result.signal}`}${detail}`);
  }
  return envelope;
}

/**
 * Runs completions through the Claude Code CLI (`claude -p`).
 *
 * Each completion starts one non-interactive process with JSON output, a
 * replaced system prompt, `--safe-mode` (no CLAUDE.md, hooks, plugins, skills,
 * MCP servers, or auto memory), no built-in or MCP tools, and no persisted
 * session. The request is written to stdin. Structured output and tool calling
 * use `--json-schema`. Authentication is whatever the installed CLI is
 * signed in with.
 */
export class ClaudeProvider implements LlmProvider {
  private readonly options: ClaudeProviderOptions;

  constructor(options: ClaudeProviderOptions = {}) {
    this.options = options;
  }

  validate(): ProviderValidationResult {
    if (resolveClaudeExecutable(this.options) !== undefined) return { success: true, errors: [] };
    return {
      success: false,
      errors: [{
        code: 'CONFIGURATION_INVALID',
        phase: 'configuration',
        message: `The claude provider requires the Claude Code CLI on PATH or an executable path in ${CLAUDE_EXECUTABLE_ENV}.`,
      }],
    };
  }

  async complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse> {
    const executable = resolveClaudeExecutable(this.options);
    if (executable === undefined) throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', this.validate().errors[0]!.message);
    if (request.files.some((file) => file.encoding === 'base64' && file.type.startsWith('image/'))) {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'The claude provider does not support image attachments; use the openrouter provider for image files.');
    }
    const input = projectClaudePrompt(request);
    if (Buffer.byteLength(input, 'utf8') > CLAUDE_MAX_STDIN_BYTES) {
      throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', 'The request exceeds the 10 MB stdin limit of the claude CLI.');
    }
    const shape = responseShape(request);
    const result = await run(executable, claudeArguments(request, shape.schema), input, request, this.options.environment ?? process.env, timeoutFor(this.options));
    return shape.read(parseEnvelope(result));
  }
}
