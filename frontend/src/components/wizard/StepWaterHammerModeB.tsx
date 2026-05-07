import { useState, useCallback, useEffect, useMemo } from "react";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  LineChart,
} from "recharts";
import { useProject } from "../../contexts/ProjectContext";
import { computeMOC } from "../../utils/api";
import type { MOCResponse, MOCBoundaryInput, MOCBoundaryAInput, MOCBoundaryBInput, PressureRatingCheck } from "../../utils/api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const G = 9.81;

const OBS_COLORS = ["#2563eb", "#dc2626", "#16a34a"];

const MATERIAL_ROUGHNESS: Record<string, number> = {
  dicl: 0.00012,
  grey_cast_iron: 0.00025,
  steel: 0.000046,
  pvc_upvc: 0.0000015,
  pvc: 0.0000015,
  hdpe_pe100: 0.0000015,
  grp_frp: 0.00003,
  asbestos_cement: 0.0001,
  concrete_rccp: 0.0003,
};

const UPSTREAM_BC_TYPES = [
  {
    value: "pump_trip",
    label: "Pump Trip",
    desc: "Pump power failure — head decays quadratically, check valve closes",
  },
  {
    value: "reservoir",
    label: "Reservoir / Fixed HGL",
    desc: "Constant-head source (suction wet well or fixed supply)",
  },
];

const DOWNSTREAM_BC_TYPES = [
  {
    value: "reservoir",
    label: "Reservoir / Fixed HGL",
    desc: "Constant-head destination (discharge tank or distribution main)",
  },
  {
    value: "valve_closure",
    label: "Valve Closure",
    desc: "Gate or butterfly valve closure at discharge terminus",
  },
  {
    value: "suction_pump_trip",
    label: "Suction Pump Trip",
    desc: "Pump demand collapses — suction pipeline downstream boundary",
  },
];

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-slate-600 mb-1">
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-[10px] text-slate-400 leading-tight">{children}</p>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
      {children}
    </div>
  );
}

function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Grid3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-3">{children}</div>;
}

function SummaryCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: "red" | "amber" | "green" | "blue";
}) {
  const colors = {
    red:   "bg-red-50 border-red-200",
    amber: "bg-amber-50 border-amber-200",
    green: "bg-emerald-50 border-emerald-200",
    blue:  "bg-blue-50 border-blue-200",
  };
  const cls = highlight ? colors[highlight] : "bg-slate-50 border-slate-200";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-slate-800 font-mono">{value}</p>
    </div>
  );
}

