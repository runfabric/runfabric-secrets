import type { SecretAdapterContext } from "@runfabric/secrets-core";

export interface AzureSecretPropertiesLike {
  version?: string;
  createdOn?: Date;
  updatedOn?: Date;
}

export interface AzureKeyVaultSecretLike {
  id?: string;
  name?: string;
  value?: unknown;
  properties?: AzureSecretPropertiesLike;
}

export interface AzureSecretClientLike {
  getSecret(
    name: string,
    options?: {
      version?: string;
    }
  ): Promise<AzureKeyVaultSecretLike>;
  listPropertiesOfSecrets?(): AsyncIterable<unknown>;
}

export interface AzureCliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type AzureCliExecutor = (
  binaryPath: string,
  args: string[],
  context: SecretAdapterContext
) => Promise<AzureCliExecutionResult>;

export interface AzureAdapterOptions {
  vaultUrl: string;
  vaultName?: string;
  api?: {
    client?: AzureSecretClientLike;
    credential?: unknown;
  };
  cli?: {
    binaryPath?: string;
    extraArgs?: string[];
    executor?: AzureCliExecutor;
  };
}
