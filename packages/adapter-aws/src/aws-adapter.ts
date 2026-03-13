import type {
  SecretAdapter,
  SecretAdapterContext,
  SecretResult,
  SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import { checkAwsApiHealth, loadFromAwsApi } from "./aws-api-provider.js";
import { checkAwsCliHealth, loadFromAwsCli } from "./aws-cli-provider.js";
import type { AwsAdapterOptions } from "./aws-types.js";

export function createAwsAdapter(options: AwsAdapterOptions): SecretAdapter {
  const hasApiConfig = options.api != null;
  const hasCliConfig = options.cli != null;
  const apiEnabled = hasApiConfig || !hasCliConfig;
  const cliEnabled = hasCliConfig || !hasApiConfig;

  return {
    source: "aws",
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
        return loadFromAwsCli(request, context, options);
      }

      return loadFromAwsApi(request, context, options);
    },

    async healthCheck(context: SecretAdapterContext): Promise<{ ok: boolean; details?: unknown }> {
      if (hasApiConfig && !hasCliConfig) {
        const api = await checkAwsApiHealth(context, options);
        return {
          ok: api.ok,
          details: {
            api
          }
        };
      }

      if (hasCliConfig && !hasApiConfig) {
        const cli = await checkAwsCliHealth(context, options);
        return {
          ok: cli.ok,
          details: {
            cli
          }
        };
      }

      const [api, cli] = await Promise.all([
        checkAwsApiHealth(context, options),
        checkAwsCliHealth(context, options)
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
