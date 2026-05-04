# Onboarding Wizard Design

> Interactive 3-step dialog wizard for first-time users.

## Decision Record

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Audience | Action-first | Get users creating, not reading philosophy |
| Persistence | Wizard + empty states | Short intro, then UI teaches itself |
| Format | Dialog (same as MomentFormDialog) | Consistent visual language |
| Scope | Areas + Moments + Timeline | Core loop; phases/drawing board discoverable |
| Interactivity | Interactive | User creates real data during onboarding |

## Architecture

### State (ui-store.ts)

Follows the existing form state pattern:

```typescript
interface OnboardingState {
  open: boolean;
  step: 0 | 1 | 2 | 3;        // welcome, area, moment, allocate
  createdAreaId: string | null;  // tracks area from step 1
  createdMomentId: string | null; // tracks moment from step 2
}
```

Observable: `onboardingState$`
Helper functions: `openOnboarding()`, `closeOnboarding()`, `nextOnboardingStep()`, `prevOnboardingStep()`

### Persistence

- `onboardingCompleted$`: boolean, persisted to localStorage
- Checked on app init: if `false` and no areas exist, auto-open wizard
- "Replay onboarding" option in SettingsDrawer

### Trigger

In `initializeStore()` or `StoreInitializer`, after init completes:
- If no areas exist AND `onboardingCompleted` is falsy, set `onboardingState$.open = true`

## Wizard Steps

### Step 0: Welcome

Brief, action-oriented. No philosophy dump.

Content:
- Headline: "Welcome to Zenborg"
- Subtext: One sentence explaining what the app does ("Budget your attention across life areas, one moment at a time.")
- Single CTA button: "Get Started"

Monochrome stone palette. No illustrations, no animations. Calm.

### Step 1: Create Your First Area

Explains areas as life domains. Offers the 6 default templates (Wellness, Craft, Social, Joyful, Introspective, Chore) as selectable cards, each showing emoji + name + color swatch.

Behavior:
- User taps a template card to select it (multi-select, pick 1-6)
- Selected cards show a checkmark or highlighted border
- "Create custom" option at the end for power users
- CTA: "Create Areas" (disabled until at least 1 selected)

On submit: creates the selected areas via AreaService. Stores first area ID in `onboardingState$.createdAreaId`.

### Step 2: Create Your First Moment

Explains moments as named intentions (1-3 words).

Content:
- Brief explanation: "A moment is an intention for your day. Keep it short - 3 words max."
- Examples as placeholder suggestions: "Morning Run", "Deep Work", "Read Fiction"
- Simplified MomentForm: name input + area selector (pre-filled with area from step 1)
- Area selector shows only the areas just created

Behavior:
- User types a moment name, selects area
- CTA: "Create Moment"

On submit: creates the moment via MomentService. Stores ID in `onboardingState$.createdMomentId`. Moment is unallocated (drawing board).

### Step 3: Allocate to Timeline

Shows a simplified timeline view (today only, visible phases).

Content:
- Brief explanation: "Drag your moment to a time of day, or tap a slot to place it."
- Show the moment card (just created) and today's phase slots
- Phase slots show emoji + label (Morning, Afternoon, etc.)

Behavior:
- User taps a phase slot to allocate their moment there
- Visual feedback: moment card animates into the slot
- CTA: "Done" (enabled after allocation, but also a "Skip" link to finish without allocating)

On submit: allocates moment to selected (today, phase) via MomentService. Sets `onboardingCompleted$ = true`. Closes wizard.

## Empty States (Post-Wizard)

After the wizard closes, smart empty states guide further use:

### Timeline Empty Cells
When a phase slot has no moments:
- Light dashed border
- Subtle "+" icon
- On hover: "Add a moment" tooltip

### Drawing Board Empty
When drawing board has no unallocated moments:
- "Your drawing board is empty. Create moments here and allocate them to your timeline."
- Small "+" button

These empty states are permanent UI (not onboarding-specific). They help both new and returning users.

## Component Structure

```
src/components/
  OnboardingWizard.tsx          # Main dialog, step router
  onboarding/
    WelcomeStep.tsx             # Step 0
    AreaSelectionStep.tsx        # Step 1 (area templates)
    MomentCreationStep.tsx       # Step 2 (simplified moment form)
    AllocationStep.tsx           # Step 3 (simplified timeline)
```

## Visual Design

- Uses existing `Dialog` / `DialogContent` / `DialogHeader` / `DialogFooter`
- Monochrome stone palette (bg-stone-50, text-stone-900, border-stone-200)
- Area template cards show their area color as accent (border or dot)
- Step indicator: simple dots or "1 of 4" text in header
- All buttons use existing button styles
- No animations beyond CSS transitions
- Landscape-friendly layout (side-by-side where possible)

## Constraints

- No new dependencies required
- Reuses existing Dialog, Button, Input components
- Area creation goes through existing AreaService
- Moment creation goes through existing MomentService
- Moment allocation goes through existing MomentService
- All data created during onboarding is real, persistent data
