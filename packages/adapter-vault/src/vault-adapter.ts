import type {
  SecretAdapter,
  SecretAdapterContext,
  SecretResult,
  SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { VaultAdapterOptions } from "./vault-types.js";
import { checkVaultApiHealth, loadFromVaultApi } from "./vault-api-provider.js";
import { checkVaultCliHealth, loadFromVaultCli } from "./vault-cli-provider.js";

export function createVaultAdapter(options: VaultAdapterOptions): SecretAdapter {
  return {
    source: "vault",
    capabilities: {
      api: true,
      cli: true,
      versioning: true,
      structuredData: true
    },

    async get(
      request: SingleSourceSecretRequest,
      context: SecretAdapterContext
    ): Promise<SecretResult> {
      if (request.mode === "cli") {
        return loadFromVaultCli(request, context, options);
      }

      return loadFromVaultApi(request, context, options);
    },

    async healthCheck(context: SecretAdapterContext): Promise<{ ok: boolean; details?: unknown }> {
      const [api, cli] = await Promise.all([
        checkVaultApiHealth(context, options),
        checkVaultCliHealth(context, options)
      ]);

      return {
        ok: api.ok || cli.ok,
        details: {
          api,
          cli
        }
      };
    }
  };
}
