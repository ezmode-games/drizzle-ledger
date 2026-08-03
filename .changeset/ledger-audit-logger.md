---
"@rafters/ledger": minor
---

AuditLogger no longer fire-and-forgets writes (waitUntil/flush), surfaces unparseable mutations as visible "unknown" entries, excludes bound params from entries unless includeParams is set, restricts extractRecordId to UUID-shaped params, and compares table filters case-insensitively. Behavior change: params are no longer populated by default and non-UUID record ids are no longer extracted.
