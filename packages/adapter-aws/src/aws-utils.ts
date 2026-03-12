import { SecretNotFoundError, SecretParseError } from "@runfabric/secrets-core";
import type { AwsAdapterOptions, AwsGetSecretOutput } from "./aws-types.js";

export function getAwsCliBinaryPath(options: AwsAdapterOptions): string {
  return options.cli?.binaryPath ?? "aws";
}

export function buildAwsGetSecretInput(secretId: string, version?: string): { SecretId: string; VersionId?: string } {
  return {
    SecretId: secretId,
    ...(version ? { VersionId: version } : {})
  };
}

export function isAwsNotFoundError(error: unknown): boolean {
  const name = getErrorProperty(error, "name");
  const code = getErrorProperty(error, "Code");
  const message = error instanceof Error ? error.message : String(error);

  return (
    name === "ResourceNotFoundException" ||
    code === "ResourceNotFoundException" ||
    /resource\s+not\s+found/i.test(message)
  );
}

export function isAwsCliNotFound(stderr: string): boolean {
  return /ResourceNotFoundException|resource\s+not\s+found/i.test(stderr);
}

export function extractAwsSecretValue(key: string, output: AwsGetSecretOutput): unknown {
  if (typeof output.SecretString === "string") {
    return output.SecretString;
  }

  if (output.SecretBinary != null) {
    return decodeAwsSecretBinary(output.SecretBinary);
  }

  throw new SecretNotFoundError(key);
}

export function parseAwsCliJson(stdout: string, key: string): AwsGetSecretOutput {
  try {
    return JSON.parse(stdout) as AwsGetSecretOutput;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new SecretParseError(key, reason);
  }
}

export function decodeAwsSecretBinary(value: Uint8Array | string): string {
  if (typeof value === "string") {
    return Buffer.from(value, "base64").toString("utf8");
  }

  return Buffer.from(value).toString("utf8");
}

export function toIsoDate(value: Date | string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function getErrorProperty(error: unknown, key: "name" | "Code"): string | undefined {
  if (!error || typeof error !== "object" || !(key in error)) {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
