import { useState } from "react";
import CalculationForm from "../components/CalculationForm";
import ClearWellStep from "../components/ClearWellStep";
import LossBreakdownPanel from "../components/LossBreakdownPanel";
import PumpCurveStep from "../components/PumpCurveStep";
import PumpSelectionStep from "../components/PumpSelectionStep";
import ResultsPanel from "../components/ResultsPanel";
import SystemCurveChart from "../components/SystemCurveChart";
import { useUnitSystem } from "../contexts/UnitSystemContext";
import {
  calculate,
  computeLossBreakdown,
  type AccessoryItem,
  type CalculationRequest,
  type CalculationResponse,
  type CurvePoint,
  type LossBreakdownResponse,
} from "../utils/api";

export default function DesignPage() {
  const [results, setResults] = useState<CalculationResponse | null>(null);
  const [breakdown, setBreakdown] = useState<LossBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { unitSystem, setUnitSystem, showBoth, setShowBoth } = useUnitSystem();

  const handleSubmit = async (
    req: CalculationRequest,
    pickedItems: AccessoryItem[],
    _kSum: number
  ) => {
    setLoading(true);
    setError(null);
    try {
      const data = await calculate({ ...req, unit_system: unitSystem });
      setResults(data);

      if (pickedItems.length > 0) {
        const bd = await computeLossBreakdown({
          Q_m3h: req.Q_m3h,
          D_mm: req.pipe_diameter_mm,
          accessories: pickedItems,
          unit_system: unitSystem,
        });
        setBreakdown(bd);
      } else {
        setBreakdown(null);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Unexpected error — check console for details.";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
      setResults(null);
      setBreakdown(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center gap-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-white font-bold text-sm">
            WPS
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 leading-tight tracking-tight">
              ALLL WPS Designer
            </h1>
            <p className="text-xs text-slate-500 font-mono">
              Municipal Drinking-Water Pump Station Design Tool · v0.1
            </p>
          </div>

          {/* Unit system toggle */}
          <div className="ml-auto flex items-center gap-3">
            {/* Show-both toggle (only relevant when US is active) */}
            {unitSystem === "US" && (
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showBoth}
                  onChange={(e) => setShowBoth(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                <span className="text-xs text-slate-500 font-mono">show SI too</span>
              </label>
            )}

            {/* SI / US toggle */}
            <div className="flex rounded overflow-hidden border border-slate-300 text-xs font-semibold">
              <button
                onClick={() => setUnitSystem("SI")}
                className={`px-3 py-1.5 transition-colors ${
                  unitSystem === "SI"
                    ? "bg-teal-700 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                SI
              </button>
              <button
                onClick={() => setUnitSystem("US")}
                className={`px-3 py-1.5 border-l border-slate-300 transition-colors ${
                  unitSystem === "US"
                    ? "bg-teal-700 text-white"
                    : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                US
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5">
                Darcy-Weisbach
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5">
                Colebrook-White
              </span>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5">
                AWWA M11
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">

          {/* LEFT: Input form */}
          <div>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-5">
                Design Inputs
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-400 normal-case tracking-normal">
                  {unitSystem === "SI" ? "SI (m, m³/h)" : "US Customary (ft, gpm)"}
                </span>
              </h2>
              <CalculationForm onSubmit={handleSubmit} loading={loading} />
            </div>

            {/* Design standards note */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 leading-relaxed">
              <strong className="text-slate-600">Method:</strong> Darcy-Weisbach friction loss with
              Colebrook-White iterative friction factor (convergence 10⁻⁹). Minor losses via ΣK·V²/2g.
              Kinematic viscosity ν = 1.004×10⁻⁶ m²/s (20 °C). All inputs converted to SI before calculation.
            </div>
          </div>

          {/* RIGHT: Results */}
          <div className="space-y-6">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
                Hydraulic Results
              </h2>
              <ResultsPanel results={results} loading={loading} error={error} />
            </div>

            {results && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
                  System Curve
                </h2>
                <SystemCurveChart results={results} />
              </div>
            )}

            {/* Minor Loss Breakdown */}
            {breakdown && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-3">
                  Minor Loss Breakdown
                </h2>
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
                  <LossBreakdownPanel data={breakdown} />
                </div>
              </div>
            )}

            {/* Pump Type Selection */}
            <div>
              <PumpSelectionStep />
            </div>

            {/* Pump Curves & Operating Point */}
            <div>
              <PumpCurveStep
                systemCurve={
                  results?.system_curve
                    ? (results.system_curve as { Q_m3h: number; H_m: number }[]).map(
                        (pt) => ({ Q_m3h: pt.Q_m3h, value: pt.H_m } as CurvePoint)
                      )
                    : undefined
                }
                staticHeadM={results?.static_head_m ?? undefined}
              />
            </div>

            {/* Clear Well Sizing */}
            <div>
              <ClearWellStep />
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 mt-12 py-4 text-center text-xs text-slate-400 font-mono">
        ALLL WPS Designer · Hydraulic calculations per AWWA M11 / Hydraulic Institute Standards ·
        Not for use as the sole basis for construction design without independent engineering review.
      </footer>
    </div>
  );
}
