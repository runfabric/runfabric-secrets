import { createEnvAdapter } from "@runfabric/secrets-adapter-env";
import { createSecretClient, type SecretClient } from "@runfabric/secrets-core";

class SecretsService {
  constructor(private readonly client: SecretClient) {}

  getApiKey(): Promise<string> {
    return this.client.getValue<string>({
      source: "env",
      key: "API_KEY",
      parseAs: "string",
      required: true
    });
  }
}

async function bootstrap(): Promise<void> {
  const secrets = createSecretClient({
    adapters: [createEnvAdapter()]
  });

  const service = new SecretsService(secrets);

  try {
    const apiKey = await service.getApiKey();
    console.log("Simulated Nest bootstrap. API key length:", apiKey.length);
  } catch {
    console.log("Simulated Nest bootstrap. API key is missing.");
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
