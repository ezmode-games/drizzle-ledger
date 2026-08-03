---
"@rafters/ledger": minor
---

createAuditedDb no longer mutates the input db (returns a Proxy), converts deletes inside transactions, executes soft-delete-all for unfiltered deletes instead of silently no-opping, adds an allowlist mode (softDeleteTables) that throws on misconfigured or unresolvable tables, and emits statement-level SOFT_DELETE audit entries -- including for batch-executed statements -- when a writeAuditEntry sink is configured.
