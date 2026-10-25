import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE_ARGS = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
  "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
];
const { wakingDayKey } = await import("../domain/attention/ActiveMoment.ts");

/** A vault whose phase bands cover the whole day, with one moment on `day`
 * and the active pointer aimed at it. */
function garden(day) {
  const vault = mkdtempSync(join(tmpdir(), "zenborg-aware-"));
  const put = (name, v) => writeFileSync(join(vault, name), JSON.stringify(v));
  put("phaseConfigs.json", {
    p: { phase: "ALL", label: "All day", startHour: 0, endHour: 24 },
  });
  put("moments.json", { m1: { id: "m1", name: "write spec", day, phase: "ALL" } });
  put("activeMoment.json", { momentId: "m1", at: new Date().toISOString() });
  return vault;
}

const run = (vault) =>
  execFileSync("node", [...NODE_ARGS, join(HERE, "moment-awareness.mts")], {
    input: "",
    env: { ...process.env, ZENBORG_HOME: vault },
    encoding: "utf8",
  });

test("an active moment on today is reported as active", () => {
  const out = run(garden(wakingDayKey()));
  assert.match(out, /active "write spec"/);
});

test("a stale pointer is released, never cleared, and not proposed for clearing", () => {
  const vault = garden("2000-01-01");
  const before = readFileSync(join(vault, "activeMoment.json"), "utf8");
  const out = run(vault);
  assert.match(out, /Stale active moment "write spec" released/);
  assert.match(out, /No active intention/);
  assert.doesNotMatch(out, /clear_active_moment/);
  assert.equal(readFileSync(join(vault, "activeMoment.json"), "utf8"), before);
});

test("the vendored staleness rule is byte-identical to src/domain", () => {
  const rel = "domain/attention/ActiveMoment.ts";
  assert.equal(
    readFileSync(join(HERE, "..", rel), "utf8"),
    readFileSync(join(HERE, "../../src", rel), "utf8"),
  );
});
