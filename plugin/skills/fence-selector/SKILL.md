---
name: fence-selector
description: >-
  Find and verify a CSS selector on the live site before declaring a browser
  transform fence (hiding a feed, a column, comments, a button). Use when asked
  to hide or conceal part of a website, when "/fence-selector" is typed, or
  before any `set_browser_transform` or click-trigger gate whose selector has
  not been measured on the live DOM.
---

# Fence selector

A transform fence is only as good as its selector, and a selector fails in two directions that look identical from the outside: it matches **nothing** (the fence reads as protection and is none), or it matches **too much** (it blanks the page around its target). Both have shipped here: `youtube-shorts-hidden`'s description in `~/.zenborg/fences.json` records v1–v3 of exactly that. Every selector is therefore **measured**: a target count that must drop, and a control count that must hold.

## Steps

1. **Name the region and its controls.** Write down what the gardener wants gone (the target) and what must survive on the same page (the controls: the player, the title, search, navigation, the main content of sibling pages that share components). Done when every control is a countable query.

2. **Open the live site** with the Playwright MCP tools (load them through ToolSearch), logged out. Reach the real page state, including states that need an action (a finished video, a game-over screen, a scrolled-in comment thread). Never write a selector from memory: names from memory are the v1 failure. Done when the target region is on screen and you have its outer HTML.

3. **Pick candidates by durability.** Prefer, in order: product-contract anchors (ids such as `#comments`, URL predicates such as `:has(a[href^="/shorts"])`, page-scoping attributes such as `ytd-browse[page-subtype="home"]`, test hooks such as `data-cy`), then component names, then structure. Scope a component that also renders elsewhere to the page that owns it. Use `:has()` on the narrowest container that holds the whole region: on a leaf it is precise, on a section it is a blast radius.

4. **Bisect, one selector at a time.** Inject `{display:none !important}` for a single candidate, record target count and every control count, remove it, repeat. A redundant selector and a catastrophic one look the same in aggregate, so never measure the union first. Done when each candidate has its own before/after row.

5. **Widen the check.**
   - Two widths: 1280×800 and 800×800 (layouts move regions between columns).
   - Sibling pages that reuse the components (a selector for one feed must match 0 on the others).
   - In-site navigation without a reload (click a link, then re-count), since the transform is CSS and stale attributes are the risk.
   Done when the table covers every width and page, with zero control loss.

6. **Declare it** with `set_browser_transform`: `primary` is the most durable selector that passed, `fallbacks` the other passing ones (all are emitted together, not in sequence). The `description` carries the measured table in prose: date, target before→after, controls unchanged, what was rejected and why, and what could not be verified (logged-in layouts, mobile hosts, states you could not reach). If the tool refuses, return the record JSON to the gardener; never hand-edit `fences.json` silently.

7. **Report** the selector, the counts table and the unverified list. The fence is live after the extension's next sync (≤5 min); one look by the gardener on their logged-in browser closes the unverified gap.

## Reading a result

| Result | Meaning |
|---|---|
| target → 0, controls unchanged | passes |
| target unchanged | matches nothing visible: dead name or wrong state |
| target → 0, a control drops | blast radius: narrow the container |
| target → 0 but the empty container keeps its size | hides the content, not the region: go one level up |
| selector matches on a sibling page | unscoped component: add the page anchor |
