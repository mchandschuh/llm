import { complete } from './complete.js';
import { composePrompt, composeRequestPrompt } from './prompt.js';
import { normalizeRequest } from './normalize.js';
import { RESPONSE_SCHEMA } from './types.js';
import type {
  ChatFactoryCreateSessionOptions,
  CompletionOptions,
  LlmChatMessage,
  LlmChatProvider,
  LlmChatSession,
  LlmChatTurn,
  LlmRequest,
  LlmResponse,
} from './types.js';

const DEFAULT_REQUEST: LlmRequest = {
  schema: 'https://schemas.handschuh.dev/llm/request/v1',
  task: 'Continue the conversation.',
  systemPrompt: 'Respond helpfully and concisely.',
};

function blockedResponse(): LlmResponse {
  return {
    schema: RESPONSE_SCHEMA,
    status: 'tool_calls_pending',
    output: null,
    failedAttempts: 0,
    iterations: 0,
    toolRounds: 0,
    toolCalls: 0,
    toolResults: [],
    errors: [],
  };
}

class ChatSession implements LlmChatSession {
  private readonly request: LlmRequest;
  private readonly options: ChatFactoryCreateSessionOptions;
  private readonly messages: LlmChatMessage[] = [];
  private initialized = false;
  private activeTurn: Promise<LlmChatTurn> | undefined;
  private normalizedRequest: Awaited<ReturnType<typeof normalizeRequest>> | undefined;

  constructor(options: ChatFactoryCreateSessionOptions) {
    this.options = options;
    this.request = { ...DEFAULT_REQUEST, ...(options.request ?? {}) };
    if (options.initialHistory) {
      this.messages.push(...options.initialHistory);
      this.initialized = true;
    }
  }

  get history(): readonly LlmChatMessage[] {
    return this.messages.slice();
  }

  appendMessage(message: LlmChatMessage): void {
    if (this.activeTurn) throw new Error('LlmChatSession mutations must be serialized by the caller.');
    this.messages.push(message);
  }

  async sendUserMessage(message: string): Promise<LlmChatTurn> {
    if (!message) throw new Error('A user message must not be empty.');
    if (this.activeTurn) {
      if (!this.options.userMessageInterruptsToolRound) {
        return { response: blockedResponse(), blocked: true, history: this.history };
      }
      return this.interrupt(message);
    }
    await this.initialize();
    const normalized = await this.normalized();
    this.messages.push({ role: 'user', content: composePrompt({
      task: message,
      taskSchema: normalized.taskSchema ? JSON.stringify(normalized.taskSchema) : undefined,
      files: normalized.files,
      outputSchema: normalized.outputSchema ? JSON.stringify(normalized.outputSchema) : undefined,
    }) });
    return this.runCanonicalTurn();
  }

  async complete(): Promise<LlmChatTurn> {
    if (this.activeTurn) return this.activeTurn;
    await this.initialize();
    return this.runCanonicalTurn();
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    const normalized = await this.normalized();
    const prompt = composeRequestPrompt(normalized);
    this.messages.push(
      { role: 'system', content: normalized.systemPrompt.value },
      { role: 'user', content: prompt },
      ...normalized.messages,
    );
    this.initialized = true;
  }

  private async normalized(): Promise<Awaited<ReturnType<typeof normalizeRequest>>> {
    if (!this.normalizedRequest) this.normalizedRequest = await normalizeRequest(this.request, { configurationRoot: this.options.configurationRoot });
    return this.normalizedRequest;
  }

  private runCanonicalTurn(): Promise<LlmChatTurn> {
    const pending: LlmChatMessage[] = [];
    const completionOptions: CompletionOptions = {
      provider: this.options.provider,
      toolInvoker: this.options.toolInvoker,
      signal: this.options.signal,
      debug: this.options.eventSink,
      configurationRoot: this.options.configurationRoot,
      messageSink: (message) => pending.push(message),
      conversationHistory: this.messages,
    };
    const request = { ...this.request, messages: this.messages };
    const turn = complete(request, completionOptions).then((response) => {
      if (response.status === 'success') this.messages.push(...pending);
      return { response, history: this.history };
    }).finally(() => {
      this.activeTurn = undefined;
    });
    this.activeTurn = turn;
    return turn;
  }

  private async interrupt(message: string): Promise<LlmChatTurn> {
    await this.initialize();
    const normalized = await this.normalized();
    const snapshot = this.messages.slice();
    const projectedMessage = composePrompt({
      task: message,
      taskSchema: normalized.taskSchema ? JSON.stringify(normalized.taskSchema) : undefined,
      files: normalized.files,
      outputSchema: normalized.outputSchema ? JSON.stringify(normalized.outputSchema) : undefined,
    });
    const interruptRequest: LlmRequest = {
      ...this.request,
      messages: [...snapshot, { role: 'user', content: projectedMessage }],
      toolOptions: undefined,
    };
    const response = await complete(interruptRequest, {
      provider: this.options.provider,
      signal: this.options.signal,
      debug: this.options.eventSink,
      configurationRoot: this.options.configurationRoot,
      conversationHistory: interruptRequest.messages,
    });
    return { response, interrupted: true, history: this.history };
  }
}

export const chatFactory: LlmChatProvider = {
  createSession(options: ChatFactoryCreateSessionOptions = {}): LlmChatSession {
    return new ChatSession(options);
  },
};