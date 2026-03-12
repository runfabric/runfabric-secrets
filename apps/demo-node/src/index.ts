import { createEnvAdapter } from "@runfabric/secrets-adapter-env";
import { createFileAdapter } from "@runfabric/secrets-adapter-file";
import { createSecretClient } from "@runfabric/secrets-core";

async function main(): Promise<void> {
  const secrets = createSecretClient({
    adapters: [
      createEnvAdapter(),
      createFileAdapter({ filePath: "./demo-secrets.json" })
    ],
    defaultMode: "api",
    defaultCacheTtlMs: 60_000
  });

  const token = await secrets.getValue<string>({
    sources: [{ source: "env" }, { source: "file" }],
    key: "DEMO_TOKEN",
    parseAs: "string",
    required: false
  });

  console.log("Resolved DEMO_TOKEN:", token ?? "<missing>");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
