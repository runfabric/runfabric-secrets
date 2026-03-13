import { spawn } from "node:child_process";
import {
  SecretNotFoundError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type {
  AzureAdapterOptions,
  AzureCliExecutionOptions,
  AzureCliExecutionResult
} from "./azure-types.js";
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
  const result = await executor(
    binaryPath,
    args,
    context,
    resolveCliExecutionOptions(options, request.signal)
  );

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
  const executionOptions = resolveCliExecutionOptions(options);

  try {
    const result = await executor(binaryPath, ["version", "--output", "json"], context, executionOptions);
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
  context: SecretAdapterContext,
  executionOptions: AzureCliExecutionOptions = {}
): Promise<AzureCliExecutionResult> {
  if (executionOptions.signal?.aborted) {
    throw createAbortError("Azure CLI command was aborted before execution");
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
    const timeoutMs = executionOptions.timeoutMs ?? DEFAULT_AZURE_CLI_TIMEOUT_MS;
    const terminationGraceMs =
      executionOptions.terminationGraceMs ?? DEFAULT_AZURE_CLI_TERMINATION_GRACE_MS;
    const maxOutputBytes = executionOptions.maxOutputBytes ?? DEFAULT_AZURE_CLI_MAX_OUTPUT_BYTES;
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
      requestStop(createAbortError("Azure CLI command was aborted"));
    };

    const appendChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const totalBytes = stdoutBytes + stderrBytes + chunk.length;
      if (maxOutputBytes > 0 && totalBytes > maxOutputBytes) {
        requestStop(new Error(`Azure CLI output exceeded ${maxOutputBytes} bytes`));
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
        requestStop(new Error(`Azure CLI command timed out after ${timeoutMs}ms`));
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

const DEFAULT_AZURE_CLI_TIMEOUT_MS = 60_000;
const DEFAULT_AZURE_CLI_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_AZURE_CLI_MAX_OUTPUT_BYTES = 1_048_576;

function resolveCliExecutionOptions(
  options: AzureAdapterOptions,
  signal?: AbortSignal
): AzureCliExecutionOptions {
  const timeoutMs = options.cli?.timeoutMs ?? DEFAULT_AZURE_CLI_TIMEOUT_MS;
  const terminationGraceMs =
    options.cli?.terminationGraceMs ?? DEFAULT_AZURE_CLI_TERMINATION_GRACE_MS;
  const maxOutputBytes =
    options.cli?.maxOutputBytes ?? DEFAULT_AZURE_CLI_MAX_OUTPUT_BYTES;

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
