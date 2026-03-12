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
    request: { name: string }
  ): Promise<[GcpAccessSecretVersionResponse] | GcpAccessSecretVersionResponse>;
  listSecrets?(request: { parent: string; pageSize?: number }): Promise<unknown>;
}

export interface GcpCliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type GcpCliExecutor = (
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext
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
  };
}
