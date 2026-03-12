import { SecretNotFoundError } from "@runfabric/secrets-core";
import type { VaultAdapterOptions, VaultKvVersion } from "./vault-types.js";

interface VaultApiResponse {
  data?: {
    data?: unknown;
    metadata?: {
      version?: number;
      created_time?: string;
      updated_time?: string;
      deletion_time?: string;
      destroyed?: boolean;
    };
  };
}

export function resolveVaultMount(mount?: string): string {
  if (!mount || !mount.trim()) {
    return "secret";
  }

  return mount.replace(/^\/+|\/+$/g, "");
}

export function resolveVaultPath(key: string, mount?: string): string {
  const normalizedKey = key.replace(/^\/+/, "");
  return `${resolveVaultMount(mount)}/${normalizedKey}`;
}

export function buildVaultApiPath(key: string, mount: string | undefined, kvVersion: VaultKvVersion): string {
  const normalizedKey = key.replace(/^\/+/, "");
  const normalizedMount = resolveVaultMount(mount);

  if (kvVersion === 2) {
    return `/v1/${normalizedMount}/data/${normalizedKey}`;
  }

  return `/v1/${normalizedMount}/${normalizedKey}`;
}

export function getVaultCliBinaryPath(options: VaultAdapterOptions): string {
  return options.cli?.binaryPath ?? "vault";
}

export function getVaultTokenEnvVar(options: VaultAdapterOptions): string {
  return options.cli?.tokenEnvVar ?? "VAULT_TOKEN";
}

export function getVaultKvVersion(options: VaultAdapterOptions): VaultKvVersion {
  return options.api?.kvVersion ?? options.cli?.kvVersion ?? 2;
}

export function getVaultNamespace(options: VaultAdapterOptions): string | undefined {
  return options.api?.namespace ?? options.cli?.namespace;
}

export function isVaultNotFoundStatus(status: number): boolean {
  return status === 404;
}

export function isVaultCliNotFound(stderr: string): boolean {
  return /No value found|404|not\s+found/i.test(stderr);
}

export function extractVaultValue(
  key: string,
  payload: unknown
): unknown {
  if (payload == null) {
    throw new SecretNotFoundError(key);
  }

  if (typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;

  if ("value" in record) {
    return record.value;
  }

  const keys = Object.keys(record);

  if (keys.length === 1) {
    return record[keys[0]];
  }

  return record;
}

export function parseVaultApiResponse(body: unknown, kvVersion: VaultKvVersion): {
  payload: unknown;
  metadata: {
    version?: string;
    createdAt?: string;
    updatedAt?: string;
  };
} {
  const response = (body ?? {}) as VaultApiResponse;

  if (kvVersion === 2) {
    const metadata = response.data?.metadata;
    return {
      payload: response.data?.data,
      metadata: {
        version: metadata?.version != null ? String(metadata.version) : undefined,
        createdAt: metadata?.created_time,
        updatedAt: metadata?.updated_time
      }
    };
  }

  return {
    payload: (body as { data?: unknown })?.data,
    metadata: {}
  };
}
