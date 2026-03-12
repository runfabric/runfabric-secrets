import { spawn } from "node:child_process";
import {
  SecretNotFoundError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { GcpAdapterOptions, GcpCliExecutionResult } from "./gcp-types.js";
import {
  getGcpCliBinaryPath,
  isGcpCliNotFound,
  parseGcpCliValue,
  parseGcpVersionOutput,
  resolveGcpSecretId
} from "./gcp-utils.js";

export async function loadFromGcpCli(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: GcpAdapterOptions
): Promise<SecretResult> {
  const binaryPath = getGcpCliBinaryPath(options);
  const secretId = resolveGcpSecretId(request.key);
  const args = [
    ...(options.cli?.extraArgs ?? []),
    "secrets",
    "versions",
    "access",
    request.version ?? "latest",
    "--secret",
    secretId,
    "--project",
    options.projectId,
    "--format",
    "json"
  ];

  const executor = options.cli?.executor ?? executeGcpCli;
  const result = await executor(binaryPath, args, context);

  if (result.exitCode !== 0) {
    if (isGcpCliNotFound(result.stderr)) {
      throw new SecretNotFoundError(request.key);
    }

    throw new Error(
      `GCP CLI command failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`
    );
  }

  const parsed = parseGcpCliValue(result.stdout, request.key);

  return {
    value: parsed.value,
    metadata: {
      source: "gcp",
      mode: "cli",
      version: request.version ?? parsed.version,
      raw: {
        projectId: options.projectId,
        secretId,
        binaryPath
      }
    }
  };
}

export async function checkGcpCliHealth(
  context: SecretAdapterContext,
  options: GcpAdapterOptions
): Promise<{ ok: boolean; details?: unknown }> {
  const binaryPath = getGcpCliBinaryPath(options);
  const executor = options.cli?.executor ?? executeGcpCli;

  try {
    const result = await executor(binaryPath, ["--version"], context);
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
        version: parseGcpVersionOutput(result.stdout || result.stderr)
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

export async function executeGcpCli(
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext
): Promise<GcpCliExecutionResult> {
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
