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
      <path d="M3.5 17.2c5.5-.4 11.5-.4 17 .1" />
      <path d="M7.4 16.9c-.1-2.6 2-4.7 4.6-4.6 2.5 0 4.5 2 4.5 4.6" />
      <path d="M12 8.4v1.7M6.2 10.9l1.2 1.1M17.8 10.9l-1.2 1.1M4.1 14.2h1.5M19.9 14.2h-1.5" />
    </>
  ),
  "phase-afternoon": (
    <>
      <path d="M12 8.2c2.2-.1 3.9 1.6 3.8 3.8.1 2.2-1.7 3.9-3.9 3.9-2.1 0-3.8-1.8-3.7-4 0-2.1 1.6-3.7 3.8-3.7z" />
      <path d="M12 3.4v1.8M12 18.8v1.8M3.4 12h1.8M18.8 12h1.8M5.9 5.9l1.3 1.3M16.8 16.8l1.3 1.3M18.1 5.9l-1.3 1.3M7.2 16.8l-1.3 1.3" />
    </>
  ),
  "phase-evening": (
    <>
      <path d="M3.5 17.2c5.5-.4 11.5-.4 17 .1" />
      <path d="M8 16.9c.3-1.9 1.9-3.2 4-3.2 2 0 3.7 1.3 4 3.2" />
      <path d="M6.5 20.2c3.7.3 7.3.3 11 0" />
    </>
  ),
  "phase-night": (
    <>
      <path d="M15.8 4.6c-3.9.9-6.3 4.9-5.4 8.8.9 3.8 4.6 6.2 8.5 5.4-1.5 1.9-3.9 3-6.4 2.8-4.3-.3-7.5-4.1-7.1-8.4.3-4.3 4-7.4 8.3-7.1.8 0 1.5-.1 2.1-1.5z" />
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
