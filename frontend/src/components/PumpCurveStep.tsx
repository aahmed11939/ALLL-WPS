import { useState, useCallback, useRef, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ReferenceDot, Legend, ResponsiveContainer,
} from "recharts";
import type { ValueType, NameType, Formatter } from "recharts/types/component/DefaultTooltipContent";
import {
  computePump,
  importPumpCurveCsv,
  fetchPumpLibrary,
  type PumpComputeRequest,
  type PumpComputeResponse,
  type CurvePoint,
  type PumpRecord,
} from "../utils/api";
import { useUnitSystem } from "../contexts/UnitSystemContext";

/** 1 kW = 1.34102 hp */
const KW_TO_HP = 1.34102;
const MAX_MANUAL_ROWS = 20;

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

type StepState = "active" | "bypassed" | "disabled";
type SourceTab = "library" | "manual" | "csv";
type Arrangement = "single" | "parallel" | "series";

export interface PumpCurveStepProps {
  /** System curve data from the hydraulic calculation (optional) */
  systemCurve?: CurvePoint[];
  /** Static head component from the hydraulic calculation [m] (optional) */
  staticHeadM?: number;
  /** Design flow from the hydraulic calculation [m³/h] (optional) */
  designFlowM3h?: number;
  /** Design TDH from the hydraulic calculation [m] (optional) */
  designTdhM?: number;
}

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const labelCls =
  "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";

const SPEED_COLORS = ["#0f766e", "#0891b2", "#7c3aed", "#b45309", "#dc2626"];

// ---------------------------------------------------------------------------
// Tooltip formatter (typed to satisfy Recharts generics)
// ---------------------------------------------------------------------------

const tooltipFormatter = ((val: unknown, name: unknown): [string, string] => {
  if (val === undefined || val === null) return ["—", String(name ?? "")];
  const num = typeof val === "number" ? val.toFixed(2) : String(val);
  return [num, String(name ?? "")];
}) as Formatter<ValueType, NameType>;

// ---------------------------------------------------------------------------
// Mini chart component
// ---------------------------------------------------------------------------

interface ChartConfig {
  title: string;
  yLabel: string;
  color: string;
  data: CurvePoint[];
  opQ?: number;
  opV?: number;
  systemPts?: CurvePoint[];
  speedCurves?: { speed_pct: number; hq_pts: CurvePoint[] }[];
  npshaM?: number;
  /** If true, annotate the maximum-value point as BEP */
  showBep?: boolean;
  /** If true, show a diamond marker at (opQ, opV) — use on H-Q chart */
  showOpDiamond?: boolean;
}

