import { createSecretClient } from "./client.js";
import type { SecretClient, SecretClientOptions, SecretEnvironment } from "./types.js";

export type BrowserSecretClientOptions = Omit<SecretClientOptions, "env"> & {
  env?: SecretEnvironment;
};

export function createBrowserSecretClient(options: BrowserSecretClientOptions): SecretClient {
  return createSecretClient({
    ...options,
    env: options.env ?? {}
  });
}
