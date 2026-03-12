import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const packagesDir = join(root, "packages");
const packageDirs = readdirSync(packagesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const failures = [];
const packageDepsByName = new Map();

const PROVIDER_SDK_OWNERS = {
  "@aws-sdk/client-secrets-manager": "@runfabric/secrets-adapter-aws",
  "@google-cloud/secret-manager": "@runfabric/secrets-adapter-gcp",
  "@azure/keyvault-secrets": "@runfabric/secrets-adapter-azure",
  "@azure/identity": "@runfabric/secrets-adapter-azure"
};

for (const dir of packageDirs) {
  const packageJsonPath = join(packagesDir, dir, "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const allDeps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {})
  };

  packageDepsByName.set(pkg.name, allDeps);

  if (!Array.isArray(pkg.files) || !pkg.files.includes("dist")) {
    failures.push(`${pkg.name}: missing \"files: [\\\"dist\\\"]\"`);
  }

  if (typeof pkg.main !== "string" || !pkg.main.startsWith("dist/")) {
    failures.push(`${pkg.name}: main must point to dist/*`);
  }

  if (typeof pkg.types !== "string" || !pkg.types.startsWith("dist/")) {
    failures.push(`${pkg.name}: types must point to dist/*`);
  }

  const mainPath = join(packagesDir, dir, pkg.main || "");
  const typesPath = join(packagesDir, dir, pkg.types || "");

  if (!existsSync(mainPath)) {
    failures.push(`${pkg.name}: built main file missing (${pkg.main})`);
  }

  if (!existsSync(typesPath)) {
    failures.push(`${pkg.name}: built types file missing (${pkg.types})`);
  }

  for (const [dependencyName, ownerPackage] of Object.entries(PROVIDER_SDK_OWNERS)) {
    if (dependencyName in allDeps && pkg.name !== ownerPackage) {
      failures.push(
        `${pkg.name}: ${dependencyName} dependency must remain ${ownerPackage} specific`
      );
    }
  }
}

const coreAllDeps = packageDepsByName.get("@runfabric/secrets-core") || {};
for (const dependencyName of Object.keys(PROVIDER_SDK_OWNERS)) {
  if (dependencyName in coreAllDeps) {
    failures.push(`@runfabric/secrets-core must not depend on provider SDK '${dependencyName}'`);
  }
}

if (failures.length > 0) {
  console.error("Release check failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log("Release check passed.");
}
