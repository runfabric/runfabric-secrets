import type {
  SecretAdapter,
  SecretAdapterContext,
  SecretResult,
  SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { VaultAdapterOptions } from "./vault-types.js";
import { checkVaultApiHealth, loadFromVaultApi } from "./vault-api-provider.js";
import { checkVaultCliHealth, loadFromVaultCli } from "./vault-cli-provider.js";
import { getVaultApiKvVersion, getVaultCliKvVersion } from "./vault-utils.js";

export function createVaultAdapter(options: VaultAdapterOptions): SecretAdapter {
  const hasApiConfig = options.api != null;
  const hasCliConfig = options.cli != null;
  const apiEnabled = hasApiConfig || !hasCliConfig;
  const cliEnabled = hasCliConfig || !hasApiConfig;
  const apiSupportsVersioning = getVaultApiKvVersion(options) === 2;
  const cliSupportsVersioning = getVaultCliKvVersion(options) === 2;
  const supportsVersioning =
    hasApiConfig && !hasCliConfig
      ? apiSupportsVersioning
      : hasCliConfig && !hasApiConfig
        ? cliSupportsVersioning
        : apiSupportsVersioning || cliSupportsVersioning;

  return {
    source: "vault",
    capabilities: {
      api: apiEnabled,
      cli: cliEnabled,
      versioning: supportsVersioning,
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
      if (hasApiConfig && !hasCliConfig) {
        const api = await checkVaultApiHealth(context, options);
        return {
          ok: api.ok,
          details: {
            api
          }
        };
      }

      if (hasCliConfig && !hasApiConfig) {
        const cli = await checkVaultCliHealth(context, options);
        return {
          ok: cli.ok,
          details: {
            cli
          }
        };
      }

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
