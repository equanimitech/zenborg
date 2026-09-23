import { Bed, Coffee, type LucideProps, Moon, Sun } from "lucide-react";
import { Phase } from "./Phase";

export interface PhaseStyle {
  phase: Phase;
  emoji: string;
  background: string; // Tailwind class
  text: string; // Tailwind class
  icon: React.ComponentType<LucideProps>;
}

// Map phases to Lucide icons
export const PHASE_ICONS: Record<
  Phase,
  React.ComponentType<{ className?: string }>
> = {
  MORNING: Coffee,
  AFTERNOON: Sun,
  EVENING: Moon,
  NIGHT: Bed,
};

export const PHASE_STYLES: Record<Phase, PhaseStyle> = {
  [Phase.MORNING]: {
    phase: Phase.MORNING,
    emoji: "",
    icon: Coffee,
    background: "bg-zinc-50 dark:bg-zinc-800", // cool clarity
    text: "text-zinc-900 dark:text-zinc-100",
  },
  [Phase.AFTERNOON]: {
    phase: Phase.AFTERNOON,
    emoji: "",
    icon: Sun,
    background: "bg-neutral-100 dark:bg-neutral-900", // neutral focus
    text: "text-neutral-900 dark:text-neutral-200",
  },
  [Phase.EVENING]: {
    phase: Phase.EVENING,
    emoji: "",
    icon: Moon,
    background: "bg-stone-200 dark:bg-stone-800", // warm decompression
    text: "text-stone-800 dark:text-stone-50",
  },
  [Phase.NIGHT]: {
    phase: Phase.NIGHT,
    emoji: "",
    icon: Bed,
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
