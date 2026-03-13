import type {
  SecretAdapter,
  SecretAdapterContext,
  SecretResult,
  SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import { checkGcpApiHealth, loadFromGcpApi } from "./gcp-api-provider.js";
import { checkGcpCliHealth, loadFromGcpCli } from "./gcp-cli-provider.js";
import type { GcpAdapterOptions } from "./gcp-types.js";

export function createGcpAdapter(options: GcpAdapterOptions): SecretAdapter {
  const hasApiConfig = options.api != null;
  const hasCliConfig = options.cli != null;
  const apiEnabled = hasApiConfig || !hasCliConfig;
  const cliEnabled = hasCliConfig || !hasApiConfig;

  return {
    source: "gcp",
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
        return loadFromGcpCli(request, context, options);
      }

      return loadFromGcpApi(request, context, options);
    },

    async healthCheck(context: SecretAdapterContext): Promise<{ ok: boolean; details?: unknown }> {
      if (hasApiConfig && !hasCliConfig) {
        const api = await checkGcpApiHealth(context, options);
        return {
          ok: api.ok,
          details: {
            api
          }
        };
      }

      if (hasCliConfig && !hasApiConfig) {
        const cli = await checkGcpCliHealth(context, options);
        return {
          ok: cli.ok,
          details: {
            cli
          }
        };
      }

      const [api, cli] = await Promise.all([
        checkGcpApiHealth(context, options),
        checkGcpCliHealth(context, options)
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
