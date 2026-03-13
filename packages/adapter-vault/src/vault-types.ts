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

export interface VaultCliExecutionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  terminationGraceMs?: number;
  maxOutputBytes?: number;
}

export type VaultCliExecutor = (
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext,
  env: NodeJS.ProcessEnv,
  options?: VaultCliExecutionOptions
) => Promise<VaultCliExecutionResult>;

export interface VaultAdapterOptions {
  url: string;
  mount?: string;
  api?: {
    token?: string;
    tokenEnvVar?: string;
    kvVersion?: VaultKvVersion;
    namespace?: string;
    fetcher?: VaultApiFetcher;
  };
  cli?: {
    binaryPath?: string;
    token?: string;
    tokenEnvVar?: string;
    kvVersion?: VaultKvVersion;
    namespace?: string;
    executor?: VaultCliExecutor;
    timeoutMs?: number;
    terminationGraceMs?: number;
    maxOutputBytes?: number;
  };
}
