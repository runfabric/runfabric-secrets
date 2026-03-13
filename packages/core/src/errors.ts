export class SecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretError";
  }
}

export class SecretAdapterNotFoundError extends SecretError {
  constructor(source: string) {
    super(`No adapter registered for source '${source}'`);
    this.name = "SecretAdapterNotFoundError";
  }
}

export class SecretDuplicateAdapterError extends SecretError {
  readonly sources: string[];

  constructor(sources: string[]) {
    const uniqueSources = [...new Set(sources)];
    super(`Duplicate adapters registered for source(s): ${uniqueSources.join(", ")}`);
    this.name = "SecretDuplicateAdapterError";
    this.sources = uniqueSources;
  }
}

export class SecretModeNotSupportedError extends SecretError {
  constructor(source: string, mode: string) {
    super(`Adapter '${source}' does not support mode '${mode}'`);
    this.name = "SecretModeNotSupportedError";
  }
}

export class SecretNotFoundError extends SecretError {
  constructor(key: string) {
    super(`Secret '${key}' was not found`);
    this.name = "SecretNotFoundError";
  }
}

export class SecretParseError extends SecretError {
  constructor(key: string, reason: string) {
    super(`Failed to parse secret '${key}': ${reason}`);
    this.name = "SecretParseError";
  }
}

export class SecretDiscoveryError extends SecretError {
  constructor(moduleName: string, reason: string) {
    super(`Failed to discover adapter from '${moduleName}': ${reason}`);
    this.name = "SecretDiscoveryError";
  }
}

export class SecretRotationError extends SecretError {
  constructor(message: string) {
    super(message);
    this.name = "SecretRotationError";
  }
}
