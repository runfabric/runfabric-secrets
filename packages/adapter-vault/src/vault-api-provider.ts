import {
  SecretNotFoundError,
  SecretParseError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { VaultAdapterOptions } from "./vault-types.js";
import {
  buildVaultApiPath,
  extractVaultValue,
  getVaultApiKvVersion,
  getVaultApiNamespace,
  getVaultApiTokenEnvVar,
  isVaultNotFoundStatus,
  parseVaultApiResponse
} from "./vault-utils.js";

export async function loadFromVaultApi(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: VaultAdapterOptions
): Promise<SecretResult> {
  assertVaultApiEndpointIsSecure(options.url);

  const kvVersion = getVaultApiKvVersion(options);
  const endpointPath = buildVaultApiPath(request.key, options.mount, kvVersion);
  const endpointUrl = new URL(endpointPath, options.url);
  if (request.version) {
    if (kvVersion !== 2) {
      throw new Error("Vault KV v1 does not support versioned secret reads.");
    }

    endpointUrl.searchParams.set("version", request.version);
  }
  const endpoint = endpointUrl.toString();

  const tokenEnvVar = getVaultApiTokenEnvVar(options);
  const token = options.api?.token ?? context.env[tokenEnvVar];
  const namespace = getVaultApiNamespace(options);

  const headers = new Headers({
    Accept: "application/json"
  });

  if (token) {
    headers.set("X-Vault-Token", token);
  }

  if (namespace) {
    headers.set("X-Vault-Namespace", namespace);
  }

  const fetcher = options.api?.fetcher ?? getDefaultFetcher();
  const response = await fetcher(endpoint, {
    method: "GET",
    headers,
    signal: request.signal
  });

  if (isVaultNotFoundStatus(response.status)) {
    throw new SecretNotFoundError(request.key);
  }

  if (!response.ok) {
    throw new Error(`Vault API request failed (${response.status}): ${await response.text()}`);
  }

  const body = await parseJsonBody(response, request.key);
  const { payload, metadata } = parseVaultApiResponse(body, kvVersion);
  const value = extractVaultValue(request.key, payload);

  return {
    value,
    metadata: {
      source: "vault",
      mode: "api",
      version: request.version ?? metadata.version,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      raw: {
        url: options.url,
        path: endpointPath,
        kvVersion
      }
    }
  };
}

export async function checkVaultApiHealth(
  context: SecretAdapterContext,
  options: VaultAdapterOptions
): Promise<{ ok: boolean; details?: unknown }> {
  try {
    assertVaultApiEndpointIsSecure(options.url);

    const endpoint = new URL("/v1/sys/health?standbyok=true", options.url).toString();
    const tokenEnvVar = getVaultApiTokenEnvVar(options);
    const token = options.api?.token ?? context.env[tokenEnvVar];
    const namespace = getVaultApiNamespace(options);

    const headers = new Headers({ Accept: "application/json" });
    if (token) {
      headers.set("X-Vault-Token", token);
    }
    if (namespace) {
      headers.set("X-Vault-Namespace", namespace);
    }

    const fetcher = options.api?.fetcher ?? getDefaultFetcher();
    const response = await fetcher(endpoint, {
      method: "GET",
      headers
    });

    return {
      ok: response.status < 500,
      details: {
        mode: "api",
        status: response.status,
        url: options.url
      }
    };
  } catch (error) {
    context.logger?.warn("Vault API health check failed", {
      source: "vault",
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      ok: false,
      details: {
        mode: "api",
        url: options.url,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function parseJsonBody(response: Response, key: string): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new SecretParseError(key, reason);
  }
}

function getDefaultFetcher() {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is unavailable. Provide options.api.fetcher for Vault API mode.");
  }

  return fetch;
}

function assertVaultApiEndpointIsSecure(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`Vault API mode requires an HTTPS URL. Received '${url}'.`);
  }
}
