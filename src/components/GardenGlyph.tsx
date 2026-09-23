/**
 * The φ-grammar system glyphs, copied verbatim from docs/design/glyphs/*.svg.
 * Emoji are for things the gardener picks; system marks are these.
 */
export type GardenGlyphName = "plant" | "cultivate" | "harvest" | "fence";

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
