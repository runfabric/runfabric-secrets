import {
  SecretNotFoundError,
  type SecretAdapterContext,
  type SecretResult,
  type SingleSourceSecretRequest
} from "@runfabric/secrets-core";
import type { AwsAdapterOptions, AwsGetSecretInput, AwsGetSecretOutput, AwsSecretsManagerClientLike } from "./aws-types.js";
import {
  buildAwsGetSecretInput,
  extractAwsSecretValue,
  isAwsNotFoundError,
  toIsoDate
} from "./aws-utils.js";

interface AwsSdkModule {
  SecretsManagerClient: new (config: { region: string; endpoint?: string }) => AwsSecretsManagerClientLike;
  GetSecretValueCommand: new (input: AwsGetSecretInput) => unknown;
  ListSecretsCommand?: new (input: { MaxResults: number }) => unknown;
}

const apiClientCache = new WeakMap<AwsAdapterOptions, Promise<{ client: AwsSecretsManagerClientLike; sdk: AwsSdkModule | null }>>();

export async function loadFromAwsApi(
  request: SingleSourceSecretRequest,
  context: SecretAdapterContext,
  options: AwsAdapterOptions
): Promise<SecretResult> {
  const input = buildAwsGetSecretInput(request.key, request.version);

  try {
    const { client, sdk } = await getApiClient(options);
    const output = await invokeGetSecretValue(client, input, sdk, context, request.signal);
    const value = extractAwsSecretValue(request.key, output);

    return {
      value,
      metadata: {
        source: "aws",
        mode: "api",
        version: output.VersionId ?? request.version,
        createdAt: toIsoDate(output.CreatedDate),
        raw: {
          region: options.region,
          arn: output.ARN,
          name: output.Name
        }
      }
    };
  } catch (error) {
    if (isAwsNotFoundError(error)) {
      throw new SecretNotFoundError(request.key);
    }

    throw error;
  }
}

export async function checkAwsApiHealth(
  context: SecretAdapterContext,
  options: AwsAdapterOptions
): Promise<{ ok: boolean; details?: unknown }> {
  try {
    const { client, sdk } = await getApiClient(options);

    if (typeof client.send === "function" && sdk?.ListSecretsCommand) {
      await client.send(new sdk.ListSecretsCommand({ MaxResults: 1 }));
    }

    return {
      ok: true,
      details: {
        mode: "api",
        region: options.region
      }
    };
  } catch (error) {
    context.logger?.warn("AWS API health check failed", {
      source: "aws",
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      ok: false,
      details: {
        mode: "api",
        region: options.region,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

async function getApiClient(
  options: AwsAdapterOptions
): Promise<{ client: AwsSecretsManagerClientLike; sdk: AwsSdkModule | null }> {
  const cached = apiClientCache.get(options);
  if (cached) {
    return cached;
  }

  const pendingClient = resolveApiClient(options);
  apiClientCache.set(options, pendingClient);

  try {
    return await pendingClient;
  } catch (error) {
    apiClientCache.delete(options);
    throw error;
  }
}

async function resolveApiClient(
  options: AwsAdapterOptions
): Promise<{ client: AwsSecretsManagerClientLike; sdk: AwsSdkModule | null }> {
  if (options.api?.client) {
    return {
      client: options.api.client,
      sdk: null
    };
  }

  const sdk = await importAwsSdk();
  const client = new sdk.SecretsManagerClient({
    region: options.region,
    ...(options.api?.endpoint ? { endpoint: options.api.endpoint } : {})
  });

  return {
    client,
    sdk
  };
}

async function invokeGetSecretValue(
  client: AwsSecretsManagerClientLike,
  input: AwsGetSecretInput,
  sdk: AwsSdkModule | null,
  context: SecretAdapterContext,
  signal?: AbortSignal
): Promise<AwsGetSecretOutput> {
  throwIfAborted(signal);

  if (typeof client.getSecretValue === "function") {
    return withAbortSignal(
      client.getSecretValue(
        input,
        signal ? { abortSignal: signal } : undefined
      ),
      signal
    );
  }

  if (typeof client.send === "function") {
    if (sdk?.GetSecretValueCommand) {
      return withAbortSignal(
        client.send(
          new sdk.GetSecretValueCommand(input),
          signal ? { abortSignal: signal } : undefined
        ),
        signal
      );
    }

    return withAbortSignal(
      client.send(input, signal ? { abortSignal: signal } : undefined),
      signal
    );
  }

  context.logger?.error("AWS API client is missing getSecretValue/send methods", {
    source: "aws"
  });

  throw new Error("Invalid AWS API client: expected getSecretValue or send method");
}

async function importAwsSdk(): Promise<AwsSdkModule> {
  try {
    return (await import("@aws-sdk/client-secrets-manager")) as AwsSdkModule;
  } catch {
    throw new Error(
      "AWS SDK is not installed. Add '@aws-sdk/client-secrets-manager' to use AWS API mode."
    );
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(createAbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });

    promise
      .then((value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      })
      .catch((error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
}

function createAbortError(): Error {
  const error = new Error("AWS API request was aborted");
  error.name = "AbortError";
  return error;
}
