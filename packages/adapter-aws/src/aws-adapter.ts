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
  return {
    source: "aws",
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
        return loadFromAwsCli(request, context, options);
      }

      return loadFromAwsApi(request, context, options);
    },

    async healthCheck(context: SecretAdapterContext): Promise<{ ok: boolean; details?: unknown }> {
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
