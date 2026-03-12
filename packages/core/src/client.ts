import {
  DEFAULT_BACKGROUND_REFRESH_INTERVAL_MS,
  DEFAULT_FALLBACK_PARALLELISM,
  DEFAULT_FALLBACK_STRATEGY,
  DEFAULT_SECRET_CACHE_TTL_MS,
  DEFAULT_SECRET_MODE
} from "./constants.js";
import { InMemorySecretCache } from "./cache.js";
import {
  SecretAdapterNotFoundError,
  SecretModeNotSupportedError,
  SecretNotFoundError,
  SecretRotationError
} from "./errors.js";
import { createAdapterRegistry } from "./registry.js";
import {
  createEmptyResult,
  isFallbackRequest,
  isRetryableFallbackError,
  orderFallbackSources,
  parseSecretValue,
  shouldFailFast,
  toCacheKey
} from "./utils.js";
import type {
  FallbackStrategy,
  FallbackPolicy,
  FallbackSecretRequest,
  FallbackSourceConfig,
  SecretAdapter,
  SecretAdapterContext,
  SecretBackgroundRefreshOptions,
  SecretClient,
  SecretClientOptions,
  SecretEnvironment,
  SecretMode,
  SecretRequest,
  SecretResult,
  SecretRotationHooks,
  SingleSourceSecretRequest
} from "./types.js";

type ResolvedMode = SecretMode | "native";

interface LoadOptions {
  skipCache?: boolean;
  reason?: "direct" | "fallback" | "background" | "manual-refresh";
}

function resolveMode(
  request: SingleSourceSecretRequest,
  adapter: SecretAdapter,
  defaultMode: SecretMode
): ResolvedMode {
  if (request.mode) {
    return request.mode;
  }

  if (adapter.capabilities[defaultMode]) {
    return defaultMode;
  }

  if (adapter.capabilities.native) {
    return "native";
  }

  return defaultMode;
}

function ensureModeSupported(
  source: string,
  mode: ResolvedMode,
  adapter: SecretAdapter
): void {
  if (mode === "api" && !adapter.capabilities.api) {
    throw new SecretModeNotSupportedError(source, mode);
  }

  if (mode === "cli" && !adapter.capabilities.cli) {
    throw new SecretModeNotSupportedError(source, mode);
  }

  if (mode === "native" && !adapter.capabilities.native) {
    throw new SecretModeNotSupportedError(source, mode);
  }
}

function normalizeRequest(
  request: SingleSourceSecretRequest,
  resolvedMode: ResolvedMode
): SingleSourceSecretRequest {
  return {
    ...request,
    mode: resolvedMode === "native" ? undefined : resolvedMode
  };
}

function resolveEnvironment(input?: SecretEnvironment): SecretEnvironment {
  if (input) {
    return input;
  }

  if (typeof process !== "undefined" && process.env) {
    return process.env as SecretEnvironment;
  }

  return {};
}

function toSingleSourceRequest(
  request: FallbackSecretRequest,
  sourceConfig: FallbackSourceConfig
): SingleSourceSecretRequest {
  return {
    key: request.key,
    parseAs: request.parseAs,
    required: request.required,
    cacheTtlMs: request.cacheTtlMs,
    version: request.version,
    refreshIntervalMs: request.refreshIntervalMs,
    source: sourceConfig.source,
    mode: sourceConfig.mode
  };
}

