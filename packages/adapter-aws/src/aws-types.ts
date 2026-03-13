import type { SecretAdapterContext } from "@runfabric/secrets-core";

export interface AwsGetSecretInput {
  SecretId: string;
  VersionId?: string;
}

export interface AwsGetSecretOutput {
  ARN?: string;
  Name?: string;
  VersionId?: string;
  CreatedDate?: Date;
  SecretString?: string;
  SecretBinary?: Uint8Array | string;
}

export interface AwsSecretsManagerClientLike {
  getSecretValue?(
    input: AwsGetSecretInput,
    options?: {
      abortSignal?: AbortSignal;
    }
  ): Promise<AwsGetSecretOutput>;
  send?(
    command: unknown,
    options?: {
      abortSignal?: AbortSignal;
    }
  ): Promise<AwsGetSecretOutput>;
}

export interface AwsCliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface AwsCliExecutionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  terminationGraceMs?: number;
  maxOutputBytes?: number;
}

export type AwsCliExecutor = (
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext,
  options?: AwsCliExecutionOptions
) => Promise<AwsCliExecutionResult>;

export interface AwsAdapterOptions {
  region: string;
  api?: {
    client?: AwsSecretsManagerClientLike;
    endpoint?: string;
  };
  cli?: {
    binaryPath?: string;
    extraArgs?: string[];
    executor?: AwsCliExecutor;
    timeoutMs?: number;
    terminationGraceMs?: number;
    maxOutputBytes?: number;
  };
}
