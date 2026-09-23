import { GardenGlyph, type GardenGlyphName } from "@/components/GardenGlyph";
import { Phase } from "./Phase";

type PhaseIconComponent = React.ComponentType<{ className?: string }>;

export interface PhaseStyle {
  phase: Phase;
  emoji: string;
  background: string; // Tailwind class
  text: string; // Tailwind class
  icon: PhaseIconComponent;
}

/** The glyph for a phase: the sky over the garden (sun rising, high, setting; moon). */
export function phaseGlyphName(phase: Phase): GardenGlyphName {
  return `phase-${phase.toLowerCase()}` as GardenGlyphName;
}

// Sized by className (w-/h- classes override the SVG's width/height).
function glyphFor(phase: Phase): PhaseIconComponent {
  return function PhaseGlyph({ className }) {
    return <GardenGlyph name={phaseGlyphName(phase)} className={className} />;
  };
}

export const PHASE_ICONS: Record<Phase, PhaseIconComponent> = {
  MORNING: glyphFor(Phase.MORNING),
  AFTERNOON: glyphFor(Phase.AFTERNOON),
  EVENING: glyphFor(Phase.EVENING),
  NIGHT: glyphFor(Phase.NIGHT),
};

export const PHASE_STYLES: Record<Phase, PhaseStyle> = {
  [Phase.MORNING]: {
    phase: Phase.MORNING,
    emoji: "",
    icon: PHASE_ICONS.MORNING,
    background: "bg-zinc-50 dark:bg-zinc-800", // cool clarity
    text: "text-zinc-900 dark:text-zinc-100",
  },
  [Phase.AFTERNOON]: {
    phase: Phase.AFTERNOON,
    emoji: "",
    icon: PHASE_ICONS.AFTERNOON,
    background: "bg-neutral-100 dark:bg-neutral-900", // neutral focus
    text: "text-neutral-900 dark:text-neutral-200",
  },
  [Phase.EVENING]: {
    phase: Phase.EVENING,
    emoji: "",
    icon: PHASE_ICONS.EVENING,
    background: "bg-stone-200 dark:bg-stone-800", // warm decompression
    text: "text-stone-800 dark:text-stone-50",
  },
  [Phase.NIGHT]: {
    phase: Phase.NIGHT,
    emoji: "",
    icon: PHASE_ICONS.NIGHT,
    background: "bg-slate-950 dark:bg-slate-900", // cool stillness
    text: "text-slate-50 dark:text-slate-200",
  },
};

/** Get static style object for given phase */
export function getPhaseStyle(phase: Phase): PhaseStyle {
  const style = PHASE_STYLES[phase];
  return style;
}

export function PhaseIcon({
  phase,
  className,
}: {
  phase: Phase;
  className?: string;
}) {
  const IconComponent = PHASE_ICONS[phase];

  return <IconComponent className={className} />;
}
