import type { PumpCurveConfig } from "../types/project";
import type { CurvePoint, PumpComputeRequest } from "./api";

export function parseManualRows(rows: { Q: string; value: string }[]): CurvePoint[] | null {
  const pts = rows.map((r) => ({ Q_m3h: parseFloat(r.Q), value: parseFloat(r.value) }));
  if (pts.some((p) => isNaN(p.Q_m3h) || isNaN(p.value))) return null;
  return pts;
}

export function buildPumpReqFromConfig(
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

  return null;
}
