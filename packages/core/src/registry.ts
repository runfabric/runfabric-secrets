import type { SecretAdapter, SecretSource } from "./types.js";

export function createAdapterRegistry(adapters: SecretAdapter[]): Map<SecretSource, SecretAdapter> {
  const registry = new Map<SecretSource, SecretAdapter>();
  for (const adapter of adapters) {
    registry.set(adapter.source, adapter);
  }
  return registry;
}
