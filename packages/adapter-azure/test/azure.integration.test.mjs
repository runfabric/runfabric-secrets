import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretNotFoundError } from "@runfabric/secrets-core";
import {
  createAzureAdapter,
  loadFromAzureApi,
  loadFromAzureCli
} from "../dist/index.js";

test("Azure API provider reads client response", async () => {
  const result = await loadFromAzureApi(
    { source: "azure", key: "api-key", mode: "api", required: true },
    { now: Date.now, env: process.env },
    {
      vaultUrl: "https://demo-kv.vault.azure.net",
      api: {
        client: {
          async getSecret() {
            return {
              id: "https://demo-kv.vault.azure.net/secrets/api-key/version-1",
              value: "azure-api-secret",
              properties: {
                version: "version-1",
                createdOn: new Date("2026-03-13T00:00:00.000Z"),
                updatedOn: new Date("2026-03-13T01:00:00.000Z")
              }
            };
          }
        }
      }
    }
  );

  assert.equal(result.value, "azure-api-secret");
  assert.equal(result.metadata.source, "azure");
  assert.equal(result.metadata.mode, "api");
  assert.equal(result.metadata.version, "version-1");
});

test("Azure API provider maps not found", async () => {
  await assert.rejects(
    () =>
      loadFromAzureApi(
        { source: "azure", key: "missing", mode: "api", required: true },
        { now: Date.now, env: process.env },
        {
          vaultUrl: "https://demo-kv.vault.azure.net",
          api: {
            client: {
              async getSecret() {
                const error = new Error("SecretNotFound");
                error.statusCode = 404;
                throw error;
              }
            }
          }
        }
      ),
    SecretNotFoundError
  );
});

test("Azure CLI provider reads command JSON", async (t) => {
  const shimDir = await mkdtemp(join(tmpdir(), "azure-cli-shim-"));
  const shimPath = join(shimDir, "az");

  await writeFile(
    shimPath,
    "#!/usr/bin/env node\nprocess.stdout.write(process.env.AZ_SHIM_OUT || '');\nprocess.stderr.write(process.env.AZ_SHIM_ERR || '');\nprocess.exit(Number(process.env.AZ_SHIM_CODE || 0));\n",
    "utf8"
  );
  await chmod(shimPath, 0o755);

  t.after(async () => {
    await rm(shimDir, { recursive: true, force: true });
  });

  const result = await loadFromAzureCli(
    { source: "azure", key: "cli-key", mode: "cli", required: true },
    {
      now: Date.now,
      env: {
        ...process.env,
        AZ_SHIM_OUT: JSON.stringify({
          id: "https://demo-kv.vault.azure.net/secrets/cli-key/version-2",
          value: "azure-cli-secret",
          attributes: {
            created: 1700000000,
            updated: 1700000300
          }
        })
      }
    },
    {
      vaultUrl: "https://demo-kv.vault.azure.net",
      cli: {
        binaryPath: shimPath
      }
    }
  );

  assert.equal(result.value, "azure-cli-secret");
  assert.equal(result.metadata.mode, "cli");
});

test("Azure adapter healthCheck returns details", async () => {
  const adapter = createAzureAdapter({
    vaultUrl: "https://demo-kv.vault.azure.net",
    api: {
      client: {
        async getSecret() {
          return {
            value: "ok",
            properties: {}
          };
        },
        async *listPropertiesOfSecrets() {
          yield { name: "first" };
        }
      }
    },
    cli: {
      executor: async () => ({ stdout: "{\"azure-cli\":\"2.0\"}", stderr: "", exitCode: 0 })
    }
  });

  const health = await adapter.healthCheck?.({ now: Date.now, env: process.env });
  assert.equal(health?.ok, true);
  assert.equal(typeof health?.details, "object");
});
