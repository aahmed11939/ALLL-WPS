import { useState } from "react";
import KaTeXBlock from "./KaTeXBlock";
import type {
  CalculationResponse,
  CalculationRequest,
  PumpComputeResponse,
} from "../utils/api";
import { useUnitSystem } from "../contexts/UnitSystemContext";
import {
  GPM_PER_M3H,
  FT_PER_M,
  IN_PER_MM,
  MM_PER_IN,
  FPS_PER_MS,
  M3S_PER_GPM,
} from "../utils/units";

/** Conversion factors derived from unit constants — never hardcoded literals */
const C_IN_TO_M = MM_PER_IN / 1000;   // exact: 0.0254 m per inch
const C_M_TO_FT = FT_PER_M;           // 3.28084 ft per metre

const G = 9.80665;
const NU = 1.004e-6;

const ROUGHNESS_MM: Record<string, number> = {
  ductile_iron:     0.26,
  cast_iron:        0.26,
  steel:            0.046,
  galvanized_iron:  0.15,
  pvc:              0.0015,
  hdpe:             0.007,
  fiberglass:       0.003,
  concrete:         0.30,
  asbestos_cement:  0.03,
  copper:           0.0015,
};

const MATERIAL_LABELS: Record<string, string> = {
  ductile_iron:     "Ductile Iron",
  cast_iron:        "Cast Iron",
  steel:            "Steel",
  galvanized_iron:  "Galvanized Iron",
  pvc:              "PVC",
  hdpe:             "HDPE",
  fiberglass:       "Fiberglass",
  concrete:         "Concrete",
  asbestos_cement:  "Asbestos Cement",
  copper:           "Copper",
};

function lx(val: number, dec: number = 4): string {
  return val.toFixed(dec);
}

function lxSci(val: number, mantissaDec = 3): string {
  if (val === 0) return "0";
  const abs = Math.abs(val);
  const exp = Math.floor(Math.log10(abs));
  const m = val / Math.pow(10, exp);
  return `${m.toFixed(mantissaDec)} \\times 10^{${exp}}`;
}

function lxInt(val: number): string {
  return Math.round(val)
    .toLocaleString("en-US")
    .replace(/,/g, "{,}");
}

interface EqStep {
  label: string;
  latex: string;
}

interface SectionProps {
  num: number;
  title: string;
  accentClass: string;
  symbol: string;
  steps?: EqStep[];
  result?: { label: string; display: string; si?: string };
  note?: string;
  badge?: string;
  engineering: boolean;
  children?: React.ReactNode;
}

function EqSection({
  num,
  title,
  accentClass,
  symbol,
  steps,
  result,
  note,
  badge,
  engineering,
  children,
}: SectionProps) {
  return (
    <div className={`border-l-4 ${accentClass} pl-4 py-1`}>
      <div className="flex items-baseline gap-2 mb-2 flex-wrap">
        <span className="text-[10px] font-mono font-semibold text-slate-400">
          EQ.{num}
        </span>
        <span className="text-xs font-semibold text-slate-700">{title}</span>
        {badge && (
          <span className="text-[10px] rounded px-1.5 py-0.5 bg-slate-100 text-slate-500 font-semibold">
            {badge}
          </span>
        )}
      </div>

      <div className="bg-slate-50 rounded px-4 py-3 text-center mb-2 overflow-x-auto">
        <KaTeXBlock latex={symbol} display />
      </div>

      {engineering && steps && steps.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-slate-400 font-mono shrink-0 w-24 text-right pt-0.5 text-[10px]">
                {step.label}
              </span>
              <div className="bg-white border border-slate-100 rounded px-2 py-1 overflow-x-auto flex-1 min-w-0">
                <KaTeXBlock latex={step.latex} />
              </div>
            </div>
          ))}
        </div>
      )}

      {result && (
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] font-mono font-semibold text-teal-600 shrink-0">
            RESULT
          </span>
          <div className="bg-teal-50 border border-teal-200 rounded px-3 py-1">
            <span className="font-mono text-sm font-bold text-teal-900">
              {result.label}&nbsp;{result.display}
            </span>
            {result.si && (
              <span className="ml-2 font-mono text-xs text-slate-500">
                = {result.si} (SI)
              </span>
            )}
          </div>
        </div>
      )}

      {children}

      {note && (
        <p className="mt-1.5 text-[10px] text-slate-400 italic leading-relaxed">
          {note}
        </p>
      )}
    </div>
  );
}

