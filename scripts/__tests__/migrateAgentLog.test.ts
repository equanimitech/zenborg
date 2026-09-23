import { describe, expect, it } from "vitest";
import { trimLine } from "../migrate-agent-log.mts";

const SECRET =
  "ADGUARD_PASS=hunter2 sk-ant-FAKE ghp_FAKE Bearer abc123 password=x";

const raw = JSON.stringify({
  id: "e1",
  surface: "agent",
  kind: "tool_dispatched",
  ts: 1,
  sessionId: "s1",
  payload: {
    session_id: "s1",
    cwd: "/repo",
    transcript_path: "/t.jsonl",
    tool_name: "Bash",
    prompt: SECRET,
    tool_input: { command: SECRET, file_path: "/repo/a.ts" },
    tool_response: { truncated: true, bytes: 9000, value: SECRET },
  },
});

describe("trimLine", () => {
  it("keeps the envelope, cwd, tool_name and the touched path only", () => {
    expect(JSON.parse(trimLine(raw) ?? "")).toEqual({
      id: "e1",
      surface: "agent",
      kind: "tool_dispatched",
      ts: 1,
      sessionId: "s1",
      payload: {
        cwd: "/repo",
        tool_name: "Bash",
        tool_input: { file_path: "/repo/a.ts" },
      },
    });
  });

  it("drops every secret", () => {
    expect(trimLine(raw)).not.toMatch(
      /ADGUARD_PASS=|sk-ant-|ghp_|Bearer [A-Za-z0-9]|password=|hunter2/,
    );
  });

  it("is idempotent", () => {
    const once = trimLine(raw) ?? "";
    expect(trimLine(once)).toBe(once);
  });

  it("returns null for a torn line", () => {
    expect(trimLine('{"id":"e1","pay')).toBeNull();
  });
});
