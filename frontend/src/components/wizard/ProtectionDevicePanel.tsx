import { useState } from "react";
import { computeWhatIf } from "../../utils/api";
import type {
  WhatIfRequest,
  WhatIfResponse,
  MOCSegmentInput,
  MOCBoundaryAInput,
  MOCBoundaryBInput,
  ProtectionDeviceInput,
} from "../../utils/api";

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-[10px] font-semibold text-slate-600 mb-1">{children}</label>;
}
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-[9px] text-slate-400 leading-tight">{children}</p>;
}
function Inp({ value, onChange, type = "number", placeholder, step, min }: {
  value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; step?: number; min?: number;
}) {
  return (
    <input
      type={type} value={value} placeholder={placeholder}
      step={step} min={min}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded border border-slate-200 px-2 py-1.5 text-[10px] font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
    />
  );
}
function SideToggle({ value, onChange }: { value: "A" | "B"; onChange: (v: "A" | "B") => void }) {
  return (
    <div className="flex gap-1 mt-1">
      {(["A", "B"] as const).map(s => (
        <button key={s} onClick={() => onChange(s)}
          className={`flex-1 text-[9px] font-bold rounded py-1 border transition-colors ${
            value === s
              ? "bg-blue-600 text-white border-blue-600"
              : "bg-white text-slate-500 border-slate-200 hover:border-blue-400"
          }`}>
          Side {s}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Device card wrapper
// ---------------------------------------------------------------------------

function DeviceCard({
  title, icon, color, enabled, onToggle, children,
}: {
  title: string; icon: string; color: string;
  enabled: boolean; onToggle: () => void;
  children: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    blue:   "border-blue-200 bg-blue-50/40",
    teal:   "border-teal-200 bg-teal-50/40",
    amber:  "border-amber-200 bg-amber-50/40",
    green:  "border-emerald-200 bg-emerald-50/40",
    violet: "border-violet-200 bg-violet-50/40",
  };
  return (
    <div className={`rounded-xl border p-3 space-y-2 transition-opacity ${colors[color]} ${enabled ? "" : "opacity-50"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-base">{icon}</span>
          <p className="text-[10px] font-bold text-slate-700">{title}</p>
        </div>
        <button
          onClick={onToggle}
          className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
            enabled ? "bg-blue-600" : "bg-slate-300"
          }`}
        >
          <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
            enabled ? "translate-x-3.5" : "translate-x-0.5"
          }`} />
        </button>
      </div>
      {enabled && <div className="space-y-2">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ProtectionDevicePanelProps {
  wave_speed_ms: number;
  Q_0_m3s: number;
  H_0_m: number;
  rho_kg_m3?: number;
  temperature_C?: number;
  pressure_rating_kPa?: number | null;
  segments: MOCSegmentInput[];
  boundary_A: MOCBoundaryAInput;
  boundary_B: MOCBoundaryBInput;
  n_reaches?: number | null;
  t_total_s?: number | null;
  pipeline?: string;
  unit_system?: string;
  onResult: (result: WhatIfResponse) => void;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ProtectionDevicePanel({
  wave_speed_ms, Q_0_m3s, H_0_m,
  rho_kg_m3 = 1000, temperature_C = 20,
  pressure_rating_kPa = null,
  segments, boundary_A, boundary_B,
  n_reaches = null, t_total_s = null,
  pipeline = "discharge", unit_system = "SI",
  onResult,
}: ProtectionDevicePanelProps) {

  // ── Air Vessel ─────────────────────────────────────────────────────────
  const [avEn,   setAvEn]   = useState(false);
  const [avSide, setAvSide] = useState<"A" | "B">("A");
  const [avVtot, setAvVtot] = useState("2.0");
  const [avFrac, setAvFrac] = useState("0.5");
  const [avP0,   setAvP0]   = useState(String(Math.round(H_0_m * 9.81)));
  const [avN,    setAvN]    = useState("1.4");

  // ── Surge Tank ─────────────────────────────────────────────────────────
  const [stEn,    setStEn]    = useState(false);
  const [stSide,  setStSide]  = useState<"A" | "B">("B");
  const [stArea,  setStArea]  = useState("2.0");
  const [stZ0,    setStZ0]    = useState(String(Math.round(H_0_m)));
  const [stZmax,  setStZmax]  = useState(String(Math.round(H_0_m * 1.5)));

  // ── PRV ────────────────────────────────────────────────────────────────
  const [prvEn,   setPrvEn]   = useState(false);
  const [prvSide, setPrvSide] = useState<"A" | "B">("A");
  const [prvH,    setPrvH]    = useState(String(Math.round(H_0_m * 1.3)));
  const [prvQ,    setPrvQ]    = useState("");

  // ── Vacuum Relief ──────────────────────────────────────────────────────
  const [vrEn,   setVrEn]   = useState(false);
  const [vrSide, setVrSide] = useState<"A" | "B">("A");
  const [vrH,    setVrH]    = useState("0");

  // ── Slow Check Valve ───────────────────────────────────────────────────
  const [scvEn,    setScvEn]    = useState(false);
  const [scvSide,  setScvSide]  = useState<"A" | "B">("B");
  const [scvTime,  setScvTime]  = useState("30");
  const [scvProf,  setScvProf]  = useState<"linear" | "equal_percentage">("linear");

  // ── Compute state ───────────────────────────────────────────────────────
  const [computing, setComputing] = useState(false);
  const [error, setError]         = useState<string | null>(null);

  const enabledCount = [avEn, stEn, prvEn, vrEn, scvEn].filter(Boolean).length;

  async function handleRun() {
    setError(null);
    if (enabledCount === 0) {
      setError("Enable at least one protection device before running.");
      return;
    }
    if (segments.length === 0) {
      setError("No pipeline segments — configure segments first.");
      return;
    }

    const devices: ProtectionDeviceInput[] = [];

    if (avEn) {
      const V = parseFloat(avVtot), f = parseFloat(avFrac), P = parseFloat(avP0);
      if (!isNaN(V) && !isNaN(f) && !isNaN(P) && V > 0 && P > 0) {
        devices.push({ type: "air_vessel", enabled: true, boundary_side: avSide,
          V_total_m3: V, V_gas_frac: f, P0_kPa: P, polytropic_n: parseFloat(avN) || 1.4 });
      }
    }
    if (stEn) {
      const A = parseFloat(stArea), z0 = parseFloat(stZ0), zm = parseFloat(stZmax);
      if (!isNaN(A) && A > 0 && !isNaN(z0) && !isNaN(zm)) {
        devices.push({ type: "surge_tank", enabled: true, boundary_side: stSide,
          A_tank_m2: A, z_initial_m: z0, z_max_m: zm });
      }
    }
    if (prvEn) {
      const H = parseFloat(prvH);
      if (!isNaN(H) && H > 0) {
        const qr = parseFloat(prvQ);
        devices.push({ type: "prv", enabled: true, boundary_side: prvSide, H_set_m: H,
          Q_relief_m3s: isNaN(qr) || qr <= 0 ? undefined : qr });
      }
    }
    if (vrEn) {
      const H = parseFloat(vrH);
      devices.push({ type: "vacuum_relief", enabled: true, boundary_side: vrSide, H_admit_m: isNaN(H) ? 0 : H });
    }
    if (scvEn) {
      const t = parseFloat(scvTime);
      if (!isNaN(t) && t > 0) {
        devices.push({ type: "slow_check_valve", enabled: true, boundary_side: scvSide,
          t_close_s: t, profile: scvProf });
      }
    }

    if (devices.length === 0) {
      setError("Device configuration is incomplete — check required fields.");
      return;
    }

    const req: WhatIfRequest = {
      wave_speed_ms, Q_0_m3s, H_0_m, rho_kg_m3, temperature_C,
      pressure_rating_kPa: pressure_rating_kPa ?? null,
      segments, boundary_A, boundary_B,
      n_reaches: n_reaches ?? null,
      t_total_s: t_total_s ?? null,
      pipeline, unit_system, devices,
    };

    setComputing(true);
    try {
      const res = await computeWhatIf(req);
      onResult(res);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ??
        (e as Error)?.message ??
        "What-if computation failed.";
      setError(msg);
    } finally {
      setComputing(false);
    }
  }

  const inp2 = "w-full rounded border border-slate-200 px-2 py-1.5 text-[10px] font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-400";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-4 py-3 space-y-1">
        <p className="text-xs font-bold text-blue-800">Surge Protection — What-If Comparison</p>
        <p className="text-[10px] text-blue-700 leading-snug">
          Enable one or more devices below, adjust parameters, then run the comparison.
          All results are preliminary screening estimates (±30–50 %) and must be
          verified with full engineering analysis.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">

        {/* Air Vessel */}
        <DeviceCard title="Air Vessel (Hydropneumatic Tank)" icon="🫙" color="blue"
          enabled={avEn} onToggle={() => setAvEn(v => !v)}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Total volume V [m³]</Label>
              <Inp value={avVtot} onChange={setAvVtot} step={0.5} min={0.1} placeholder="e.g. 2.0" />
            </div>
            <div>
              <Label>Gas fraction</Label>
              <Inp value={avFrac} onChange={setAvFrac} step={0.05} min={0.05} placeholder="0.5" />
              <Hint>Initial gas / total volume [0.05–0.95]</Hint>
            </div>
            <div>
              <Label>Pre-charge P₀ [kPa]</Label>
              <Inp value={avP0} onChange={setAvP0} step={10} min={1} placeholder="e.g. 400" />
              <Hint>Gauge pressure at initial gas volume</Hint>
            </div>
            <div>
              <Label>Polytropic n</Label>
              <Inp value={avN} onChange={setAvN} step={0.1} min={1} placeholder="1.4" />
              <Hint>1.0 = isothermal · 1.4 = adiabatic</Hint>
            </div>
          </div>
          <div>
            <Label>Connect to boundary</Label>
            <SideToggle value={avSide} onChange={setAvSide} />
            <Hint>A = upstream end · B = downstream end</Hint>
          </div>
        </DeviceCard>

        {/* Surge Tank */}
        <DeviceCard title="Surge Tank (Open Standpipe)" icon="🏗️" color="teal"
          enabled={stEn} onToggle={() => setStEn(v => !v)}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Tank area A [m²]</Label>
              <Inp value={stArea} onChange={setStArea} step={0.5} min={0.1} placeholder="e.g. 2.0" />
            </div>
            <div>
              <Label>Initial level z₀ [m]</Label>
              <Inp value={stZ0} onChange={setStZ0} step={1} placeholder={String(Math.round(H_0_m))} />
              <Hint>HGL at connection point</Hint>
            </div>
            <div className="col-span-2">
              <Label>Max level z_max [m]</Label>
              <Inp value={stZmax} onChange={setStZmax} step={1} placeholder="overflow elevation" />
            </div>
          </div>
          <div>
            <Label>Connect to boundary</Label>
            <SideToggle value={stSide} onChange={setStSide} />
          </div>
        </DeviceCard>

        {/* PRV */}
        <DeviceCard title="Pressure Relief Valve (PRV)" icon="🔧" color="amber"
          enabled={prvEn} onToggle={() => setPrvEn(v => !v)}>
          <div>
            <Label>Set-point head H_set [m]</Label>
            <Inp value={prvH} onChange={setPrvH} step={1} min={1} placeholder={String(Math.round(H_0_m * 1.3))} />
            <Hint>When H exceeds this at the selected boundary the PRV opens — MOC re-runs with clamped head</Hint>
          </div>
          <div>
            <Label>Relief flow Q_relief [m³/s] <span className="font-normal text-slate-400">(sizing only)</span></Label>
            <Inp value={prvQ} onChange={setPrvQ} step={0.001} min={0} placeholder={`auto (${Q_0_m3s.toFixed(4)})`} />
          </div>
          <div>
            <Label>Connect to boundary</Label>
            <SideToggle value={prvSide} onChange={setPrvSide} />
            <Hint>A = upstream/pump · B = downstream/reservoir</Hint>
          </div>
          <p className="text-[9px] text-amber-700 bg-amber-100 rounded px-2 py-1 leading-snug">
            Dynamic MOC simulation: boundary head clamped at H_set when valve opens — full MOC re-run per scenario.
          </p>
        </DeviceCard>

        {/* Vacuum Relief */}
        <DeviceCard title="Vacuum Relief (Air-Inlet) Valve" icon="💨" color="green"
          enabled={vrEn} onToggle={() => setVrEn(v => !v)}>
          <div>
            <Label>Admission head H_admit [m]</Label>
            <Inp value={vrH} onChange={setVrH} step={0.5} placeholder="0.0" />
            <Hint>0 m gauge = atmospheric — valve opens when head drops below this value</Hint>
          </div>
          <div>
            <Label>Connect to boundary</Label>
            <SideToggle value={vrSide} onChange={setVrSide} />
            <Hint>A = upstream/pump · B = downstream/reservoir</Hint>
          </div>
          <p className="text-[9px] text-emerald-700 bg-emerald-100 rounded px-2 py-1 leading-snug">
            Dynamic MOC simulation: boundary head clamped at H_admit when valve opens — full MOC re-run per scenario.
          </p>
        </DeviceCard>

        {/* Slow Check Valve */}
        <DeviceCard title="Slow-Closing Check Valve" icon="🚰" color="violet"
          enabled={scvEn} onToggle={() => setScvEn(v => !v)}>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Closure time t_close [s]</Label>
              <Inp value={scvTime} onChange={setScvTime} step={5} min={1} placeholder="e.g. 30" />
              <Hint>Longer → less Joukowsky surge</Hint>
            </div>
            <div>
              <Label>Profile</Label>
              <select value={scvProf} onChange={e => setScvProf(e.target.value as "linear" | "equal_percentage")}
                className={inp2}>
                <option value="linear">Linear (Q∝τ²)</option>
                <option value="equal_percentage">Equal-pct (Q∝τ⁴)</option>
              </select>
            </div>
          </div>
          <div>
            <Label>Valve at boundary</Label>
            <SideToggle value={scvSide} onChange={setScvSide} />
            <Hint>Must match the boundary with the valve_closure BC</Hint>
          </div>
        </DeviceCard>

      </div>

      {/* Run button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleRun}
          disabled={computing || enabledCount === 0}
          className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow hover:bg-blue-700 disabled:opacity-40 transition-colors"
        >
          {computing
            ? "Computing…"
            : `Run What-If Comparison (${enabledCount} device${enabledCount !== 1 ? "s" : ""})`}
        </button>
        {enabledCount === 0 && (
          <p className="text-[10px] text-slate-400">Enable at least one device above</p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
