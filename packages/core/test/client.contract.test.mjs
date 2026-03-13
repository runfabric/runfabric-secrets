import test from "node:test";
import assert from "node:assert/strict";
import {
  SecretDuplicateAdapterError,
  SecretModeNotSupportedError,
  SecretNotFoundError,
  SecretParseError,
  createSecretClient
} from "../dist/index.js";

function createAdapter({ source, capabilities, values, mode = "native", hits }) {
  return {
    source,
    capabilities,
    async get(request) {
      hits.count += 1;

      if (!values.has(request.key)) {
        throw new SecretNotFoundError(request.key);
      }

      return {
        value: values.get(request.key),
        metadata: {
          source,
          mode
        }
      };
    }
  };
}

test("single source fetch", async () => {
  const hits = { count: 0 };
  const adapter = createAdapter({
    source: "env",
    capabilities: { native: true },
    values: new Map([["API_KEY", "abc123"]]),
    hits
  });

  const client = createSecretClient({ adapters: [adapter] });
  const result = await client.getValue({ source: "env", key: "API_KEY", required: true });

  assert.equal(result, "abc123");
  assert.equal(hits.count, 1);
});

test("fallback fetch uses next source when first misses", async () => {
  const first = createAdapter({
    source: "env",
    capabilities: { native: true },
    values: new Map(),
    hits: { count: 0 }
  });

  const second = createAdapter({
    source: "file",
    capabilities: { native: true },
    values: new Map([["TOKEN", "from-file"]]),
    hits: { count: 0 }
  });

  const client = createSecretClient({ adapters: [first, second] });

  const value = await client.getValue({
    sources: [{ source: "env" }, { source: "file" }],
    key: "TOKEN",
    required: true
  });

  assert.equal(value, "from-file");
});

test("required false returns empty result on missing secret", async () => {
  const adapter = createAdapter({
    source: "env",
    capabilities: { native: true },
    values: new Map(),
    hits: { count: 0 }
  });

  const client = createSecretClient({ adapters: [adapter] });
  const result = await client.get({ source: "env", key: "MISSING", required: false });

  assert.equal(result.value, undefined);
  assert.equal(result.metadata.source, "env");
});

test("required true throws on fallback miss", async () => {
  const envAdapter = createAdapter({
    source: "env",
    capabilities: { native: true },
    values: new Map(),
    hits: { count: 0 }
  });

  const fileAdapter = createAdapter({
    source: "file",
    capabilities: { native: true },
    values: new Map(),
    hits: { count: 0 }
  });

  const client = createSecretClient({ adapters: [envAdapter, fileAdapter] });

  await assert.rejects(
    () =>
      client.getValue({
        sources: [{ source: "env" }, { source: "file" }],
        key: "MISSING",
        required: true
      }),
    SecretNotFoundError
  );
});

test("parse modes raw/string/json", async () => {
  const adapter = createAdapter({
    source: "file",
    capabilities: { native: true, structuredData: true },
    values: new Map([
      ["RAW", { a: 1 }],
      ["STR", { a: 1 }],
      ["JSON", '{"a":1}'],
      ["BAD_JSON", "not-json"]
    ]),
    hits: { count: 0 }
  });

  const client = createSecretClient({ adapters: [adapter] });

  const raw = await client.getValue({ source: "file", key: "RAW", parseAs: "raw", required: true });
  assert.deepEqual(raw, { a: 1 });

  const asString = await client.getValue({ source: "file", key: "STR", parseAs: "string", required: true });
  assert.equal(asString, '{"a":1}');

  const asJson = await client.getValue({ source: "file", key: "JSON", parseAs: "json", required: true });
  assert.deepEqual(asJson, { a: 1 });

  await assert.rejects(
    () => client.getValue({ source: "file", key: "BAD_JSON", parseAs: "json", required: true }),
    SecretParseError
  );
});

test("in-memory cache and invalidate", async () => {
  const hits = { count: 0 };
  const adapter = createAdapter({
    source: "env",
    capabilities: { native: true },
    values: new Map([["CACHE_ME", "ok"]]),
    hits
  });

  const client = createSecretClient({
    adapters: [adapter],
    defaultCacheTtlMs: 60_000
  });

  const request = { source: "env", key: "CACHE_ME", required: true };

  await client.getValue(request);
  await client.getValue(request);
  assert.equal(hits.count, 1);

  await client.invalidate(request);
  await client.getValue(request);
  assert.equal(hits.count, 2);
});

test("source registry and mode support", async () => {
  const envAdapter = createAdapter({
    source: "env",
    capabilities: { native: true },
    values: new Map([["A", "x"]]),
    hits: { count: 0 }
  });

  const awsAdapter = createAdapter({
    source: "aws",
    capabilities: { api: true, cli: true },
    values: new Map([["A", "y"]]),
    mode: "api",
    hits: { count: 0 }
  });

  const client = createSecretClient({ adapters: [envAdapter, awsAdapter] });
  assert.deepEqual(client.listSources().sort(), ["aws", "env"]);

  await assert.rejects(
    () => client.getValue({ source: "env", mode: "api", key: "A", required: true }),
    SecretModeNotSupportedError
  );

  const apiValue = await client.getValue({ source: "aws", mode: "api", key: "A", required: true });
  assert.equal(apiValue, "y");
});

test("has propagates operational errors", async () => {
  const client = createSecretClient({
    adapters: [
      {
        source: "env",
        capabilities: { native: true },
        async get() {
          throw new Error("network offline");
        }
      }
    ]
  });

  await assert.rejects(
    () => client.has({ source: "env", key: "ANY_KEY" }),
    /network offline/
  );
});

test("duplicate source adapters throw during client creation", async () => {
  const first = createAdapter({
    source: "env",
    capabilities: { native: true },
    values: new Map(),
    hits: { count: 0 }
  });

  const second = createAdapter({
    source: "env",
    capabilities: { native: true },
    values: new Map(),
    hits: { count: 0 }
  });

  assert.throws(
    () => createSecretClient({ adapters: [first, second] }),
    SecretDuplicateAdapterError
  );
});
