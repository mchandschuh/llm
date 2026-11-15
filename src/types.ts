export const REQUEST_SCHEMA = 'https://schemas.handschuh.dev/llm/request/v1' as const;
export const RESPONSE_SCHEMA = 'https://schemas.handschuh.dev/llm/response/v1' as const;
export const TOOL_DEFINITION_SCHEMA = 'https://schemas.handschuh.dev/llm/tool-definition/v1' as const;
export const TOOL_CALL_SCHEMA = 'https://schemas.handschuh.dev/llm/tool-call/v1' as const;
export const PARALLEL_TOOL_CALL_BATCH_SCHEMA = 'https://schemas.handschuh.dev/llm/parallel-tool-call-batch/v1' as const;
export const TOOL_CALLS_SCHEMA = 'https://schemas.handschuh.dev/llm/tool-calls/v1' as const;
export const TOOL_RESULT_SCHEMA = 'https://schemas.handschuh.dev/llm/tool-result/v1' as const;

export type Thinking = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type FileEncoding = 'utf8' | 'base64';

export interface Credentials {
  readonly apiKey?: string;
  readonly accessToken?: string;
}

export interface ReferenceFile {
  readonly name: string;
  readonly path: string;
  readonly type: string;
  readonly purpose: string;
  readonly encoding?: FileEncoding;
}

export type JsonObject = Readonly<Record<string, unknown>>;
export type TaskValue = string | JsonObject;
export type InlineJsonSchema = JsonObject;

