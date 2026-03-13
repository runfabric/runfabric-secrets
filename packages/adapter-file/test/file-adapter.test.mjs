import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretNotFoundError, SecretParseError } from "@runfabric/secrets-core";
import { createFileAdapter } from "../dist/index.js";

test("file adapter reads secret from JSON file", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "secrets-file-adapter-"));
  const filePath = join(dir, "secrets.json");
  await writeFile(filePath, JSON.stringify({ DEMO_TOKEN: "from-file" }), "utf8");

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const adapter = createFileAdapter({ filePath });
  const result = await adapter.get(
    { source: "file", key: "DEMO_TOKEN", required: true },
    { now: Date.now, env: process.env }
  );

  assert.equal(result.value, "from-file");
  assert.equal(result.metadata.source, "file");
  assert.equal(result.metadata.mode, "native");
});

test("file adapter throws SecretNotFoundError for missing key", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "secrets-file-adapter-"));
  const filePath = join(dir, "secrets.json");
  await writeFile(filePath, JSON.stringify({ PRESENT: "ok" }), "utf8");

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const adapter = createFileAdapter({ filePath });

  await assert.rejects(
    () =>
      adapter.get(
        { source: "file", key: "MISSING", required: true },
        { now: Date.now, env: process.env }
      ),
    SecretNotFoundError
  );
});

test("file adapter refreshes cached content when the file changes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "secrets-file-adapter-"));
  const filePath = join(dir, "secrets.json");
  await writeFile(filePath, JSON.stringify({ TOKEN: "v1" }), "utf8");

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const adapter = createFileAdapter({ filePath });
  const first = await adapter.get(
    { source: "file", key: "TOKEN", required: true },
    { now: Date.now, env: process.env }
  );
  assert.equal(first.value, "v1");

  await writeFile(filePath, JSON.stringify({ TOKEN: "v2" }), "utf8");

  const second = await adapter.get(
    { source: "file", key: "TOKEN", required: true },
    { now: Date.now, env: process.env }
  );
  assert.equal(second.value, "v2");
});

test("file adapter throws SecretParseError when JSON is invalid", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "secrets-file-adapter-"));
  const filePath = join(dir, "secrets.json");
  await writeFile(filePath, "{ bad json", "utf8");

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const adapter = createFileAdapter({ filePath });

  await assert.rejects(
    () =>
      adapter.get(
        { source: "file", key: "ANY", required: true },
        { now: Date.now, env: process.env }
      ),
    SecretParseError
  );
});

test("file adapter honors aborted requests", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "secrets-file-adapter-"));
  const filePath = join(dir, "secrets.json");
  await writeFile(filePath, JSON.stringify({ TOKEN: "value" }), "utf8");

  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const adapter = createFileAdapter({ filePath });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () =>
      adapter.get(
        { source: "file", key: "TOKEN", required: true, signal: controller.signal },
        { now: Date.now, env: process.env }
      ),
    (error) => error?.name === "AbortError"
  );
});
