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
    parseAs: "string"
  });

  assert.equal(parsed.source, "env");
  assert.equal(parsed.key, "API_KEY");
  assert.equal(parsed.parseAs, "string");
});

test("fallbackSecretRequestSchema rejects empty sources", () => {
  assert.throws(() =>
    fallbackSecretRequestSchema.parse({
      key: "TOKEN",
      sources: []
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
