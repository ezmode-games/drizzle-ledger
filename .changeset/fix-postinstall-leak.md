---
"@rafters/ledger": patch
---

Fix dev-workflow leak: `lefthook install` moved from `postinstall` to `prepare`. Consumers installing `@rafters/ledger` from the registry no longer execute `lefthook install` at install time. `prepare` still runs for contributors doing a local `pnpm install` in the source repo, so git hooks remain wired up.
