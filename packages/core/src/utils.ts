import { SecretParseError } from "./errors.js";
import { DEFAULT_RETRYABLE_FALLBACK_ERRORS } from "./constants.js";
import type {
  FallbackPolicy,
  FallbackSourceConfig,
  FallbackStrategy,
  FallbackSecretRequest,
  SecretParseAs,
  SecretRequest,
  SecretResult,
  SingleSourceSecretRequest
} from "./types.js";

export function isFallbackRequest(request: SecretRequest): request is FallbackSecretRequest {
  return "sources" in request;
}

export function toCacheKey(
  request: SingleSourceSecretRequest,
  resolvedMode: "api" | "cli" | "native"
): string {
  return JSON.stringify({
    source: request.source,
    mode: resolvedMode,
    key: request.key,
    version: request.version ?? "latest",
    parseAs: request.parseAs ?? "raw"
  });
}

export function parseSecretValue(
  key: string,
  value: unknown,
  parseAs: SecretParseAs = "raw"
): unknown {
  if (parseAs === "raw") {
    return value;
  }

  if (parseAs === "string") {
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  if (typeof value === "object" && value !== null) {
    return value;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "invalid JSON";
      throw new SecretParseError(key, reason);
    }
  }

  throw new SecretParseError(key, `Cannot parse value of type '${typeof value}' as json`);
}

export function createEmptyResult<T>(
  source: string,
  mode: "api" | "cli" | "native" = "native"
): SecretResult<T> {
  return {
    value: undefined as T,
    metadata: {
      source,
      mode
    }
  };
}

export function getErrorName(error: unknown): string {
  if (error instanceof Error) {
    return error.name || error.constructor.name;
  }

  if (typeof error === "object" && error !== null && "name" in error) {
    const name = (error as Record<string, unknown>).name;
    if (typeof name === "string" && name.length > 0) {
      return name;
    }
  }

  return "UnknownError";
}

export function isRetryableFallbackError(error: unknown, policy?: FallbackPolicy): boolean {
  const retryable = policy?.retryableErrors ?? DEFAULT_RETRYABLE_FALLBACK_ERRORS;
  return retryable.includes(getErrorName(error));
}

export function shouldFailFast(error: unknown, policy?: FallbackPolicy): boolean {
  const errorName = getErrorName(error);

  if (policy?.failFastOn?.includes(errorName)) {
    return true;
  }

  if (policy?.failFast) {
    return !isRetryableFallbackError(error, policy);
  }

  return false;
}

export function orderFallbackSources(
  sources: FallbackSourceConfig[],
  strategy: FallbackStrategy
): FallbackSourceConfig[] {
  if (strategy !== "weighted") {
    return [...sources];
  }

  return [...sources].sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0));
}