export interface LlmRequest {
  readonly schema: typeof REQUEST_SCHEMA;
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: Thinking;
  readonly maxFailedAttempts?: number;
  readonly maxIterations?: number;
  readonly credentials?: Credentials;
  readonly task: TaskValue;
  readonly systemPrompt: string;
  readonly taskSchema?: InlineJsonSchema;
  readonly files?: readonly ReferenceFile[];
  readonly outputSchema?: InlineJsonSchema;
  readonly toolOptions?: ToolOptions;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: string;
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type ParallelToolCallBatch = readonly ToolCall[];
export type ToolCalls = readonly ParallelToolCallBatch[];

export interface ToolResult {
  readonly callId: string;
  readonly name: string;
  readonly status: 'success' | 'error';
  readonly value?: unknown;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface ToolOptions {
  readonly tools?: readonly ToolDefinition[];
  readonly autoInvoke?: boolean;
  readonly maxRounds?: number;
  readonly maxCalls?: number;
}

export interface ResolvedSource {
  readonly value: string;
  readonly path?: string;
}

export interface NormalizedRequest {
  readonly schema: typeof REQUEST_SCHEMA;
  readonly provider: string;
  readonly model: string;
  readonly thinking: Thinking;
  readonly maxFailedAttempts: number;
  readonly maxIterations: number;
  readonly credentials?: Credentials;
  readonly task: TaskValue;
  readonly systemPrompt: ResolvedSource;
  readonly taskSchema?: InlineJsonSchema;
  readonly files: readonly (ReferenceFile & { readonly encoding: FileEncoding; readonly content: string; readonly resolvedPath: string })[];
  readonly outputSchema?: InlineJsonSchema;
  readonly toolOptions?: NormalizedToolOptions;
  readonly configurationRoot: string;
}

export interface NormalizedToolOptions {
  readonly tools: readonly ToolDefinition[];
  readonly autoInvoke: boolean;
  readonly maxRounds: number;
  readonly maxCalls: number;
}

export interface ProviderCompletionRequestBase {
  readonly provider: string;
  readonly model: string;
  readonly thinking: Thinking;
  readonly systemPrompt: string;
  readonly llmPrompt: string;
  readonly files: readonly (ReferenceFile & { readonly encoding: FileEncoding; readonly content: string; readonly resolvedPath: string })[];
  readonly credentials?: Credentials;
  readonly signal?: AbortSignal;
}

export interface ProviderCompletionRequest extends ProviderCompletionRequestBase {
  readonly toolOptions?: NormalizedToolOptions;
  readonly toolResults?: readonly ToolResult[];
}

export type ProviderCompletionDecision = 'continue' | 'stop';

export interface ProviderCompletionResponse {
  readonly content: string | null;
  readonly toolCalls: ToolCalls;
  readonly decision: ProviderCompletionDecision;
}

export interface LlmProvider {
  complete(request: ProviderCompletionRequest): Promise<ProviderCompletionResponse>;
}

export interface ToolInvocationContext {
  readonly callId: string;
  readonly toolName: string;
  readonly round: number;
  readonly batchIndex: number;
  readonly signal: AbortSignal;
}

export interface ToolInvoker {
  invoke(call: ToolCall, context: ToolInvocationContext): Promise<unknown>;
}

export interface SchemaMetadata {
  readonly name: string;
  readonly path?: string;
}

export interface StructuredOutput {
  readonly $type: string;
  readonly schema: SchemaMetadata;
  readonly value: unknown;
}

export interface RawOutput {
  readonly $type: 'string';
  readonly schema: null | string;
  readonly value: string;
}

export type LlmOutput = StructuredOutput | RawOutput;

export interface ToolAwareOutput {
  readonly $type: 'object';
  readonly schema: SchemaMetadata;
  readonly value: {
    readonly output: unknown;
    readonly tool_calls: ToolCalls;
  };
}

export type ResponseStatus =
  | 'success'
  | 'cancelled'
  | 'tool_calls_pending'
  | 'tool_rounds_exhausted'
  | 'tool_invocation_error'
  | 'input_invalid'
  | 'configuration_error'
  | 'provider_error'
  | 'output_invalid'
  | 'attempts_exhausted'
  | 'unvalidated';

export type ErrorCode =
  | 'REQUEST_INVALID'
  | 'TASK_SCHEMA_VALIDATION_FAILED'
  | 'SOURCE_RESOLUTION_FAILED'
  | 'CONFIGURATION_INVALID'
  | 'PROVIDER_REQUEST_FAILED'
  | 'OUTPUT_JSON_INVALID'
  | 'OUTPUT_SCHEMA_VALIDATION_FAILED'
  | 'ATTEMPTS_EXHAUSTED'
  | 'OUTPUT_INVALID'
  | 'TOOL_CALL_INVALID'
  | 'TOOL_SCHEMA_INVALID'
  | 'TOOL_SCHEMA_VALIDATION_FAILED'
  | 'TOOL_RESULT_INVALID'
  | 'CANCELLED';

export type ErrorPhase =
  | 'request'
  | 'configuration'
  | 'source-resolution'
  | 'provider'
  | 'output-parsing'
  | 'output-validation'
  | 'tool-validation'
  | 'tool-invocation'
  | 'cancellation'
  | 'retry';

export interface LlmError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly phase: ErrorPhase;
}

export interface LlmResponse {
  readonly schema: typeof RESPONSE_SCHEMA;
  readonly status: ResponseStatus;
  readonly output: LlmOutput | null;
  readonly failedAttempts: number;
  readonly iterations: number;
  readonly toolRounds: number;
  readonly toolCalls: number;
  readonly toolResults: readonly ToolResult[];
  readonly errors: readonly LlmError[];
}

/**
 * High-level completion service boundary for consumers such as sdlc.
 *
 * The lower-level LlmProvider above remains the raw provider-adapter seam used
 * by this package. Consumers should depend on this contract when they need the
 * normalized request and closed response envelope.
 */
export interface ILlmProvider {
  complete(request: LlmRequest, options?: CompletionOptions): Promise<LlmResponse>;
}

export interface CompletionOptions {
  readonly provider?: LlmProvider;
  readonly configurationFilePath?: string;
  readonly configurationRoot?: string;
  readonly debug?: import('./debug.js').DebugSink;
  readonly toolInvoker?: ToolInvoker;
  readonly signal?: AbortSignal;
}

export type AnyLlmRequest = LlmRequest;
export type AnyLlmResponse = LlmResponse;
export type AnyCompletionOptions = CompletionOptions;

export interface PromptParts {
  readonly task: string;
  readonly taskSchema?: string;
  readonly files: readonly (ReferenceFile & { readonly content: string })[];
  readonly outputSchema?: string;
}
