import test from "node:test";
import assert from "node:assert/strict";
import {
  fallbackSecretRequestSchema,
  parseSecretRequest,
  secretResultSchema
} from "../dist/index.js";

test("parseSecretRequest accepts single-source request", () => {
  const parsed = parseSecretRequest({
    source: "env",
    key: "API_KEY",
    required: true,
    parseAs: "string",
    refreshIntervalMs: 1_000
  });

  assert.equal(parsed.source, "env");
  assert.equal(parsed.key, "API_KEY");
  assert.equal(parsed.parseAs, "string");
  assert.equal(parsed.refreshIntervalMs, 1_000);
});

test("parseSecretRequest preserves signal on single-source request", () => {
  const controller = new AbortController();
  const parsed = parseSecretRequest({
    source: "env",
    key: "API_KEY",
    signal: controller.signal
  });

  assert.equal(parsed.signal, controller.signal);
});

test("fallbackSecretRequestSchema rejects empty sources", () => {
  assert.throws(() =>
    fallbackSecretRequestSchema.parse({
      key: "TOKEN",
      sources: []
    })
  );
});

test("parseSecretRequest accepts fallback policy and weighted sources", () => {
  const parsed = parseSecretRequest({
    key: "TOKEN",
    refreshIntervalMs: 5_000,
    sources: [
      { source: "env", weight: 1 },
      { source: "file", mode: "cli", weight: 10 }
    ],
    fallbackPolicy: {
      strategy: "weighted",
      failFast: true,
      failFastOn: ["SecretParseError"],
      retryableErrors: ["SecretNotFoundError"],
      parallelism: 2
    }
  });

  assert.equal(parsed.refreshIntervalMs, 5_000);
  assert.equal(parsed.sources[0].weight, 1);
  assert.equal(parsed.sources[1].mode, "cli");
  assert.equal(parsed.fallbackPolicy?.strategy, "weighted");
  assert.equal(parsed.fallbackPolicy?.parallelism, 2);
});

test("fallback policy rejects unknown strategy", () => {
  assert.throws(() =>
    parseSecretRequest({
      key: "TOKEN",
      sources: [{ source: "env" }],
      fallbackPolicy: {
        strategy: "fastest"
      }
    })
  );
});

test("secretResultSchema validates result payload", () => {
  const parsed = secretResultSchema.parse({
    value: "abc",
    metadata: {
      source: "env",
      mode: "native"
    }
  });

  assert.equal(parsed.value, "abc");
  assert.equal(parsed.metadata.mode, "native");
});
