#!/usr/bin/env node
/**
 * spend-warnings: the circuit breaker. UserPromptSubmit.
 *
 * Reads the cached cycle spend only (`<vault>/cache/cycle-spend.json`), finds
 * this session's allocation, and says once per level (70 %, 100 %) per session
 * what the cache shows. "Already warned" is one small file per session under
 * `<vault>/cache/spend-warnings/`. Never blocks, never waits on anything but
 * small file reads; a stale cache triggers a detached refresh.
 *
 * Fail open, silently.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { refreshSpendInBackground } from "./spend-refresh.ts";
import { spendWarning } from "./spend-warn.ts";

const VAULT =
  process.env.ZENBORG_HOME ||
  process.env.KAIROS_HOME ||
  join(homedir(), ".zenborg");
const DIR = join(VAULT, "cache", "spend-warnings");
const PRUNE_AFTER_MS = 7 * 24 * 3_600_000;

const readStdin = (): Promise<string> =>
  new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      raw += c;
    });
    process.stdin.on("end", () => resolve(raw));
    process.stdin.on("error", () => resolve(raw));
    process.stdin.resume();
  });

/** Drop warning files older than a week; cheap, only run when we write one. */
function prune(): void {
  for (const f of readdirSync(DIR)) {
    try {
      const p = join(DIR, f);
      if (Date.now() - statSync(p).mtimeMs > PRUNE_AFTER_MS) unlinkSync(p);
    } catch {}
  }
}

async function main(): Promise<void> {
  const input = JSON.parse((await readStdin()) || "{}");
  const sid = String(input?.session_id ?? "");
  if (!/^[\w-]+$/.test(sid)) return; // also keeps the id safe as a filename
  refreshSpendInBackground(VAULT); // detached; this run reads the cache as it is
  const spend = JSON.parse(
    readFileSync(join(VAULT, "cache", "cycle-spend.json"), "utf8"),
  );
  const file = join(DIR, sid);
  let warnedAt = 0;
  try {
    warnedAt = Number(readFileSync(file, "utf8")) || 0;
  } catch {}
  const w = spendWarning(spend, sid, warnedAt);
  if (!w) return;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, String(w.level));
  try {
    prune();
  } catch {}
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: w.text,
      },
    }),
  );
}

main().then(
  () => process.exit(0),
  () => process.exit(0),
);
