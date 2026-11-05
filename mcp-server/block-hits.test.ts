import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { getBlockHits } from "./block-hits.js";

const at = (day: number, h: number) => new Date(2026, 9, day, h, 0).getTime();

const event = (id: string, kind: string, ts: number, domain: string) =>
  JSON.stringify({
    id,
    kind,
    payload: { domain, fenceIds: ["f1"] },
    sessionId: "s",
    surface: "browser",
    ts,
  });

describe("getBlockHits", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zenborg-hits-"));
  const write = (day: number, lines: string[]) =>
    fs.writeFileSync(
      path.join(dir, `2026-10-${String(day).padStart(2, "0")}.browser.jsonl`),
      `${lines.join("\n")}\n`,
    );
  write(20, [
    event("a", "block_hit", at(20, 9), "x.com"),
    event("b", "block_hit", at(20, 10), "x.com"),
  ]);
  write(22, [
    event("c", "block_hit", at(22, 8), "x.com"),
    event("c", "block_hit", at(22, 8), "x.com"),
    event("d", "block_hit", at(22, 9), "m.reddit.com"),
    event("e", "navigation_committed", at(22, 9), "x.com"),
  ]);
  write(10, [event("old", "block_hit", at(10, 9), "x.com")]);
  const now = at(23, 12);

  it("counts per host per local day, deduped by id, inside the window", () => {
    const r = getBlockHits(dir, { days: 7 }, now);
    expect(r.daily).toEqual([
      { day: "2026-10-20", host: "x.com", hits: 2 },
      { day: "2026-10-22", host: "m.reddit.com", hits: 1 },
      { day: "2026-10-22", host: "x.com", hits: 1 },
    ]);
    expect(r.total).toBe(4);
  });

  it("filters by host, subdomains included", () => {
    const r = getBlockHits(dir, { days: 7, host: "reddit.com" }, now);
    expect(r.daily).toEqual([
      { day: "2026-10-22", host: "m.reddit.com", hits: 1 },
    ]);
  });
});
