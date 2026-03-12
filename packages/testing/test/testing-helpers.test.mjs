import test from "node:test";
import assert from "node:assert/strict";
import { SecretNotFoundError } from "@runfabric/secrets-core";
import {
  createFakeAdapter,
  createFallbackRequest,
  createSingleSourceRequest
} from "../dist/index.js";

test("createSingleSourceRequest builds required request", () => {
  const request = createSingleSourceRequest("env", "API_KEY");

  assert.deepEqual(request, {
    source: "env",
    key: "API_KEY",
    required: true
  });
});

test("createFallbackRequest builds required fallback request", () => {
  const request = createFallbackRequest(["env", "file"], "TOKEN");

  assert.deepEqual(request, {
    key: "TOKEN",
    required: true,
    sources: [{ source: "env" }, { source: "file" }]
  });
});

test("createFakeAdapter returns stored value", async () => {
  const adapter = createFakeAdapter({
    source: "file",
    initialSecrets: {
      TOKEN: "fixture-token"
    }
  });

  const result = await adapter.get(
    { source: "file", key: "TOKEN", required: true },
    { now: Date.now, env: process.env }
  );

  assert.equal(result.value, "fixture-token");
  assert.equal(result.metadata.source, "file");
});

test("createFakeAdapter throws SecretNotFoundError for missing key", async () => {
  const adapter = createFakeAdapter({ source: "env", initialSecrets: {} });

  await assert.rejects(
    () =>
      adapter.get(
        { source: "env", key: "MISSING", required: true },
        { now: Date.now, env: process.env }
      ),
    SecretNotFoundError
  );
});
