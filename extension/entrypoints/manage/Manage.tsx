/**
 * The manage page — a fence dashboard.
 *
 * Three sections: the fences table (what is standing, its type, its exit),
 * area-map assignment, and activity-log export. Everything
 * here is read-mostly: the only writes this page performs are `setArea`
 * (native-messaging, may fail silently — see `handleAssign`) and the local
 * export download. All authoring — declaring or retiring a fence — happens
 * in Claude/MCP, not here.
 *
 * History (runs, areas, breakdowns) and manual watchlist management, which
 * this page used to carry, are both retired: history moves to zenborg
 * harvest, and observe is now derived from fences ∪ area-map rather than
 * hand-maintained.
 */

import { useEffect, useState } from "react";
import { fenceCache, fenceRefusals } from "@/modules/fence/store";
import { exitLine } from "@/modules/fence/parse";
import type { Fence, Fences, Refusal } from "@/modules/fence/types";
import { areas as areasStore, areaMap as areaMapStore, pageTransforms, type AreaInfo, type PageTransform } from "@/modules/friction/policy/store";
import { queryEvents, setArea } from "@/modules/relay/client";
import { readAllEvents } from "@/modules/activity/log";
import { toJsonl, exportFileName, startOfLocalDay } from "@/modules/activity/events";
import { readEventsSince } from "@/modules/activity/log";
import { mergeById, tallyDeliveries, type DeliveryRow } from "@/modules/fence/deliveries";
import { dayKey, gateCrossings } from "@/modules/friction/gate/decide";
import { crossingsOf, rungIndex } from "@/modules/friction/gate/ladder";

function fenceTypeLabel(fence: Fence): string {
  if (fence.enforcement.kind === "block") {
    return fence.enforcement.standing ? "standing block" : "timed block";
  }
  return fence.enforcement.kind;
}

function fenceTypeBadge(fence: Fence): string {
  switch (fence.enforcement.kind) {
    case "block":
      return fence.enforcement.standing ? "🔒" : "⏳";
    case "gate":
      return "⏱";
    default:
      return "🛡";
  }
}