function PumpChart({ cfg }: { cfg: ChartConfig }) {
  if (!cfg.data.length) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 h-64 flex items-center justify-center">
        <p className="text-xs text-slate-400 font-mono">No data</p>
      </div>
    );
  }

  const pumpMap = new Map(cfg.data.map((p) => [p.Q_m3h, p.value]));
  const sysMap  = new Map((cfg.systemPts ?? []).map((p) => [p.Q_m3h, p.value]));
  const speedMaps = (cfg.speedCurves ?? []).map(
    (sc) => ({ pct: sc.speed_pct, map: new Map(sc.hq_pts.map((p) => [p.Q_m3h, p.value])) })
  );

  const allQs = [
    ...cfg.data.map((p) => p.Q_m3h),
    ...(cfg.systemPts ?? []).map((p) => p.Q_m3h),
    ...(cfg.speedCurves ?? []).flatMap((sc) => sc.hq_pts.map((p) => p.Q_m3h)),
  ];
  const qUnion = Array.from(new Set(allQs)).sort((a, b) => a - b);

  const chartData = qUnion.map((q) => {
    const row: Record<string, number> = { Q_m3h: q };
    if (pumpMap.has(q)) row["pump"] = pumpMap.get(q)!;
    if (sysMap.has(q))  row["system"] = sysMap.get(q)!;
    speedMaps.forEach((sm) => {
      if (sm.map.has(q)) row[`spd_${sm.pct}`] = sm.map.get(q)!;
    });
    return row;
  });

  // For simple charts without overlay, use raw pump data as-is
  const renderData = (cfg.systemPts && cfg.systemPts.length > 0) || (cfg.speedCurves && cfg.speedCurves.length > 0)
    ? chartData
    : cfg.data.map((p) => ({ Q_m3h: p.Q_m3h, pump: p.value }));

  const allVals = cfg.data.map((p) => p.value).filter((v) => v > 0);
  const sysVals = (cfg.systemPts ?? []).map((p) => p.value);
  const vMax = Math.max(...allVals, ...sysVals, 1) * 1.15;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-600 mb-2">{cfg.title}</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart
          data={renderData}
          margin={{ top: 8, right: 16, bottom: 24, left: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="Q_m3h"
            type="number"
            label={{ value: "Q (m³/h)", position: "insideBottomRight", offset: -8, fontSize: 10, fill: "#64748b" }}
            tick={{ fontSize: 10, fontFamily: "monospace", fill: "#64748b" }}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <YAxis
            label={{ value: cfg.yLabel, angle: -90, position: "insideLeft", offset: 12, fontSize: 10, fill: "#64748b" }}
            tick={{ fontSize: 10, fontFamily: "monospace", fill: "#64748b" }}
            domain={[0, vMax]}
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          <Tooltip
            contentStyle={{ fontSize: 11, fontFamily: "monospace" }}
            formatter={tooltipFormatter}
          />

          {/* VFD speed curves */}
          {(cfg.speedCurves ?? []).map((sc, i) => (
            <Line
              key={`spd_${sc.speed_pct}`}
              dataKey={`spd_${sc.speed_pct}`}
              name={`${sc.speed_pct.toFixed(0)}%`}
              stroke={SPEED_COLORS[i % SPEED_COLORS.length]}
              strokeWidth={1}
              dot={false}
              strokeDasharray="4 2"
              isAnimationActive={false}
            />
          ))}

          {/* System curve overlay */}
          {cfg.systemPts && cfg.systemPts.length > 0 && (
            <Line
              dataKey="system"
              name="System"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          )}

          {/* Pump curve */}
          <Line
            dataKey="pump"
            name="Pump"
            stroke={cfg.color}
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />

          {/* NPSHa horizontal reference line (on NPSHr chart only) */}
          {cfg.npshaM !== undefined && cfg.npshaM > 0 && (
            <ReferenceLine
              y={cfg.npshaM}
              stroke="#16a34a"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{ value: `NPSHa=${cfg.npshaM.toFixed(1)}m`, position: "right", fontSize: 9, fill: "#16a34a", fontFamily: "monospace" }}
            />
          )}

          {/* BEP marker: vertical line at max-η Q */}
          {cfg.showBep && cfg.data.length > 0 && (() => {
            const bepPt = cfg.data.reduce((best, pt) =>
              pt.value > best.value ? pt : best, cfg.data[0]);
            return (
              <ReferenceLine
                x={bepPt.Q_m3h}
                stroke="#16a34a"
                strokeDasharray="4 2"
                strokeWidth={1.5}
                label={{ value: `BEP ${bepPt.value.toFixed(0)}%`, position: "insideTopLeft", fontSize: 9, fill: "#16a34a", fontFamily: "monospace" }}
              />
            );
          })()}

          {/* Operating point Q* vertical line */}
          {cfg.opQ !== undefined && (
            <ReferenceLine
              x={cfg.opQ}
              stroke="#dc2626"
              strokeDasharray="5 3"
              strokeWidth={1.5}
              label={{ value: `Q*=${cfg.opQ.toFixed(1)}`, position: "top", fontSize: 9, fill: "#dc2626", fontFamily: "monospace" }}
            />
          )}
          {/* Operating point value horizontal line */}
          {cfg.opV !== undefined && (
            <ReferenceLine
              y={cfg.opV}
              stroke="#dc2626"
              strokeDasharray="5 3"
              strokeWidth={1.5}
              label={{ value: `${cfg.opV.toFixed(1)}`, position: "right", fontSize: 9, fill: "#dc2626", fontFamily: "monospace" }}
            />
          )}
          {/* Diamond marker at operating point (H-Q chart only) */}
          {cfg.showOpDiamond && cfg.opQ !== undefined && cfg.opV !== undefined && (
            <ReferenceDot
              x={cfg.opQ}
              y={cfg.opV}
              r={0}
              shape={(props: { cx?: number; cy?: number }) => {
                const cx = props.cx ?? 0;
                const cy = props.cy ?? 0;
                const s = 8;
                return (
                  <polygon
                    points={`${cx},${cy - s} ${cx + s},${cy} ${cx},${cy + s} ${cx - s},${cy}`}
                    fill="#dc2626"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                );
              }}
            />
          )}

          <Legend wrapperStyle={{ fontSize: 10, fontFamily: "monospace" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual entry form
// ---------------------------------------------------------------------------

interface ManualPoint { Q: string; value: string }

function parseManualPoints(rows: ManualPoint[]): CurvePoint[] | null {
  const pts: CurvePoint[] = [];
  for (const row of rows) {
    const q = parseFloat(row.Q);
    const v = parseFloat(row.value);
    if (isNaN(q) || isNaN(v)) return null;
    pts.push({ Q_m3h: q, value: v });
  }
  return pts.length >= 2 ? pts : null;
}

interface ManualCurveEditorProps {
  rows: ManualPoint[];
  label: string;
  unit: string;
  onChange: (rows: ManualPoint[]) => void;
}

function ManualCurveEditor({ rows, label, unit, onChange }: ManualCurveEditorProps) {
  const add = () => {
    if (rows.length >= MAX_MANUAL_ROWS) return;
    onChange([...rows, { Q: "", value: "" }]);
  };
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const update = (i: number, key: "Q" | "value", val: string) => {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [key]: val } : r)));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {label} ({unit})
        </span>
        <button
          type="button"
          onClick={add}
          className="text-xs text-teal-600 hover:text-teal-800 font-semibold"
        >
          + Add row
        </button>
      </div>
      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-1 mb-0.5">
          <span className="text-[10px] text-slate-400 font-mono px-1">Q (m³/h)</span>
          <span className="text-[10px] text-slate-400 font-mono px-1">{unit}</span>
        </div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 gap-1 items-center">
            <input
              type="number"
              value={row.Q}
              onChange={(e) => update(i, "Q", e.target.value)}
              className={inputCls}
              placeholder="0"
              step="any"
            />
            <div className="flex gap-1">
              <input
                type="number"
                value={row.value}
                onChange={(e) => update(i, "value", e.target.value)}
                className={inputCls}
                placeholder="0"
                step="any"
              />
              <button
                type="button"
                onClick={() => remove(i)}
                className="text-rose-400 hover:text-rose-600 text-xs px-1"
                title="Remove row"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PumpCurveStep({ systemCurve, staticHeadM, designFlowM3h, designTdhM }: PumpCurveStepProps) {
  const { unitSystem } = useUnitSystem();
  const isUS = unitSystem === "US";

  const [stepState, setStepState] = useState<StepState>("active");
  const [sourceTab, setSourceTab] = useState<SourceTab>("library");

  // Library tab — load on mount, not lazily
  const [libraryPumps, setLibraryPumps] = useState<PumpRecord[]>([]);
  const [pumpsLoaded, setPumpsLoaded] = useState(false);
  const [selectedPumpId, setSelectedPumpId] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    fetchPumpLibrary()
      .then((pumps) => {
        setLibraryPumps(pumps);
        if (pumps.length) setSelectedPumpId(pumps[0].id);
      })
      .catch(() => {/* silently ignore if backend not ready */})
      .finally(() => setPumpsLoaded(true));
  }, []);

  // Derived: unique pump types for filter
  const pumpTypes = Array.from(new Set(libraryPumps.map((p) => p.type)));
  const filteredPumps = typeFilter === "all"
    ? libraryPumps
    : libraryPumps.filter((p) => p.type === typeFilter);

  // Manual tab
  const [hqRows, setHqRows]     = useState<ManualPoint[]>([
    { Q: "0", value: "42" }, { Q: "60", value: "36" },
    { Q: "120", value: "28" }, { Q: "160", value: "18" },
  ]);
  const [etaRows, setEtaRows]   = useState<ManualPoint[]>([]);
  const [pRows, setPRows]       = useState<ManualPoint[]>([]);
  const [npshRows, setNpshRows] = useState<ManualPoint[]>([]);

  // CSV tab
  const csvFileRef = useRef<HTMLInputElement>(null);
  const [csvParsed, setCsvParsed] = useState<{
    hq: CurvePoint[];
    eta_q?: CurvePoint[];
    p_q?: CurvePoint[];
    npshr_q?: CurvePoint[];
  } | null>(null);

  // Arrangement
  const [arrangement, setArrangement] = useState<Arrangement>("single");
  const [nPumps, setNPumps] = useState(1);
  const [staging, setStaging] = useState(false);

  // VFD
  const [vfd, setVfd] = useState(false);
  const [speedPct, setSpeedPct] = useState(100);
  const [speedMin, setSpeedMin] = useState(50);
  const [speedMax, setSpeedMax] = useState(100);

  // NPSH
  const [npsha, setNpsha] = useState<string>("");

  // Static head override (when no system curve from parent)
  const [staticHeadOverride, setStaticHeadOverride] = useState(10);

  // Results
  const [result, setResult] = useState<PumpComputeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When system curve arrives from parent, auto-clear stale result
  useEffect(() => {
    setResult(null);
  }, [systemCurve]);

  // --------------- CSV import ---------------

  const handleCsvUpload = async () => {
    const file = csvFileRef.current?.files?.[0];
    if (!file) { setError("Please select a CSV file."); return; }
    setLoading(true);
    setError(null);
    try {
      const resp = await importPumpCurveCsv(file);
      setCsvParsed(resp.curve_data as typeof csvParsed);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "CSV parse failed.";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
    } finally {
      setLoading(false);
    }
  };

  // --------------- Build request ---------------

  const buildRequest = useCallback((): PumpComputeRequest | null => {
    const resolvedStaticHead = staticHeadM ?? staticHeadOverride;
    const resolvedSystemCurve = systemCurve && systemCurve.length >= 2 ? systemCurve : undefined;

    const common: Omit<PumpComputeRequest, "pump_id" | "curve_data"> = {
      active: true,
      arrangement,
      n_pumps: nPumps,
      staging: staging && arrangement === "parallel",
      vfd,
      speed_pct: speedPct,
      speed_pct_min: speedMin,
      speed_pct_max: speedMax,
      n_speed_steps: 5,
      system_curve_pts: resolvedSystemCurve,
      static_head_m: resolvedStaticHead,
      npsha_m: npsha !== "" ? parseFloat(npsha) : undefined,
    };

    if (sourceTab === "library") {
      if (!selectedPumpId) return null;
      return { ...common, pump_id: selectedPumpId };
    }

    if (sourceTab === "manual") {
      const hqPts = parseManualPoints(hqRows);
      if (!hqPts) return null;
      const etaPts  = etaRows.length  >= 2 ? parseManualPoints(etaRows)   : undefined;
      const pPts    = pRows.length    >= 2 ? parseManualPoints(pRows)     : undefined;
      const npshPts = npshRows.length >= 2 ? parseManualPoints(npshRows)  : undefined;
      return {
        ...common,
        curve_data: {
          hq: hqPts,
          eta_q: etaPts ?? undefined,
          p_q: pPts ?? undefined,
          npshr_q: npshPts ?? undefined,
          interp_method: "linear",
          poly_degree: 2,
        },
      };
    }

    // CSV tab
    if (!csvParsed || !csvParsed.hq?.length) return null;
    return {
      ...common,
      curve_data: {
        hq: csvParsed.hq,
        eta_q: csvParsed.eta_q,
        p_q: csvParsed.p_q,
        npshr_q: csvParsed.npshr_q,
        interp_method: "linear",
        poly_degree: 2,
      },
    };
  }, [
    sourceTab, selectedPumpId, hqRows, etaRows, pRows, npshRows, csvParsed,
    arrangement, nPumps, staging, vfd, speedPct, speedMin, speedMax,
    npsha, systemCurve, staticHeadM, staticHeadOverride,
  ]);

  const handleCompute = useCallback(async () => {
    setError(null);
    const req = buildRequest();
    if (!req) {
      if (sourceTab === "library" && !selectedPumpId) setError("Select a pump from the library.");
      else if (sourceTab === "manual") setError("H-Q table needs ≥ 2 valid numeric rows.");
      else if (sourceTab === "csv") setError("Import a CSV file first.");
      return;
    }
    setLoading(true);
    try {
      const data = await computePump(req);
      setResult(data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Compute error.";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [buildRequest, sourceTab, selectedPumpId]);

  // Auto-recompute when VFD speed changes (if we already have a result)
  useEffect(() => {
    if (result && vfd) {
      handleCompute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speedPct]);

  // ----- Bypass / disabled state -----

  if (stepState !== "active") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between bg-teal-700 px-5 py-3">
          <span className="text-white font-bold text-sm tracking-wide">PUMP CURVES & OPERATING POINT</span>
          <div className="flex rounded overflow-hidden border border-teal-500 text-xs font-semibold">
            {(["active", "bypassed", "disabled"] as StepState[]).map((s) => (
              <button key={s} type="button" onClick={() => setStepState(s)}
                className={`px-3 py-1 capitalize transition-colors ${stepState === s ? "bg-white text-teal-800" : "bg-transparent text-teal-100 hover:bg-teal-600"}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="px-5 py-8 text-center text-sm text-slate-400 font-mono">
          Step {stepState}
        </div>
      </div>
    );
  }

  const primaryOp = result?.operating_points?.[0];
  const resolvedStaticHead = staticHeadM ?? staticHeadOverride;
  const hasIncomingSystemCurve = systemCurve && systemCurve.length >= 2;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-teal-700 px-5 py-3">
        <span className="text-white font-bold text-sm tracking-wide">PUMP CURVES & OPERATING POINT</span>
        <div className="flex rounded overflow-hidden border border-teal-500 text-xs font-semibold">
          {(["active", "bypassed", "disabled"] as StepState[]).map((s) => (
            <button key={s} type="button" onClick={() => setStepState(s)}
              className={`px-3 py-1 capitalize transition-colors ${stepState === s ? "bg-white text-teal-800" : "bg-transparent text-teal-100 hover:bg-teal-600"}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* System curve link status */}
        {hasIncomingSystemCurve && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-2 text-xs text-emerald-700 font-mono">
            ✓ System curve linked from hydraulic calculation ({systemCurve!.length} pts · static head {resolvedStaticHead.toFixed(1)} m)
          </div>
        )}
        {!hasIncomingSystemCurve && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-2 text-xs text-slate-500">
            Run the hydraulic calculation above to link the system curve — or enter static head manually below.
          </div>
        )}

        {/* Source tabs */}
        <div>
          <div className="flex border-b border-slate-200 mb-4">
            {(["library", "manual", "csv"] as SourceTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => { setSourceTab(tab); setResult(null); setError(null); }}
                className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide border-b-2 -mb-px transition-colors ${
                  sourceTab === tab
                    ? "border-teal-600 text-teal-700"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {tab === "library" ? "Library" : tab === "manual" ? "Manual Entry" : "CSV Import"}
              </button>
            ))}
          </div>

          {/* Library tab */}
          {sourceTab === "library" && (
            <div className="space-y-3">
              {/* Type filter */}
              <div>
                <label className={labelCls}>Filter by pump type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => {
                    setTypeFilter(e.target.value);
                    const first = libraryPumps.find(
                      (p) => e.target.value === "all" || p.type === e.target.value
                    );
                    if (first) setSelectedPumpId(first.id);
                  }}
                  className={inputCls}
                >
                  <option value="all">All types</option>
                  {pumpTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              {/* Pump selector */}
              <div>
                <label className={labelCls}>
                  Select pump
                  <span className="ml-1 text-slate-400 normal-case font-normal tracking-normal">
                    ({filteredPumps.length} matching)
                  </span>
                </label>
                {!pumpsLoaded ? (
                  <div className="text-xs text-slate-400 font-mono py-2">Loading pump library…</div>
                ) : (
                  <select
                    value={selectedPumpId}
                    onChange={(e) => { setSelectedPumpId(e.target.value); setResult(null); }}
                    className={inputCls}
                    size={Math.min(4, filteredPumps.length)}
                  >
                    {filteredPumps.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.manufacturer} · {p.rated_flow_m3h} m³/h @ {p.rated_head_m} m
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {selectedPumpId && libraryPumps.length > 0 && (
                <div className="text-xs text-slate-400 font-mono bg-slate-50 rounded px-3 py-1.5">
                  {(() => {
                    const p = libraryPumps.find((x) => x.id === selectedPumpId);
                    return p
                      ? `${p.type} · η=${p.rated_efficiency_pct}% · ${p.rated_power_kW} kW · ${p.rated_speed_rpm} rpm`
                      : "";
                  })()}
                </div>
              )}
            </div>
          )}

          {/* Manual tab */}
          {sourceTab === "manual" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ManualCurveEditor rows={hqRows} label="H-Q (required)" unit="H (m)" onChange={setHqRows} />
              <ManualCurveEditor rows={etaRows} label="η-Q (optional)" unit="η (%)" onChange={setEtaRows} />
              <ManualCurveEditor rows={pRows} label="P-Q (optional)" unit="P (kW)" onChange={setPRows} />
              <ManualCurveEditor rows={npshRows} label="NPSHr-Q (optional)" unit="NPSHr (m)" onChange={setNpshRows} />
            </div>
          )}

          {/* CSV tab */}
          {sourceTab === "csv" && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>CSV file</label>
                <input
                  ref={csvFileRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={() => setCsvParsed(null)}
                  className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:text-slate-600 file:text-xs cursor-pointer"
                />
              </div>
              <button
                type="button"
                onClick={handleCsvUpload}
                disabled={loading}
                className="rounded px-4 py-1.5 bg-slate-700 text-white text-xs font-semibold hover:bg-slate-600 disabled:opacity-50"
              >
                Parse CSV
              </button>
              {csvParsed && (
                <p className="text-xs text-emerald-600 font-mono">
                  ✓ Parsed: {csvParsed.hq?.length ?? 0} H-Q pts
                  {csvParsed.eta_q   ? `, ${csvParsed.eta_q.length} η pts`   : ""}
                  {csvParsed.p_q     ? `, ${csvParsed.p_q.length} P pts`     : ""}
                  {csvParsed.npshr_q ? `, ${csvParsed.npshr_q.length} NPSHr pts` : ""}
                </p>
              )}
              <div className="text-xs text-slate-400 bg-slate-50 rounded p-2 font-mono">
                <p className="font-semibold text-slate-500 mb-1">
                  Expected CSV — first row is header, H_m required, others optional:
                </p>
                <p>Q_m3h,H_m,eta_pct,P_kW,NPSHr_m</p>
                <p>0,42.0,,2.5,1.5</p>
                <p>60,38.5,70.0,9.0,2.1</p>
                <p>120,32.0,82.0,12.8,3.5</p>
              </div>
            </div>
          )}
        </div>

        {/* Arrangement */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-1 mb-3">
            Arrangement
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className={labelCls}>Configuration</label>
              <select value={arrangement} onChange={(e) => setArrangement(e.target.value as Arrangement)} className={inputCls}>
                <option value="single">Single pump</option>
                <option value="parallel">Parallel (identical)</option>
                <option value="series">Series (identical)</option>
              </select>
            </div>
            {arrangement !== "single" && (
              <div>
                <label className={labelCls}>No. pumps</label>
                <input
                  type="number"
                  min={2} max={10} step={1}
                  value={nPumps}
                  onChange={(e) => setNPumps(Math.max(2, parseInt(e.target.value) || 2))}
                  className={inputCls}
                />
              </div>
            )}
            {arrangement === "parallel" && (
              <div className="flex items-center gap-2 pt-5">
                <input
                  type="checkbox"
                  id="staging-cb"
                  checked={staging}
                  onChange={(e) => setStaging(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-teal-600"
                />
                <label htmlFor="staging-cb" className="text-xs text-slate-600">Staging analysis</label>
              </div>
            )}
            {/* Static head override (only shown when no system curve from parent) */}
            {!hasIncomingSystemCurve && (
              <div>
                <label className={labelCls}>Static head (m)</label>
                <input
                  type="number"
                  min={0} step={0.5}
                  value={staticHeadOverride}
                  onChange={(e) => setStaticHeadOverride(parseFloat(e.target.value) || 0)}
                  className={inputCls}
                />
              </div>
            )}
            <div>
              <label className={labelCls}>
                NPSHa (m)
                <span className="text-slate-400 normal-case font-normal ml-1">optional</span>
              </label>
              <input
                type="number"
                min={0} step={0.1}
                value={npsha}
                onChange={(e) => setNpsha(e.target.value)}
                placeholder="e.g. 6.5"
                className={inputCls}
              />
            </div>
          </div>
        </div>

        {/* VFD */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <input
              type="checkbox"
              id="vfd-cb"
              checked={vfd}
              onChange={(e) => setVfd(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600"
            />
            <label htmlFor="vfd-cb" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              VFD (variable-frequency drive)
            </label>
          </div>
          {vfd && (
            <div className="space-y-3 pl-6">
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 font-mono w-28">
                  Speed: {speedPct}%
                </span>
                <input
                  type="range"
                  min={speedMin}
                  max={speedMax}
                  step={1}
                  value={speedPct}
                  onChange={(e) => setSpeedPct(parseInt(e.target.value))}
                  className="flex-1 h-1.5 accent-teal-600"
                />
                <span className="text-xs text-slate-400 font-mono">{speedMin}–{speedMax}%</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Min speed (%)</label>
                  <input type="number" min={10} max={100} value={speedMin}
                    onChange={(e) => { const v = parseInt(e.target.value); setSpeedMin(v); if (v > speedMax) setSpeedMax(v); if (v > speedPct) setSpeedPct(v); }}
                    className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Max speed (%)</label>
                  <input type="number" min={10} max={110} value={speedMax}
                    onChange={(e) => { const v = parseInt(e.target.value); setSpeedMax(v); if (v < speedMin) setSpeedMin(v); if (v < speedPct) setSpeedPct(v); }}
                    className={inputCls} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Compute button */}
        <div className="flex gap-3 items-center">
          <button
            type="button"
            onClick={handleCompute}
            disabled={loading}
            className="rounded-lg px-5 py-2 bg-teal-700 text-white text-sm font-semibold hover:bg-teal-600 disabled:opacity-50 transition-colors"
          >
            {loading ? "Computing…" : "Compute Curves"}
          </button>
          {result && (
            <span className="text-xs text-emerald-600 font-mono font-semibold">✓ Computed</span>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-700 font-mono">
            {error}
          </div>
        )}

        {/* General warnings */}
        {result?.warnings?.map((w, i) => (
          <div key={i} className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800">
            {w}
          </div>
        ))}

        {/* Results */}
        {result && (
          <div className="space-y-4">
            {/* Operating-point summary cards */}
            {result.operating_points.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-1 mb-3">
                  Operating Point{result.operating_points.length > 1 ? "s" : ""}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {result.operating_points.map((op, i) => {
                    const qDevPct = designFlowM3h && designFlowM3h > 0
                      ? ((op.Q_m3h - designFlowM3h) / designFlowM3h) * 100
                      : null;
                    const hDevPct = designTdhM && designTdhM > 0
                      ? ((op.H_m - designTdhM) / designTdhM) * 100
                      : null;
                    return (
                      <div key={i} className={`rounded-lg border p-3 ${op.warnings.length > 0 ? "border-amber-300 bg-amber-50" : "border-teal-300 bg-teal-50"}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-bold text-teal-800 uppercase tracking-wide">
                            {op.n_pumps} pump{op.n_pumps > 1 ? "s" : ""}
                          </span>
                          {op.npsh_margin_m !== null && op.npsh_margin_m !== undefined && (
                            <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${op.warnings.length > 0 ? "bg-amber-200 text-amber-800" : "bg-teal-200 text-teal-800"}`}>
                              NPSH Margin: {op.npsh_margin_m.toFixed(2)} m
                            </span>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs font-mono text-slate-700">
                          <span>
                            Q* = <strong>{op.Q_m3h.toFixed(1)} m³/h</strong>
                            {qDevPct !== null && (
                              <span className={`ml-1 text-[10px] font-semibold ${Math.abs(qDevPct) > 10 ? "text-amber-600" : "text-slate-400"}`}>
                                ({qDevPct >= 0 ? "+" : ""}{qDevPct.toFixed(1)}% vs Q_d)
                              </span>
                            )}
                          </span>
                          <span>
                            H* = <strong>{op.H_m.toFixed(1)} m</strong>
                            {hDevPct !== null && (
                              <span className={`ml-1 text-[10px] font-semibold ${Math.abs(hDevPct) > 10 ? "text-amber-600" : "text-slate-400"}`}>
                                ({hDevPct >= 0 ? "+" : ""}{hDevPct.toFixed(1)}% vs TDH)
                              </span>
                            )}
                          </span>
                          {op.eta_pct !== null && <span>η* = <strong>{op.eta_pct?.toFixed(1)}%</strong></span>}
                          {op.power_kW !== null && (
                            <span>P* = <strong>
                              {isUS
                                ? `${(op.power_kW! * KW_TO_HP).toFixed(1)} hp`
                                : `${op.power_kW?.toFixed(1)} kW`}
                            </strong></span>
                          )}
                          {op.npshr_m !== null && <span>NPSHr* = <strong>{op.npshr_m?.toFixed(2)} m</strong></span>}
                          {op.npsha_m !== null && <span>NPSHa = <strong>{op.npsha_m?.toFixed(2)} m</strong></span>}
                        </div>
                        {(designFlowM3h || designTdhM) && (
                          <div className="mt-2 pt-2 border-t border-teal-200 grid grid-cols-2 gap-x-4 text-[10px] font-mono text-slate-500">
                            {designFlowM3h && <span>Q_design = {designFlowM3h.toFixed(1)} m³/h</span>}
                            {designTdhM && <span>TDH_design = {designTdhM.toFixed(2)} m</span>}
                          </div>
                        )}
                        {op.warnings.map((w, wi) => (
                          <p key={wi} className="text-[10px] text-amber-700 mt-1 leading-snug">{w}</p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4 performance charts */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-1 mb-3">
                Performance Curves
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <PumpChart
                  cfg={{
                    title: "H-Q Curve" + (hasIncomingSystemCurve ? " (with system curve)" : ""),
                    yLabel: "H (m)",
                    color: "#0f766e",
                    data: result.hq_curve,
                    opQ: primaryOp?.Q_m3h,
                    opV: primaryOp?.H_m,
                    speedCurves: vfd ? result.speed_curves : undefined,
                    systemPts: systemCurve,
                    showOpDiamond: true,
                  }}
                />
                <PumpChart
                  cfg={{
                    title: "Efficiency η-Q",
                    yLabel: "η (%)",
                    color: "#0891b2",
                    data: result.eta_curve,
                    opQ: primaryOp?.Q_m3h,
                    opV: primaryOp?.eta_pct ?? undefined,
                    showBep: result.eta_curve.length > 0,
                  }}
                />
                <PumpChart
                  cfg={{
                    title: isUS ? "Shaft Power P-Q (hp)" : "Shaft Power P-Q",
                    yLabel: isUS ? "P (hp)" : "P (kW)",
                    color: "#7c3aed",
                    data: isUS
                      ? result.p_curve.map((pt) => ({ Q_m3h: pt.Q_m3h, value: pt.value * KW_TO_HP }))
                      : result.p_curve,
                    opQ: primaryOp?.Q_m3h,
                    opV: primaryOp?.power_kW != null
                      ? (isUS ? primaryOp.power_kW * KW_TO_HP : primaryOp.power_kW)
                      : undefined,
                  }}
                />
                <PumpChart
                  cfg={{
                    title: "NPSHr-Q" + (npsha !== "" ? " (vs NPSHa)" : ""),
                    yLabel: "NPSHr (m)",
                    color: "#b45309",
                    data: result.npshr_curve,
                    opQ: primaryOp?.Q_m3h,
                    opV: primaryOp?.npshr_m ?? undefined,
                    npshaM: npsha !== "" ? parseFloat(npsha) : undefined,
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
