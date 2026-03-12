import { createSecretClient } from "./client.js";
import { SecretDiscoveryError } from "./errors.js";
import type {
  CreateSecretClientWithDiscoveryOptions,
  SecretAdapter,
  SecretAdapterDiscoveryOptions,
  SecretAdapterDiscoveryPlugin,
  SecretClient
} from "./types.js";

export async function discoverAdapters(
  options: SecretAdapterDiscoveryOptions
): Promise<SecretAdapter[]> {
  const importer = options.importer ?? defaultImporter;
  const adapters: SecretAdapter[] = [];

  for (const entry of options.plugins) {
    const plugin = normalizePlugin(entry);
    const moduleName = plugin.module;

    let moduleNamespace: unknown;

    try {
      moduleNamespace = await importer(moduleName);
    } catch (error) {
      throw new SecretDiscoveryError(
        moduleName,
        error instanceof Error ? error.message : String(error)
      );
    }

    const selectedExport = pickExport(moduleNamespace, plugin);
    if (selectedExport === undefined) {
      throw new SecretDiscoveryError(moduleName, "No compatible export found");
    }

    const discovered = await materializeAdapters(selectedExport, plugin);
    if (discovered.length === 0) {
      throw new SecretDiscoveryError(moduleName, "No adapters were produced by plugin export");
    }

    adapters.push(...discovered);
  }

  options.logger?.info("Discovered adapters", {
    count: adapters.length,
    sources: adapters.map((adapter) => adapter.source)
  });

  return adapters;
}

export async function createSecretClientWithDiscovery(
  options: CreateSecretClientWithDiscoveryOptions
): Promise<SecretClient> {
  const discovered = options.discovery
    ? await discoverAdapters(options.discovery)
    : [];

  return createSecretClient({
    ...options,
    adapters: [...(options.adapters ?? []), ...discovered]
  });
}

async function materializeAdapters(
  selectedExport: unknown,
  plugin: SecretAdapterDiscoveryPlugin
): Promise<SecretAdapter[]> {
  if (isSecretAdapter(selectedExport)) {
    return [selectedExport];
  }

  if (Array.isArray(selectedExport)) {
    return selectedExport.filter(isSecretAdapter);
  }

  if (typeof selectedExport === "function") {
    const maybeAdapter = await selectedExport(plugin.options);

    if (isSecretAdapter(maybeAdapter)) {
      return [maybeAdapter];
    }

    if (Array.isArray(maybeAdapter)) {
      return maybeAdapter.filter(isSecretAdapter);
    }
  }

  return [];
}

function pickExport(moduleNamespace: unknown, plugin: SecretAdapterDiscoveryPlugin): unknown {
  if (!moduleNamespace || typeof moduleNamespace !== "object") {
    return undefined;
  }

  const namespace = moduleNamespace as Record<string, unknown>;

  if (plugin.exportName) {
    return namespace[plugin.exportName];
  }

  if ("default" in namespace) {
    return namespace.default;
  }

  if ("createAdapter" in namespace) {
    return namespace.createAdapter;
  }

  const key = Object.keys(namespace).find(
    (candidate) => candidate.startsWith("create") && candidate.endsWith("Adapter")
  );

  return key ? namespace[key] : undefined;
}

function normalizePlugin(entry: string | SecretAdapterDiscoveryPlugin): SecretAdapterDiscoveryPlugin {
  if (typeof entry === "string") {
    return {
      module: entry
    };
  }

  return entry;
}

function isSecretAdapter(value: unknown): value is SecretAdapter {
  return (
    typeof value === "object" &&
    value !== null &&
    "source" in value &&
    "capabilities" in value &&
    "get" in value &&
    typeof (value as Record<string, unknown>).get === "function"
  );
}

async function defaultImporter(moduleName: string): Promise<unknown> {
  return import(moduleName);
}
