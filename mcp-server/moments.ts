import * as crypto from "node:crypto";
import {
  countMomentsInPhase,
  normalizeRefs,
  normalizeTags,
  phaseForStartTime,
  requireActiveArea,
  requireActiveHabit,
  slugify,
  timingFromSchedule,
  validateMomentTiming,
  validateOneToThreeWords,
  validatePlaceUrl,
  validateRefs,
} from "./validation.js";
import type {
  Area,
  Cycle,
  CyclePlan,
  Habit,
  Moment,
  Phase,
  PhaseConfig,
} from "./vault.js";

const DAY_VIEW_PHASE_CAPACITY = 3;

export type AddMomentInput = {
  habitId?: string;
  name?: string;
  areaId?: string;
  day?: string;
  phase?: Phase;
  startTime?: string;
  durationMin?: number;
  order?: number;
  fromPlan?: boolean;
  emoji?: string | null;
  tags?: string[];
  personIds?: string[];
  placeIds?: string[];
  placeUrl?: string;
  customMetric?: Moment["customMetric"];
  refs?: string[];
  status?: "tentative" | "accepted";
};

export type AddMomentContext = {
  areas: Record<string, Area>;
  habits: Record<string, Habit>;
  cycles: Record<string, Cycle>;
  cyclePlans: Record<string, CyclePlan>;
  moments: Record<string, Moment>;
  phaseConfigs: Record<string, PhaseConfig>;
  now: Date;
};

export type AddMomentSuccess = {
  ok: true;
  moment: Moment;
  dayViewOverflow?: number;
};
export type AddMomentFailure = { ok: false; error: string };
export type AddMomentResult = AddMomentSuccess | AddMomentFailure;

function fail(error: string): AddMomentFailure {
  return { ok: false, error };
}

function parseLocalDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

function coveringCycle(
  day: string,
  cycles: Record<string, Cycle>,
): Cycle | null {
  const dayMs = parseLocalDate(day);
  let best: Cycle | null = null;
  for (const c of Object.values(cycles)) {
    const startMs = parseLocalDate(c.startDate);
    if (Number.isNaN(startMs) || dayMs < startMs) continue;
    if (c.endDate !== null) {
      const endMs = parseLocalDate(c.endDate);
      if (Number.isNaN(endMs) || dayMs > endMs) continue;
    }
    if (!best || c.startDate > best.startDate) best = c;
  }
  return best;
}

