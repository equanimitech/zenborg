import type { Fence } from "./types";

/**
 * Fence badges as φ-grammar glyphs, paths verbatim from
 * docs/design/glyphs/fence*.svg (mirrors src/components/GardenGlyph.tsx).
 * System marks are glyphs; emoji are only for things the gardener chose.
 */
type FenceGlyphName = "fence" | "fence-standing" | "fence-gate";

const FRAMES: Record<FenceGlyphName, { d: string; cx: number }> = {
  fence: { d: "M18 10V6H6v12h12v-4", cx: 12 },
  "fence-standing": { d: "M6 6h12v12H6z", cx: 12 },
  "fence-gate": { d: "M18 8.5V6H6v12h12v-2.5", cx: 18 },
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
  const { d, cx } = FRAMES[name];
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
        strokeWidth={1.65}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={d} />
        <circle cx={cx} cy="12" r="1.9" fill="currentColor" stroke="none" />
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
