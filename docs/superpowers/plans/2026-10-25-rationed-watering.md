# Rationed Watering Implementation Plan

**Goal:** A `rationed` watering mode that walls a host pool once its attended minutes for the local day reach a budget; first use is YouTube, 60 min/day on weekends.

**Architecture:** The domain factory emits `dry`-shaped browser rules whose schedule primitive carries a `budget`. The extension counts today's attended minutes per pool with `bouts()` over host events merged with the outbox, stores them in `chrome.storage.local`, and applies the budget inside `liveFences()` the way lifts are applied. A pool that is spent gets its own DNR block rule with `excludedRequestDomains`.

**Tech Stack:** TypeScript, vitest, zod (MCP), WXT MV3 extension, chrome.declarativeNetRequest.

**Spec:** `docs/superpowers/specs/2026-10-25-rationed-watering-design.md`

## Global Constraints

- pnpm only. Root suite: `pnpm test` (also the pre-commit hook). Extension: `cd extension && pnpm test && pnpm typecheck`.
- Never run the extension dev server.
- `budgetMinutes`: integer, 1 to 1440. Pool id = the policy name.
- Minutes are per machine-local day of the bout's start, same as `src/domain/attention/siteMinutes.ts`.
- Count failure fails open (no wall) and is logged with `console.error`, never swallowed.
- Popup readout is plain text: `<label>: <n> / <budget> min today`. No bar, no colour (red line).
- Zero `host_permissions` stays true.
- `extension/modules/domain/bouts.ts` and `scheduleWindow.ts` are vendored byte-for-byte; do not edit them.
- Work on a feature branch, `feat/rationed-watering`; one commit per task.

---

### Task 1: Domain — `rationed` mode and `budget` on the schedule primitive

**Files:**
- Modify: `src/domain/intervention/Primitive.ts` (`ScheduleSpec`, ~line 212)
- Modify: `src/domain/intervention/rules/wateringHours.ts`
- Test: `src/domain/intervention/rules/__tests__/wateringHours.test.ts`

**Interfaces:**
- Produces: `WateringHoursMode = "regular" | "dry" | "by_hand" | "rationed"`; `WateringHoursInput.budget?: { minutes: number; exclude: readonly string[] }`; `ScheduleSpec.budget?: { readonly minutes: number; readonly pool: string; readonly exclude: readonly string[] }`.

- [ ] **Step 1: Write the failing test** (append to `wateringHours.test.ts`)

```ts
const RATIONED_INPUT: WateringHoursInput = {
  policyName: "youtube-weekend",
  mode: "rationed",
  window: { fromHour: 0, toHour: 0, weekdays: [Weekday.SAT, Weekday.SUN] },
  serves,
  returnsTo: ["area-wellness"],
  restricts: { hosts: ["youtube.com", "youtu.be"] },
  unlockNote: "Tomorrow.",
  reach: "navigation",
  budget: { minutes: 60, exclude: ["music.youtube.com"] },
};

describe("wateringHoursRules — rationed mode", () => {
  it("emits one access-block browser rule per host, each carrying the pool budget", () => {
    const rules = wateringHoursRules(RATIONED_INPUT);
    expect(rules.map((r) => r.id)).toEqual([
      "watering:youtube-weekend:browser:youtube.com",
      "watering:youtube-weekend:browser:youtu.be",
    ]);
    for (const rule of rules) {
      expect(rule.mechanism).toBe("access-block");
      expect(validateRuleSpec(rule)).toEqual([]);
      expect(carriesExit(rule.primitives[0])).toBe(true);
      const p = rule.primitives[0];
      if (p.kind !== "schedule") throw new Error("expected schedule");
      expect(p.budget).toEqual({ minutes: 60, pool: "youtube-weekend", exclude: ["music.youtube.com"] });
      if (p.wraps.kind !== "cooldown") throw new Error("expected cooldown");
      expect(p.wraps.enforcement).toEqual({ at: "browser", reach: "navigation" });
    }
  });

  it("puts no budget on a dry rule", () => {
    const [rule] = wateringHoursRules({ ...RATIONED_INPUT, mode: "dry", budget: undefined });
    const p = rule.primitives[0];
    expect(p.kind === "schedule" && p.budget).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/domain/intervention/rules/__tests__/wateringHours.test.ts`. Expected: FAIL (type error / `budget` undefined).

