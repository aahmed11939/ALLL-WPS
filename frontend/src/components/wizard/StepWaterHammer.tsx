import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer, Cell,
} from "recharts";
import TermTip from "../TermTip";
import { useProject } from "../../contexts/ProjectContext";
import { computeSurgeQuick, computeWaveSpeed } from "../../utils/api";
import type {
  SurgeQuickResponse,
  SurgeEventType,
  WaveSpeedResponse,
  PressureRatingCheck,
} from "../../utils/api";
import type { WaterHammerConfig } from "../../types/project";
import StepWaterHammerModeB  from "./StepWaterHammerModeB";
import StepSuctionSurgeMOC   from "./StepSuctionSurgeMOC";
import SurgeSummaryPanel      from "./SurgeSummaryPanel";
import ChartErrorBoundary     from "../ChartErrorBoundary";
import { FT_PER_M, M_PER_FT, FPS_PER_MS, IN_PER_MM, PSI_PER_KPA } from "../../utils/units";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const G = 9.81;

const WAVE_SPEED_PRESETS: { label: string; value: number }[] = [
  { label: "HDPE PE100 (~350 m/s)",            value: 350  },
  { label: "PVC / uPVC (~400 m/s)",            value: 400  },
  { label: "GRP / FRP (~500 m/s)",             value: 500  },
  { label: "Ductile Iron / DICL (~1000 m/s)",  value: 1000 },
  { label: "Steel — welded (~1200 m/s)",       value: 1200 },
  { label: "AC / Asbestos Cement (~1100 m/s)", value: 1100 },
  { label: "Concrete / RCCP (~1000 m/s)",      value: 1000 },
];

const PIPE_MATERIALS_FE = [
  { value: "dicl",            label: "Ductile Iron (DICL)",    E_p: 168000 },
  { value: "grey_cast_iron",  label: "Grey Cast Iron",          E_p: 96500  },
  { value: "steel",           label: "Steel (welded)",          E_p: 206000 },
  { value: "pvc_upvc",        label: "PVC / uPVC",              E_p: 3000   },
  { value: "hdpe_pe100",      label: "HDPE PE100",              E_p: 900    },
  { value: "grp_frp",         label: "GRP / FRP",               E_p: 25000  },
  { value: "asbestos_cement", label: "Asbestos Cement",         E_p: 24000  },
  { value: "concrete_rccp",   label: "Concrete / RCCP",         E_p: 30000  },
];

const RESTRAINT_OPTIONS = [
  { value: "free",              label: "Free",              desc: "Expansion joints throughout — C = 1.0" },
  { value: "anchored_upstream", label: "Anchored upstream", desc: "Anchored at upstream end, free downstream — C = 1 − ν/2" },
  { value: "restrained",        label: "Fully restrained",  desc: "Buried / fully restrained — C = 1 − ν²" },
];

const PN_PRESETS = [
  { label: "PN 10",   kPa: 1000 },
  { label: "PN 12.5", kPa: 1250 },
  { label: "PN 16",   kPa: 1600 },
  { label: "PN 20",   kPa: 2000 },
  { label: "PN 25",   kPa: 2500 },
  { label: "PN 32",   kPa: 3200 },
];

