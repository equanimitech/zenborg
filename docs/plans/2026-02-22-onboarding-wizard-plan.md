# Onboarding Wizard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an interactive 4-step onboarding wizard (Welcome, Areas, Moment, Allocate) that guides first-time users through creating real data, then closes and lets smart empty states continue teaching.

**Architecture:** A Dialog-based stepped wizard using the same observable/helper pattern as MomentFormDialog. State lives in `ui-store.ts` as `onboardingState$`. A localStorage flag `onboardingCompleted` prevents repeat display. The wizard is mounted globally in `LayoutClient.tsx` and auto-opens on first run when no areas exist.

**Tech Stack:** React 19, Next.js 15, @legendapp/state 3.x, Radix Dialog (existing), Tailwind CSS 4 (stone palette), Lucide icons.

---

### Task 1: Onboarding State in UI Store

**Files:**
- Modify: `src/infrastructure/state/ui-store.ts`

**Step 1: Add onboarding state interface and observable**

At the bottom of `ui-store.ts`, before the "Future UI State" comment block (~line 414), add:

```typescript
// ============================================================================
// Onboarding Wizard State
// ============================================================================

/**
 * Onboarding wizard state
 * Controls the multi-step onboarding flow for first-time users
 * Ephemeral - wizard state not persisted (completion flag is in localStorage)
 */
export interface OnboardingState {
  open: boolean;
  step: number; // 0=welcome, 1=areas, 2=moment, 3=allocate
  selectedAreaTemplateIndices: number[]; // indices into DEFAULT_AREAS
  createdAreaIds: string[]; // area IDs created in step 1
  createdMomentId: string | null; // moment ID created in step 2
  selectedPhase: Phase | null; // phase selected in step 3
}

export const onboardingState$ = observable<OnboardingState>({
  open: false,
  step: 0,
  selectedAreaTemplateIndices: [],
  createdAreaIds: [],
  createdMomentId: null,
  selectedPhase: null,
});

/**
 * Open the onboarding wizard (resets to step 0)
 */
export function openOnboarding() {
  onboardingState$.set({
    open: true,
    step: 0,
    selectedAreaTemplateIndices: [],
    createdAreaIds: [],
    createdMomentId: null,
    selectedPhase: null,
  });
}

/**
 * Close the onboarding wizard and reset state
 */
export function closeOnboarding() {
  onboardingState$.set({
    open: false,
    step: 0,
    selectedAreaTemplateIndices: [],
    createdAreaIds: [],
    createdMomentId: null,
    selectedPhase: null,
  });
}

/**
 * Advance to the next onboarding step
 */
export function nextOnboardingStep() {
  const current = onboardingState$.step.peek();
  if (current < 3) {
    onboardingState$.step.set(current + 1);
  }
}

/**
 * Go back to the previous onboarding step
 */
export function prevOnboardingStep() {
  const current = onboardingState$.step.peek();
  if (current > 0) {
    onboardingState$.step.set(current - 1);
  }
}
```

**Step 2: Verify the file compiles**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to ui-store.ts

**Step 3: Commit**

```bash
git add src/infrastructure/state/ui-store.ts
git commit -m "feat(onboarding): add wizard state to ui-store

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Onboarding Trigger in Store Initializer

**Files:**
- Modify: `src/app/StoreInitializer.tsx`
- Modify: `src/infrastructure/state/initialize.ts`

**Step 1: Add `shouldShowOnboarding` check to initialize.ts**

After the existing `initializeStore` function, add a new exported function:

```typescript
/**
 * Checks if onboarding should be shown
 * Returns true if: no areas exist AND onboarding hasn't been completed
 */
export function shouldShowOnboarding(): boolean {
  const hasAreas = Object.keys(areas$.get()).length > 0;
  const completed = typeof window !== "undefined"
    ? localStorage.getItem("zenborg:onboardingCompleted") === "true"
    : false;
  return !hasAreas && !completed;
}

/**
 * Marks onboarding as completed in localStorage
 */
