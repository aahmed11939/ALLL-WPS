import { useProject } from "../../contexts/ProjectContext";
import SystemCurveChart from "../SystemCurveChart";

export default function StepCurves() {
  const { draft } = useProject();
  const r  = draft.hydraulicsResult;
  const pr = draft.pumpResult;

  const op = pr?.operating_points?.[0] ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">System Curve &amp; Operating Point</h2>
        <p className="text-xs text-slate-500">
          Review the system curve and pump operating point. Run hydraulic compute on Step 7
          and pump curves on Step 5 to populate this view.
        </p>
      </div>

      {!r && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <p className="text-sm font-semibold text-slate-600 mb-1">No hydraulic results</p>
          <p className="text-xs text-slate-400">
            Complete Step 7 (Hydraulic Results) to generate the system curve.
          </p>
        </div>
      )}

      {r && (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              System Curve
            </p>
            <SystemCurveChart results={r} />
          </div>

          {/* Key hydraulic summary */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
              Hydraulic Summary
            </p>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <Metric label="TDH"          value={`${r.tdh_m.toFixed(2)} m`}                     highlight />
              <Metric label="Static head"  value={`${r.static_head_m.toFixed(2)} m`}             />
              <Metric label="Friction hf"  value={`${r.friction_head_m.toFixed(2)} m`}           />
              <Metric label="Minor hm"     value={`${r.minor_head_m.toFixed(2)} m`}              />
              <Metric label="Velocity"     value={`${r.velocity_ms.toFixed(3)} m/s`}             />
              <Metric label="Reynolds No." value={Math.round(r.reynolds_number).toLocaleString()} />
            </div>
          </div>
        </>
      )}

      {/* Pump operating point */}
      {pr && op ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-3">
            Pump Operating Point
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <Metric label="Q*"            value={`${op.Q_m3h.toFixed(2)} m³/h`}       highlight />
            <Metric label="H*"            value={`${op.H_m.toFixed(2)} m`}            highlight />
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
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
          <p className="text-sm font-semibold text-slate-600 mb-1">No pump operating point</p>
          <p className="text-xs text-slate-400">
            Enter pump curves and run compute on Step 5 to see the operating point.
          </p>
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
