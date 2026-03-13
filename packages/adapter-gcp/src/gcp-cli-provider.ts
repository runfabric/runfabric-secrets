import { spawn } from "node:child_process";
import {
  SecretNotFoundError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type {
  GcpAdapterOptions,
  GcpCliExecutionOptions,
  GcpCliExecutionResult
} from "./gcp-types.js";
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
  const result = await executor(
    binaryPath,
    args,
    context,
    resolveCliExecutionOptions(options, request.signal)
  );

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
  context: SecretAdapterContext,
  executionOptions: GcpCliExecutionOptions = {}
): Promise<GcpCliExecutionResult> {
  if (executionOptions.signal?.aborted) {
    throw createAbortError("GCP CLI command was aborted before execution");
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
    const timeoutMs = executionOptions.timeoutMs ?? DEFAULT_GCP_CLI_TIMEOUT_MS;
    const terminationGraceMs =
      executionOptions.terminationGraceMs ?? DEFAULT_GCP_CLI_TERMINATION_GRACE_MS;
    const maxOutputBytes = executionOptions.maxOutputBytes ?? DEFAULT_GCP_CLI_MAX_OUTPUT_BYTES;
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
      requestStop(createAbortError("GCP CLI command was aborted"));
    };

    const appendChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const totalBytes = stdoutBytes + stderrBytes + chunk.length;
      if (maxOutputBytes > 0 && totalBytes > maxOutputBytes) {
        requestStop(new Error(`GCP CLI output exceeded ${maxOutputBytes} bytes`));
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
        requestStop(new Error(`GCP CLI command timed out after ${timeoutMs}ms`));
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

const DEFAULT_GCP_CLI_TIMEOUT_MS = 60_000;
const DEFAULT_GCP_CLI_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_GCP_CLI_MAX_OUTPUT_BYTES = 1_048_576;

function resolveCliExecutionOptions(
  options: GcpAdapterOptions,
  signal?: AbortSignal
): GcpCliExecutionOptions {
  const timeoutMs = options.cli?.timeoutMs ?? DEFAULT_GCP_CLI_TIMEOUT_MS;
  const terminationGraceMs =
    options.cli?.terminationGraceMs ?? DEFAULT_GCP_CLI_TERMINATION_GRACE_MS;
  const maxOutputBytes =
    options.cli?.maxOutputBytes ?? DEFAULT_GCP_CLI_MAX_OUTPUT_BYTES;

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
