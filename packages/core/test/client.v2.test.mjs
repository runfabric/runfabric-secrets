import test from "node:test";
import assert from "node:assert/strict";
import {
  SecretParseError,
  createBrowserSecretClient,
  createDistributedSecretCache,
  createSecretClient,
  createSecretClientWithDiscovery,
  discoverAdapters
} from "../dist/index.js";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createValueAdapter({ source, values, capabilities = { native: true }, delayMs = 0, error }) {
  return {
    source,
    capabilities,
    async get(request) {
      if (delayMs > 0) {
        await delay(delayMs);
      }

      if (error) {
        throw error;
      }

      return {
        value: values.get(request.key),
        metadata: {
          source,
          mode: capabilities.native ? "native" : "api"
        }
      };
    }
  };
}

test("background refresh updates cached secret", async () => {
  let counter = 0;

  const adapter = {
    source: "env",
    capabilities: { native: true },
    async get() {
      counter += 1;
      return {
        value: `value-${counter}`,
        metadata: {
          source: "env",
          mode: "native"
        }
      };
    }
  };

  const client = createSecretClient({
    adapters: [adapter],
    defaultCacheTtlMs: 10_000,
    backgroundRefresh: {
      enabled: true
    }
  });

  const first = await client.getValue({
    source: "env",
    key: "REFRESH_ME",
    required: true,
    refreshIntervalMs: 20
  });

  await delay(80);

  const second = await client.getValue({
    source: "env",
    key: "REFRESH_ME",
    required: true
  });

  assert.notEqual(first, second);
  assert.ok(second.startsWith("value-"));

  await client.dispose();
});

test("distributed cache prevents duplicate adapter reads", async () => {
  const backing = new Map();

  const distributedCache = createDistributedSecretCache({
    async get(key) {
      return backing.get(key) ?? null;
    },
    async set(key, value) {
      backing.set(key, value);
    },
    async delete(key) {
      backing.delete(key);
    },
    async clear() {
      backing.clear();
    }
  });

  let hits = 0;
  const adapter = {
    source: "env",
    capabilities: { native: true },
    async get() {
      hits += 1;
      return {
        value: "cached",
        metadata: {
          source: "env",
          mode: "native"
        }
      };
    }
  };

  const client = createSecretClient({
    adapters: [adapter],
    cache: distributedCache,
    defaultCacheTtlMs: 60_000
  });

  await client.getValue({ source: "env", key: "CACHE_KEY", required: true });
  await client.getValue({ source: "env", key: "CACHE_KEY", required: true });

  assert.equal(hits, 1);

  await client.dispose();
});

test("telemetry hooks receive request lifecycle events", async () => {
  const events = {
    start: 0,
    success: 0,
    cacheHit: 0,
    fallback: 0,
    error: 0,
    rotation: 0
  };

  const envAdapter = createValueAdapter({
    source: "env",
    values: new Map()
  });

  const fileAdapter = createValueAdapter({
    source: "file",
    values: new Map([["K", "v"]])
  });

  const client = createSecretClient({
    adapters: [envAdapter, fileAdapter],
    telemetry: {
      onRequestStart: () => {
        events.start += 1;
      },
      onRequestSuccess: () => {
        events.success += 1;
      },
      onRequestError: () => {
        events.error += 1;
      },
      onCacheHit: () => {
        events.cacheHit += 1;
      },
      onFallbackAttempt: () => {
        events.fallback += 1;
      },
      onRotation: () => {
        events.rotation += 1;
      }
    },
    defaultCacheTtlMs: 60_000
  });

  await client.getValue({
    sources: [
      { source: "env", weight: 1 },
      { source: "file", weight: 10 }
    ],
    key: "K",
    required: true,
    fallbackPolicy: {
      strategy: "weighted"
    }
  });

  await client.getValue({ source: "file", key: "K", required: true });

  assert.equal(events.start >= 2, true);
  assert.equal(events.success >= 2, true);
  assert.equal(events.fallback >= 1, true);
  assert.equal(events.cacheHit >= 1, true);
  assert.equal(events.error, 0);

  await client.dispose();
});

