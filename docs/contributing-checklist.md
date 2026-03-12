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
- `pnpm release:check`
