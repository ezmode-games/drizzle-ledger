---
"@rafters/ledger": patch
---

better-auth 1.6 support verified against installed 1.6.25 source: hook veto/merge semantics and same-chain after-hook draining hold, so the attribution pairing and revocation ordering contracts are intact. A real peerDependencies range is declared (>=1.5.0 <1.7.0). Session-revocation wiring docs updated for better-auth's mid-1.6 internal API split: deleteSessions(userId) silently deletes nothing on late 1.6.x -- use deleteUserSessions(userId), feature-detected in the examples.
