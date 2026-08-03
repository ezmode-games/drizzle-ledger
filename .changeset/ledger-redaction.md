---
"@rafters/ledger": minor
---

BREAKING: ledgerPlugin's default auditTables drops from ["user", "account"] to ["user"] -- better-auth account rows carry OAuth tokens and password hashes; auditing account is now opt-in. New always-on, fail-closed secret redaction (redactSensitiveFields, DEFAULT_SECRET_PATTERNS) applied to every better-auth audit path; Date values pass through intact.