export function resolveAddMoment(
  input: AddMomentInput,
  ctx: AddMomentContext,
): AddMomentResult {
  // 1. Identity gate
  const hasHabit = input.habitId !== undefined;
  const hasStandalone = input.name !== undefined && input.areaId !== undefined;
  if (!hasHabit && !hasStandalone) {
    return fail(
      "pass habitId (create from a habit) or both name and areaId (standalone). " +
        'Example: { "name": "call sasa", "areaId": "<area uuid>", "day": "2026-08-29", "phase": "EVENING" }',
    );
  }

  // 2. Habit inheritance
  let habit: Habit | null = null;
  let effectiveName: string;
  let effectiveAreaId: string;
  let effectiveEmoji: string | null | undefined = input.emoji;
  let effectiveTags: string[] | undefined = input.tags;
  let effectiveStartTime: string | undefined = input.startTime;
  let effectiveDurationMin: number | undefined = input.durationMin;

  if (hasHabit) {
    const habitCheck = requireActiveHabit(ctx.habits, input.habitId!);
    if (typeof habitCheck === "string") return fail(habitCheck);
    habit = habitCheck;

    effectiveName = input.name ?? habit.name;
    effectiveAreaId = input.areaId ?? habit.areaId;
    if (effectiveEmoji === undefined) effectiveEmoji = habit.emoji;
    if (effectiveTags === undefined) effectiveTags = habit.tags ?? undefined;

    if (habit.schedule) {
      const timing = timingFromSchedule(habit.schedule);
      if (effectiveStartTime === undefined)
        effectiveStartTime = timing.startTime;
      if (effectiveDurationMin === undefined)
        effectiveDurationMin = timing.durationMin;
    }
  } else {
    effectiveName = input.name!;
    effectiveAreaId = input.areaId!;
  }

  // 3. Name/area validation
  const nameError = validateOneToThreeWords(effectiveName, "Moment");
  if (nameError) return fail(nameError);

  const areaCheck = requireActiveArea(ctx.areas, effectiveAreaId);
  if (typeof areaCheck === "string") return fail(areaCheck);

  // 8. Payload validation (early — before phase derivation uses startTime)
  const timingError = validateMomentTiming(
    effectiveStartTime,
    effectiveDurationMin,
  );
  if (timingError) return fail(timingError);

  const refsError = validateRefs(input.refs);
  if (refsError) return fail(refsError);

  const placeUrlError = validatePlaceUrl(input.placeUrl);
  if (placeUrlError) return fail(placeUrlError);

  // 4. Phase derivation
  let effectivePhase: Phase | null = input.phase ?? null;
  if (effectiveStartTime) {
    const configs = Object.values(ctx.phaseConfigs);
    const derived = phaseForStartTime(effectiveStartTime, configs);
    if (derived) effectivePhase = derived;
  }
  if (input.day && !effectivePhase) {
    return fail(
      "phase is required when no startTime is provided (given or inherited from the habit's schedule)",
    );
  }

  // 5. Cycle inheritance
  let cycleId: string | null = null;
  if (input.day) {
    const cycle = coveringCycle(input.day, ctx.cycles);
    if (cycle) cycleId = cycle.id;
  }

  // 6. Plan linkage
  let cyclePlanId: string | null = null;
  if (input.fromPlan) {
    if (!input.habitId) return fail("fromPlan requires habitId");
    if (!input.day) return fail("fromPlan requires day");

    if (!cycleId) {
      return fail(
        `no cycle covers ${input.day} — fromPlan needs a running or scheduled season`,
      );
    }

    const cycle = ctx.cycles[cycleId]!;
    if (input.day < cycle.startDate) {
      return fail(`day ${input.day} before cycle start ${cycle.startDate}`);
    }
    if (cycle.endDate && input.day > cycle.endDate) {
      return fail(`day ${input.day} after cycle end ${cycle.endDate}`);
    }

    let plan: CyclePlan | null = null;
    for (const p of Object.values(ctx.cyclePlans)) {
      if (p.cycleId === cycleId && p.habitId === input.habitId) {
        plan = p;
        break;
      }
    }
    if (!plan) {
      return fail(`no budget: habit not planned for cycle "${cycle.name}"`);
    }

    let allocatedForPlan = 0;
    for (const m of Object.values(ctx.moments)) {
      if (m.cyclePlanId === plan.id && m.day !== null) allocatedForPlan++;
    }
    if (allocatedForPlan >= plan.budgetedCount) {
      return fail(
        `over budget: ${allocatedForPlan}/${plan.budgetedCount} already allocated for "${habit!.name}" this cycle. ` +
          "Add it anyway without fromPlan to plant it as spontaneous.",
      );
    }

    cyclePlanId = plan.id;
  }

  // 7. Allocation
  const nowIso = ctx.now.toISOString();
  const refs = normalizeRefs(input.refs);
  const tags = normalizeTags(effectiveTags);
  const placeIds =
    input.placeIds?.map(slugify).filter((k) => k.length > 0) ?? [];

  let order = input.order ?? 0;
  let dayViewOverflow: number | undefined;

  if (input.day && effectivePhase) {
    const slotCount = countMomentsInPhase(
      Object.values(ctx.moments),
      input.day,
      effectivePhase,
    );
    if (input.order === undefined) order = slotCount;
    const totalAfter = slotCount + 1;
    if (totalAfter > DAY_VIEW_PHASE_CAPACITY) dayViewOverflow = totalAfter;
  }

  const moment: Moment = {
    id: crypto.randomUUID(),
    name: effectiveName.trim(),
    areaId: effectiveAreaId,
    habitId: habit?.id ?? null,
    cycleId: input.day ? cycleId : null,
    cyclePlanId: input.day ? cyclePlanId : null,
    phase: effectivePhase,
    day: input.day ?? null,
    order,
    ...(effectiveStartTime !== undefined
      ? { startTime: effectiveStartTime }
      : {}),
    ...(effectiveDurationMin !== undefined
      ? { durationMin: effectiveDurationMin }
      : {}),
    emoji: effectiveEmoji ?? null,
    tags: tags.length > 0 ? tags : [],
    ...(input.personIds && input.personIds.length > 0
      ? { personIds: input.personIds }
      : {}),
    ...(placeIds.length > 0 ? { placeIds } : {}),
    ...(input.placeUrl !== undefined ? { placeUrl: input.placeUrl } : {}),
    ...(input.customMetric ? { customMetric: input.customMetric } : {}),
    ...(refs.length > 0 ? { refs } : {}),
    ...(input.status !== undefined ? { status: input.status } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    ok: true,
    moment,
    ...(dayViewOverflow ? { dayViewOverflow } : {}),
  };
}
