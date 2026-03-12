import {
  SecretNotFoundError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { AzureAdapterOptions, AzureSecretClientLike } from "./azure-types.js";
import {
  extractAzureSecretValue,
  isAzureNotFoundError,
  resolveAzureSecretName,
  toIsoDate
} from "./azure-utils.js";

interface AzureKeyVaultSdkModule {
  SecretClient: new (vaultUrl: string, credential: unknown) => AzureSecretClientLike;
}

interface AzureIdentitySdkModule {
  DefaultAzureCredential: new () => unknown;
}

export async function loadFromAzureApi(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: AzureAdapterOptions
): Promise<SecretResult> {
  const secretName = resolveAzureSecretName(request.key);

  try {
    const client = await getApiClient(options);
    const response = await client.getSecret(
      secretName,
      request.version ? { version: request.version } : undefined
    );
    const value = extractAzureSecretValue(request.key, response);

    return {
      value,
      metadata: {
        source: "azure",
        mode: "api",
        version: response.properties?.version ?? request.version,
        createdAt: toIsoDate(response.properties?.createdOn),
        updatedAt: toIsoDate(response.properties?.updatedOn),
        raw: {
          vaultUrl: options.vaultUrl,
          secretName,
          id: response.id
        }
      }
    };
  } catch (error) {
    if (isAzureNotFoundError(error)) {
      throw new SecretNotFoundError(request.key);
    }

    throw error;
  }
}

export async function checkAzureApiHealth(
  context: SecretAdapterContext,
  options: AzureAdapterOptions
): Promise<{ ok: boolean; details?: unknown }> {
  try {
    const client = await getApiClient(options);
    if (typeof client.listPropertiesOfSecrets === "function") {
      const iterator = client.listPropertiesOfSecrets()[Symbol.asyncIterator]();
      await iterator.next();
    }

    return {
      ok: true,
      details: {
        mode: "api",
        vaultUrl: options.vaultUrl
      }
    };
  } catch (error) {
    context.logger?.warn("Azure API health check failed", {
      source: "azure",
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      ok: false,
      details: {
        mode: "api",
        vaultUrl: options.vaultUrl,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function getApiClient(options: AzureAdapterOptions): Promise<AzureSecretClientLike> {
  if (options.api?.client) {
    return options.api.client;
  }

  const [{ SecretClient }, { DefaultAzureCredential }] = await Promise.all([
    importAzureKeyVaultSdk(),
    importAzureIdentitySdk()
  ]);

  const credential = options.api?.credential ?? new DefaultAzureCredential();
  return new SecretClient(options.vaultUrl, credential);
}

async function importAzureKeyVaultSdk(): Promise<AzureKeyVaultSdkModule> {
  try {
    return (await importOptionalModule("@azure/keyvault-secrets")) as AzureKeyVaultSdkModule;
  } catch {
    throw new Error(
      "Azure Key Vault SDK is not installed. Add '@azure/keyvault-secrets' to use Azure API mode."
    );
  }
}

async function importAzureIdentitySdk(): Promise<AzureIdentitySdkModule> {
  try {
    return (await importOptionalModule("@azure/identity")) as AzureIdentitySdkModule;
  } catch {
    throw new Error(
      "Azure Identity SDK is not installed. Add '@azure/identity' to use Azure API mode."
    );
  }
}

async function importOptionalModule(moduleName: string): Promise<unknown> {
  const dynamicImport = new Function(
    "moduleName",
    "return import(moduleName);"
  ) as (name: string) => Promise<unknown>;

  return dynamicImport(moduleName);
}
