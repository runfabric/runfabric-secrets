import type {
  FallbackSecretRequest,
  SingleSourceSecretRequest,
  SecretSource
} from "@runfabric/secrets-core";

export function createSingleSourceRequest(
  source: SecretSource,
  key = "TEST_SECRET"
): SingleSourceSecretRequest {
  return {
    source,
    key,
    required: true
  };
}

export function createFallbackRequest(
  sources: SecretSource[],
  key = "TEST_SECRET"
): FallbackSecretRequest {
  return {
    key,
    required: true,
    sources: sources.map((source) => ({ source }))
  };
}
