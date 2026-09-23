/**
 * The manage page — a fence dashboard.
 *
 * Four sections: the fences table (what is standing, its type, its exit),
 * cooldown status, area-map assignment, and activity-log export. Everything
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
import { exportFileName, toJsonl } from "@/modules/activity/events";
import { readAllEvents } from "@/modules/activity/log";
import { FenceBadge, FenceGlyph } from "@/modules/fence/glyph";
import { exitLine } from "@/modules/fence/parse";
import { fenceCache, fenceRefusals } from "@/modules/fence/store";
import type { Fence, Fences, Refusal } from "@/modules/fence/types";
import {
  type ActiveCooldown,
  activeAt,
} from "@/modules/friction/cooldown/state";
import { cooldowns } from "@/modules/friction/cooldown/store";
import {
  type AreaInfo,
  areaMap as areaMapStore,
  areas as areasStore,
  type PageTransform,
  pageTransforms,
} from "@/modules/friction/policy/store";
import { setArea } from "@/modules/relay/client";

function fenceTypeLabel(fence: Fence): string {
  if (fence.enforcement.kind === "block") {
    return fence.enforcement.standing ? "standing block" : "timed block";
  }
  return fence.enforcement.kind;
}

function formatUntil(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Manage() {
  const [fences, setFences] = useState<Fences>({});
  const [transforms, setTransforms] = useState<readonly PageTransform[]>([]);
  const [refused, setRefused] = useState<readonly Refusal[]>([]);
  const [cds, setCds] = useState<readonly ActiveCooldown[]>([]);
  const [allAreas, setAllAreas] = useState<readonly AreaInfo[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [newDomain, setNewDomain] = useState("");

  useEffect(() => {
    fenceCache.getValue().then(setFences);
    pageTransforms.getValue().then(setTransforms);
    fenceRefusals.getValue().then(setRefused);
    cooldowns.getValue().then((s) => setCds(activeAt(s, Date.now())));
    areasStore.getValue().then(setAllAreas);
    areaMapStore.getValue().then(setMap);

    const unwatchFences = fenceCache.watch((v) => {
      if (v) {
        setFences(v);
      }
    });
    const unwatchTransforms = pageTransforms.watch((v) => {
      if (v) {
        setTransforms(v);
      }
    });
    const unwatchCooldowns = cooldowns.watch((s) => {
      if (s) {
        setCds(activeAt(s, Date.now()));
      }
    });
    return () => {
      unwatchFences();
      unwatchTransforms();
      unwatchCooldowns();
    };
  }, []);

  const fenceList = Object.values(fences);

  const handleAssign = async (
    domain: string,
    areaId: string,
  ): Promise<void> => {
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
          <p className="manage-empty">No fences yet. Nothing is fenced out.</p>
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
                  <td>
                    <FenceBadge fence={f} />
                  </td>
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
                    <td>
                      <FenceGlyph name="fence" label="transform" />
                    </td>
                    <td>{t.ruleId}</td>
                    <td className="manage-domains">{t.domains.join(", ")}</td>
                    <td className="manage-exit" title={t.targets.primary}>
                      {t.targets.primary.slice(0, 40)}
                      {t.targets.primary.length > 40 ? "…" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* Cooldown */}
      {cds.length > 0 && (
        <section className="manage-section">
          <h2 className="manage-section-title">Cooldown</h2>
          <ul className="manage-cooldown-list">
            {cds.map((cd) => (
              <li key={cd.ruleId}>
                {cd.domains.length} domain(s) until {formatUntil(cd.until)}
              </li>
            ))}
          </ul>
        </section>
      )}

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
                      <select
                        value={areaId}
                        onChange={(e) =>
                          void handleAssign(domain, e.target.value)
                        }
                      >
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
        <p className="manage-hint">
          Ask Claude to fence out a weed: a fence, a gate, or a transform on a
          site.
        </p>
      </section>

      {/* Export */}
      <section className="manage-section">
        <button
          type="button"
          className="manage-export"
          onClick={() => void handleExport()}
        >
          Export activity log (JSONL)
        </button>
      </section>
    </div>
  );
}
