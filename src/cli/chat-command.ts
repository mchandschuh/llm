import { randomBytes } from 'node:crypto';
import { chatFactory } from '../chat.js';
import { loadChatSession, saveChatSession, validateChatId, type PersistedChatSession } from '../chat-session-store.js';
import type { LlmProvider, LlmRequest, LlmResponse } from '../types.js';
import { stderrDebugSink } from '../debug.js';

export interface ChatCommandOptions {
  readonly prompt: string;
  readonly chatId?: string;
  readonly continuation: boolean;
  readonly debug: boolean;
  readonly json: boolean;
  readonly printChatId: boolean;
  readonly rootDirectory?: string;
  readonly provider?: LlmProvider;
}

function newChatId(): string {
  return `chat-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
}

function printTurn(response: LlmResponse, options: ChatCommandOptions): void {
  const write = options.printChatId ? console.error : console.log;
  if (options.json) write(JSON.stringify(response));
  else if (response.status === 'success') write(response.output?.value ?? '');
  else console.error(response.errors.map((error) => error.message).join('\n'));
}

function handoff(chatId: string, printChatId: boolean): void {
  if (printChatId) console.log(`export LLM_CHAT_ID=${JSON.stringify(chatId)}`);
}

const DEFAULT_CHAT_REQUEST: LlmRequest = {
  schema: 'https://schemas.handschuh.dev/llm/request/v1',
  task: 'Continue the conversation.',
  systemPrompt: 'Respond helpfully and concisely.',
};

export async function runChatCommand(options: ChatCommandOptions): Promise<number> {
  try {
    if (options.continuation && !process.env.LLM_CHAT_ID) {
      console.error('No active chat session. Start one with llm -c <prompt> or llm -c --chat-id <id> <prompt>.');
      return 1;
    }
    const chatId = validateChatId(options.chatId ?? (options.continuation ? process.env.LLM_CHAT_ID! : newChatId()));
    let request = DEFAULT_CHAT_REQUEST;
    let initialHistory;
    if (options.continuation) {
      const persisted = await loadChatSession(chatId, { rootDirectory: options.rootDirectory });
      if (!persisted) {
        console.error(`No valid chat session was found for LLM_CHAT_ID=${chatId}. Start a new session with llm -c <prompt>.`);
        return 1;
      }
      request = persisted.request;
      initialHistory = persisted.history;
    }
    const session = chatFactory.createSession({
      request,
      ...(initialHistory ? { initialHistory } : {}),
      provider: options.provider,
      eventSink: options.debug ? stderrDebugSink() : undefined,
    });
    const turn = await session.sendUserMessage(options.prompt);
    printTurn(turn.response, options);
    await saveChatSession({ chatId, request, history: session.history }, { rootDirectory: options.rootDirectory });
    handoff(chatId, options.printChatId);
    return turn.response.status === 'success' ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'The chat session could not be processed.');
    return error instanceof Error && error.message.includes('identifier') ? 2 : 1;
  }
}

export function persistedSessionToRequest(session: PersistedChatSession): LlmRequest {
  return session.request;
}