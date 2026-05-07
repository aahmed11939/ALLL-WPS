import { useState } from "react";
import { useProject } from "../../contexts/ProjectContext";
import { useUnitSystem } from "../../contexts/UnitSystemContext";
import type { PumpCurveConfig } from "../../types/project";
import ResultsPanel from "../ResultsPanel";
import EquationsPanel from "../EquationsPanel";
import LossBreakdownPanel from "../LossBreakdownPanel";
import SystemCurveChart from "../SystemCurveChart";
import {
  calculate,
  computeLossBreakdown,
  computePump,
  type CalculationRequest,
  type LossBreakdownResponse,
  type PumpComputeRequest,
  type CurvePoint,
} from "../../utils/api";

/** Parse manual-entry rows (Q/value strings) into CurvePoint[]. Returns null on parse failure. */
function parseManualRows(rows: { Q: string; value: string }[]): CurvePoint[] | null {
  const pts = rows.map((r) => ({ Q_m3h: parseFloat(r.Q), value: parseFloat(r.value) }));
  if (pts.some((p) => isNaN(p.Q_m3h) || isNaN(p.value))) return null;
  return pts;
}

/** Build a PumpComputeRequest from persisted PumpCurveConfig + hydraulics results. */
function buildPumpReqFromConfig(
  cfg: PumpCurveConfig,
  systemCurvePts: CurvePoint[] | undefined,
  staticHeadM: number,
): PumpComputeRequest | null {
  const common: Omit<PumpComputeRequest, "pump_id" | "curve_data"> = {
    active: true,
    arrangement: cfg.arrangement,
    n_pumps: cfg.nPumps,
    staging: cfg.staging && cfg.arrangement === "parallel",
    vfd: cfg.vfd,
    speed_pct: cfg.speedPct,
    speed_pct_min: cfg.speedMin,
    speed_pct_max: cfg.speedMax,
    n_speed_steps: 5,
    system_curve_pts: systemCurvePts,
    static_head_m: staticHeadM,
    npsha_m: cfg.npsha !== "" ? parseFloat(cfg.npsha) : undefined,
  };

  if (cfg.sourceTab === "library") {
    if (!cfg.selectedPumpId) return null;
    return { ...common, pump_id: cfg.selectedPumpId };
  }

  if (cfg.sourceTab === "manual") {
    const hqPts = parseManualRows(cfg.hqRows);
    if (!hqPts || hqPts.length < 2) return null;
    return {
      ...common,
      curve_data: {
        hq: hqPts,
        eta_q:   cfg.etaRows.length  >= 2 ? (parseManualRows(cfg.etaRows)  ?? undefined) : undefined,
        p_q:     cfg.pRows.length    >= 2 ? (parseManualRows(cfg.pRows)    ?? undefined) : undefined,
        npshr_q: cfg.npshRows.length >= 2 ? (parseManualRows(cfg.npshRows) ?? undefined) : undefined,
        interp_method: "linear",
        poly_degree: 2,
      },
    };
  }

  return null; // CSV source not reconstructable from config alone
}

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

  const results = draft.hydraulicsResult;
  const error   = draft.hydraulicsError;

  const handleCompute = async () => {
    setLoading(true);
    dispatch({ type: "SET_HYDRAULICS", result: null, error: null });
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
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Unexpected error — check console.";
      dispatch({ type: "SET_HYDRAULICS", result: null, error: typeof msg === "string" ? msg : JSON.stringify(msg) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800 mb-1">Hydraulic Results</h2>
          <p className="text-xs text-slate-500">
            Assemble all pipeline inputs and compute TDH, velocity, friction factor,
            and minor losses using Darcy-Weisbach / Colebrook-White.
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
          <div className="flex justify-between col-span-1">
            <span className="text-slate-400">Design flow</span>
            <span className="font-mono text-slate-700">{draft.designFlow_m3h.toFixed(2)} m³/h</span>
          </div>
          <div className="flex justify-between col-span-1">
            <span className="text-slate-400">Upstream elev.</span>
            <span className="font-mono text-slate-700">{draft.upstreamNode.elevation_m.toFixed(2)} m</span>
          </div>
          <div className="flex justify-between col-span-1">
            <span className="text-slate-400">Downstream elev.</span>
            <span className="font-mono text-slate-700">{draft.downstreamNode.elevation_m.toFixed(2)} m</span>
          </div>
          <div className="flex justify-between col-span-1">
            <span className="text-slate-400">Suction segs</span>
            <span className="font-mono text-slate-700">{draft.suction.segments.length}</span>
          </div>
          <div className="flex justify-between col-span-1">
            <span className="text-slate-400">Discharge segs</span>
            <span className="font-mono text-slate-700">{draft.discharge.segments.length}</span>
          </div>
          <div className="flex justify-between col-span-1">
            <span className="text-slate-400">Combined ΣK</span>
            <span className="font-mono text-slate-700">
              {(draft.suction.accessories_K_sum + draft.discharge.accessories_K_sum).toFixed(3)}
            </span>
          </div>
        </div>
      </div>

      <ResultsPanel results={results} loading={loading} error={error} />

      {results && lastReq && (
        <EquationsPanel results={results} lastReq={lastReq} />
      )}

      {results && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
            System Curve
          </p>
          <SystemCurveChart results={results} />
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
            <LossBreakdownPanel data={breakdown} />
          </div>
        </div>
      )}
    </div>
  );
}
