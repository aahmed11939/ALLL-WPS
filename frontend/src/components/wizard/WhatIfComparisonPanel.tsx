import { useMemo, useState } from "react";
import ChartErrorBoundary from "../ChartErrorBoundary";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { WhatIfResponse, WhatIfRunMetrics } from "../../utils/api";

// ---------------------------------------------------------------------------
// Colour palette — one per scenario
// ---------------------------------------------------------------------------

const PALETTE = [
  "#64748b",  // baseline — slate
  "#2563eb",  // blue
  "#16a34a",  // green
  "#dc2626",  // red
  "#d97706",  // amber
  "#7c3aed",  // violet
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtH(m: number) { return m.toFixed(2) + " m"; }
function fmtP(kPa: number) { return kPa.toFixed(1) + " kPa"; }

function Badge({ ok }: { ok: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold ${
      ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
    }`}>
      {ok ? "None" : "⚠ Risk"}
    </span>
  );
}

function ReductionBadge({ val }: { val: number | null }) {
  if (val === null) return <span className="text-slate-400">—</span>;
  const good = val >= 0;
  return (
    <span className={`font-mono font-semibold ${good ? "text-emerald-700" : "text-red-600"}`}>
      {good ? "▼" : "▲"} {Math.abs(val).toFixed(2)} m
    </span>
  );
}

function PctBadge({ val }: { val: number | null }) {
  if (val === null) return <span className="text-slate-400">—</span>;
  const good = val >= 0;
  return (
    <span className={`text-xs font-bold ${good ? "text-emerald-700" : "text-red-600"}`}>
      {good ? "−" : "+"}{Math.abs(val).toFixed(1)} %
    </span>
  );
}

function RiskDeltaBadge({
  run,
  baseline,
}: {
  run: WhatIfRunMetrics;
  baseline: WhatIfRunMetrics;
}) {
  const cavImproved = baseline.cavitation_risk && !run.cavitation_risk;
  const cavNeutral  = !baseline.cavitation_risk && !run.cavitation_risk;
  const pressureImproved = run.global_max_H_m < baseline.global_max_H_m * 0.99;
  const vacuumImproved   = run.global_min_H_m > baseline.global_min_H_m + 0.5;
  const anyPressureImproved = pressureImproved || vacuumImproved;

  // Green: both pressure and cavitation improve
  if ((cavImproved || cavNeutral) && anyPressureImproved) {
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold bg-emerald-100 text-emerald-700">✓ Better</span>;
  }
  // Yellow: at least one dimension improves
  if (cavImproved || anyPressureImproved) {
    return <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-700">~ Mixed</span>;
  }
  // Grey: no meaningful improvement
  return <span className="text-slate-400 text-[9px]">— No change</span>;
}

// ---------------------------------------------------------------------------
// Sizing summary drawer
// ---------------------------------------------------------------------------

function SizingDrawer({ sizing, label }: { sizing: Record<string, unknown> | null; label: string }) {
  const [open, setOpen] = useState(false);
  if (!sizing) return null;

  const skip = new Set(["notes"]);
  const notes = sizing["notes"] as string | undefined;

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen(v => !v)}
        className="text-[9px] font-semibold text-blue-600 hover:underline"
      >
        {open ? "▲ hide sizing" : "▼ sizing"}
      </button>
      {open && (
        <div className="mt-1 rounded border border-slate-200 bg-slate-50 p-2 space-y-1">
          <p className="text-[9px] font-bold text-slate-700">{label} — Preliminary Sizing</p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px]">
            {Object.entries(sizing).filter(([k]) => !skip.has(k)).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-slate-500 truncate">{k}</dt>
                <dd className="font-mono font-semibold text-slate-800">
                  {typeof v === "number" ? v.toFixed(3) : String(v)}
                </dd>
              </div>
            ))}
          </dl>
          {notes && (
            <p className="text-[9px] text-slate-500 leading-snug border-t border-slate-200 pt-1 mt-1">
              {notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WhatIfComparisonPanelProps {
  result: WhatIfResponse;
  /** Called when user clicks "Save to Report" */
  onSaveToReport?: (result: WhatIfResponse) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WhatIfComparisonPanel({ result, onSaveToReport }: WhatIfComparisonPanelProps) {
  // ── Separate valid runs from failed runs ──────────────────────────────────
  const errorRuns = result.device_runs.filter(r => r.run_error);
  const validRuns = result.device_runs.filter(r => !r.run_error);
  const all       = [result.baseline, ...validRuns];

  // ── Build overlay chart data (using valid runs only) ─────────────────────
  const chartData = useMemo(() => {
    if (!result.baseline.envelope.length) return [];
    const ref = result.baseline.envelope;
    return ref.map((pt, i) => {
      const row: Record<string, number> = { x_m: pt.x_m, elev_m: pt.elev_m };
      all.forEach((run, ri) => {
        const e = run.envelope[i];
        if (e) {
          row[`max_${ri}`] = e.H_max_m;
          row[`min_${ri}`] = e.H_min_m;
        }
      });
      return row;
    });
  }, [result]);  // eslint-disable-line react-hooks/exhaustive-deps

  const [showMin, setShowMin] = useState(false);
  const [savedOk, setSavedOk] = useState(false);

  function handleSave() {
    onSaveToReport?.(result);
    setSavedOk(true);
    setTimeout(() => setSavedOk(false), 3000);
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Device configuration errors ─────────────────────────────────────── */}
      {errorRuns.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-1.5">
          <p className="text-xs font-bold text-red-800">
            {errorRuns.length} device scenario{errorRuns.length > 1 ? "s" : ""} could not be computed
          </p>
          {errorRuns.map((r, i) => (
            <div key={i} className="text-[10px] text-red-700 flex gap-2">
              <span className="font-semibold shrink-0">{r.label}:</span>
              <span className="break-words">{r.run_error}</span>
            </div>
          ))}
          <p className="text-[9px] text-red-500">
            These runs are excluded from all numeric comparisons below.
          </p>
        </div>
      )}

      {/* ── Header row ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-800">What-If Comparison Results</p>
          <p className="text-[10px] text-slate-500">
            {result.device_runs.length} device scenario{result.device_runs.length !== 1 ? "s" : ""} vs baseline
            — T_char = {result.T_char_s.toFixed(2)} s · t_total = {result.t_total_s.toFixed(1)} s
          </p>
        </div>
        {onSaveToReport && (
          <button
            onClick={handleSave}
            className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold transition-colors ${
              savedOk
                ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                : "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
            }`}
          >
            {savedOk ? "✓ Saved to report" : "Save to report"}
          </button>
        )}
      </div>

      {/* ── Comparison table ───────────────────────────────────────────────── */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-[10px] text-left">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-3 py-2 font-semibold text-slate-600">Scenario</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Max H</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Max P</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Min H</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Surge Reduction</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Envelope Δ%</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-center">Cavitation</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Min P (kPa)</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-right">Risk Duration</th>
              <th className="px-3 py-2 font-semibold text-slate-600 text-center">Risk Δ</th>
              <th className="px-3 py-2 font-semibold text-slate-600">Sizing</th>
            </tr>
          </thead>
          <tbody>
            {all.map((run, ri) => {
              const isBase  = ri === 0;
              const color   = PALETTE[ri] ?? "#64748b";
              const devRisk  = run.cavitation_risk ?? false;
              return (
                <tr key={ri} className={`border-b border-slate-100 ${isBase ? "bg-slate-50/80" : "bg-white hover:bg-slate-50/40"}`}>
                  <td className="px-3 py-2 font-semibold" style={{ color }}>
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                      <span className="truncate max-w-[160px]" title={run.label}>{run.label}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <span className={run.global_max_H_m > (result.baseline.global_max_H_m * 1.05) ? "text-red-600" : ""}>
                      {fmtH(run.global_max_H_m)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-500">{fmtP(run.global_max_P_kPa)}</td>
                  <td className="px-3 py-2 text-right font-mono text-slate-600">{fmtH(run.global_min_H_m)}</td>
                  <td className="px-3 py-2 text-right">
                    {isBase ? <span className="text-slate-400">—</span> : <ReductionBadge val={run.max_surge_reduction_m} />}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isBase
                      ? <span className="text-slate-400">—</span>
                      : <PctBadge val={run.envelope_reduction_pct} />}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Badge ok={!devRisk} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[9px]">
                    <span className={run.global_min_P_kPa < 0 ? "text-red-600 font-semibold" : "text-slate-600"}>
                      {fmtP(run.global_min_P_kPa)}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[9px]">
                    {devRisk
                      ? <span className="text-red-600 font-semibold">~{run.risk_duration_s.toFixed(2)} s</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {isBase
                      ? <span className="text-slate-400 text-[9px]">base</span>
                      : <RiskDeltaBadge run={run} baseline={result.baseline} />}
                  </td>
                  <td className="px-3 py-2">
                    {!isBase && <SizingDrawer sizing={run.sizing_summary} label={run.label} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Chart toggle ───────────────────────────────────────────────────── */}
      <div className="flex gap-2 text-[10px]">
        <button
          onClick={() => setShowMin(false)}
          className={`rounded px-3 py-1 font-semibold border transition-colors ${
            !showMin ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-400"
          }`}
        >
          Max head (H_max) envelope
        </button>
        <button
          onClick={() => setShowMin(true)}
          className={`rounded px-3 py-1 font-semibold border transition-colors ${
            showMin ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-600 border-slate-200 hover:border-blue-400"
          }`}
        >
          Min head (H_min) envelope
        </button>
      </div>

      {/* ── Overlay chart ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-[10px] font-bold text-slate-600 mb-3">
          {showMin ? "Minimum head envelope — column separation risk" : "Maximum head envelope — overpressure risk"}
        </p>
        <ChartErrorBoundary label="Surge Comparison">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="x_m" tick={{ fontSize: 9 }} tickFormatter={v => `${v} m`} label={{ value: "Distance (m)", position: "insideBottomRight", offset: -4, fontSize: 9 }} />
            <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${v.toFixed(0)}`}
              label={{ value: "Head (m)", angle: -90, position: "insideLeft", offset: 10, fontSize: 9 }} />
            <Tooltip
              formatter={(val, name) => {
                const idx = parseInt(String(name).split("_")[1]);
                const label = all[idx]?.label ?? String(name);
                return [`${(Number(val) || 0).toFixed(2)} m`, label];
              }}
              contentStyle={{ fontSize: 10 }}
            />
            <Legend formatter={(value: string) => {
              const idx = parseInt(value.split("_")[1]);
              return <span style={{ fontSize: 9 }}>{all[idx]?.label ?? value}</span>;
            }} />
            {/* Elevation reference */}
            <Line type="monotone" dataKey="elev_m" stroke="#94a3b8" strokeDasharray="4 2"
              dot={false} strokeWidth={1} name="elev_m" legendType="none" />
            {/* One line per scenario */}
            {all.map((_, ri) => (
              <Line
                key={ri}
                type="monotone"
                dataKey={showMin ? `min_${ri}` : `max_${ri}`}
                stroke={PALETTE[ri] ?? "#64748b"}
                strokeWidth={ri === 0 ? 2.5 : 1.5}
                strokeDasharray={ri === 0 ? undefined : "5 3"}
                dot={false}
                name={showMin ? `min_${ri}` : `max_${ri}`}
              />
            ))}
            {/* h=0 reference line */}
            <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="2 2" />
          </LineChart>
        </ResponsiveContainer>
        </ChartErrorBoundary>
        <p className="text-[9px] text-slate-400 mt-2 text-center">
          Dashed lines = protection device scenarios · Solid grey = baseline · Dotted grey = pipe elevation
        </p>
      </div>

      {/* ── Engineering notes ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-1">
        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Engineering notes</p>
        {result.assumption_notes.slice(0, 3).map((n, i) => (
          <p key={i} className="text-[9px] text-slate-500 leading-snug flex gap-1">
            <span className="text-slate-400 shrink-0">•</span>
            <span>{n}</span>
          </p>
        ))}
        <p className="text-[9px] text-amber-700 font-semibold mt-1">
          All sizing estimates are ±30–50 %. Verify with full dynamic surge analysis per AS 2941 / AWWA M11.
        </p>
      </div>
    </div>
  );
}