- [ ] **Step 3: Implement**

In `Primitive.ts`, add to `ScheduleSpec`:

```ts
  /**
   * Rationed watering: the wrapped block holds only once the pool's attended
   * minutes for the local day reach `minutes`. `pool` is the policy name, shared
   * by every rule the policy emits; `exclude` names subdomains that neither
   * count nor are walled.
   */
  readonly budget?: {
    readonly minutes: number;
    readonly pool: string;
    readonly exclude: readonly string[];
  };
```

In `wateringHours.ts`:
- `export type WateringHoursMode = "regular" | "dry" | "by_hand" | "rationed";`
- Add to `WateringHoursInput`: `readonly budget?: { readonly minutes: number; readonly exclude: readonly string[] };`
- In `primitivesFor`, add:

```ts
    case "rationed": {
      const [rung] = dryRung(
        input.window,
        input.unlockNote || "Tomorrow.",
        browser ? input.reach : undefined,
      );
      if (rung.kind !== "schedule" || !input.budget) return [rung];
      return [
        {
          ...rung,
          budget: {
            minutes: input.budget.minutes,
            pool: input.policyName,
            exclude: [...input.budget.exclude],
          },
        },
      ];
    }
```

- `mechanismFor`: `return mode === "dry" || mode === "rationed" ? "access-block" : "friction";`
- Update the file's header comment: "One factory, four modes"; add one sentence for `rationed`.

- [ ] **Step 4: Run** the same test. Expected: PASS. Then `pnpm tsc --noEmit -p .` (root). Fix any exhaustiveness errors (GapDetector needs no change: rationed is browser-only).

- [ ] **Step 5: Commit** `feat(intervention): rationed watering mode carries a daily budget`

---

### Task 2: Use case and MCP tool — declare a rationed policy

**Files:**
- Modify: `src/application/use-cases/fences.ts` (`WateringHoursDeclaration`, `declareWateringHours`)
- Modify: `mcp-server/index.ts` (`set_watering_hours`, ~line 4070)
- Test: `src/application/__tests__/wateringHoursFences.test.ts`

**Interfaces:**
- Consumes: Task 1 `WateringHoursInput.budget`.
- Produces: `WateringHoursDeclaration.budgetMinutes?: number`, `restricts.excludeHosts?: readonly string[]`.

