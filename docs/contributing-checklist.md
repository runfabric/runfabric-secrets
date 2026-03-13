# Contributing Checklist

Design guardrails:

- Keep provider-specific options inside each adapter package.
- Keep API mode as the default path; CLI is convenience/fallback.
- Keep adapter installation explicit in docs and examples.
- Keep core focused on unified read access; avoid provider-feature standardization creep.

Release checklist:

- `pnpm lint`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm coverage`
- `pnpm release:check`
- `pnpm snyk:test` (requires `SNYK_TOKEN`)

Coverage guidance:

- Coverage thresholds are configured in `scripts/coverage-thresholds.json`.
- `pnpm coverage` writes machine-readable output to `coverage/summary.json`.
