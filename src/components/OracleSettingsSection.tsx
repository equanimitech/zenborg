"use client";

import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  Loader2,
  Plus,
  Terminal,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@/lib/tauri-utils";
import { cn } from "@/lib/utils";

// ponytail: full file read/parse/write on every mutation. Fine for ~10 oracles.

interface OracleFile {
  oracles: Record<string, Record<string, Record<string, string>>>;
  routes: Record<string, string[]>;
  [extra: string]: unknown;
}

const EMPTY_FILE: OracleFile = { oracles: {}, routes: {} };

async function loadOracleFile(): Promise<{
  data: OracleFile;
  path: string;
}> {
  const { vaultRootPath } = await import("@/infrastructure/vault/adapter");
  const { readTextFile, exists } = await import("@tauri-apps/plugin-fs");
  const root = await vaultRootPath();
  const path = `${root}/oracles.json`;
  if (!(await exists(path))) return { data: { ...EMPTY_FILE }, path };
  const raw = await readTextFile(path);
  return { data: JSON.parse(raw) as OracleFile, path };
}

async function saveOracleFile(path: string, data: OracleFile): Promise<void> {
  const { writeTextFile } = await import("@tauri-apps/plugin-fs");
  await writeTextFile(path, JSON.stringify(data, null, 2));
}

function oracleType(
  caps: Record<string, Record<string, string>>,
): "mcp" | "cli" {
  const keys = Object.keys(caps);
  if (keys.length === 0) return "mcp";
  for (const k of keys) {
    if (caps[k].check === "mcp") return "mcp";
  }
  return "cli";
}

