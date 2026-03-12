import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appEntry = new URL("../dist/index.js", import.meta.url).pathname;

async function runNode(entry, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      ...options,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr
      });
    });
  });
}

test("demo-node resolves token from file fallback", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "demo-node-run-"));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await writeFile(
    join(cwd, "demo-secrets.json"),
    JSON.stringify({ DEMO_TOKEN: "from-file" }),
    "utf8"
  );

  const result = await runNode(appEntry, {
    cwd,
    env: {
      ...process.env
    }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Resolved DEMO_TOKEN:\s+from-file/);
  assert.equal(result.stderr.trim(), "");
});

test("demo-node prefers env over file fallback", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "demo-node-run-"));
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  await writeFile(
    join(cwd, "demo-secrets.json"),
    JSON.stringify({ DEMO_TOKEN: "from-file" }),
    "utf8"
  );

  const result = await runNode(appEntry, {
    cwd,
    env: {
      ...process.env,
      DEMO_TOKEN: "from-env"
    }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Resolved DEMO_TOKEN:\s+from-env/);
  assert.equal(result.stderr.trim(), "");
});
