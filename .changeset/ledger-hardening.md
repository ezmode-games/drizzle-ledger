---
"@rafters/ledger": minor
---

Hardening: assertLedgerContextAvailable() boot check plus a one-time warning when AsyncLocalStorage is missing (unattributed audit trails no longer degrade silently); AUDIT_LOG_PROTECT_SQL per dialect for engine-level append-only audit tables; createAuditedDb refuses deletes on the audit table (AuditTableDeleteError); isSoftDeletePerformed documents its in-process trust boundary; context docs use the platform's trusted client-ip source.
