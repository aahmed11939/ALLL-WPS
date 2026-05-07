import { useState, useEffect, useRef } from "react";
import { useDebounce } from "../../hooks/useDebounce";
import { useProject } from "../../contexts/ProjectContext";
import { useUnitSystem } from "../../contexts/UnitSystemContext";
import TermTip from "../TermTip";
import ResultsPanel from "../ResultsPanel";
import EquationsPanel from "../EquationsPanel";
import LossBreakdownPanel from "../LossBreakdownPanel";
import SystemCurveChart from "../SystemCurveChart";
import ChartErrorBoundary from "../ChartErrorBoundary";
import FieldErrorHint, { parseApiErrors } from "../FieldErrorHint";
import type { FieldError as ApiFieldError } from "../FieldErrorHint";
import {
  calculate,
  computeLossBreakdown,
  computePump,
  type CalculationRequest,
  type LossBreakdownResponse,
} from "../../utils/api";
import { buildPumpReqFromConfig } from "../../utils/pumpUtils";

function expandKValues(items: { count: number; K_override?: number | null; default_K?: number }[]): number[] {
  const ks: number[] = [];
  for (const item of items) {
    const k = item.K_override ?? item.default_K ?? 0;
    for (let i = 0; i < item.count; i++) ks.push(k);
  }
  return ks;
}

