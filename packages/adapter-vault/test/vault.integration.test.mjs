import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretNotFoundError } from "@runfabric/secrets-core";
import {
  createVaultAdapter,
  executeVaultCli,
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

test("Vault API provider rejects non-HTTPS URLs", async () => {
  await assert.rejects(
    () =>
      loadFromVaultApi(
        { source: "vault", key: "app/config", mode: "api", required: true },
        { now: Date.now, env: process.env },
        {
          url: "http://vault.example.local",
          mount: "secret",
          api: {
            fetcher: async () => jsonResponse(200, { data: { value: "x" } })
          }
        }
      ),
    /HTTPS URL/
  );
});

test("Vault API provider rejects path traversal keys", async () => {
  await assert.rejects(
    () =>
      loadFromVaultApi(
        { source: "vault", key: "../../../sys/health", mode: "api", required: true },
        { now: Date.now, env: process.env },
        {
          url: "https://vault.example.local",
          mount: "secret",
          api: {
            kvVersion: 2,
            fetcher: async () => jsonResponse(200, { data: { data: { value: "x" } } })
          }
        }
      ),
    /path traversal/
  );
});

test("Vault API provider forwards KV v2 version query", async () => {
  let seenVersion = null;

  const result = await loadFromVaultApi(
    { source: "vault", key: "app/config", mode: "api", required: true, version: "7" },
    { now: Date.now, env: process.env },
    {
      url: "https://vault.example.local",
      mount: "secret",
      api: {
        kvVersion: 2,
        fetcher: async (input) => {
          const url = new URL(String(input));
          seenVersion = url.searchParams.get("version");
          return jsonResponse(200, {
            data: {
              data: {
                value: "vault-api-secret-v7"
              },
              metadata: {
                version: 7
              }
            }
          });
        }
      }
    }
  );

  assert.equal(seenVersion, "7");
  assert.equal(result.metadata.version, "7");
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
      url: "https://127.0.0.1:8200",
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

test("Vault CLI provider forwards KV v2 version flag", async () => {
  let seenArgs = [];

  const result = await loadFromVaultCli(
    { source: "vault", key: "app/config", mode: "cli", required: true, version: "12" },
    { now: Date.now, env: process.env },
    {
      url: "https://127.0.0.1:8200",
      mount: "secret",
      cli: {
        kvVersion: 2,
        executor: async (_binaryPath, args) => {
          seenArgs = args;
          return {
            stdout: JSON.stringify({
              data: {
                data: {
                  value: "vault-cli-secret-v12"
                },
                metadata: {
                  version: 12
                }
              }
            }),
            stderr: "",
            exitCode: 0
          };
        }
      }
    }
  );

  assert.equal(seenArgs.includes("-version=12"), true);
  assert.equal(result.metadata.version, "12");
});

test("Vault CLI provider rejects version reads for KV v1", async () => {
  await assert.rejects(
    () =>
      loadFromVaultCli(
        { source: "vault", key: "app/config", mode: "cli", required: true, version: "1" },
        { now: Date.now, env: process.env },
        {
          url: "https://127.0.0.1:8200",
          mount: "secret",
          cli: {
            kvVersion: 1,
            executor: async () => ({ stdout: "", stderr: "", exitCode: 0 })
          }
        }
      ),
    /KV v1/
  );
});

test("Vault CLI provider rejects non-HTTPS URLs", async () => {
  await assert.rejects(
    () =>
      loadFromVaultCli(
        { source: "vault", key: "app/config", mode: "cli", required: true },
        { now: Date.now, env: process.env },
        {
          url: "http://127.0.0.1:8200",
          mount: "secret",
          cli: {
            executor: async () => ({ stdout: "", stderr: "", exitCode: 0 })
          }
        }
      ),
    /HTTPS URL/
  );
});

test("Vault providers resolve KV version by mode", async () => {
  const options = {
    url: "https://vault.example.local",
    mount: "secret",
    api: {
      kvVersion: 1,
      fetcher: async () =>
        jsonResponse(200, {
          data: {
            value: "api-v1"
          }
        })
    },
    cli: {
      kvVersion: 2,
      executor: async (_binaryPath, args) => ({
        stdout: JSON.stringify({
          data: {
            data: {
              value: "cli-v2"
            },
            metadata: {
              version: 55
            }
          }
        }),
        stderr: args.join(" "),
        exitCode: 0
      })
    }
  };

  const cliResult = await loadFromVaultCli(
    { source: "vault", key: "app/config", mode: "cli", required: true, version: "55" },
    { now: Date.now, env: process.env },
    options
  );
  assert.equal(cliResult.metadata.version, "55");

  await assert.rejects(
    () =>
      loadFromVaultApi(
        { source: "vault", key: "app/config", mode: "api", required: true, version: "55" },
        { now: Date.now, env: process.env },
        options
      ),
    /KV v1/
  );
});

test("Vault API provider ignores CLI token and namespace settings", async () => {
  let seenHeaders = null;

  await loadFromVaultApi(
    { source: "vault", key: "app/config", mode: "api", required: true },
    {
      now: Date.now,
      env: {
        CLI_TOKEN: "cli-token"
      }
    },
    {
      url: "https://vault.example.local",
      mount: "secret",
      api: {
        kvVersion: 2,
        fetcher: async (_input, init) => {
          const headers = new Headers(init?.headers);
          seenHeaders = {
            token: headers.get("X-Vault-Token"),
            namespace: headers.get("X-Vault-Namespace")
          };

          return jsonResponse(200, {
            data: {
              data: {
                value: "api-secret"
              },
              metadata: {
                version: 1
              }
            }
          });
        }
      },
      cli: {
        tokenEnvVar: "CLI_TOKEN",
        namespace: "cli-namespace"
      }
    }
  );

  assert.deepEqual(seenHeaders, {
    token: null,
    namespace: null
  });
});

test("Vault CLI provider ignores API token and namespace settings", async () => {
  let seenEnv = null;

  await loadFromVaultCli(
    { source: "vault", key: "app/config", mode: "cli", required: true },
    {
      now: Date.now,
      env: {
        CLI_TOKEN: "cli-token"
      }
    },
    {
      url: "https://vault.example.local",
      mount: "secret",
      api: {
        token: "api-token",
        namespace: "api-namespace"
      },
      cli: {
        kvVersion: 2,
        tokenEnvVar: "CLI_TOKEN",
        namespace: "cli-namespace",
        executor: async (_binaryPath, _args, _context, env) => {
          seenEnv = env;
          return {
            stdout: JSON.stringify({
              data: {
                data: {
                  value: "cli-secret"
                },
                metadata: {
                  version: 1
                }
              }
            }),
            stderr: "",
            exitCode: 0
          };
        }
      }
    }
  );

  assert.equal(seenEnv?.CLI_TOKEN, "cli-token");
  assert.equal(seenEnv?.VAULT_NAMESPACE, "cli-namespace");
  assert.equal(seenEnv?.VAULT_TOKEN, undefined);
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

test("Vault adapter healthCheck only probes configured mode", async () => {
  const adapter = createVaultAdapter({
    url: "https://vault.example.local",
    api: {
      fetcher: async () => jsonResponse(200, { initialized: true })
    }
  });

  const health = await adapter.healthCheck?.({ now: Date.now, env: process.env });
  const details = health?.details ?? {};

  assert.equal(health?.ok, true);
  assert.equal("api" in details, true);
  assert.equal("cli" in details, false);
});

test("Vault adapter capabilities reflect configured modes", () => {
  const apiOnly = createVaultAdapter({
    url: "https://vault.example.com",
    api: {
      fetcher: async () =>
        new Response(
          JSON.stringify({
            data: {
              data: {
                value: "api-value"
              },
              metadata: {
                version: 1
              }
            }
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json"
            }
          }
        )
    }
  });
  const cliOnly = createVaultAdapter({
    url: "https://vault.example.com",
    cli: {
      executor: async () => ({ stdout: "{\"data\":{}}", stderr: "", exitCode: 0 })
    }
  });
  const implicit = createVaultAdapter({
    url: "https://vault.example.com"
  });

  assert.equal(apiOnly.capabilities.api, true);
  assert.equal(apiOnly.capabilities.cli, false);
  assert.equal(cliOnly.capabilities.api, false);
  assert.equal(cliOnly.capabilities.cli, true);
  assert.equal(implicit.capabilities.api, true);
  assert.equal(implicit.capabilities.cli, true);
});

test("Vault adapter capability reflects KV versioning support", () => {
  const v2Adapter = createVaultAdapter({
    url: "https://vault.example.local",
    api: {
      kvVersion: 2,
      fetcher: async () => jsonResponse(200, { data: {} })
    }
  });

  const v1Adapter = createVaultAdapter({
    url: "https://vault.example.local",
    api: {
      kvVersion: 1,
      fetcher: async () => jsonResponse(200, { data: {} })
    }
  });

  assert.equal(v2Adapter.capabilities.versioning, true);
  assert.equal(v1Adapter.capabilities.versioning, false);

  const mixedAdapter = createVaultAdapter({
    url: "https://vault.example.local",
    api: {
      kvVersion: 1,
      fetcher: async () => jsonResponse(200, { data: {} })
    },
    cli: {
      kvVersion: 2,
      executor: async () => ({ stdout: "", stderr: "", exitCode: 0 })
    }
  });

  assert.equal(mixedAdapter.capabilities.versioning, true);
});

test("Vault CLI executor enforces timeout and abort", async () => {
  await assert.rejects(
    () =>
      executeVaultCli(
        process.execPath,
        ["-e", "setTimeout(() => {}, 2000)"],
        { now: Date.now, env: process.env },
        process.env,
        { timeoutMs: 20 }
      ),
    /timed out/
  );

  const controller = new AbortController();
  const pending = executeVaultCli(
    process.execPath,
    ["-e", "setTimeout(() => {}, 2000)"],
    { now: Date.now, env: process.env },
    process.env,
    { signal: controller.signal, timeoutMs: 1_000 }
  );
  controller.abort();

  await assert.rejects(
    () => pending,
    (error) => error?.name === "AbortError"
  );
});

test("Vault CLI executor enforces output size limits", async () => {
  await assert.rejects(
    () =>
      executeVaultCli(
        process.execPath,
        ["-e", "process.stdout.write('x'.repeat(5000))"],
        { now: Date.now, env: process.env },
        process.env,
        { maxOutputBytes: 1024, timeoutMs: 1_000 }
      ),
    /output exceeded/
  );
});
