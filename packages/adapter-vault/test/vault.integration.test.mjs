import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretNotFoundError } from "@runfabric/secrets-core";
import {
  createVaultAdapter,
  loadFromVaultApi,
  loadFromVaultCli
} from "../dist/index.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

test("Vault API provider reads fixture response", async () => {
  const result = await loadFromVaultApi(
    { source: "vault", key: "app/config", mode: "api", required: true },
    { now: Date.now, env: process.env },
    {
      url: "https://vault.example.local",
      mount: "secret",
      api: {
        kvVersion: 2,
        fetcher: async (input) => {
          const url = String(input);
          if (!url.includes("/v1/secret/data/app/config")) {
            return jsonResponse(404, { error: "not found" });
          }

          return jsonResponse(200, {
            data: {
              data: {
                value: "vault-api-secret"
              },
              metadata: {
                version: 3,
                created_time: "2026-03-13T00:00:00.000Z",
                updated_time: "2026-03-13T01:00:00.000Z"
              }
            }
          });
        }
      }
    }
  );

  assert.equal(result.value, "vault-api-secret");
  assert.equal(result.metadata.source, "vault");
  assert.equal(result.metadata.mode, "api");
  assert.equal(result.metadata.version, "3");
});

test("Vault API provider maps not found", async () => {
  await assert.rejects(
    () =>
      loadFromVaultApi(
        { source: "vault", key: "missing", mode: "api", required: true },
        { now: Date.now, env: process.env },
        {
          url: "https://vault.example.local",
          mount: "secret",
          api: {
            kvVersion: 2,
            fetcher: async () => jsonResponse(404, { errors: ["not found"] })
          }
        }
      ),
    SecretNotFoundError
  );
});

test("Vault CLI provider reads command JSON", async (t) => {
  const shimDir = await mkdtemp(join(tmpdir(), "vault-cli-shim-"));
  const shimPath = join(shimDir, "vault");

  await writeFile(
    shimPath,
    "#!/usr/bin/env node\nprocess.stdout.write(process.env.VAULT_SHIM_OUT || '');\nprocess.stderr.write(process.env.VAULT_SHIM_ERR || '');\nprocess.exit(Number(process.env.VAULT_SHIM_CODE || 0));\n",
    "utf8"
  );
  await chmod(shimPath, 0o755);

  t.after(async () => {
    await rm(shimDir, { recursive: true, force: true });
  });

  const result = await loadFromVaultCli(
    { source: "vault", key: "app/config", mode: "cli", required: true },
    {
      now: Date.now,
      env: {
        ...process.env,
        VAULT_SHIM_OUT: JSON.stringify({
          data: {
            data: {
              value: "vault-cli-secret"
            },
            metadata: {
              version: 4
            }
          }
        })
      }
    },
    {
      url: "http://127.0.0.1:8200",
      mount: "secret",
      cli: {
        binaryPath: shimPath,
        kvVersion: 2
      }
    }
  );

  assert.equal(result.value, "vault-cli-secret");
  assert.equal(result.metadata.mode, "cli");
  assert.equal(result.metadata.version, "4");
});

test("Vault adapter healthCheck returns details", async () => {
  const adapter = createVaultAdapter({
    url: "https://vault.example.local",
    api: {
      fetcher: async (input) => {
        const url = String(input);
        if (url.includes("/v1/sys/health")) {
          return jsonResponse(200, { initialized: true, sealed: false });
        }

        return jsonResponse(404, { errors: ["not found"] });
      }
    },
    cli: {
      executor: async () => ({ stdout: "{\"ok\":true}", stderr: "", exitCode: 0 })
    }
  });

  const health = await adapter.healthCheck?.({ now: Date.now, env: process.env });

  assert.equal(health?.ok, true);
  assert.equal(typeof health?.details, "object");
});
