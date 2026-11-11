export const REQUEST_SCHEMA = 'https://schemas.handschuh.dev/llm/request/v1' as const;
export const RESPONSE_SCHEMA = 'https://schemas.handschuh.dev/llm/response/v1' as const;
export const REQUEST_SCHEMA_V2 = 'https://schemas.handschuh.dev/llm/request/v2' as const;
export const RESPONSE_SCHEMA_V2 = 'https://schemas.handschuh.dev/llm/response/v2' as const;
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

export interface LlmRequest {
  readonly schema: typeof REQUEST_SCHEMA;
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: Thinking;
  readonly maxFailedAttempts?: number;
  readonly maxIterations?: number;
  readonly credentials?: Credentials;
  readonly task: string;
  readonly systemPrompt: string;
  readonly taskSchema?: string;
  readonly files?: readonly ReferenceFile[];
  readonly outputSchema?: string;
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

export interface LlmRequestV2 {
  readonly schema: typeof REQUEST_SCHEMA_V2;
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: Thinking;
  readonly maxFailedAttempts?: number;
  readonly maxIterations?: number;
  readonly maxToolRounds?: number;
  readonly maxToolCalls?: number;
  readonly credentials?: Credentials;
  readonly task: string;
  readonly systemPrompt: string;
  readonly taskSchema?: string;
  readonly files?: readonly ReferenceFile[];
  readonly tools?: readonly ToolDefinition[];
  readonly autoInvokeTools?: boolean;
  readonly outputSchema?: string;
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
  readonly task: ResolvedSource;
  readonly systemPrompt: ResolvedSource;
  readonly taskSchema?: ResolvedSource;
  readonly files: readonly (ReferenceFile & { readonly encoding: FileEncoding; readonly content: string; readonly resolvedPath: string })[];
  readonly outputSchema?: ResolvedSource;
  readonly configurationRoot: string;
}

export interface NormalizedRequestV2 {
  readonly schema: typeof REQUEST_SCHEMA_V2;
  readonly provider: string;
  readonly model: string;
  readonly thinking: Thinking;
  readonly maxFailedAttempts: number;
  readonly maxIterations: number;
  readonly maxToolRounds: number;
  readonly maxToolCalls: number;
  readonly credentials?: Credentials;
  readonly task: ResolvedSource;
  readonly systemPrompt: ResolvedSource;
  readonly taskSchema?: ResolvedSource;
  readonly files: readonly (ReferenceFile & { readonly encoding: FileEncoding; readonly content: string; readonly resolvedPath: string })[];
  readonly tools: readonly ToolDefinition[];
  readonly autoInvokeTools: boolean;
  readonly outputSchema?: ResolvedSource;
  readonly configurationRoot: string;
}

export interface ProviderCompletionRequest {
  readonly provider: string;
  readonly model: string;
  readonly thinking: Thinking;
  readonly systemPrompt: string;
  readonly llmPrompt: string;
  readonly files: readonly (ReferenceFile & { readonly encoding: FileEncoding; readonly content: string; readonly resolvedPath: string })[];
  readonly credentials?: Credentials;
}

export interface ProviderCompletionRequestV2 extends ProviderCompletionRequest {
  readonly tools: readonly ToolDefinition[];
  readonly toolResults: readonly ToolResult[];
}

export interface ProviderCompletionResponse {
  readonly content: string | null;
  readonly toolCalls: ToolCalls;
}

export interface LlmProvider {
  complete(request: ProviderCompletionRequest): Promise<string>;
}

export interface LlmProviderV2 extends LlmProvider {
  completeV2(request: ProviderCompletionRequestV2): Promise<ProviderCompletionResponse>;
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
  | 'input_invalid'
  | 'configuration_error'
  | 'provider_error'
  | 'output_invalid'
  | 'attempts_exhausted';

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
  | 'TOOL_RESULT_INVALID';

export type ErrorPhase =
  | 'request'
  | 'configuration'
  | 'source-resolution'
  | 'provider'
  | 'output-parsing'
  | 'output-validation'
  | 'tool-validation'
  | 'tool-invocation'
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
  readonly errors: readonly LlmError[];
}

export type ResponseStatusV2 =
  | 'success'
  | 'tool_calls_pending'
  | 'tool_rounds_exhausted'
  | 'tool_invocation_error'
  | 'input_invalid'
  | 'configuration_error'
  | 'provider_error'
  | 'output_invalid'
  | 'attempts_exhausted'
  | 'unvalidated';

export interface LlmResponseV2 {
  readonly schema: typeof RESPONSE_SCHEMA_V2;
  readonly status: ResponseStatusV2;
  readonly output: ToolAwareOutput | RawOutput | null;
  readonly failedAttempts: number;
  readonly iterations: number;
  readonly toolRounds: number;
  readonly toolCalls: number;
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
  complete(request: LlmRequestV2, options?: CompletionOptionsV2): Promise<LlmResponseV2>;
}

export interface CompletionOptions {
  readonly provider?: LlmProvider;
  readonly configurationFilePath?: string;
  readonly configurationRoot?: string;
}

export interface CompletionOptionsV2 extends CompletionOptions {
  readonly toolInvoker?: ToolInvoker;
  readonly signal?: AbortSignal;
}

export type AnyLlmRequest = LlmRequest | LlmRequestV2;
export type AnyLlmResponse = LlmResponse | LlmResponseV2;
export type AnyCompletionOptions = CompletionOptions | CompletionOptionsV2;

export interface PromptParts {
  readonly task: string;
  readonly taskSchema?: string;
  readonly files: readonly (ReferenceFile & { readonly content: string })[];
  readonly outputSchema?: string;
}
