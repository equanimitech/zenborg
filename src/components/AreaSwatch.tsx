/**
 * The area's colour, standing in where the gardener hasn't chosen an emoji.
 * Colour is the one channel that attributes an area, so it is the fallback.
 */
export function AreaSwatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 rounded-[2px] flex-shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}
