import { readFile } from "node:fs/promises";
import {
  SecretNotFoundError,
  type SecretAdapter,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";

export interface FileAdapterOptions {
  filePath: string;
}

export function createFileAdapter(options: FileAdapterOptions): SecretAdapter {
  return {
    source: "file",
    capabilities: {
      native: true,
      structuredData: true
    },

    async get(
      request: SingleSourceSecretRequest,
      context: SecretAdapterContext
    ): Promise<SecretResult> {
      void context;
      const store = await readSecretStore(options.filePath);
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

async function readSecretStore(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return {};
  } catch {
    return {};
  }
}
