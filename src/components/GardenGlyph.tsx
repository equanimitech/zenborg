/**
 * The φ-grammar system glyphs, copied verbatim from docs/design/glyphs/*.svg.
 * Emoji are for things the gardener picks; system marks are these.
 */
export type GardenGlyphName =
  | "plant"
  | "cultivate"
  | "harvest"
  | "fence"
  | "fence-standing"
  | "fence-gate"
  | "phase-morning"
  | "phase-afternoon"
  | "phase-evening"
  | "phase-night";

const SHAPES: Record<GardenGlyphName, React.ReactNode> = {
  plant: (
    <>
      <path d="M4.5 17h15" />
      <circle cx="12" cy="10.5" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  cultivate: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      <circle cx="14.5" cy="9.5" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  harvest: (
    <>
      <path d="M4.5 10a7.5 7.5 0 0 0 15 0" />
      <circle cx="12" cy="11.5" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  fence: (
    <>
      <path d="M18 10V6H6v12h12v-4" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  "fence-standing": (
    <>
      <path d="M6 6h12v12H6z" />
      <circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  "fence-gate": (
    <>
      <path d="M18 8.5V6H6v12h12v-2.5" />
      <circle cx="18" cy="12" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  "phase-morning": (
    <>
      <path d="M5 14.5h14" />
      <circle cx="6.5" cy="10" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  "phase-afternoon": (
    <>
      <path d="M5 14.5h14" />
      <circle cx="12" cy="6" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  "phase-evening": (
    <>
      <path d="M5 14.5h14" />
      <circle cx="17.5" cy="10" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
  "phase-night": (
    <>
      <path d="M5 14.5h14" />
      <circle cx="12" cy="19" r="1.9" fill="currentColor" stroke="none" />
    </>
  ),
};

export function GardenGlyph({
  name,
  size = 16,
  className,
}: {
  name: GardenGlyphName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {SHAPES[name]}
    </svg>
  );
}
