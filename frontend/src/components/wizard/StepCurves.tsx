import { useEffect, useRef } from "react";
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { useProject } from "../../contexts/ProjectContext";
import { useDebounce } from "../../hooks/useDebounce";
import { computePump } from "../../utils/api";
import { buildPumpReqFromConfig } from "../../utils/pumpUtils";
import ChartErrorBoundary from "../ChartErrorBoundary";

interface ChartPt {
  Q: number;
  sys?: number;
  pump?: number;
}

export default function StepCurves() {
  const { draft, dispatch } = useProject();
  const r  = draft.hydraulicsResult;
  const pr = draft.pumpResult;

  // Auto-refresh pump overlay when pump config changes (400 ms debounce)
  const pumpCfgKey = useDebounce(JSON.stringify(draft.pumpCurveConfig), 400);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) { mountedRef.current = true; return; }
    const cfg = draft.pumpCurveConfig;
    if (!cfg) return;
    const sysCurvePts = r?.system_curve
      ? r.system_curve.map((pt) => ({ Q_m3h: pt.Q_m3h, value: pt.H_m }))
      : undefined;
    const req = buildPumpReqFromConfig(cfg, sysCurvePts, r?.static_head_m ?? 0);
    if (!req) return;
    computePump(req)
      .then((result) => dispatch({ type: "SET_PUMP_RESULT", result }))
      .catch(() => { /* silent — pump recompute is optional */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pumpCfgKey]);

  const op = pr?.operating_points?.[0] ?? null;

  // Build merged chart data
  const chartData: ChartPt[] = (() => {
    const map = new Map<number, ChartPt>();

    // System curve
    if (r?.system_curve) {
      for (const pt of r.system_curve) {
        const key = Math.round(pt.Q_m3h * 100) / 100;
        map.set(key, { Q: key, sys: Math.round(pt.H_m * 100) / 100 });
      }
    }

    // Pump H-Q curve
    if (pr?.hq_curve) {
      for (const pt of pr.hq_curve) {
        const key = Math.round(pt.Q_m3h * 100) / 100;
        const existing = map.get(key) ?? { Q: key };
        map.set(key, { ...existing, pump: Math.round(pt.value * 100) / 100 });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.Q - b.Q);
  })();

  const hasSys  = chartData.some((p) => p.sys  !== undefined);
  const hasPump = chartData.some((p) => p.pump !== undefined);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">
          System Curve &amp; Operating Point
        </h2>
        <p className="text-xs text-slate-500">
          Review the system curve (Step 7) overlaid with the pump H-Q curve (Step 5).
          The intersection is the duty operating point Q*, H*.
        </p>
      </div>

      {/* Overlay chart */}
      {!hasSys && !hasPump ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center space-y-2">
          <p className="text-sm font-semibold text-slate-600">No curve data yet</p>
          <p className="text-xs text-slate-400">
            Complete Step 7 (Hydraulic Results → Compute) to generate the system curve,
            and Step 5 (Pump &amp; Curves) to enter H-Q data.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-4">
            H-Q Overlay
          </p>
          <ChartErrorBoundary label="H-Q Overlay">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 20, left: 10, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="Q"
                type="number"
                domain={["auto", "auto"]}
                tickCount={8}
                tickFormatter={(v: number) => v.toFixed(1)}
                label={{ value: "Q (m³/h)", position: "insideBottom", offset: -12, fontSize: 11 }}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                type="number"
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => v.toFixed(1)}
                label={{ value: "H (m)", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white shadow-lg px-3 py-2.5 text-xs space-y-1.5 min-w-[160px]">
                      <p className="font-semibold text-slate-500 border-b border-slate-100 pb-1.5 mb-1">
                        Q = {typeof label === "number" ? label.toFixed(2) : label} m³/h
                      </p>
                      {payload.map((p) => (
                        <div key={p.dataKey as string} className="flex justify-between items-center gap-4">
                          <span className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: p.color }} />
                            <span className="text-slate-600">
                              {p.dataKey === "sys" ? "System" : "Pump H-Q"}
                            </span>
                          </span>
                          <span className="font-bold font-mono text-slate-800">
                            {typeof p.value === "number" ? `${p.value.toFixed(2)} m` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <Legend
                formatter={(val: string) =>
                  val === "sys" ? "System curve" : "Pump H-Q"
                }
              />
              {hasSys && (
                <Line
                  type="monotone"
                  dataKey="sys"
                  stroke="#0d9488"
                  strokeWidth={2.5}
                  dot={false}
                  name="sys"
                  connectNulls
                />
              )}
              {hasPump && (
                <Line
                  type="monotone"
                  dataKey="pump"
                  stroke="#2563eb"
                  strokeWidth={2.5}
                  dot={false}
                  name="pump"
                  connectNulls
                />
              )}
              {op && (
                <>
                  <ReferenceLine
                    x={op.Q_m3h}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{ value: `Q*=${op.Q_m3h.toFixed(1)}`, position: "top", fontSize: 10, fill: "#b45309" }}
                  />
                  <ReferenceLine
                    y={op.H_m}
                    stroke="#f59e0b"
                    strokeDasharray="4 3"
                    strokeWidth={1.5}
                    label={{ value: `H*=${op.H_m.toFixed(1)}`, position: "right", fontSize: 10, fill: "#b45309" }}
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
          </ChartErrorBoundary>
          {!hasSys && hasPump && (
            <p className="mt-2 text-xs text-slate-400 text-center">
              Run Compute on Step 7 to add the system curve.
            </p>
          )}
          {hasSys && !hasPump && (
            <p className="mt-2 text-xs text-slate-400 text-center">
              Enter pump H-Q data on Step 5 to overlay the pump curve.
            </p>
          )}
        </div>
      )}

      {/* Operating point summary */}
      {pr && op ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-3">
            Pump Operating Point
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Metric label="Q*"           value={`${op.Q_m3h.toFixed(2)} m³/h`}       highlight />
            <Metric label="H*"           value={`${op.H_m.toFixed(2)} m`}            highlight />
            <Metric label="η"
              value={op.eta_pct != null ? `${op.eta_pct.toFixed(1)} %` : "—"}
            />
            <Metric label="Power"
              value={op.power_kW != null ? `${op.power_kW.toFixed(2)} kW` : "—"}
            />
            <Metric label="NPSHr"
              value={op.npshr_m != null ? `${op.npshr_m.toFixed(2)} m` : "—"}
            />
            <Metric label="NPSH margin"
              value={op.npsh_margin_m != null ? `${op.npsh_margin_m.toFixed(2)} m` : "—"}
            />
          </div>
          {pr.warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {pr.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>
      ) : (
        hasSys && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <p className="text-sm font-semibold text-slate-600 mb-1">No pump operating point</p>
            <p className="text-xs text-slate-400">
              Enter pump H-Q curves and run compute on Step 5 to find the operating point.
            </p>
          </div>
        )
      )}

      {/* Hydraulic summary if available */}
      {r && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
            Hydraulic Summary
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Metric label="TDH"          value={`${r.tdh_m.toFixed(2)} m`}                       highlight />
            <Metric label="Static head"  value={`${r.static_head_m.toFixed(2)} m`}               />
            <Metric label="Friction hf"  value={`${r.friction_head_m.toFixed(2)} m`}             />
            <Metric label="Minor hm"     value={`${r.minor_head_m.toFixed(2)} m`}                />
            <Metric label="Velocity"     value={`${r.velocity_ms.toFixed(3)} m/s`}               />
            <Metric label="Reynolds No." value={Math.round(r.reynolds_number).toLocaleString()}   />
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`font-mono text-sm font-bold ${highlight ? "text-teal-800" : "text-slate-700"}`}>
        {value}
      </p>
    </div>
  );
}
