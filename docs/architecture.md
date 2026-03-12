# Architecture

The system is centered around `@runfabric/secrets-core`.

Core owns the unified read contract:
- request/response types
- adapter interface
- fallback orchestration
- parse behavior (`raw`, `string`, `json`)
- cache abstractions (in-memory + distributed driver wrapper)
- telemetry hooks
- background refresh scheduling
- rotation orchestration
- optional adapter discovery
- browser-safe client factory

Provider packages own provider-specific options and runtime integrations.
Core does not import provider SDKs.

Supported adapters:
- env
- file
- aws
- vault
- gcp
- azure
