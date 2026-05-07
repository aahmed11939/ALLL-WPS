import { useEffect, useState, useCallback } from "react";
import {
  fetchAccessoriesLibrary,
  type AccessoryRecord,
  type AccessoryItem,
} from "../utils/api";

const CATEGORY_LABELS: Record<string, string> = {
  check_valve:       "Check Valves",
  isolation_valve:   "Isolation Valves",
  control_valve:     "Control Valves",
  meter:             "Meters & Instruments",
  strainer:          "Strainers",
  air_valve:         "Air Valves",
  suction_fitting:   "Suction Fittings",
  discharge_fitting: "Discharge Fittings",
  station_special:   "Station Specials",
  pipe_transition:   "Pipe Transitions",
};

const CATEGORY_ORDER = [
  "check_valve",
  "isolation_valve",
  "control_valve",
  "meter",
  "strainer",
  "air_valve",
  "suction_fitting",
  "discharge_fitting",
  "station_special",
  "pipe_transition",
];

interface PickerItem extends AccessoryRecord {
  count: number;
  K_override: number | null;
  expanded: boolean;
}

export interface Props {
  segment: "suction" | "discharge";
  onChange: (items: AccessoryItem[], K_sum: number) => void;
}

export default function AccessoriesPicker({ segment, onChange }: Props) {
  const [library, setLibrary]               = useState<AccessoryRecord[]>([]);
  const [loadError, setLoadError]           = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("check_valve");
  const [selected, setSelected]             = useState<Record<string, PickerItem>>({});
  const [searchQuery, setSearchQuery]       = useState<string>("");

  useEffect(() => {
    fetchAccessoriesLibrary()
      .then((resp) => {
        setLibrary(resp.accessories);
        const firstCat = CATEGORY_ORDER.find((c) =>
          resp.accessories.some((a) => a.category === c)
        );
        if (firstCat) setActiveCategory(firstCat);
      })
      .catch(() => setLoadError("Failed to load accessories library."));
  }, []);

  const notify = useCallback(
    (sel: Record<string, PickerItem>) => {
      const items: AccessoryItem[] = [];
      let K_sum = 0;
      for (const item of Object.values(sel)) {
        if (item.count < 1) continue;
        const K = item.K_override !== null ? item.K_override : item.default_K;
        items.push({
          accessory_id: item.id,
          count:        item.count,
          K_override:   item.K_override,
          segment,
          default_K:    item.default_K,
        });
        K_sum += K * item.count;
      }
      onChange(items, K_sum);
    },
    [onChange, segment]
  );

  const add = (acc: AccessoryRecord) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[acc.id]) {
        next[acc.id] = { ...next[acc.id], count: next[acc.id].count + 1 };
      } else {
        next[acc.id] = { ...acc, count: 1, K_override: null, expanded: false };
      }
      notify(next);
      return next;
    });
  };

  const remove = (id: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (!next[id]) return prev;
      if (next[id].count > 1) {
        next[id] = { ...next[id], count: next[id].count - 1 };
      } else {
        delete next[id];
      }
      notify(next);
      return next;
    });
  };

  const setCount = (id: string, val: number) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (val <= 0) {
        delete next[id];
      } else {
        next[id] = { ...next[id], count: val };
      }
      notify(next);
      return next;
    });
  };

  const setKOverride = (id: string, val: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      const parsed = parseFloat(val);
      next[id] = {
        ...next[id],
        K_override: val === "" || isNaN(parsed) ? null : parsed,
      };
      notify(next);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    setSelected((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], expanded: !prev[id].expanded } };
    });
  };

  const safeLibrary = Array.isArray(library) ? library : [];

  // Client-side search: filter across all categories by name, id, or category label
  const searchTrimmed = searchQuery.trim().toLowerCase();
  const searchResults: AccessoryRecord[] = searchTrimmed
    ? safeLibrary.filter(
        (a) =>
          a.name.toLowerCase().includes(searchTrimmed) ||
          a.id.toLowerCase().includes(searchTrimmed) ||
          (CATEGORY_LABELS[a.category] ?? a.category).toLowerCase().includes(searchTrimmed)
      )
    : [];

  const categorised = CATEGORY_ORDER.reduce<Record<string, AccessoryRecord[]>>(
    (acc, cat) => {
      acc[cat] = safeLibrary.filter((a) => a.category === cat);
      return acc;
    },
    {}
  );

  // Items to display: search results when query active, else active category
  const displayItems: AccessoryRecord[] = searchTrimmed
    ? searchResults
    : (categorised[activeCategory] ?? []);

  const K_sum = Object.values(selected).reduce((s, i) => {
    const K = i.K_override !== null ? i.K_override : i.default_K;
    return s + K * i.count;
  }, 0);
  const totalCount = Object.values(selected).reduce((s, i) => s + i.count, 0);

  const segColour = segment === "suction"
    ? { ring: "border-sky-300 bg-sky-50", header: "bg-sky-600", label: "text-sky-600", sum: "text-sky-700" }
    : { ring: "border-indigo-300 bg-indigo-50", header: "bg-indigo-600", label: "text-indigo-600", sum: "text-indigo-700" };

  const inputCls =
    "rounded border border-slate-300 bg-white px-2 py-1 text-xs font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Segment header badge */}
      <div className={`flex items-center justify-between rounded px-2 py-1 ${segColour.header} text-white`}>
        <span className="text-xs font-bold uppercase tracking-wide">
          {segment === "suction" ? "Suction" : "Discharge"}
        </span>
        {totalCount > 0 && (
          <span className="text-xs font-mono font-semibold">
            {totalCount} item{totalCount !== 1 ? "s" : ""} · ΣK = {K_sum.toFixed(2)}
          </span>
        )}
      </div>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search by name or category…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 placeholder-slate-400 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 pr-6"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute inset-y-0 right-1.5 flex items-center text-slate-400 hover:text-slate-600 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Category tabs — hidden while searching */}
      {!searchTrimmed && (
        <div className="flex flex-wrap gap-1">
          {CATEGORY_ORDER.filter((c) => (categorised[c]?.length ?? 0) > 0).map((cat) => {
            const hasSelected = Object.values(selected).some(
              (s) => s.category === cat && s.count > 0
            );
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition-colors ${
                  activeCategory === cat
                    ? "bg-teal-700 text-white"
                    : hasSelected
                    ? "bg-teal-100 text-teal-800 border border-teal-300"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {CATEGORY_LABELS[cat] ?? cat}
                {hasSelected && (
                  <span className="ml-1 rounded-full bg-white/30 px-1 text-[9px]">
                    {Object.values(selected)
                      .filter((s) => s.category === cat)
                      .reduce((n, s) => n + s.count, 0)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Search status hint */}
      {searchTrimmed && (
        <p className="text-[10px] text-slate-400">
          {searchResults.length === 0
            ? "No accessories match your search."
            : `${searchResults.length} result${searchResults.length !== 1 ? "s" : ""} for "${searchQuery}"`}
        </p>
      )}

      {/* Item list — search results or active category */}
      <div className="space-y-1 max-h-56 overflow-y-auto pr-0.5">
        {displayItems.map((acc) => {
          const sel   = selected[acc.id];
          const inUse = !!(sel && sel.count > 0);
          const effectiveK = sel
            ? (sel.K_override !== null ? sel.K_override : acc.default_K)
            : acc.default_K;

          return (
            <div
              key={acc.id}
              className={`rounded-lg border transition-colors ${
                inUse ? segColour.ring : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate">{acc.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">
                    K = {effectiveK.toFixed(2)}
                    {acc.K_min !== acc.K_max && (
                      <span className="ml-1 text-slate-300">[{acc.K_min}–{acc.K_max}]</span>
                    )}
                  </p>
                </div>

                {inUse ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => remove(acc.id)}
                      className="h-5 w-5 rounded border border-slate-300 bg-white text-xs font-bold text-slate-500 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors flex items-center justify-center"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={0}
                      value={sel.count}
                      onChange={(e) => setCount(acc.id, parseInt(e.target.value) || 0)}
                      className={inputCls + " w-9 text-center"}
                    />
                    <button
                      type="button"
                      onClick={() => add(acc)}
                      className="h-5 w-5 rounded border border-slate-300 bg-white text-xs font-bold text-slate-500 hover:bg-teal-50 hover:border-teal-400 hover:text-teal-700 transition-colors flex items-center justify-center"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(acc.id)}
                      className="ml-0.5 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                      title="Edit K value"
                    >
                      {sel.expanded ? "▲" : "▼"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => add(acc)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-600 hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700 transition-colors font-semibold"
                  >
                    Add
                  </button>
                )}
              </div>

              {inUse && sel.expanded && (
                <div className="border-t border-slate-200 px-2.5 pb-2 pt-1.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide w-20 shrink-0">
                      K override
                    </label>
                    <input
                      type="number"
                      step="0.05"
                      min={0}
                      placeholder={`default ${acc.default_K}`}
                      value={sel.K_override !== null ? sel.K_override : ""}
                      onChange={(e) => setKOverride(acc.id, e.target.value)}
                      className={inputCls + " w-24"}
                    />
                    {sel.K_override !== null && (
                      <button
                        type="button"
                        onClick={() => setKOverride(acc.id, "")}
                        className="text-[10px] text-slate-400 hover:text-red-500"
                      >
                        reset
                      </button>
                    )}
                  </div>
                  {acc.notes && (
                    <p className="text-[10px] text-slate-500 leading-relaxed italic">{acc.notes}</p>
                  )}
                  {acc.potable_notes.length > 0 && (
                    <ul className="space-y-0.5">
                      {acc.potable_notes.map((note, i) => (
                        <li key={i} className="text-[10px] text-teal-800 leading-relaxed flex gap-1">
                          <span className="shrink-0 text-teal-500">⬡</span>
                          {note}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected summary */}
      {totalCount > 0 && (
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5 space-y-0.5">
          {Object.values(selected)
            .filter((s) => s.count > 0)
            .sort((a, b) => {
              const Ka = a.K_override !== null ? a.K_override : a.default_K;
              const Kb = b.K_override !== null ? b.K_override : b.default_K;
              return Kb * b.count - Ka * a.count;
            })
            .map((item) => {
              const K = item.K_override !== null ? item.K_override : item.default_K;
              return (
                <p key={item.id} className="text-[10px] font-mono text-slate-500">
                  {item.count}× {item.name}{" "}
                  <span className="text-slate-400">→ K={( K * item.count).toFixed(2)}</span>
                </p>
              );
            })}
          <p className={`text-[10px] font-mono font-semibold pt-0.5 border-t border-slate-200 ${segColour.sum}`}>
            ΣK = {K_sum.toFixed(2)}
          </p>
        </div>
      )}
    </div>
  );
}