export default function StepHydraulics() {
  const { draft, dispatch } = useProject();
  const { unitSystem } = useUnitSystem();

  const [loading, setLoading] = useState(false);
  const [lastReq, setLastReq] = useState<CalculationRequest | null>(null);
  const [breakdown, setBreakdown] = useState<LossBreakdownResponse | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ApiFieldError[]>([]);

  // Debounced auto-recompute (300 ms) when ANY hydraulic input changes.
  // Individual primitive values are used to guarantee reference-stable comparison
  // (avoids JSON.stringify of complex objects which can behave unexpectedly in
  // Strict Mode or when the reducer returns new array references).
  const debouncedFlow   = useDebounce(draft.designFlow_m3h,               300);
  const debouncedUpElev = useDebounce(draft.upstreamNode.elevation_m,      300);
  const debouncedDsElev = useDebounce(draft.downstreamNode.elevation_m,    300);
  const debouncedSKSum  = useDebounce(draft.suction.accessories_K_sum,     300);
  const debouncedDKSum  = useDebounce(draft.discharge.accessories_K_sum,   300);
  // Segment content (diameter/length/material) encoded as primitive strings
  const sSegStr = draft.suction.segments
    .map(s => `${s.length_m}|${s.diameter_mm}|${s.material}`).join(';');
  const dSegStr = draft.discharge.segments
    .map(s => `${s.length_m}|${s.diameter_mm}|${s.material}`).join(';');
  const debouncedSSegs  = useDebounce(sSegStr, 300);
  const debouncedDSegs  = useDebounce(dSegStr, 300);

  const mountedRef = useRef(false);
  const loadingRef  = useRef(loading);
  loadingRef.current = loading;
  // Stable ref so the debounce effect can always call the latest handleCompute
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleComputeRef = useRef<() => void>(() => {});

  const results = draft.hydraulicsResult;
  const error   = draft.hydraulicsError;

  // Auto-recompute 300 ms after any hydraulic input changes (skip initial mount)
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    if (!loadingRef.current) {
      handleComputeRef.current();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedFlow, debouncedUpElev, debouncedDsElev, debouncedSKSum, debouncedDKSum, debouncedSSegs, debouncedDSegs]);

  const handleCompute = async () => {
    setLoading(true);
    setFieldErrors([]);
    dispatch({ type: "SET_HYDRAULICS", result: null, error: null });
    dispatch({ type: "SET_HYDRAULICS_FIELD_ERRORS", errors: [] });
    setBreakdown(null);

    const suctionSegs   = draft.suction.segments;
    const dischargeSegs = draft.discharge.segments;
    const primarySeg    = dischargeSegs[0] ?? suctionSegs[0];

    if (!primarySeg) {
      dispatch({ type: "SET_HYDRAULICS", result: null, error: "No pipeline segments defined." });
      setLoading(false);
      return;
    }

    const totalLength = [...suctionSegs, ...dischargeSegs].reduce((a, s) => a + s.length_m, 0);
    const allItems    = [...draft.suction.accessories, ...draft.discharge.accessories];
    const kValues     = expandKValues(allItems);

    const req: CalculationRequest = {
      Q_m3h:           draft.designFlow_m3h,
      elev_us_m:       draft.upstreamNode.elevation_m,
      elev_ds_m:       draft.downstreamNode.elevation_m,
      pipe_length_m:   totalLength,
      pipe_diameter_mm:primarySeg.diameter_mm,
      material:        primarySeg.material,
      K_values:        kValues,
      unit_system:     unitSystem,
    };
    setLastReq(req);

    try {
      const data = await calculate(req);
      dispatch({ type: "SET_HYDRAULICS", result: data, error: null });

      // Loss breakdown
      const primarySuction   = suctionSegs[0];
      const primaryDischarge = dischargeSegs[0];
      const suctionLength    = suctionSegs.reduce((a, s) => a + s.length_m, 0);
      const dischargeLength  = dischargeSegs.reduce((a, s) => a + s.length_m, 0);

      if (allItems.length > 0 || (primarySuction && primaryDischarge)) {
        const bdReq = {
          Q_m3h:     draft.designFlow_m3h,
          D_mm:      primarySeg.diameter_mm,
          ...(primarySuction && {
            suction: {
              L_m:         suctionLength,
              D_mm:        primarySuction.diameter_mm,
              material:    primarySuction.material,
              accessories: draft.suction.accessories,
            },
          }),
          ...(primaryDischarge && {
            discharge: {
              L_m:         dischargeLength,
              D_mm:        primaryDischarge.diameter_mm,
              material:    primaryDischarge.material,
              accessories: draft.discharge.accessories,
            },
          }),
          unit_system: unitSystem as "SI" | "US",
        };
        try {
          const bd = await computeLossBreakdown(bdReq);
          setBreakdown(bd);
        } catch { /* breakdown is optional */ }
      }

      // Also compute pump operating point from persisted PumpCurveConfig (Step 5),
      // so Step 7 produces a fully-joined hydraulics + pump result in one click.
      const pumpCfg = draft.pumpCurveConfig;
      if (pumpCfg) {
        const sysCurvePts = data.system_curve
          ? (data.system_curve as { Q_m3h: number; H_m: number }[]).map(
              (pt) => ({ Q_m3h: pt.Q_m3h, value: pt.H_m })
            )
          : undefined;
        const pumpReq = buildPumpReqFromConfig(pumpCfg, sysCurvePts, data.static_head_m);
        if (pumpReq) {
          try {
            const pumpData = await computePump(pumpReq);
            dispatch({ type: "SET_PUMP_RESULT", result: pumpData });
          } catch { /* pump compute is optional — don't fail the hydraulics step */ }
        }
      }
    } catch (err: unknown) {
      const responseData = (err as { response?: { data?: unknown } })?.response?.data;
      const parsedFieldErrors = parseApiErrors(responseData);
      setFieldErrors(parsedFieldErrors);
      dispatch({ type: "SET_HYDRAULICS_FIELD_ERRORS", errors: parsedFieldErrors });
      const rawDetail = (responseData as Record<string, unknown> | undefined)?.detail;
      const msg = typeof rawDetail === "string"
        ? rawDetail
        : parsedFieldErrors.length > 0
          ? `${parsedFieldErrors.length} input error(s) — check highlighted fields.`
          : "Unexpected error — check console.";
      dispatch({ type: "SET_HYDRAULICS", result: null, error: msg });
    } finally {
      setLoading(false);
    }
  };

  // Keep the ref up-to-date so the debounce effect always calls the current version
  handleComputeRef.current = handleCompute;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800 mb-1">Hydraulic Results</h2>
          <p className="text-xs text-slate-500">
            Assemble all pipeline inputs and compute TDH, velocity, friction factor,
            and minor losses using Darcy-Weisbach / Colebrook-White (<TermTip term="ε" />).
          </p>
        </div>
        <button
          type="button"
          onClick={handleCompute}
          disabled={loading}
          className="shrink-0 rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {loading && (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          )}
          {loading ? "Computing…" : "Compute Hydraulics"}
        </button>
      </div>

      {/* Inputs summary */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Assembled Inputs
        </p>
        <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-xs">
          <div className="col-span-1">
            <div className={`flex justify-between rounded px-1.5 py-0.5 ${
              fieldErrors.some(e => e.loc.includes("Q_m3h")) ? "bg-rose-50 outline outline-1 outline-rose-400" : ""
            }`}>
              <span className="text-slate-400">Design flow</span>
              <span className="font-mono text-slate-700">{draft.designFlow_m3h.toFixed(2)} m³/h</span>
            </div>
            <FieldErrorHint fieldPath="Q_m3h" errors={fieldErrors} />
          </div>
          <div className="col-span-1">
            <div className={`flex justify-between rounded px-1.5 py-0.5 ${
              fieldErrors.some(e => e.loc.includes("elev_us_m")) ? "bg-rose-50 outline outline-1 outline-rose-400" : ""
            }`}>
              <span className="text-slate-400">Upstream elev.</span>
              <span className="font-mono text-slate-700">{draft.upstreamNode.elevation_m.toFixed(2)} m</span>
            </div>
            <FieldErrorHint fieldPath="elev_us_m" errors={fieldErrors} />
          </div>
          <div className="col-span-1">
            <div className={`flex justify-between rounded px-1.5 py-0.5 ${
              fieldErrors.some(e => e.loc.includes("elev_ds_m")) ? "bg-rose-50 outline outline-1 outline-rose-400" : ""
            }`}>
              <span className="text-slate-400">Downstream elev.</span>
              <span className="font-mono text-slate-700">{draft.downstreamNode.elevation_m.toFixed(2)} m</span>
            </div>
            <FieldErrorHint fieldPath="elev_ds_m" errors={fieldErrors} />
          </div>
          <div className="col-span-1">
            <div className={`flex justify-between rounded px-1.5 py-0.5 ${
              fieldErrors.some(e => e.loc.includes("pipe_diameter_mm")) ? "bg-rose-50 outline outline-1 outline-rose-400" : ""
            }`}>
              <span className="text-slate-400">Pipe diam. (primary)</span>
              <span className="font-mono text-slate-700">
                {(draft.discharge.segments[0] ?? draft.suction.segments[0])?.diameter_mm ?? "—"} mm
              </span>
            </div>
            <FieldErrorHint fieldPath="pipe_diameter_mm" errors={fieldErrors} />
          </div>
          <div className="flex justify-between col-span-1">
            <span className="text-slate-400">Suction segs</span>
            <span className="font-mono text-slate-700">{draft.suction.segments.length}</span>
          </div>
          <div className="flex justify-between col-span-1">
            <span className="text-slate-400">Combined <TermTip term="K">ΣK</TermTip></span>
            <span className="font-mono text-slate-700">
              {(draft.suction.accessories_K_sum + draft.discharge.accessories_K_sum).toFixed(3)}
            </span>
          </div>
        </div>
      </div>

      <ResultsPanel results={results} loading={loading} error={error} />

      {fieldErrors.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-1">
          <p className="text-xs font-semibold text-rose-700">Input errors</p>
          {fieldErrors.map((fe, i) => (
            <p key={i} className="text-xs text-rose-600 font-mono">
              {fe.loc.filter((p) => p !== "body").join(" › ")}: {fe.msg}
            </p>
          ))}
        </div>
      )}

      {results && lastReq && (
        <ChartErrorBoundary label="Equations">
          <EquationsPanel results={results} lastReq={lastReq} />
        </ChartErrorBoundary>
      )}

      {results && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
            System Curve
          </p>
          <ChartErrorBoundary label="System Curve">
            <SystemCurveChart results={results} />
          </ChartErrorBoundary>
        </div>
      )}

      {breakdown && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Hydraulic Loss Breakdown
            <span className="ml-2 font-mono font-normal text-slate-400 normal-case">
              Grand total {breakdown.grand_total_hm_m.toFixed(3)} m
            </span>
          </p>
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
            <ChartErrorBoundary label="Loss Breakdown">
              <LossBreakdownPanel data={breakdown} />
            </ChartErrorBoundary>
          </div>
        </div>
      )}
    </div>
  );
}
