/**
 * Trim every `<date>.agent.jsonl` in the vault log to the envelope the writer
 * now emits: `{id, surface, kind, ts, sessionId, payload: trimPayload(payload)}`.
 * The old writer persisted the whole hook stdin (prompts, tool_input,
 * tool_response — secrets included), capped at 2KB per field.
 *
 *   node scripts/migrate-agent-log.mts [--vault <dir>] [--include-today] [--resume]
 *
 * Originals are copied to `<vault>/log.bak-2026-09-23/` first and never deleted.
 * Each file is streamed line by line into a temp file, then atomically renamed.
 * Idempotent: an already-trimmed line trims to itself. Unparseable lines drop.
 * Today's file is skipped by default — the live hook is appending to it.
 */

import { once } from "node:events";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { trimPayload } from "../plugin/observe.mjs";

const BACKUP_NAME = "log.bak-2026-09-23";
const ENVELOPE = ["id", "surface", "kind", "ts", "sessionId"] as const;

/** One raw log line → the trimmed line, or `null` when it does not parse. */
export function trimLine(line: string): string | null {
  let e: Record<string, unknown>;
  try {
    e = JSON.parse(line);
  } catch {
    return null;
  }
  if (!e || typeof e !== "object" || Array.isArray(e)) return null;
  const out: Record<string, unknown> = {};
  for (const k of ENVELOPE) if (k in e) out[k] = e[k];
  out.payload = trimPayload(e.payload);
  return JSON.stringify(out);
}

const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function migrateFile(path: string): Promise<{ dropped: number }> {
  const tmp = `${path}.migrating`;
  const out = createWriteStream(tmp);
  let dropped = 0;
  for await (const line of createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  })) {
    if (line.trim() === "") continue;
    const trimmed = trimLine(line);
    if (trimmed === null) {
      dropped++;
      continue;
    }
    if (!out.write(`${trimmed}\n`)) await once(out, "drain");
  }
  out.end();
  await once(out, "finish");
  renameSync(tmp, path);
  return { dropped };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const vaultIdx = args.indexOf("--vault");
  const vault =
    (vaultIdx >= 0 ? args[vaultIdx + 1] : undefined) ??
    process.env.ZENBORG_HOME ??
    process.env.KAIROS_HOME ??
    join(homedir(), ".zenborg");
  const logDir = join(vault, "log");
  const backup = join(vault, BACKUP_NAME);
  const today = `${localDate()}.agent.jsonl`;

  const files = readdirSync(logDir)
    .filter((f) => f.endsWith(".agent.jsonl"))
    .sort();
  const targets = args.includes("--include-today")
    ? files
    : files.filter((f) => f !== today);

  if (
    existsSync(backup) &&
    readdirSync(backup).length > 0 &&
    !args.includes("--resume")
  ) {
    console.error(
      `${backup} already holds files; pass --resume to continue a previous run.`,
    );
    return 1;
  }
  mkdirSync(backup, { recursive: true });
  // On --resume, never overwrite an original already in the backup with a trimmed copy.
  for (const f of files)
    if (!existsSync(join(backup, f)))
      copyFileSync(join(logDir, f), join(backup, f));

  let before = 0;
  let after = 0;
  for (const f of targets) {
    const path = join(logDir, f);
    const b = statSync(path).size;
    const { dropped } = await migrateFile(path);
    const a = statSync(path).size;
    before += b;
    after += a;
    console.log(
      `${f}\t${b}\t→ ${a}${dropped ? `\t(${dropped} unparseable dropped)` : ""}`,
    );
  }
  console.log(
    `total\t${before}\t→ ${after}\t(${targets.length} files; ${files.length - targets.length} skipped; backup ${backup})`,
  );
  return 0;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  process.exitCode = await main();
}
