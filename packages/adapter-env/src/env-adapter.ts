import {
  SecretNotFoundError,
  type SecretAdapter,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";

export function createEnvAdapter(): SecretAdapter {
  return {
    source: "env",
    capabilities: {
      native: true,
      structuredData: false
    },

    async get(
      request: SingleSourceSecretRequest,
      context: SecretAdapterContext
    ): Promise<SecretResult> {
      if (request.signal?.aborted) {
        const error = new Error("Env adapter request was aborted");
        error.name = "AbortError";
        throw error;
      }

      const value = context.env[request.key];

      if (value == null) {
        throw new SecretNotFoundError(request.key);
      }

      return {
        value,
        metadata: {
          source: "env",
          mode: "native"
        }
      };
    }
  };
}
