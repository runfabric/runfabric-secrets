# @runfabric/secrets

TypeScript monorepo for a unified, adapter-based secret read client.

## Package scope

- `@runfabric/secrets-core`
- `@runfabric/secrets-adapter-env`
- `@runfabric/secrets-adapter-file`
- `@runfabric/secrets-adapter-aws`
- `@runfabric/secrets-adapter-vault`
- `@runfabric/secrets-adapter-gcp`
- `@runfabric/secrets-adapter-azure`

Additional packages:

- `@runfabric/secrets-zod`: runtime schemas
- `@runfabric/secrets-testing`: test helpers

## V2 features

- Background refresh
- Rotation orchestration hooks
- Distributed cache wrapper
- Telemetry hooks
- Browser client factory
- Adapter discovery helpers
- Advanced fallback policies (weighted/parallel/fail-fast)

## Quick start

```bash
pnpm install
pnpm verify:v2
```
