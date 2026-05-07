import { useState, useRef, useEffect } from "react";

const GLOSSARY: Record<string, { title: string; body: string; ref?: string }> = {
  "Hazen-C": {
    title: "Hazen-Williams C coefficient",
    body: "Empirical roughness coefficient used in the Hazen-Williams formula for gravitational flow in full pipes. C = 150 = smooth (PVC/HDPE); C = 130 = ductile iron; C = 100 = old cast iron. Not valid for non-water fluids or Reynolds < 10⁵.",
    ref: "AWWA M11",
  },
  "ε": {
    title: "Absolute roughness ε (epsilon)",
    body: "Physical height of pipe wall irregularities used in Darcy-Weisbach / Colebrook-White. ε = 0.046 mm (steel), 0.12 mm (DI), 0.0015 mm (PVC/HDPE). Determines friction factor f at high Reynolds numbers.",
    ref: "Moody (1944)",
  },
  "roughness": {
    title: "Pipe wall roughness ε",
    body: "See ε. Used in Colebrook-White: 1/√f = −2 log(ε/(3.7D) + 2.51/(Re√f)). For smooth pipe (ε→0) at high Re, f depends only on Reynolds number.",
    ref: "Colebrook-White (1939)",
  },
  "K": {
    title: "Minor loss coefficient K",
    body: "Dimensionless factor for localised (minor) head losses: h_m = K·V²/(2g). Sum all fittings: gate valve (K≈0.1 open), elbow 90° (K≈0.9), tee (K≈1.8). Use manufacturer data for control valves.",
    ref: "Idelchik (2008)",
  },
  "NPSHa": {
    title: "Net Positive Suction Head available (NPSHa)",
    body: "NPSHa = (P_abs − P_vap)/(ρg) + v²/(2g) + z_suction. It must exceed NPSHr (pump manufacturer's required NPSH) plus safety margin (typically +0.5 m to +1.0 m) to prevent cavitation.",
    ref: "HI 9.6.1-2012",
  },
  "NPSHr": {
    title: "Net Positive Suction Head required (NPSHr)",
    body: "Minimum suction head (absolute, above vapour pressure) from the pump curve at which the pump generates the rated head without more than 3% head drop from cavitation. Specified by the pump manufacturer at each duty point.",
    ref: "ISO 9906 / ANSI/HI 9.6.1",
  },
  "wave speed": {
    title: "Water-hammer wave speed a (celerity)",
    body: "Speed at which a pressure wave travels in the pipe: a = √(K/ρ / (1 + K·D/(E·e))). Typical values: 900–1400 m/s (steel), 300–500 m/s (HDPE). Lower a → smaller Joukowsky surge but longer T_char = 2L/a.",
    ref: "Wylie & Streeter (1993)",
  },
  "TDH": {
    title: "Total Dynamic Head (TDH)",
    body: "TDH = static head + friction loss + minor losses + velocity head difference. The total head the pump must overcome. Select a pump whose H-Q curve intersects the system curve at the design flow Q.",
    ref: "AWWA M11",
  },
  "Joukowsky": {
    title: "Joukowsky surge ΔH",
    body: "First-order estimate of instantaneous valve closure or pump trip surge: ΔH = ±a·ΔV/g. For instantaneous pump trip: ΔH = a·V₀/g. Valid when closure time < T_char = 2L/a (rapid closure). Use MOC for real behaviour.",
    ref: "Joukowsky (1900)",
  },
  "Courant": {
    title: "Courant–Friedrichs–Lewy (CFL) condition",
    body: "Numerical stability criterion for MOC: Cr = a·Δt/Δx = 1.0 (exact). If Cr ≠ 1, interpolation introduces numerical dispersion. The MOC solver enforces Cr = 1 by choosing Δx = L/N and Δt = Δx/a.",
    ref: "Chaudhry (2014)",
  },
  "h_vap": {
    title: "Vapour pressure head h_vap",
    body: "Absolute vapour pressure of water converted to head: h_vap = P_vap(T)/(ρg). At 20 °C, P_vap ≈ 2.34 kPa → h_vap ≈ 0.24 m (gauge). When piezometric head drops below h_vap, water flashes to vapour — column separation.",
    ref: "ASHRAE Fundamentals",
  },
};

interface TermTipProps {
  term: keyof typeof GLOSSARY | string;
  children: React.ReactNode;
}

export default function TermTip({ term, children }: TermTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const entry = GLOSSARY[term];

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!entry) return <>{children}</>;

  return (
    <span ref={ref} className="relative inline-block">
      <span
        role="button"
        tabIndex={0}
        onClick={() => setOpen(v => !v)}
        onKeyDown={e => e.key === "Enter" && setOpen(v => !v)}
        className="cursor-help border-b border-dashed border-slate-400 hover:border-blue-500 hover:text-blue-700 transition-colors outline-none"
        aria-label={`Definition of ${term}`}
      >
        {children}
      </span>
      {open && (
        <span
          className="absolute left-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-slate-200 bg-white shadow-xl p-3.5 text-left"
          style={{ minWidth: "260px" }}
        >
          <p className="text-xs font-bold text-slate-800 mb-1 leading-snug">{entry.title}</p>
          <p className="text-[11px] text-slate-600 leading-relaxed">{entry.body}</p>
          {entry.ref && (
            <p className="mt-2 text-[10px] text-slate-400 font-mono border-t border-slate-100 pt-1.5">
              Ref: {entry.ref}
            </p>
          )}
          <button
            onClick={e => { e.stopPropagation(); setOpen(false); }}
            className="absolute top-2 right-2 text-slate-300 hover:text-slate-500 text-sm leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </span>
      )}
    </span>
  );
}
