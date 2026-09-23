import type { Fence } from "./types";

/**
 * Fence badges as botanical garden glyphs, paths verbatim from
 * docs/design/glyphs/fence*.svg (mirrors src/components/GardenGlyph.tsx).
 * System marks are glyphs; emoji are only for things the gardener chose.
 */
type FenceGlyphName = "fence" | "fence-standing" | "fence-gate";

const PATHS: Record<FenceGlyphName, string[]> = {
  fence: [
    "M4.3 20V8.2L5.5 6.6l1.2 1.6V20 M10.8 20V7.6L12 6l1.2 1.6V20 M17.3 20V8.4L18.5 6.8l1.2 1.6V20",
    "M6.7 14.2c1.6.2 2.9.2 4.1.1",
  ],
  "fence-standing": [
    "M4.3 20V8.2L5.5 6.6l1.2 1.6V20 M10.8 20V7.6L12 6l1.2 1.6V20 M17.3 20V8.4L18.5 6.8l1.2 1.6V20",
    "M6.7 14.2c1.6.2 2.9.2 4.1.1M13.2 14.3c1.5.1 2.7.1 4.1 0",
  ],
  "fence-gate": [
    "M4.3 20V8.2L5.5 6.6l1.2 1.6V20 M10.8 20V7.6L12 6l1.2 1.6V20",
    "M6.7 14.2c1.6.2 2.9.2 4.1.1",
    "M19.5 20V8.2M19.5 9.6l-4.3 1.5v8.2l4.3.7",
  ],
};

export function FenceGlyph({
  name,
  label,
  size = 16,
}: {
  name: FenceGlyphName;
  label: string;
  size?: number;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ display: "inline-flex" }}
    >
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
      >
        {PATHS[name].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
}

/** The badge for a fence: standing block, timed block, pause gate, or other. */
export function FenceBadge({ fence }: { fence: Fence }) {
  switch (fence.enforcement.kind) {
    case "block":
      return fence.enforcement.standing ? (
        <FenceGlyph name="fence-standing" label="standing fence" />
      ) : (
        <FenceGlyph name="fence" label="timed fence" />
      );
    case "gate":
      return <FenceGlyph name="fence-gate" label="pause gate" />;
    default:
      return <FenceGlyph name="fence" label="fence" />;
  }
}
