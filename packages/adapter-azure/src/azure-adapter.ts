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
  const hasApiConfig = options.api != null;
  const hasCliConfig = options.cli != null;
  const apiEnabled = hasApiConfig || !hasCliConfig;
  const cliEnabled = hasCliConfig || !hasApiConfig;

  return {
    source: "azure",
    capabilities: {
      api: apiEnabled,
      cli: cliEnabled,
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
      if (hasApiConfig && !hasCliConfig) {
        const api = await checkAzureApiHealth(context, options);
        return {
          ok: api.ok,
          details: {
            api
          }
        };
      }

      if (hasCliConfig && !hasApiConfig) {
        const cli = await checkAzureCliHealth(context, options);
        return {
          ok: cli.ok,
          details: {
            cli
          }
        };
      }

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
