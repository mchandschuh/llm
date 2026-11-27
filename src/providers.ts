import { ClaudeProvider } from './claude-provider.js';
import { LlmFailure } from './errors.js';
import { OpenRouterProvider } from './provider.js';
import type { LlmProvider } from './types.js';

const FACTORIES: Readonly<Record<string, () => LlmProvider>> = Object.freeze({
  claude: () => new ClaudeProvider(),
  openrouter: () => new OpenRouterProvider(),
});

/** Provider names that resolve to a built-in adapter, in sorted order. */
export const REGISTERED_PROVIDERS: readonly string[] = Object.freeze(Object.keys(FACTORIES).sort());

/**
 * Create the built-in adapter for a provider name. Callers that inject their
 * own `LlmProvider` bypass this registry.
 */
export function createProvider(name: string): LlmProvider {
  if (!Object.hasOwn(FACTORIES, name)) {
    throw new LlmFailure('CONFIGURATION_INVALID', 'configuration', `No provider adapter is registered for ${name}. Registered providers: ${REGISTERED_PROVIDERS.join(', ')}.`);
  }
  return FACTORIES[name]!();
}
