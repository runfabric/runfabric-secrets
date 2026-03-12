import type {
  DistributedSecretCacheDriver,
  SecretCache,
  SecretCacheEntry
} from "./types.js";

export class InMemorySecretCache implements SecretCache {
  private readonly store = new Map<string, SecretCacheEntry>();

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
    this.store.set(key, entry);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
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
