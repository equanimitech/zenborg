/**
 * The circuit breaker's decision, pure: given the cached cycle spend, this
 * session's id and the highest level it was already warned at, what (if
 * anything) to say. Never blocks; the hook only adds context.
 */
interface CachedAllocation {
  id: string;
  name: string;
  kind?: string;
  appetiteDays: number;
  days: number;
  pct: number;
}
export interface WarnSpend {
  allocations?: CachedAllocation[];
  /** Session id -> allocation id (written by refreshSpend). */
  sessions?: Record<string, string>;
}

export type WarnLevel = 70 | 100;
export const WARN_LEVELS: readonly WarnLevel[] = [70, 100];

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** The level the session newly crossed, with the text for Claude; null when nothing is due. */
export function spendWarning(
  spend: WarnSpend | null | undefined,
  sessionId: string,
  warnedAt: number,
): { level: WarnLevel; text: string } | null {
  const id = spend?.sessions?.[sessionId];
  const a = id ? spend?.allocations?.find((x) => x.id === id) : undefined;
  if (!a || !(a.appetiteDays > 0)) return null;
  const level = [...WARN_LEVELS].reverse().find((l) => a.pct >= l);
  if (!level || level <= warnedAt) return null;
  const used = `${n(a.days)}/${n(a.appetiteDays)} d`;
  if (level === 70)
    return {
      level,
      text: `[zenborg spend] This session's allocation "${a.name}" is at ${a.pct} % of its appetite (${used}). Ask the gardener once, briefly, before going further: what can we cut to land it?`,
    };
  return {
    level,
    text:
      a.kind === "lane"
        ? `[zenborg spend] The "${a.name}" lane's appetite is spent for this cycle (${used}, ${a.pct} %). Start no new slice on it; say so, and propose landing what is in flight or parking the rest.`
        : `[zenborg spend] The "${a.name}" bet is over its appetite (${used}, ${a.pct} %). Start no new slice on it; propose landing it or parking it.`,
  };
}