export function OracleSettingsSection() {
  const [data, setData] = useState<OracleFile>(EMPTY_FILE);
  const [filePath, setFilePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newOracleName, setNewOracleName] = useState("");
  const [newOracleType, setNewOracleType] = useState<"mcp" | "cli">("mcp");
  const [newCapName, setNewCapName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{
    oracle: string;
    cap: string;
    field: string;
  } | null>(null);
  const [editingValue, setEditingValue] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { data: d, path } = await loadOracleFile();
      setData(d);
      setFilePath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load oracles");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    load();
  }, [load]);

  const save = useCallback(
    async (next: OracleFile) => {
      setData(next);
      try {
        await saveOracleFile(filePath, next);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save");
      }
    },
    [filePath],
  );

  if (!isTauri()) {
    return (
      <div className="px-2 py-8 text-center">
        <Unplug className="w-5 h-5 mx-auto mb-2 text-stone-400" />
        <p className="text-xs text-stone-500">
          Oracle management requires the desktop app.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
      </div>
    );
  }

  const oracleEntries = Object.entries(data.oracles).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const handleAddOracle = () => {
    const name = newOracleName.trim().toLowerCase();
    if (!name || data.oracles[name]) return;
    const next: OracleFile = {
      ...data,
      oracles: { ...data.oracles, [name]: {} },
    };
    if (newOracleType === "cli") {
      next.oracles[name] = {};
    }
    save(next);
    setNewOracleName("");
    setExpanded(name);
  };

  const handleDeleteOracle = (name: string) => {
    if (deleteConfirm !== name) {
      setDeleteConfirm(name);
      setTimeout(() => setDeleteConfirm(null), 3000);
      return;
    }
    const { [name]: _, ...rest } = data.oracles;
    const routes = { ...data.routes };
    for (const [rk, providers] of Object.entries(routes)) {
      const filtered = providers.filter((p) => p !== name);
      if (filtered.length === 0) {
        delete routes[rk];
      } else {
        routes[rk] = filtered;
      }
    }
    save({ ...data, oracles: rest, routes });
    setDeleteConfirm(null);
    if (expanded === name) setExpanded(null);
  };

  const handleAddCapability = (oracle: string) => {
    const cap = newCapName.trim().toLowerCase();
    if (!cap || data.oracles[oracle]?.[cap]) return;
    const next = {
      ...data,
      oracles: {
        ...data.oracles,
        [oracle]: { ...data.oracles[oracle], [cap]: { check: "" } },
      },
    };
    save(next);
    setNewCapName("");
  };

  const handleDeleteCapability = (oracle: string, cap: string) => {
    const { [cap]: _, ...rest } = data.oracles[oracle];
    save({
      ...data,
      oracles: { ...data.oracles, [oracle]: rest },
    });
  };

  const handleSaveField = () => {
    if (!editingField) return;
    const { oracle, cap, field } = editingField;
    const capObj = { ...data.oracles[oracle][cap] };
    if (editingValue.trim()) {
      capObj[field] = editingValue.trim();
    } else {
      delete capObj[field];
    }
    save({
      ...data,
      oracles: {
        ...data.oracles,
        [oracle]: { ...data.oracles[oracle], [cap]: capObj },
      },
    });
    setEditingField(null);
    setEditingValue("");
  };

  const handleAddField = (oracle: string, cap: string) => {
    setEditingField({ oracle, cap, field: "" });
    setEditingValue("");
  };

  const handleAddRoute = (capability: string) => {
    const routes = { ...data.routes };
    if (!routes[capability]) routes[capability] = [];
    save({ ...data, routes });
  };

  const handleRemoveRoute = (capability: string) => {
    const { [capability]: _, ...routes } = data.routes;
    save({ ...data, routes });
  };

  const handleMoveRouteProvider = (
    capability: string,
    index: number,
    direction: -1 | 1,
  ) => {
    const list = [...(data.routes[capability] ?? [])];
    const newIdx = index + direction;
    if (newIdx < 0 || newIdx >= list.length) return;
    [list[index], list[newIdx]] = [list[newIdx], list[index]];
    save({ ...data, routes: { ...data.routes, [capability]: list } });
  };

  const handleAddProviderToRoute = (capability: string, provider: string) => {
    const list = [...(data.routes[capability] ?? [])];
    if (list.includes(provider)) return;
    list.push(provider);
    save({ ...data, routes: { ...data.routes, [capability]: list } });
  };

  const handleRemoveProviderFromRoute = (
    capability: string,
    provider: string,
  ) => {
    const list = (data.routes[capability] ?? []).filter((p) => p !== provider);
    if (list.length === 0) {
      const { [capability]: _, ...routes } = data.routes;
      save({ ...data, routes });
    } else {
      save({ ...data, routes: { ...data.routes, [capability]: list } });
    }
  };

  const allCapabilities = new Set<string>();
  for (const caps of Object.values(data.oracles)) {
    for (const cap of Object.keys(caps)) {
      allCapabilities.add(cap);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-500">
        External systems the garden talks to. MCP oracles self-describe; CLI
        oracles carry per-capability commands.
      </p>

      {error && (
        <div className="px-3 py-2 text-xs text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded bg-red-50 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {/* Oracle list */}
      <div className="space-y-1">
        {oracleEntries.map(([name, caps]) => {
          const type = oracleType(caps);
          const capCount = Object.keys(caps).length;
          const isExpanded = expanded === name;

          return (
            <div
              key={name}
              className="border border-stone-200 dark:border-stone-700 rounded"
            >
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : name)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-stone-50 dark:hover:bg-stone-800/50 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-stone-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-stone-400 shrink-0" />
                )}
                <span className="text-sm font-medium text-stone-900 dark:text-stone-100 flex-1">
                  {name}
                </span>
                <span
                  className={cn(
                    "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                    type === "mcp"
                      ? "border-stone-300 dark:border-stone-600 text-stone-500"
                      : "border-stone-300 dark:border-stone-600 text-stone-500",
                  )}
                >
                  {type.toUpperCase()}
                </span>
                {capCount > 0 && (
                  <span className="text-[10px] text-stone-400 font-mono">
                    {capCount} cap{capCount !== 1 ? "s" : ""}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteOracle(name);
                  }}
                  className={cn(
                    "p-1 rounded transition-colors",
                    deleteConfirm === name
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400"
                      : "text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400",
                  )}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </button>

              {isExpanded && (
                <div className="border-t border-stone-200 dark:border-stone-700 px-3 py-2 space-y-2">
                  {Object.entries(caps).length === 0 && (
                    <p className="text-xs text-stone-400 italic py-1">
                      {type === "mcp"
                        ? "MCP oracle. Tools self-describe at runtime."
                        : "No capabilities defined."}
                    </p>
                  )}

                  {Object.entries(caps).map(([capName, fields]) => (
                    <div
                      key={capName}
                      className="border border-stone-100 dark:border-stone-800 rounded p-2 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Terminal className="w-3 h-3 text-stone-400" />
                          <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
                            {capName}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteCapability(name, capName)}
                          className="p-0.5 text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>

                      {Object.entries(fields).map(([fk, fv]) => (
                        <div key={fk} className="flex gap-1 items-start">
                          <span className="text-[10px] font-mono text-stone-400 min-w-[3rem] pt-0.5 shrink-0">
                            {fk}
                          </span>
                          {editingField?.oracle === name &&
                          editingField?.cap === capName &&
                          editingField?.field === fk ? (
                            <div className="flex-1 flex gap-1">
                              <input
                                type="text"
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveField();
                                  if (e.key === "Escape") setEditingField(null);
                                }}
                                className="flex-1 text-[10px] font-mono px-1 py-0.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-stone-700 dark:text-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-400"
                                autoFocus
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingField({
                                  oracle: name,
                                  cap: capName,
                                  field: fk,
                                });
                                setEditingValue(fv);
                              }}
                              className="flex-1 text-left text-[10px] font-mono text-stone-500 dark:text-stone-400 truncate hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
                            >
                              {fv}
                            </button>
                          )}
                        </div>
                      ))}

                      {/* Add new field to capability */}
                      {editingField?.oracle === name &&
                      editingField?.cap === capName &&
                      editingField?.field === "" ? (
                        <div className="flex gap-1 items-center pt-1">
                          <input
                            type="text"
                            placeholder="key"
                            value={editingValue.split("=")[0] ?? ""}
                            onChange={(e) => {
                              const val =
                                editingValue.split("=").slice(1).join("=") ?? "";
                              setEditingValue(`${e.target.value}=${val}`);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const [key, ...rest] = editingValue.split("=");
                                if (key?.trim()) {
                                  const capObj = { ...caps[capName] };
                                  capObj[key.trim()] = rest.join("=") || "";
                                  save({
                                    ...data,
                                    oracles: {
                                      ...data.oracles,
                                      [name]: {
                                        ...data.oracles[name],
                                        [capName]: capObj,
                                      },
                                    },
                                  });
                                  setEditingField(null);
                                  setEditingValue("");
                                }
                              }
                              if (e.key === "Escape") {
                                setEditingField(null);
                                setEditingValue("");
                              }
                            }}
                            className="w-16 text-[10px] font-mono px-1 py-0.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-stone-700 dark:text-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-400"
                            autoFocus
                          />
                          <span className="text-[10px] text-stone-300">=</span>
                          <input
                            type="text"
                            placeholder="value"
                            value={editingValue.split("=").slice(1).join("=") ?? ""}
                            onChange={(e) => {
                              const key = editingValue.split("=")[0] ?? "";
                              setEditingValue(`${key}=${e.target.value}`);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                const [key, ...rest] = editingValue.split("=");
                                if (key?.trim()) {
                                  const capObj = { ...caps[capName] };
                                  capObj[key.trim()] = rest.join("=") || "";
                                  save({
                                    ...data,
                                    oracles: {
                                      ...data.oracles,
                                      [name]: {
                                        ...data.oracles[name],
                                        [capName]: capObj,
                                      },
                                    },
                                  });
                                  setEditingField(null);
                                  setEditingValue("");
                                }
                              }
                              if (e.key === "Escape") {
                                setEditingField(null);
                                setEditingValue("");
                              }
                            }}
                            className="flex-1 text-[10px] font-mono px-1 py-0.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-stone-700 dark:text-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-400"
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleAddField(name, capName)}
                          className="text-[10px] text-stone-400 hover:text-stone-600 dark:hover:text-stone-300 transition-colors"
                        >
                          + field
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Add capability */}
                  <div className="flex gap-1 pt-1">
                    <input
                      type="text"
                      value={newCapName}
                      onChange={(e) => setNewCapName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddCapability(name);
                      }}
                      placeholder="capability name..."
                      className="flex-1 text-xs px-2 py-1 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-stone-700 dark:text-stone-300 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400"
                    />
                    <button
                      type="button"
                      onClick={() => handleAddCapability(name)}
                      disabled={!newCapName.trim()}
                      className="px-2 py-1 text-xs border border-stone-200 dark:border-stone-700 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-40 text-stone-600 dark:text-stone-400"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {oracleEntries.length === 0 && (
          <p className="text-xs text-stone-400 text-center py-4">
            No oracles configured. Add one below.
          </p>
        )}
      </div>

      {/* Add oracle */}
      <div className="flex gap-1">
        <input
          type="text"
          value={newOracleName}
          onChange={(e) => setNewOracleName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddOracle();
          }}
          placeholder="oracle name..."
          className="flex-1 text-xs px-2 py-1.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-stone-700 dark:text-stone-300 placeholder:text-stone-400 dark:placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-stone-400"
        />
        <div className="flex border border-stone-200 dark:border-stone-700 rounded overflow-hidden">
          {(["mcp", "cli"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setNewOracleType(t)}
              className={cn(
                "px-2 py-1.5 text-[10px] font-mono transition-colors",
                newOracleType === t
                  ? "bg-stone-200 dark:bg-stone-700 text-stone-900 dark:text-stone-100"
                  : "text-stone-400 hover:text-stone-600 dark:hover:text-stone-300",
              )}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={handleAddOracle}
          disabled={!newOracleName.trim()}
          className="px-2 py-1.5 border border-stone-200 dark:border-stone-700 rounded hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors disabled:opacity-40 text-stone-600 dark:text-stone-400"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Routes */}
      {(Object.keys(data.routes).length > 0 || allCapabilities.size > 0) && (
        <div className="pt-3 border-t border-stone-200 dark:border-stone-700 space-y-2">
          <h4 className="text-xs font-medium text-stone-700 dark:text-stone-300">
            Routes
          </h4>
          <p className="text-xs text-stone-400">
            When multiple oracles provide the same capability, routes set the
            preference order.
          </p>

          {Object.entries(data.routes)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([cap, providers]) => (
              <div
                key={cap}
                className="border border-stone-200 dark:border-stone-700 rounded p-2 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-700 dark:text-stone-300">
                    {cap}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRoute(cap)}
                    className="p-0.5 text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {providers.map((provider, i) => (
                  <div
                    key={provider}
                    className="flex items-center gap-1 text-xs"
                  >
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => handleMoveRouteProvider(cap, i, -1)}
                        disabled={i === 0}
                        className="text-stone-300 hover:text-stone-500 disabled:opacity-20 transition-colors leading-none"
                      >
                        <GripVertical className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="text-stone-600 dark:text-stone-400 font-mono text-[10px] flex-1">
                      {i + 1}. {provider}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleRemoveProviderFromRoute(cap, provider)
                      }
                      className="p-0.5 text-stone-300 hover:text-stone-500 dark:text-stone-600 dark:hover:text-stone-400 transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}

                {/* Add provider to route */}
                {(() => {
                  const available = Object.keys(data.oracles).filter(
                    (o) => !providers.includes(o),
                  );
                  if (available.length === 0) return null;
                  return (
                    <select
                      onChange={(e) => {
                        if (e.target.value)
                          handleAddProviderToRoute(cap, e.target.value);
                        e.target.value = "";
                      }}
                      defaultValue=""
                      className="w-full text-[10px] px-1 py-0.5 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-stone-500 focus:outline-none"
                    >
                      <option value="">+ add provider...</option>
                      {available.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  );
                })()}
              </div>
            ))}

          {/* Add route */}
          {(() => {
            const existingRoutes = new Set(Object.keys(data.routes));
            const unrouted = [...allCapabilities].filter(
              (c) => !existingRoutes.has(c),
            );
            if (unrouted.length === 0) return null;
            return (
              <select
                onChange={(e) => {
                  if (e.target.value) handleAddRoute(e.target.value);
                  e.target.value = "";
                }}
                defaultValue=""
                className="w-full text-xs px-2 py-1 bg-stone-50 dark:bg-stone-800 border border-stone-200 dark:border-stone-700 rounded text-stone-500 focus:outline-none"
              >
                <option value="">+ add route for capability...</option>
                {unrouted.sort().map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            );
          })()}
        </div>
      )}
    </div>
  );
}
