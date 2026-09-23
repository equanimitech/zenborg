/**
 * The garden glyphs: hand-drawn botanical marks, paths copied verbatim from
 * docs/design/glyphs/*.svg. Stroke-only (stroke 1.5, round caps, currentColor).
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
      <path d="M10.8 21.2c.2-3.8.8-7.3 2.2-10.6" />
      <path d="M13.3 10.4c-1.3-1.6-1-3.9.8-5.4 1.2 1.9.8 4.1-.8 5.4zM12.3 14.6c-2.7-.1-4.2-1.7-4.1-4.2 2.6.1 4.2 1.7 4.1 4.2zM12.6 14.2c2.3-1.5 4.5-1.2 5.8.4-2.2 1.6-4.4 1.4-5.8-.4z" />
    </>
  ),
  "fence-standing": (
    <>
      <path d="M4.3 20V8.2L5.5 6.6l1.2 1.6V20 M10.8 20V7.6L12 6l1.2 1.6V20 M17.3 20V8.4L18.5 6.8l1.2 1.6V20" />
      <path d="M6.7 14.2c1.6.2 2.9.2 4.1.1M13.2 14.3c1.5.1 2.7.1 4.1 0" />
    </>
  ),
  fence: (
    <>
      <path d="M4.3 20V8.2L5.5 6.6l1.2 1.6V20 M10.8 20V7.6L12 6l1.2 1.6V20" />
      <path d="M6.7 14.2c1.6.2 2.9.2 4.1.1M13.2 14.3c1.8.1 3.5.1 5.3-.1" />
    </>
  ),
  "fence-gate": (
    <>
      <path d="M4.3 20V8.2L5.5 6.6l1.2 1.6V20 M10.8 20V7.6L12 6l1.2 1.6V20" />
      <path d="M6.7 14.2c1.6.2 2.9.2 4.1.1" />
      <path d="M19.5 20V8.2M19.5 9.6l-4.3 1.5v8.2l4.3.7" />
    </>
  ),
  "phase-morning": (
    <>
      <path d="M12 20.5c0-2.6 0-4.6.1-6.5" />
      <path d="M12.1 17c-2.3.1-3.8-1.1-4-3.5 2.4-.1 3.9 1.2 4 3.5zM12.1 15.2c.2-2.4 1.7-3.6 3.9-3.6 0 2.3-1.5 3.6-3.9 3.6z" />
    </>
  ),
  "phase-afternoon": (
    <>
      <path d="M12 21.2c0-2.7 0-5 .1-7.4" />
      <path d="M12.1 18c1.6-.2 2.8-1.2 3.1-2.8-1.7.1-2.9 1.1-3.1 2.8z" />
      <circle cx="12" cy="9" r="1.4" />
      <path d="M12 7.6c-1.2-1.6-.6-3.3 0-3.8.6.5 1.2 2.2 0 3.8zM13.3 8.6c1.3-1.5 3.1-1.4 3.6-.9-.4.7-1.9 1.6-3.6.9zM12.8 10.2c1.9.5 2.4 2.2 2.2 2.9-.8.1-2.3-.7-2.2-2.9zM11.2 10.2c-1.9.5-2.4 2.2-2.2 2.9.8.1 2.3-.7 2.2-2.9zM10.7 8.6c-1.3-1.5-3.1-1.4-3.6-.9.4.7 1.9 1.6 3.6.9z" />
    </>
  ),
  "phase-evening": (
    <>
      <path d="M12 21c0-3 .1-5.5.4-7.8" />
      <path d="M12.4 13.2c-2-.9-2.6-3-2-5.6 1 .8 1.6 1.7 2 2.6.4-.9 1-1.8 2-2.6.6 2.6 0 4.7-2 5.6z" />
    </>
  ),
  "phase-night": (
    <>
      <path d="M11 21c0-4 .6-7.5 2.6-9.4 1.3-1.2 3-1.2 3.9 0" />
      <path d="M17.5 11.6c1 1.6.8 3.6-.6 4.6-.9-1.5-.7-3.4.6-4.6z" />
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