- [ ] **Step 1: Write the failing tests** (use the file's existing `deps()` helper)

```ts
describe("declareWateringHours — rationed", () => {
  const base = {
    name: "youtube-weekend",
    mode: "rationed" as const,
    window: { fromHour: 0, toHour: 0, weekdays: ["SAT", "SUN"] as const },
    waters: ["Wellness"],
    restricts: { hosts: ["youtube.com", "m.youtube.com", "youtu.be"], excludeHosts: ["music.youtube.com"] },
    unlockNote: "Tomorrow.",
    reach: "navigation" as const,
    budgetMinutes: 60,
  };

  it("writes one rule per host with the budget", async () => {
    const { d, stored } = deps();
    const result = await declareWateringHours(d, base);
    if ("problems" in result) throw new Error(result.problems.join("; "));
    expect(result.declared).toHaveLength(3);
    const p = stored()["watering:youtube-weekend:browser:youtube.com"].primitives[0];
    expect(p.kind === "schedule" && p.budget).toEqual({ minutes: 60, pool: "youtube-weekend", exclude: ["music.youtube.com"] });
  });

  it("refuses rationed without budgetMinutes", async () => {
    const { budgetMinutes: _, ...rest } = base;
    const result = await declareWateringHours(deps().d, rest);
    expect("problems" in result && result.problems.join()).toMatch(/budgetMinutes/);
  });

  it.each([0, 1441, 1.5])("refuses budgetMinutes %s", async (budgetMinutes) => {
    const result = await declareWateringHours(deps().d, { ...base, budgetMinutes });
    expect("problems" in result && result.problems.join()).toMatch(/budgetMinutes/);
  });

  it("refuses budgetMinutes on a dry policy", async () => {
    const result = await declareWateringHours(deps().d, { ...base, mode: "dry" });
    expect("problems" in result && result.problems.join()).toMatch(/budgetMinutes/);
  });

  it("refuses an excluded host outside the pool", async () => {
    const result = await declareWateringHours(deps().d, {
      ...base,
      restricts: { ...base.restricts, excludeHosts: ["vimeo.com"] },
    });
    expect("problems" in result && result.problems.join()).toMatch(/excludeHosts/);
  });

  it("refuses rationed on garden or session surfaces", async () => {
    const result = await declareWateringHours(deps().d, {
      ...base,
      restricts: { ...base.restricts, areas: ["Craft"] },
    });
    expect("problems" in result && result.problems.join()).toMatch(/rationed/);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/application/__tests__/wateringHoursFences.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** in `fences.ts`:
- Add `budgetMinutes?: number` to `WateringHoursDeclaration`, and `excludeHosts?: readonly string[]` to its `restricts`. Update the `reach` doc comment to say "`dry` or `rationed`".
- After the existing dry-mode `unlockNote` check, add:

```ts
  if (input.mode === "rationed") {
    if (!input.unlockNote || input.unlockNote.trim() === "") {
      problems.push(
        "rationed mode requires unlockNote — a block that names no way out is refused (invariant 6)",
      );
    }
    const m = input.budgetMinutes;
    if (m === undefined || !Number.isInteger(m) || m < 1 || m > 1440) {
      problems.push("rationed mode requires budgetMinutes, a whole number from 1 to 1440");
    }
    if (!input.restricts.hosts || input.restricts.hosts.length === 0) {
      problems.push("rationed mode rations hosts: restricts.hosts is required");
    }
    if (input.restricts.areas?.length || input.restricts.paths?.length || input.restricts.tools?.length) {
      problems.push("rationed mode is browser-only: drop restricts.areas, paths and tools");
    }
    for (const ex of input.restricts.excludeHosts ?? []) {
      const hosts = input.restricts.hosts ?? [];
      if (!hosts.some((h) => ex.endsWith(`.${h}`))) {
        problems.push(`excludeHosts "${ex}" is not a subdomain of any restricted host`);
      }
    }
  } else if (input.budgetMinutes !== undefined) {
    problems.push("budgetMinutes applies to rationed mode only");
  }
```

- Pass to `wateringHoursRules`:

```ts
    ...(input.mode === "rationed" && input.budgetMinutes !== undefined
      ? { budget: { minutes: input.budgetMinutes, exclude: [...(input.restricts.excludeHosts ?? [])] } }
      : {}),
```

In `mcp-server/index.ts`, `set_watering_hours`:
- `mode: z.enum(["regular", "dry", "by_hand", "rationed"])`, describe: add `rationed = open until budgetMinutes of attended time today, then walled`.
- Tool description: "Four modes", add one clause for `rationed`.
- Add `budgetMinutes: z.number().int().min(1).max(1440).optional().describe("rationed mode: attended minutes allowed per local day across the policy's hosts")`.
- Add to `restricts`: `excludeHosts: z.array(z.string().min(1)).optional().describe("rationed mode: subdomains of restricted hosts that neither count nor are walled (e.g. music.youtube.com)")`.
- `reach` describe: `"dry or rationed mode, browser rules only. ..."`.

- [ ] **Step 4: Run** the test file, then `pnpm test`. Expected: all PASS. Then `cd mcp-server && pnpm build`. Expected: no type errors.

- [ ] **Step 5: Commit** `feat(mcp): set_watering_hours declares a rationed policy`

---

### Task 3: Extension — parse the budget, count the pool, apply the ration

**Files:**
- Modify: `extension/modules/fence/types.ts` (`Fence`)
- Modify: `extension/modules/fence/parse.ts` (`readSchedule`, `parseFences` entry build, `fencesFor`, `standingBlockHosts`)
- Create: `extension/modules/fence/ration.ts`
- Test: `extension/modules/fence/ration.test.ts`, `extension/modules/fence/parse.test.ts`

**Interfaces:**
- Produces:
  - `Fence.budget?: { readonly minutes: number; readonly pool: string; readonly exclude: readonly string[] }`
  - `interface RationSpent { readonly day: string; readonly minutes: Readonly<Record<string, number>> }`
  - `localDay(ts: number): string` (`YYYY-MM-DD`, local)
  - `poolMinutes(events: readonly ActivityEvent[], fences: Fences, now: number): Record<string, number>`
  - `withRations(fences: Fences, spent: RationSpent | null, now: number): Fences`
  - `rationBlocks(fences: Fences): { pool: string; domains: string[]; except: string[]; reach?: "navigation" }[]`
  - `hasOpenRation(fences: Fences, now: Date): boolean`

- [ ] **Step 1: Write the failing tests**

`ration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createActivityEvent, type ActivityEvent } from "../domain/activity";
import { parseFences } from "./parse";
import { hasOpenRation, localDay, poolMinutes, rationBlocks, withRations } from "./ration";