export function markOnboardingCompleted(): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("zenborg:onboardingCompleted", "true");
  }
}

/**
 * Resets onboarding completed flag (for "Replay" feature)
 */
export function resetOnboardingCompleted(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("zenborg:onboardingCompleted");
  }
}
```

**Step 2: Trigger onboarding in StoreInitializer**

Replace `StoreInitializer.tsx` content with:

```typescript
"use client";

import { useEffect, useState } from "react";
import { initializeStore, shouldShowOnboarding } from "@/infrastructure/state/initialize";
import { openOnboarding } from "@/infrastructure/state/ui-store";

/**
 * Client-side component that initializes the Legend State store
 * on first mount. This ensures IndexedDB persistence is set up
 * and default data is seeded if needed.
 *
 * Also triggers onboarding wizard for first-time users.
 */
export function StoreInitializer() {
  const [_isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    initializeStore()
      .then(() => {
        setIsInitialized(true);

        // Check if this is a first-time user who needs onboarding
        if (shouldShowOnboarding()) {
          openOnboarding();
        }
      })
      .catch((error) => {
        console.error("[Zenborg] Failed to initialize store:", error);
      });
  }, []);

  // Don't render anything - this is purely for side effects
  return null;
}
```

**Step 3: Verify compilation**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add src/infrastructure/state/initialize.ts src/app/StoreInitializer.tsx
git commit -m "feat(onboarding): add trigger logic for first-time users

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 3: WelcomeStep Component (Step 0)

**Files:**
- Create: `src/components/onboarding/WelcomeStep.tsx`

**Step 1: Create the WelcomeStep component**

```typescript
"use client";

import { Compass } from "lucide-react";

interface WelcomeStepProps {
  onNext: () => void;
}

/**
 * Onboarding Step 0: Welcome
 * Brief action-oriented intro. No philosophy dump.
 */
export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-stone-200 dark:bg-stone-800 flex items-center justify-center mb-6">
        <Compass className="w-8 h-8 text-stone-600 dark:text-stone-400" />
      </div>

      <h2 className="text-2xl font-bold text-stone-900 dark:text-stone-100 mb-3">
        Welcome to Zenborg
      </h2>

      <p className="text-sm text-stone-600 dark:text-stone-400 max-w-sm mb-8">
        Budget your attention across life areas, one moment at a time.
      </p>

      <button
        type="button"
        onClick={onNext}
        className="px-6 py-2.5 rounded-lg font-mono text-sm bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:hover:bg-stone-200 dark:text-stone-900 transition-colors"
      >
        Get Started
      </button>
    </div>
  );
}
```

**Step 2: Verify compilation**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/onboarding/WelcomeStep.tsx
git commit -m "feat(onboarding): add WelcomeStep component

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 4: AreaSelectionStep Component (Step 1)

**Files:**
- Create: `src/components/onboarding/AreaSelectionStep.tsx`

**Context:** Uses `DEFAULT_AREAS` from `src/domain/entities/Area.ts`. These are the 6 templates: Wellness, Craft, Social, Joyful, Introspective, Chore. Each has `name`, `color`, `emoji`.

**Step 1: Create the AreaSelectionStep component**

```typescript
"use client";

import { Check } from "lucide-react";
import { DEFAULT_AREAS } from "@/domain/entities/Area";
import { cn } from "@/lib/utils";

