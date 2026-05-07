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

type SegKey = "suction" | "discharge";

interface Props {
  onChange: (items: AccessoryItem[], K_sum: number) => void;
}

export default function AccessoriesPicker({ onChange }: Props) {
  const [library, setLibrary]         = useState<AccessoryRecord[]>([]);
  const [loadError, setLoadError]     = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("check_valve");
  const [activeSegment, setActiveSegment]   = useState<SegKey>("discharge");

  // Two fully independent selection maps — same accessory ID can appear in both
  const [suctionSelected,   setSuctionSelected]   = useState<Record<string, PickerItem>>({});
  const [dischargeSelected, setDischargeSelected] = useState<Record<string, PickerItem>>({});

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

  // Merge both maps and notify parent any time either changes
  const notifyParent = useCallback(
    (
      suction: Record<string, PickerItem>,
      discharge: Record<string, PickerItem>
    ) => {
      const items: AccessoryItem[] = [];
      let K_sum = 0;

      for (const item of Object.values(suction)) {
        if (item.count < 1) continue;
        const K = item.K_override !== null ? item.K_override : item.default_K;
        items.push({
          accessory_id: item.id,
          count: item.count,
          K_override: item.K_override,
          segment: "suction",
          default_K: item.default_K,
        });
        K_sum += K * item.count;
      }
      for (const item of Object.values(discharge)) {
        if (item.count < 1) continue;
        const K = item.K_override !== null ? item.K_override : item.default_K;
        items.push({
          accessory_id: item.id,
          count: item.count,
          K_override: item.K_override,
          segment: "discharge",
          default_K: item.default_K,
        });
        K_sum += K * item.count;
      }
      onChange(items, K_sum);
    },
    [onChange]
  );

  // Segment-aware state helpers
  const getMap    = (seg: SegKey) => seg === "suction" ? suctionSelected : dischargeSelected;
  const setMap    = (seg: SegKey) => seg === "suction" ? setSuctionSelected : setDischargeSelected;

  const add = (acc: AccessoryRecord) => {
    const seg = activeSegment;
    setMap(seg)((prev) => {
      const next = { ...prev };
      if (next[acc.id]) {
        next[acc.id] = { ...next[acc.id], count: next[acc.id].count + 1 };
      } else {
        next[acc.id] = { ...acc, count: 1, K_override: null, expanded: false };
      }
      if (seg === "suction") notifyParent(next, dischargeSelected);
      else                   notifyParent(suctionSelected, next);
      return next;
    });
  };

  const remove = (id: string) => {
    const seg = activeSegment;
    setMap(seg)((prev) => {
      const next = { ...prev };
      if (!next[id]) return prev;
      if (next[id].count > 1) {
        next[id] = { ...next[id], count: next[id].count - 1 };
      } else {
        delete next[id];
      }
      if (seg === "suction") notifyParent(next, dischargeSelected);
      else                   notifyParent(suctionSelected, next);
      return next;
    });
  };

  const setCount = (id: string, val: number) => {
    const seg = activeSegment;
    setMap(seg)((prev) => {
      const next = { ...prev };
      if (val <= 0) {
        delete next[id];
      } else {
        next[id] = { ...next[id], count: val };
      }
      if (seg === "suction") notifyParent(next, dischargeSelected);
      else                   notifyParent(suctionSelected, next);
      return next;
    });
  };

  const setKOverride = (id: string, val: string) => {
    const seg = activeSegment;
    setMap(seg)((prev) => {
      const next = { ...prev };
      const parsed = parseFloat(val);
      next[id] = {
        ...next[id],
        K_override: val === "" || isNaN(parsed) ? null : parsed,
      };
      if (seg === "suction") notifyParent(next, dischargeSelected);
      else                   notifyParent(suctionSelected, next);
      return next;
    });
  };

  const toggleExpanded = (id: string) => {
    const seg = activeSegment;
    setMap(seg)((prev) => {
      if (!prev[id]) return prev;
      return { ...prev, [id]: { ...prev[id], expanded: !prev[id].expanded } };
    });
  };

  const safeLibrary = Array.isArray(library) ? library : [];
  const categorised = CATEGORY_ORDER.reduce<Record<string, AccessoryRecord[]>>(
    (acc, cat) => {
      acc[cat] = safeLibrary.filter((a) => a.category === cat);
      return acc;
    },
    {}
  );

  const activeMap = getMap(activeSegment);

  const K_sum_suction   = Object.values(suctionSelected).reduce((s, i) => {
    const K = i.K_override !== null ? i.K_override : i.default_K;
    return s + K * i.count;
  }, 0);
  const K_sum_discharge = Object.values(dischargeSelected).reduce((s, i) => {
    const K = i.K_override !== null ? i.K_override : i.default_K;
    return s + K * i.count;
  }, 0);

  const totalCountSuction   = Object.values(suctionSelected).reduce((s, i) => s + i.count, 0);
  const totalCountDischarge = Object.values(dischargeSelected).reduce((s, i) => s + i.count, 0);
  const totalCount          = totalCountSuction + totalCountDischarge;

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
    <div className="space-y-3">
      {/* Segment selector — fully independent states */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 shrink-0">
          Segment
        </span>
        <div className="flex rounded overflow-hidden border border-slate-300">
          {(["suction", "discharge"] as const).map((seg) => {
            const cnt = seg === "suction" ? totalCountSuction : totalCountDischarge;
            return (
              <button
                key={seg}
                type="button"
                onClick={() => setActiveSegment(seg)}
                className={`px-3 py-0.5 text-xs font-semibold transition-colors ${
                  activeSegment === seg
                    ? seg === "suction"
                      ? "bg-sky-600 text-white"
                      : "bg-indigo-600 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-100"
                }`}
              >
                {seg === "suction" ? "Suction" : "Discharge"}
                {cnt > 0 && (
                  <span
                    className={`ml-1 rounded-full px-1 text-[10px] ${
                      activeSegment === seg ? "bg-white/25" : "bg-slate-200"
                    }`}
                  >
                    {cnt}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="text-[10px] text-slate-400">
          — adding to{" "}
          <strong className={activeSegment === "suction" ? "text-sky-600" : "text-indigo-600"}>
            {activeSegment}
          </strong>
        </span>
      </div>

      {/* Category tabs — badge counts reflect active segment only */}
      <div className="flex flex-wrap gap-1">
        {CATEGORY_ORDER.filter((c) => (categorised[c]?.length ?? 0) > 0).map((cat) => {
          const hasSelected = Object.values(activeMap).some(
            (s) => s.category === cat && s.count > 0
          );
          return (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors ${
                activeCategory === cat
                  ? "bg-teal-700 text-white"
                  : hasSelected
                  ? "bg-teal-100 text-teal-800 border border-teal-300"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {CATEGORY_LABELS[cat] ?? cat}
              {hasSelected && (
                <span className="ml-1 rounded-full bg-white/30 px-1 text-[10px]">
                  {Object.values(activeMap)
                    .filter((s) => s.category === cat)
                    .reduce((n, s) => n + s.count, 0)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Items in active category */}
      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
        {(categorised[activeCategory] ?? []).map((acc) => {
          const sel   = activeMap[acc.id];
          const inUse = !!(sel && sel.count > 0);
          const effectiveK = sel
            ? sel.K_override !== null
              ? sel.K_override
              : acc.default_K
            : acc.default_K;

          // Also indicate if item is in the OTHER segment
          const otherMap    = activeSegment === "suction" ? dischargeSelected : suctionSelected;
          const inOther     = !!(otherMap[acc.id]?.count > 0);
          const otherLabel  = activeSegment === "suction" ? "D" : "S";

          return (
            <div
              key={acc.id}
              className={`rounded-lg border transition-colors ${
                inUse
                  ? activeSegment === "suction"
                    ? "border-sky-300 bg-sky-50"
                    : "border-indigo-300 bg-indigo-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-slate-800 truncate">
                      {acc.name}
                    </p>
                    {inOther && (
                      <span className={`rounded px-1 text-[9px] font-bold ${
                        activeSegment === "suction"
                          ? "bg-indigo-100 text-indigo-600"
                          : "bg-sky-100 text-sky-600"
                      }`}>
                        also in {otherLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 font-mono">
                    K = {effectiveK.toFixed(2)}
                    {acc.K_min !== acc.K_max && (
                      <span className="ml-1 text-slate-300">
                        [{acc.K_min}–{acc.K_max}]
                      </span>
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
                      className={inputCls + " w-10 text-center"}
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
                      className="ml-1 text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
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
                <div className="border-t border-slate-200 px-3 pb-2 pt-1.5 space-y-2">
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
                    <p className="text-[10px] text-slate-500 leading-relaxed italic">
                      {acc.notes}
                    </p>
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

      {/* Summary footer — two columns: suction and discharge */}
      {totalCount > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            {/* Suction column */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 mb-1">
                Suction (ΣK = {K_sum_suction.toFixed(2)})
              </p>
              {Object.values(suctionSelected)
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
                      <span className="text-slate-400">→ {(K * item.count).toFixed(2)}</span>
                    </p>
                  );
                })}
              {totalCountSuction === 0 && (
                <p className="text-[10px] text-slate-300 italic">none</p>
              )}
            </div>

            {/* Discharge column */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 mb-1">
                Discharge (ΣK = {K_sum_discharge.toFixed(2)})
              </p>
              {Object.values(dischargeSelected)
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
                      <span className="text-slate-400">→ {(K * item.count).toFixed(2)}</span>
                    </p>
                  );
                })}
              {totalCountDischarge === 0 && (
                <p className="text-[10px] text-slate-300 italic">none</p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-200 pt-1 flex justify-end">
            <p className="text-[10px] font-mono text-slate-400">
              Total ΣK ={" "}
              <span className="text-base font-bold text-teal-700">
                {(K_sum_suction + K_sum_discharge).toFixed(2)}
              </span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
