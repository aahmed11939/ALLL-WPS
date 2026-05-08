import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ComposedChart,
  Area,
} from "recharts";
import { useProject } from "../../contexts/ProjectContext";
import { computeSuctionTransient } from "../../utils/api";
import type {
  SuctionTransientRequest,
  SuctionTransientResponse,
  MOCBoundaryInput,
  MOCBoundaryAInput,
  MOCBoundaryBInput,
  MOCSegmentInput,
  WhatIfResponse,
} from "../../utils/api";
import ProtectionDevicePanel from "./ProtectionDevicePanel";
import WhatIfComparisonPanel from "./WhatIfComparisonPanel";
import ChartErrorBoundary from "../ChartErrorBoundary";
import TermTip from "../TermTip";

// ---------------------------------------------------------------------------
// Collapsible solver notes banner (default collapsed)
// ---------------------------------------------------------------------------

function SolverNotesBanner({ notes }: { notes: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-amber-100/60 transition-colors"
      >
        <span className="text-[11px] font-bold text-amber-800 flex items-center gap-2">
          <span>⚠</span>
          Solver assumption notes ({notes.length})
        </span>
        <span className={`text-amber-500 text-xs transition-transform ${open ? "rotate-180" : ""}`}>▼</span>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1 border-t border-amber-200">
          {notes.map((note, i) => (
            <p key={i} className="text-[10px] text-amber-700 leading-snug flex gap-1.5 mt-1">
              <span className="text-amber-400 shrink-0 mt-0.5">▸</span>
              <span>{note}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const G = 9.81;
const OBS_COLORS = ["#7c3aed", "#dc2626", "#16a34a"];

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

function KpiCard({
  label, value, value2, sub, highlight,
}: {
  label: string; value: string; value2?: string; sub?: string;
  highlight?: "green" | "amber" | "red" | "blue" | "violet";
}) {
  const colors = {
    green:  "bg-emerald-50 border-emerald-200",
    amber:  "bg-amber-50  border-amber-200",
    red:    "bg-red-50    border-red-200",
    blue:   "bg-blue-50   border-blue-200",
    violet: "bg-violet-50 border-violet-200",
  };
  const cls = highlight ? colors[highlight] : "bg-slate-50 border-slate-200";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-slate-800 font-mono">{value}</p>
      {value2 && <p className="text-xs text-slate-500 font-mono">{value2}</p>}
      {sub   && <p className="text-[10px] text-slate-400 mt-1 leading-tight">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StepSuctionSurgeMOC() {
  const { draft, dispatch } = useProject();
  const us  = draft.unitSystem === "US";
  const cfg = draft.suctionSurgeConfig;

  const autoQ0_m3s = (draft.hydraulicsResult?.design_Q_m3h ?? draft.designFlow_m3h) / 3600;
  const autoH0_m   = draft.hydraulicsResult?.friction_head_m
    ?? Math.abs(draft.upstreamNode.elevation_m - draft.downstreamNode.elevation_m);
  const waveSpeedFromA = draft.waterHammerConfig?.wave_speed_ms ?? 1000;

  const suctSegs  = draft.suction.segments;
  const pipeLen   = suctSegs.reduce((s, sg) => s + sg.length_m, 0);

  // Wet well levels (upstream node)
  const wetWellLWL  = draft.upstreamNode.elevation_m;   // worst case — lowest draw-down

  // ── Form state ─────────────────────────────────────────────────────────────
  const [waveSpeed,    setWaveSpeed]    = useState(String(cfg?.wave_speed_ms ?? waveSpeedFromA));
  const [q0Str,        setQ0Str]        = useState(cfg?.Q_0_m3s_override ?? "");
  const [h0Str,        setH0Str]        = useState(cfg?.H_0_m_override ?? "");
  const [rhoStr,       setRhoStr]       = useState(cfg?.rho_kg_m3 ?? "1000");
  const [tempStr,      setTempStr]      = useState(cfg?.temperature_C ?? "20");
  const [pressRating,  setPressRating]  = useState(cfg?.pressure_rating_kPa ?? "");
  const [npshrStr,     setNpshrStr]     = useState(cfg?.NPSHr_m_override ?? "");
  const [nReaches,     setNReaches]     = useState(cfg?.n_reaches ?? "");
  const [tTotalStr,    setTTotalStr]    = useState(cfg?.t_total_s ?? "");
  const [pumpNodeFrac, setPumpNodeFrac] = useState(String(cfg?.pump_node_frac ?? 1.0));

  // Boundary A — wet well / suction source (upstream end of suction pipe)
  const [bcAType,   setBcAType]   = useState(cfg?.boundary_A?.type ?? "reservoir");
  const [bcA_H_m,   setBcA_H_m]   = useState(cfg?.boundary_A?.H_m ?? String(wetWellLWL));
  const [bcA_Hsump, setBcA_Hsump] = useState(cfg?.boundary_A?.H_sump_m ?? String(wetWellLWL));
  const [bcA_Q,     setBcA_Q]     = useState(cfg?.boundary_A?.Q_m3s ?? "");
  const [bcA_tTrip, setBcA_tTrip] = useState(cfg?.boundary_A?.t_trip_s ?? "2");

  // Boundary B — pump (downstream end of suction pipe)
  const [bcBType,   setBcBType]   = useState(cfg?.boundary_B?.type ?? "suction_pump_trip");
  const [bcB_Hsump, setBcB_Hsump] = useState(cfg?.boundary_B?.H_sump_m ?? String(wetWellLWL));
  const [bcB_Q,     setBcB_Q]     = useState(cfg?.boundary_B?.Q_m3s ?? "");
  const [bcB_tTrip, setBcB_tTrip] = useState(cfg?.boundary_B?.t_trip_s ?? "2");
  const [bcB_H_m,   setBcB_H_m]   = useState(cfg?.boundary_B?.H_m ?? String(wetWellLWL));

  // Observation points
  const [obs0Frac,  setObs0Frac]  = useState(cfg?.obs_points?.[0]?.frac  ?? "0");
  const [obs0Label, setObs0Label] = useState(cfg?.obs_points?.[0]?.label ?? "Source (wet well)");
  const [obs1Frac,  setObs1Frac]  = useState(cfg?.obs_points?.[1]?.frac  ?? "0.5");
  const [obs1Label, setObs1Label] = useState(cfg?.obs_points?.[1]?.label ?? "Midpoint");
  const [obs2Frac,  setObs2Frac]  = useState(cfg?.obs_points?.[2]?.frac  ?? "1");
  const [obs2Label, setObs2Label] = useState(cfg?.obs_points?.[2]?.label ?? "Pump suction flange");

  // Compute state
  const [computing, setComputing] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [result,    setResult]    = useState<SuctionTransientResponse | null>(
    draft.suctionSurgeResult as SuctionTransientResponse | null ?? null
  );

  // ── What-if state ─────────────────────────────────────────────────────────
  interface WIParams {
    wave_speed_ms: number; Q_0_m3s: number; H_0_m: number;
    temperature_C: number; rho_kg_m3: number;
    pressure_rating_kPa: number | null;
    segments: MOCSegmentInput[];
    boundary_A: MOCBoundaryAInput; boundary_B: MOCBoundaryBInput;
    n_reaches: number | null; t_total_s: number | null; pipeline: string;
  }
  const [lastRunParams, setLastRunParams] = useState<WIParams | null>(null);
  const [whatIfResult,  setWhatIfResult]  = useState<WhatIfResponse | null>(null);

  // ── Derived ────────────────────────────────────────────────────────────────
  const q0   = parseFloat(q0Str)   || autoQ0_m3s;
  const h0   = parseFloat(h0Str)   || autoH0_m;
  const rho  = parseFloat(rhoStr)  || 1000;
  const temp = parseFloat(tempStr) || 20;
  const a    = parseFloat(waveSpeed) || waveSpeedFromA;
  const NPSHr = parseFloat(npshrStr) || null;

  const fmtH = (m: number) =>
    us ? `${(m * 3.28084).toFixed(2)} ft` : `${m.toFixed(2)} m`;

  const inp =
    "w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400";

  // ── Persist config ──────────────────────────────────────────────────────────
  const persistConfig = useCallback(() => {
    dispatch({
      type: "SET_SUCTION_SURGE_CONFIG",
      config: {
        wave_speed_ms:        parseFloat(waveSpeed) || 1000,
        Q_0_m3s_override:     q0Str,
        H_0_m_override:       h0Str,
        rho_kg_m3:            rhoStr,
        temperature_C:        tempStr,
        pressure_rating_kPa:  pressRating,
        NPSHr_m_override:     npshrStr,
        pump_node_frac:       parseFloat(pumpNodeFrac) || 1.0,
        boundary_A: {
          type: bcAType as "reservoir" | "suction_pump_trip",
          H_m: bcA_H_m, H_sump_m: bcA_Hsump,
          Q_m3s: bcA_Q, t_trip_s: bcA_tTrip,
          H_pump_m: "", H_reservoir_m: bcA_H_m, t_close_s: "", profile: "linear" as const,
        },
        boundary_B: {
          type: bcBType as "reservoir" | "suction_pump_trip",
          H_m: bcB_H_m, H_sump_m: bcB_Hsump,
          Q_m3s: bcB_Q, t_trip_s: bcB_tTrip,
          H_pump_m: "", H_reservoir_m: bcB_H_m, t_close_s: "", profile: "linear" as const,
        },
        atm_pressure_kPa: "101.325",
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
    waveSpeed, q0Str, h0Str, rhoStr, tempStr, pressRating, npshrStr, pumpNodeFrac,
    bcAType, bcA_H_m, bcA_Hsump, bcA_Q, bcA_tTrip,
    bcBType, bcB_H_m, bcB_Hsump, bcB_Q, bcB_tTrip,
    obs0Frac, obs0Label, obs1Frac, obs1Label, obs2Frac, obs2Label,
    nReaches, tTotalStr, dispatch,
  ]);

  const suctionConfigMountedRef = useRef(false);
  useEffect(() => {
    if (!suctionConfigMountedRef.current) { suctionConfigMountedRef.current = true; return; }
    persistConfig();
  }, [persistConfig]);

  // ── Build boundary condition ─────────────────────────────────────────────
  function buildBC(
    type: string,
    H_m: string, Hsump: string, Q_str: string, tTrip: string,
  ): MOCBoundaryInput | null {
    const Q = parseFloat(Q_str) || q0;
    if (type === "reservoir") {
      const H = parseFloat(H_m);
      if (isNaN(H)) return null;
      return { type: "reservoir", H_m: H };
    }
    if (type === "suction_pump_trip") {
      const Hs = parseFloat(Hsump);
      const tt = parseFloat(tTrip);
      if (isNaN(Hs) || isNaN(tt) || tt <= 0) return null;
      return { type: "suction_pump_trip", H_sump_m: Hs, Q_m3s: Q, t_trip_s: tt };
    }
    return null;
  }

  // ── Compute handler ──────────────────────────────────────────────────────
  async function handleCompute() {
    setError(null);
    if (pipeLen <= 0) {
      setError("Suction pipeline length is zero — configure suction segments first (Step 3).");
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

    const bcA = buildBC(bcAType, bcA_H_m, bcA_Hsump, bcA_Q, bcA_tTrip);
    const bcB = buildBC(bcBType, bcB_H_m, bcB_Hsump, bcB_Q, bcB_tTrip);
    if (!bcA) { setError("Boundary A (source) configuration is incomplete."); return; }
    if (!bcB) { setError("Boundary B (pump) configuration is incomplete."); return; }

    const elevA    = draft.upstreamNode.elevation_m;
    const elevB    = draft.downstreamNode.elevation_m;
    const totalLen = suctSegs.reduce((s, sg) => s + sg.length_m, 0) || 1;
    let cumLen = 0;
    const builtSegs = suctSegs.map((sg) => {
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
    const pnf = parseFloat(String(pumpNodeFrac));

    const req: SuctionTransientRequest = {
      wave_speed_ms:       a,
      Q_0_m3s:             q0,
      H_0_m:               h0,
      temperature_C:       temp,
      rho_kg_m3:           rho,
      NPSHr_m:             NPSHr,
      pressure_rating_kPa: (!isNaN(ratingV) && ratingV > 0) ? ratingV : null,
      segments:            builtSegs,
      boundary_A:          bcA as MOCBoundaryAInput,
      boundary_B:          bcB as MOCBoundaryBInput,
      observation_points: [
        { frac: parseFloat(obs0Frac) || 0,   label: obs0Label },
        { frac: parseFloat(obs1Frac) || 0.5, label: obs1Label },
        { frac: parseFloat(obs2Frac) || 1,   label: obs2Label },
      ],
      n_reaches:     nR ?? null,
      t_total_s:     tT ?? null,
      unit_system:   draft.unitSystem,
      pump_node_frac: isNaN(pnf) ? 1.0 : pnf,
    };

    setComputing(true);
    try {
      const res = await computeSuctionTransient(req);
      setResult(res);
      dispatch({ type: "SET_SUCTION_SURGE_RESULT", result: res as import("../../types/project").SuctionTransientResult });
      setLastRunParams({
        wave_speed_ms: a, Q_0_m3s: q0, H_0_m: h0,
        temperature_C: temp, rho_kg_m3: rho,
        pressure_rating_kPa: (!isNaN(ratingV) && ratingV > 0) ? ratingV : null,
        segments: builtSegs,
        boundary_A: bcA as MOCBoundaryAInput,
        boundary_B: bcB as MOCBoundaryBInput,
        n_reaches: nR ?? null, t_total_s: tT ?? null, pipeline: "suction",
      });
      setWhatIfResult(null);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ??
        (e as Error)?.message ??
        "Suction transient computation failed.";
      setError(msg);
    } finally {
      setComputing(false);
    }
  }

  function handleClear() {
    setResult(null);
    dispatch({ type: "SET_SUCTION_SURGE_RESULT", result: null });
    setLastRunParams(null);
    setWhatIfResult(null);
  }

  // ── Chart data ────────────────────────────────────────────────────────────
  const npshaData = useMemo(
    () => result?.npsha_series.map(pt => ({
      t:       pt.t_s,
      NPSHa:   pt.NPSHa_m,
      H_suct:  pt.H_suction_m,
      margin:  pt.margin_m ?? null,
    })) ?? [],
    [result],
  );

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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Engineering assumption banner */}
      <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-5 py-4 space-y-1.5">
        <p className="text-xs font-bold text-violet-800 mb-2">
          Engineering Assumptions — Suction MOC / NPSHa Transient
        </p>
        {[
          "NPSHa(t) = H_suction(t) − h_vap(T) in gauge head. At risk when NPSHa(t) < NPSHr.",
          "Pump node placed at fractional position along suction pipe (default = 1.0, i.e. downstream end).",
          "Boundary A = wet-well / suction source (reservoir or free surface). Boundary B = pump trip event.",
          "Column separation: head clamped at vapour pressure h_vap(T). Vapour-pocket model.",
          "NPSHa margin = NPSHa(t) − NPSHr. Negative margin → transient cavitation risk at pump inlet.",
        ].map((note, i) => (
          <p key={i} className="text-[10px] text-violet-700 leading-snug flex gap-1.5">
            <span className="text-violet-400 mt-0.5 shrink-0">•</span>
            <span>{note}</span>
          </p>
        ))}
      </div>

      {/* ── Input form ─────────────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 shadow-sm">

        <Section title="Flow & Operating Conditions">
          <Grid3>
            <div>
              <Label>Wave speed a <TermTip term="a" /> [m/s]</Label>
              <input
                type="number" min={10} max={2000} step={10}
                value={waveSpeed}
                onChange={e => setWaveSpeed(e.target.value)}
                className={inp}
              />
              <Hint>Use Mode A Wave Speed Calculator or enter here</Hint>
            </div>
            <div>
              <Label>
                Q₀ [m³/s]{" "}
                {!q0Str && <span className="text-violet-500 font-normal text-[10px]">(auto)</span>}
              </Label>
              <input
                type="number" min={0} step={0.001}
                value={q0Str || autoQ0_m3s.toFixed(5)}
                onChange={e => setQ0Str(e.target.value)}
                className={`${inp} ${q0Str ? "border-amber-300 bg-amber-50" : ""}`}
              />
              {q0Str && (
                <button onClick={() => setQ0Str("")} className="text-[10px] text-violet-500 hover:underline mt-0.5">
                  ← restore auto
                </button>
              )}
              <Hint>Steady-state flow — auto from hydraulics</Hint>
            </div>
            <div>
              <Label>
                H₀ [m]{" "}
                {!h0Str && <span className="text-violet-500 font-normal text-[10px]">(auto)</span>}
              </Label>
              <input
                type="number" step={0.1}
                value={h0Str || autoH0_m.toFixed(2)}
                onChange={e => setH0Str(e.target.value)}
                className={`${inp} ${h0Str ? "border-amber-300 bg-amber-50" : ""}`}
              />
              {h0Str && (
                <button onClick={() => setH0Str("")} className="text-[10px] text-violet-500 hover:underline mt-0.5">
                  ← restore auto
                </button>
              )}
              <Hint>Upstream HGL at t = 0</Hint>
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
                NPSHr <TermTip term="NPSHr" /> [m]{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              </Label>
              <input type="number" min={0} step={0.1}
                value={npshrStr} onChange={e => setNpshrStr(e.target.value)}
                placeholder="e.g. 4.5" className={inp} />
              <Hint>Pump minimum required NPSH from curve</Hint>
            </div>
          </Grid3>
          <Grid2>
            <div>
              <Label>Pressure class [kPa] <span className="font-normal text-slate-400">(optional)</span></Label>
              <input type="number" min={100} step={50}
                value={pressRating} onChange={e => setPressRating(e.target.value)}
                placeholder="e.g. 1000 (PN 10)" className={inp} />
            </div>
            <div>
              <Label>Pump node position (fractional)</Label>
              <input type="number" min={0} max={1} step={0.05}
                value={pumpNodeFrac} onChange={e => setPumpNodeFrac(e.target.value)}
                className={inp} />
              <Hint>0 = source end, 1.0 = pump end (default)</Hint>
            </div>
          </Grid2>
        </Section>

        <Section title="Boundary Conditions">
          {/* Boundary A — Source (wet well) */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-700">Boundary A — Source / Wet Well (node 0)</p>
            <div>
              <Label>Boundary type</Label>
              <select
                value={bcAType}
                onChange={e => setBcAType(e.target.value as "reservoir" | "suction_pump_trip")}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <option value="reservoir">Reservoir / Fixed HGL (wet well free surface)</option>
                <option value="suction_pump_trip">Suction Pump Trip</option>
              </select>
            </div>
            {bcAType === "reservoir" && (
              <div>
                <Label>Wet well LWL / HGL [m above datum]</Label>
                <input type="number" step={0.1}
                  value={bcA_H_m} onChange={e => setBcA_H_m(e.target.value)}
                  placeholder={`e.g. ${wetWellLWL.toFixed(1)} (upstream node elevation)`}
                  className={inp} />
                <Hint>Use Low Water Level for worst-case NPSHa. Upstream node elevation = {wetWellLWL.toFixed(2)} m</Hint>
              </div>
            )}
            {bcAType === "suction_pump_trip" && (
              <Grid2>
                <div>
                  <Label>Sump head H_sump [m]</Label>
                  <input type="number" step={0.5} value={bcA_Hsump}
                    onChange={e => setBcA_Hsump(e.target.value)} className={inp} />
                </div>
                <div>
                  <Label>Flow Q₀ [m³/s]</Label>
                  <input type="number" step={0.001} value={bcA_Q}
                    onChange={e => setBcA_Q(e.target.value)} className={inp} />
                </div>
                <div>
                  <Label>Trip time [s]</Label>
                  <input type="number" step={0.1} min={0.01} value={bcA_tTrip}
                    onChange={e => setBcA_tTrip(e.target.value)} className={inp} />
                </div>
              </Grid2>
            )}
          </div>

          {/* Boundary B — Pump (downstream end of suction pipe) */}
          <div className="rounded-lg border border-violet-100 bg-violet-50/40 p-4 space-y-3">
            <p className="text-xs font-semibold text-violet-800">Boundary B — Pump Suction Flange (node N)</p>
            <div>
              <Label>Boundary type</Label>
              <select
                value={bcBType}
                onChange={e => setBcBType(e.target.value as "reservoir" | "suction_pump_trip")}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <option value="suction_pump_trip">Suction Pump Trip (pump demand collapses)</option>
                <option value="reservoir">Reservoir / Fixed HGL</option>
              </select>
              <Hint>Pump trip is the standard worst-case event for suction NPSHa transient</Hint>
            </div>
            {bcBType === "suction_pump_trip" && (
              <Grid2>
                <div>
                  <Label>Sump head H_sump [m]</Label>
                  <input type="number" step={0.5} value={bcB_Hsump}
                    onChange={e => setBcB_Hsump(e.target.value)}
                    placeholder={wetWellLWL.toFixed(1)} className={inp} />
                  <Hint>Total piezometric head at pump inlet — use wet well LWL</Hint>
                </div>
                <div>
                  <Label>Flow Q₀ [m³/s]</Label>
                  <input type="number" step={0.001} min={0} value={bcB_Q}
                    onChange={e => setBcB_Q(e.target.value)}
                    placeholder={autoQ0_m3s.toFixed(4)} className={inp} />
                </div>
                <div>
                  <Label>Trip time t_trip [s]</Label>
                  <input type="number" step={0.1} min={0.01} value={bcB_tTrip}
                    onChange={e => setBcB_tTrip(e.target.value)}
                    placeholder="e.g. 2" className={inp} />
                  <Hint>Pump coast-down inertia time</Hint>
                </div>
              </Grid2>
            )}
            {bcBType === "reservoir" && (
              <div>
                <Label>Reservoir head [m]</Label>
                <input type="number" step={0.5} value={bcB_H_m}
                  onChange={e => setBcB_H_m(e.target.value)} className={inp} />
              </div>
            )}
          </div>
        </Section>

        {/* Advanced */}
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

        {/* Observation points */}
        <Section title="Observation Points — Time Histories">
          <p className="text-[10px] text-slate-400 -mt-1">
            Drag sliders to set fractional positions along the suction pipe (0 = wet well, 1 = pump flange).
          </p>
          <div className="space-y-3">
            {[
              { frac: obs0Frac, label: obs0Label, setFrac: setObs0Frac, setLabel: setObs0Label },
              { frac: obs1Frac, label: obs1Label, setFrac: setObs1Frac, setLabel: setObs1Label },
              { frac: obs2Frac, label: obs2Label, setFrac: setObs2Frac, setLabel: setObs2Label },
            ].map((obs, i) => {
              const f = parseFloat(obs.frac as string);
              const x = isNaN(f) ? 0 : f * pipeLen;
              return (
                <div key={i} className="grid grid-cols-[1fr_56px_1fr] gap-3 items-center">
                  <div>
                    <input
                      type="text"
                      value={obs.label}
                      onChange={e => obs.setLabel(e.target.value)}
                      placeholder={`Point ${i + 1}`}
                      className="w-full rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-violet-400"
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
                      onChange={e => obs.setFrac(e.target.value)}
                      className="w-full accent-violet-600"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleCompute}
          disabled={computing}
          className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {computing
            ? "Running suction MOC + NPSHa analysis…"
            : `⚡ Run Suction MOC — NPSHa Transient (${pipeLen.toFixed(0)} m)`}
        </button>
      </div>

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-6 shadow-sm">

          {/* Solver assumption notes */}
          {result.assumption_notes?.length > 0 && (
            <SolverNotesBanner notes={result.assumption_notes} />
          )}

          {/* NPSHa KPI strip */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
              <TermTip term="NPSHa">NPSHa</TermTip> Analysis
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard
                label="NPSHa Steady"
                value={fmtH(result.npsha_steady_m)}
                value2={`(${result.npsha_steady_m.toFixed(2)} m)`}
                highlight="blue"
                sub="At t = 0, before trip"
              />
              <KpiCard
                label="NPSHa Minimum"
                value={fmtH(result.npsha_min_m)}
                value2={`(${result.npsha_min_m.toFixed(2)} m)`}
                highlight={result.transient_npsh_risk ? "red" : "green"}
                sub="Worst-case transient"
              />
              {result.npsha_margin_min_m !== null && (
                <KpiCard
                  label="Min NPSHa Margin"
                  value={fmtH(result.npsha_margin_min_m)}
                  value2={`(${result.npsha_margin_min_m.toFixed(2)} m)`}
                  highlight={
                    result.npsha_margin_min_m < 0 ? "red"
                    : result.npsha_margin_min_m < 0.5 ? "amber"
                    : "green"
                  }
                  sub={`NPSHa_min − NPSHr (${result.NPSHr_m?.toFixed(1)} m)`}
                />
              )}
              <KpiCard
                label="Transient NPSH Risk"
                value={result.transient_npsh_risk ? "⚠ AT RISK" : "✓ SAFE"}
                highlight={result.transient_npsh_risk ? "red" : "green"}
                sub={
                  result.npsha_risk_duration_s > 0
                    ? `Risk duration: ${result.npsha_risk_duration_s.toFixed(2)} s`
                    : "No cavitation risk detected"
                }
              />
            </div>
          </div>

          {/* NPSH risk alert */}
          {result.transient_npsh_risk && (
            <div className="rounded-lg bg-red-50 border border-red-300 px-4 py-3 flex items-start gap-3">
              <span className="text-red-500 text-lg leading-none mt-0.5 shrink-0">⚠</span>
              <div>
                <p className="text-sm font-bold text-red-700">Transient Cavitation Risk at Pump Inlet</p>
                <p className="text-xs text-red-600 mt-0.5">
                  NPSHa falls below NPSHr for {result.npsha_risk_duration_s.toFixed(2)} s during the transient.
                  Min NPSHa = {result.npsha_min_m.toFixed(2)} m, NPSHr = {result.NPSHr_m?.toFixed(2) ?? "N/A"} m.
                  Consider: increasing wet well LWL, reducing pipe losses, adding surge vessel, or extending pump trip time.
                </p>
              </div>
            </div>
          )}

          {/* Column separation alert */}
          {result.cavitation_x_m.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-300 px-4 py-3 flex items-start gap-3">
              <span className="text-red-500 text-lg leading-none mt-0.5 shrink-0">⚠</span>
              <div>
                <p className="text-sm font-bold text-red-700">Column Separation in Suction Pipeline</p>
                <p className="text-xs text-red-600 mt-0.5">
                  Head fell to vapour pressure at {result.cavitation_x_m.length} node(s): x ={" "}
                  {result.cavitation_x_m.slice(0, 5).map(x => `${x.toFixed(0)} m`).join(", ")}
                  {result.cavitation_x_m.length > 5 ? " …" : ""}. h_vap = {result.h_vap_m.toFixed(2)} m gauge.
                </p>
              </div>
            </div>
          )}

          {/* Grid info */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 grid grid-cols-5 gap-3 text-xs font-mono text-slate-700">
            {[
              { label: "N reaches", val: String(result.N) },
              { label: "Courant",   val: result.courant.toFixed(3) },
              { label: "Δx",        val: `${result.dx_m.toFixed(1)} m` },
              { label: "Δt",        val: `${result.dt_s.toFixed(4)} s` },
              { label: "T_char",    val: `${result.T_char_s.toFixed(3)} s` },
            ].map(c => (
              <div key={c.label}>
                <span className="text-slate-400 font-sans text-[10px] block uppercase tracking-wide mb-0.5">{c.label}</span>
                {c.val}
              </div>
            ))}
          </div>

          {/* NPSHa(t) time-history chart */}
          {npshaData.length > 0 && (
            <Section title="NPSHa(t) — Available NPSH at Pump Suction over Time">
              <p className="text-[10px] text-slate-400 -mt-2 leading-relaxed">
                Violet = NPSHa(t); orange dashed = NPSHr threshold; amber dashed = vapour pressure head.
                {result.npsha_risk_duration_s > 0 &&
                  ` Red zone: NPSHa below NPSHr for ${result.npsha_risk_duration_s.toFixed(2)} s.`}
              </p>
              <ChartErrorBoundary label="NPSHa Time History">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={npshaData} margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="t"
                    label={{ value: "Time (s)", position: "insideBottomRight", offset: -4, fontSize: 10 }}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    width={56}
                    label={{ value: "NPSH (m)", angle: -90, position: "insideLeft", fontSize: 10 }}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-xl border border-slate-200 bg-white shadow-lg px-3 py-2.5 text-xs space-y-1.5 min-w-[190px]">
                          <p className="font-semibold text-slate-500 border-b border-slate-100 pb-1.5 mb-1">
                            t = {Number(label).toFixed(3)} s
                          </p>
                          {payload.map((p) => (
                            <div key={p.dataKey as string} className="flex justify-between items-center gap-4">
                              <span className="flex items-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                                <span className="text-slate-600">{String(p.name)}</span>
                              </span>
                              <span className={`font-bold font-mono ${
                                typeof p.value === "number" && result?.h_vap_m !== undefined && p.value < result.h_vap_m
                                  ? "text-red-700" : "text-slate-800"
                              }`}>
                                {typeof p.value === "number" ? `${p.value.toFixed(3)} m` : "—"}
                              </span>
                            </div>
                          ))}
                          {result?.h_vap_m !== undefined && (
                            <div className="border-t border-slate-100 pt-1.5 text-[10px] text-amber-600 font-mono">
                              h_vap = {result.h_vap_m.toFixed(3)} m (cavitation limit)
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line
                    type="monotone" dataKey="NPSHa" name="NPSHa(t)"
                    stroke="#7c3aed" strokeWidth={2} dot={false} isAnimationActive={false}
                  />
                  {result.npsha_margin_min_m !== null && (
                    <Line
                      type="monotone" dataKey="margin" name="Margin(t)"
                      stroke="#9ca3af" strokeWidth={1} strokeDasharray="4 2"
                      dot={false} isAnimationActive={false}
                    />
                  )}
                  <ReferenceLine
                    y={result.h_vap_m}
                    stroke="#f59e0b" strokeDasharray="5 3"
                    label={{ value: `h_vap = ${result.h_vap_m.toFixed(1)} m`, fontSize: 9, fill: "#d97706", position: "insideTopLeft" }}
                  />
                  {result.NPSHr_m !== null && (
                    <ReferenceLine
                      y={result.NPSHr_m}
                      stroke="#ea580c" strokeDasharray="6 3" strokeWidth={1.5}
                      label={{ value: `NPSHr = ${result.NPSHr_m.toFixed(1)} m`, fontSize: 9, fill: "#ea580c", position: "insideTopRight" }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
              </ChartErrorBoundary>
            </Section>
          )}

          {/* Pressure envelope */}
          {envelopeData.length > 0 && (
            <Section title="Pressure Envelope — HGL vs Suction Pipeline Position">
              <p className="text-[10px] text-slate-400 -mt-2 leading-relaxed">
                Red = max transient head; Blue = min transient head; shaded = pipe elevation profile; amber dashed = vapour pressure.
              </p>
              <ChartErrorBoundary label="Pressure Envelope">
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={envelopeData} margin={{ top: 8, right: 20, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="x"
                    label={{ value: "Position (m)", position: "insideBottomRight", offset: -4, fontSize: 10 }}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    width={56}
                    label={{ value: "Head (m)", angle: -90, position: "insideLeft", fontSize: 10 }}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-xl border border-slate-200 bg-white shadow-lg px-3 py-2.5 text-xs space-y-1.5 min-w-[190px]">
                          <p className="font-semibold text-slate-500 border-b border-slate-100 pb-1.5 mb-1">
                            x = {Number(label).toFixed(0)} m
                          </p>
                          {payload.map((p) => {
                            const nameMap: Record<string, string> = { Hmax: "H_max transient", Hmin: "H_min transient", elev: "Elevation" };
                            return (
                              <div key={p.dataKey as string} className="flex justify-between items-center gap-4">
                                <span className="flex items-center gap-1.5">
                                  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                                  <span className="text-slate-600">{nameMap[p.dataKey as string] ?? String(p.dataKey)}</span>
                                </span>
                                <span className="font-bold font-mono text-slate-800">
                                  {typeof p.value === "number" ? `${p.value.toFixed(2)} m` : "—"}
                                </span>
                              </div>
                            );
                          })}
                          {result?.h_vap_m !== undefined && (
                            <div className="border-t border-slate-100 pt-1.5 text-[10px] text-amber-600 font-mono">
                              h_vap = {result.h_vap_m.toFixed(2)} m
                            </div>
                          )}
                        </div>
                      );
                    }}
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
                    stroke={result.global_min_H_m < result.h_vap_m ? "#dc2626" : "#f59e0b"}
                    strokeDasharray="5 3"
                    label={{ value: `h_vap = ${result.h_vap_m.toFixed(1)} m`, fontSize: 9, fill: result.global_min_H_m < result.h_vap_m ? "#dc2626" : "#d97706", position: "insideTopLeft" }}
                  />
                  <ReferenceLine
                    y={0}
                    stroke={result.global_min_H_m < 0 ? "#dc2626" : "#94a3b8"}
                    strokeDasharray="2 2"
                    label={{ value: "0 m (atm)", fontSize: 9, fill: result.global_min_H_m < 0 ? "#dc2626" : "#94a3b8", position: "insideBottomRight" }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
              </ChartErrorBoundary>
            </Section>
          )}

          {/* Time histories */}
          {historyData.length > 0 && (
            <Section title="Time History — Head at Observation Points">
              <ChartErrorBoundary label="Observation Point Histories">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={historyData} margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="t" label={{ value: "Time (s)", position: "insideBottomRight", offset: -4, fontSize: 10 }} tick={{ fontSize: 10 }} />
                  <YAxis width={56} label={{ value: "Head (m)", angle: -90, position: "insideLeft", fontSize: 10 }} tick={{ fontSize: 10 }} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-xl border border-slate-200 bg-white shadow-lg px-3 py-2.5 text-xs space-y-1.5 min-w-[190px]">
                          <p className="font-semibold text-slate-500 border-b border-slate-100 pb-1.5 mb-1">
                            t = {Number(label).toFixed(3)} s
                          </p>
                          {payload.map((p) => (
                            <div key={p.dataKey as string} className="flex justify-between items-center gap-4">
                              <span className="flex items-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                                <span className="text-slate-600">{String(p.name)}</span>
                              </span>
                              <span className="font-bold font-mono text-slate-800">
                                {typeof p.value === "number" ? `${p.value.toFixed(2)} m` : "—"}
                              </span>
                            </div>
                          ))}
                          <div className="border-t border-slate-100 pt-1.5 text-[10px] text-amber-600 font-mono">
                            h_vap = {result.h_vap_m.toFixed(2)} m
                          </div>
                        </div>
                      );
                    }}
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
                    stroke={result.global_min_H_m < result.h_vap_m ? "#dc2626" : "#f59e0b"}
                    strokeDasharray="4 3"
                    label={{ value: "h_vap", fontSize: 9, fill: result.global_min_H_m < result.h_vap_m ? "#dc2626" : "#d97706" }}
                  />
                  <ReferenceLine
                    y={0}
                    stroke={result.global_min_H_m < 0 ? "#dc2626" : "#94a3b8"}
                    strokeDasharray="2 2"
                    label={{ value: "0 m", fontSize: 9, fill: result.global_min_H_m < 0 ? "#dc2626" : "#94a3b8", position: "insideBottomRight" }}
                  />
                </LineChart>
              </ResponsiveContainer>
              </ChartErrorBoundary>
            </Section>
          )}

          {/* Atm pressure + NPSHr summary */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-[11px] font-mono text-slate-600 space-y-1.5">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 font-sans">Fluid Properties</p>
            <p>h_vap ({result.temperature_C} °C) = <strong className="text-slate-800">{result.h_vap_m.toFixed(3)} m</strong> gauge</p>
            <p>Atmospheric pressure = <strong className="text-slate-800">{result.atm_pressure_kPa.toFixed(1)} kPa</strong>
               {" "}= {(result.atm_pressure_kPa * 1000 / (parseFloat(rhoStr) * G)).toFixed(2)} m head</p>
            {result.NPSHr_m !== null && (
              <p>NPSHr (pump curve) = <strong className="text-slate-800">{result.NPSHr_m.toFixed(2)} m</strong></p>
            )}
            <p>NPSHa steady = <strong className="text-slate-800">{result.npsha_steady_m.toFixed(3)} m</strong>
               {"  "}|{"  "}NPSHa min = <strong className={result.transient_npsh_risk ? "text-red-700" : "text-emerald-700"}>{result.npsha_min_m.toFixed(3)} m</strong></p>
          </div>

          {/* ── What-If Surge Protection ─────────────────────────────────── */}
          {lastRunParams && (
            <Section title="Surge Protection — What-If Comparison">
              {!whatIfResult ? (
                <ProtectionDevicePanel
                  {...lastRunParams}
                  onResult={(r) => {
                    setWhatIfResult(r);
                    dispatch({ type: "SET_WHATIF_RESULT", result: r });
                  }}
                />
              ) : (
                <div className="space-y-4">
                  <WhatIfComparisonPanel
                    result={whatIfResult}
                    onSaveToReport={(r) => dispatch({ type: "SET_WHATIF_RESULT", result: r })}
                  />
                  <button
                    onClick={() => setWhatIfResult(null)}
                    className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
                  >
                    ← Re-configure devices
                  </button>
                </div>
              )}
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
