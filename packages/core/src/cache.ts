import type {
  DistributedSecretCacheDriver,
  SecretCache,
  SecretCacheEntry
} from "./types.js";

const DEFAULT_IN_MEMORY_CACHE_MAX_ENTRIES = 1_000;
const DEFAULT_IN_MEMORY_CACHE_PRUNE_INTERVAL = 32;
const DEFAULT_IN_MEMORY_CACHE_PRUNE_SAMPLE_SIZE = 64;

export interface InMemorySecretCacheOptions {
  maxEntries?: number;
}

export class InMemorySecretCache implements SecretCache {
  private readonly store = new Map<string, SecretCacheEntry>();
  private readonly maxEntries: number;
  private writesSinceLastPrune = 0;

  constructor(options: InMemorySecretCacheOptions = {}) {
    const configuredMaxEntries = options.maxEntries ?? DEFAULT_IN_MEMORY_CACHE_MAX_ENTRIES;
    this.maxEntries = Math.max(1, Math.floor(configuredMaxEntries));
  }

  get(key: string): SecretCacheEntry | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return entry;
  }

  set(key: string, entry: SecretCacheEntry): void {
    if (this.store.has(key)) {
      this.store.set(key, entry);
      return;
    }

    if (this.store.size >= this.maxEntries) {
      this.pruneExpiredOldestEntries();
    }

    if (this.store.size >= this.maxEntries && this.shouldSamplePruneExpiredEntries()) {
      this.pruneExpiredEntriesSampled();
    }

    if (this.store.size >= this.maxEntries) {
      this.evictOldestEntries(this.store.size - this.maxEntries + 1);
    }

    this.store.set(key, entry);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  private pruneExpiredOldestEntries(): void {
    const now = Date.now();

    while (this.store.size > 0) {
      const oldest = this.store.entries().next().value;
      if (!oldest) {
        return;
      }

      const [key, entry] = oldest;
      if (now < entry.expiresAt) {
        return;
      }

      this.store.delete(key);
    }
  }

  private pruneExpiredEntriesSampled(): void {
    const now = Date.now();
    let checks = 0;
    for (const [key, entry] of this.store.entries()) {
      if (checks >= DEFAULT_IN_MEMORY_CACHE_PRUNE_SAMPLE_SIZE) {
        return;
      }

      checks += 1;
      if (now >= entry.expiresAt) {
        this.store.delete(key);
      }
    }
  }

  private evictOldestEntries(count: number): void {
    for (let index = 0; index < count; index += 1) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }

      this.store.delete(oldestKey);
    }
  }

  private shouldSamplePruneExpiredEntries(): boolean {
    this.writesSinceLastPrune += 1;
    const interval = Math.max(
      1,
      Math.min(DEFAULT_IN_MEMORY_CACHE_PRUNE_INTERVAL, this.maxEntries)
    );

    if (this.writesSinceLastPrune < interval) {
      return false;
    }

    this.writesSinceLastPrune = 0;
    return true;
  }
}

export interface DistributedSecretCacheOptions {
  keyPrefix?: string;
}

export class DistributedSecretCache implements SecretCache {
  constructor(
    private readonly driver: DistributedSecretCacheDriver,
    private readonly options: DistributedSecretCacheOptions = {}
  ) {}

  async get(key: string): Promise<SecretCacheEntry | null> {
    const raw = await this.driver.get(this.withPrefix(key));
    if (!raw) {
      return null;
    }

    let entry: SecretCacheEntry;

    try {
      entry = JSON.parse(raw) as SecretCacheEntry;
    } catch {
      await this.driver.delete(this.withPrefix(key));
      return null;
    }

    if (!isValidSecretCacheEntry(entry)) {
      await this.driver.delete(this.withPrefix(key));
      return null;
    }

    if (Date.now() >= entry.expiresAt) {
      await this.driver.delete(this.withPrefix(key));
      return null;
    }

    return entry;
  }

  async set(key: string, entry: SecretCacheEntry): Promise<void> {
    const ttlMs = Math.max(0, entry.expiresAt - Date.now());
    await this.driver.set(this.withPrefix(key), JSON.stringify(entry), ttlMs);
  }

  delete(key: string): Promise<void> {
    return this.driver.delete(this.withPrefix(key));
  }

  clear(): Promise<void> | void {
    return this.driver.clear?.();
  }

  private withPrefix(key: string): string {
    if (!this.options.keyPrefix) {
      return key;
    }

    return `${this.options.keyPrefix}:${key}`;
  }
}

export function createDistributedSecretCache(
  driver: DistributedSecretCacheDriver,
  options?: DistributedSecretCacheOptions
): SecretCache {
  return new DistributedSecretCache(driver, options);
}

function isValidSecretCacheEntry(value: unknown): value is SecretCacheEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    expiresAt?: unknown;
    result?: unknown;
  };

  if (typeof candidate.expiresAt !== "number" || !Number.isFinite(candidate.expiresAt)) {
    return false;
  }

  if (!candidate.result || typeof candidate.result !== "object") {
    return false;
  }

  const result = candidate.result as {
    metadata?: unknown;
  };

  if (!result.metadata || typeof result.metadata !== "object") {
    return false;
  }

  const metadata = result.metadata as {
    source?: unknown;
    mode?: unknown;
  };

  return typeof metadata.source === "string" && typeof metadata.mode === "string";
}
