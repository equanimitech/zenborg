/**
 * The allocation line for SessionStart, read from the cached cycle spend
 * (`<vault>/cache/cycle-spend.json`, written by the get_cycle_spend MCP tool).
 * Pure; never recomputes, never throws.
 *
 *   Rente 4.1/5 d · 82 % · Data trust 2.0/3 d · unattributed 18 %
 */
interface CachedAllocation {
  name: string;
  appetiteDays: number;
  days: number;
  pct: number;
}
export interface CachedSpend {
  computedAt?: string;
  allocations?: CachedAllocation[];
  unattributed?: { pct: number };
}

const SHOWN = 3;
const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** Most-spent allocations first, % on the first, then the unattributed share. */
export function spendLine(
  spend: CachedSpend | null | undefined,
  today?: string,
): string | null {
  const rows = (spend?.allocations ?? []).filter((a) => a.appetiteDays > 0);
  if (rows.length === 0 && spend?.unattributed === undefined) return null;
  const parts = [...rows]
    .sort((a, b) => b.pct - a.pct)
    .slice(0, SHOWN)
    .map(
      (a, i) =>
        `${a.name} ${n(a.days)}/${n(a.appetiteDays)} d${i === 0 ? ` · ${a.pct} %` : ""}`,
    );
  if (spend?.unattributed)
    parts.push(`unattributed ${spend.unattributed.pct} %`);
  const asOf = spend?.computedAt?.slice(0, 10);
  if (asOf && today && asOf !== today) parts.push(`as of ${asOf}`);
  return parts.join(" · ");
}
