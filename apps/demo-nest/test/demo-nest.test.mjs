import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const appEntry = new URL("../dist/main.js", import.meta.url).pathname;

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

test("demo-nest prints missing message when API_KEY is absent", async () => {
  const result = await runNode(appEntry, {
    env: {
      ...process.env
    }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /API key is missing/);
  assert.equal(result.stderr.trim(), "");
});

test("demo-nest prints bootstrap message when API_KEY is present", async () => {
  const result = await runNode(appEntry, {
    env: {
      ...process.env,
      API_KEY: "super-secret"
    }
  });

  assert.equal(result.code, 0);
  assert.match(result.stdout, /API key length:\s+12/);
  assert.equal(result.stderr.trim(), "");
});
