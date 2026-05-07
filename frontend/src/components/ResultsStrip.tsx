import { useProject } from "../contexts/ProjectContext";

export default function ResultsStrip() {
  const { draft } = useProject();
  const r  = draft.hydraulicsResult;
  const pr = draft.pumpResult;
  const op = pr?.operating_points?.[0] ?? null;
  const wh    = draft.waterHammerResult as { max_pressure_head_m?: number; min_pressure_head_m?: number; vapor_pressure_head_m?: number } | null;
  const moc   = draft.mocResult   as { global_max_H_m?: number; global_min_H_m?: number; h_vap_m?: number } | null;
  const surge = draft.suctionSurgeResult as { npsha_min_m?: number; transient_npsh_risk?: boolean } | null;

  const hasData = !!(r || op || wh || moc || surge);
  if (!hasData) return null;

  const us = draft.unitSystem === "US";
  const fmtH = (m: number) => us ? `${(m * 3.28084).toFixed(1)} ft` : `${m.toFixed(2)} m`;
  const fmtQ = (m3h: number) => us ? `${(m3h * 4.40287).toFixed(0)} gpm` : `${m3h.toFixed(1)} m³/h`;

  type StripItem = { label: string; value: string; color?: string };
  const items: StripItem[] = [];

  if (r) {
    items.push({ label: "TDH", value: fmtH(r.tdh_m), color: "text-teal-700" });
    items.push({ label: "v", value: `${r.velocity_ms.toFixed(2)} m/s`,
      color: r.velocity_ms > 3 ? "text-red-600" : r.velocity_ms > 2 ? "text-amber-600" : "text-slate-800" });
    items.push({ label: "Re", value: Math.round(r.reynolds_number).toLocaleString() });
  }

  if (op) {
    items.push({ label: "Q*", value: fmtQ(op.Q_m3h), color: "text-blue-700" });
    items.push({ label: "H*", value: fmtH(op.H_m), color: "text-blue-700" });
    if (op.eta_pct != null)
      items.push({ label: "η", value: `${op.eta_pct.toFixed(1)} %`,
        color: op.eta_pct >= 70 ? "text-emerald-700" : op.eta_pct >= 55 ? "text-amber-600" : "text-red-600" });
    if (op.power_kW != null)
      items.push({ label: "P", value: `${op.power_kW.toFixed(1)} kW` });
    if (op.npsh_margin_m != null)
      items.push({ label: "NPSH margin", value: fmtH(op.npsh_margin_m),
        color: op.npsh_margin_m < 0 ? "text-red-700" : op.npsh_margin_m < 0.5 ? "text-amber-600" : "text-emerald-700" });
  }

  if (wh?.max_pressure_head_m !== undefined) {
    items.push({ label: "Surge max", value: fmtH(wh.max_pressure_head_m), color: "text-red-700" });
    if (wh.min_pressure_head_m !== undefined)
      items.push({
        label: "Surge min", value: fmtH(wh.min_pressure_head_m),
        color:
          wh.vapor_pressure_head_m !== undefined && wh.min_pressure_head_m < wh.vapor_pressure_head_m
            ? "text-red-700"
            : wh.min_pressure_head_m < 0
              ? "text-amber-600"
              : "text-blue-700",
      });
  }

  if (moc?.global_max_H_m !== undefined) {
    items.push({ label: "MOC max", value: fmtH(moc.global_max_H_m), color: "text-red-700" });
    if (moc.global_min_H_m !== undefined)
      items.push({
        label: "MOC min", value: fmtH(moc.global_min_H_m),
        color: moc.h_vap_m !== undefined && moc.global_min_H_m < moc.h_vap_m ? "text-red-700" : "text-blue-700",
      });
  }

  if (surge?.npsha_min_m !== undefined) {
    items.push({
      label: "NPSHa min", value: fmtH(surge.npsha_min_m),
      color: surge.transient_npsh_risk ? "text-red-700" : "text-emerald-700",
    });
  }

  return (
    <div className="shrink-0 border-t border-slate-200 bg-white shadow-[0_-2px_6px_rgba(0,0,0,0.05)]">
      <div className="flex items-center gap-0.5 px-4 py-1.5 overflow-x-auto">
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 shrink-0 mr-2 select-none">
          LIVE RESULTS
        </span>
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && <span className="text-slate-200 text-xs select-none mx-0.5">│</span>}
            <span className="text-[10px] text-slate-400 whitespace-nowrap">{item.label}</span>
            <span className={`text-[11px] font-bold font-mono whitespace-nowrap ${item.color ?? "text-slate-700"}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
