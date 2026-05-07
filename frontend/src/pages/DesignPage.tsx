import { useState } from "react";
import CalculationForm from "../components/CalculationForm";
import ResultsPanel from "../components/ResultsPanel";
import SystemCurveChart from "../components/SystemCurveChart";
import { calculate, type CalculationRequest, type CalculationResponse } from "../utils/api";

export default function DesignPage() {
  const [results, setResults] = useState<CalculationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (req: CalculationRequest) => {
    setLoading(true);
    setError(null);
    try {
      const data = await calculate(req);
      setResults(data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Unexpected error — check console for details.";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
      setResults(null);
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
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-400 font-mono">
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
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">

          {/* LEFT: Input form */}
          <div>
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-6">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-5">
                Design Inputs
              </h2>
              <CalculationForm onSubmit={handleSubmit} loading={loading} />
            </div>

            {/* Design standards note */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 leading-relaxed">
              <strong className="text-slate-600">Method:</strong> Darcy-Weisbach friction loss with
              Colebrook-White iterative friction factor (convergence 10⁻⁹). Minor losses via ΣK·V²/2g.
              Kinematic viscosity ν = 1.004×10⁻⁶ m²/s (20 °C).
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