function MOCRatingPanel({ rc, us }: { rc: PressureRatingCheck; us: boolean }) {
  const fmtP2 = (kPa: number) =>
    us ? `${(kPa * 0.14504).toFixed(1)} psi` : `${kPa.toFixed(1)} kPa`;

  const statusCfg = {
    pass:    { bg: "bg-emerald-50 border-emerald-200", badge: "bg-emerald-100 text-emerald-700", icon: "✓", text: "PASS" },
    caution: { bg: "bg-amber-50 border-amber-200",    badge: "bg-amber-100 text-amber-700",     icon: "⚠", text: "CAUTION" },
    fail:    { bg: "bg-red-50 border-red-200",        badge: "bg-red-100 text-red-700",         icon: "✗", text: "FAIL" },
  }[rc.rating_status];

  const fosColor =
    rc.factor_of_safety >= 1.25 ? "text-emerald-700"
    : rc.factor_of_safety >= 1.0 ? "text-amber-700"
    : "text-red-700";

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${statusCfg.bg}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-700">
          Pipe rating: <span className="font-mono">{fmtP2(rc.pressure_rating_kPa)}</span>
        </p>
        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${statusCfg.badge}`}>
          {statusCfg.icon} {statusCfg.text}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500">Max transient (MOC)</span>
          <span className="font-mono font-semibold text-slate-800">{fmtP2(rc.max_transient_kPa)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Pipe pressure class</span>
          <span className="font-mono font-semibold text-slate-800">{fmtP2(rc.pressure_rating_kPa)}</span>
        </div>
        <div className="flex justify-between col-span-2 border-t border-slate-200 pt-1.5 mt-0.5">
          <span className="text-slate-600 font-semibold">FoS = PN / P_max</span>
          <span className={`font-mono font-bold text-sm ${fosColor}`}>
            {isFinite(rc.factor_of_safety) ? rc.factor_of_safety.toFixed(3) : "∞"}
          </span>
        </div>
      </div>
      <p className="text-[10px] text-slate-500 leading-tight">
        {rc.rating_status === "pass" &&
          "FoS ≥ 1.25 — pipe pressure class provides adequate margin."}
        {rc.rating_status === "caution" &&
          "1.0 ≤ FoS < 1.25 — marginal. Consider surge protection or a higher PN class."}
        {rc.rating_status === "fail" &&
          "FoS < 1.0 — peak transient EXCEEDS pipe pressure class. Surge protection required."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boundary-condition panel
// ---------------------------------------------------------------------------

interface BCPanelState {
  type: string;
  H_m: string;
  H_pump_m: string;
  Q_m3s: string;
  t_trip_s: string;
  H_reservoir_m: string;
  t_close_s: string;
  profile: string;
  H_sump_m: string;
}

interface BCPanelHandlers {
  setType: (v: string) => void;
  setH_m: (v: string) => void;
  setH_pump_m: (v: string) => void;
  setQ_m3s: (v: string) => void;
  setT_trip_s: (v: string) => void;
  setH_reservoir_m: (v: string) => void;
  setT_close_s: (v: string) => void;
  setProfile: (v: string) => void;
  setH_sump_m: (v: string) => void;
}

function BCPanel({
  panelLabel,
  typeOptions,
  state,
  handlers,
}: {
  panelLabel: string;
  typeOptions: { value: string; label: string; desc: string }[];
  state: BCPanelState;
  handlers: BCPanelHandlers;
}) {
  const inp =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400";

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
      <p className="text-xs font-semibold text-slate-700">{panelLabel}</p>

      <div>
        <Label>Boundary type</Label>
        <select
          value={state.type}
          onChange={e => handlers.setType(e.target.value)}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {typeOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <Hint>{typeOptions.find(o => o.value === state.type)?.desc}</Hint>
      </div>

      {state.type === "reservoir" && (
        <div>
          <Label>Reservoir total head H [m]</Label>
          <input
            type="number" step={0.5}
            value={state.H_m}
            onChange={e => handlers.setH_m(e.target.value)}
            placeholder="e.g. 5"
            className={inp}
          />
          <Hint>Piezometric head = elevation + pressure head above datum</Hint>
        </div>
      )}

      {state.type === "pump_trip" && (
        <>
          <Grid2>
            <div>
              <Label>Pump head H_pump [m]</Label>
              <input type="number" step={0.5} value={state.H_pump_m}
                onChange={e => handlers.setH_pump_m(e.target.value)}
                placeholder="e.g. 40" className={inp} />
              <Hint>Steady-state total pump head (≈ TDH)</Hint>
            </div>
            <div>
              <Label>Flow Q₀ [m³/s]</Label>
              <input type="number" step={0.001} min={0} value={state.Q_m3s}
                onChange={e => handlers.setQ_m3s(e.target.value)}
                placeholder="e.g. 0.06" className={inp} />
            </div>
          </Grid2>
          <Grid2>
            <div>
              <Label>Trip time t_trip [s]</Label>
              <input type="number" step={0.1} min={0.01} value={state.t_trip_s}
                onChange={e => handlers.setT_trip_s(e.target.value)}
                placeholder="e.g. 2" className={inp} />
              <Hint>Pump coast-down inertia time</Hint>
            </div>
            <div>
              <Label>Suction reservoir head [m]</Label>
              <input type="number" step={0.5} value={state.H_reservoir_m}
                onChange={e => handlers.setH_reservoir_m(e.target.value)}
                placeholder="e.g. 5" className={inp} />
              <Hint>Post-trip reference head at suction source</Hint>
            </div>
          </Grid2>
        </>
      )}

      {state.type === "valve_closure" && (
        <>
          <Grid2>
            <div>
              <Label>Flow Q₀ [m³/s]</Label>
              <input type="number" step={0.001} min={0} value={state.Q_m3s}
                onChange={e => handlers.setQ_m3s(e.target.value)}
                placeholder="e.g. 0.06" className={inp} />
            </div>
            <div>
              <Label>Closure time t_c [s]</Label>
              <input type="number" step={0.5} min={0.01} value={state.t_close_s}
                onChange={e => handlers.setT_close_s(e.target.value)}
                placeholder="e.g. 10" className={inp} />
              <Hint>Full-travel closure time</Hint>
            </div>
          </Grid2>
          <div>
            <Label>Closure profile</Label>
            <div className="flex gap-2">
              {[
                { v: "linear",           l: "Linear  (Q ∝ τ²)" },
                { v: "equal_percentage", l: "Equal-pct  (Q ∝ τ⁴)" },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => handlers.setProfile(opt.v)}
                  className={`flex-1 text-[10px] rounded py-1.5 font-semibold border transition-colors ${
                    state.profile === opt.v
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-400"
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {state.type === "suction_pump_trip" && (
        <>
          <Grid2>
            <div>
              <Label>Sump head H_sump [m]</Label>
              <input type="number" step={0.5} value={state.H_sump_m}
                onChange={e => handlers.setH_sump_m(e.target.value)}
                placeholder="e.g. 5" className={inp} />
              <Hint>Total piezometric head at pump inlet</Hint>
            </div>
            <div>
              <Label>Flow Q₀ [m³/s]</Label>
              <input type="number" step={0.001} min={0} value={state.Q_m3s}
                onChange={e => handlers.setQ_m3s(e.target.value)}
                placeholder="e.g. 0.06" className={inp} />
            </div>
          </Grid2>
          <div>
            <Label>Trip time t_trip [s]</Label>
            <input type="number" step={0.1} min={0.01} value={state.t_trip_s}
              onChange={e => handlers.setT_trip_s(e.target.value)}
              placeholder="e.g. 2" className={inp} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Observation point slider
// ---------------------------------------------------------------------------

function ObsSlider({
  idx,
  frac,
  label,
  pipeLen,
  onFrac,
  onLabel,
}: {
  idx: number;
  frac: string;
  label: string;
  pipeLen: number;
  onFrac: (v: string) => void;
  onLabel: (v: string) => void;
}) {
  const f = parseFloat(frac);
  const x = isNaN(f) ? 0 : f * pipeLen;
  return (
    <div className="grid grid-cols-[1fr_56px_1fr] gap-3 items-center">
      <div>
        <input
          type="text"
          value={label}
          onChange={e => onLabel(e.target.value)}
          placeholder={`Point ${idx + 1}`}
          className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>
      <div className="text-center">
        <p className="text-[10px] font-mono font-semibold text-slate-700">{(isNaN(f) ? 0 : f).toFixed(2)}</p>
        <p className="text-[9px] text-slate-400">{x.toFixed(0)} m</p>
      </div>
      <div>
        <input
          type="range" min={0} max={1} step={0.01}
          value={isNaN(f) ? 0 : f}
          onChange={e => onFrac(e.target.value)}
          className="w-full accent-indigo-600"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Mode B component
// ---------------------------------------------------------------------------

export default function StepWaterHammerModeB() {
  const { draft, dispatch } = useProject();
  const us  = draft.unitSystem === "US";
  const cfg = draft.mocConfig;

  const autoQ0_m3s = (draft.hydraulicsResult?.design_Q_m3h ?? draft.designFlow_m3h) / 3600;
  const autoH0_m   = draft.hydraulicsResult?.tdh_m
    ?? Math.abs(draft.downstreamNode.elevation_m - draft.upstreamNode.elevation_m);
  const waveSpeedFromA = draft.waterHammerConfig?.wave_speed_ms ?? 1000;

  const dischSegs = draft.discharge.segments;
  const suctSegs  = draft.suction.segments;
  const pipelineLen = (segs: typeof dischSegs) =>
    segs.reduce((s, sg) => s + sg.length_m, 0);

  // ── Form state ────────────────────────────────────────────────────────────
  const [pipeline,    setPipeline]    = useState<"suction" | "discharge">(cfg?.pipeline ?? "discharge");
  const [waveSpeed,   setWaveSpeed]   = useState(String(cfg?.wave_speed_ms ?? waveSpeedFromA));
  const [q0Str,       setQ0Str]       = useState(cfg?.Q_0_m3s_override ?? "");
  const [h0Str,       setH0Str]       = useState(cfg?.H_0_m_override ?? "");
  const [rhoStr,      setRhoStr]      = useState(cfg?.rho_kg_m3 ?? "1000");
  const [tempStr,     setTempStr]     = useState(cfg?.temperature_C ?? "20");
  const [pressRating, setPressRating] = useState(cfg?.pressure_rating_kPa ?? "");
  const [nReaches,    setNReaches]    = useState(cfg?.n_reaches ?? "");
  const [tTotalStr,   setTTotalStr]   = useState(cfg?.t_total_s ?? "");

  // Boundary A — typed as `string` so state setters match BCPanelHandlers.(v: string) => void
  const initA = cfg?.boundary_A;
  const [bcAType,    setBcAType]    = useState<string>(initA?.type ?? "pump_trip");
  const [bcA_H_m,    setBcA_H_m]    = useState<string>(initA?.H_m ?? "5");
  const [bcA_Hpump,  setBcA_Hpump]  = useState<string>(initA?.H_pump_m ?? "");
  const [bcA_Q,      setBcA_Q]      = useState<string>(initA?.Q_m3s ?? "");
  const [bcA_tTrip,  setBcA_tTrip]  = useState<string>(initA?.t_trip_s ?? "2");
  const [bcA_Hres,   setBcA_Hres]   = useState<string>(initA?.H_reservoir_m ?? "5");
  const [bcA_tClose, setBcA_tClose] = useState<string>(initA?.t_close_s ?? "10");
  const [bcA_prof,   setBcA_prof]   = useState<string>(initA?.profile ?? "linear");
  const [bcA_Hsump,  setBcA_Hsump]  = useState<string>(initA?.H_sump_m ?? "5");

  // Boundary B — typed as `string` so state setters match BCPanelHandlers.(v: string) => void
  const initB = cfg?.boundary_B;
  const [bcBType,    setBcBType]    = useState<string>(initB?.type ?? "reservoir");
  const [bcB_H_m,    setBcB_H_m]    = useState<string>(initB?.H_m ?? "35");
  const [bcB_Hpump,  setBcB_Hpump]  = useState<string>(initB?.H_pump_m ?? "");
  const [bcB_Q,      setBcB_Q]      = useState<string>(initB?.Q_m3s ?? "");
  const [bcB_tTrip,  setBcB_tTrip]  = useState<string>(initB?.t_trip_s ?? "2");
  const [bcB_Hres,   setBcB_Hres]   = useState<string>(initB?.H_reservoir_m ?? "5");
  const [bcB_tClose, setBcB_tClose] = useState<string>(initB?.t_close_s ?? "10");
  const [bcB_prof,   setBcB_prof]   = useState<string>(initB?.profile ?? "linear");
  const [bcB_Hsump,  setBcB_Hsump]  = useState<string>(initB?.H_sump_m ?? "5");

  // Observation points
  const [obs0Frac,  setObs0Frac]  = useState(cfg?.obs_points?.[0]?.frac  ?? "0");
  const [obs0Label, setObs0Label] = useState(cfg?.obs_points?.[0]?.label ?? "Upstream");
  const [obs1Frac,  setObs1Frac]  = useState(cfg?.obs_points?.[1]?.frac  ?? "0.5");
  const [obs1Label, setObs1Label] = useState(cfg?.obs_points?.[1]?.label ?? "Midpoint");
  const [obs2Frac,  setObs2Frac]  = useState(cfg?.obs_points?.[2]?.frac  ?? "1");
  const [obs2Label, setObs2Label] = useState(cfg?.obs_points?.[2]?.label ?? "Downstream");

  // Compute state
  const [computing, setComputing] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [result,    setResult]    = useState<MOCResponse | null>(draft.mocResult ?? null);

  // ── Derived ────────────────────────────────────────────────────────────────
  const q0     = parseFloat(q0Str)   || autoQ0_m3s;
  const h0     = parseFloat(h0Str)   || autoH0_m;
  const rho    = parseFloat(rhoStr)  || 1000;
  const temp   = parseFloat(tempStr) || 20;
  const a      = parseFloat(waveSpeed) || waveSpeedFromA;
  const segs   = pipeline === "discharge" ? dischSegs : suctSegs;
  const pipeLen = pipelineLen(segs);

  // ── Persist config ─────────────────────────────────────────────────────────
  const persistConfig = useCallback(() => {
    dispatch({
      type: "SET_MOC_CONFIG",
      config: {
        pipeline,
        wave_speed_ms:     a,
        Q_0_m3s_override:  q0Str,
        H_0_m_override:    h0Str,
        rho_kg_m3:         rhoStr,
        temperature_C:     tempStr,
        pressure_rating_kPa: pressRating,
        boundary_A: {
          type: bcAType as "reservoir" | "pump_trip" | "valve_closure" | "suction_pump_trip",
          H_m: bcA_H_m, H_pump_m: bcA_Hpump, Q_m3s: bcA_Q, t_trip_s: bcA_tTrip,
          H_reservoir_m: bcA_Hres, t_close_s: bcA_tClose,
          profile: bcA_prof as "linear" | "equal_percentage", H_sump_m: bcA_Hsump,
        },
        boundary_B: {
          type: bcBType as "reservoir" | "pump_trip" | "valve_closure" | "suction_pump_trip",
          H_m: bcB_H_m, H_pump_m: bcB_Hpump, Q_m3s: bcB_Q, t_trip_s: bcB_tTrip,
          H_reservoir_m: bcB_Hres, t_close_s: bcB_tClose,
          profile: bcB_prof as "linear" | "equal_percentage", H_sump_m: bcB_Hsump,
        },
        obs_points: [
          { frac: obs0Frac, label: obs0Label },
          { frac: obs1Frac, label: obs1Label },
          { frac: obs2Frac, label: obs2Label },
        ],
        n_reaches: nReaches,
        t_total_s: tTotalStr,
      },
    });
  }, [
    pipeline, a, q0Str, h0Str, rhoStr, tempStr, pressRating,
    bcAType, bcA_H_m, bcA_Hpump, bcA_Q, bcA_tTrip, bcA_Hres, bcA_tClose, bcA_prof, bcA_Hsump,
    bcBType, bcB_H_m, bcB_Hpump, bcB_Q, bcB_tTrip, bcB_Hres, bcB_tClose, bcB_prof, bcB_Hsump,
    obs0Frac, obs0Label, obs1Frac, obs1Label, obs2Frac, obs2Label,
    nReaches, tTotalStr, dispatch,
  ]);

  useEffect(() => { persistConfig(); }, [persistConfig]);

  // ── Build boundary condition from state ─────────────────────────────────────
  function buildBC(
    type: string,
    H_m: string, Hpump: string, Q_str: string,
    tTrip: string, Hres: string, tClose: string,
    profile: string, Hsump: string,
  ): MOCBoundaryInput | null {
    const Q = parseFloat(Q_str) || q0;
    if (type === "reservoir") {
      const H = parseFloat(H_m);
      if (isNaN(H)) return null;
      return { type: "reservoir", H_m: H };
    }
    if (type === "pump_trip") {
      const Hp = parseFloat(Hpump) || h0;
      const tt = parseFloat(tTrip);
      if (isNaN(tt) || tt <= 0) return null;
      return {
        type: "pump_trip",
        H_pump_m: Hp, Q_m3s: Q, t_trip_s: tt,
        H_reservoir_m: parseFloat(Hres) || 0,
      };
    }
    if (type === "valve_closure") {
      const tc = parseFloat(tClose);
      if (isNaN(tc) || tc <= 0) return null;
      return {
        type: "valve_closure",
        Q_m3s: Q, t_close_s: tc,
        profile: profile as "linear" | "equal_percentage",
      };
    }
    if (type === "suction_pump_trip") {
      const Hs = parseFloat(Hsump);
      const tt = parseFloat(tTrip);
      if (isNaN(Hs) || isNaN(tt) || tt <= 0) return null;
      return { type: "suction_pump_trip", H_sump_m: Hs, Q_m3s: Q, t_trip_s: tt };
    }
    return null;
  }

  // ── Compute handler ─────────────────────────────────────────────────────────
  async function handleCompute() {
    setError(null);
    if (pipeLen <= 0) {
      setError("Pipeline length is zero — configure segments first (Step 3).");
      return;
    }
    if (a <= 0) {
      setError("Wave speed must be positive.");
      return;
    }
    if (q0 <= 0) {
      setError("Flow rate Q₀ must be positive. Run Hydraulics first or enter manually.");
      return;
    }

    const bcA = buildBC(bcAType, bcA_H_m, bcA_Hpump, bcA_Q, bcA_tTrip, bcA_Hres, bcA_tClose, bcA_prof, bcA_Hsump);
    const bcB = buildBC(bcBType, bcB_H_m, bcB_Hpump, bcB_Q, bcB_tTrip, bcB_Hres, bcB_tClose, bcB_prof, bcB_Hsump);

    if (!bcA) { setError("Boundary A configuration is incomplete — check required fields."); return; }
    if (!bcB) { setError("Boundary B configuration is incomplete — check required fields."); return; }

    const elevA   = draft.upstreamNode.elevation_m;
    const elevB   = draft.downstreamNode.elevation_m;
    const totalLen = segs.reduce((s, sg) => s + sg.length_m, 0) || 1;
    let cumLen = 0;
    const builtSegs = segs.map((sg) => {
      const fracStart  = cumLen / totalLen;
      const elevStart  = elevA + fracStart * (elevB - elevA);
      cumLen          += sg.length_m;
      const fracEnd    = cumLen / totalLen;
      const elevEnd    = elevA + fracEnd   * (elevB - elevA);
      return {
        L_m:          sg.length_m,
        D_m:          sg.diameter_mm / 1000,
        roughness_m:  MATERIAL_ROUGHNESS[sg.material] ?? 1e-4,
        elev_start_m: elevStart,
        elev_end_m:   elevEnd,
      };
    });

    const ratingV = parseFloat(pressRating);
    const nR = parseInt(nReaches) || undefined;
    const tT = parseFloat(tTotalStr) || undefined;

    setComputing(true);
    try {
      const res = await computeMOC({
        pipeline,
        wave_speed_ms: a,
        Q_0_m3s: q0,
        H_0_m: h0,
        temperature_C: temp,
        rho_kg_m3: rho,
        pressure_rating_kPa: (!isNaN(ratingV) && ratingV > 0) ? ratingV : null,
        segments: builtSegs,
        boundary_A: bcA as MOCBoundaryAInput,
        boundary_B: bcB as MOCBoundaryBInput,
        observation_points: [
          { frac: parseFloat(obs0Frac) || 0,   label: obs0Label },
          { frac: parseFloat(obs1Frac) || 0.5, label: obs1Label },
          { frac: parseFloat(obs2Frac) || 1,   label: obs2Label },
        ],
        n_reaches: nR ?? null,
        t_total_s: tT ?? null,
        unit_system: draft.unitSystem,
      });
      setResult(res);
      dispatch({ type: "SET_MOC_RESULT", result: res });
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ??
        (e as Error)?.message ??
        "MOC computation failed.";
      setError(msg);
    } finally {
      setComputing(false);
    }
  }

  function handleClear() {
    setResult(null);
    dispatch({ type: "SET_MOC_RESULT", result: null });
  }

  // ── Chart data ─────────────────────────────────────────────────────────────
  const envelopeData = useMemo(
    () => result?.envelope.map(pt => ({
      x:    pt.x_m,
      elev: pt.elev_m,
      Hmax: pt.H_max_m,
      Hmin: pt.H_min_m,
    })) ?? [],
    [result],
  );

  const historyData = useMemo(() => {
    if (!result?.observations.length) return [];
    const obs = result.observations;
    const n = obs[0].history.length;
    return Array.from({ length: n }, (_, j) => {
      const pt: Record<string, number> = { t: obs[0].history[j].t_s };
      obs.forEach((o, ki) => { pt[`obs${ki}`] = o.history[j]?.H_m ?? 0; });
      return pt;
    });
  }, [result]);

  const ratingH = result?.rating_check
    ? result.rating_check.pressure_rating_kPa * 1000 / (rho * G)
    : null;

  const fmtH = (m: number) =>
    us ? `${(m * 3.28084).toFixed(2)} ft` : `${m.toFixed(2)} m`;
  const fmtP = (kPa: number) =>
    us ? `${(kPa * 0.14504).toFixed(2)} psi` : `${kPa.toFixed(1)} kPa`;

  const inp =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Engineering assumption banner */}
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 space-y-1.5">
        <p className="text-xs font-bold text-amber-800 mb-2">
          Engineering Assumptions — Mode B (Method of Characteristics)
        </p>
        {[
          "Quasi-steady Darcy-Weisbach friction (f held constant at steady-state Re). Accepted for engineering screening.",
          "Pump-trip modelled as quadratic head decay — no rotating-inertia (Suter) model. Conservative approach.",
          "Multi-segment pipeline collapsed to equivalent uniform grid (flow-weighted D̄, length-weighted ε̄).",
          "Column separation: head clamped at vapour pressure h_vap(T) — vapour-pocket model.",
          "Courant = 1.0 enforced: Δt = Δx/a. Duration = max(10 × 2L/a, 30 s) unless overridden.",
        ].map((note, i) => (
          <p key={i} className="text-[10px] text-amber-700 leading-snug flex gap-1.5">
            <span className="text-amber-400 mt-0.5 shrink-0">•</span>
            <span>{note}</span>
          </p>
        ))}
      </div>

      {/* ── Input form ────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 shadow-sm">

        {/* Pipeline */}
        <Section title="Pipeline">
          <div className="flex gap-3">
            {(["suction", "discharge"] as const).map(p => (
              <button
                key={p}
                onClick={() => setPipeline(p)}
                className={`flex-1 rounded-lg border-2 py-2.5 text-xs font-semibold transition-all ${
                  pipeline === p
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                {p === "suction" ? "⬆ Suction" : "⬇ Discharge"}
                <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
                  L = {pipelineLen(p === "suction" ? suctSegs : dischSegs).toFixed(0)} m
                </span>
              </button>
            ))}
          </div>
        </Section>

        {/* Operating conditions */}
        <Section title="Flow &amp; Operating Conditions">
          <Grid3>
            <div>
              <Label>Wave speed a [m/s]</Label>
              <input
                type="number" min={10} max={2000} step={10}
                value={waveSpeed}
                onChange={e => setWaveSpeed(e.target.value)}
                className={inp}
              />
              <Hint>Set from Mode A Wave Speed Calculator or enter here</Hint>
            </div>
            <div>
              <Label>
                Q₀ [m³/s]{" "}
                {!q0Str && <span className="text-indigo-500 font-normal text-[10px]">(auto)</span>}
              </Label>
              <input
                type="number" min={0} step={0.001}
                value={q0Str || autoQ0_m3s.toFixed(5)}
                onChange={e => setQ0Str(e.target.value)}
                className={`${inp} ${q0Str ? "border-amber-300 bg-amber-50" : ""}`}
              />
              {q0Str && (
                <button onClick={() => setQ0Str("")} className="text-[10px] text-indigo-500 hover:underline mt-0.5">
                  ← restore auto
                </button>
              )}
              <Hint>Steady-state flow — auto from hydraulics</Hint>
            </div>
            <div>
              <Label>
                H₀ [m]{" "}
                {!h0Str && <span className="text-indigo-500 font-normal text-[10px]">(auto)</span>}
              </Label>
              <input
                type="number" step={0.1}
                value={h0Str || autoH0_m.toFixed(2)}
                onChange={e => setH0Str(e.target.value)}
                className={`${inp} ${h0Str ? "border-amber-300 bg-amber-50" : ""}`}
              />
              {h0Str && (
                <button onClick={() => setH0Str("")} className="text-[10px] text-indigo-500 hover:underline mt-0.5">
                  ← restore auto
                </button>
              )}
              <Hint>Upstream HGL at t = 0 (≈ TDH)</Hint>
            </div>
          </Grid3>

          <Grid3>
            <div>
              <Label>Density ρ [kg/m³]</Label>
              <input type="number" min={500} max={1500} step={1}
                value={rhoStr} onChange={e => setRhoStr(e.target.value)} className={inp} />
            </div>
            <div>
              <Label>Temperature [°C]</Label>
              <input type="number" min={0} max={50} step={0.5}
                value={tempStr} onChange={e => setTempStr(e.target.value)} className={inp} />
            </div>
            <div>
              <Label>
                Pressure class [kPa]{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </Label>
              <input type="number" min={100} step={50}
                value={pressRating} onChange={e => setPressRating(e.target.value)}
                placeholder="e.g. 1600" className={inp} />
            </div>
          </Grid3>
        </Section>

        {/* Boundary conditions */}
        <Section title="Boundary Conditions">
          <BCPanel
            panelLabel="Boundary A — Upstream (node 0)"
            typeOptions={UPSTREAM_BC_TYPES}
            state={{
              type: bcAType, H_m: bcA_H_m, H_pump_m: bcA_Hpump, Q_m3s: bcA_Q,
              t_trip_s: bcA_tTrip, H_reservoir_m: bcA_Hres, t_close_s: bcA_tClose,
              profile: bcA_prof, H_sump_m: bcA_Hsump,
            }}
            handlers={{
              setType: setBcAType, setH_m: setBcA_H_m, setH_pump_m: setBcA_Hpump,
              setQ_m3s: setBcA_Q, setT_trip_s: setBcA_tTrip, setH_reservoir_m: setBcA_Hres,
              setT_close_s: setBcA_tClose, setProfile: setBcA_prof, setH_sump_m: setBcA_Hsump,
            }}
          />
          <BCPanel
            panelLabel="Boundary B — Downstream (node N)"
            typeOptions={DOWNSTREAM_BC_TYPES}
            state={{
              type: bcBType, H_m: bcB_H_m, H_pump_m: bcB_Hpump, Q_m3s: bcB_Q,
              t_trip_s: bcB_tTrip, H_reservoir_m: bcB_Hres, t_close_s: bcB_tClose,
              profile: bcB_prof, H_sump_m: bcB_Hsump,
            }}
            handlers={{
              setType: setBcBType, setH_m: setBcB_H_m, setH_pump_m: setBcB_Hpump,
              setQ_m3s: setBcB_Q, setT_trip_s: setBcB_tTrip, setH_reservoir_m: setBcB_Hres,
              setT_close_s: setBcB_tClose, setProfile: setBcB_prof, setH_sump_m: setBcB_Hsump,
            }}
          />
        </Section>

        {/* Observation points */}
        <Section title="Observation Points — Time Histories">
          <p className="text-[10px] text-slate-400 -mt-1">
            Drag sliders to set fractional positions along the pipeline (0 = upstream, 1 = downstream).
          </p>
          <div className="space-y-3">
            {[
              { frac: obs0Frac, label: obs0Label, setFrac: setObs0Frac, setLabel: setObs0Label },
              { frac: obs1Frac, label: obs1Label, setFrac: setObs1Frac, setLabel: setObs1Label },
              { frac: obs2Frac, label: obs2Label, setFrac: setObs2Frac, setLabel: setObs2Label },
            ].map((obs, i) => (
              <ObsSlider
                key={i} idx={i}
                frac={obs.frac} label={obs.label}
                pipeLen={pipeLen}
                onFrac={obs.setFrac} onLabel={obs.setLabel}
              />
            ))}
          </div>
        </Section>

        {/* Advanced settings */}
        <details className="group">
          <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-700 list-none flex items-center gap-1.5 select-none">
            <span className="group-open:rotate-90 inline-block transition-transform">▶</span>
            Advanced grid settings
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label>Grid reaches N <span className="font-normal text-slate-400">(auto)</span></Label>
              <input type="number" min={10} max={200} step={5}
                value={nReaches} onChange={e => setNReaches(e.target.value)}
                placeholder="auto (L ÷ 60 m, max 200)" className={inp} />
            </div>
            <div>
              <Label>Sim. duration [s] <span className="font-normal text-slate-400">(auto)</span></Label>
              <input type="number" min={1} step={1}
                value={tTotalStr} onChange={e => setTTotalStr(e.target.value)}
                placeholder="auto: max(10 × T_char, 30 s)" className={inp} />
            </div>
          </div>
        </details>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleCompute}
          disabled={computing}
          className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {computing
            ? "Running MOC simulation…"
            : `⚡ Run Mode B MOC (${pipeline} pipeline — ${pipeLen.toFixed(0)} m)`}
        </button>
      </div>

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-6 shadow-sm">

          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <SummaryCard label="Max transient head" value={fmtH(result.global_max_H_m)} highlight="red" />
            <SummaryCard
              label="Min transient head"
              value={fmtH(result.global_min_H_m)}
              highlight={result.global_min_H_m < result.h_vap_m ? "red" : result.global_min_H_m < 0 ? "amber" : "green"}
            />
            <SummaryCard label="Max pressure" value={fmtP(result.global_max_P_kPa)} />
            <SummaryCard
              label="Min pressure"
              value={fmtP(result.global_min_P_kPa)}
              highlight={result.global_min_P_kPa < 0 ? "amber" : "green"}
            />
            <SummaryCard
              label="First cavitation"
              value={
                result.cavitation_x_m.length > 0
                  ? `x = ${result.cavitation_x_m[0].toFixed(0)} m`
                  : "None"
              }
              highlight={result.cavitation_x_m.length > 0 ? "red" : "green"}
            />
          </div>

          {/* Cavitation alert */}
          {result.cavitation_x_m.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-300 px-4 py-3 flex items-start gap-3">
              <span className="text-red-500 text-lg leading-none mt-0.5 shrink-0">⚠</span>
              <div>
                <p className="text-sm font-bold text-red-700">Column Separation Detected</p>
                <p className="text-xs text-red-600 mt-0.5">
                  Head fell to vapour pressure at {result.cavitation_x_m.length} node(s): x ={" "}
                  {result.cavitation_x_m.slice(0, 5).map(x => `${x.toFixed(0)} m`).join(", ")}
                  {result.cavitation_x_m.length > 5 ? " …" : ""}.{" "}
                  h_vap = {result.h_vap_m.toFixed(2)} m gauge at {result.temperature_C} °C.
                  Vapour pocket formation possible — surge protection required.
                </p>
              </div>
            </div>
          )}

          {/* Grid info strip */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 grid grid-cols-4 gap-3 text-xs font-mono text-slate-700">
            <div>
              <span className="text-slate-400 font-sans text-[10px] block uppercase tracking-wide mb-0.5">N reaches</span>
              {result.N}
            </div>
            <div>
              <span className="text-slate-400 font-sans text-[10px] block uppercase tracking-wide mb-0.5">Δx</span>
              {result.dx_m.toFixed(1)} m
            </div>
            <div>
              <span className="text-slate-400 font-sans text-[10px] block uppercase tracking-wide mb-0.5">Δt</span>
              {result.dt_s.toFixed(4)} s
            </div>
            <div>
              <span className="text-slate-400 font-sans text-[10px] block uppercase tracking-wide mb-0.5">T_char = 2L/a</span>
              {result.T_char_s.toFixed(3)} s
            </div>
          </div>

          {/* Envelope chart */}
          <Section title="Pressure Envelope — HGL vs Pipeline Position">
            <p className="text-[10px] text-slate-400 -mt-2 leading-relaxed">
              Red = max transient head; Blue = min transient head; shaded = pipe elevation profile.
              Dashed amber = vapour pressure. Dashed green = pipe pressure class (if set).
            </p>
            <ResponsiveContainer width="100%" height={290}>
              <ComposedChart data={envelopeData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="x"
                  label={{ value: "Position (m)", position: "insideBottomRight", offset: -4, fontSize: 10 }}
                  tick={{ fontSize: 10 }}
                />
                <YAxis
                  label={{ value: "Head (m)", angle: -90, position: "insideLeft", fontSize: 10 }}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  formatter={(v: any, name: any) => [
                    `${Number(v).toFixed(2)} m`,
                    name === "Hmax" ? "H_max" : name === "Hmin" ? "H_min" : String(name),
                  ] as any}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  labelFormatter={(x: any) => `x = ${Number(x).toFixed(0)} m`}
                />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Area
                  type="monotone" dataKey="elev" name="Elevation"
                  fill="#e2e8f0" stroke="#94a3b8" strokeWidth={1}
                  fillOpacity={0.8} dot={false} isAnimationActive={false}
                />
                <Line
                  type="monotone" dataKey="Hmax" name="H_max"
                  stroke="#dc2626" strokeWidth={2} dot={false} isAnimationActive={false}
                />
                <Line
                  type="monotone" dataKey="Hmin" name="H_min"
                  stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false}
                />
                <ReferenceLine
                  y={result.h_vap_m}
                  stroke="#f59e0b" strokeDasharray="5 3"
                  label={{ value: `h_vap = ${result.h_vap_m.toFixed(1)} m`, fontSize: 9, fill: "#d97706", position: "insideTopLeft" }}
                />
                {ratingH !== null && (
                  <ReferenceLine
                    y={ratingH}
                    stroke="#16a34a" strokeDasharray="5 3"
                    label={{ value: `PN = ${ratingH.toFixed(0)} m`, fontSize: 9, fill: "#16a34a", position: "insideTopRight" }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </Section>

          {/* Time-history chart */}
          {historyData.length > 0 && (
            <Section title="Time History — Piezometric Head at Observation Points">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={historyData} margin={{ top: 4, right: 20, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="t"
                    label={{ value: "Time (s)", position: "insideBottomRight", offset: -4, fontSize: 10 }}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    label={{ value: "Head (m)", angle: -90, position: "insideLeft", fontSize: 10 }}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    formatter={(v: any, name: any) => [`${Number(v).toFixed(2)} m`, String(name)] as any}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    labelFormatter={(t: any) => `t = ${Number(t).toFixed(3)} s`}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {result.observations.map((obs, ki) => (
                    <Line
                      key={ki}
                      type="monotone"
                      dataKey={`obs${ki}`}
                      name={obs.label}
                      stroke={OBS_COLORS[ki] ?? "#6b7280"}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                  <ReferenceLine
                    y={result.h_vap_m}
                    stroke="#f59e0b" strokeDasharray="4 3"
                    label={{ value: "h_vap", fontSize: 9, fill: "#d97706" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Section>
          )}

          {/* Pressure rating check */}
          {result.rating_check && (
            <Section title="Pressure Rating Check">
              <MOCRatingPanel rc={result.rating_check} us={us} />
            </Section>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleClear}
              className="text-xs text-slate-400 hover:text-slate-600 hover:underline transition-colors"
            >
              Clear result
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
