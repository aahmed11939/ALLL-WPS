import type { CalculationResponse, UnitValue } from "../utils/api";
import { useUnitSystem } from "../contexts/UnitSystemContext";

interface Props {
  results: CalculationResponse | null;
  loading: boolean;
  error: string | null;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 animate-pulse">
      <div className="h-3 w-20 bg-slate-200 rounded mb-2" />
      <div className="h-7 w-28 bg-slate-100 rounded" />
    </div>
  );
}

interface MetricCardProps {
  label: string;
  primary: UnitValue;
  highlight?: boolean;
  note?: string;
  showBoth?: boolean;
}

function MetricCard({ label, primary, highlight, note, showBoth }: MetricCardProps) {
  const hasSiAlt = showBoth && primary.unit !== primary.unit;
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight
          ? "border-teal-400 bg-teal-50 shadow-sm"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </p>
      <p
        className={`font-mono text-2xl font-bold ${
          highlight ? "text-teal-800" : "text-slate-800"
        }`}
      >
        {primary.display_value.toFixed(3)}
        <span className="ml-1.5 text-sm font-normal text-slate-500">{primary.unit}</span>
      </p>
      {showBoth && Math.abs(primary.si_value - primary.display_value) > 1e-9 && (
        <p className="mt-0.5 text-xs font-mono text-slate-400">
          = {primary.si_value.toFixed(3)} {
            primary.unit === "ft"  ? "m" :
            primary.unit === "gpm" ? "m³/h" :
            primary.unit === "fps" ? "m/s" :
            primary.unit === "psi" ? "kPa" :
            primary.unit === "hp"  ? "kW" :
            primary.unit === "in"  ? "mm" : "SI"
          }
        </p>
      )}
      {note && <p className="mt-1 text-xs text-slate-400">{note}</p>}
    </div>
  );
}

export default function ResultsPanel({ results, loading, error }: Props) {
  const { showBoth } = useUnitSystem();

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <strong>Calculation error:</strong> {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-slate-300 text-sm text-slate-400">
        Submit the form to see hydraulic results
      </div>
    );
  }

  const d = results.display;
  const isUS = results.unit_system === "US";

  const headLossBudget =
    results.friction_head_m + results.minor_head_m > 0
      ? (
          (results.friction_head_m /
            (results.friction_head_m + results.minor_head_m)) *
          100
        ).toFixed(1)
      : "—";

  return (
    <div className="space-y-4">
      {/* Primary results grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="TDH (Total Dynamic Head)"
          primary={d.tdh}
          highlight
          showBoth={showBoth}
        />
        <MetricCard
          label="Static Head"
          primary={d.static_head}
          showBoth={showBoth}
        />
        <MetricCard
          label="Friction Head Loss"
          primary={d.friction_head}
          note={`${headLossBudget}% of dynamic losses`}
          showBoth={showBoth}
        />
        <MetricCard
          label="Minor Head Loss"
          primary={d.minor_head}
          showBoth={showBoth}
        />
        <MetricCard
          label="Pipe Velocity"
          primary={d.velocity}
          showBoth={showBoth}
        />
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
            ΣK (fittings)
          </p>
          <p className="font-mono text-2xl font-bold text-slate-800">
            {results.K_sum.toFixed(3)}
            <span className="ml-1.5 text-sm font-normal text-slate-500">—</span>
          </p>
        </div>
      </div>

      {/* Secondary engineering details */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Flow Regime &amp; Friction
        </p>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-400">Reynolds No.</p>
            <p className="font-mono font-semibold text-slate-700">
              {results.reynolds_number.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {results.reynolds_number < 2300
                ? "Laminar"
                : results.reynolds_number < 4000
                ? "Transitional"
                : "Turbulent"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Darcy-Weisbach f</p>
            <p className="font-mono font-semibold text-slate-700">
              {results.friction_factor.toFixed(5)}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">Colebrook-White</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Design Flow</p>
            <p className="font-mono font-semibold text-slate-700">
              {d.design_flow.display_value.toFixed(2)}{" "}
              <span className="text-xs font-normal text-slate-400">{d.design_flow.unit}</span>
            </p>
            {isUS ? (
              <p className="text-xs text-slate-400 mt-0.5">
                {d.design_flow.si_value.toFixed(2)} m³/h
              </p>
            ) : (
              <p className="text-xs text-slate-400 mt-0.5">
                {(results.design_Q_m3h / 3.6).toFixed(3)} L/s
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
