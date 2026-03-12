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
  getSecretValue?(input: AwsGetSecretInput): Promise<AwsGetSecretOutput>;
  send?(command: unknown): Promise<AwsGetSecretOutput>;
}

export interface AwsCliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type AwsCliExecutor = (
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext
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
  };
}
