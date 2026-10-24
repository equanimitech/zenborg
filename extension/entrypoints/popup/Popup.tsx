import { useEffect, useState } from "react";
import { pageTransforms, type PageTransform } from "@/modules/friction/policy/store";
import { exitLine, fencesFor } from "@/modules/fence/parse";
import { fenceCache } from "@/modules/fence/store";
import type { Fence, Fences } from "@/modules/fence/types";
import { normalizeDomain } from "@/modules/domains";

/**
 * Popup — per-domain fences, then the global count.
 *
 * Redesigned 2026-08-26 (extension surfaces, Task 2). It used to open on an
 * undifferentiated "In force" list — every fence, wherever it applied. That
 * answers the wrong first question: standing on a tab, what matters most is
 * what applies *here*. So the domain header and its fences (each with a type
 * badge and its exit line) come first now; the total fence count moves to
 * the bottom, next to the dashboard link.
 *
 * History and configuration live on the manage page, where your own data is
 * what you sort.
 *
 * Invariant 6 says sovereignty rests on the exit rather than on who was
 * allowed to arm the thing — and an exit nobody can find is not one. A
 * standing block replaces the page with the browser's own error page, where
 * no extension UI can run and nothing can be rendered beside it, so the way
 * out has to live on a surface that is reachable at any moment. This is that
 * surface. It is a list, not a control: several of these exits are
 * deliberately out of band, and a button here would put the key back in the
 * room.
 */
async function currentDomain(): Promise<string | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      return null;
    }
    const url = new URL(tab.url);
    if (!url.hostname || url.protocol === "chrome:" || url.protocol === "chrome-extension:") {
      return null;
    }
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function fenceTypeBadge(fence: Fence): string {
  switch (fence.enforcement.kind) {
    case "block":
      return fence.enforcement.standing ? "\u{1F512}" : "⏳";
    case "gate":
      return "⏱";
    default:
      return "\u{1F6E1}";
  }
}

/** Transforms matching this host. Same subdomain logic as fences. */
function transformsFor(transforms: readonly PageTransform[], host: string): readonly PageTransform[] {
  const needle = normalizeDomain(host);
  if (needle === null) { return []; }
  const out: PageTransform[] = [];
  for (const t of transforms) {
    const match = t.domains.some((d) =>
      needle === d || needle.endsWith(`.${d}`)
    );
    if (match) { out.push(t); }
  }
  return out;
}

function transformLabel(t: PageTransform): string {
  switch (t.replacement.type) {
    case "hide":
      return "hides element";
    case "restyle":
      return "restyles element";
    case "text":
      return "replaces content";
    default:
      return "transforms element";
  }
}

export function Popup() {
  const [domain, setDomain] = useState<string | null>(null);
  const [allFences, setAllFences] = useState<Fences>({});
  const [transforms, setTransforms] = useState<readonly PageTransform[]>([]);

  useEffect(() => {
    currentDomain().then(setDomain);
    fenceCache.getValue().then(setAllFences).catch(() => setAllFences({}));
    pageTransforms.getValue().then(setTransforms).catch(() => setTransforms([]));
  }, []);

  const hereFences = domain ? fencesFor(allFences, domain) : [];
  const hereTransforms = domain ? transformsFor(transforms, domain) : [];
  const totalFences = Object.keys(allFences).length;
  const totalTransforms = transforms.length;
  const totalInForce = totalFences + totalTransforms;

  return (
    <div className="popup-root">
      {/* Per-domain fences + transforms — what's in force here */}
      {(hereFences.length > 0 || hereTransforms.length > 0) && (
        <section className="popup-here">
          <ul className="popup-fence-list">
            {hereFences.map((f) => (
              <li key={f.id} className="popup-fence-item">
                <span className="popup-fence-badge">{fenceTypeBadge(f)}</span>
                <span className="popup-fence-name">{f.label}</span>
                <span className="popup-fence-exit">{exitLine(f)}</span>
              </li>
            ))}
            {hereTransforms.map((t) => (
              <li key={t.ruleId} className="popup-fence-item">
                <span className="popup-fence-badge">{"\u{1F6E1}"}</span>
                <span className="popup-fence-name">{t.ruleId}</span>
                <span className="popup-fence-exit">{transformLabel(t)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Global fence count + manage link */}
      <button
        className="popup-manage-link"
        onClick={() => {
          void browser.tabs.create({ url: browser.runtime.getURL("/manage.html") });
        }}
      >
        {totalInForce > 0 ? `${totalInForce} rule${totalInForce === 1 ? "" : "s"} total` : "Dashboard"} →
      </button>

      <p className="popup-note">Everything stays on this machine.</p>
    </div>
  );
}
