#!/usr/bin/env node
// @ts-check
// zenborg observer — append-only activity log for Claude Code sessions.
// Fail-open: any error → exit 0. A hook must never trap the user.

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ZENBORG =
  process.env.ZENBORG_HOME ||
  process.env.KAIROS_HOME ||
  join(homedir(), ".zenborg");
const LOG_DIR = process.env.KEEL_HOME
  ? join(process.env.KEEL_HOME, "log")
  : join(ZENBORG, "log");

/** @type {Record<string, string>} */
const KIND = {
  "session-start": "session_start",
  "user-submit": "prompt",
  "pre-tool": "tool_dispatched",
  "post-tool": "tool_completed",
  "post-tool-failure": "tool_failed",
  stop: "turn_stop",
  "subagent-stop": "subagent_stop",
  "session-end": "session_end",
  notification: "notification",
  "pre-compact": "pre_compact",
  "permission-request": "permission_request",
  "config-change": "config_change",
  "file-changed": "file_changed",
};

/** @param {number} ts */
function logFileName(ts) {
  const d = new Date(ts);
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.agent.jsonl`;
}

// Only what the readers need: `cwd`, `tool_name`, and the touched file under
// `tool_input` (SurfaceIndex resolves an area off it before falling back to cwd).
// Hook stdin also carries prompt text, full tool_input and tool_response —
// secrets included — so nothing else from it is persisted.
const PATH_KEYS = ["file_path", "notebook_path"];
const str = (/** @type {unknown} */ v) => (typeof v === "string" ? v : undefined);

/** @param {any} input */
export function trimPayload(input) {
  const p = input && typeof input === "object" ? input : {};
  const ti =
    p.tool_input && typeof p.tool_input === "object" ? p.tool_input : {};
  const path = Object.fromEntries(
    PATH_KEYS.filter((k) => str(ti[k])).map((k) => [k, ti[k]]),
  );
  return {
    ...(str(p.cwd) ? { cwd: p.cwd } : {}),
    ...(str(p.tool_name) ? { tool_name: p.tool_name } : {}),
    ...(Object.keys(path).length ? { tool_input: path } : {}),
  };
}

function readStdin() {
  return new Promise((res) => {
    if (process.stdin.isTTY) return res(null);
    let d = "";
    process.stdin.on("data", (c) => (d += c));
    process.stdin.on("end", () => {
      try {
        res(JSON.parse(d));
      } catch {
        res(null);
      }
    });
  });
}

async function main() {
  try {
    const hook = process.argv[2];
    const kind = KIND[hook];
    if (!kind) process.exit(0);

    const input = await readStdin();
    const now = Date.now();

    const event = JSON.stringify({
      id: randomUUID(),
      surface: "agent",
      kind,
      ts: now,
      sessionId: input?.session_id ?? "",
      payload: trimPayload(input),
    });

    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, logFileName(now)), event + "\n");
  } catch {
    // fail-open
  }
  process.exit(0);
}

// Run only as a hook, not when imported (the vault migration reuses trimPayload).
const isEntry = () => {
  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return true; // fail-open: when in doubt, behave as the hook
  }
};
if (isEntry()) main();