const EVENT_TYPES: {
  value: SurgeEventType;
  label: string;
  description: string;
  needsClosure: boolean;
  pipeline: "suction" | "discharge" | "both";
}[] = [
  {
    value: "pump_trip",
    label: "Pump Trip",
    description: "Sudden loss of power — flow decelerates from V₀ to zero",
    needsClosure: false,
    pipeline: "both",
  },
  {
    value: "valve_closure_downstream",
    label: "Downstream Valve Closure",
    description: "Valve at discharge end closes — positive wave at valve",
    needsClosure: true,
    pipeline: "discharge",
  },
  {
    value: "valve_closure_upstream",
    label: "Upstream Valve Closure",
    description: "Valve at suction end closes — positive wave at valve",
    needsClosure: true,
    pipeline: "suction",
  },
  {
    value: "check_valve_slam",
    label: "Check Valve Slam",
    description: "Check valve slams shut on flow reversal — rapid closure",
    needsClosure: false,
    pipeline: "discharge",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pipelineLength(segments: { length_m: number }[]): number {
  return segments.reduce((s, seg) => s + seg.length_m, 0);
}
function fmtH(m: number, us: boolean): string {
  return us ? `${(m * 3.28084).toFixed(2)} ft` : `${m.toFixed(2)} m`;
}
function fmtP(kPa: number, us: boolean): string {
  return us ? `${(kPa * PSI_PER_KPA).toFixed(2)} psi` : `${kPa.toFixed(1)} kPa`;
}
function fmtV(ms: number, us: boolean): string {
  return us ? `${(ms * 3.28084).toFixed(3)} ft/s` : `${ms.toFixed(3)} m/s`;
}
function localVaporPressureHead(T_C: number, rho = 1000): number {
  const log_p = 8.07131 - 1730.63 / (233.426 + T_C);
  const p_kPa = Math.pow(10, log_p) * 0.133322;
  return (p_kPa - 101.325) * 1000 / (rho * G);
}

// ---------------------------------------------------------------------------
// Sub-components
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
function FieldRow({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  const grid =
    cols === 2 ? "grid-cols-2"
    : cols === 3 ? "grid-cols-3"
    : "grid-cols-1";
  return <div className={`grid gap-3 ${grid}`}>{children}</div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
      {children}
    </div>
  );
}
function KpiCard({
  label, value, value2, sub, highlight,
}: {
  label: string; value: string; value2?: string; sub?: string;
  highlight?: "green" | "amber" | "red" | "blue";
}) {
  const colors = {
    green: "bg-emerald-50 border-emerald-200",
    amber: "bg-amber-50  border-amber-200",
    red:   "bg-red-50    border-red-200",
    blue:  "bg-blue-50   border-blue-200",
  };
  const cls = highlight ? colors[highlight] : "bg-slate-50 border-slate-200";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{label}</p>
      <p className="text-sm font-bold text-slate-800 font-mono">{value}</p>
      {value2 && <p className="text-xs text-slate-500 font-mono">{value2}</p>}
      {sub    && <p className="text-[10px] text-slate-400 mt-1 leading-tight">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pressure Rating Check sub-component
// ---------------------------------------------------------------------------

function RatingCheckPanel({ rc, us }: { rc: PressureRatingCheck; us: boolean }) {
  const fmtP2 = (kPa: number) =>
    us ? `${(kPa * PSI_PER_KPA).toFixed(1)} psi` : `${kPa.toFixed(1)} kPa`;

  const statusCfg = {
    pass:    { bg: "bg-emerald-50 border-emerald-200", badge: "bg-emerald-100 text-emerald-700", icon: "✓", text: "PASS" },
    caution: { bg: "bg-amber-50 border-amber-200",     badge: "bg-amber-100 text-amber-700",     icon: "⚠", text: "CAUTION" },
    fail:    { bg: "bg-red-50 border-red-200",         badge: "bg-red-100 text-red-700",         icon: "✗", text: "FAIL" },
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
          <span className="text-slate-500">Max transient</span>
          <span className="font-mono font-semibold text-slate-800">{fmtP2(rc.max_transient_kPa)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Pressure class</span>
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
        {rc.rating_status === "pass"    && "FoS ≥ 1.25 — pipe pressure class provides adequate margin."}
        {rc.rating_status === "caution" && "1.0 ≤ FoS < 1.25 — marginal. Consider surge protection or a higher PN class."}
        {rc.rating_status === "fail"    && "FoS < 1.0 — peak transient EXCEEDS pipe pressure class. Surge protection required."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Analysis (Mode A) — shared for both pipelines, pipeline prop drives it
// ---------------------------------------------------------------------------

function QuickAnalysisPanel({ activePipeline }: { activePipeline: "suction" | "discharge" }) {
  const { draft, dispatch } = useProject();
  const us  = draft.unitSystem === "US";
  const cfg = draft.waterHammerConfig;
  const displayFactor = us ? FT_PER_M : 1;
  const headUnit = us ? "ft" : "m";
  const velUnit  = us ? "ft/s" : "m/s";

  const autoV0  = draft.hydraulicsResult?.velocity_ms ?? null;
  const autoTDH = draft.hydraulicsResult?.tdh_m ?? null;
  const suctionLen   = pipelineLength(draft.suction.segments);
  const dischargeLen = pipelineLength(draft.discharge.segments);
  const pipeLen = activePipeline === "suction" ? suctionLen : dischargeLen;

  // Shared form state
  const [wavespeed,      setWavespeed]      = useState<string>(String(cfg?.wave_speed_ms ?? 400));
  const [eventType,      setEventType]      = useState<SurgeEventType>(cfg?.event_type ?? "pump_trip");
  // Override seeds are persisted in SI; convert to display units on mount
  const [v0Override,     setV0Override]     = useState<string>(() => {
    const s = cfg?.V0_override ?? "";
    if (!s) return "";
    const v = parseFloat(s);
    return isNaN(v) ? "" : (us ? String((v * FPS_PER_MS).toFixed(4)) : s);
  });
  const [closureTime,    setClosureTime]    = useState<string>(cfg?.closure_time_s ?? "");
  const [hOpOverride,    setHOpOverride]    = useState<string>(() => {
    const s = cfg?.H_operating_override ?? "";
    if (!s) return "";
    const v = parseFloat(s);
    return isNaN(v) ? "" : (us ? String((v * FT_PER_M).toFixed(2)) : s);
  });
  const [rho,            setRho]            = useState<string>(String(cfg?.rho_kg_m3 ?? 1000));
  const [temperatureC,   setTemperatureC]   = useState<string>(cfg?.temperature_C ?? "20");
  const [pressRatingKPa, setPressRatingKPa] = useState<string>(cfg?.pressure_rating_kPa ?? "");

  // Wave speed calculator
  const [showWaveCalc,    setShowWaveCalc]    = useState(false);
  const [waveMat,         setWaveMat]         = useState(cfg?.pipe_material ?? "dicl");
  const [waveDoMm,        setWaveDoMm]        = useState(cfg?.D_o_mm ?? "");
  const [waveWallMm,      setWaveWallMm]      = useState(cfg?.wall_thickness_mm ?? "");
  const [waveSdr,         setWaveSdr]         = useState(cfg?.sdr ?? "");
  const [useSDR,          setUseSDR]          = useState(cfg?.use_sdr ?? false);
  const [waveRestraint,   setWaveRestraint]   = useState(cfg?.restraint ?? "restrained");
  const [waveCalcResult,  setWaveCalcResult]  = useState<WaveSpeedResponse | null>(null);
  const [waveCalcLoading, setWaveCalcLoading] = useState(false);
  const [waveCalcError,   setWaveCalcError]   = useState<string | null>(null);

  const [computing, setComputing] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [result,    setResult]    = useState<SurgeQuickResponse | null>(
    draft.waterHammerResult ?? null
  );

  // SI values for calculations (v0Override and hOpOverride are stored in display units)
  const effectiveV0_si: number = (() => {
    const ov = parseFloat(v0Override);
    if (!isNaN(ov) && ov >= 0) return us ? ov * M_PER_FT : ov;
    return autoV0 ?? 0;
  })();

  const effectiveH_si: number = (() => {
    const ov = parseFloat(hOpOverride);
    if (!isNaN(ov)) return us ? ov * M_PER_FT : ov;
    return autoTDH ?? 0;
  })();

  // Display values for the inputs
  const autoV0Display  = autoV0  !== null ? (us ? autoV0  * FPS_PER_MS : autoV0)  : null;
  const autoTDHDisplay = autoTDH !== null ? (us ? autoTDH * FT_PER_M   : autoTDH) : null;

  const selectedEvent  = EVENT_TYPES.find(e => e.value === eventType)!;
  const needsClosure   = selectedEvent?.needsClosure ?? false;
  const previewA       = parseFloat(wavespeed) || 400;
  const previewRho     = parseFloat(rho) || 1000;
  const previewDH      = (previewA * effectiveV0_si) / G;
  const previewDP      = previewRho * previewA * effectiveV0_si / 1000;
  const previewT       = pipeLen > 0 ? (2 * pipeLen / previewA) : 0;
  const tempCNum       = parseFloat(temperatureC);
  const validTemp      = !isNaN(tempCNum) && tempCNum >= -10 && tempCNum <= 100;
  const localVapHead   = validTemp ? localVaporPressureHead(tempCNum, previewRho) : -10.09;
  const displayVapHead = result?.vapor_pressure_head_m ?? localVapHead;

  // Filter event types appropriate to the active pipeline
  const filteredEvents = EVENT_TYPES.filter(
    e => e.pipeline === activePipeline || e.pipeline === "both"
  );

  const ratingCheckToShow: PressureRatingCheck | null = useMemo(() => {
    if (!result) return null;
    const rating = parseFloat(pressRatingKPa);
    if (isNaN(rating) || rating <= 0) return null;
    if (result.rating_check && Math.abs(result.rating_check.pressure_rating_kPa - rating) < 0.5) {
      return result.rating_check;
    }
    const maxKPa    = result.max_pressure_kPa;
    const minKPa    = result.min_pressure_kPa;
    const steadyKPa = result.H_operating_m * result.rho_kg_m3 * G / 1000;
    const fos       = maxKPa > 0 ? rating / maxKPa : Infinity;
    const rating_status: "pass" | "caution" | "fail" =
      fos >= 1.25 ? "pass" : fos >= 1.0 ? "caution" : "fail";
    return { steady_state_pressure_kPa: steadyKPa, max_transient_kPa: maxKPa, min_transient_kPa: minKPa, pressure_rating_kPa: rating, factor_of_safety: fos, rating_status };
  }, [result, pressRatingKPa]);

  const persistConfig = useCallback(() => {
    const config: WaterHammerConfig = {
      pipeline:             activePipeline,
      wave_speed_ms:        parseFloat(wavespeed) || 400,
      // Store overrides in SI so they can be correctly converted to display
      // units on mount, regardless of which unit system was active when saved.
      V0_override: v0Override && !isNaN(parseFloat(v0Override)) && us
        ? String((parseFloat(v0Override) * M_PER_FT).toFixed(4))
        : v0Override,
      event_type:           eventType,
      closure_time_s:       closureTime,
      H_operating_override: hOpOverride && !isNaN(parseFloat(hOpOverride)) && us
        ? String((parseFloat(hOpOverride) * M_PER_FT).toFixed(2))
        : hOpOverride,
      rho_kg_m3:            parseFloat(rho) || 1000,
      temperature_C:        temperatureC,
      pressure_rating_kPa:  pressRatingKPa,
      pipe_material:        waveMat,
      D_o_mm:               waveDoMm,
      wall_thickness_mm:    waveWallMm,
      sdr:                  waveSdr,
      use_sdr:              useSDR,
      restraint:            waveRestraint,
    };
    dispatch({ type: "SET_WATER_HAMMER_CONFIG", config });
  }, [
    activePipeline, wavespeed, eventType, v0Override, closureTime, hOpOverride,
    rho, temperatureC, pressRatingKPa, waveMat, waveDoMm, waveWallMm,
    waveSdr, useSDR, waveRestraint, dispatch,
  ]);

  // Convert manually-typed override values when unit system is toggled mid-session
  const prevUsRef = useRef(us);
  useEffect(() => {
    if (prevUsRef.current === us) return;
    prevUsRef.current = us;
    if (us) {
      // SI → US
      setV0Override(prev => prev ? String((parseFloat(prev) * FPS_PER_MS).toFixed(4)) : prev);
      setHOpOverride(prev => prev ? String((parseFloat(prev) * FT_PER_M).toFixed(2)) : prev);
    } else {
      // US → SI
      setV0Override(prev => prev ? String((parseFloat(prev) * M_PER_FT).toFixed(4)) : prev);
      setHOpOverride(prev => prev ? String((parseFloat(prev) * M_PER_FT).toFixed(2)) : prev);
    }
  }, [us]); // eslint-disable-line react-hooks/exhaustive-deps

  const whConfigMountedRef = useRef(false);
  useEffect(() => {
    if (!whConfigMountedRef.current) { whConfigMountedRef.current = true; return; }
    persistConfig();
  }, [persistConfig]);

  async function handleCompute() {
    setError(null);
    const a     = parseFloat(wavespeed);
    const rhoV  = parseFloat(rho);
    const tc    = needsClosure && closureTime ? parseFloat(closureTime) : undefined;
    const tempV = parseFloat(temperatureC);
    const ratingV = parseFloat(pressRatingKPa);

    if (isNaN(a) || a <= 0)    { setError("Wave speed must be a positive number."); return; }
    if (isNaN(rhoV) || rhoV <= 0) { setError("Fluid density must be positive."); return; }
    if (pipeLen <= 0)          { setError("Pipe length is zero — configure pipeline segments first."); return; }
    if (effectiveV0_si <= 0 && !v0Override) {
      setError("Run Hydraulics first (Step 6) to get flow velocity, or enter V₀ manually.");
      return;
    }
    if (needsClosure && closureTime && (isNaN(Number(closureTime)) || Number(closureTime) <= 0)) {
      setError("Closure time must be a positive number."); return;
    }

    setComputing(true);
    try {
      const res = await computeSurgeQuick({
        pipeline:            activePipeline,
        wave_speed_ms:       a,
        V0_ms:               effectiveV0_si,
        event_type:          eventType,
        pipe_length_m:       pipeLen,
        closure_time_s:      tc ?? null,
        rho_kg_m3:           rhoV,
        H_operating_m:       effectiveH_si,
        temperature_C:       isNaN(tempV) ? 20 : tempV,
        pressure_rating_kPa: (!isNaN(ratingV) && ratingV > 0) ? ratingV : null,
        unit_system:         draft.unitSystem,
      });
      setResult(res);
      dispatch({ type: "SET_WATER_HAMMER_RESULT", result: res });
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ??
        (e as Error)?.message ??
        "Computation failed.";
      setError(msg);
    } finally {
      setComputing(false);
    }
  }

  function handleClear() {
    setResult(null);
    dispatch({ type: "SET_WATER_HAMMER_RESULT", result: null });
  }

  async function handleWaveCalc() {
    setWaveCalcError(null);
    const doMm = parseFloat(waveDoMm);
    if (isNaN(doMm) || doMm <= 0) { setWaveCalcError("Enter a valid outer diameter."); return; }
    if (!waveMat) { setWaveCalcError("Select a pipe material."); return; }
    let wallMm: number | null = null;
    let sdrV:   number | null = null;
    if (useSDR) {
      sdrV = parseFloat(waveSdr);
      if (isNaN(sdrV) || sdrV <= 2) { setWaveCalcError("SDR must be > 2."); return; }
    } else {
      wallMm = parseFloat(waveWallMm);
      if (isNaN(wallMm) || wallMm <= 0) { setWaveCalcError("Enter a valid wall thickness."); return; }
    }
    setWaveCalcLoading(true);
    try {
      const res = await computeWaveSpeed({
        material:          waveMat,
        D_o_mm:            doMm,
        wall_thickness_mm: wallMm,
        sdr:               sdrV,
        restraint:         waveRestraint as "free" | "anchored_upstream" | "restrained",
        rho_kg_m3:         parseFloat(rho) || 1000,
      });
      setWaveCalcResult(res);
      setWavespeed(String(res.wave_speed_ms));
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ??
        (e as Error)?.message ??
        "Wave speed calculation failed.";
      setWaveCalcError(msg);
    } finally {
      setWaveCalcLoading(false);
    }
  }

  const accentRing = activePipeline === "suction"
    ? "focus:ring-cyan-400"
    : "focus:ring-blue-400";

  const inp = `w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 ${accentRing}`;

  return (
    <div className="space-y-5">

      {/* Joukowsky assumption note */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/40 px-5 py-3 text-[10px] text-blue-700 leading-relaxed">
        <strong className="font-bold text-blue-800">Mode A — Quick Check (Joukowsky/Allievi). </strong>
        ΔH = a·ΔV/g for instantaneous events; reduced by K = T/t<sub>c</sub> when t<sub>c</sub> &gt; T = 2L/a.
        Use Mode B (MOC) for detailed simulation.
      </div>

      {/* ── Wave Speed Calculator (collapsible) ────────────────────────────── */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/40 overflow-hidden">
        <button
          onClick={() => setShowWaveCalc(v => !v)}
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-blue-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-blue-600 text-sm">⚙</span>
            <span className="text-sm font-semibold text-blue-800">Wave Speed Calculator</span>
            <span className="text-[10px] text-blue-400 font-normal">
              — derive <em>a</em> from pipe geometry &amp; material
            </span>
          </div>
          <div className="flex items-center gap-3">
            {!showWaveCalc && waveCalcResult && (
              <span className="text-xs font-mono text-blue-700 font-semibold">
                a = {waveCalcResult.wave_speed_ms} m/s
              </span>
            )}
            <span className="text-blue-400 text-xs">{showWaveCalc ? "▲ collapse" : "▼ expand"}</span>
          </div>
        </button>

        {showWaveCalc && (
          <div className="px-5 pb-5 space-y-4 border-t border-blue-200 pt-4">

            <FieldRow cols={2}>
              <div>
                <Label>Pipe material</Label>
                <select
                  value={waveMat}
                  onChange={e => setWaveMat(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {PIPE_MATERIALS_FE.map(m => (
                    <option key={m.value} value={m.value}>
                      {m.label}  (Eₚ = {m.E_p.toLocaleString()} MPa)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Outer diameter D<sub>o</sub> [mm]</Label>
                <input
                  type="number" min={10} step={1}
                  value={waveDoMm}
                  onChange={e => setWaveDoMm(e.target.value)}
                  placeholder="e.g. 355"
                  className={inp}
                />
              </div>
            </FieldRow>

            <div>
              <div className="flex items-center gap-4 mb-2">
                <Label>Wall thickness</Label>
                <div className="flex gap-1 ml-auto">
                  {[{ id: false, l: "e [mm]" }, { id: true, l: "SDR" }].map(opt => (
                    <button
                      key={String(opt.id)}
                      onClick={() => setUseSDR(opt.id)}
                      className={`text-[10px] px-2 py-0.5 rounded font-semibold transition-colors ${
                        useSDR === opt.id
                          ? "bg-blue-600 text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
              {useSDR ? (
                <>
                  <input
                    type="number" min={3} step={0.5}
                    value={waveSdr}
                    onChange={e => setWaveSdr(e.target.value)}
                    placeholder="e.g. 17 (HDPE SDR 17)"
                    className={inp}
                  />
                  {waveDoMm && waveSdr && (
                    <Hint>
                      e = {parseFloat(waveDoMm).toFixed(0)}/{parseFloat(waveSdr)} ={" "}
                      {(parseFloat(waveDoMm) / parseFloat(waveSdr)).toFixed(2)} mm
                    </Hint>
                  )}
                </>
              ) : (
                <input
                  type="number" min={1} step={0.1}
                  value={waveWallMm}
                  onChange={e => setWaveWallMm(e.target.value)}
                  placeholder="e.g. 12.5"
                  className={inp}
                />
              )}
            </div>

            <div>
              <Label>Pipe restraint condition</Label>
              <div className="space-y-1.5">
                {RESTRAINT_OPTIONS.map(r => (
                  <label key={r.value} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio" name="restraint" value={r.value}
                      checked={waveRestraint === r.value}
                      onChange={() => setWaveRestraint(r.value)}
                      className="mt-0.5"
                    />
                    <div>
                      <span className="text-xs font-semibold text-slate-700">{r.label}</span>
                      <span className="text-[10px] text-slate-400 ml-2">{r.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Water temperature [°C]</Label>
                <span className="text-xs font-mono font-semibold text-blue-700">{temperatureC} °C</span>
              </div>
              <input
                type="range" min={0} max={50} step={0.5}
                value={temperatureC}
                onChange={e => setTemperatureC(e.target.value)}
                className="w-full accent-blue-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                <span>0 °C</span>
                <span>h_vap = {fmtH(localVaporPressureHead(parseFloat(temperatureC) || 20, parseFloat(rho) || 1000), us)} gauge</span>
                <span>50 °C</span>
              </div>
            </div>

            {waveCalcError && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {waveCalcError}
              </div>
            )}

            <button
              onClick={handleWaveCalc}
              disabled={waveCalcLoading}
              className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {waveCalcLoading ? "Calculating…" : "Calculate a → fills Wave Speed field below"}
            </button>

            {waveCalcResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  <KpiCard label="Wave speed a" value={`${waveCalcResult.wave_speed_ms} m/s`} highlight="blue" />
                  <KpiCard
                    label="Inner diameter Dᵢ"
                    value={us
                      ? `${(waveCalcResult.D_i_mm * IN_PER_MM).toFixed(3)} in`
                      : `${waveCalcResult.D_i_mm.toFixed(2)} mm`}
                    sub={us
                      ? `Wall = ${(waveCalcResult.wall_mm * IN_PER_MM).toFixed(3)} in  SDR ${waveCalcResult.sdr_used.toFixed(1)}`
                      : `Wall = ${waveCalcResult.wall_mm.toFixed(2)} mm  SDR ${waveCalcResult.sdr_used.toFixed(1)}`}
                  />
                  <KpiCard label="Restraint C" value={waveCalcResult.C.toFixed(4)} sub={waveCalcResult.restraint} />
                </div>
                <div className="rounded-lg bg-slate-900 border border-slate-700 px-4 py-3 overflow-x-auto">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Equation trace</p>
                  <pre className="text-[10px] font-mono text-green-300 whitespace-pre leading-relaxed">
                    {waveCalcResult.equation_trace}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Main input form ───────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-5 shadow-sm">

        {/* Pipeline info strip */}
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-2.5 flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Pipeline</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            activePipeline === "suction"
              ? "bg-cyan-100 text-cyan-700"
              : "bg-blue-100 text-blue-700"
          }`}>
            {activePipeline === "suction" ? "⬆ Suction" : "⬇ Discharge"}
          </span>
          <span className="text-xs text-slate-500 font-mono">
            L = {fmtH(pipeLen, us)}
          </span>
        </div>

        <Section title="Transient Event">
          <div>
            <Label>Event type</Label>
            <select
              value={eventType}
              onChange={e => setEventType(e.target.value as SurgeEventType)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {filteredEvents.map(et => (
                <option key={et.value} value={et.value}>{et.label}</option>
              ))}
            </select>
            <Hint>{selectedEvent?.description}</Hint>
          </div>

          {needsClosure && (
            <div>
              <Label>Closure time t<sub>c</sub> [s]</Label>
              <input
                type="number" min={0} step={0.5}
                placeholder="e.g. 10"
                value={closureTime}
                onChange={e => setClosureTime(e.target.value)}
                className={inp}
              />
              <Hint>
                Leave blank for instantaneous closure (full Joukowsky).
                {previewT > 0 && ` T = ${previewT.toFixed(2)} s — closure is ${
                  closureTime && Number(closureTime) > previewT ? "SLOW (reduced)" : "RAPID (full Joukowsky)"
                }.`}
              </Hint>
            </div>
          )}
        </Section>

        <Section title="Pipe &amp; Fluid">
          <FieldRow>
            <div>
              <Label>Wave speed <TermTip term="a" /> [m/s]</Label>
              <input
                type="number" min={10} max={2000} step={10}
                value={wavespeed}
                onChange={e => setWavespeed(e.target.value)}
                className={inp}
              />
              {waveCalcResult && (
                <p className="text-[10px] text-blue-500 mt-0.5">
                  ← set by Wave Speed Calculator ({waveCalcResult.material_name})
                </p>
              )}
            </div>
            <div>
              <Label>Material preset</Label>
              <select
                defaultValue=""
                onChange={e => { if (e.target.value) setWavespeed(e.target.value); }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                <option value="">— quick preset —</option>
                {WAVE_SPEED_PRESETS.map(p => (
                  <option key={p.label} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
          </FieldRow>

          <FieldRow cols={3}>
            <div>
              <Label>Pipe length L [{headUnit}]</Label>
              <input
                type="number" readOnly
                value={us ? (pipeLen * FT_PER_M).toFixed(1) : pipeLen.toFixed(1)}
                className="w-full rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-500 cursor-default"
              />
              <Hint>Auto from {activePipeline} segments</Hint>
            </div>
            <div>
              <Label>
                V₀ [{velUnit}]{" "}
                {autoV0 !== null && !v0Override && (
                  <span className="text-blue-500 font-normal">(auto)</span>
                )}
              </Label>
              <input
                type="number" min={0} step={0.01}
                value={v0Override !== "" ? v0Override : (autoV0Display !== null ? autoV0Display.toFixed(3) : "")}
                onChange={e => setV0Override(e.target.value)}
                placeholder={autoV0Display !== null ? autoV0Display.toFixed(3) : "run hydraulics"}
                className={`w-full rounded-lg border px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  v0Override ? "border-amber-300 bg-amber-50" : "border-slate-200"
                }`}
              />
              {v0Override && (
                <button onClick={() => setV0Override("")} className="text-[10px] text-blue-500 hover:underline mt-0.5">
                  ← restore auto
                </button>
              )}
              <Hint>Steady-state velocity (ΔV = V₀)</Hint>
            </div>
            <div>
              <Label>Fluid density ρ [kg/m³]</Label>
              <input
                type="number" min={500} max={1500} step={1}
                value={rho}
                onChange={e => setRho(e.target.value)}
                className={inp}
              />
              <Hint>Potable water ≈ 998–1001 kg/m³ at 10–20 °C</Hint>
            </div>
          </FieldRow>

          <FieldRow>
            <div>
              <Label>
                Operating head H₀ [{headUnit} gauge]{" "}
                {autoTDH !== null && !hOpOverride && (
                  <span className="text-blue-500 font-normal">(auto from TDH)</span>
                )}
              </Label>
              <input
                type="number" step={0.1}
                value={hOpOverride !== "" ? hOpOverride : (autoTDHDisplay !== null ? autoTDHDisplay.toFixed(2) : "")}
                onChange={e => setHOpOverride(e.target.value)}
                placeholder={autoTDHDisplay !== null ? autoTDHDisplay.toFixed(2) : "e.g. 35"}
                className={`w-full rounded-lg border px-3 py-2 text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  hOpOverride ? "border-amber-300 bg-amber-50" : "border-slate-200"
                }`}
              />
              {hOpOverride && (
                <button onClick={() => setHOpOverride("")} className="text-[10px] text-blue-500 hover:underline mt-0.5">
                  ← restore auto
                </button>
              )}
              <Hint>Steady-state head at event origin. Pump discharge ≈ TDH.</Hint>
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 text-[11px] text-blue-700 flex items-center justify-between">
              <span>
                Temperature: <strong className="font-mono">{temperatureC} °C</strong>
                {" · "}h<sub>vap</sub>:{" "}
                <strong className="font-mono">{fmtH(localVapHead, us)}</strong> gauge
              </span>
              <button
                onClick={() => setShowWaveCalc(true)}
                className="text-[10px] underline text-blue-500 hover:text-blue-700 whitespace-nowrap ml-2"
              >
                adjust in Wave Speed ↑
              </button>
            </div>
          </FieldRow>
        </Section>

        <Section title="Pressure Rating (optional)">
          <div>
            <Label>
              Pipe pressure class [{us ? "kPa gauge  (psi shown on presets)" : "kPa gauge"}]
            </Label>
            <div className="flex gap-2 flex-wrap mb-2">
              {PN_PRESETS.map(pn => (
                <button
                  key={pn.label}
                  onClick={() => setPressRatingKPa(String(pn.kPa))}
                  className={`text-[10px] px-2 py-1 rounded font-semibold border transition-colors ${
                    pressRatingKPa === String(pn.kPa)
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-200 hover:border-blue-400 hover:text-blue-600"
                  }`}
                >
                  {pn.label}{us ? ` ≈ ${(pn.kPa * PSI_PER_KPA).toFixed(0)} psi` : ""}
                </button>
              ))}
              {pressRatingKPa && (
                <button
                  onClick={() => setPressRatingKPa("")}
                  className="text-[10px] px-2 py-1 rounded text-slate-400 hover:text-slate-600 border border-slate-100"
                >
                  ✕ clear
                </button>
              )}
            </div>
            <input
              type="number" min={100} step={50}
              value={pressRatingKPa}
              onChange={e => setPressRatingKPa(e.target.value)}
              placeholder="e.g. 1600  (PN 16)"
              className={inp}
            />
            <Hint>
              PN 10 = 1000 kPa · PN 16 = 1600 kPa · PN 25 = 2500 kPa
              {us && " · 1 kPa ≈ 0.145 psi"}
            </Hint>
          </div>
        </Section>

        {/* Live equation preview */}
        {effectiveV0_si > 0 && previewA > 0 && pipeLen > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-[11px] font-mono text-slate-600 space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 font-sans">
              Live preview (Joukowsky, no reduction)
            </p>
            <p>ΔH = a·ΔV/g = {previewA.toFixed(0)}·{effectiveV0_si.toFixed(3)}/{G} = <strong className="text-slate-800">{fmtH(previewDH, us)}</strong></p>
            <p>ΔP = ρ·a·ΔV = {previewRho}·{previewA.toFixed(0)}·{effectiveV0_si.toFixed(3)}/1000 = <strong className="text-slate-800">{fmtP(previewDP, us)}</strong></p>
            <p>T = 2L/a = 2×{pipeLen.toFixed(1)}/{previewA.toFixed(0)} = <strong className="text-slate-800">{previewT.toFixed(3)} s</strong></p>
            <p>h_vap = <strong className="text-slate-800">{fmtH(localVapHead, us)}</strong> gauge {validTemp ? `at ${tempCNum} °C` : ""}</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={handleCompute}
          disabled={computing}
          className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {computing
            ? "Computing surge…"
            : `⚡ Run Quick Surge Analysis — ${activePipeline} (${us ? (pipeLen * FT_PER_M).toFixed(0) : pipeLen.toFixed(0)} ${headUnit})`}
        </button>
      </div>

      {/* ── Results ──────────────────────────────────────────────────────── */}
      {result && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-6 shadow-sm">

          <Section title="Joukowsky Surge">
            <div className="grid grid-cols-3 gap-3">
              <KpiCard
                label="Full Joukowsky ΔH"
                value={fmtH(result.delta_H_joukowsky_m, us)}
                value2={`(${result.delta_H_joukowsky_m.toFixed(3)} m)`}
                sub="a·ΔV/g — instantaneous"
              />
              <KpiCard
                label="Full Joukowsky ΔP"
                value={fmtP(result.delta_P_joukowsky_kPa, us)}
                value2={`(${result.delta_P_joukowsky_kPa.toFixed(2)} kPa)`}
                sub="ρ·a·ΔV — instantaneous"
              />
              <KpiCard
                label="Char. Time T = 2L/a"
                value={`${result.T_char_s.toFixed(3)} s`}
                sub={`2 × ${result.pipe_length_m.toFixed(1)} / ${result.wave_speed_ms.toFixed(0)}`}
              />
            </div>
          </Section>

          <Section title="Effective Surge (after reduction)">
            <div className="grid grid-cols-3 gap-3">
              <KpiCard
                label="Effective ΔH"
                value={fmtH(result.delta_H_m, us)}
                value2={`(${result.delta_H_m.toFixed(3)} m)`}
                highlight={result.delta_H_m > 30 ? "red" : result.delta_H_m > 15 ? "amber" : "green"}
                sub="K × ΔH_Joukowsky"
              />
              <KpiCard
                label="Effective ΔP"
                value={fmtP(result.delta_P_kPa, us)}
                value2={`(${result.delta_P_kPa.toFixed(2)} kPa)`}
                highlight={result.delta_P_kPa > 294 ? "red" : result.delta_P_kPa > 147 ? "amber" : "green"}
                sub="K × ΔP_Joukowsky"
              />
              <KpiCard
                label="Reduction K"
                value={result.reduction_factor.toFixed(4)}
                value2={result.reduction_factor < 1 ? "Slow closure" : "Full Joukowsky"}
                highlight={result.reduction_factor < 1 ? "blue" : undefined}
                sub={result.closure_time_s ? `tc = ${result.closure_time_s.toFixed(2)} s` : "Instantaneous"}
              />
            </div>
          </Section>

          <Section title="Pressure Envelope at Pipe Ends">
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-slate-600">Location</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Max Head</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Min Head</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Max Press.</th>
                    <th className="text-right px-3 py-2 font-semibold text-slate-600">Min Press.</th>
                  </tr>
                </thead>
                <tbody>
                  {result.envelope.map((pt, i) => {
                    const subAtm  = pt.min_head_m < 0;
                    const cavRisk = pt.min_head_m < displayVapHead;
                    return (
                      <tr key={i} className={`border-b border-slate-100 last:border-0 ${
                        cavRisk ? "bg-red-50" : subAtm ? "bg-amber-50" : ""
                      }`}>
                        <td className="px-3 py-2 text-slate-700">{pt.location}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtH(pt.max_head_m, us)}</td>
                        <td className={`px-3 py-2 text-right font-mono font-semibold ${
                          cavRisk ? "text-red-700" : subAtm ? "text-amber-700" : "text-slate-800"
                        }`}>
                          {fmtH(pt.min_head_m, us)}{cavRisk && " ⚠"}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700">{fmtP(pt.max_pressure_kPa, us)}</td>
                        <td className={`px-3 py-2 text-right font-mono ${
                          cavRisk ? "text-red-700 font-semibold" : subAtm ? "text-amber-700 font-semibold" : "text-slate-700"
                        }`}>
                          {fmtP(pt.min_pressure_kPa, us)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-slate-50 border-t border-slate-200">
                  <tr>
                    <td className="px-3 py-2 font-semibold text-slate-600">Envelope extremes</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{fmtH(result.max_pressure_head_m, us)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${
                      result.min_pressure_head_m < displayVapHead ? "text-red-700"
                      : result.min_pressure_head_m < 0 ? "text-amber-700"
                      : "text-slate-800"
                    }`}>
                      {fmtH(result.min_pressure_head_m, us)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold">{fmtP(result.max_pressure_kPa, us)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-semibold ${
                      result.min_pressure_kPa < 0 ? "text-amber-700" : "text-slate-800"
                    }`}>
                      {fmtP(result.min_pressure_kPa, us)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-[10px] text-slate-400 leading-tight">
              Simplified Mode A envelope. Max = H₀ + ΔH_eff; Min = H₀ − ΔH_eff.
              Vapour pressure = {fmtH(displayVapHead, us)} gauge at {result.temperature_C} °C.
            </p>
          </Section>

          <Section title="Pressure Envelope — Head Chart">
            <p className="text-[10px] text-slate-400 -mt-2 mb-2 leading-relaxed">
              Red bars = max transient head; blue bars = min transient head (red when below h_vap, amber when sub-atmospheric).
              Dashed amber = vapour pressure threshold. Dashed grey = 0 {headUnit} (atmospheric).
            </p>
            <ChartErrorBoundary label="Mode A Envelope Chart">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={result.envelope.map(pt => ({
                    name: pt.location,
                    max:  pt.max_head_m * displayFactor,
                    min:  pt.min_head_m * displayFactor,
                  }))}
                  margin={{ top: 8, right: 24, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis
                    width={56}
                    tick={{ fontSize: 10 }}
                    label={{ value: `Head (${headUnit})`, angle: -90, position: "insideLeft", fontSize: 10 }}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-xl border border-slate-200 bg-white shadow-lg px-3 py-2.5 text-xs space-y-1.5 min-w-[160px]">
                          <p className="font-semibold text-slate-500 border-b border-slate-100 pb-1.5 mb-1">{label}</p>
                          {payload.map((p) => (
                            <div key={p.dataKey as string} className="flex justify-between gap-4">
                              <span className="flex items-center gap-1.5">
                                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                                <span className="text-slate-600">{p.name}</span>
                              </span>
                              <span className="font-bold font-mono text-slate-800">
                                {typeof p.value === "number" ? `${(p.value as number).toFixed(2)} ${headUnit}` : "—"}
                              </span>
                            </div>
                          ))}
                          <div className="border-t border-slate-100 pt-1.5 text-[10px] text-amber-600 font-mono">
                            h_vap = {fmtH(result.vapor_pressure_head_m, us)}
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="max" name="H_max" radius={[3, 3, 0, 0]}>
                    {result.envelope.map((_, i) => (
                      <Cell key={i} fill="#dc2626" />
                    ))}
                  </Bar>
                  <Bar dataKey="min" name="H_min" radius={[3, 3, 0, 0]}>
                    {result.envelope.map((pt, i) => (
                      <Cell
                        key={i}
                        fill={
                          pt.min_head_m < result.vapor_pressure_head_m
                            ? "#dc2626"
                            : pt.min_head_m < 0
                              ? "#f59e0b"
                              : "#2563eb"
                        }
                      />
                    ))}
                  </Bar>
                  <ReferenceLine
                    y={result.vapor_pressure_head_m * displayFactor}
                    stroke={result.min_pressure_head_m < result.vapor_pressure_head_m ? "#dc2626" : "#f59e0b"}
                    strokeDasharray="5 3"
                    label={{
                      value: `h_vap = ${fmtH(result.vapor_pressure_head_m, us)}`,
                      fontSize: 9,
                      fill: result.min_pressure_head_m < result.vapor_pressure_head_m ? "#dc2626" : "#d97706",
                      position: "insideTopLeft",
                    }}
                  />
                  <ReferenceLine
                    y={0}
                    stroke={result.min_pressure_head_m < 0 ? "#dc2626" : "#94a3b8"}
                    strokeDasharray="2 2"
                    label={{
                      value: us ? "0 ft (atm)" : "0 m (atm)",
                      fontSize: 9,
                      fill: result.min_pressure_head_m < 0 ? "#dc2626" : "#94a3b8",
                      position: "insideBottomRight",
                    }}
                  />
                  {result.rating_check && (
                    <ReferenceLine
                      y={result.rating_check.pressure_rating_kPa / (result.rho_kg_m3 * 9.81 / 1000) * displayFactor}
                      stroke="#16a34a"
                      strokeDasharray="5 3"
                      label={{
                        value: `PN = ${(result.rating_check.pressure_rating_kPa / 10).toFixed(0)} bar`,
                        fontSize: 9,
                        fill: "#16a34a",
                        position: "insideTopRight",
                      }}
                    />
                  )}
                </BarChart>
              </ResponsiveContainer>
            </ChartErrorBoundary>
          </Section>

          {ratingCheckToShow && (
            <Section title="Pressure Rating Check">
              <RatingCheckPanel rc={ratingCheckToShow} us={us} />
            </Section>
          )}

          <Section title="Key Equations">
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-[11px] font-mono text-slate-700 space-y-2">
              <p>
                ΔH_Joukowsky = a·ΔV/g = {result.wave_speed_ms.toFixed(0)}·{result.delta_V_ms.toFixed(4)}/{G}
                {" = "}<strong className="text-slate-900">{fmtH(result.delta_H_joukowsky_m, us)}</strong>
                {us && <span className="text-slate-400"> ({result.delta_H_joukowsky_m.toFixed(4)} m)</span>}
              </p>
              <p>
                ΔP_Joukowsky = ρ·a·ΔV = {result.rho_kg_m3}·{result.wave_speed_ms.toFixed(0)}·{result.delta_V_ms.toFixed(4)}/1000
                {" = "}<strong className="text-slate-900">{fmtP(result.delta_P_joukowsky_kPa, us)}</strong>
                {us && <span className="text-slate-400"> ({result.delta_P_joukowsky_kPa.toFixed(3)} kPa)</span>}
              </p>
              <p>
                T (char.) = 2L/a = 2×{result.pipe_length_m.toFixed(1)}/{result.wave_speed_ms.toFixed(0)}
                {" = "}<strong className="text-slate-900">{result.T_char_s.toFixed(4)} s</strong>
              </p>
              <p>
                h_vap ({result.temperature_C} °C)
                {" = "}<strong className="text-slate-900">{fmtH(result.vapor_pressure_head_m, us)}</strong> gauge
              </p>
              <p>
                V₀ = <strong className="text-slate-900">{fmtV(result.delta_V_ms, us)}</strong>
                {"  "}H₀ = <strong className="text-slate-900">{fmtH(result.H_operating_m, us)}</strong>
              </p>
            </div>
          </Section>

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

// ---------------------------------------------------------------------------
// Tab button helper
// ---------------------------------------------------------------------------

function TabBtn({
  active, onClick, children, accent = "blue",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accent?: "blue" | "cyan" | "violet" | "indigo";
}) {
  const activeColors = {
    blue:   "bg-blue-600 text-white",
    cyan:   "bg-cyan-600 text-white",
    violet: "bg-violet-600 text-white",
    indigo: "bg-indigo-600 text-white",
  };
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
        active
          ? activeColors[accent]
          : "bg-white text-slate-500 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export default function StepWaterHammer() {
  const [activePipeline, setActivePipeline] = useState<"suction" | "discharge">("discharge");
  const [activeSub,      setActiveSub]      = useState<"quick" | "moc">("quick");

  return (
    <div className="space-y-6">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">
          Surge / Water Hammer Analysis
        </h2>
        <p className="text-xs text-slate-500 max-w-2xl leading-relaxed">
          Separate surge analyses for the suction and discharge pipelines.
          Quick (Mode A) uses Joukowsky theory; MOC runs a full 1-D Method-of-Characteristics simulation.
          The suction MOC tab also computes the NPSHa transient at the pump inlet.
        </p>
      </div>

      {/* ── Top-level pipeline tabs ───────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        {/* Pipeline row */}
        <div className="flex border-b border-slate-200 bg-slate-50">
          <TabBtn
            active={activePipeline === "discharge"}
            onClick={() => { setActivePipeline("discharge"); setActiveSub("quick"); }}
            accent="blue"
          >
            ⬇ Discharge Surge
          </TabBtn>
          <TabBtn
            active={activePipeline === "suction"}
            onClick={() => { setActivePipeline("suction"); setActiveSub("quick"); }}
            accent="cyan"
          >
            ⬆ Suction Surge + NPSHa
          </TabBtn>
        </div>

        {/* Sub-tab row */}
        <div className="flex border-b border-slate-200 bg-white">
          <TabBtn
            active={activeSub === "quick"}
            onClick={() => setActiveSub("quick")}
            accent={activePipeline === "suction" ? "cyan" : "blue"}
          >
            Quick Analysis (Mode A)
          </TabBtn>
          <TabBtn
            active={activeSub === "moc"}
            onClick={() => setActiveSub("moc")}
            accent={activePipeline === "suction" ? "violet" : "indigo"}
          >
            {activePipeline === "suction"
              ? "MOC + NPSHa Transient"
              : "MOC Simulation (Mode B)"}
          </TabBtn>
        </div>

        {/* Tab content */}
        <div className="p-5">
          {activePipeline === "discharge" && activeSub === "quick" && (
            <ChartErrorBoundary label="Discharge Quick Surge">
              <QuickAnalysisPanel activePipeline="discharge" />
            </ChartErrorBoundary>
          )}
          {activePipeline === "discharge" && activeSub === "moc" && (
            <ChartErrorBoundary label="Discharge MOC">
              <StepWaterHammerModeB />
            </ChartErrorBoundary>
          )}
          {activePipeline === "suction" && activeSub === "quick" && (
            <ChartErrorBoundary label="Suction Quick Surge">
              <QuickAnalysisPanel activePipeline="suction" />
            </ChartErrorBoundary>
          )}
          {activePipeline === "suction" && activeSub === "moc" && (
            <ChartErrorBoundary label="Suction MOC">
              <StepSuctionSurgeMOC />
            </ChartErrorBoundary>
          )}
        </div>
      </div>

      {/* ── Summary panel (always visible once any result exists) ─────────── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
          Combined Surge Risk Assessment
        </p>
        <SurgeSummaryPanel />
      </div>

    </div>
  );
}
