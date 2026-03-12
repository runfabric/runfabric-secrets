import type {
  SecretAdapter,
  SecretAdapterContext,
  SecretResult,
  SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import { checkAzureApiHealth, loadFromAzureApi } from "./azure-api-provider.js";
import { checkAzureCliHealth, loadFromAzureCli } from "./azure-cli-provider.js";
import type { AzureAdapterOptions } from "./azure-types.js";

export function createAzureAdapter(options: AzureAdapterOptions): SecretAdapter {
  return {
    source: "azure",
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
        return loadFromAzureCli(request, context, options);
      }

      return loadFromAzureApi(request, context, options);
    },

    async healthCheck(context: SecretAdapterContext): Promise<{ ok: boolean; details?: unknown }> {
      const [api, cli] = await Promise.all([
        checkAzureApiHealth(context, options),
        checkAzureCliHealth(context, options)
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
