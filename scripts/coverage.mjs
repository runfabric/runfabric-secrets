import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const workspaceRoots = ["packages", "apps"];
const workspaces = [];
const thresholdConfigPath = join(root, "scripts", "coverage-thresholds.json");
const thresholds = loadThresholds(thresholdConfigPath);
const summary = [];
const coverageConcurrency = resolveConcurrency(process.env.COVERAGE_CONCURRENCY);

ensureBuildArtifacts();

for (const workspaceRoot of workspaceRoots) {
  const absoluteRoot = join(root, workspaceRoot);
  if (!existsSync(absoluteRoot)) {
    continue;
  }

  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const workspacePath = join(absoluteRoot, entry.name);
    const hasPackageJson = existsSync(join(workspacePath, "package.json"));
    const hasTests = existsSync(join(workspacePath, "test"));

    if (hasPackageJson && hasTests) {
      workspaces.push(join(workspaceRoot, entry.name));
    }
  }
}

if (workspaces.length === 0) {
  console.log("No workspaces with tests were found.");
  process.exit(0);
}

const failed = [];

const workspaceResults = await runWithConcurrency(workspaces, coverageConcurrency, async (workspace) => {
  console.log(`== ${workspace} ==`);
  const workspacePath = join(root, workspace);
  const testFiles = collectTestFiles(join(workspacePath, "test"), "test");
  const target = resolveThreshold(workspace, thresholds);
  if (testFiles.length === 0) {
    const message = `No test files found for ${workspace}. Expected files matching test/**/*.test.mjs`;
    process.stderr.write(`${message}\n`);
    return {
      workspace,
      thresholds: target,
      metrics: null,
      status: "failed"
    };
  }

  const args = [
    "--experimental-test-coverage",
    "--test-coverage-include=dist/**/*.js",
    "--test",
    ...testFiles
  ];

  const result = await runSpawnCapture(process.execPath, args, {
    cwd: workspacePath,
    env: process.env
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const metrics = extractCoverageMetrics(`${result.stdout}\n${result.stderr}`);
  const thresholdFailures = evaluateThresholds(metrics, target);
  const status =
    result.status === 0 && thresholdFailures.length === 0 ? "passed" : "failed";

  if (thresholdFailures.length > 0) {
    process.stderr.write(
      `Coverage thresholds not met for ${workspace}: ${thresholdFailures.join(", ")}\n`
    );
  }

  return {
    workspace,
    thresholds: target,
    metrics,
    thresholdFailures,
    status
  };
});

for (const entry of workspaceResults) {
  summary.push(entry);
  if (entry.status === "failed") {
    failed.push(entry.workspace);
  }
}

writeSummaryArtifact(summary);

if (failed.length > 0) {
  console.error("\nCoverage run failed for:");
  for (const workspace of failed) {
    console.error(`- ${workspace}`);
  }
  process.exit(1);
}

function ensureBuildArtifacts() {
  if (process.env.COVERAGE_SKIP_BUILD === "1") {
    return;
  }

  const build = spawnSync("pnpm", ["build"], {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });

  if (build.status !== 0) {
    throw new Error("Coverage pre-build step failed.");
  }
}

function resolveConcurrency(input) {
  if (!input) {
    return 3;
  }

  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 3;
  }

  return parsed;
}

function runSpawnCapture(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
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
    child.on("close", (status) => {
      resolve({
        status: status ?? 1,
        stdout,
        stderr
      });
    });
  });
}

function collectTestFiles(absoluteDir, relativeDir) {
  if (!existsSync(absoluteDir)) {
    return [];
  }

  const entries = readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(absoluteDir, entry.name);
    const relativePath = join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(absolutePath, relativePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      files.push(relativePath);
    }
  }

  files.sort();
  return files;
}

async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => runWorker()
  );

  await Promise.all(workers);
  return results;
}

function loadThresholds(filePath) {
  const fallback = { default: { lines: 0, branches: 0, functions: 0 }, workspaces: {} };
  if (!existsSync(filePath)) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const defaults = normalizeThreshold(parsed.default);
    const configuredWorkspaces = parsed.workspaces ?? {};
    const normalizedWorkspaces = {};

    for (const [workspace, threshold] of Object.entries(configuredWorkspaces)) {
      normalizedWorkspaces[workspace] = normalizeThreshold(threshold);
    }

    return {
      default: defaults,
      workspaces: normalizedWorkspaces
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse coverage thresholds from '${filePath}': ${reason}`);
  }
}

function resolveThreshold(workspace, thresholdConfig) {
  return thresholdConfig.workspaces[workspace] ?? thresholdConfig.default;
}

function normalizeThreshold(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Coverage threshold entry must be an object.");
  }

  const lines = toThresholdValue(value.lines, "lines");
  const branches = toThresholdValue(value.branches, "branches");
  const functions = toThresholdValue(value.functions, "functions");

  return {
    lines,
    branches,
    functions
  };
}

function toThresholdValue(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Coverage threshold '${field}' must be a finite number.`);
  }

  return Math.max(0, Math.min(100, value));
}

function extractCoverageMetrics(output) {
  const match =
    output.match(/ℹ all files\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|/) ??
    output.match(/all files\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|\s*([0-9.]+)\s*\|/);

  if (!match) {
    return null;
  }

  return {
    lines: Number(match[1]),
    branches: Number(match[2]),
    functions: Number(match[3])
  };
}

function evaluateThresholds(metrics, thresholdsForWorkspace) {
  if (!metrics) {
    return ["coverage metrics unavailable"];
  }

  const failures = [];
  if (metrics.lines < thresholdsForWorkspace.lines) {
    failures.push(`lines ${formatMetric(metrics.lines)} < ${formatMetric(thresholdsForWorkspace.lines)}`);
  }
  if (metrics.branches < thresholdsForWorkspace.branches) {
    failures.push(
      `branches ${formatMetric(metrics.branches)} < ${formatMetric(thresholdsForWorkspace.branches)}`
    );
  }
  if (metrics.functions < thresholdsForWorkspace.functions) {
    failures.push(
      `functions ${formatMetric(metrics.functions)} < ${formatMetric(thresholdsForWorkspace.functions)}`
    );
  }

  return failures;
}

function formatMetric(value) {
  return value.toFixed(2);
}

function writeSummaryArtifact(entries) {
  const coverageDir = join(root, "coverage");
  mkdirSync(coverageDir, { recursive: true });
  const outputPath = join(coverageDir, "summary.json");
  writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2)}\n`);
  console.log(`Coverage summary written to ${outputPath}`);
}
