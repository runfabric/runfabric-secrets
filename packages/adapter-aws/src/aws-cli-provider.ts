import { spawn } from "node:child_process";
import {
  SecretNotFoundError,
  SecretParseError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { AwsAdapterOptions, AwsCliExecutionResult } from "./aws-types.js";
import {
  extractAwsSecretValue,
  getAwsCliBinaryPath,
  isAwsCliNotFound,
  parseAwsCliJson,
  toIsoDate
} from "./aws-utils.js";

export async function loadFromAwsCli(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: AwsAdapterOptions
): Promise<SecretResult> {
  const binaryPath = getAwsCliBinaryPath(options);
  const args = [
    ...(options.cli?.extraArgs ?? []),
    "secretsmanager",
    "get-secret-value",
    "--region",
    options.region,
    "--secret-id",
    request.key,
    "--output",
    "json",
    ...(request.version ? ["--version-id", request.version] : [])
  ];

  const executor = options.cli?.executor ?? executeAwsCli;
  const result = await executor(binaryPath, args, context);

  if (result.exitCode !== 0) {
    if (isAwsCliNotFound(result.stderr)) {
      throw new SecretNotFoundError(request.key);
    }

    throw new Error(
      `AWS CLI command failed (exit ${String(result.exitCode)}): ${result.stderr.trim()}`
    );
  }

  const payload = parseAwsCliJson(result.stdout, request.key);
  const value = extractAwsSecretValue(request.key, payload);

  return {
    value,
    metadata: {
      source: "aws",
      mode: "cli",
      version: payload.VersionId ?? request.version,
      createdAt: toIsoDate(payload.CreatedDate),
      raw: {
        region: options.region,
        binaryPath,
        arn: payload.ARN,
        name: payload.Name
      }
    }
  };
}

export async function executeAwsCli(
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext
): Promise<AwsCliExecutionResult> {
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

export function parseAwsVersionOutput(stdout: string): string {
  const line = stdout.trim();
  if (!line) {
    throw new SecretParseError("aws --version", "Empty output");
  }

  return line;
}

export async function checkAwsCliHealth(
  context: SecretAdapterContext,
  options: AwsAdapterOptions
): Promise<{ ok: boolean; details?: unknown }> {
  const binaryPath = getAwsCliBinaryPath(options);
  const executor = options.cli?.executor ?? executeAwsCli;

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
        version: parseAwsVersionOutput(result.stdout || result.stderr)
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