interface AreaSelectionStepProps {
  selectedIndices: number[];
  onToggleArea: (index: number) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Onboarding Step 1: Select areas from templates
 * User picks 1-6 life domains. Multi-select with visual feedback.
 */
export function AreaSelectionStep({
  selectedIndices,
  onToggleArea,
  onNext,
  onBack,
}: AreaSelectionStepProps) {
  const canProceed = selectedIndices.length > 0;

  return (
    <div className="flex flex-col py-4 px-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 mb-1">
          Choose your life areas
        </h2>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Areas are domains of your life. Pick the ones that matter to you.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        {DEFAULT_AREAS.map((area, index) => {
          const isSelected = selectedIndices.includes(index);
          return (
            <button
              key={area.name}
              type="button"
              onClick={() => onToggleArea(index)}
              className={cn(
                "relative flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all text-left",
                isSelected
                  ? "border-stone-900 dark:border-stone-100 bg-stone-100 dark:bg-stone-800"
                  : "border-stone-200 dark:border-stone-700 hover:border-stone-400 dark:hover:border-stone-500"
              )}
            >
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <Check className="w-4 h-4 text-stone-900 dark:text-stone-100" />
                </div>
              )}
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                style={{ backgroundColor: `${area.color}20` }}
              >
                {area.emoji}
              </span>
              <div>
                <div className="text-sm font-medium text-stone-900 dark:text-stone-100">
                  {area.name}
                </div>
                <div
                  className="w-4 h-1 rounded-full mt-1"
                  style={{ backgroundColor: area.color }}
                />
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-lg font-mono text-sm text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canProceed}
          className={cn(
            "px-6 py-2.5 rounded-lg font-mono text-sm transition-colors",
            canProceed
              ? "bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:hover:bg-stone-200 dark:text-stone-900"
              : "bg-stone-200 text-stone-400 dark:bg-stone-800 dark:text-stone-600 cursor-not-allowed"
          )}
        >
          Create {selectedIndices.length > 0 ? `${selectedIndices.length} Area${selectedIndices.length > 1 ? "s" : ""}` : "Areas"}
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify compilation**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/onboarding/AreaSelectionStep.tsx
git commit -m "feat(onboarding): add AreaSelectionStep with template cards

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 5: MomentCreationStep Component (Step 2)

**Files:**
- Create: `src/components/onboarding/MomentCreationStep.tsx`

**Context:** Uses `validateMomentName` from `src/domain/entities/Moment.ts`. Name input + area selector (pre-filled with first created area). Area selector shows only the areas just created in step 1.

**Step 1: Create the MomentCreationStep component**

```typescript
"use client";

import { useRef, useState } from "react";
import { validateMomentName } from "@/domain/entities/Moment";
import { areas$ } from "@/infrastructure/state/store";
import { cn } from "@/lib/utils";

interface MomentCreationStepProps {
  createdAreaIds: string[];
  onCreateMoment: (name: string, areaId: string) => void;
  onBack: () => void;
}

const EXAMPLE_PLACEHOLDERS = [
  "Morning Run",
  "Deep Work",
  "Read Fiction",
  "Family Dinner",
  "Yoga",
  "Journal",
];

/**
 * Onboarding Step 2: Create first moment
 * Simplified form: name input + area selection from recently created areas.
 */
export function MomentCreationStep({
  createdAreaIds,
  onCreateMoment,
  onBack,
}: MomentCreationStepProps) {
  const [name, setName] = useState("");
  const [selectedAreaId, setSelectedAreaId] = useState(createdAreaIds[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const placeholder =
    EXAMPLE_PLACEHOLDERS[Math.floor(Math.random() * EXAMPLE_PLACEHOLDERS.length)];

  const createdAreas = createdAreaIds
    .map((id) => areas$[id].get())
    .filter(Boolean);

  const handleSubmit = () => {
    const validation = validateMomentName(name);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid name");
      return;
    }
    if (!selectedAreaId) {
      setError("Please select an area");
      return;
    }
    setError(null);
    onCreateMoment(name.trim(), selectedAreaId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col py-4 px-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 mb-1">
          Create your first moment
        </h2>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          A moment is an intention for your day. Keep it short — 3 words max.
        </p>
      </div>

      <div className="space-y-4 mb-6">
        {/* Name input */}
        <div>
          <label
            htmlFor="onboarding-moment-name"
            className="block text-xs font-medium text-stone-500 dark:text-stone-500 mb-1.5"
          >
            Moment name
          </label>
          <input
            ref={inputRef}
            id="onboarding-moment-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 text-stone-900 dark:text-stone-100 placeholder:text-stone-400 dark:placeholder:text-stone-600 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-stone-400 dark:focus:ring-stone-600"
          />
          {error && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
        </div>

        {/* Area selector (inline buttons) */}
        {createdAreas.length > 1 && (
          <div>
            <label className="block text-xs font-medium text-stone-500 dark:text-stone-500 mb-1.5">
              Area
            </label>
            <div className="flex flex-wrap gap-2">
              {createdAreas.map((area) => (
                <button
                  key={area.id}
                  type="button"
                  onClick={() => setSelectedAreaId(area.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors",
                    selectedAreaId === area.id
                      ? "border-stone-900 dark:border-stone-100 bg-stone-100 dark:bg-stone-800"
                      : "border-stone-200 dark:border-stone-700 hover:border-stone-400 dark:hover:border-stone-500"
                  )}
                >
                  <span>{area.emoji}</span>
                  <span className="text-stone-900 dark:text-stone-100">
                    {area.name}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-lg font-mono text-sm text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim()}
          className={cn(
            "px-6 py-2.5 rounded-lg font-mono text-sm transition-colors",
            name.trim()
              ? "bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:hover:bg-stone-200 dark:text-stone-900"
              : "bg-stone-200 text-stone-400 dark:bg-stone-800 dark:text-stone-600 cursor-not-allowed"
          )}
        >
          Create Moment
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Verify compilation**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/onboarding/MomentCreationStep.tsx
git commit -m "feat(onboarding): add MomentCreationStep with name input and area selector

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 6: AllocationStep Component (Step 3)

**Files:**
- Create: `src/components/onboarding/AllocationStep.tsx`

**Context:** Shows today's phase slots. User taps a slot to allocate their moment. Uses `PhaseConfig` data from `phaseConfigs$`. The existing phase configs have `label`, `emoji`, `phase` (morning/afternoon/evening/night), and `isVisible`.

**Step 1: Create the AllocationStep component**

```typescript
"use client";

import { use$ } from "@legendapp/state/react";
import { Check } from "lucide-react";
import type { Phase } from "@/domain/value-objects/Phase";
import { areas$, moments$, phaseConfigs$ } from "@/infrastructure/state/store";
import { cn } from "@/lib/utils";

interface AllocationStepProps {
  createdMomentId: string;
  selectedPhase: Phase | null;
  onSelectPhase: (phase: Phase) => void;
  onComplete: () => void;
  onSkip: () => void;
  onBack: () => void;
}

/**
 * Onboarding Step 3: Allocate moment to timeline
 * Shows today's phase slots. User taps to allocate.
 */
export function AllocationStep({
  createdMomentId,
  selectedPhase,
  onSelectPhase,
  onComplete,
  onSkip,
  onBack,
}: AllocationStepProps) {
  const phaseConfigs = use$(phaseConfigs$);
  const moment = use$(moments$[createdMomentId]);
  const area = moment ? use$(areas$[moment.areaId]) : null;

  const visiblePhases = Object.values(phaseConfigs)
    .filter((p) => p.isVisible)
    .sort((a, b) => a.order - b.order);

  if (!moment) return null;

  return (
    <div className="flex flex-col py-4 px-6">
      <div className="mb-4">
        <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100 mb-1">
          Place it in your day
        </h2>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Tap a time slot to allocate your moment to today.
        </p>
      </div>

      {/* Moment preview card */}
      <div className="mb-4 px-4 py-3 rounded-lg border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900">
        <div className="flex items-center gap-3">
          {area && (
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: area.color }}
            />
          )}
          <span className="text-sm font-mono font-medium text-stone-900 dark:text-stone-100">
            {moment.name}
          </span>
          {area && (
            <span className="text-xs text-stone-500 dark:text-stone-500">
              {area.emoji} {area.name}
            </span>
          )}
        </div>
      </div>

      {/* Phase slots */}
      <div className="space-y-2 mb-6">
        {visiblePhases.map((phaseConfig) => {
          const isSelected = selectedPhase === phaseConfig.phase;
          return (
            <button
              key={phaseConfig.phase}
              type="button"
              onClick={() => onSelectPhase(phaseConfig.phase as Phase)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg border-2 transition-all text-left",
                isSelected
                  ? "border-stone-900 dark:border-stone-100 bg-stone-100 dark:bg-stone-800"
                  : "border-stone-200 dark:border-stone-700 hover:border-stone-400 dark:hover:border-stone-500"
              )}
            >
              <span className="text-lg">{phaseConfig.emoji}</span>
              <span className="text-sm font-medium text-stone-900 dark:text-stone-100 flex-1">
                {phaseConfig.label}
              </span>
              {isSelected && (
                <Check className="w-4 h-4 text-stone-900 dark:text-stone-100" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-lg font-mono text-sm text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
        >
          Back
        </button>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2 rounded-lg font-mono text-sm text-stone-500 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={onComplete}
            disabled={!selectedPhase}
            className={cn(
              "px-6 py-2.5 rounded-lg font-mono text-sm transition-colors",
              selectedPhase
                ? "bg-stone-900 hover:bg-stone-800 text-white dark:bg-stone-100 dark:hover:bg-stone-200 dark:text-stone-900"
                : "bg-stone-200 text-stone-400 dark:bg-stone-800 dark:text-stone-600 cursor-not-allowed"
            )}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Verify compilation**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/onboarding/AllocationStep.tsx
git commit -m "feat(onboarding): add AllocationStep with phase slot selection

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 7: OnboardingWizard Main Component

**Files:**
- Create: `src/components/OnboardingWizard.tsx`

**Context:** This is the orchestrator. It renders the Dialog, manages step routing, and handles all the domain operations (creating areas, creating moments, allocating). It reads from `onboardingState$` and calls the domain functions directly (same pattern as other components).

Key domain imports:
- `createArea` from `@/domain/entities/Area` + `DEFAULT_AREAS`
- `createMoment`, `allocateMoment` from `@/domain/entities/Moment`
- `areas$`, `moments$` from `@/infrastructure/state/store`
- `markOnboardingCompleted` from `@/infrastructure/state/initialize`

**Step 1: Create the OnboardingWizard component**

```typescript
"use client";

import { use$ } from "@legendapp/state/react";
import { createArea, DEFAULT_AREAS } from "@/domain/entities/Area";
import { allocateMoment, createMoment } from "@/domain/entities/Moment";
import { markOnboardingCompleted } from "@/infrastructure/state/initialize";
import { areas$, moments$ } from "@/infrastructure/state/store";
import {
  closeOnboarding,
  nextOnboardingStep,
  onboardingState$,
  prevOnboardingStep,
} from "@/infrastructure/state/ui-store";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { AllocationStep } from "@/components/onboarding/AllocationStep";
import { AreaSelectionStep } from "@/components/onboarding/AreaSelectionStep";
import { MomentCreationStep } from "@/components/onboarding/MomentCreationStep";
import { WelcomeStep } from "@/components/onboarding/WelcomeStep";
import type { Phase } from "@/domain/value-objects/Phase";

const TOTAL_STEPS = 4;

/**
 * OnboardingWizard - Multi-step dialog for first-time users
 *
 * Steps:
 * 0. Welcome - brief intro
 * 1. Areas - select from templates
 * 2. Moment - create first moment
 * 3. Allocate - place moment on timeline
 *
 * All data created during onboarding is real, persistent data.
 */
export function OnboardingWizard() {
  const state = use$(onboardingState$);
  const { open, step, selectedAreaTemplateIndices, createdAreaIds, createdMomentId, selectedPhase } = state;

  // --- Step handlers ---

  const handleToggleAreaTemplate = (index: number) => {
    const current = onboardingState$.selectedAreaTemplateIndices.peek();
    if (current.includes(index)) {
      onboardingState$.selectedAreaTemplateIndices.set(
        current.filter((i) => i !== index)
      );
    } else {
      onboardingState$.selectedAreaTemplateIndices.set([...current, index]);
    }
  };

  const handleCreateAreas = () => {
    const indices = onboardingState$.selectedAreaTemplateIndices.peek();
    const ids: string[] = [];

    for (const index of indices) {
      const template = DEFAULT_AREAS[index];
      if (!template) continue;

      const maxOrder = Object.values(areas$.get()).length;
      const result = createArea({
        name: template.name,
        color: template.color,
        emoji: template.emoji,
        order: maxOrder,
      });

      if (!("error" in result)) {
        areas$[result.id].set(result);
        ids.push(result.id);
      }
    }

    onboardingState$.createdAreaIds.set(ids);
    nextOnboardingStep();
  };

  const handleCreateMoment = (name: string, areaId: string) => {
    const result = createMoment({
      name,
      areaId,
    });

    if ("error" in result) {
      console.error("[Onboarding] Failed to create moment:", result.error);
      return;
    }

    moments$[result.id].set(result);
    onboardingState$.createdMomentId.set(result.id);
    nextOnboardingStep();
  };

  const handleSelectPhase = (phase: Phase) => {
    onboardingState$.selectedPhase.set(phase);
  };

  const handleComplete = () => {
    // Allocate the moment if a phase was selected
    const momentId = onboardingState$.createdMomentId.peek();
    const phase = onboardingState$.selectedPhase.peek();

    if (momentId && phase) {
      const moment = moments$[momentId].get();
      if (moment) {
        const today = new Date().toISOString().split("T")[0];
        const allocated = allocateMoment(moment, {
          day: today,
          phase,
          order: 0,
        });
        moments$[momentId].set(allocated);
      }
    }

    markOnboardingCompleted();
    closeOnboarding();
  };

  const handleSkip = () => {
    markOnboardingCompleted();
    closeOnboarding();
  };

  // Prevent closing via overlay click or Escape during onboarding
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Only allow closing via Skip or Done buttons
      return;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="p-0 gap-0 max-w-xl">
        {/* Step indicator */}
        <div className="flex items-center justify-center gap-1.5 pt-4 pb-2">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={`onboarding-step-${i}`}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === step
                  ? "bg-stone-900 dark:bg-stone-100"
                  : i < step
                    ? "bg-stone-400 dark:bg-stone-600"
                    : "bg-stone-200 dark:bg-stone-800"
              }`}
            />
          ))}
        </div>

        {/* Step content */}
        {step === 0 && (
          <WelcomeStep onNext={nextOnboardingStep} />
        )}
        {step === 1 && (
          <AreaSelectionStep
            selectedIndices={selectedAreaTemplateIndices}
            onToggleArea={handleToggleAreaTemplate}
            onNext={handleCreateAreas}
            onBack={prevOnboardingStep}
          />
        )}
        {step === 2 && (
          <MomentCreationStep
            createdAreaIds={createdAreaIds}
            onCreateMoment={handleCreateMoment}
            onBack={prevOnboardingStep}
          />
        )}
        {step === 3 && createdMomentId && (
          <AllocationStep
            createdMomentId={createdMomentId}
            selectedPhase={selectedPhase}
            onSelectPhase={handleSelectPhase}
            onComplete={handleComplete}
            onSkip={handleSkip}
            onBack={prevOnboardingStep}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify compilation**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/OnboardingWizard.tsx
git commit -m "feat(onboarding): add OnboardingWizard orchestrator component

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 8: Mount OnboardingWizard in LayoutClient

**Files:**
- Modify: `src/components/LayoutClient.tsx`

**Step 1: Add OnboardingWizard import and render**

Add import at the top of `LayoutClient.tsx`:

```typescript
import { OnboardingWizard } from "@/components/OnboardingWizard";
```

Add `<OnboardingWizard />` inside the fragment, after `{children}` and before `<UpdateNotification />` (around line 73):

```typescript
return (
  <>
    {children}

    {/* Onboarding Wizard - Shown once for first-time users */}
    <OnboardingWizard />

    {/* Update Notification - Auto-checks on mount */}
    <UpdateNotification />
    ...
```

**Step 2: Verify compilation**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/LayoutClient.tsx
git commit -m "feat(onboarding): mount OnboardingWizard in global layout

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 9: Replay Onboarding in SettingsDrawer

**Files:**
- Modify: `src/components/SettingsDrawer.tsx`

**Step 1: Add imports**

Add to the existing imports at the top of `SettingsDrawer.tsx`:

```typescript
import { BookOpen } from "lucide-react";
import { resetOnboardingCompleted } from "@/infrastructure/state/initialize";
import { openOnboarding } from "@/infrastructure/state/ui-store";
```

Also add `BookOpen` to the existing lucide-react import line.

**Step 2: Add "Replay Onboarding" button**

Inside the `<Accordion>`, after the "Phase Settings" AccordionItem (around line 215) and before the "Data Management" AccordionItem, add:

```typescript
{/* Replay Onboarding Section (Link Button) */}
<AccordionItem
  value="onboarding"
  className="border-stone-200 dark:border-stone-700"
>
  <button
    onClick={() => {
      resetOnboardingCompleted();
      openOnboarding();
      onClose();
    }}
    className="flex w-full items-center justify-between px-2 py-4 text-left text-sm text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors"
    type="button"
  >
    <div className="flex items-center gap-2">
      <BookOpen className="w-4 h-4" />
      <span>Replay Onboarding</span>
    </div>
    <ChevronRight className="w-4 h-4" />
  </button>
</AccordionItem>
```

**Step 3: Verify compilation**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/SettingsDrawer.tsx
git commit -m "feat(onboarding): add Replay Onboarding button to settings

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 10: Unit Tests for Onboarding State

**Files:**
- Create: `src/infrastructure/state/__tests__/onboarding.test.ts`

**Step 1: Write tests for onboarding state helpers**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import {
  onboardingState$,
  openOnboarding,
  closeOnboarding,
  nextOnboardingStep,
  prevOnboardingStep,
} from "../ui-store";

describe("Onboarding State", () => {
  beforeEach(() => {
    closeOnboarding(); // Reset to defaults
  });

  it("starts closed at step 0", () => {
    const state = onboardingState$.get();
    expect(state.open).toBe(false);
    expect(state.step).toBe(0);
    expect(state.selectedAreaTemplateIndices).toEqual([]);
    expect(state.createdAreaIds).toEqual([]);
    expect(state.createdMomentId).toBeNull();
    expect(state.selectedPhase).toBeNull();
  });

  it("opens with reset state", () => {
    // Dirty the state first
    onboardingState$.step.set(2);
    onboardingState$.createdAreaIds.set(["abc"]);

    openOnboarding();

    const state = onboardingState$.get();
    expect(state.open).toBe(true);
    expect(state.step).toBe(0);
    expect(state.createdAreaIds).toEqual([]);
  });

  it("advances to next step", () => {
    openOnboarding();
    nextOnboardingStep();
    expect(onboardingState$.step.get()).toBe(1);

    nextOnboardingStep();
    expect(onboardingState$.step.get()).toBe(2);

    nextOnboardingStep();
    expect(onboardingState$.step.get()).toBe(3);
  });

  it("does not advance past step 3", () => {
    openOnboarding();
    onboardingState$.step.set(3);
    nextOnboardingStep();
    expect(onboardingState$.step.get()).toBe(3);
  });

  it("goes back to previous step", () => {
    openOnboarding();
    onboardingState$.step.set(2);
    prevOnboardingStep();
    expect(onboardingState$.step.get()).toBe(1);
  });

  it("does not go below step 0", () => {
    openOnboarding();
    prevOnboardingStep();
    expect(onboardingState$.step.get()).toBe(0);
  });

  it("closes and resets all state", () => {
    openOnboarding();
    onboardingState$.step.set(3);
    onboardingState$.createdAreaIds.set(["a", "b"]);
    onboardingState$.createdMomentId.set("m1");
    onboardingState$.selectedPhase.set("morning");

    closeOnboarding();

    const state = onboardingState$.get();
    expect(state.open).toBe(false);
    expect(state.step).toBe(0);
    expect(state.createdAreaIds).toEqual([]);
    expect(state.createdMomentId).toBeNull();
    expect(state.selectedPhase).toBeNull();
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm vitest run src/infrastructure/state/__tests__/onboarding.test.ts --reporter=verbose`
Expected: All 7 tests pass

**Step 3: Commit**

```bash
git add src/infrastructure/state/__tests__/onboarding.test.ts
git commit -m "test(onboarding): add unit tests for wizard state management

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 11: Unit Tests for Initialize Functions

**Files:**
- Create: `src/infrastructure/state/__tests__/onboarding-init.test.ts`

**Step 1: Write tests for shouldShowOnboarding and localStorage helpers**

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  shouldShowOnboarding,
  markOnboardingCompleted,
  resetOnboardingCompleted,
} from "../initialize";
import { areas$ } from "../store";

describe("Onboarding Init Helpers", () => {
  beforeEach(() => {
    areas$.set({});
    localStorage.clear();
  });

  describe("shouldShowOnboarding", () => {
    it("returns true when no areas and not completed", () => {
      expect(shouldShowOnboarding()).toBe(true);
    });

    it("returns false when areas exist", () => {
      areas$.set({
        "test-id": {
          id: "test-id",
          name: "Test",
          attitude: null,
          tags: [],
          color: "#000000",
          emoji: "🧪",
          isDefault: false,
          isArchived: false,
          order: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
      expect(shouldShowOnboarding()).toBe(false);
    });

    it("returns false when onboarding already completed", () => {
      localStorage.setItem("zenborg:onboardingCompleted", "true");
      expect(shouldShowOnboarding()).toBe(false);
    });
  });

  describe("markOnboardingCompleted", () => {
    it("sets localStorage flag", () => {
      markOnboardingCompleted();
      expect(localStorage.getItem("zenborg:onboardingCompleted")).toBe("true");
    });
  });

  describe("resetOnboardingCompleted", () => {
    it("removes localStorage flag", () => {
      localStorage.setItem("zenborg:onboardingCompleted", "true");
      resetOnboardingCompleted();
      expect(localStorage.getItem("zenborg:onboardingCompleted")).toBeNull();
    });
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm vitest run src/infrastructure/state/__tests__/onboarding-init.test.ts --reporter=verbose`
Expected: All 5 tests pass

**Step 3: Commit**

```bash
git add src/infrastructure/state/__tests__/onboarding-init.test.ts
git commit -m "test(onboarding): add unit tests for init helpers and localStorage

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

### Task 12: Manual QA Verification

**Files:** None (manual testing)

**Step 1: Clear localStorage and IndexedDB to simulate first-time user**

Open browser DevTools:
- Application > IndexedDB > Delete `zenborg` database
- Application > Local Storage > Clear all
- Reload the page

**Step 2: Verify onboarding auto-opens**

Expected:
- Dialog appears with step indicator dots (4 dots, first highlighted)
- Welcome screen shows "Welcome to Zenborg" + "Get Started" button

**Step 3: Walk through all 4 steps**

1. Click "Get Started" → Areas step appears
2. Select 2-3 area templates → Click "Create 3 Areas" → Moment step appears
3. Type a moment name → Click "Create Moment" → Allocation step appears
4. Tap a phase slot → Click "Done" → Dialog closes

**Step 4: Verify data persisted**

- Timeline should show the allocated moment in the correct phase
- Areas should appear in area selectors
- Refreshing the page should NOT re-show onboarding

**Step 5: Verify replay**

- Open Settings (hamburger menu) → Click "Replay Onboarding" → Wizard should reopen at step 0

**Step 6: Run full test suite**

Run: `cd /Users/rafa/Developer/zenborg/.claude/worktrees/quizzical-vaughan && pnpm vitest run --reporter=verbose`
Expected: All tests pass (existing + new)
