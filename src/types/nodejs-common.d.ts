declare module 'nodejs-common/dist/src/config/index.js' {
  export class ConfigError extends Error {
    readonly code: string;
    readonly path?: string;
  }

  export interface ResolvedConfigJson {
    readonly value: Record<string, unknown>;
    readonly layers: readonly {
      readonly source: string;
      readonly sourceDirectory: string;
      readonly absolutePath: string;
    }[];
  }

  export function resolveConfigJson(options: {
    readonly applicationSourceDirectory: string;
    readonly appSlug: string;
    readonly environmentVariable?: string;
    readonly homeDirectory?: string;
    readonly environment?: Readonly<Record<string, string | undefined>>;
  }): Promise<ResolvedConfigJson>;
}