export function Manage() {
  const [fences, setFences] = useState<Fences>({});
  const [transforms, setTransforms] = useState<readonly PageTransform[]>([]);
  const [refused, setRefused] = useState<readonly Refusal[]>([]);
  const [allAreas, setAllAreas] = useState<readonly AreaInfo[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [newDomain, setNewDomain] = useState("");
  const [partial, setPartial] = useState(false);
  const [deliveries, setDeliveries] = useState<readonly (DeliveryRow & { rung: number })[]>([]);

  useEffect(() => {
    // Today's deliveries: local log + today's crossings. Read once on open.
    void (async () => {
      const now = Date.now();
      const since = startOfLocalDay(now);
      const [hostEvents, outbox, crossings, fenceMap] = await Promise.all([
        queryEvents(since),
        readEventsSince(since),
        gateCrossings.getValue(),
        fenceCache.getValue(),
      ]);
      // queryEvents answers [] when the host is unreachable; a reachable host always
      // holds today's writer_started, so empty means the counts are outbox-only.
      setPartial(hostEvents.length === 0);
      const events = mergeById(hostEvents, outbox);
      setDeliveries(
        tallyDeliveries(events).map((row) => ({
          ...row,
          rung: rungIndex(fenceMap[row.ruleId]?.rungs?.length ?? 1, crossingsOf(crossings, dayKey(now), row.ruleId)),
        }))
      );
    })();
    fenceCache.getValue().then(setFences);
    pageTransforms.getValue().then(setTransforms);
    fenceRefusals.getValue().then(setRefused);
    areasStore.getValue().then(setAllAreas);
    areaMapStore.getValue().then(setMap);

    const unwatchFences = fenceCache.watch((v) => {
      if (v) { setFences(v); }
    });
    const unwatchTransforms = pageTransforms.watch((v) => {
      if (v) { setTransforms(v); }
    });
    return () => {
      unwatchFences();
      unwatchTransforms();
    };
  }, []);

  const fenceList = Object.values(fences);

  const handleAssign = async (domain: string, areaId: string): Promise<void> => {
    // Optimistic: the picker reflects the choice immediately. `setArea` relays
    // over native messaging and may fail silently (host unreachable) — the
    // mirror still reflects the intent, and the host's own policy push is the
    // eventual source of truth if the two disagree.
    const next = { ...map };
    if (areaId === "") {
      delete next[domain];
    } else {
      next[domain] = areaId;
    }
    setMap(next);
    await setArea(domain, areaId);
  };

  const handleExport = async (): Promise<void> => {
    const events = await readAllEvents();
    const jsonl = toJsonl(events);
    const blob = new Blob([jsonl], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = exportFileName(Date.now());
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="manage-root">
      <h1 className="manage-title">zenborg — dashboard</h1>

      {/* Fences table */}
      <section className="manage-section">
        <h2 className="manage-section-title">Fences</h2>
        {fenceList.length === 0 ? (
          <p className="manage-empty">No fences declared.</p>
        ) : (
          <table className="manage-fence-table">
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Type</th>
                <th>Domains</th>
                <th>Exit</th>
              </tr>
            </thead>
            <tbody>
              {fenceList.map((f) => (
                <tr key={f.id}>
                  <td>{fenceTypeBadge(f)}</td>
                  <td>{f.label}</td>
                  <td className="manage-type">{fenceTypeLabel(f)}</td>
                  <td className="manage-domains">{f.domains.join(", ")}</td>
                  <td className="manage-exit">{exitLine(f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {refused.length > 0 && (
          <details className="manage-refused">
            <summary>{refused.length} fence(s) refused</summary>
            <ul>
              {refused.map((r) => (
                <li key={r.id}>
                  {r.id}: {r.reason}
                </li>
              ))}
            </ul>
          </details>
        )}

        {/* Transforms — CSS hiding rules, travel through the policy mirror */}
        {transforms.length > 0 && (
          <>
            <h3 className="manage-subsection-title">Transforms (CSS hiding)</h3>
            <table className="manage-fence-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Domains</th>
                  <th>Selector</th>
                </tr>
              </thead>
              <tbody>
                {transforms.map((t) => (
                  <tr key={t.ruleId}>
                    <td>🛡</td>
                    <td>{t.ruleId}</td>
                    <td className="manage-domains">{t.domains.join(", ")}</td>
                    <td className="manage-exit" title={t.targets.primary}>{t.targets.primary.slice(0, 40)}{t.targets.primary.length > 40 ? "…" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* Today's deliveries — neutral counts from the local log */}
      <section className="manage-section">
        <h2 className="manage-section-title">Today's deliveries</h2>
        {partial && <p className="manage-hint">Host unreachable: counts are partial (unflushed events only).</p>}
        {deliveries.length === 0 ? (
          <p className="manage-empty">No decision points today.</p>
        ) : (
          <table className="manage-fence-table">
            <thead>
              <tr>
                <th>Rule</th>
                <th>Points</th>
                <th>Shown</th>
                <th>Withheld</th>
                <th>Continued</th>
                <th>Left</th>
                <th>Rung</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.ruleId}>
                  <td>{fences[d.ruleId]?.label ?? d.ruleId}</td>
                  <td>{d.points}</td>
                  <td>{d.shown}</td>
                  <td>{d.withheld}</td>
                  <td>{d.continued}</td>
                  <td>{d.left}</td>
                  <td>{d.rung + 1}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Area map */}
      <section className="manage-section">
        <h2 className="manage-section-title">Area map</h2>
        {Object.keys(map).length === 0 ? (
          <p className="manage-empty">No domains assigned to areas yet.</p>
        ) : (
          <table className="manage-area-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Area</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(map)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([domain, areaId]) => (
                  <tr key={domain}>
                    <td>{domain}</td>
                    <td>
                      <select value={areaId} onChange={(e) => void handleAssign(domain, e.target.value)}>
                        <option value="">— unassign —</option>
                        {allAreas.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.emoji} {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
        <div className="manage-add-domain">
          <input
            type="text"
            placeholder="Add domain (e.g. reddit.com)"
            value={newDomain}
            onChange={(e) => setNewDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newDomain.trim()) {
                const d = newDomain.trim().toLowerCase();
                setMap({ ...map, [d]: "" });
                setNewDomain("");
              }
            }}
          />
        </div>
      </section>

      {/* How to add */}
      <section className="manage-section">
        <p className="manage-hint">Ask Claude to set a fence, gate, or transform on a domain.</p>
      </section>

      {/* Export */}
      <section className="manage-section">
        <button className="manage-export" onClick={() => void handleExport()}>
          Export activity log (JSONL)
        </button>
      </section>
    </div>
  );
}
