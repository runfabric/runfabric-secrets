# Adapter Guide

An adapter implements `SecretAdapter` from `@runfabric/secrets-core`.

Required fields:
- `source`
- `capabilities`
- `get(request, context)`

Notes:
- Adapter `get` should return a `SecretResult` or throw `SecretNotFoundError`.
- Keep provider-specific options and dependencies inside the adapter package.
- Expose adapter factories like `createAwsAdapter(...)` or `createEnvAdapter()`.
- Keep adapter installation explicit; do not hide provider requirements.
- Keep API mode as the default path and treat CLI mode as convenience/fallback.

Current adapters:
- `@runfabric/secrets-adapter-env`
- `@runfabric/secrets-adapter-file`
- `@runfabric/secrets-adapter-aws`
- `@runfabric/secrets-adapter-vault`
- `@runfabric/secrets-adapter-gcp`
- `@runfabric/secrets-adapter-azure`