const MIN = 60_000;
// Saturday 2026-10-24, local.
const SAT = new Date(2026, 9, 24, 14, 0).getTime();
let seq = 0;
const ev = (ts: number, kind: string, domain?: string): ActivityEvent =>
  createActivityEvent({ id: `e${++seq}`, surface: "browser", kind, ts, payload: domain ? { domain } : {} });

function rationed(host: string) {
  return {
    id: `watering:youtube-weekend:browser:${host}`,
    name: `youtube-weekend (${host})`,
    scope: { surface: "browser", domain: host },
    primitives: [
      {
        kind: "schedule",
        window: { fromHour: 0, toHour: 0, weekdays: ["SAT", "SUN"] },
        outsideWindow: "inactive",
        budget: { minutes: 60, pool: "youtube-weekend", exclude: ["music.youtube.com"] },
        wraps: {
          kind: "cooldown",
          duration: { type: "standing" },
          unlockPath: { type: "out_of_band", note: "Tomorrow." },
          enforcement: { at: "browser", reach: "navigation" },
        },
      },
    ],
  };
}

const fences = parseFences(
  { a: rationed("youtube.com"), b: rationed("youtu.be") },
  SAT,
)!.fences;

describe("poolMinutes", () => {
  it("sums attended minutes across the pool's hosts", () => {
    const events = [
      ev(SAT, "navigation_committed", "www.youtube.com"),
      ev(SAT + 20 * MIN, "navigation_committed", "youtu.be"),
      ev(SAT + 30 * MIN, "tab_closed", "youtu.be"),
    ];
    expect(Math.round(poolMinutes(events, fences, SAT + 31 * MIN)["youtube-weekend"])).toBe(30);
  });

  it("drops excluded subdomains", () => {
    const events = [
      ev(SAT, "navigation_committed", "music.youtube.com"),
      ev(SAT + 20 * MIN, "tab_closed", "music.youtube.com"),
    ];
    expect(poolMinutes(events, fences, SAT + 21 * MIN)["youtube-weekend"] ?? 0).toBe(0);
  });

  it("counts only bouts that start today", () => {
    const yesterday = SAT - 24 * 60 * MIN;
    const events = [
      ev(yesterday, "navigation_committed", "youtube.com"),
      ev(yesterday + 20 * MIN, "tab_closed", "youtube.com"),
    ];
    expect(poolMinutes(events, fences, SAT)["youtube-weekend"] ?? 0).toBe(0);
  });
});

describe("withRations", () => {
  const day = localDay(SAT);
  it("drops a budgeted fence whose pool is under budget", () => {
    expect(Object.keys(withRations(fences, { day, minutes: { "youtube-weekend": 59 } }, SAT))).toEqual([]);
  });
  it("keeps it once the pool reaches the budget", () => {
    expect(Object.keys(withRations(fences, { day, minutes: { "youtube-weekend": 60 } }, SAT))).toHaveLength(2);
  });
  it("reads a stale day as zero", () => {
    expect(Object.keys(withRations(fences, { day: "2026-10-23", minutes: { "youtube-weekend": 99 } }, SAT))).toEqual([]);
  });
  it("fails open on no count", () => {
    expect(Object.keys(withRations(fences, null, SAT))).toEqual([]);
  });
});

describe("rationBlocks", () => {
  it("gathers one block per pool with its exclusions and reach", () => {
    expect(rationBlocks(fences)).toEqual([
      { pool: "youtube-weekend", domains: ["youtube.com", "youtu.be"], except: ["music.youtube.com"], reach: "navigation" },
    ]);
  });
});

