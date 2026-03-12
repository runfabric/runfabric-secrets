import type { FallbackStrategy, SecretMode } from "./types.js";

export const DEFAULT_SECRET_MODE: SecretMode = "api";
export const DEFAULT_SECRET_CACHE_TTL_MS = 0;
export const DEFAULT_FALLBACK_STRATEGY: FallbackStrategy = "sequential";
export const DEFAULT_FALLBACK_PARALLELISM = 3;
export const DEFAULT_BACKGROUND_REFRESH_INTERVAL_MS = 0;

export const DEFAULT_RETRYABLE_FALLBACK_ERRORS = [
  "SecretNotFoundError",
  "SecretModeNotSupportedError",
  "SecretAdapterNotFoundError"
];
