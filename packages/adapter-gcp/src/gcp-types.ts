import type { SecretAdapterContext } from "@runfabric/secrets-core";

export interface GcpSecretPayload {
  data?: Uint8Array | Buffer | string | null;
}

export interface GcpAccessSecretVersionResponse {
  name?: string;
  payload?: GcpSecretPayload;
  createTime?: string;
}

export interface GcpSecretManagerClientLike {
  accessSecretVersion?(
    request: { name: string },
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<[GcpAccessSecretVersionResponse] | GcpAccessSecretVersionResponse>;
  listSecrets?(
    request: { parent: string; pageSize?: number },
    options?: {
      signal?: AbortSignal;
    }
  ): Promise<unknown>;
}

export interface GcpCliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface GcpCliExecutionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  terminationGraceMs?: number;
  maxOutputBytes?: number;
}

export type GcpCliExecutor = (
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext,
  options?: GcpCliExecutionOptions
) => Promise<GcpCliExecutionResult>;

export interface GcpAdapterOptions {
  projectId: string;
  api?: {
    client?: GcpSecretManagerClientLike;
    endpoint?: string;
  };
  cli?: {
    binaryPath?: string;
    extraArgs?: string[];
    executor?: GcpCliExecutor;
    timeoutMs?: number;
    terminationGraceMs?: number;
    maxOutputBytes?: number;
  };
}