interface Props {
  results: CalculationResponse;
  lastReq: CalculationRequest;
  pumpResult?: PumpComputeResponse | null;
}

export default function EquationsPanel({ results, lastReq, pumpResult }: Props) {
  const { unitSystem } = useUnitSystem();
  const isUS = unitSystem === "US";

  const [engineering, setEngineering] = useState<boolean>(() => {
    try {
      return localStorage.getItem("wps-equations-view") !== "basic";
    } catch {
      return true;
    }
  });
  const [open, setOpen] = useState(true);

  const toggleView = (eng: boolean) => {
    setEngineering(eng);
    try {
      localStorage.setItem("wps-equations-view", eng ? "engineering" : "basic");
    } catch {
      /* ignore */
    }
  };

  const D_mm  = lastReq.pipe_diameter_mm;
  const D_m   = D_mm / 1000;
  const L_m   = lastReq.pipe_length_m;
  const Q_m3h = results.design_Q_m3h;
  const Q_m3s = Q_m3h / 3600;
  const v     = results.velocity_ms;
  const Re    = results.reynolds_number;
  const f     = results.friction_factor;
  const A_m2  = Math.PI * D_m * D_m / 4;
  const vh_m  = v * v / (2 * G);

  const eps_mm = ROUGHNESS_MM[lastReq.material] ?? 0.046;
  const epsD   = eps_mm / D_mm;

  const Q_gpm  = Q_m3h * GPM_PER_M3H;
  const D_in   = D_mm  * IN_PER_MM;
  const L_ft   = L_m   * FT_PER_M;
  const v_fps  = v     * FPS_PER_MS;
  const vh_ft  = vh_m  * FT_PER_M;

  const hf_m   = results.friction_head_m;
  const hm_m   = results.minor_head_m;
  const dz_m   = results.static_head_m;
  const tdh_m  = results.tdh_m;

  const hf_d   = isUS ? hf_m  * FT_PER_M : hf_m;
  const hm_d   = isUS ? hm_m  * FT_PER_M : hm_m;
  const dz_d   = isUS ? dz_m  * FT_PER_M : dz_m;
  const tdh_d  = isUS ? tdh_m * FT_PER_M : tdh_m;
  const hU     = isUS ? "\\text{ft}" : "\\text{m}";
  const headUnit = isUS ? "ft" : "m";

  const regime = Re < 2300 ? "Laminar" : Re < 4000 ? "Transitional" : "Turbulent";

  const op       = pumpResult?.operating_points?.[0];
  const hasPump  = !!op;

  const matLabel = MATERIAL_LABELS[lastReq.material] ?? lastReq.material;

  const vhLatex =
    `\\dfrac{v^2}{2g} = \\dfrac{(${lx(v, 4)})^2}{2 \\times 9.807} = ${lx(vh_m, 6)}\\,\\text{m}`;

  const velStepsSI: EqStep[] = [
    {
      label: "Given:",
      latex: `Q = ${lx(Q_m3h, 2)}\\,\\text{m}^3/\\text{h} \\div 3600 = ${lx(Q_m3s, 6)}\\,\\text{m}^3/\\text{s}\\;,\\quad D = ${lx(D_mm, 0)}\\,\\text{mm}`,
    },
    {
      label: "Area:",
      latex: `D = ${lx(D_mm, 0)}\\,\\text{mm} / 1000 = ${lx(D_m, 4)}\\,\\text{m}\\;,\\quad A = \\dfrac{\\pi\\,(${lx(D_m, 4)})^2}{4} = ${lx(A_m2, 7)}\\,\\text{m}^2`,
    },
    {
      label: "Substitute:",
      latex: `v = \\dfrac{${lx(Q_m3s, 6)}}{${lx(A_m2, 7)}}`,
    },
  ];

  const velStepsUS: EqStep[] = [
    {
      label: "Given (US):",
      latex: `Q = ${lx(Q_gpm, 1)}\\,\\text{gpm}\\;,\\quad D = ${lx(D_in, 3)}\\,\\text{in}`,
    },
    {
      label: "SI conv.:",
      latex: `Q = ${lx(Q_gpm, 1)} \\times ${lxSci(M3S_PER_GPM)} = ${lx(Q_m3s, 6)}\\,\\text{m}^3/\\text{s}`,
    },
    {
      label: "SI conv.:",
      latex: `D = ${lx(D_in, 3)}\\,\\text{in} \\times ${C_IN_TO_M.toFixed(4)} = ${lx(D_m, 4)}\\,\\text{m}\\;,\\quad A = ${lx(A_m2, 7)}\\,\\text{m}^2`,
    },
    {
      label: "Substitute:",
      latex: `v = \\dfrac{${lx(Q_m3s, 6)}}{${lx(A_m2, 7)}} = ${lx(v, 4)}\\,\\text{m/s} = ${lx(v_fps, 3)}\\,\\text{fps}`,
    },
  ];

  const reSteps: EqStep[] = [
    {
      label: "Given:",
      latex: `v = ${lx(v, 4)}\\,\\text{m/s}\\;,\\quad D = ${lx(D_m, 4)}\\,\\text{m}\\;,\\quad \\nu = ${lxSci(NU)}\\,\\text{m}^2/\\text{s}`,
    },
    {
      label: "Substitute:",
      latex: `Re = \\dfrac{${lx(v, 4)} \\times ${lx(D_m, 4)}}{${lxSci(NU)}}`,
    },
  ];

  const cwSteps: EqStep[] = [
    {
      label: "Given:",
      latex: `\\varepsilon = ${eps_mm}\\,\\text{mm}\\text{ (${matLabel})}\\;,\\quad D = ${lx(D_mm, 0)}\\,\\text{mm}`,
    },
    {
      label: "\\varepsilon/D:",
      latex: `\\varepsilon/D = ${eps_mm}\\,/\\,${lx(D_mm, 0)} = ${lx(epsD, 7)}`,
    },
    {
      label: "Iterate:",
      latex: `\\dfrac{1}{\\sqrt{f}} = -2\\log_{10}\\!\\left(\\dfrac{${lx(epsD, 7)}}{3.7} + \\dfrac{2.51}{${lxInt(Re)}\\,\\sqrt{f}}\\right)\\;\\text{(converged)}`,
    },
  ];

  const dwStepsSI: EqStep[] = [
    {
      label: "V-head:",
      latex: vhLatex,
    },
    {
      label: "Substitute:",
      latex: `h_f = ${lx(f, 5)} \\times \\dfrac{${lx(L_m, 1)}}{${lx(D_m, 4)}} \\times ${lx(vh_m, 6)}`,
    },
  ];

  const dwStepsUS: EqStep[] = [
    {
      label: "Given (US):",
      latex: `L = ${lx(L_ft, 1)}\\,\\text{ft}\\;,\\quad D = ${lx(D_in, 3)}\\,\\text{in}\\;,\\quad v = ${lx(v_fps, 3)}\\,\\text{fps}`,
    },
    {
      label: "SI values:",
      latex: `L = ${lx(L_m, 1)}\\,\\text{m}\\;,\\quad D = ${lx(D_m, 4)}\\,\\text{m}\\;,\\quad v = ${lx(v, 4)}\\,\\text{m/s}`,
    },
    {
      label: "V-head:",
      latex: vhLatex,
    },
    {
      label: "Substitute:",
      latex: `h_f = ${lx(f, 5)} \\times \\dfrac{${lx(L_m, 1)}}{${lx(D_m, 4)}} \\times ${lx(vh_m, 6)} = ${lx(hf_m, 4)}\\,\\text{m}`,
    },
    {
      label: "Convert:",
      latex: `h_f = ${lx(hf_m, 4)}\\,\\text{m} \\times ${C_M_TO_FT.toFixed(4)} = ${lx(hf_d, 3)}\\,\\text{ft}`,
    },
  ];

  const hmStepsSI: EqStep[] = [
    {
      label: "Given:",
      latex: `\\Sigma K = ${lx(results.K_sum, 3)}\\;,\\quad \\dfrac{v^2}{2g} = ${lx(vh_m, 6)}\\,\\text{m}`,
    },
    {
      label: "Substitute:",
      latex: `h_m = ${lx(results.K_sum, 3)} \\times ${lx(vh_m, 6)}`,
    },
  ];

  const hmStepsUS: EqStep[] = [
    {
      label: "Given:",
      latex: `\\Sigma K = ${lx(results.K_sum, 3)}\\;,\\quad \\dfrac{v^2}{2g} = ${lx(vh_m, 6)}\\,\\text{m}\\;(${lx(vh_ft, 6)}\\,\\text{ft})`,
    },
    {
      label: "Substitute:",
      latex: `h_m = ${lx(results.K_sum, 3)} \\times ${lx(vh_m, 6)} = ${lx(hm_m, 6)}\\,\\text{m} = ${lx(hm_d, 5)}\\,\\text{ft}`,
    },
  ];

  const tdhStepsSI: EqStep[] = [
    {
      label: "Components:",
      latex: `\\Delta z = ${lx(dz_m, 3)}\\,${hU}\\;,\\quad h_f = ${lx(hf_m, 3)}\\,${hU}\\;,\\quad h_m = ${lx(hm_m, 4)}\\,${hU}`,
    },
    {
      label: "Substitute:",
      latex: `TDH = ${lx(dz_m, 3)} + ${lx(hf_m, 3)} + ${lx(hm_m, 4)}`,
    },
  ];

  const tdhStepsUS: EqStep[] = [
    {
      label: "SI components:",
      latex: `\\Delta z = ${lx(dz_m, 3)}\\,\\text{m}\\;,\\quad h_f = ${lx(hf_m, 3)}\\,\\text{m}\\;,\\quad h_m = ${lx(hm_m, 4)}\\,\\text{m}`,
    },
    {
      label: "SI sum:",
      latex: `TDH = ${lx(dz_m, 3)} + ${lx(hf_m, 3)} + ${lx(hm_m, 4)} = ${lx(tdh_m, 3)}\\,\\text{m}`,
    },
    {
      label: "Convert:",
      latex: `TDH = ${lx(tdh_m, 3)}\\,\\text{m} \\times ${C_M_TO_FT.toFixed(4)} = ${lx(tdh_d, 3)}\\,\\text{ft}`,
    },
  ];

  const dynamicLoss = hf_m + hm_m;
  const hfPct = dynamicLoss > 0 ? (hf_m / dynamicLoss * 100).toFixed(1) : "—";

  const dutySteps: EqStep[] = hasPump ? [
    {
      label: "Solution:",
      latex: `Q^* = ${lx(op!.Q_m3h, 2)}\\,\\text{m}^3/\\text{h}\\;,\\quad H^* = ${lx(op!.H_m, 2)}\\,\\text{m}`,
    },
    ...(op!.eta_pct != null
      ? [{ label: "Efficiency:", latex: `\\eta = ${lx(op!.eta_pct!, 1)}\\,\\%` }]
      : []),
    ...(op!.power_kW != null
      ? [{ label: "Shaft power:", latex: `P = ${lx(op!.power_kW!, 2)}\\,\\text{kW}` }]
      : []),
    ...(op!.npsh_margin_m != null
      ? [{ label: "NPSH margin:", latex: `NPSHa - NPSHr = ${lx(op!.npsh_margin_m!, 2)}\\,\\text{m}` }]
      : []),
  ] : [];

  return (
    <div className="rounded-xl border border-teal-200 bg-white shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between bg-teal-700 px-5 py-3 cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-3">
          <span className="text-white font-bold text-sm tracking-wide">
            EQUATIONS &amp; CALCULATION STEPS
          </span>
          <span className="text-[10px] font-mono text-teal-300 bg-teal-800 rounded px-1.5 py-0.5 hidden sm:inline">
            Darcy-Weisbach · Colebrook-White
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex rounded overflow-hidden border border-teal-500 text-xs font-semibold"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => toggleView(false)}
              className={`px-3 py-1 transition-colors ${
                !engineering
                  ? "bg-white text-teal-800"
                  : "bg-transparent text-teal-100 hover:bg-teal-600"
              }`}
            >
              Basic
            </button>
            <button
              type="button"
              onClick={() => toggleView(true)}
              className={`px-3 py-1 border-l border-teal-500 transition-colors ${
                engineering
                  ? "bg-white text-teal-800"
                  : "bg-transparent text-teal-100 hover:bg-teal-600"
              }`}
            >
              Engineering
            </button>
          </div>
          <span className="text-teal-300 text-xs font-mono">{open ? "▲" : "▼"}</span>
        </div>
      </div>

      {open && (
        <div className="p-5 space-y-5">
          {engineering && (
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[10px] font-mono text-slate-500 leading-relaxed">
              <span className="font-semibold text-slate-600">Constants (water, 20 °C):</span>
              {"  "}ν = 1.004×10⁻⁶ m²/s{"  ·  "}ρ = 998.2 kg/m³{"  ·  "}μ = 1.002×10⁻³ Pa·s{"  ·  "}g = 9.807 m/s²
            </div>
          )}

          <EqSection
            num={1}
            title="Pipe Flow Velocity"
            accentClass="border-teal-500"
            symbol={`v = \\dfrac{Q}{A} = \\dfrac{4Q}{\\pi D^2}`}
            steps={isUS ? velStepsUS : velStepsSI}
            result={{
              label: "v =",
              display: isUS ? `${lx(v_fps, 3)} fps` : `${lx(v, 4)} m/s`,
              si: isUS ? `${lx(v, 4)} m/s` : undefined,
            }}
            note={`A = πD²/4 = ${lx(A_m2, 7)} m²  ·  velocity head v²/2g = ${lx(vh_m, 6)} m (${lx(vh_ft, 5)} ft)`}
            engineering={engineering}
          />

          <EqSection
            num={2}
            title="Reynolds Number"
            accentClass="border-teal-500"
            symbol={`Re = \\dfrac{v\\,D}{\\nu}`}
            steps={reSteps}
            result={{
              label: "Re =",
              display: `${Math.round(Re).toLocaleString()} — ${regime}`,
            }}
            note="Always computed in SI. ν = 1.004×10⁻⁶ m²/s (kinematic viscosity, water at 20 °C)."
            engineering={engineering}
          />

          <EqSection
            num={3}
            title="Darcy Friction Factor — Colebrook-White"
            accentClass="border-teal-500"
            symbol={`\\dfrac{1}{\\sqrt{f}} = -2\\log_{10}\\!\\left(\\dfrac{\\varepsilon/D}{3.7} + \\dfrac{2.51}{Re\\,\\sqrt{f}}\\right)`}
            steps={cwSteps}
            result={{
              label: "f =",
              display: lx(f, 5),
            }}
            note={`Solved iteratively to convergence 10⁻⁹. Material: ${matLabel} (ε ≈ ${eps_mm} mm). Re = ${Math.round(Re).toLocaleString()} → ${regime} regime.`}
            engineering={engineering}
          />

          <EqSection
            num={4}
            title="Darcy-Weisbach Friction Head Loss"
            accentClass="border-teal-500"
            symbol={`h_f = f\\,\\dfrac{L}{D}\\,\\dfrac{v^2}{2g}`}
            steps={isUS ? dwStepsUS : dwStepsSI}
            result={{
              label: "h_f =",
              display: `${lx(hf_d, 3)} ${headUnit}`,
              si: isUS ? `${lx(hf_m, 3)} m` : undefined,
            }}
            note={`f·L/D = ${lx(f, 5)} × ${lx(L_m, 1)} / ${lx(D_m, 4)} = ${lx(f * L_m / D_m, 4)}  ·  v²/2g = ${lx(vh_m, 6)} m`}
            engineering={engineering}
          />

          <EqSection
            num={5}
            title="Minor (Fitting) Head Losses"
            accentClass="border-teal-500"
            symbol={`h_m = \\Sigma K \\cdot \\dfrac{v^2}{2g}`}
            steps={isUS ? hmStepsUS : hmStepsSI}
            result={{
              label: "h_m =",
              display: `${lx(hm_d, 4)} ${headUnit}`,
              si: isUS ? `${lx(hm_m, 4)} m` : undefined,
            }}
            note={`ΣK = ${lx(results.K_sum, 3)}  ·  v²/2g = ${lx(vh_m, 6)} m  ·  Friction accounts for ${hfPct}% of dynamic losses`}
            engineering={engineering}
          />

          <EqSection
            num={6}
            title="Total Dynamic Head"
            accentClass="border-teal-500"
            symbol={`TDH = \\Delta z + h_f + h_m`}
            steps={isUS ? tdhStepsUS : tdhStepsSI}
            result={{
              label: "TDH =",
              display: `${lx(tdh_d, 3)} ${headUnit}`,
              si: isUS ? `${lx(tdh_m, 3)} m` : undefined,
            }}
            note={`Static Δz = ${lx(dz_d, 3)} ${headUnit}  ·  Friction h_f = ${lx(hf_d, 3)} ${headUnit}  ·  Minor h_m = ${lx(hm_d, 4)} ${headUnit}`}
            engineering={engineering}
          />

          {/* EQ 7 — Hazen-Williams head-loss reference */}
          <div className="border-l-4 border-slate-300 pl-4 py-1">
            <div className="flex items-baseline gap-2 mb-2 flex-wrap">
              <span className="text-[10px] font-mono font-semibold text-slate-400">EQ.7</span>
              <span className="text-xs font-semibold text-slate-500">
                Hazen-Williams Friction Head Loss
              </span>
              <span className="text-[10px] rounded px-1.5 py-0.5 bg-amber-100 text-amber-700 font-semibold">
                Reference — C&#8203;<sub>HW</sub> not in current form
              </span>
            </div>

            {engineering && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <div className="bg-slate-50 rounded px-3 py-3 text-center overflow-x-auto">
                  <p className="text-[9px] text-slate-400 mb-1.5 uppercase tracking-wide font-semibold">
                    SI — Q [m³/s], D [m], L [m] → h_f [m]
                  </p>
                  <KaTeXBlock
                    latex={`h_f = \\dfrac{10.67\\,L\\,Q^{1.852}}{C_{HW}^{1.852}\\,D^{4.87}}`}
                    display
                  />
                </div>
                <div className="bg-slate-50 rounded px-3 py-3 text-center overflow-x-auto">
                  <p className="text-[9px] text-slate-400 mb-1.5 uppercase tracking-wide font-semibold">
                    US — Q [ft³/s], D [ft], L [ft] → h_f [ft]
                  </p>
                  <KaTeXBlock
                    latex={`h_f = \\dfrac{4.727\\,L\\,Q^{1.852}}{C_{HW}^{1.852}\\,D^{4.87}}`}
                    display
                  />
                </div>
              </div>
            )}

            {!engineering && (
              <div className="bg-slate-50 rounded px-3 py-2 mb-2 overflow-x-auto text-center">
                <KaTeXBlock
                  latex={`h_f = \\dfrac{10.67\\,L\\,Q^{1.852}}{C_{HW}^{1.852}\\,D^{4.87}}\\;\\text{(SI)}`}
                  display
                />
              </div>
            )}

            <p className="text-[10px] text-slate-400 italic leading-relaxed">
              Substituted values require a C_HW roughness coefficient input (add to the form to enable).
              C_HW ranges: 60 (rough/old cast iron) → 100 (new cast/ductile iron) → 140 (new steel) → 150 (PVC/HDPE).
              Valid 10–24 °C. Darcy-Weisbach + Colebrook-White (EQ.4) is the governing method for this calculation —
              H-W shown here as a reference cross-check per AWWA M11.
            </p>
          </div>

          {/* EQ 8 — Affinity Laws */}
          <div className="border-l-4 border-indigo-400 pl-4 py-1">
            <div className="flex items-baseline gap-2 mb-2 flex-wrap">
              <span className="text-[10px] font-mono font-semibold text-indigo-400">EQ.8</span>
              <span className="text-xs font-semibold text-slate-700">
                Pump Affinity Laws (VFD Speed Scaling)
              </span>
            </div>

            <div className="bg-slate-50 rounded px-4 py-3 mb-2 overflow-x-auto text-center">
              <KaTeXBlock
                latex={`\\dfrac{Q_2}{Q_1} = \\dfrac{N_2}{N_1} \\qquad \\dfrac{H_2}{H_1} = \\left(\\dfrac{N_2}{N_1}\\right)^{\\!2} \\qquad \\dfrac{P_2}{P_1} = \\left(\\dfrac{N_2}{N_1}\\right)^{\\!3}`}
                display
              />
            </div>

            {engineering && hasPump && pumpResult!.speed_curves.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {[
                  {
                    label: "Speed ref.:",
                    latex: `N_1 = 100\\%\\;(\\text{rated speed})`,
                  },
                  {
                    label: "Op. point:",
                    latex: `Q^* = ${lx(op!.Q_m3h, 2)}\\,\\text{m}^3/\\text{h}\\;,\\quad H^* = ${lx(op!.H_m, 2)}\\,\\text{m}`,
                  },
                ].map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-slate-400 font-mono shrink-0 w-24 text-right pt-0.5 text-[10px]">
                      {s.label}
                    </span>
                    <div className="bg-white border border-slate-100 rounded px-2 py-1 overflow-x-auto flex-1 min-w-0">
                      <KaTeXBlock latex={s.latex} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!hasPump && (
              <p className="text-[10px] text-slate-400 italic">
                Awaiting pump curve data — compute a pump curve above to see speed-scaled operating points.
              </p>
            )}

            {engineering && (
              <p className="text-[10px] text-slate-400 mt-1 italic leading-relaxed">
                Affinity laws assume geometric similarity and constant efficiency. Valid for speed changes
                within ≈ ±20% of rated speed. Apply to impeller diameter scaling (trim laws) by substituting
                D₂/D₁ for N₂/N₁.
              </p>
            )}
          </div>

          {/* EQ 9 — Duty-point intersection */}
          <div className="border-l-4 border-purple-400 pl-4 py-1">
            <div className="flex items-baseline gap-2 mb-2 flex-wrap">
              <span className="text-[10px] font-mono font-semibold text-purple-400">EQ.9</span>
              <span className="text-xs font-semibold text-slate-700">
                Duty-Point Intersection — System ∩ Pump
              </span>
            </div>

            <div className="bg-slate-50 rounded px-4 py-3 mb-2 overflow-x-auto text-center">
              <KaTeXBlock
                latex={`H_{\\text{sys}}(Q^*) = H_{\\text{pump}}(Q^*) \\quad \\Longrightarrow \\quad Q^*,\\;H^*`}
                display
              />
            </div>

            {engineering && hasPump && (
              <div className="space-y-1.5 mb-2">
                {dutySteps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs">
                    <span className="text-slate-400 font-mono shrink-0 w-24 text-right pt-0.5 text-[10px]">
                      {s.label}
                    </span>
                    <div className="bg-white border border-slate-100 rounded px-2 py-1 overflow-x-auto flex-1 min-w-0">
                      <KaTeXBlock latex={s.latex} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {hasPump && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10px] font-mono font-semibold text-purple-500 shrink-0">
                  RESULT
                </span>
                <div className="bg-purple-50 border border-purple-200 rounded px-3 py-1">
                  <span className="font-mono text-sm font-bold text-purple-900">
                    Q* = {lx(op!.Q_m3h, 2)} m³/h &nbsp;·&nbsp; H* = {lx(op!.H_m, 2)} m
                    {op!.eta_pct != null && ` · η = ${lx(op!.eta_pct, 1)}%`}
                    {op!.power_kW != null && ` · P = ${lx(op!.power_kW, 2)} kW`}
                  </span>
                </div>
              </div>
            )}

            {!hasPump && (
              <p className="text-[10px] text-slate-400 italic">
                Awaiting pump curve data — the intersection Q* and H* will appear once a pump curve is
                computed above.
              </p>
            )}

            {engineering && (
              <p className="text-[10px] text-slate-400 mt-1.5 italic leading-relaxed">
                H_sys(Q) = Δz + h_f(Q) + h_m(Q) constructed from the system curve. Intersection solved by
                bisection on the bracketed root. Pump H-Q curve fitted as quadratic polynomial
                H = A + B·Q + C·Q². Arrangement (parallel / series) scales Q or H before intersection.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