describe("hasOpenRation", () => {
  it("is true inside the window, false outside", () => {
    expect(hasOpenRation(fences, new Date(SAT))).toBe(true);
    expect(hasOpenRation(fences, new Date(2026, 9, 26, 14))).toBe(false); // Monday
  });
});
```

Append to `parse.test.ts` (reuse the `rationed` shape above, copied into the file):

```ts
describe("budgeted fences", () => {
  const { fences } = parseFences({ a: rationed("youtube.com") }, new Date(2026, 9, 24, 14).getTime())!;
  it("reads the budget off the schedule primitive", () => {
    expect(fences.a.budget).toEqual({ minutes: 60, pool: "youtube-weekend", exclude: ["music.youtube.com"] });
  });
  it("fencesFor skips an excluded subdomain", () => {
    vi.setSystemTime(new Date(2026, 9, 24, 14));
    expect(fencesFor(fences, "www.youtube.com")).toHaveLength(1);
    expect(fencesFor(fences, "music.youtube.com")).toHaveLength(0);
    vi.useRealTimers();
  });
  it("standingBlockHosts leaves budgeted fences to their own rule", () => {
    vi.setSystemTime(new Date(2026, 9, 24, 14));
    expect(standingBlockHosts(fences)).toEqual([]);
    vi.useRealTimers();
  });
});
```

(Add `vi.useFakeTimers()` before `setSystemTime` if the file does not already enable fake timers; follow the file's existing convention.)

- [ ] **Step 2: Run** `cd extension && pnpm vitest run modules/fence/ration.test.ts modules/fence/parse.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`types.ts`, add to `Fence`:

```ts
  /** Rationed watering: holds only once the pool's minutes today reach `minutes`. */
  readonly budget?: { readonly minutes: number; readonly pool: string; readonly exclude: readonly string[] };
```

`parse.ts`:
- `readSchedule` also returns `budget` when `p.budget` is a record with a finite positive `minutes`, a non-empty string `pool`, and `exclude` as a string array (default `[]`). Return type gains `budget?: Fence["budget"]`.
- In `parseFences`, keep it next to `schedule` (`let budget: Fence["budget"]`, set from `sched.budget`) and spread `...(budget ? { budget } : {})` into the entry.
- `fencesFor`: skip an entry when `entry.budget?.exclude.some((x) => covers(x, needle))`.
- `standingBlockHosts`: add `if (entry.budget) continue;` before the domain loop, with a comment: budgeted fences project through `rationBlocks`, which carries their exclusions.

`ration.ts`:

```ts
/**
 * Rationed watering, the pure half: count a pool's attended minutes today and
 * decide whether its budget is spent.
 *
 * The count is `bouts()`, the one dwell methodology, so it agrees with
 * `get_site_minutes`. A bout's minutes land on the local day it started.
 * An unspent pool drops its fences out of the live set, the way a lift does;
 * a missing or stale count reads as zero, so a budget that cannot count never walls.
 */

import type { ActivityEvent } from "../domain/activity";
import { bouts } from "../domain/bouts";
import { isScheduleActive } from "./parse";
import type { Fence, Fences } from "./types";

export interface RationSpent {
  readonly day: string;
  readonly minutes: Readonly<Record<string, number>>;
}

export function localDay(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const covers = (domain: string, host: string) => host === domain || host.endsWith(`.${domain}`);

function budgeted(fences: Fences): Fence[] {
  return Object.values(fences).filter((f) => f.budget !== undefined);
}

export function poolMinutes(events: readonly ActivityEvent[], fences: Fences, now: number): Record<string, number> {
  const today = localDay(now);
  const pools = budgeted(fences);
  const out: Record<string, number> = {};
  for (const bout of bouts(events)) {
    if (localDay(bout.startTs) !== today) continue;
    for (const [domain, ms] of bout.byDomain) {
      const fence = pools.find(
        (f) => f.domains.some((d) => covers(d, domain)) && !f.budget!.exclude.some((x) => covers(x, domain)),
      );
      if (fence) out[fence.budget!.pool] = (out[fence.budget!.pool] ?? 0) + ms / 60_000;
    }
  }
  return out;
}

export function withRations(fences: Fences, spent: RationSpent | null, now: number): Fences {
  const minutes = spent && spent.day === localDay(now) ? spent.minutes : {};
  return Object.fromEntries(
    Object.entries(fences).filter(([, f]) => !f.budget || (minutes[f.budget.pool] ?? 0) >= f.budget.minutes),
  );
}

export function rationBlocks(fences: Fences): { pool: string; domains: string[]; except: string[]; reach?: "navigation" }[] {
  const byPool = new Map<string, { pool: string; domains: string[]; except: string[]; reach?: "navigation" }>();
  for (const f of budgeted(fences)) {
    if (f.enforcement.kind !== "block" || f.enforcement.enforcement !== "browser") continue;
    if (f.schedule && !isScheduleActive(f.schedule)) continue;
    const b = f.budget!;
    const entry = byPool.get(b.pool) ?? { pool: b.pool, domains: [], except: [], ...(f.enforcement.reach ? { reach: f.enforcement.reach } : {}) };
    entry.domains.push(...f.domains.filter((d) => !entry.domains.includes(d)));
    entry.except.push(...b.exclude.filter((x) => !entry.except.includes(x)));
    byPool.set(b.pool, entry);
  }
  return [...byPool.values()];
}

export function hasOpenRation(fences: Fences, now: Date): boolean {
  return budgeted(fences).some((f) => !f.schedule || isScheduleActive(f.schedule, now));
}
```

