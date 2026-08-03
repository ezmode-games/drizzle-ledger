---
"@rafters/ledger": patch
---

ledgerPlugin audit entries attribute to the acting principal from ledger context (never the target row's id), and update entries carry the incoming change set as oldData { changed }, paired per-request via the LedgerContext object so concurrent requests cannot cross-pair and failed updates cannot desync the plugin. Change-set capture, like attribution, requires runWithLedgerContext.
