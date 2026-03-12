import { SecretNotFoundError, SecretParseError } from "@runfabric/secrets-core";
import type {
  GcpAccessSecretVersionResponse,
  GcpAdapterOptions
} from "./gcp-types.js";

interface GcpCliJsonPayload {
  name?: string;
  payload?: {
    data?: string;
  };
  data?: string;
  value?: unknown;
}

export function getGcpCliBinaryPath(options: GcpAdapterOptions): string {
  return options.cli?.binaryPath ?? "gcloud";
}

export function buildGcpSecretVersionName(
  key: string,
  projectId: string,
  version?: string
): string {
  const requestedVersion = version ?? "latest";

  if (key.startsWith("projects/")) {
    return key.includes("/versions/") ? key : `${key}/versions/${requestedVersion}`;
  }

  return `projects/${projectId}/secrets/${key}/versions/${requestedVersion}`;
}

export function resolveGcpSecretId(key: string): string {
  if (!key.startsWith("projects/")) {
    return key;
  }

  const parts = key.split("/").filter(Boolean);
  const secretIndex = parts.findIndex((part) => part === "secrets");
  if (secretIndex === -1 || secretIndex + 1 >= parts.length) {
    return key;
  }

  return parts[secretIndex + 1];
}

export function extractVersionFromName(name?: string): string | undefined {
  if (!name) {
    return undefined;
  }

  const parts = name.split("/").filter(Boolean);
  const versionIndex = parts.findIndex((part) => part === "versions");
  if (versionIndex === -1 || versionIndex + 1 >= parts.length) {
    return undefined;
  }

  return parts[versionIndex + 1];
}

export function extractGcpSecretValue(
  key: string,
  response: GcpAccessSecretVersionResponse
): string {
  const payload = response.payload?.data;
  if (payload == null) {
    throw new SecretNotFoundError(key);
  }

  return decodeGcpPayload(payload);
}

export function parseGcpCliValue(
  stdout: string,
  key: string
): { value: unknown; version?: string } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new SecretNotFoundError(key);
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let payload: GcpCliJsonPayload;
    try {
      payload = JSON.parse(trimmed) as GcpCliJsonPayload;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid JSON";
      throw new SecretParseError(key, reason);
    }

    if (payload.value != null) {
      return {
        value: payload.value,
        version: extractVersionFromName(payload.name)
      };
    }

    if (payload.payload?.data != null) {
      return {
        value: decodeGcpPayload(payload.payload.data),
        version: extractVersionFromName(payload.name)
      };
    }

    if (payload.data != null) {
      return {
        value: decodeGcpPayload(payload.data),
        version: extractVersionFromName(payload.name)
      };
    }
  }

  return {
    value: trimmed
  };
}

export function isGcpNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const knownCode = (error as { code?: unknown }).code;
  if (knownCode === 5 || knownCode === 404) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown }).message ?? "");

  return /not\s+found|NOT_FOUND/i.test(message);
}

export function isGcpCliNotFound(stderr: string): boolean {
  return /not\s+found|NOT_FOUND|resource\s+does\s+not\s+exist/i.test(stderr);
}

export function parseGcpVersionOutput(stdout: string): string {
  const line = stdout
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  if (!line) {
    throw new SecretParseError("gcloud --version", "Empty output");
  }

  return line;
}

function decodeGcpPayload(value: Uint8Array | Buffer | string): string {
  if (typeof value === "string") {
    return Buffer.from(value, "base64").toString("utf8");
  }

  return Buffer.from(value).toString("utf8");
}
