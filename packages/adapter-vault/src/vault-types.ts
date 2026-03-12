import type { SecretAdapterContext } from "@runfabric/secrets-core";

export type VaultKvVersion = 1 | 2;

export interface VaultApiFetcher {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface VaultCliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type VaultCliExecutor = (
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext,
  env: NodeJS.ProcessEnv
) => Promise<VaultCliExecutionResult>;

export interface VaultAdapterOptions {
  url: string;
  mount?: string;
  api?: {
    token?: string;
    kvVersion?: VaultKvVersion;
    namespace?: string;
    fetcher?: VaultApiFetcher;
  };
  cli?: {
    binaryPath?: string;
    tokenEnvVar?: string;
    kvVersion?: VaultKvVersion;
    namespace?: string;
    executor?: VaultCliExecutor;
  };
}
