import { readFile, stat } from "node:fs/promises";
import {
  SecretNotFoundError,
  SecretParseError,
  type SecretAdapter,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";

export interface FileAdapterOptions {
  filePath: string;
}

interface SecretStoreSnapshot {
  fingerprint: string;
  store: Record<string, unknown>;
}

export function createFileAdapter(options: FileAdapterOptions): SecretAdapter {
  let snapshot: SecretStoreSnapshot | null = null;

  return {
    source: "file",
    capabilities: {
      native: true,
      structuredData: true
    },

    async get(request: SingleSourceSecretRequest): Promise<SecretResult> {
      const nextSnapshot = await readSecretStore(
        options.filePath,
        request.key,
        snapshot,
        request.signal
      );
      snapshot = nextSnapshot;
      const store = nextSnapshot.store;

      if (!(request.key in store)) {
        throw new SecretNotFoundError(request.key);
      }

      return {
        value: store[request.key],
        metadata: {
          source: "file",
          mode: "native",
          version: request.version,
          raw: {
            filePath: options.filePath
          }
        }
      };
    }
  };
}

async function readSecretStore(
  filePath: string,
  key: string,
  previousSnapshot: SecretStoreSnapshot | null,
  signal?: AbortSignal
): Promise<SecretStoreSnapshot> {
  throwIfAborted(signal);
  const fingerprint = await readFileFingerprint(filePath, key, signal);
  if (previousSnapshot?.fingerprint === fingerprint) {
    return previousSnapshot;
  }

  const raw = await readFileContents(filePath, key, signal);
  const store = parseSecretStore(filePath, key, raw);

  return {
    fingerprint,
    store
  };
}

async function readFileFingerprint(filePath: string, key: string, signal?: AbortSignal): Promise<string> {
  try {
    throwIfAborted(signal);
    const details = await stat(filePath);
    throwIfAborted(signal);
    return `${details.dev}:${details.ino}:${details.size}:${details.mtimeMs}:${details.ctimeMs}`;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new Error(
      `Failed to read file adapter metadata from '${filePath}' for key '${key}': ${formatError(error)}`
    );
  }
}

async function readFileContents(filePath: string, key: string, signal?: AbortSignal): Promise<string> {
  try {
    throwIfAborted(signal);
    return await readFile(filePath, { encoding: "utf8", signal });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    throw new Error(
      `Failed to read file adapter data from '${filePath}' for key '${key}': ${formatError(error)}`
    );
  }
}

function parseSecretStore(filePath: string, key: string, raw: string): Record<string, unknown> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new SecretParseError(
      key,
      `invalid JSON in '${filePath}': ${error instanceof Error ? error.message : "unknown parse error"}`
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new SecretParseError(
      key,
      `expected a JSON object at the root of '${filePath}'`
    );
  }

  return parsed as Record<string, unknown>;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  const error = new Error("File adapter request was aborted");
  error.name = "AbortError";
  throw error;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
