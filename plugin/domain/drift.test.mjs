import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// A sibling checkout, which exists on a development machine and never on an
// installed one. The check is for whoever could introduce the drift.
const SOURCE = join(HERE, "../../../../zenborg/src/domain");

function tsFiles(root) {
  const out = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") out.push(...tsFiles(p));
    } else if (name.endsWith(".ts")) out.push(p);
  }
  return out.sort();
}

test(
  "the vendored slice has not drifted from zenborg",
  { skip: !existsSync(SOURCE) },
  () => {
    for (const copy of tsFiles(HERE)) {
      const original = join(SOURCE, relative(HERE, copy));
      assert.ok(
        existsSync(original),
        `${relative(HERE, copy)} has no original in zenborg`,
      );
      assert.equal(
        readFileSync(copy, "utf8"),
        readFileSync(original, "utf8"),
        `${relative(HERE, copy)} differs from zenborg's copy. Reconcile deliberately, then update domain/README.md.`,
      );
    }
  },
);

// The in-repo original. The sibling-checkout check above predates the plugin
// moving into this repo; this one pins the file the fence hook imports.
const IN_REPO = join(HERE, "../../src/domain/attention/Discrepancy.ts");

test(
  "Discrepancy.ts is byte-identical to src/domain",
  { skip: !existsSync(IN_REPO) },
  () => {
    assert.equal(
      readFileSync(join(HERE, "attention/Discrepancy.ts"), "utf8"),
      readFileSync(IN_REPO, "utf8"),
    );
  },
);