export function createSecretClient(options: SecretClientOptions): SecretClient {
  const adapterMap = createAdapterRegistry(options.adapters);
  const cache = options.cache ?? new InMemorySecretCache();
  const defaultMode = options.defaultMode ?? DEFAULT_SECRET_MODE;
  const defaultCacheTtlMs = options.defaultCacheTtlMs ?? DEFAULT_SECRET_CACHE_TTL_MS;
  const defaultFallbackPolicy: FallbackPolicy = options.fallbackPolicy ?? {};
  const backgroundRefresh: SecretBackgroundRefreshOptions = options.backgroundRefresh ?? {};
  const env = resolveEnvironment(options.env);
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  let disposed = false;

  const adapterContext: SecretAdapterContext = {
    logger: options.logger,
    now: Date.now,
    env
  };

  const emit = {
    requestStart: (request: SecretRequest) =>
      options.telemetry?.onRequestStart?.({
        request
      }),
    requestSuccess: (
      request: SecretRequest,
      source: string,
      mode: SecretMode | "native",
      durationMs: number
    ) =>
      options.telemetry?.onRequestSuccess?.({
        request,
        source,
        mode,
        durationMs
      }),
    requestError: (request: SecretRequest, durationMs: number, error: unknown) =>
      options.telemetry?.onRequestError?.({
        request,
        durationMs,
        error
      }),
    cacheHit: (request: SingleSourceSecretRequest, cacheKey: string, mode: SecretMode | "native") =>
      options.telemetry?.onCacheHit?.({
        request,
        source: request.source,
        mode,
        cacheKey
      }),
    fallbackAttempt: (
      request: FallbackSecretRequest,
      sourceConfig: FallbackSourceConfig,
      attempt: number,
      totalAttempts: number,
      strategy: FallbackStrategy
    ) =>
      options.telemetry?.onFallbackAttempt?.({
        request,
        source: sourceConfig.source,
        mode: sourceConfig.mode,
        attempt,
        totalAttempts,
        strategy,
        metadata: {
          weight: sourceConfig.weight
        }
      }),
    backgroundRefresh: (
      request: SingleSourceSecretRequest,
      refreshIntervalMs: number,
      error?: unknown
    ) =>
      options.telemetry?.onBackgroundRefresh?.({
        request,
        source: request.source,
        mode: request.mode,
        refreshIntervalMs,
        error
      }),
    rotation: (
      request: SingleSourceSecretRequest,
      rotationStage: "before" | "rotate" | "verify" | "after" | "error",
      error?: unknown
    ) =>
      options.telemetry?.onRotation?.({
        request,
        source: request.source,
        mode: request.mode,
        rotationStage,
        error
      })
  };

  function mergeFallbackPolicy(request: FallbackSecretRequest): FallbackPolicy {
    return {
      ...defaultFallbackPolicy,
      ...request.fallbackPolicy
    };
  }

  function computeRefreshInterval(request: SingleSourceSecretRequest): number {
    if (request.refreshIntervalMs != null) {
      return request.refreshIntervalMs;
    }

    if (!backgroundRefresh.enabled) {
      return 0;
    }

    return backgroundRefresh.defaultIntervalMs ?? DEFAULT_BACKGROUND_REFRESH_INTERVAL_MS;
  }

  function clearRefreshTimer(cacheKey: string): void {
    const timer = refreshTimers.get(cacheKey);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    refreshTimers.delete(cacheKey);
  }

  function scheduleBackgroundRefresh(
    request: SingleSourceSecretRequest,
    resolvedMode: ResolvedMode
  ): void {
    if (disposed) {
      return;
    }

    const refreshIntervalMs = computeRefreshInterval(request);
    if (refreshIntervalMs <= 0) {
      return;
    }

    const normalizedRequest = normalizeRequest(request, resolvedMode);
    const cacheKey = toCacheKey(normalizedRequest, resolvedMode);
    clearRefreshTimer(cacheKey);

    const jitterMs = backgroundRefresh.jitterMs ?? 0;
    const jitterOffset = jitterMs > 0 ? Math.floor(Math.random() * jitterMs) : 0;

    const timer = setTimeout(async () => {
      if (disposed) {
        return;
      }

      try {
        await loadFromSingleSource(normalizedRequest, {
          skipCache: true,
          reason: "background"
        });
        emit.backgroundRefresh(normalizedRequest, refreshIntervalMs);
      } catch (error) {
        options.logger?.warn("Background refresh failed", {
          source: normalizedRequest.source,
          key: normalizedRequest.key,
          error: error instanceof Error ? error.message : String(error)
        });
        emit.backgroundRefresh(normalizedRequest, refreshIntervalMs, error);
      }

      scheduleBackgroundRefresh(normalizedRequest, resolvedMode);
    }, refreshIntervalMs + jitterOffset);

    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref: () => void }).unref();
    }

    refreshTimers.set(cacheKey, timer);
  }

  async function loadFromSingleSource<T>(
    request: SingleSourceSecretRequest,
    loadOptions: LoadOptions = {}
  ): Promise<SecretResult<T>> {
    const adapter = adapterMap.get(request.source);
    if (!adapter) {
      throw new SecretAdapterNotFoundError(request.source);
    }

    const resolvedMode = resolveMode(request, adapter, defaultMode);
    ensureModeSupported(request.source, resolvedMode, adapter);

    const normalizedRequest = normalizeRequest(request, resolvedMode);
    const cacheKey = toCacheKey(normalizedRequest, resolvedMode);

    if (!loadOptions.skipCache) {
      const cached = await cache.get(cacheKey);
      if (cached) {
        emit.cacheHit(normalizedRequest, cacheKey, resolvedMode);
        return cached.result as SecretResult<T>;
      }
    }

    const result = await adapter.get(normalizedRequest, adapterContext);
    const parsed: SecretResult<T> = {
      value: parseSecretValue(
        normalizedRequest.key,
        result.value,
        normalizedRequest.parseAs ?? "raw"
      ) as T,
      metadata: result.metadata
    };

    const ttl = normalizedRequest.cacheTtlMs ?? defaultCacheTtlMs;
    if (ttl > 0) {
      await cache.set(cacheKey, {
        expiresAt: Date.now() + ttl,
        result: parsed
      });
    }

    scheduleBackgroundRefresh(normalizedRequest, resolvedMode);

    return parsed;
  }

  async function runFallbackSequential<T>(
    request: FallbackSecretRequest,
    orderedSources: FallbackSourceConfig[],
    policy: FallbackPolicy
  ): Promise<SecretResult<T>> {
    let lastError: unknown;

    for (let index = 0; index < orderedSources.length; index += 1) {
      const sourceConfig = orderedSources[index];
      emit.fallbackAttempt(
        request,
        sourceConfig,
        index + 1,
        orderedSources.length,
        policy.strategy ?? DEFAULT_FALLBACK_STRATEGY
      );

      try {
        return await loadFromSingleSource<T>(toSingleSourceRequest(request, sourceConfig), {
          reason: "fallback"
        });
      } catch (error) {
        lastError = error;

        if (shouldFailFast(error, policy)) {
          throw error;
        }

        if (policy.failFast && !isRetryableFallbackError(error, policy)) {
          throw error;
        }
      }
    }

    if (request.required) {
      throw lastError instanceof Error ? lastError : new SecretNotFoundError(request.key);
    }

    const fallbackSource = orderedSources[0]?.source ?? "env";
    return createEmptyResult<T>(fallbackSource);
  }

  async function runFallbackParallel<T>(
    request: FallbackSecretRequest,
    orderedSources: FallbackSourceConfig[],
    policy: FallbackPolicy
  ): Promise<SecretResult<T>> {
    const parallelism = Math.max(
      1,
      Math.min(policy.parallelism ?? DEFAULT_FALLBACK_PARALLELISM, orderedSources.length)
    );

    let done = false;
    let nextIndex = 0;
    let inFlight = 0;
    let lastError: unknown;

    return new Promise<SecretResult<T>>((resolve, reject) => {
      const launchNext = () => {
        if (done) {
          return;
        }

        while (inFlight < parallelism && nextIndex < orderedSources.length) {
          const sourceIndex = nextIndex;
          const sourceConfig = orderedSources[sourceIndex];
          nextIndex += 1;
          inFlight += 1;

          emit.fallbackAttempt(
            request,
            sourceConfig,
            sourceIndex + 1,
            orderedSources.length,
            policy.strategy ?? "parallel"
          );

          loadFromSingleSource<T>(toSingleSourceRequest(request, sourceConfig), {
            reason: "fallback"
          })
            .then((result) => {
              if (done) {
                return;
              }
              done = true;
              resolve(result);
            })
            .catch((error) => {
              if (done) {
                return;
              }

              lastError = error;

              if (shouldFailFast(error, policy)) {
                done = true;
                reject(error);
                return;
              }
            })
            .finally(() => {
              inFlight -= 1;

              if (done) {
                return;
              }

              if (nextIndex >= orderedSources.length && inFlight === 0) {
                done = true;

                if (request.required) {
                  reject(lastError instanceof Error ? lastError : new SecretNotFoundError(request.key));
                  return;
                }

                const fallbackSource = orderedSources[0]?.source ?? "env";
                resolve(createEmptyResult<T>(fallbackSource));
                return;
              }

              launchNext();
            });
        }
      };

      launchNext();
    });
  }

  async function runFallback<T>(request: FallbackSecretRequest): Promise<SecretResult<T>> {
    const policy = mergeFallbackPolicy(request);
    const strategy = policy.strategy ?? DEFAULT_FALLBACK_STRATEGY;
    const orderedSources = orderFallbackSources(request.sources, strategy);

    if (orderedSources.length === 0) {
      if (request.required) {
        throw new SecretNotFoundError(request.key);
      }

      return createEmptyResult<T>("env");
    }

    if (strategy === "parallel") {
      return runFallbackParallel<T>(request, orderedSources, policy);
    }

    return runFallbackSequential<T>(request, orderedSources, policy);
  }

  async function invalidateSingle(request: SingleSourceSecretRequest): Promise<void> {
    const adapter = adapterMap.get(request.source);
    if (!adapter) {
      return;
    }

    const resolvedMode = resolveMode(request, adapter, defaultMode);
    const normalizedRequest = normalizeRequest(request, resolvedMode);
    const cacheKey = toCacheKey(normalizedRequest, resolvedMode);

    clearRefreshTimer(cacheKey);
    await cache.delete(cacheKey);
  }

  const client: SecretClient = {
    async get<T = unknown>(request: SecretRequest): Promise<SecretResult<T>> {
      const start = Date.now();
      emit.requestStart(request);

      try {
        const result = isFallbackRequest(request)
          ? await runFallback<T>(request)
          : await loadFromSingleSource<T>(request, { reason: "direct" });

        emit.requestSuccess(
          request,
          result.metadata.source,
          result.metadata.mode,
          Date.now() - start
        );

        return result;
      } catch (error) {
        if (!isFallbackRequest(request) && !request.required && error instanceof SecretNotFoundError) {
          const emptyResult = createEmptyResult<T>(request.source);
          emit.requestSuccess(request, emptyResult.metadata.source, emptyResult.metadata.mode, Date.now() - start);
          return emptyResult;
        }

        emit.requestError(request, Date.now() - start, error);
        throw error;
      }
    },

    async getValue<T = unknown>(request: SecretRequest): Promise<T> {
      const result = await client.get<T>(request);
      return result.value;
    },

    async has(request: SecretRequest): Promise<boolean> {
      try {
        const result = await client.get({
          ...request,
          required: false
        });

        return result.value !== undefined && result.value !== null;
      } catch {
        return false;
      }
    },

    async invalidate(request: SecretRequest): Promise<void> {
      if (isFallbackRequest(request)) {
        for (const sourceConfig of request.sources) {
          await invalidateSingle(toSingleSourceRequest(request, sourceConfig));
        }

        return;
      }

      await invalidateSingle(request);
    },

    refresh<T = unknown>(request: SingleSourceSecretRequest): Promise<SecretResult<T>> {
      return loadFromSingleSource<T>(request, {
        skipCache: true,
        reason: "manual-refresh"
      });
    },

    async rotate<T = unknown>(
      request: SingleSourceSecretRequest,
      hooks: SecretRotationHooks<T>
    ): Promise<SecretResult<T>> {
      const adapter = adapterMap.get(request.source);
      if (!adapter) {
        throw new SecretAdapterNotFoundError(request.source);
      }

      const resolvedMode = resolveMode(request, adapter, defaultMode);
      ensureModeSupported(request.source, resolvedMode, adapter);
      const normalizedRequest = normalizeRequest(request, resolvedMode);

      const rotationContext = {
        request: normalizedRequest,
        adapter,
        adapterContext,
        client: {
          get: client.get,
          getValue: client.getValue,
          invalidate: client.invalidate,
          refresh: client.refresh
        }
      };

      try {
        emit.rotation(normalizedRequest, "before");
        await hooks.beforeRotate?.(rotationContext);

        emit.rotation(normalizedRequest, "rotate");
        const rotated = await hooks.rotate(rotationContext);

        if (hooks.verify) {
          emit.rotation(normalizedRequest, "verify");
          const verified = await hooks.verify(rotationContext, rotated);
          if (!verified) {
            throw new SecretRotationError(
              `Rotation verification failed for '${normalizedRequest.source}:${normalizedRequest.key}'`
            );
          }
        }

        emit.rotation(normalizedRequest, "after");
        await hooks.afterRotate?.(rotationContext, rotated);

        await client.invalidate(normalizedRequest);

        return rotated;
      } catch (error) {
        emit.rotation(normalizedRequest, "error", error);
        await hooks.onError?.(rotationContext, error);
        throw error;
      }
    },

    async dispose(): Promise<void> {
      disposed = true;

      for (const timer of refreshTimers.values()) {
        clearTimeout(timer);
      }

      refreshTimers.clear();
    },

    listSources() {
      return [...adapterMap.keys()];
    }
  };

  return client;
}
