import { spawn } from "node:child_process";
import {
  SecretNotFoundError,
  SecretParseError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { VaultAdapterOptions, VaultCliExecutionResult } from "./vault-types.js";
import {
  extractVaultValue,
  getVaultCliBinaryPath,
  getVaultKvVersion,
  getVaultNamespace,
  getVaultTokenEnvVar,
  isVaultCliNotFound,
  parseVaultApiResponse,
  resolveVaultPath
} from "./vault-utils.js";

export async function loadFromVaultCli(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: VaultAdapterOptions
): Promise<SecretResult> {
  const binaryPath = getVaultCliBinaryPath(options);
  const path = resolveVaultPath(request.key, options.mount);
  const kvVersion = getVaultKvVersion(options);
  const args =
    kvVersion === 1
      ? ["read", "-format=json", path]
      : ["kv", "get", "-format=json", path];

  const executor = options.cli?.executor ?? executeVaultCli;
  const env = buildVaultCliEnv(context, options);

  const result = await executor(binaryPath, args, context, env);

  if (result.exitCode !== 0) {
    if (isVaultCliNotFound(result.stderr)) {
      throw new SecretNotFoundError(request.key);
    }

    throw new Error(
      `Vault CLI command failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`
    );
  }

  const body = parseVaultCliJson(result.stdout, request.key);
  const { payload, metadata } = parseVaultApiResponse(body, kvVersion);
  const value = extractVaultValue(request.key, payload);

  return {
    value,
    metadata: {
      source: "vault",
      mode: "cli",
      version: request.version ?? metadata.version,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      raw: {
        url: options.url,
        path,
        kvVersion,
        binaryPath
      }
    }
  };
}

export async function checkVaultCliHealth(
  context: SecretAdapterContext,
  options: VaultAdapterOptions
): Promise<{ ok: boolean; details?: unknown }> {
  const binaryPath = getVaultCliBinaryPath(options);
  const executor = options.cli?.executor ?? executeVaultCli;
  const env = buildVaultCliEnv(context, options);

  try {
    const result = await executor(binaryPath, ["status", "-format=json"], context, env);

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
        output: result.stdout.trim()
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

export async function executeVaultCli(
  binaryPath: string,
  args: string[],
  _context: SecretAdapterContext,
  env: NodeJS.ProcessEnv
): Promise<VaultCliExecutionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      env,
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

function buildVaultCliEnv(
  context: SecretAdapterContext,
  options: VaultAdapterOptions
): NodeJS.ProcessEnv {
  const tokenEnvVar = getVaultTokenEnvVar(options);
  const token = options.api?.token ?? context.env[tokenEnvVar];
  const namespace = getVaultNamespace(options);

  return {
    ...context.env,
    VAULT_ADDR: options.url,
    ...(token ? { [tokenEnvVar]: token } : {}),
    ...(namespace ? { VAULT_NAMESPACE: namespace } : {})
  };
}

function parseVaultCliJson(stdout: string, key: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid JSON";
    throw new SecretParseError(key, reason);
  }
}
