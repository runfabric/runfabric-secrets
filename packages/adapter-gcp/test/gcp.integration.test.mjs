import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretNotFoundError } from "@runfabric/secrets-core";
import {
  createGcpAdapter,
  loadFromGcpApi,
  loadFromGcpCli
} from "../dist/index.js";

test("GCP API provider reads client response", async () => {
  const result = await loadFromGcpApi(
    { source: "gcp", key: "api-key", mode: "api", required: true },
    { now: Date.now, env: process.env },
    {
      projectId: "demo-project",
      api: {
        client: {
          async accessSecretVersion() {
            return [
              {
                name: "projects/demo-project/secrets/api-key/versions/7",
                payload: {
                  data: Buffer.from("gcp-api-secret").toString("base64")
                }
              }
            ];
          }
        }
      }
    }
  );

  assert.equal(result.value, "gcp-api-secret");
  assert.equal(result.metadata.source, "gcp");
  assert.equal(result.metadata.mode, "api");
  assert.equal(result.metadata.version, "7");
});

test("GCP API provider maps not found", async () => {
  await assert.rejects(
    () =>
      loadFromGcpApi(
        { source: "gcp", key: "missing", mode: "api", required: true },
        { now: Date.now, env: process.env },
        {
          projectId: "demo-project",
          api: {
            client: {
              async accessSecretVersion() {
                const error = new Error("NOT_FOUND: Secret was not found");
                error.code = 5;
                throw error;
              }
            }
          }
        }
      ),
    SecretNotFoundError
  );
});

test("GCP CLI provider reads command JSON", async (t) => {
  const shimDir = await mkdtemp(join(tmpdir(), "gcp-cli-shim-"));
  const shimPath = join(shimDir, "gcloud");

  await writeFile(
    shimPath,
    "#!/usr/bin/env node\nprocess.stdout.write(process.env.GCP_SHIM_OUT || '');\nprocess.stderr.write(process.env.GCP_SHIM_ERR || '');\nprocess.exit(Number(process.env.GCP_SHIM_CODE || 0));\n",
    "utf8"
  );
  await chmod(shimPath, 0o755);

  t.after(async () => {
    await rm(shimDir, { recursive: true, force: true });
  });

  const result = await loadFromGcpCli(
    { source: "gcp", key: "cli-key", mode: "cli", required: true },
    {
      now: Date.now,
      env: {
        ...process.env,
        GCP_SHIM_OUT: JSON.stringify({
          name: "projects/demo-project/secrets/cli-key/versions/9",
          payload: {
            data: Buffer.from("gcp-cli-secret").toString("base64")
          }
        })
      }
    },
    {
      projectId: "demo-project",
      cli: {
        binaryPath: shimPath
      }
    }
  );

  assert.equal(result.value, "gcp-cli-secret");
  assert.equal(result.metadata.mode, "cli");
  assert.equal(result.metadata.version, "9");
});

test("GCP adapter healthCheck returns details", async () => {
  const adapter = createGcpAdapter({
    projectId: "demo-project",
    api: {
      client: {
        async accessSecretVersion() {
          return [{ payload: { data: Buffer.from("ok").toString("base64") } }];
        },
        async listSecrets() {
          return {};
        }
      }
    },
    cli: {
      executor: async () => ({ stdout: "Google Cloud SDK 471.0.0", stderr: "", exitCode: 0 })
    }
  });

  const health = await adapter.healthCheck?.({ now: Date.now, env: process.env });
  assert.equal(health?.ok, true);
  assert.equal(typeof health?.details, "object");
});
