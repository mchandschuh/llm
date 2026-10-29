export const REQUEST_SCHEMA = 'https://schemas.handschuh.dev/llm/request/v1' as const;
export const RESPONSE_SCHEMA = 'https://schemas.handschuh.dev/llm/response/v1' as const;

export type Thinking = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface Credentials {
  readonly apiKey?: string;
  readonly accessToken?: string;
}

export interface ReferenceFile {
  readonly name: string;
  readonly path: string;
  readonly type: string;
  readonly purpose: string;
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
  readonly files: readonly (ReferenceFile & { readonly content: string; readonly resolvedPath: string })[];
  readonly outputSchema?: ResolvedSource;
  readonly configurationRoot: string;
}

export interface ProviderCompletionRequest {
  readonly provider: string;
  readonly model: string;
  readonly thinking: Thinking;
  readonly systemPrompt: string;
  readonly llmPrompt: string;
  readonly credentials?: Credentials;
}

export interface LlmProvider {
  complete(request: ProviderCompletionRequest): Promise<string>;
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
  | 'OUTPUT_INVALID';

export type ErrorPhase =
  | 'request'
  | 'configuration'
  | 'source-resolution'
  | 'provider'
  | 'output-parsing'
  | 'output-validation'
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

export interface CompletionOptions {
  readonly provider?: LlmProvider;
  readonly configurationFilePath?: string;
  readonly configurationRoot?: string;
}

export interface PromptParts {
  readonly task: string;
  readonly taskSchema?: string;
  readonly files: readonly (ReferenceFile & { readonly content: string })[];
  readonly outputSchema?: string;
}
