import { spawn } from "node:child_process";
import {
  SecretNotFoundError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { AzureAdapterOptions, AzureCliExecutionResult } from "./azure-types.js";
import {
  extractAzureSecretValue,
  getAzureCliBinaryPath,
  isAzureCliNotFound,
  parseAzureCliOutput,
  parseAzureVersionOutput,
  resolveAzureSecretName,
  resolveAzureVaultName,
  toIsoDate
} from "./azure-utils.js";

export async function loadFromAzureCli(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: AzureAdapterOptions
): Promise<SecretResult> {
  const binaryPath = getAzureCliBinaryPath(options);
  const vaultName = resolveAzureVaultName(options);
  const secretName = resolveAzureSecretName(request.key);
  const args = [
    ...(options.cli?.extraArgs ?? []),
    "keyvault",
    "secret",
    "show",
    "--vault-name",
    vaultName,
    "--name",
    secretName,
    "--output",
    "json",
    ...(request.version ? ["--version", request.version] : [])
  ];

  const executor = options.cli?.executor ?? executeAzureCli;
  const result = await executor(binaryPath, args, context);

  if (result.exitCode !== 0) {
    if (isAzureCliNotFound(result.stderr)) {
      throw new SecretNotFoundError(request.key);
    }

    throw new Error(
      `Azure CLI command failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`
    );
  }

  const payload = parseAzureCliOutput(result.stdout, request.key);
  const value = extractAzureSecretValue(request.key, payload);

  return {
    value,
    metadata: {
      source: "azure",
      mode: "cli",
      version: request.version,
      createdAt: toIsoDate(payload.attributes?.created),
      updatedAt: toIsoDate(payload.attributes?.updated),
      raw: {
        vaultName,
        secretName,
        binaryPath,
        id: payload.id
      }
    }
  };
}

export async function checkAzureCliHealth(
  context: SecretAdapterContext,
  options: AzureAdapterOptions
): Promise<{ ok: boolean; details?: unknown }> {
  const binaryPath = getAzureCliBinaryPath(options);
  const executor = options.cli?.executor ?? executeAzureCli;

  try {
    const result = await executor(binaryPath, ["version", "--output", "json"], context);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        details: {
          mode: "cli",
          binaryPath,
          stderr: result.stderr.trim()
        }
      };
    }

    return {
      ok: true,
      details: {
        mode: "cli",
        binaryPath,
        version: parseAzureVersionOutput(result.stdout)
      }
    };
  } catch (error) {
    return {
      ok: false,
      details: {
        mode: "cli",
        binaryPath,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

export async function executeAzureCli(
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext
): Promise<AzureCliExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      env: context.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", reject);

    child.on("close", (exitCode) => {
      resolve({
        stdout,
        stderr,
        exitCode
      });
    });
  });
}