test("advanced fallback supports weighted and parallel strategies", async () => {
  const weightedClient = createSecretClient({
    adapters: [
      createValueAdapter({
        source: "env",
        values: new Map([["W", "from-env"]])
      }),
      createValueAdapter({
        source: "file",
        values: new Map([["W", "from-file"]])
      })
    ]
  });

  const weightedValue = await weightedClient.getValue({
    sources: [
      { source: "env", weight: 1 },
      { source: "file", weight: 10 }
    ],
    key: "W",
    required: true,
    fallbackPolicy: {
      strategy: "weighted"
    }
  });

  assert.equal(weightedValue, "from-file");

  const parallelClient = createSecretClient({
    adapters: [
      createValueAdapter({
        source: "env",
        values: new Map([["P", "slow"]]),
        delayMs: 60
      }),
      createValueAdapter({
        source: "file",
        values: new Map([["P", "fast"]]),
        delayMs: 5
      })
    ]
  });

  const parallelValue = await parallelClient.getValue({
    sources: [{ source: "env" }, { source: "file" }],
    key: "P",
    required: true,
    fallbackPolicy: {
      strategy: "parallel",
      parallelism: 2
    }
  });

  assert.equal(parallelValue, "fast");

  await weightedClient.dispose();
  await parallelClient.dispose();
});

test("fallback fail-fast stops on non-retryable errors", async () => {
  const parseError = new SecretParseError("BROKEN", "not json");

  const client = createSecretClient({
    adapters: [
      createValueAdapter({
        source: "env",
        values: new Map(),
        error: parseError
      }),
      createValueAdapter({
        source: "file",
        values: new Map([["BROKEN", "ok"]])
      })
    ]
  });

  await assert.rejects(
    () =>
      client.getValue({
        sources: [{ source: "env" }, { source: "file" }],
        key: "BROKEN",
        required: true,
        fallbackPolicy: {
          strategy: "sequential",
          failFast: true
        }
      }),
    SecretParseError
  );

  await client.dispose();
});

test("rotation orchestration executes hooks and returns rotated value", async () => {
  const adapter = createValueAdapter({
    source: "env",
    values: new Map([["ROTATE", "old"]])
  });

  const client = createSecretClient({ adapters: [adapter] });

  const stages = [];

  const rotated = await client.rotate(
    { source: "env", key: "ROTATE", required: true },
    {
      beforeRotate() {
        stages.push("before");
      },
      async rotate() {
        stages.push("rotate");
        return {
          value: "new",
          metadata: {
            source: "env",
            mode: "native"
          }
        };
      },
      verify() {
        stages.push("verify");
        return true;
      },
      afterRotate() {
        stages.push("after");
      }
    }
  );

  assert.equal(rotated.value, "new");
  assert.deepEqual(stages, ["before", "rotate", "verify", "after"]);

  await client.dispose();
});

test("adapter discovery can load adapters and build client", async () => {
  const importedModules = {
    "my-plugin": {
      createMyAdapter: () => ({
        source: "env",
        capabilities: { native: true },
        async get() {
          return {
            value: "discovered",
            metadata: {
              source: "env",
              mode: "native"
            }
          };
        }
      })
    }
  };

  const adapters = await discoverAdapters({
    plugins: [{ module: "my-plugin", exportName: "createMyAdapter" }],
    importer: async (moduleName) => importedModules[moduleName]
  });

  assert.equal(adapters.length, 1);

  const client = await createSecretClientWithDiscovery({
    discovery: {
      plugins: [{ module: "my-plugin", exportName: "createMyAdapter" }],
      importer: async (moduleName) => importedModules[moduleName]
    }
  });

  const value = await client.getValue({ source: "env", key: "X", required: true });
  assert.equal(value, "discovered");

  await client.dispose();
});

test("browser client helper creates client without process.env dependency", async () => {
  const browserClient = createBrowserSecretClient({
    env: {
      API_KEY: "browser-key"
    },
    adapters: [
      {
        source: "env",
        capabilities: { native: true },
        async get(request, context) {
          return {
            value: context.env[request.key],
            metadata: {
              source: "env",
              mode: "native"
            }
          };
        }
      }
    ]
  });

  const value = await browserClient.getValue({ source: "env", key: "API_KEY", required: true });
  assert.equal(value, "browser-key");

  await browserClient.dispose();
});