`rationBlocks` uses the live clock through `isScheduleActive` like the rest of `parse.ts`; tests that need a time use `vi.setSystemTime`. If `rationBlocks` in `ration.test.ts` runs outside the window on the CI clock, wrap it in `vi.useFakeTimers(); vi.setSystemTime(SAT)`.

- [ ] **Step 4: Run** the two test files, then `cd extension && pnpm test && pnpm typecheck`. Expected: all PASS.

- [ ] **Step 5: Commit** `feat(extension): parse and count rationed watering budgets`

---

### Task 4: Extension — store the count, project the wall, show it

**Files:**
- Modify: `extension/modules/fence/store.ts` (`rationSpent`, `liveFences`)
- Modify: `extension/modules/fence/project.ts` (`buildDnrRules`, `syncFenceRules`)
- Modify: `extension/entrypoints/background.ts` (ration alarm)
- Modify: `extension/entrypoints/popup/Popup.tsx`
- Test: `extension/modules/fence/project.test.ts`

**Interfaces:**
- Consumes: Task 3 `RationSpent`, `withRations`, `poolMinutes`, `rationBlocks`, `hasOpenRation`, `localDay`.
- Produces: `rationSpent` storage item `local:fence:rationSpent`; `buildDnrRules(blockDomains, navigationDomains, rations?)`.

- [ ] **Step 1: Write the failing test** (append to `project.test.ts`)

```ts
describe("buildDnrRules — rationed pools", () => {
  it("gives each spent pool its own rule, sparing excluded hosts", () => {
    const rules = buildDnrRules([], [], [
      { pool: "youtube-weekend", domains: ["youtube.com", "youtu.be"], except: ["music.youtube.com"], reach: "navigation" },
    ]);
    expect(rules).toEqual([
      {
        id: 100,
        priority: 1,
        action: { type: "block" },
        condition: {
          requestDomains: ["youtube.com", "youtu.be"],
          excludedRequestDomains: ["music.youtube.com"],
          resourceTypes: ["main_frame", "sub_frame"],
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run** `cd extension && pnpm vitest run modules/fence/project.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

`project.ts`:
- `DnrRule.condition` gains `excludedRequestDomains?: string[]`.
- `const RATION_RULE_BASE = 100; const RATION_RULE_MAX = 20;` with a `ponytail:` comment: `// ponytail: one DNR rule per pool, 20 pools max; read getDynamicRules if that ever binds`.
- `buildDnrRules(blockDomains, navigationDomains = [], rations: ReturnType<typeof rationBlocks> = [])` appends, for each ration `i`:

```ts
    {
      id: RATION_RULE_BASE + i,
      priority: 1,
      action: { type: "block" },
      condition: {
        requestDomains: [...r.domains],
        ...(r.except.length > 0 ? { excludedRequestDomains: [...r.except] } : {}),
        resourceTypes: r.reach === "navigation" ? NAVIGATION_RESOURCE_TYPES : ALL_RESOURCE_TYPES,
      },
    }
```

- `syncFenceRules`: `const rations = rationBlocks(fences);` (fences come from `liveFences()`, which now only holds spent pools), pass to `buildDnrRules`, and extend `removeRuleIds` with `Array.from({ length: RATION_RULE_MAX }, (_, i) => RATION_RULE_BASE + i)`.

