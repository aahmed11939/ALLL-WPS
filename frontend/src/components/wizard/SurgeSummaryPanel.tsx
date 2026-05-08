import { useProject } from "../../contexts/ProjectContext";
import { PSI_PER_KPA } from "../../utils/units";

// ---------------------------------------------------------------------------
// Risk level helpers
// ---------------------------------------------------------------------------

type RiskLevel = "ok" | "caution" | "critical";

interface RiskItem {
  label: string;
  value: string;
  status: RiskLevel;
  note?: string;
}

function riskLevel(items: RiskItem[]): RiskLevel {
  if (items.some(i => i.status === "critical")) return "critical";
  if (items.some(i => i.status === "caution"))  return "caution";
  return "ok";
}

const LEVEL_STYLE: Record<RiskLevel, {
  bg: string; border: string; badge: string; icon: string; label: string;
}> = {
  ok:       { bg: "bg-emerald-50",  border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-700", icon: "✓", label: "ACCEPTABLE" },
  caution:  { bg: "bg-amber-50",    border: "border-amber-200",   badge: "bg-amber-100 text-amber-700",     icon: "⚠", label: "CAUTION"     },
  critical: { bg: "bg-red-50",      border: "border-red-200",     badge: "bg-red-100 text-red-700",         icon: "✗", label: "CRITICAL"    },
};

const MITIGATIONS: Record<RiskLevel, string[]> = {
  ok: [
    "System is within acceptable surge limits — no surge protection required at this stage.",
    "Verify assumptions: wave speed, pipe material, and steady-state operating point.",
    "Document results and retain for detailed design review.",
  ],
  caution: [
    "Review valve closure timing — slow closure (t_c > 2L/a) significantly reduces surge.",
    "Confirm NPSHa margin ≥ 0.5 m above NPSHr at all operating points.",
    "Consider surge anticipator valves or pressure relief valves on discharge main.",
    "Check if sub-atmospheric pressures risk air ingress at high points.",
  ],
  critical: [
    "Surge protection is required — do not proceed to detailed design without mitigation.",
    "Consider: hydropneumatic surge vessel (bladder tank) on discharge side.",
    "Evaluate: variable-speed drive (VSD) for soft start/stop to reduce ΔV.",
    "Review pump trip time — motor flywheel or hydraulic coupling can extend coast-down.",
    "Check: vacuum break valves or air release valves at pipeline high points.",
    "NPSHa margin below zero → suction line redesign or clearwell LWL increase required.",
    "Engage surge specialist for detailed MOC / Suter-curve analysis.",
  ],
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RiskRow({ item }: { item: RiskItem }) {
  const colors: Record<RiskLevel, string> = {
    ok:       "text-emerald-700 bg-emerald-100",
    caution:  "text-amber-700  bg-amber-100",
    critical: "text-red-700    bg-red-100",
  };
  return (
    <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-700 leading-tight">{item.label}</p>
        {item.note && <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{item.note}</p>}
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-1">
        <span className="font-mono text-xs font-bold text-slate-800">{item.value}</span>
        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${colors[item.status]}`}>
          {item.status === "ok" ? "OK" : item.status === "caution" ? "CAUTION" : "CRITICAL"}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SurgeSummaryPanel() {
  const { draft } = useProject();
  const us = draft.unitSystem === "US";

  const whrQ  = draft.waterHammerResult;   // discharge quick (Mode A)
  const mocR  = draft.mocResult;           // discharge MOC (Mode B)
  const suctR = draft.suctionSurgeResult;  // suction MOC + NPSHa

  const fmtH = (m: number) => us ? `${(m * 3.28084).toFixed(2)} ft` : `${m.toFixed(2)} m`;
  const fmtP = (kPa: number) => us ? `${(kPa * PSI_PER_KPA).toFixed(1)} psi` : `${kPa.toFixed(1)} kPa`;

  // ── Build risk items from available results ────────────────────────────────

  const items: RiskItem[] = [];

  // Discharge Mode A results
  if (whrQ) {
    const dP = whrQ.delta_P_kPa;
    const minH = whrQ.min_pressure_head_m;
    const vapH = whrQ.vapor_pressure_head_m;
    items.push({
      label: "Discharge ΔP (Quick)",
      value: fmtP(dP),
      status: dP > 500 ? "critical" : dP > 200 ? "caution" : "ok",
      note:  "Joukowsky effective surge pressure (Mode A)",
    });
    items.push({
      label: "Min discharge head (Quick)",
      value: fmtH(minH),
      status: minH < vapH ? "critical" : minH < 0 ? "caution" : "ok",
      note:  minH < vapH ? "Below vapour pressure — column separation risk" : minH < 0 ? "Sub-atmospheric — air ingress risk" : undefined,
    });
    if (whrQ.rating_check) {
      const fos = whrQ.rating_check.factor_of_safety;
      items.push({
        label: "Discharge pipe FoS (Mode A)",
        value: isFinite(fos) ? fos.toFixed(3) : "∞",
        status: fos < 1.0 ? "critical" : fos < 1.25 ? "caution" : "ok",
        note:  `PN ${(whrQ.rating_check.pressure_rating_kPa / 100).toFixed(0)} bar — FoS = PN / P_max`,
      });
    }
  }

  // Discharge MOC results
  if (mocR) {
    const maxH = mocR.global_max_H_m;
    const minH = mocR.global_min_H_m;
    const vapH = mocR.h_vap_m;
    items.push({
      label: "Discharge max head (MOC)",
      value: fmtH(maxH),
      status: maxH > 150 ? "critical" : maxH > 80 ? "caution" : "ok",
      note:  "Global maximum transient HGL (Method of Characteristics)",
    });
    items.push({
      label: "Discharge min head (MOC)",
      value: fmtH(minH),
      status: minH < vapH ? "critical" : minH < 0 ? "caution" : "ok",
      note:  minH < vapH ? "Column separation — vapour pocket formation" : minH < 0 ? "Sub-atmospheric — air ingress risk" : undefined,
    });
    if (mocR.cavitation_x_m.length > 0) {
      items.push({
        label: "Column separation nodes (MOC)",
        value: `${mocR.cavitation_x_m.length} node${mocR.cavitation_x_m.length > 1 ? "s" : ""}`,
        status: "critical",
        note:  `x = ${mocR.cavitation_x_m.slice(0, 3).map(x => `${x.toFixed(0)} m`).join(", ")}${mocR.cavitation_x_m.length > 3 ? " …" : ""}`,
      });
    }
    if (mocR.rating_check) {
      const fos = mocR.rating_check.factor_of_safety;
      items.push({
        label: "Discharge pipe FoS (MOC)",
        value: isFinite(fos) ? fos.toFixed(3) : "∞",
        status: fos < 1.0 ? "critical" : fos < 1.25 ? "caution" : "ok",
        note:  `PN ${(mocR.rating_check.pressure_rating_kPa / 100).toFixed(0)} bar — FoS = PN / P_max`,
      });
    }
  }

  // Suction NPSHa results
  if (suctR) {
    const npshaMin = suctR.npsha_min_m;
    const risk     = suctR.transient_npsh_risk;
    items.push({
      label: "Suction NPSHa minimum",
      value: fmtH(npshaMin),
      status: risk ? "critical" : npshaMin < (suctR.NPSHr_m ?? 0) + 0.5 ? "caution" : "ok",
      note:  risk
        ? `NPSHa < NPSHr for ${suctR.npsha_risk_duration_s.toFixed(2)} s — cavitation at pump inlet`
        : "Adequate available NPSH during transient",
    });
    if (suctR.npsha_margin_min_m !== null) {
      const margin = suctR.npsha_margin_min_m;
      items.push({
        label: "NPSHa transient margin",
        value: fmtH(margin),
        status: margin < 0 ? "critical" : margin < 0.5 ? "caution" : "ok",
        note:  `NPSHa_min − NPSHr. NPSHr = ${suctR.NPSHr_m?.toFixed(1) ?? "N/A"} m`,
      });
    }
    if (suctR.cavitation_x_m.length > 0) {
      items.push({
        label: "Column separation (suction)",
        value: `${suctR.cavitation_x_m.length} node${suctR.cavitation_x_m.length > 1 ? "s" : ""}`,
        status: "critical",
        note:  `h_vap reached at x = ${suctR.cavitation_x_m.slice(0, 3).map(x => `${x.toFixed(0)} m`).join(", ")}`,
      });
    }
  }

  // No results yet
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-6 text-center">
        <p className="text-xs font-semibold text-slate-500 mb-1">Surge Summary — No Results Yet</p>
        <p className="text-[10px] text-slate-400 max-w-sm mx-auto leading-relaxed">
          Run Quick (Mode A) or MOC analyses on the Suction and Discharge tabs above.
          A combined risk assessment with mitigation recommendations will appear here.
        </p>
      </div>
    );
  }

  const overall  = riskLevel(items);
  const styleCfg = LEVEL_STYLE[overall];

  return (
    <div className={`rounded-xl border ${styleCfg.border} ${styleCfg.bg} p-5 space-y-5`}>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-bold text-slate-700">Surge Risk Summary</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Combined assessment — suction NPSHa + discharge surge
          </p>
        </div>
        <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${styleCfg.badge}`}>
          {styleCfg.icon} {styleCfg.label}
        </span>
      </div>

      {/* Risk items table */}
      <div className="rounded-lg border border-white/60 bg-white/70 px-4 py-2 divide-y divide-slate-100">
        {items.map((item, i) => (
          <RiskRow key={i} item={item} />
        ))}
      </div>

      {/* Mitigations */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">
          Recommended Actions
        </p>
        <ul className="space-y-1.5">
          {MITIGATIONS[overall].map((m, i) => (
            <li key={i} className="text-[10px] leading-relaxed text-slate-600 flex gap-1.5">
              <span className={`shrink-0 mt-0.5 ${
                overall === "critical" ? "text-red-400"
                : overall === "caution"  ? "text-amber-500"
                : "text-emerald-500"
              }`}>
                {overall === "ok" ? "✓" : "•"}
              </span>
              <span>{m}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Data provenance note */}
      <div className="text-[9px] text-slate-400 leading-relaxed border-t border-slate-200/60 pt-3">
        Sources:{" "}
        {whrQ  && "Discharge Quick (Mode A) · "}
        {mocR  && "Discharge MOC (Mode B) · "}
        {suctR && "Suction MOC + NPSHa Transient · "}
        Results are engineering screening estimates only.
        Full detailed design requires project-specific surge specialist review.
      </div>
    </div>
  );
}
