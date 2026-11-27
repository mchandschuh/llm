/** Provider used when a request does not name one. */
export const DEFAULT_PROVIDER = 'claude';

/** Default model for each registered provider, used when a request does not name a model. */
export const DEFAULT_MODELS: Readonly<Record<string, string>> = Object.freeze({
  claude: 'sonnet',
  openrouter: 'openai/gpt-5.6-luna',
});

/**
 * Model used for a provider without a registered default. Injected custom
 * providers keep the model the runtime defaulted to before WI-0026.
 */
export const FALLBACK_MODEL = 'openai/gpt-5.6-luna';

export function defaultModelFor(provider: string): string {
  return Object.hasOwn(DEFAULT_MODELS, provider) ? DEFAULT_MODELS[provider]! : FALLBACK_MODEL;
}
