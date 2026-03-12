import {
  SecretNotFoundError,
  type SecretAdapter,
  type SecretAdapterContext,
  type SecretMode,
  type SecretResult,
  type SecretSource,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";

export interface FakeAdapterOptions {
  source?: SecretSource;
  mode?: SecretMode | "native";
  initialSecrets?: Record<string, unknown>;
}

export function createFakeAdapter(options: FakeAdapterOptions = {}): SecretAdapter {
  const source = options.source ?? "env";
  const mode = options.mode ?? "native";
  const data = new Map<string, unknown>(Object.entries(options.initialSecrets ?? {}));

  return {
    source,
    capabilities: {
      api: mode === "api",
      cli: mode === "cli",
      native: mode === "native",
      structuredData: true
    },

    async get(
      request: SingleSourceSecretRequest,
      context: SecretAdapterContext
    ): Promise<SecretResult> {
      void context;
      if (!data.has(request.key)) {
        throw new SecretNotFoundError(request.key);
      }

      return {
        value: data.get(request.key),
        metadata: {
          source,
          mode
        }
      };
    }
  };
}
