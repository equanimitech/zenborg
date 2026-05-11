# PlanAreaCard: Kinetic Calm Design

**Date:** 2025-12-04
**Status:** Idea
**Focus:** Empty state design + micro-interactions

## Design Direction

Apply "Kinetic Calm" approach: alive but zen, interactive but restrained.

## Empty State Improvements

**Current state:**
- Large muted emoji (4xl, 20% opacity)
- Instructional text: "No habits yet" + "Click 'Add habit' below"
- Static design

**Proposed changes:**
1. **Breathing animation** on emoji
   - Opacity pulse: 10% → 20% → 10%
   - Duration: 4 seconds (slow, meditative)
   - Easing: ease-in-out
   - Communicates "alive but waiting" without text

2. **Remove instructional text**
   - Let breathing emoji communicate state
   - Aligns with calm, spacious philosophy
   - Reduces visual noise

3. **Lighter background tint**
   - Change from 5% to 3% area color opacity
   - Emphasizes spaciousness
   - Keeps monochromatic base

## Micro-Interactions

**Hover reveals:**
- Show subtle glow around emoji on card hover
- Radial gradient at 10% area color opacity
- Duration: 200ms ease

**Smooth transitions:**
- All state changes use 200-300ms transitions
- Consistent easing functions throughout
- No abrupt changes

**Haptic feedback cues:**
- Scale transform on "Add habit" button hover: 1.02x
- Spring physics on icon (scale 1.0 → 1.1)
- Color shift on hover: border opacity 25% → 35%

## Technical Notes

**CSS animations:**
- Use `@keyframes` for breathing effect
- Apply `will-change: opacity` for performance
- Consider `prefers-reduced-motion` media query

**Tailwind classes:**
- `animate-[breathing_4s_ease-in-out_infinite]`
- Define custom animation in tailwind.config.ts

## Philosophy

Calm technology that informs without demanding attention. Interactive enough to feel responsive, restrained enough to avoid distraction.

## Next Steps

1. Prototype breathing animation
2. Test on various screen sizes
3. Validate with reduced motion preferences
4. Consider extending to other empty states
