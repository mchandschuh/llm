export const REQUEST_SCHEMA = 'https://schemas.handschuh.dev/llm/request/v1' as const;
export const RESPONSE_SCHEMA = 'https://schemas.handschuh.dev/llm/response/v1' as const;
export const TOOL_DEFINITION_SCHEMA = 'https://schemas.handschuh.dev/llm/tool-definition/v1' as const;
export const TOOL_CALL_SCHEMA = 'https://schemas.handschuh.dev/llm/tool-call/v1' as const;
export const PARALLEL_TOOL_CALL_BATCH_SCHEMA = 'https://schemas.handschuh.dev/llm/parallel-tool-call-batch/v1' as const;
export const TOOL_CALLS_SCHEMA = 'https://schemas.handschuh.dev/llm/tool-calls/v1' as const;
export const TOOL_RESULT_SCHEMA = 'https://schemas.handschuh.dev/llm/tool-result/v1' as const;

/** @see schemas/request/v1/request.schema.json */
export type Thinking = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/** @see schemas/request/v1/request.schema.json */
export type FileEncoding = 'utf8' | 'base64';

/** @see schemas/request/v1/request.schema.json */
export interface Credentials {
  readonly apiKey?: string;
  readonly accessToken?: string;
}

/** @see schemas/request/v1/request.schema.json */
export interface ReferenceFile {
  readonly name: string;
  readonly path: string;
  readonly type: string;
  readonly purpose: string;
  readonly encoding?: FileEncoding;
}

export type JsonObject = Readonly<Record<string, unknown>>;

/** @see schemas/request/v1/request.schema.json */
export type TaskValue = string | JsonObject;

/** @see schemas/request/v1/request.schema.json */
export type InlineJsonSchema = JsonObject;

/** @see schemas/request/v1/request.schema.json */
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
  readonly messages?: readonly LlmChatMessage[];
  readonly toolOptions?: ToolOptions;
}

export interface LlmSystemMessage {
  readonly role: 'system';
  readonly content: string;
}

export interface LlmUserMessage {
  readonly role: 'user';
  readonly content: string;
}

export interface LlmAssistantMessage {
  readonly role: 'assistant';
  readonly content: string | null;
  readonly toolCalls: readonly ToolCall[];
}

export interface LlmToolMessage {
  readonly role: 'tool';
  readonly toolCallId: string;
  readonly content: string;
}

export type LlmChatMessage = LlmSystemMessage | LlmUserMessage | LlmAssistantMessage | LlmToolMessage;

/**
 * @see schemas/tool-definition/v1/tool-definition.schema.json
 * @see schemas/request/v1/request.schema.json
 */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: string;
}

/**
 * @see schemas/tool-call/v1/tool-call.schema.json
 * @see schemas/parallel-tool-call-batch/v1/parallel-tool-call-batch.schema.json
 * @see schemas/tool-calls/v1/tool-calls.schema.json
 * @see schemas/response/v1/response.schema.json
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * @see schemas/parallel-tool-call-batch/v1/parallel-tool-call-batch.schema.json
 * @see schemas/tool-calls/v1/tool-calls.schema.json
 */
export type ParallelToolCallBatch = readonly ToolCall[];

/**
 * @see schemas/tool-calls/v1/tool-calls.schema.json
 * @see schemas/response/v1/response.schema.json
 */
export type ToolCalls = readonly ParallelToolCallBatch[];

/**
 * @see schemas/tool-result/v1/tool-result.schema.json
 * @see schemas/response/v1/response.schema.json
 */
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

/** @see schemas/request/v1/request.schema.json */
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
  readonly messages: readonly LlmChatMessage[];
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
  readonly task: TaskValue;
  readonly taskSchema?: InlineJsonSchema;
  readonly messages: readonly LlmChatMessage[];
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

export interface ProviderValidationError {
  readonly code: ErrorCode;
  readonly phase: ErrorPhase;
  readonly message: string;
}

export interface ProviderValidationResult {
  readonly success: boolean;
  readonly errors: readonly ProviderValidationError[];
}

export interface LlmProvider {
  validate?(request: Pick<ProviderCompletionRequest, 'provider' | 'credentials'>): ProviderValidationResult | Promise<ProviderValidationResult>;
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

export interface ChatFactoryCreateSessionOptions {
  readonly request?: LlmRequest;
  readonly initialHistory?: readonly LlmChatMessage[];
  readonly provider?: LlmProvider;
  readonly toolInvoker?: ToolInvoker;
  readonly signal?: AbortSignal;
  readonly eventSink?: import('./debug.js').DebugSink;
  readonly userMessageInterruptsToolRound?: boolean;
  readonly configurationRoot?: string;
}

export interface LlmChatTurn {
  readonly response: LlmResponse;
  readonly interrupted?: boolean;
  readonly blocked?: boolean;
  readonly history: readonly LlmChatMessage[];
}

export interface LlmChatSession {
  readonly history: readonly LlmChatMessage[];
  sendUserMessage(message: string): Promise<LlmChatTurn>;
  complete(): Promise<LlmChatTurn>;
  appendMessage(message: LlmChatMessage): void;
}

export interface LlmChatProvider {
  createSession(options?: ChatFactoryCreateSessionOptions): LlmChatSession;
}

/** @see schemas/response/v1/response.schema.json */
export interface SchemaMetadata {
  readonly name: string;
  readonly path?: string;
}

/** @see schemas/response/v1/response.schema.json */
export interface StructuredOutput {
  readonly $type: string;
  readonly schema: SchemaMetadata;
  readonly value: unknown;
}

/** @see schemas/response/v1/response.schema.json */
export interface RawOutput {
  readonly $type: 'string';
  readonly schema: null | string;
  readonly value: string;
}

/** @see schemas/response/v1/response.schema.json */
export type LlmOutput = StructuredOutput | RawOutput;

/** @see schemas/response/v1/response.schema.json */
export interface ToolAwareOutput {
  readonly $type: 'object';
  readonly schema: SchemaMetadata;
  readonly value: {
    readonly output: unknown;
    readonly tool_calls: ToolCalls;
  };
}

/** @see schemas/response/v1/response.schema.json */
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

/** @see schemas/response/v1/response.schema.json */
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

/** @see schemas/response/v1/response.schema.json */
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

/** @see schemas/response/v1/response.schema.json */
export interface LlmError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly phase: ErrorPhase;
}

/** @see schemas/response/v1/response.schema.json */
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
  readonly allowFinalSymlinkFiles?: boolean;
  readonly debug?: import('./debug.js').DebugSink;
  readonly toolInvoker?: ToolInvoker;
  readonly signal?: AbortSignal;
  readonly messageSink?: (message: LlmChatMessage) => void;
  readonly conversationHistory?: readonly LlmChatMessage[];
}

/** @see schemas/request/v1/request.schema.json */
export type AnyLlmRequest = LlmRequest;

/** @see schemas/response/v1/response.schema.json */
export type AnyLlmResponse = LlmResponse;
export type AnyCompletionOptions = CompletionOptions;

export interface PromptParts {
  readonly task: string;
  readonly taskSchema?: string;
  readonly files: readonly (ReferenceFile & { readonly content: string })[];
  readonly outputSchema?: string;
}