`store.ts`:

```ts
/** Today's attended minutes per rationed pool. Written only by the background's ration alarm. */
export const rationSpent = storage.defineItem<RationSpent | null>("local:fence:rationSpent", { fallback: null });
```

and `liveFences`:

```ts
export async function liveFences(now: number = Date.now()): Promise<Fences> {
  const [fences, lifts, spent] = await Promise.all([fenceCache.getValue(), allLifts(), rationSpent.getValue()]);
  return withLifts(withRations(fences, spent, now), lifts, now);
}
```

`background.ts`:

```ts
const RATION_ALARM = "zenborg-ration";

/**
 * Recount rationed pools once a minute while any rationed window is open.
 * Today's events are the host's copy merged with the outbox, since the relay
 * deletes what the host has acked (the same merge `fence/pass.ts` does).
 */
async function recountRations(): Promise<void> {
  const fences = await fenceCache.getValue();
  const now = Date.now();
  if (!hasOpenRation(fences, new Date(now))) {
    await browser.alarms.clear(RATION_ALARM);
    return;
  }
  if (!(await browser.alarms.get(RATION_ALARM))) {
    browser.alarms.create(RATION_ALARM, { periodInMinutes: 1 });
  }
  try {
    const since = startOfLocalDay(now);
    // ponytail: re-reads the whole day from the host every minute; cache the host slice if it shows up in profiles
    const [host, outbox] = await Promise.all([queryEvents(since), readEventsSince(since)]);
    const minutes = poolMinutes(mergeById(host, outbox), fences, now);
    const prev = await rationSpent.getValue();
    const next = { day: localDay(now), minutes };
    if (JSON.stringify(prev) !== JSON.stringify(next)) await rationSpent.setValue(next);
  } catch (err) {
    // Fail open: the last count stands (or none), so nothing new walls on a failed read.
    console.error("[zenborg ration] recount failed:", err);
  }
}
```

- Imports: `hasOpenRation, localDay, poolMinutes` from `@/modules/fence/ration`; `rationSpent` from store; `queryEvents` from `@/modules/relay/client`; `readEventsSince` from `@/modules/activity/log`; `mergeById` from `@/modules/fence/deliveries`; `startOfLocalDay` from `@/modules/activity/events`.
- In `resync`, add `void recountRations();`.
- Add `rationSpent.watch(() => { void syncFenceRules(); });`.
- In `onAlarm`, add `if (alarm.name === RATION_ALARM) void recountRations();`.

`Popup.tsx`: read `rationSpent` alongside `fenceCache` and, for each fence in `hereFences` with a `budget`, render under its row, plain text:

```tsx
<span className="popup-fence-exit">
  {Math.floor(spentFor(f.budget.pool))} / {f.budget.minutes} min today
</span>
```

where `spentFor(pool)` returns `spent && spent.day === localDay(Date.now()) ? spent.minutes[pool] ?? 0 : 0`. Use the existing `popup-fence-exit` class; add no new colours.

- [ ] **Step 4: Run** `cd extension && pnpm test && pnpm typecheck && pnpm build`. Expected: PASS, build succeeds. Then root `pnpm test`.

- [ ] **Step 5: Commit** `feat(extension): rationed pools wall at their budget and show their minutes`

---

### Task 5: Rollout (orchestrator, after merge, not the builder)

- [ ] Rebuild the MCP server (`cd mcp-server && pnpm build:compile`) and reload the extension (user).
- [ ] Reconnect zenborg via `/mcp`.
- [ ] Declare:

```jsonc
set_watering_hours {
  "name": "youtube-weekend", "mode": "rationed", "budgetMinutes": 60, "reach": "navigation",
  "window": { "fromHour": 0, "toHour": 0, "weekdays": ["SAT", "SUN"] },
  "waters": ["Entertainment"],
  "restricts": { "hosts": ["youtube.com", "m.youtube.com", "youtu.be"], "excludeHosts": ["music.youtube.com"] },
  "unlockNote": "Tomorrow. An hour of YouTube a day on weekends; the video you're on finishes."
}
```

- [ ] Check with `get_site_minutes` (hosts youtube.com, youtu.be, today) that the popup readout matches, within rounding.
