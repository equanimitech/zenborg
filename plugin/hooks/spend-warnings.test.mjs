import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE_ARGS = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];
const { spendWarning } = await import("./spend-warn.ts");

const spend = (pct, kind = "bet") => ({
  allocations: [
    {
      id: "a",
      name: "Rente",
      kind,
      appetiteDays: 5,
      days: (5 * pct) / 100,
      pct,
    },
  ],
  sessions: { s1: "a" },
});

test("below 70 %: nothing", () =>
  assert.equal(spendWarning(spend(69), "s1", 0), null));
test("70 %: the cut question, once", () => {
  const w = spendWarning(spend(72), "s1", 0);
  assert.equal(w.level, 70);
  assert.match(
    w.text,
    /"Rente".*72 %.*3\.6\/5 d.*what can we cut to land it\?/,
  );
  assert.equal(spendWarning(spend(90), "s1", 70), null);
});
test("100 %: the bet-over instruction, even if 70 was skipped; once", () => {
  const w = spendWarning(spend(100), "s1", 0);
  assert.equal(w.level, 100);
  assert.match(
    w.text,
    /bet is over its appetite.*no new slice.*landing it or parking it/,
  );
  assert.equal(spendWarning(spend(130), "s1", 100), null);
});
test("100 % after 70: still fires", () => {
  assert.equal(spendWarning(spend(101), "s1", 70).level, 100);
});
test("a lane says its appetite is spent for this cycle", () => {
  assert.match(
    spendWarning(spend(100, "lane"), "s1", 0).text,
    /lane's appetite is spent for this cycle/,
  );
});
test("unknown session, no cache, unknown allocation: nothing", () => {
  assert.equal(spendWarning(spend(100), "other", 0), null);
  assert.equal(spendWarning(null, "s1", 0), null);
  assert.equal(
    spendWarning({ allocations: [], sessions: { s1: "gone" } }, "s1", 0),
    null,
  );
});

function vault(cache) {
  const v = mkdtempSync(join(tmpdir(), "zenborg-warn-"));
  mkdirSync(join(v, "cache"));
  if (cache)
    writeFileSync(join(v, "cache", "cycle-spend.json"), JSON.stringify(cache));
  return v;
}
const hook = (v, sid) =>
  execFileSync("node", [...NODE_ARGS, join(HERE, "spend-warnings.mts")], {
    input: JSON.stringify({ session_id: sid, prompt: "hi" }),
    env: { ...process.env, ZENBORG_HOME: v },
    encoding: "utf8",
  });

test("hook: warns once per session, prunes old files, fails open", () => {
  const v = vault(spend(75));
  const dir = join(v, "cache", "spend-warnings");
  mkdirSync(dir);
  writeFileSync(join(dir, "old"), "70");
  const week = Date.now() / 1000 - 8 * 86400;
  utimesSync(join(dir, "old"), week, week);

  const out = JSON.parse(hook(v, "s1"));
  assert.equal(out.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(out.hookSpecificOutput.additionalContext, /what can we cut/);
  assert.equal(hook(v, "s1"), "");
  assert.equal(hook(v, "new-session"), "");
  assert.deepEqual(readdirSync(dir), ["s1"]);

  assert.equal(hook(vault(null), "s1"), ""); // no cache
  assert.equal(hook(v, "../x"), ""); // unsafe id
  assert.ok(!existsSync(join(v, "cache", "x")));
});
