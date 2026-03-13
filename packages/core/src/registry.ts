import { SecretDuplicateAdapterError } from "./errors.js";
import type { SecretAdapter, SecretLogger, SecretSource } from "./types.js";

export function createAdapterRegistry(
  adapters: SecretAdapter[],
  logger?: SecretLogger
): Map<SecretSource, SecretAdapter> {
  const registry = new Map<SecretSource, SecretAdapter>();
  const duplicates = new Set<SecretSource>();

  for (const adapter of adapters) {
    if (registry.has(adapter.source)) {
      duplicates.add(adapter.source);
    }

    registry.set(adapter.source, adapter);
  }

  if (duplicates.size > 0) {
    const duplicateSources = [...duplicates];
    logger?.warn("Duplicate adapters detected during registry construction", {
      duplicateSources
    });
    throw new SecretDuplicateAdapterError(duplicateSources);
  }

  return registry;
}
