"use client";

import { observer, use$ } from "@legendapp/state/react";
import { getAllSyncStates } from "@legendapp/state/sync";
import { useEffect, useState } from "react";
import { nudgeVault, vaultRootPath } from "@/infrastructure/vault/adapter";
import { isTauri } from "@/infrastructure/vault/is-tauri";

type Status = "synced" | "syncing" | "pending" | "error";

interface AggregateState {
  status: Status;
  pendingCount: number;
  lastSync: number | null;
  errorMessage: string | null;
}

function formatRelative(ms: number | null): string {
  if (ms === null) return "never";
  const delta = Date.now() - ms;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

function computeAggregate(): AggregateState {
  const states = getAllSyncStates();
  let status: Status = "synced";
  let pendingCount = 0;
  let lastSync: number | null = null;
  let errorMessage: string | null = null;

  for (const [state$] of states) {
    const state = state$.get();

    if (state.error) {
      status = "error";
      errorMessage = state.error.message;
    }

    const pendingSets = state.numPendingSets ?? 0;
    pendingCount += pendingSets;

    if (state.isSetting || state.isGetting) {
      if (status !== "error") status = "syncing";
    } else if (pendingSets > 0 && status !== "error" && status !== "syncing") {
      status = "pending";
    }

    if (state.lastSync !== undefined) {
      if (lastSync === null || state.lastSync > lastSync) {
        lastSync = state.lastSync;
      }
    }
  }

  return { status, pendingCount, lastSync, errorMessage };
}

const STATUS_META: Record<Status, { icon: string; label: string }> = {
  synced: { icon: "◉", label: "Synced" },
  syncing: { icon: "◌", label: "Syncing…" },
  pending: { icon: "△", label: "Pending" },
  error: { icon: "✕", label: "Sync error" },
};

/**
 * VaultStatusSection — rich vault-sync view for the Settings › Data Management
 * accordion. Shows aggregate status, active vault path, last-sync time, pending
 * count, and any error. Only renders in Tauri (web has no vault).
 *
 * Polls the aggregated ObservableSyncState every second for time freshness.
 */
export const VaultStatusSection = observer(function VaultStatusSection() {
  const [, setTick] = useState(0);
  const [path, setPath] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    // Fetch vault path once on mount.
    vaultRootPath()
      .then(setPath)
      .catch(() => setPath(null));
    // Re-render every second for relative-time display.
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!isTauri()) return null;

  // Subscribe to every sync state observable so React re-renders on change.
  const states = getAllSyncStates();
  for (const [state$] of states) {
    use$(state$);
  }

  const { status, pendingCount, lastSync, errorMessage } = computeAggregate();
  const meta = STATUS_META[status];

  return (
    <div className="space-y-2 pb-3 mb-1 border-b border-stone-200 dark:border-stone-700">
      <h4 className="text-xs font-medium text-stone-900 dark:text-stone-100">
        Vault
      </h4>

      {/* Status row */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-stone-200 dark:border-stone-700">
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden
            className={
              status === "error"
                ? "text-red-600 dark:text-red-400 font-mono"
                : "text-stone-600 dark:text-stone-400 font-mono"
            }
          >
            {meta.icon}
          </span>
          <span
            className={
              status === "error"
                ? "text-sm font-medium text-red-700 dark:text-red-300"
                : "text-sm font-medium text-stone-900 dark:text-stone-100"
            }
          >
            {meta.label}
          </span>
        </div>
        <span className="text-xs font-mono text-stone-500 dark:text-stone-500">
          {status === "synced" ? formatRelative(lastSync) : null}
          {status === "pending" && pendingCount > 0
            ? `${pendingCount} pending`
            : null}
        </span>
      </div>

      {/* Error detail */}
      {status === "error" && errorMessage && (
        <div className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
          {errorMessage}
        </div>
      )}

      {/* Sync now */}
      <button
        type="button"
        onClick={() => nudgeVault()}
        className="w-full px-3 py-1.5 text-xs font-medium rounded border border-stone-300 dark:border-stone-600 text-stone-700 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
      >
        Sync now
      </button>

      {/* Path row */}
      <div className="px-3 py-2 rounded-lg bg-stone-100 dark:bg-stone-800/50 border border-stone-200 dark:border-stone-700">
        <div className="text-[10px] uppercase tracking-wide text-stone-500 dark:text-stone-500 mb-0.5">
          Location
        </div>
        <div
          className="text-xs font-mono text-stone-700 dark:text-stone-300 break-all"
          title={path ?? ""}
        >
          {path ?? "…"}
        </div>
      </div>
    </div>
  );
});
