import test from "node:test";
import assert from "node:assert/strict";
import { SecretNotFoundError } from "@runfabric/secrets-core";
import { createEnvAdapter } from "../dist/index.js";

test("env adapter reads value from context env", async () => {
  const adapter = createEnvAdapter();
  const result = await adapter.get(
    { source: "env", key: "API_KEY", required: true },
    { now: Date.now, env: { API_KEY: "abc123" } }
  );

  assert.equal(result.value, "abc123");
  assert.equal(result.metadata.source, "env");
  assert.equal(result.metadata.mode, "native");
});

test("env adapter throws SecretNotFoundError for missing key", async () => {
  const adapter = createEnvAdapter();

  await assert.rejects(
    () =>
      adapter.get(
        { source: "env", key: "MISSING", required: true },
        { now: Date.now, env: {} }
      ),
    SecretNotFoundError
  );
});
