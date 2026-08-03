---
"@rafters/ledger": minor
---

purgeUserData gains ownership-aware matching (ownedRecords config) so entries written by admins/system about a user's records are reachable; executes via db.batch (all-or-nothing on D1/libsql); appends a PURGE audit entry per run; and reports unparseable-JSON rows via entriesSkipped instead of silently preserving them. anonymizeJsonData is hardened against literal __proto__ keys. PURGE joins the action enum (type-level only; no DB migration).
