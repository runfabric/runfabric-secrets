import {
  SecretNotFoundError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type {
  GcpAccessSecretVersionResponse,
  GcpAdapterOptions,
  GcpSecretManagerClientLike
} from "./gcp-types.js";
import {
  buildGcpSecretVersionName,
  extractGcpSecretValue,
  extractVersionFromName,
  isGcpNotFoundError
} from "./gcp-utils.js";

interface GcpSdkModule {
  SecretManagerServiceClient: new (config?: {
    apiEndpoint?: string;
  }) => GcpSecretManagerClientLike;
}

export async function loadFromGcpApi(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: GcpAdapterOptions
): Promise<SecretResult> {
  const name = buildGcpSecretVersionName(request.key, options.projectId, request.version);

  try {
    const client = await getApiClient(options);
    const response = await invokeAccessSecretVersion(client, name, context);
    const value = extractGcpSecretValue(request.key, response);

    return {
      value,
      metadata: {
        source: "gcp",
        mode: "api",
        version: request.version ?? extractVersionFromName(response.name),
        createdAt: response.createTime,
        raw: {
          projectId: options.projectId,
          resourceName: response.name
        }
      }
    };
  } catch (error) {
    if (isGcpNotFoundError(error)) {
      throw new SecretNotFoundError(request.key);
    }

    throw error;
  }
}

export async function checkGcpApiHealth(
  context: SecretAdapterContext,
  options: GcpAdapterOptions
): Promise<{ ok: boolean; details?: unknown }> {
  try {
    const client = await getApiClient(options);
    if (typeof client.listSecrets === "function") {
      await client.listSecrets({
        parent: `projects/${options.projectId}`,
        pageSize: 1
      });
    }

    return {
      ok: true,
      details: {
        mode: "api",
        projectId: options.projectId
      }
    };
  } catch (error) {
    context.logger?.warn("GCP API health check failed", {
      source: "gcp",
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      ok: false,
      details: {
        mode: "api",
        projectId: options.projectId,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function getApiClient(options: GcpAdapterOptions): Promise<GcpSecretManagerClientLike> {
  if (options.api?.client) {
    return options.api.client;
  }

  const sdk = await importGcpSdk();
  return new sdk.SecretManagerServiceClient({
    ...(options.api?.endpoint ? { apiEndpoint: options.api.endpoint } : {})
  });
}

async function invokeAccessSecretVersion(
  client: GcpSecretManagerClientLike,
  name: string,
  context: SecretAdapterContext
): Promise<GcpAccessSecretVersionResponse> {
  if (typeof client.accessSecretVersion !== "function") {
    context.logger?.error("GCP API client is missing accessSecretVersion method", {
      source: "gcp"
    });
    throw new Error("Invalid GCP API client: expected accessSecretVersion method");
  }

  const response = await client.accessSecretVersion({ name });
  return Array.isArray(response) ? response[0] : response;
}

async function importGcpSdk(): Promise<GcpSdkModule> {
  try {
    return (await importOptionalModule("@google-cloud/secret-manager")) as GcpSdkModule;
  } catch {
    throw new Error(
      "GCP Secret Manager SDK is not installed. Add '@google-cloud/secret-manager' to use GCP API mode."
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
