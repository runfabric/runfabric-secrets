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
  return {
    source: "gcp",
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
        return loadFromGcpCli(request, context, options);
      }

      return loadFromGcpApi(request, context, options);
    },

    async healthCheck(context: SecretAdapterContext): Promise<{ ok: boolean; details?: unknown }> {
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
