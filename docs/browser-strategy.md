# Browser Support Strategy

Use `createBrowserSecretClient(...)` from `@runfabric/secrets-core/browser`.

Principles:
- Pass browser-safe adapters only (for example HTTP-backed adapters, custom adapters, or bridge adapters).
- Avoid server-only transports/SDKs in browser bundles unless intentionally polyfilled.
- Provide explicit `env` object when needed; browser client does not rely on `process.env`.
- Keep provider credentials server-side whenever possible and proxy secret reads through trusted backends.

Recommended shape:
- Browser app -> backend secret endpoint (or tokenized proxy) -> provider adapter on server.
