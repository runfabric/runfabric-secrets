import { spawn } from "node:child_process";
import {
  SecretNotFoundError,
  SecretParseError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type {
  VaultAdapterOptions,
  VaultCliExecutionOptions,
  VaultCliExecutionResult
} from "./vault-types.js";
import {
  extractVaultValue,
  getVaultCliBinaryPath,
  getVaultCliKvVersion,
  getVaultCliNamespace,
  getVaultCliTokenEnvVar,
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
  const kvVersion = getVaultCliKvVersion(options);

  if (request.version && kvVersion === 1) {
    throw new Error("Vault KV v1 does not support versioned secret reads.");
  }

  const args =
    kvVersion === 1
      ? ["read", "-format=json", path]
      : [
          "kv",
          "get",
          "-format=json",
          ...(request.version ? [`-version=${request.version}`] : []),
          path
        ];

  const executor = options.cli?.executor ?? executeVaultCli;
  const env = buildVaultCliEnv(context, options);
  const executionOptions = resolveCliExecutionOptions(options, request.signal);

  const result = await executor(binaryPath, args, context, env, executionOptions);

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
  const executionOptions = resolveCliExecutionOptions(options);

  try {
    const result = await executor(
      binaryPath,
      ["status", "-format=json"],
      context,
      env,
      executionOptions
    );

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
  env: NodeJS.ProcessEnv,
  executionOptions: VaultCliExecutionOptions = {}
): Promise<VaultCliExecutionResult> {
  if (executionOptions.signal?.aborted) {
    throw createAbortError("Vault CLI command was aborted before execution");
  }

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let terminationError: Error | null = null;
    const timeoutMs = executionOptions.timeoutMs ?? DEFAULT_VAULT_CLI_TIMEOUT_MS;
    const terminationGraceMs =
      executionOptions.terminationGraceMs ?? DEFAULT_VAULT_CLI_TERMINATION_GRACE_MS;
    const maxOutputBytes = executionOptions.maxOutputBytes ?? DEFAULT_VAULT_CLI_MAX_OUTPUT_BYTES;
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
      requestStop(createAbortError("Vault CLI command was aborted"));
    };

    const appendChunk = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const totalBytes = stdoutBytes + stderrBytes + chunk.length;
      if (maxOutputBytes > 0 && totalBytes > maxOutputBytes) {
        requestStop(new Error(`Vault CLI output exceeded ${maxOutputBytes} bytes`));
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
        requestStop(new Error(`Vault CLI command timed out after ${timeoutMs}ms`));
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

function buildVaultCliEnv(
  context: SecretAdapterContext,
  options: VaultAdapterOptions
): NodeJS.ProcessEnv {
  assertVaultCliEndpointIsSecure(options.url);

  const tokenEnvVar = getVaultCliTokenEnvVar(options);
  const token = options.cli?.token ?? context.env[tokenEnvVar];
  const namespace = getVaultCliNamespace(options);

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

const DEFAULT_VAULT_CLI_TIMEOUT_MS = 60_000;
const DEFAULT_VAULT_CLI_TERMINATION_GRACE_MS = 5_000;
const DEFAULT_VAULT_CLI_MAX_OUTPUT_BYTES = 1_048_576;

function resolveCliExecutionOptions(
  options: VaultAdapterOptions,
  signal?: AbortSignal
): VaultCliExecutionOptions {
  const timeoutMs = options.cli?.timeoutMs ?? DEFAULT_VAULT_CLI_TIMEOUT_MS;
  const terminationGraceMs =
    options.cli?.terminationGraceMs ?? DEFAULT_VAULT_CLI_TERMINATION_GRACE_MS;
  const maxOutputBytes =
    options.cli?.maxOutputBytes ?? DEFAULT_VAULT_CLI_MAX_OUTPUT_BYTES;

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

function assertVaultCliEndpointIsSecure(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error(`Vault CLI mode requires an HTTPS URL. Received '${url}'.`);
  }
}
