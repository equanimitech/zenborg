/**
 * The garden glyphs: hand-drawn botanical marks, paths copied verbatim from
 * docs/design/glyphs/*.svg. Stroke-only (stroke 1.5, round caps, currentColor).
 * Emoji are for things the gardener picks; system marks are these.
 */
export type GardenGlyphName = "plant" | "cultivate" | "harvest" | "fence";

const SHAPES: Record<GardenGlyphName, React.ReactNode> = {
  plant: (
    <>
      <path d="M12 20.5c0-3 0-5.5.2-8.5" />
      <path d="M12.1 14c-3.2.2-5.3-1.6-5.6-5 3.3-.2 5.4 1.7 5.6 5z" />
      <path d="M12.2 11.5c.3-3.4 2.4-5.2 5.4-5.2 0 3.2-2.1 5.1-5.4 5.2z" />
    </>
  ),
  cultivate: (
    <>
      <path d="M5.5 18.5c0-7.2 4.8-12.5 13-13 .3 8.3-5 13-13 13z" />
      <path d="M5.5 18.5c3-3.6 6-6.6 9.5-9.3" />
    </>
  ),
  harvest: (
    <>
      <path d="M12 21.2V9.6" />
      <path d="M12 9.6c-1.3-1.4-1.3-3.6 0-5 1.3 1.4 1.3 3.6 0 5zM11.9 14.6c-2.4.2-3.9-1.1-4.1-3.4 2.4-.2 3.9 1.1 4.1 3.4zM12.1 14.6c2.4.2 3.9-1.1 4.1-3.4-2.4-.2-3.9 1.1-4.1 3.4z" />
    </>
  ),
  fence: (
    <>
      <path d="M4.3 20V8.2L5.5 6.6l1.2 1.6V20 M10.8 20V7.6L12 6l1.2 1.6V20 M17.3 20V8.4L18.5 6.8l1.2 1.6V20" />
      <path d="M6.7 14.2c1.6.2 2.9.2 4.1.1" />
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
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {SHAPES[name]}
    </svg>
  );
}
