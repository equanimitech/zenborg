#!/usr/bin/env node
import assert from "node:assert/strict";
/**
 * Smoke test: spawn the MCP server against a temp vault, exercise key tools,
 * and print a pass/fail summary. Not a replacement for proper tests; it
 * verifies the happy path wires up end-to-end.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_VAULT_FOLDER, resolveVault } from "./dist/vault.js";

// ── Vault resolution order — must match vault_root() in src-tauri/src/vault/fs.rs.
{
  const saved = {
    z: process.env.ZENBORG_HOME,
    k: process.env.KAIROS_HOME,
  };
  delete process.env.ZENBORG_HOME;
  delete process.env.KAIROS_HOME;

  assert.equal(
    resolveVault([]).root,
    path.join(homedir(), ".zenborg"),
    "default is ~/.zenborg",
  );
  assert.equal(DEFAULT_VAULT_FOLDER, ".zenborg");

  process.env.KAIROS_HOME = "/tmp/legacy-vault";
  assert.equal(
    resolveVault([]).root,
    "/tmp/legacy-vault",
    "legacy KAIROS_HOME env still honoured",
  );

  process.env.ZENBORG_HOME = "/tmp/zenborg-vault";
  assert.equal(
    resolveVault([]).root,
    "/tmp/zenborg-vault",
    "ZENBORG_HOME beats KAIROS_HOME",
  );

  assert.equal(
    resolveVault(["--vault", "/tmp/cli-vault"]).root,
    "/tmp/cli-vault",
    "--vault beats every env var",
  );

  if (saved.z === undefined) delete process.env.ZENBORG_HOME;
  else process.env.ZENBORG_HOME = saved.z;
  if (saved.k === undefined) delete process.env.KAIROS_HOME;
  else process.env.KAIROS_HOME = saved.k;
  console.log("✓ vault resolution order");
}

const vault = mkdtempSync(path.join(tmpdir(), "zenborg-smoke-"));
const child = spawn("node", ["dist/index.js", "--vault", vault], {
  cwd: path.resolve("."),
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => {
  stderr += d.toString();
});

// Reader: parse newline-delimited JSON-RPC responses from stdout
let buf = "";
const pending = new Map(); // id -> { resolve, reject }
child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  for (let idx = buf.indexOf("\n"); idx >= 0; idx = buf.indexOf("\n")) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg);
        pending.delete(msg.id);
      }
    } catch (_e) {
      console.error("parse error on line:", line);
    }
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout on ${method}`));
      }
    }, 5000);
  });
}

function callTool(name, args) {
  return rpc("tools/call", {
    name,
    arguments: { response_format: "full", ...args },
  });
}

function toolText(resp) {
  if (resp.error) return `ERROR: ${JSON.stringify(resp.error)}`;
  const c = resp.result?.content?.[0];
  return c?.text ?? JSON.stringify(resp.result);
}

function parseOk(resp) {
  const t = toolText(resp);
  if (t.startsWith("Error:") || t.startsWith("ERROR:")) {
    throw new Error(t);
  }
  return JSON.parse(t);
}

const results = [];
function step(label, fn) {
  return fn().then(
    (v) => {
      results.push({ label, ok: true, v });
      console.log(`\u2713 ${label}`);
      return v;
    },
    (e) => {
      results.push({ label, ok: false, e: e.message });
      console.log(`\u2717 ${label}: ${e.message}`);
      throw e;
    },
  );
}

try {
  await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  child.stdin.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );

  // 1. list_areas on empty vault → []
  await step("list_areas on empty vault", async () => {
    const resp = await callTool("list_areas", {});
    const list = parseOk(resp);
    if (!Array.isArray(list) || list.length !== 0)
      throw new Error(`expected [], got ${JSON.stringify(list)}`);
  });

  // 2. create_area
  const areaResp = await step("create_area Work", async () => {
    const resp = await callTool("create_area", {
      name: "Work",
      color: "#ff6600",
      emoji: "\ud83d\udcbc",
      order: 0,
    });
    return parseOk(resp);
  });
  const areaId = areaResp.created.id;

  // 3. create_habit under Work
  const habitResp = await step("create_habit Deep Work", async () => {
    const resp = await callTool("create_habit", {
      name: "Deep Work",
      areaId,
      order: 0,
      phase: "MORNING",
    });
    return parseOk(resp);
  });
  const habitId = habitResp.created.id;

  // 4. plan_cycle
  const cycleResp = await step("plan_cycle Sprint 1", async () => {
    const resp = await callTool("plan_cycle", {
      name: "Sprint 1",
      startDate: "2026-04-20",
      endDate: "2026-05-04",
    });
    return parseOk(resp);
  });
  const cycleId = cycleResp.created.id;

  // 5. Write a cycle plan directly to the vault (simulates what the app's CycleDeck does).
  //    budget_habit_to_cycle was removed from the MCP surface — plans are app-authored.
  const planId = crypto.randomUUID();
  await step("write cycle plan to vault (app-side simulation)", async () => {
    const now = new Date().toISOString();
    const plan = {
      [planId]: {
        id: planId,
        cycleId,
        habitId,
        budgetedCount: 5,
        createdAt: now,
        updatedAt: now,
      },
    };
    writeFileSync(path.join(vault, "cyclePlans.json"), JSON.stringify(plan));
  });

  // 5a. get_running_cycle — no active cycle (Sprint 1 dates are in the past)
  await step("get_running_cycle with no active cycle", async () => {
    const parsed = parseOk(await callTool("get_running_cycle", {}));
    if (parsed.running !== null)
      throw new Error(
        `expected null running cycle, got ${JSON.stringify(parsed.running)}`,
      );
  });

  // 5b. allocate_from_plan — materialize a plan-linked moment on a day/phase
  let planLinkedMomentId = null;
  await step("allocate_from_plan 2026-04-22 MORNING", async () => {
    const resp = await callTool("allocate_from_plan", {
      cycleId,
      habitId,
      day: "2026-04-22",
      phase: "MORNING",
    });
    const parsed = parseOk(resp);
    const m = parsed.allocated ?? parsed.created;
    if (!m || !m.id)
      throw new Error(
        `expected allocated moment, got ${JSON.stringify(parsed)}`,
      );
    if (m.day !== "2026-04-22")
      throw new Error(`expected day 2026-04-22, got ${m.day}`);
    if (m.phase !== "MORNING")
      throw new Error(`expected phase MORNING, got ${m.phase}`);
    if (!m.cyclePlanId)
      throw new Error(`expected cyclePlanId set, got ${m.cyclePlanId}`);
    if (m.habitId !== habitId)
      throw new Error(`expected habitId ${habitId}, got ${m.habitId}`);
    // Verify written to vault
    const momentsFile = JSON.parse(
      readFileSync(path.join(vault, "moments.json"), "utf8"),
    );
    if (!momentsFile[m.id])
      throw new Error(`moment ${m.id} not written to vault`);
    if (momentsFile[m.id].cyclePlanId !== m.cyclePlanId)
      throw new Error(`vault cyclePlanId mismatch`);
    planLinkedMomentId = m.id;
  });

  // 5c. unallocate_moment — derive paradigm: deletes the plan-linked row entirely
  await step("unallocate_moment deletes plan-linked row", async () => {
    const resp = await callTool("unallocate_moment", {
      id: planLinkedMomentId,
    });
    parseOk(resp);
    const momentsFile = JSON.parse(
      readFileSync(path.join(vault, "moments.json"), "utf8"),
    );
    if (momentsFile[planLinkedMomentId]) {
      throw new Error(
        `moment ${planLinkedMomentId} still present after unallocate_moment`,
      );
    }
  });

  // 5d. unallocate_moment rejects spontaneous moments
  await step("unallocate_moment rejects spontaneous", async () => {
    const spawn = await callTool("spawn_spontaneous_from_habit", {
      habitId,
      day: "2026-04-23",
      phase: "MORNING",
    });
    const spawned = parseOk(spawn);
    const spontaneousId = spawned.created.id;
    const resp = await callTool("unallocate_moment", { id: spontaneousId });
    const text = toolText(resp);
    if (!text.toLowerCase().includes("spontaneous")) {
      throw new Error(`expected spontaneous rejection, got: ${text}`);
    }
    // Should still be present in vault
    const momentsFile = JSON.parse(
      readFileSync(path.join(vault, "moments.json"), "utf8"),
    );
    if (!momentsFile[spontaneousId]) {
      throw new Error(`spontaneous ${spontaneousId} should NOT be deleted`);
    }
    // Clean up so later phase-cap + archive assertions line up
    await callTool("delete_moment", { id: spontaneousId });
  });

  // 6. spawn_spontaneous_from_habit
  await step("spawn_spontaneous_from_habit today MORNING", async () => {
    const resp = await callTool("spawn_spontaneous_from_habit", {
      habitId,
      day: "2026-04-21",
      phase: "MORNING",
    });
    return parseOk(resp);
  });

  // 7. list_moments (allocated)
  await step("list_moments allocated", async () => {
    const resp = await callTool("list_moments", {
      filter: { allocation: "allocated" },
      response_format: "full",
    });
    const envelope = parseOk(resp);
    // Only the spontaneous moment from step 6 remains (plan-linked was unallocated in 5c).
    if (envelope.items.length !== 1)
      throw new Error(`expected 1 allocated, got ${envelope.items.length}`);
  });

  // 8. Phase cap is a day-view display concern: allocation past 3 succeeds and
  //    reports `dayViewOverflow` instead of erroring.
  await step("phase overflow reported, not blocked", async () => {
    // Already 1 allocated. Add 2 more, then a 4th which overflows the day view.
    await callTool("spawn_spontaneous_from_habit", {
      habitId,
      day: "2026-04-21",
      phase: "MORNING",
    });
    await callTool("spawn_spontaneous_from_habit", {
      habitId,
      day: "2026-04-21",
      phase: "MORNING",
    });
    const resp = await callTool("spawn_spontaneous_from_habit", {
      habitId,
      day: "2026-04-21",
      phase: "MORNING",
    });
    const payload = parseOk(resp);
    if (!payload.created)
      throw new Error(
        `expected the 4th moment to be created, got: ${toolText(resp)}`,
      );
    if (payload.created.order !== 3)
      throw new Error(`expected order 3, got ${payload.created.order}`);
    if (!payload.dayViewOverflow || payload.dayViewOverflow.count !== 4) {
      throw new Error(
        `expected dayViewOverflow count 4, got: ${toolText(resp)}`,
      );
    }
  });

  // 8a. wateringHoursAdvisory: a garden-scoped watering-hours rule surfaces an
  // advisory on add_moment/update_moment for the restricted area — never a
  // refusal. fromHour: 0, toHour: 0 wraps to "always in window", so this
  // doesn't depend on the clock. Exercises both response_format paths since
  // the advisory is threaded through `concise` separately from `full`.
  await step(
    "wateringHoursAdvisory on add_moment and update_moment",
    async () => {
      // declareWateringHours requires a season covering *today* (real wall
      // clock) — Sprint 1 above covers the fictional 2026-04 dates the rest of
      // this script plants moments on, not today. A short-lived real-today
      // cycle satisfies that without disturbing Sprint 1's date range.
      const today = new Date();
      const iso = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const seasonId = parseOk(
        await callTool("plan_cycle", {
          name: "watering-hours smoke season",
          startDate: iso(today),
          endDate: iso(tomorrow),
        }),
      ).created.id;

      const declared = parseOk(
        await callTool("set_watering_hours", {
          name: "smoke-watering",
          mode: "regular",
          window: { fromHour: 0, toHour: 0 },
          waters: [areaId],
          restricts: { areas: [areaId] },
        }),
      );
      if (!declared.declared?.length)
        throw new Error(`expected set_watering_hours to declare a rule`);

      const created = parseOk(
        await callTool("add_moment", {
          name: "Advisory Test",
          areaId,
          day: "2026-04-23",
          phase: "EVENING",
          response_format: "concise",
        }),
      );
      if (!created.wateringHoursAdvisory) {
        throw new Error(
          `expected add_moment (concise) to carry wateringHoursAdvisory, got: ${JSON.stringify(created)}`,
        );
      }

      const updated = parseOk(
        await callTool("update_moment", {
          id: created.id,
          order: 0,
          response_format: "full",
        }),
      );
      if (!updated.wateringHoursAdvisory) {
        throw new Error(
          `expected update_moment (full) to carry wateringHoursAdvisory, got: ${JSON.stringify(updated)}`,
        );
      }

      await callTool("delete_moment", { id: created.id });
      await callTool("clear_fence", { policy: "smoke-watering" });
      await callTool("delete_cycle", { id: seasonId });
    },
  );

  // 8b. Habit schedules: additive, reconciled against rhythm and phase.
  await step(
    "habit schedule fills rhythm + phase and is inherited by moments",
    async () => {
      const created = parseOk(
        await callTool("create_habit", {
          name: "singing",
          areaId,
          order: 9,
          schedule: { weekdays: ["MON"], startTime: "14:00", durationMin: 60 },
        }),
      ).created;
      if (created.schedule.startTime !== "14:00")
        throw new Error("schedule not stored");
      if (created.rhythm?.period !== "weekly" || created.rhythm.count !== 1) {
        throw new Error(
          `expected derived weekly rhythm, got ${JSON.stringify(created.rhythm)}`,
        );
      }

      const conflict = toolText(
        await callTool("update_habit", {
          id: created.id,
          rhythm: { period: "weekly", count: 3 },
        }),
      );
      if (!conflict.startsWith("Error:"))
        throw new Error(`expected rhythm conflict, got: ${conflict}`);

      const spawned = parseOk(
        await callTool("spawn_spontaneous_from_habit", {
          habitId: created.id,
          day: "2026-04-22",
          phase: "AFTERNOON",
        }),
      ).created;
      if (spawned.startTime !== "14:00" || spawned.durationMin !== 60) {
        throw new Error(
          `expected inherited timing, got ${JSON.stringify(spawned)}`,
        );
      }

      const overridden = parseOk(
        await callTool("update_moment", { id: spawned.id, startTime: "14:15" }),
      ).updated;
      if (overridden.startTime !== "14:15")
        throw new Error("per-instance override failed");
    },
  );

  // 9. archive_habit — derive paradigm: plans deleted, allocated moments preserved
  await step(
    "archive_habit keeps allocated moments, deletes plans",
    async () => {
      // Snapshot moments with this habitId before archiving.
      const momentsBefore = JSON.parse(
        readFileSync(path.join(vault, "moments.json"), "utf8"),
      );
      const allocatedBefore = Object.values(momentsBefore).filter(
        (m) => m.habitId === habitId && m.day !== null && m.phase !== null,
      );
      if (allocatedBefore.length === 0) {
        throw new Error(
          "precondition: expected at least one allocated moment for habit",
        );
      }

      const resp = await callTool("archive_habit", { id: habitId });
      const parsed = parseOk(resp);
      if (parsed.deletedPlans !== 1)
        throw new Error(`expected 1 plan deleted, got ${parsed.deletedPlans}`);
      // New semantics: moments are NOT deleted; the response no longer reports deletedMoments.
      if ("deletedMoments" in parsed) {
        throw new Error(
          `archive_habit must not report deletedMoments, got ${JSON.stringify(parsed)}`,
        );
      }

      // Verify vault: every allocated moment for this habit still exists.
      const momentsAfter = JSON.parse(
        readFileSync(path.join(vault, "moments.json"), "utf8"),
      );
      for (const m of allocatedBefore) {
        if (!momentsAfter[m.id]) {
          throw new Error(
            `allocated moment ${m.id} was deleted by archive_habit (should survive)`,
          );
        }
        if (momentsAfter[m.id].habitId !== habitId) {
          throw new Error(
            `moment ${m.id} habitId was altered by archive_habit`,
          );
        }
      }

      // Plans for this habit must be gone.
      const plansAfter = JSON.parse(
        readFileSync(path.join(vault, "cyclePlans.json"), "utf8"),
      );
      for (const p of Object.values(plansAfter)) {
        if (p.habitId === habitId) {
          throw new Error(`plan ${p.id} for archived habit still present`);
        }
      }
    },
  );

  // 10. delete_cycle cascade
  await step("delete_cycle cascade", async () => {
    const resp = await callTool("delete_cycle", { id: cycleId });
    return parseOk(resp);
  });

  // 10b. get_running_cycle with an active cycle
  await step("get_running_cycle with active cycle", async () => {
    const today = new Date();
    const startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
    const endDay = new Date(today);
    endDay.setDate(endDay.getDate() + 7);
    const endDate = `${endDay.getFullYear()}-${String(endDay.getMonth() + 1).padStart(2, "0")}-${String(endDay.getDate()).padStart(2, "0")}`;
    const resp = await callTool("plan_cycle", {
      name: "Active Season",
      startDate,
      endDate,
      intention: "test the running cycle tool",
      response_format: "full",
    });
    const created = parseOk(resp);
    const parsed = parseOk(
      await callTool("get_running_cycle", { response_format: "full" }),
    );
    if (!parsed.running)
      throw new Error(
        `expected a running cycle, got: ${JSON.stringify(parsed).slice(0, 200)}`,
      );
    if (parsed.running.name !== "Active Season")
      throw new Error(`expected "Active Season", got "${parsed.running.name}"`);
    if (parsed.running.intention !== "test the running cycle tool")
      throw new Error("intention mismatch");
    if (typeof parsed.running.daysElapsed !== "number")
      throw new Error("missing daysElapsed");
    if (!Array.isArray(parsed.habits)) throw new Error("missing habits array");
    if (!Array.isArray(parsed.wilting))
      throw new Error("missing wilting array");
    // Clean up
    await callTool("delete_cycle", { id: created.created.id });
  });

  // 11. Active moment — the intention pointer keel reads.
  //     The waking-day rolls at 04:00 here exactly as it does in keel, so the
  //     day these assertions target is computed the same way, not from the clock.
  const wakingDay = (() => {
    const d = new Date(Date.now() - 4 * 3600_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  await step("get_active_moment on empty vault → null", async () => {
    const parsed = parseOk(await callTool("get_active_moment", {}));
    if (parsed.active !== null)
      throw new Error(`expected null, got ${JSON.stringify(parsed)}`);
  });

  const todayMoment = await step(
    "create a moment on today for the pointer",
    async () => {
      const resp = await callTool("create_standalone_moment", {
        name: "ship export",
        areaId,
        day: wakingDay,
        phase: "MORNING",
      });
      return parseOk(resp).created;
    },
  );

  await step("set_active_moment by name resolves today's board", async () => {
    const parsed = parseOk(
      await callTool("set_active_moment", { momentIdOrName: "ship export" }),
    );
    if (parsed.set.momentId !== todayMoment.id) {
      throw new Error(
        `pointed at ${parsed.set.momentId}, expected ${todayMoment.id}`,
      );
    }
    if (parsed.set.active !== true)
      throw new Error("expected active:true for a moment on today");
    if (parsed.set.area?.name !== "Work")
      throw new Error(
        `expected area Work, got ${JSON.stringify(parsed.set.area)}`,
      );
    // The pointer must be on disk in the shape keel parses.
    const onDisk = JSON.parse(
      readFileSync(path.join(vault, "activeMoment.json"), "utf8"),
    );
    if (onDisk.momentId !== todayMoment.id)
      throw new Error("activeMoment.json momentId mismatch");
    if (typeof onDisk.at !== "string" || !onDisk.at)
      throw new Error("activeMoment.json missing `at`");
  });

  // ── places ──────────────────────────────────────────────────────────
  // The round trip that matters: a label goes in, an entity key comes back,
  // and clearing leaves the key absent rather than holding an empty list.

  await step(
    "create_standalone_moment slugs a pasted place label",
    async () => {
      const created = parseOk(
        await callTool("create_standalone_moment", {
          name: "morning coffee",
          areaId,
          day: wakingDay,
          phase: "MORNING",
          placeIds: ["Ávalon Café", "Avalon"],
          placeUrl: "https://maps.example/avalon",
        }),
      ).created;
      const got = JSON.stringify(created.placeIds);
      if (got !== JSON.stringify(["avalon-cafe", "avalon"]))
        throw new Error(`expected slugged keys, got ${got}`);
      if (created.placeUrl !== "https://maps.example/avalon")
        throw new Error("placeUrl did not round-trip verbatim");
      return created;
    },
  );

  await step("a moment with no place carries neither key", async () => {
    const created = parseOk(
      await callTool("create_standalone_moment", {
        name: "quiet sit",
        areaId,
        day: wakingDay,
        phase: "EVENING",
      }),
    ).created;
    if ("placeIds" in created || "placeUrl" in created)
      throw new Error(
        "absent, never empty — an unplaced moment carries no key",
      );
  });

  await step("update_moment clears placeIds with an empty list", async () => {
    const created = parseOk(
      await callTool("create_standalone_moment", {
        name: "lunch out",
        areaId,
        day: wakingDay,
        phase: "AFTERNOON",
        placeIds: ["Atlantis"],
      }),
    ).created;
    const updated = parseOk(
      await callTool("update_moment", { id: created.id, placeIds: [] }),
    ).updated;
    if ("placeIds" in updated)
      throw new Error("an empty replacement must delete the key, not store []");
  });

  await step("update_moment clears placeUrl with null", async () => {
    const created = parseOk(
      await callTool("create_standalone_moment", {
        name: "book shop",
        areaId,
        day: wakingDay,
        phase: "AFTERNOON",
        placeUrl: "https://maps.example/arcadia",
      }),
    ).created;
    const updated = parseOk(
      await callTool("update_moment", { id: created.id, placeUrl: null }),
    ).updated;
    if ("placeUrl" in updated) throw new Error("null must delete placeUrl");
  });

  await step("a placeUrl that is not a URL is refused", async () => {
    const text = toolText(
      await callTool("create_standalone_moment", {
        name: "vague place",
        areaId,
        day: wakingDay,
        phase: "MORNING",
        placeUrl: "the cafe on the corner",
      }),
    );
    if (!text.startsWith("Error:"))
      throw new Error(`expected refusal, got: ${text}`);
  });

  await step(
    "list_people_to_reach is an empty queue, not an error",
    async () => {
      const parsed = parseOk(await callTool("list_people_to_reach", {}));
      if (!Array.isArray(parsed) || parsed.length !== 0)
        throw new Error(`expected [], got ${JSON.stringify(parsed)}`);
    },
  );

  await step("get_active_moment resolves the pointer", async () => {
    const parsed = parseOk(await callTool("get_active_moment", {}));
    if (parsed.active?.moment?.name !== "ship export") {
      throw new Error(
        `expected "ship export", got ${JSON.stringify(parsed.active)}`,
      );
    }
  });

  await step("set_active_moment refuses a moment not on today", async () => {
    const other = parseOk(
      await callTool("create_standalone_moment", {
        name: "next week thing",
        areaId,
        day: "2027-01-04",
        phase: "MORNING",
      }),
    ).created;
    const text = toolText(
      await callTool("set_active_moment", { momentIdOrName: other.id }),
    );
    if (!text.startsWith("Error:"))
      throw new Error(`expected refusal, got: ${text}`);
    // The existing pointer must survive a rejected set.
    const onDisk = JSON.parse(
      readFileSync(path.join(vault, "activeMoment.json"), "utf8"),
    );
    if (onDisk.momentId !== todayMoment.id)
      throw new Error("rejected set clobbered the pointer");
  });

  await step(
    "set_active_moment reports an unknown name with the board",
    async () => {
      const text = toolText(
        await callTool("set_active_moment", { momentIdOrName: "not a thing" }),
      );
      if (!text.startsWith("Error:"))
        throw new Error(`expected refusal, got: ${text}`);
      if (!text.includes("ship export"))
        throw new Error(`expected the board listed, got: ${text}`);
    },
  );

  await step("clear_active_moment removes the pointer", async () => {
    parseOk(await callTool("clear_active_moment", {}));
    if (existsSync(path.join(vault, "activeMoment.json"))) {
      throw new Error("activeMoment.json still present after clear");
    }
    const parsed = parseOk(await callTool("get_active_moment", {}));
    if (parsed.active !== null) throw new Error("expected null after clear");
  });

  await step(
    "a deleted moment leaves the pointer stale, not fatal",
    async () => {
      parseOk(
        await callTool("set_active_moment", { momentIdOrName: todayMoment.id }),
      );
      parseOk(await callTool("delete_moment", { id: todayMoment.id }));
      const parsed = parseOk(await callTool("get_active_moment", {}));
      if (parsed.active !== null || !parsed.released?.reason) {
        throw new Error(
          `expected released pointer, got ${JSON.stringify(parsed)}`,
        );
      }
    },
  );

  await step("a pointer to another day reads as released", async () => {
    const other = parseOk(
      await callTool("create_standalone_moment", {
        name: "old news",
        areaId,
        day: "2000-01-01",
        phase: "MORNING",
      }),
    ).created;
    writeFileSync(
      path.join(vault, "activeMoment.json"),
      JSON.stringify({ momentId: other.id, at: new Date().toISOString() }),
    );
    const parsed = parseOk(await callTool("get_active_moment", {}));
    if (parsed.active !== null || parsed.released?.name !== "old news") {
      throw new Error(`expected released, got ${JSON.stringify(parsed)}`);
    }
    if (!existsSync(path.join(vault, "activeMoment.json")))
      throw new Error("a read must not clear the pointer");
  });

  // ── People CRUD ──

  let elias;
  await step("create_person adds a person to the registry", async () => {
    const res = parseOk(
      await callTool("create_person", {
        name: "Elias",
        cadence: "monthly",
        category: "friend",
        basePlace: "sp",
        emoji: "🧑",
      }),
    );
    elias = res.created;
    assert.equal(elias.key, "elias");
    assert.equal(elias.cadence, "monthly");
  });

  await step("get_person finds by key", async () => {
    const res = parseOk(await callTool("get_person", { idOrKey: "elias" }));
    assert.equal(res.id, elias.id);
  });

  // ── Season intentions ──

  await step("update_cycle persists areaIntentions and people", async () => {
    const cycleId = parseOk(
      await callTool("plan_cycle", {
        name: "Intentions",
        startDate: "2026-01-01",
        endDate: "2026-01-08",
      }),
    ).created.id;
    const res = parseOk(
      await callTool("update_cycle", {
        id: cycleId,
        areaIntentions: { [areaId]: "ship the small thing" },
        people: { [elias.id]: "" },
      }),
    );
    // a record id is normalised to the person key
    assert.deepEqual(Object.keys(res.updated.people), [elias.key]);
    assert.deepEqual(res.updated.areaIntentions, {
      [areaId]: "ship the small thing",
    });
    assert.deepEqual(res.updated.people, { [elias.key]: "" });
    const onDisk = JSON.parse(
      readFileSync(path.join(vault, "cycles.json"), "utf8"),
    );
    assert.equal(onDisk[cycleId].areaIntentions[areaId], "ship the small thing");
    assert.deepEqual(onDisk[cycleId].people, { [elias.key]: "" });
    const byKey = parseOk(
      await callTool("update_cycle", {
        id: cycleId,
        people: { [elias.key]: "weekly call" },
      }),
    );
    assert.deepEqual(byKey.updated.people, { [elias.key]: "weekly call" });
  });

  await step("update_cycle rejects unknown ids and long text", async () => {
    const cycleId = Object.keys(
      JSON.parse(readFileSync(path.join(vault, "cycles.json"), "utf8")),
    )[0];
    const bad = toolText(
      await callTool("update_cycle", {
        id: cycleId,
        areaIntentions: { "no-such-area": "hello" },
      }),
    );
    assert.ok(bad.startsWith("Error:") && bad.includes("no-such-area"), bad);
    const badPerson = toolText(
      await callTool("update_cycle", {
        id: cycleId,
        people: { "no-such-person": "" },
      }),
    );
    assert.ok(
      badPerson.startsWith("Error:") && badPerson.includes("no-such-person"),
      badPerson,
    );
    const long = toolText(
      await callTool("update_cycle", {
        id: cycleId,
        areaIntentions: { [areaId]: "a b c d e f g h i j k l m" },
      }),
    );
    assert.ok(long.startsWith("Error:"), long);
  });

  await step("get_running_cycle resolves intention names", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const live = parseOk(
      await callTool("plan_cycle", {
        name: "Live season",
        startDate: today,
        areaIntentions: { [areaId]: "ship the small thing" },
        people: { [elias.key]: "monthly call" },
      }),
    ).created;
    const running = parseOk(await callTool("get_running_cycle", {})).running;
    assert.equal(running.areaIntentions[0].areaName, "Work");
    assert.equal(running.people[0].personKey, elias.key);
    assert.equal(running.people[0].personName, "Elias");
    assert.equal(running.people[0].text, "monthly call");
    await callTool("delete_cycle", { id: live.id });
  });

  await step("create_person rejects duplicate key", async () => {
    const resp = await callTool("create_person", { name: "Elias" });
    const t = toolText(resp);
    assert.ok(t.startsWith("Error:"), "expected error for duplicate key");
  });

  await step("update_person changes fields", async () => {
    const res = parseOk(
      await callTool("update_person", {
        idOrKey: "elias",
        cadence: "weekly",
        tags: ["close-friend"],
      }),
    );
    assert.equal(res.updated.cadence, "weekly");
    assert.deepEqual(res.updated.tags, ["close-friend"]);
  });

  await step("list_people returns the registry", async () => {
    const res = parseOk(await callTool("list_people", {}));
    assert.equal(res.length, 1);
    assert.equal(res[0].key, "elias");
  });

  await step("delete_person removes from registry", async () => {
    const res = parseOk(await callTool("delete_person", { idOrKey: "elias" }));
    assert.equal(res.deleted.key, "elias");
    const list = parseOk(await callTool("list_people", {}));
    assert.equal(list.length, 0);
  });

  // ── Places CRUD ──

  let sohoHouse;
  await step("create_place adds a place to the registry", async () => {
    const res = parseOk(
      await callTool("create_place", {
        name: "Soho House",
        parentKey: "sp",
        emoji: "🏠",
        url: "https://maps.app.goo.gl/sohohouse",
      }),
    );
    sohoHouse = res.created;
    assert.equal(sohoHouse.key, "soho-house");
    assert.equal(sohoHouse.parentKey, "sp");
  });

  await step("get_place finds by key", async () => {
    const res = parseOk(await callTool("get_place", { idOrKey: "soho-house" }));
    assert.equal(res.id, sohoHouse.id);
  });

  await step("update_place changes fields", async () => {
    const res = parseOk(
      await callTool("update_place", {
        idOrKey: "soho-house",
        emoji: "🏡",
      }),
    );
    assert.equal(res.updated.emoji, "🏡");
    assert.equal(res.updated.key, "soho-house");
  });

  await step("list_places returns the registry", async () => {
    const res = parseOk(await callTool("list_places", {}));
    assert.equal(res.length, 1);
    assert.equal(res[0].key, "soho-house");
  });

  await step("delete_place removes from registry", async () => {
    const res = parseOk(
      await callTool("delete_place", { idOrKey: "soho-house" }),
    );
    assert.equal(res.deleted.key, "soho-house");
  });

  // ── Mention ──

  await step("mention resolves people and places on a moment", async () => {
    parseOk(
      await callTool("create_person", { name: "Ada", category: "friend" }),
    );
    parseOk(await callTool("create_place", { name: "Cafe Lab" }));
    const mentionMoment = parseOk(
      await callTool("create_standalone_moment", {
        name: "coffee",
        areaId,
        day: wakingDay,
        phase: "MORNING",
      }),
    );
    const res = parseOk(
      await callTool("mention", {
        momentId: mentionMoment.created.id,
        entities: ["ada", "cafe-lab", "unknown-entity"],
      }),
    );
    assert.deepEqual(res.addedPeople, ["ada"]);
    assert.deepEqual(res.addedPlaces, ["cafe-lab"]);
    assert.deepEqual(res.unresolved, ["unknown-entity"]);
    assert.ok(res.updated.personIds.includes("ada"));
    assert.ok(res.updated.placeIds.includes("cafe-lab"));
  });

  console.log("\n--- vault files ---");
  const files = [
    "areas.json",
    "habits.json",
    "cycles.json",
    "cyclePlans.json",
    "moments.json",
    "people.json",
    "places.json",
  ];
  for (const f of files) {
    const p = path.join(vault, f);
    if (existsSync(p)) {
      const parsed = JSON.parse(readFileSync(p, "utf8"));
      console.log(`${f}: ${Object.keys(parsed).length} entries`);
    }
  }
} catch (e) {
  console.error("\nFAIL:", e.message);
  console.error("stderr tail:", stderr.split("\n").slice(-10).join("\n"));
  process.exitCode = 1;
} finally {
  child.kill();
  rmSync(vault, { recursive: true, force: true });
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} passed`);
}
