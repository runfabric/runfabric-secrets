import test from "node:test";
import assert from "node:assert/strict";
import { InMemorySecretCache, createDistributedSecretCache } from "../dist/index.js";

function createEntry(value, expiresAt = Date.now() + 30_000) {
  return {
    expiresAt,
    result: {
      value,
      metadata: {
        source: "env",
        mode: "native"
      }
    }
  };
}

test("in-memory cache evicts oldest entries when maxEntries is reached", () => {
  const cache = new InMemorySecretCache({ maxEntries: 1 });
  cache.set("first", createEntry("first"));
  cache.set("second", createEntry("second"));

  assert.equal(cache.get("first"), null);
  assert.equal(cache.get("second")?.result.value, "second");
});

test("in-memory cache prunes expired entries during writes", () => {
  const cache = new InMemorySecretCache({ maxEntries: 2 });
  cache.set("expired", createEntry("expired", Date.now() - 1));
  cache.set("fresh", createEntry("fresh"));
  cache.set("new", createEntry("new"));

  assert.equal(cache.get("expired"), null);
  assert.equal(cache.get("fresh")?.result.value, "fresh");
  assert.equal(cache.get("new")?.result.value, "new");
});

test("distributed cache drops malformed cache entries", async () => {
  const backing = new Map([
    [
      "bad-key",
      JSON.stringify({
        expiresAt: "not-a-number",
        result: {
          metadata: {
            source: "env",
            mode: "native"
          }
        }
      })
    ]
  ]);

  const removed = [];

  const cache = createDistributedSecretCache({
    async get(key) {
      return backing.get(key) ?? null;
    },
    async set(key, value) {
      backing.set(key, value);
    },
    async delete(key) {
      removed.push(key);
      backing.delete(key);
    }
  });

  const value = await cache.get("bad-key");

  assert.equal(value, null);
  assert.deepEqual(removed, ["bad-key"]);
});
