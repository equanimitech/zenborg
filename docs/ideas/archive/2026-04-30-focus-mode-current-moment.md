# Focus mode for moments — currentMoment as attention primitive

Raw capture — 2026-04-30.

- We desperately need a 'focus' mode for moments.
- Engageable on any moment scheduled for today (no phase lock for now).
- Press 'play' (or 'track') on a moment to dive into a `currentMoment` state — a very special primitive for the attention management system.
- Time should be configurable. Maybe store default durations per habit?
- Engaging focus mode should activate "focus protection shields" — see existing ones in `../equanimi` (deep dive needed).
- Reference: `../docs/ZENBORG_CONSOLIDATION` for prior thinking on how Zenborg and equanimi shields relate.
- Later: surface focus mode in the macOS top toolbar. We need to add this. Inspiration: `../equanimi/apps/browser`.
- Later: influence friction around the computer using lightweight LLMs to scan for:
  - unrelated screens
  - unrelated websites
  - unrelated sessions (Claude)
  - …and add gentle reminders.

- Questions:
  - What is the right verb — 'play', 'track', 'tend', 'engage'? (Tone matters; this isn't a productivity timer.)
  - Should `currentMoment` be a derived state (whichever moment is "active") or a stored field on Moment / global state?
  - Default durations: per-habit? per-attitude? per-phase?
  - How does ending a focus session interact with completion semantics — given Zenborg's red line against "done" / streaks / completion %?
  - Do shields belong in zenborg or stay in equanimi with zenborg sending a signal?
  - Toolbar surfacing: Tauri tray vs full menubar app — what does the equanimi browser app teach?
  - LLM friction layer: is this in scope for zenborg ever, or always equanimi territory?

- Don't shape yet.
