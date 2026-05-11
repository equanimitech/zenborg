# Refresh / resync the vault from the UI

Raw capture — 2026-04-30.

- I want to be able to refresh / resync the vault from the UI.
- ALWAYS give affordances to refresh (work when broken). Don't make me reload the app to recover from a stuck state.
- Adjacent angles:
  - Where does the affordance live? Always-on (header chrome) vs only-when-stale (badge appears when out-of-sync detected)?
  - Maybe both: a quiet always-available "resync" hidden in a menu, plus a louder one when the system detects drift.
  - Need a clear "last synced" timestamp visible somewhere — peripheral, not loud.
  - Resync should be idempotent — pressing it twice in a row shouldn't corrupt anything.
- Questions:
  - What does "refresh" mean exactly? Re-read JSON files from disk? Re-derive computed observables? Re-scan the vault directory for new entities?
  - Should there be a hard refresh (rebuild from disk) and a soft refresh (re-derive only)?
  - What feedback during refresh — spinner? quiet pulse? nothing visible if fast enough?
  - Does this surface error states clearly when refresh fails (vault locked, file missing, JSON parse error)?
- Don't shape yet.
