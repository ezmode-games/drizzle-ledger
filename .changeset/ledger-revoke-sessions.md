---
"@rafters/ledger": minor
---

BREAKING: createSoftDeleteCallback now requires a revokeSessions callback and runs it before the soft-delete UPDATE. Revocation failure aborts the deletion with the real error. Wire it to better-auth's internal adapter (deleteSessions), and gate sign-in on deletedAt -- the docs carry the recipe.
