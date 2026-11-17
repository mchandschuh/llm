import { randomBytes } from 'node:crypto';
import { chatFactory } from '../chat.js';
import { loadChatSession, saveChatSession, validateChatId, type PersistedChatSession } from '../chat-session-store.js';
import type { LlmChatMessage, LlmProvider, LlmRequest, LlmResponse } from '../types.js';
import { stderrDebugSink } from '../debug.js';
import { printResponse, type OutputWriter } from './output.js';
import type { ResponseFormat } from './arguments.js';

export interface ChatCommandOptions {
  readonly prompt: string;
  readonly chatId?: string;
  readonly continuation: boolean;
  readonly debug: boolean;
  readonly format?: ResponseFormat;
  readonly printChatId: boolean;
  readonly rootDirectory?: string;
  readonly provider?: LlmProvider;
  readonly write?: OutputWriter;
  readonly writeError?: OutputWriter;
  readonly writeHandoff?: OutputWriter;
}

function newChatId(): string {
  return `chat-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function rawAssistantOutput(history: readonly LlmChatMessage[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === 'assistant' && message.content !== null) return message.content;
  }
  return undefined;
}

function printTurn(response: LlmResponse, history: readonly LlmChatMessage[], options: ChatCommandOptions): void {
  const write = options.printChatId
    ? (options.writeError ?? ((text: string) => process.stderr.write(text)))
    : (options.write ?? ((text: string) => process.stdout.write(text)));
  printResponse(response, options.format ?? 'full', rawAssistantOutput(history), write, options.writeError);
}

function handoff(chatId: string, printChatId: boolean, write: OutputWriter = (text) => process.stdout.write(text)): void {
  if (printChatId) write(`export LLM_CHAT_ID=${JSON.stringify(chatId)}\n`);
}

const DEFAULT_CHAT_REQUEST: Omit<LlmRequest, 'task'> = {
  schema: 'https://schemas.handschuh.dev/llm/request/v1',
  systemPrompt: 'Respond helpfully and concisely.',
};

export async function runChatCommand(options: ChatCommandOptions): Promise<number> {
  const writeError = options.writeError ?? ((text: string) => process.stderr.write(`${text}\n`));
  try {
    if (options.continuation && !process.env.LLM_CHAT_ID) {
      writeError(JSON.stringify({ status: 'configuration_error', errors: [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message: 'No active chat session. Start one with llm -c <prompt> or llm -c --chat-id <id> <prompt>.' }] }));
      return 1;
    }
    const chatId = validateChatId(options.chatId ?? (options.continuation ? process.env.LLM_CHAT_ID! : newChatId()));
    let request: LlmRequest;
    let initialHistory;
    if (options.continuation) {
      const persisted = await loadChatSession(chatId, { rootDirectory: options.rootDirectory });
      if (!persisted) {
        writeError(JSON.stringify({ status: 'configuration_error', errors: [{ code: 'CONFIGURATION_INVALID', phase: 'configuration', message: `No valid chat session was found for LLM_CHAT_ID=${chatId}. Start a new session with llm -c <prompt>.` }] }));
        return 1;
      }
      request = persisted.request;
      initialHistory = persisted.history;
    } else {
      request = { ...DEFAULT_CHAT_REQUEST, task: options.prompt };
    }
    const session = chatFactory.createSession({
      request,
      ...(initialHistory ? { initialHistory } : {}),
      provider: options.provider,
      eventSink: options.debug ? stderrDebugSink() : undefined,
    });
    const turn = options.continuation ? await session.sendUserMessage(options.prompt) : await session.complete();
    printTurn(turn.response, turn.history, options);
    await saveChatSession({ chatId, request, history: session.history }, { rootDirectory: options.rootDirectory });
    handoff(chatId, options.printChatId, options.writeHandoff);
    return turn.response.status === 'success' ? 0 : 1;
  } catch (error) {
    writeError(JSON.stringify({ status: 'input_invalid', errors: [{ code: 'REQUEST_INVALID', phase: 'request', message: error instanceof Error ? error.message : 'The chat session could not be processed.' }] }));
    return error instanceof Error && error.message.includes('identifier') ? 2 : 1;
  }
}

export function persistedSessionToRequest(session: PersistedChatSession): LlmRequest {
  return session.request;
}