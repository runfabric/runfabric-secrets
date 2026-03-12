import { SecretNotFoundError, SecretParseError } from "@runfabric/secrets-core";
import type { AzureAdapterOptions, AzureKeyVaultSecretLike } from "./azure-types.js";

interface AzureCliSecretOutput {
  id?: string;
  value?: unknown;
  attributes?: {
    created?: number;
    updated?: number;
  };
}

export function getAzureCliBinaryPath(options: AzureAdapterOptions): string {
  return options.cli?.binaryPath ?? "az";
}

export function resolveAzureVaultName(options: AzureAdapterOptions): string {
  if (options.vaultName) {
    return options.vaultName;
  }

  try {
    const url = new URL(options.vaultUrl);
    const host = url.hostname;
    const first = host.split(".")[0];
    if (first) {
      return first;
    }
  } catch {
    return options.vaultUrl;
  }

  return options.vaultUrl;
}

export function resolveAzureSecretName(key: string): string {
  if (key.startsWith("https://") || key.startsWith("http://")) {
    try {
      const url = new URL(key);
      const parts = url.pathname.split("/").filter(Boolean);
      const secretIndex = parts.findIndex((part) => part === "secrets");
      if (secretIndex !== -1 && secretIndex + 1 < parts.length) {
        return parts[secretIndex + 1];
      }
    } catch {
      return key;
    }
  }

  if (key.includes("/")) {
    const parts = key.split("/").filter(Boolean);
    return parts[parts.length - 1];
  }

  return key;
}

export function extractAzureSecretValue(
  key: string,
  response: AzureKeyVaultSecretLike
): unknown {
  if (response.value == null) {
    throw new SecretNotFoundError(key);
  }

  return response.value;
}

export function isAzureNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (statusCode === 404) {
    return true;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && /SecretNotFound|NotFound/i.test(code)) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : String((error as { message?: unknown }).message ?? "");

  return /secret.*not\s+found|not\s+found/i.test(message);
}

export function isAzureCliNotFound(stderr: string): boolean {
  return /SecretNotFound|not\s+found|could\s+not\s+be\s+found/i.test(stderr);
}

export function parseAzureCliOutput(stdout: string, key: string): AzureCliSecretOutput {
  try {
    return JSON.parse(stdout) as AzureCliSecretOutput;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new SecretParseError(key, reason);
  }
}

export function parseAzureVersionOutput(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new SecretParseError("az version", "Empty output");
  }

  return trimmed;
}

export function toIsoDate(value: Date | number | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
