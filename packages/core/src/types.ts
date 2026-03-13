export type SecretMode = "api" | "cli";

export type SecretSource =
  | "aws"
  | "vault"
  | "gcp"
  | "azure"
  | "env"
  | "file"
  | (string & {});

export type SecretParseAs = "raw" | "string" | "json";

export type SecretEnvironment = Record<string, string | undefined>;

export interface SecretMetadata {
  source: SecretSource;
  mode: SecretMode | "native";
  version?: string;
  createdAt?: string;
  updatedAt?: string;
  ttlMs?: number;
  raw?: unknown;
}

export interface SecretResult<T = unknown> {
  value: T;
  metadata: SecretMetadata;
}

export interface SecretRequestBase {
  key: string;
  parseAs?: SecretParseAs;
  required?: boolean;
  cacheTtlMs?: number;
  version?: string;
  refreshIntervalMs?: number;
}

export interface SingleSourceSecretRequest extends SecretRequestBase {
  source: SecretSource;
  mode?: SecretMode;
  signal?: AbortSignal;
}

export interface FallbackSourceConfig {
  source: SecretSource;
  mode?: SecretMode;
  weight?: number;
}

export type FallbackStrategy = "sequential" | "weighted" | "parallel";

export interface FallbackPolicy {
  strategy?: FallbackStrategy;
  failFast?: boolean;
  failFastOn?: string[];
  retryableErrors?: string[];
  parallelism?: number;
}

export interface FallbackSecretRequest extends SecretRequestBase {
  sources: FallbackSourceConfig[];
  fallbackPolicy?: FallbackPolicy;
}

export type SecretRequest = SingleSourceSecretRequest | FallbackSecretRequest;

export interface SecretLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface SecretAdapterContext {
  logger?: SecretLogger;
  now: () => number;
  env: SecretEnvironment;
}

export interface SecretAdapterCapabilities {
  api?: boolean;
  cli?: boolean;
  native?: boolean;
  versioning?: boolean;
  structuredData?: boolean;
}

export interface SecretAdapter {
  readonly source: SecretSource;
  readonly capabilities: SecretAdapterCapabilities;

  get(
    request: SingleSourceSecretRequest,
    context: SecretAdapterContext
  ): Promise<SecretResult>;

  healthCheck?(
    context: SecretAdapterContext
  ): Promise<{ ok: boolean; details?: unknown }>;
}

export interface SecretCacheEntry {
  expiresAt: number;
  result: SecretResult;
}

export interface SecretCache {
  get(key: string): Promise<SecretCacheEntry | null> | SecretCacheEntry | null;
  set(key: string, entry: SecretCacheEntry): Promise<void> | void;
  delete(key: string): Promise<void> | void;
  clear?(): Promise<void> | void;
}

export interface DistributedSecretCacheDriver {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export interface SecretTelemetryEvent {
  request: SecretRequest | SingleSourceSecretRequest;
  source?: SecretSource;
  mode?: SecretMode | "native";
  cacheKey?: string;
  durationMs?: number;
  attempt?: number;
  totalAttempts?: number;
  strategy?: FallbackStrategy;
  refreshIntervalMs?: number;
  rotationStage?: "before" | "rotate" | "verify" | "after" | "error";
  error?: unknown;
  metadata?: Record<string, unknown>;
}

export interface SecretTelemetryHooks {
  onRequestStart?(event: SecretTelemetryEvent): void;
  onRequestSuccess?(event: SecretTelemetryEvent): void;
  onRequestError?(event: SecretTelemetryEvent): void;
  onCacheHit?(event: SecretTelemetryEvent): void;
  onFallbackAttempt?(event: SecretTelemetryEvent): void;
  onBackgroundRefresh?(event: SecretTelemetryEvent): void;
  onRotation?(event: SecretTelemetryEvent): void;
}

export interface SecretBackgroundRefreshOptions {
  enabled?: boolean;
  defaultIntervalMs?: number;
  jitterMs?: number;
}

export interface SecretClientOptions {
  adapters: SecretAdapter[];
  defaultMode?: SecretMode;
  defaultCacheTtlMs?: number;
  cache?: SecretCache;
  logger?: SecretLogger;
  env?: SecretEnvironment;
  fallbackPolicy?: FallbackPolicy;
  telemetry?: SecretTelemetryHooks;
  backgroundRefresh?: SecretBackgroundRefreshOptions;
}

export interface SecretRotationContext {
  request: SingleSourceSecretRequest;
  adapter: SecretAdapter;
  adapterContext: SecretAdapterContext;
  client: Pick<SecretClient, "get" | "getValue" | "invalidate" | "refresh">;
}

export interface SecretRotationHooks<T = unknown> {
  beforeRotate?(context: SecretRotationContext): Promise<void> | void;
  rotate(context: SecretRotationContext): Promise<SecretResult<T>> | SecretResult<T>;
  verify?(context: SecretRotationContext, result: SecretResult<T>): Promise<boolean> | boolean;
  afterRotate?(context: SecretRotationContext, result: SecretResult<T>): Promise<void> | void;
  onError?(context: SecretRotationContext, error: unknown): Promise<void> | void;
}

export interface SecretAdapterDiscoveryPlugin {
  module: string;
  exportName?: string;
  options?: unknown;
}

export interface SecretAdapterDiscoveryOptions {
  plugins: Array<string | SecretAdapterDiscoveryPlugin>;
  importer?: (moduleName: string) => Promise<unknown>;
  logger?: SecretLogger;
  allowedModules?: string[];
}

export interface CreateSecretClientWithDiscoveryOptions extends Omit<SecretClientOptions, "adapters"> {
  adapters?: SecretAdapter[];
  discovery?: SecretAdapterDiscoveryOptions;
}

export interface SecretClient {
  get<T = unknown>(request: SecretRequest): Promise<SecretResult<T>>;
  getValue<T = unknown>(request: SecretRequest): Promise<T>;
  has(request: SecretRequest): Promise<boolean>;
  invalidate(request: SecretRequest): Promise<void>;
  refresh<T = unknown>(request: SingleSourceSecretRequest): Promise<SecretResult<T>>;
  rotate<T = unknown>(
    request: SingleSourceSecretRequest,
    hooks: SecretRotationHooks<T>
  ): Promise<SecretResult<T>>;
  dispose(): Promise<void>;
  listSources(): SecretSource[];
}
