import { spawn } from "node:child_process";
import {
  SecretNotFoundError,
  SecretParseError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type {
  AwsAdapterOptions,
  AwsCliExecutionOptions,
  AwsCliExecutionResult
} from "./aws-types.js";
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
  const result = await executor(
    binaryPath,
    args,
    context,
    resolveCliExecutionOptions(options, request.signal)
  );

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
  context: SecretAdapterContext,
  executionOptions: AwsCliExecutionOptions = {}
): Promise<AwsCliExecutionResult> {
  if (executionOptions.signal?.aborted) {
    throw createAbortError("AWS CLI command was aborted before execution");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      env: context.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let terminationError: Error | null = null;
    const timeoutMs = executionOptions.timeoutMs ?? DEFAULT_AWS_CLI_TIMEOUT_MS;
    const terminationGraceMs =
      executionOptions.terminationGraceMs ?? DEFAULT_AWS_CLI_TERMINATION_GRACE_MS;
    const maxOutputBytes = executionOptions.maxOutputBytes ?? DEFAULT_AWS_CLI_MAX_OUTPUT_BYTES;
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;

      if (timeout) {
        clearTimeout(timeout);
      }

      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }

      if (executionOptions.signal) {
        executionOptions.signal.removeEventListener("abort", onAbort);
      }

      handler();
    };

    const requestStop = (error: Error) => {
      if (terminationError) {
        return;
      }

      terminationError = error;
      child.kill("SIGTERM");

      if (terminationGraceMs > 0) {
        forceKillTimer = setTimeout(() => {
          child.kill("SIGKILL");
        }, terminationGraceMs);

        if (typeof forceKillTimer.unref === "function") {
          forceKillTimer.unref();
        }
      }
    };

    const onAbort = () => {
      requestStop(createAbortError("AWS CLI command was aborted"));
    };

    const appendChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const totalBytes = stdoutBytes + stderrBytes + chunk.length;
      if (maxOutputBytes > 0 && totalBytes > maxOutputBytes) {
        requestStop(new Error(`AWS CLI output exceeded ${maxOutputBytes} bytes`));
        return;
      }

      const text = chunk.toString("utf8");
      if (stream === "stdout") {
        stdoutBytes += chunk.length;
        stdout += text;
        return;
      }

      stderrBytes += chunk.length;
      stderr += text;
    };

    child.stdout.on("data", (chunk: Buffer) => {
      appendChunk("stdout", chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      appendChunk("stderr", chunk);
    });

    if (executionOptions.signal) {
      executionOptions.signal.addEventListener("abort", onAbort, { once: true });
    }

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        requestStop(new Error(`AWS CLI command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      if (typeof timeout.unref === "function") {
        timeout.unref();
      }
    }

    child.on("error", (error) => {
      finish(() => {
        reject(terminationError ?? error);
      });
    });

    child.on("close", (exitCode) => {
      finish(() => {
        if (terminationError) {
          reject(terminationError);
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode
        });
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
  const executionOptions = resolveCliExecutionOptions(options);

  try {
    const result = await executor(binaryPath, ["--version"], context, executionOptions);
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

const DEFAULT_AWS_CLI_TIMEOUT_MS = 60_000;
const DEFAULT_AWS_CLI_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_AWS_CLI_MAX_OUTPUT_BYTES = 1_048_576;

function resolveCliExecutionOptions(
  options: AwsAdapterOptions,
  signal?: AbortSignal
): AwsCliExecutionOptions {
  const timeoutMs = options.cli?.timeoutMs ?? DEFAULT_AWS_CLI_TIMEOUT_MS;
  const terminationGraceMs =
    options.cli?.terminationGraceMs ?? DEFAULT_AWS_CLI_TERMINATION_GRACE_MS;
  const maxOutputBytes =
    options.cli?.maxOutputBytes ?? DEFAULT_AWS_CLI_MAX_OUTPUT_BYTES;

  return {
    signal,
    timeoutMs: Math.max(0, Math.floor(timeoutMs)),
    terminationGraceMs: Math.max(0, Math.floor(terminationGraceMs)),
    maxOutputBytes: Math.max(0, Math.floor(maxOutputBytes))
  };
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
