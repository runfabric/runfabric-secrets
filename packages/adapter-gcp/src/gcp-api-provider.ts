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

const apiClientCache = new WeakMap<GcpAdapterOptions, Promise<GcpSecretManagerClientLike>>();

export async function loadFromGcpApi(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: GcpAdapterOptions
): Promise<SecretResult> {
  const name = buildGcpSecretVersionName(request.key, options.projectId, request.version);

  try {
    const client = await getApiClient(options);
    const response = await invokeAccessSecretVersion(client, name, context, request.signal);
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
  const cached = apiClientCache.get(options);
  if (cached) {
    return cached;
  }

  const pendingClient = resolveApiClient(options);
  apiClientCache.set(options, pendingClient);

  try {
    return await pendingClient;
  } catch (error) {
    apiClientCache.delete(options);
    throw error;
  }
}

async function resolveApiClient(options: GcpAdapterOptions): Promise<GcpSecretManagerClientLike> {
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
  context: SecretAdapterContext,
  signal?: AbortSignal
): Promise<GcpAccessSecretVersionResponse> {
  if (typeof client.accessSecretVersion !== "function") {
    context.logger?.error("GCP API client is missing accessSecretVersion method", {
      source: "gcp"
    });
    throw new Error("Invalid GCP API client: expected accessSecretVersion method");
  }

  throwIfAborted(signal);

  const response = await withAbortSignal(
    client.accessSecretVersion(
      { name },
      signal ? { signal } : undefined
    ),
    signal
  );

  return Array.isArray(response) ? response[0] : response;
}

async function importGcpSdk(): Promise<GcpSdkModule> {
  try {
    const moduleName = "@google-cloud/secret-manager";
    return (await import(moduleName)) as GcpSdkModule;
  } catch {
    throw new Error(
      "GCP Secret Manager SDK is not installed. Add '@google-cloud/secret-manager' to use GCP API mode."
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise
      .then((value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      })
      .catch((error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
}

function createAbortError(): Error {
  const error = new Error("GCP API request was aborted");
  error.name = "AbortError";
  return error;
}
