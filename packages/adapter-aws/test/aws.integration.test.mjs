import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretNotFoundError } from "@runfabric/secrets-core";
import {
  createAwsAdapter,
  executeAwsCli,
  loadFromAwsApi,
  loadFromAwsCli
} from "../dist/index.js";

test("AWS API provider reads real client response", async () => {
  const result = await loadFromAwsApi(
    { source: "aws", key: "prod/key", mode: "api", required: true },
    { now: Date.now, env: process.env },
    {
      region: "ap-southeast-1",
      api: {
        client: {
          async getSecretValue() {
            return {
              Name: "prod/key",
              VersionId: "v1",
              SecretString: "api-secret"
            };
          }
        }
      }
    }
  );

  assert.equal(result.value, "api-secret");
  assert.equal(result.metadata.source, "aws");
  assert.equal(result.metadata.mode, "api");
  assert.equal(result.metadata.version, "v1");
});

test("AWS API provider maps not found", async () => {
  await assert.rejects(
    () =>
      loadFromAwsApi(
        { source: "aws", key: "missing", mode: "api", required: true },
        { now: Date.now, env: process.env },
        {
          region: "ap-southeast-1",
          api: {
            client: {
              async getSecretValue() {
                const err = new Error("missing");
                err.name = "ResourceNotFoundException";
                throw err;
              }
            }
          }
        }
      ),
    SecretNotFoundError
  );
});

test("AWS API provider honors abort signals", async () => {
  const controller = new AbortController();
  const pending = loadFromAwsApi(
    { source: "aws", key: "abort-key", mode: "api", required: true, signal: controller.signal },
    { now: Date.now, env: process.env },
    {
      region: "ap-southeast-1",
      api: {
        client: {
          async getSecretValue() {
            return new Promise(() => {});
          }
        }
      }
    }
  );

  controller.abort();

  await assert.rejects(
    () => pending,
    (error) => error?.name === "AbortError"
  );
});

test("AWS CLI provider reads command JSON", async (t) => {
  const shimDir = await mkdtemp(join(tmpdir(), "aws-cli-shim-"));
  const shimPath = join(shimDir, "aws");

  await writeFile(
    shimPath,
    "#!/usr/bin/env node\nprocess.stdout.write(process.env.AWS_SHIM_OUT || '');\nprocess.stderr.write(process.env.AWS_SHIM_ERR || '');\nprocess.exit(Number(process.env.AWS_SHIM_CODE || 0));\n",
    "utf8"
  );
  await chmod(shimPath, 0o755);

  t.after(async () => {
    await rm(shimDir, { recursive: true, force: true });
  });

  const result = await loadFromAwsCli(
    { source: "aws", key: "cli/key", mode: "cli", required: true },
    {
      now: Date.now,
      env: {
        ...process.env,
        AWS_SHIM_OUT: JSON.stringify({
          Name: "cli/key",
          VersionId: "v2",
          SecretString: "cli-secret"
        })
      }
    },
    {
      region: "ap-southeast-1",
      cli: {
        binaryPath: shimPath
      }
    }
  );

  assert.equal(result.value, "cli-secret");
  assert.equal(result.metadata.mode, "cli");
  assert.equal(result.metadata.version, "v2");
});

test("AWS adapter healthCheck returns details", async () => {
  const adapter = createAwsAdapter({
    region: "ap-southeast-1",
    api: {
      client: {
        async send() {
          return {};
        }
      }
    },
    cli: {
      executor: async () => ({ stdout: "aws-cli/2.15.0", stderr: "", exitCode: 0 })
    }
  });

  const health = await adapter.healthCheck?.({ now: Date.now, env: process.env });

  assert.equal(health?.ok, true);
  assert.equal(typeof health?.details, "object");
});

test("AWS adapter healthCheck only probes configured mode", async () => {
  const adapter = createAwsAdapter({
    region: "ap-southeast-1",
    api: {
      client: {
        async send() {
          return {};
        }
      }
    }
  });

  const health = await adapter.healthCheck?.({ now: Date.now, env: process.env });
  const details = health?.details ?? {};

  assert.equal(health?.ok, true);
  assert.equal("api" in details, true);
  assert.equal("cli" in details, false);
});

test("AWS adapter capabilities reflect configured modes", () => {
  const apiOnly = createAwsAdapter({
    region: "ap-southeast-1",
    api: {
      client: {
        async getSecretValue() {
          return {
            SecretString: "value"
          };
        }
      }
    }
  });
  const cliOnly = createAwsAdapter({
    region: "ap-southeast-1",
    cli: {
      executor: async () => ({ stdout: "", stderr: "", exitCode: 0 })
    }
  });
  const implicit = createAwsAdapter({
    region: "ap-southeast-1"
  });

  assert.equal(apiOnly.capabilities.api, true);
  assert.equal(apiOnly.capabilities.cli, false);
  assert.equal(cliOnly.capabilities.api, false);
  assert.equal(cliOnly.capabilities.cli, true);
  assert.equal(implicit.capabilities.api, true);
  assert.equal(implicit.capabilities.cli, true);
});

test("AWS CLI executor enforces timeout and abort", async () => {
  await assert.rejects(
    () =>
      executeAwsCli(
        process.execPath,
        ["-e", "setTimeout(() => {}, 2000)"],
        { now: Date.now, env: process.env },
        { timeoutMs: 20 }
      ),
    /timed out/
  );

  const controller = new AbortController();
  const pending = executeAwsCli(
    process.execPath,
    ["-e", "setTimeout(() => {}, 2000)"],
    { now: Date.now, env: process.env },
    { signal: controller.signal, timeoutMs: 1_000 }
  );
  controller.abort();

  await assert.rejects(
    () => pending,
    (error) => error?.name === "AbortError"
  );
});

test("AWS CLI executor enforces output size limits", async () => {
  await assert.rejects(
    () =>
      executeAwsCli(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(5000))"],
        { now: Date.now, env: process.env },
        { maxOutputBytes: 1024, timeoutMs: 1_000 }
      ),
    /output exceeded/
  );
});
