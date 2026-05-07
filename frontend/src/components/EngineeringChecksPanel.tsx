import type { CheckResult, CheckSeverity } from "../utils/engineeringChecks";

// ---------------------------------------------------------------------------
// Severity styling config
// ---------------------------------------------------------------------------

const SEV_CONFIG: Record<
  CheckSeverity,
  { bar: string; badge: string; icon: string; bg: string; border: string }
> = {
  critical: {
    bar:    "bg-rose-500",
    badge:  "bg-rose-100 text-rose-700",
    icon:   "text-rose-500",
    bg:     "bg-rose-50",
    border: "border-rose-200",
  },
  warning: {
    bar:    "bg-amber-400",
    badge:  "bg-amber-100 text-amber-700",
    icon:   "text-amber-500",
    bg:     "bg-amber-50",
    border: "border-amber-200",
  },
  info: {
    bar:    "bg-teal-400",
    badge:  "bg-teal-100 text-teal-700",
    icon:   "text-teal-500",
    bg:     "bg-white",
    border: "border-slate-200",
  },
};

// ---------------------------------------------------------------------------
// Severity icon (inline SVG)
// ---------------------------------------------------------------------------

function SeverityIcon({ severity, className }: { severity: CheckSeverity; className?: string }) {
  if (severity === "critical") {
    return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    );
  }
  if (severity === "warning") {
    return (
      <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Individual check card
// ---------------------------------------------------------------------------

function CheckCard({ check }: { check: CheckResult }) {
  const cfg = SEV_CONFIG[check.severity];

  return (
    <div className={`relative flex gap-0 rounded-xl border ${cfg.border} ${cfg.bg} overflow-hidden shadow-sm`}>
      {/* Left colour bar */}
      <div className={`w-1 shrink-0 ${cfg.bar}`} />

      <div className="flex-1 p-4 space-y-2 min-w-0">
        {/* Header row */}
        <div className="flex items-start gap-2 flex-wrap">
          <SeverityIcon severity={check.severity} className={`h-4 w-4 shrink-0 mt-0.5 ${cfg.icon}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cfg.badge}`}>
                {check.severity}
              </span>
              <span className="text-[10px] text-slate-400 font-mono">{check.category}</span>
              {check.metric && (
                <span className="text-[10px] font-mono text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">
                  {check.metric}
                </span>
              )}
              {check.skipped && (
                <span className="text-[10px] font-mono text-slate-400 italic">awaiting data</span>
              )}
            </div>
            <p className="text-sm font-semibold text-slate-800 mt-1 leading-snug">{check.title}</p>
          </div>
        </div>

        {/* Body — only shown when not a placeholder skip */}
        {!check.skipped && (
          <>
            <p className="text-xs text-slate-600 leading-relaxed">{check.message}</p>
            <div className="flex gap-1.5 items-start">
              <span className="shrink-0 text-xs text-teal-600 font-bold mt-0.5">→</span>
              <p className="text-xs text-teal-800 leading-relaxed">{check.recommendation}</p>
            </div>
          </>
        )}

        {check.skipped && (
          <p className="text-xs text-slate-400 italic leading-relaxed">{check.message}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

interface Props {
  checks: CheckResult[];
}

export default function EngineeringChecksPanel({ checks }: Props) {
  const criticals = checks.filter((c) => c.severity === "critical" && !c.skipped);
  const warnings  = checks.filter((c) => c.severity === "warning"  && !c.skipped);
  const infos     = checks.filter((c) => c.severity === "info"     && !c.skipped);
  const skipped   = checks.filter((c) => c.skipped);

  const allClear = criticals.length === 0 && warnings.length === 0;

  return (
    <div className="space-y-5">

      {/* Summary KPI bar */}
      <div className="grid grid-cols-3 gap-3">
        <div className={`rounded-xl border p-3 text-center ${
          criticals.length > 0
            ? "border-rose-300 bg-rose-50"
            : "border-slate-200 bg-white"
        }`}>
          <p className="text-2xl font-bold font-mono text-rose-600">{criticals.length}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mt-0.5">Critical</p>
        </div>
        <div className={`rounded-xl border p-3 text-center ${
          warnings.length > 0
            ? "border-amber-300 bg-amber-50"
            : "border-slate-200 bg-white"
        }`}>
          <p className="text-2xl font-bold font-mono text-amber-600">{warnings.length}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mt-0.5">Warning</p>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3 text-center">
          <p className="text-2xl font-bold font-mono text-teal-700">{infos.length}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mt-0.5">Pass / Info</p>
        </div>
      </div>

      {/* All-clear banner */}
      {allClear && (
        <div className="flex items-center gap-3 rounded-xl border border-teal-300 bg-teal-50 px-4 py-3">
          <svg className="h-5 w-5 text-teal-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
              d="M9 12l2 2 4-4M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-teal-800">No critical issues or warnings found</p>
            <p className="text-xs text-teal-600 mt-0.5">
              All checks either passed or are awaiting computed results. Complete Steps 5–7 computations to unlock all checks.
            </p>
          </div>
        </div>
      )}

      {/* Critical items */}
      {criticals.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-600">
            Critical — immediate action required
          </p>
          {criticals.map((c) => <CheckCard key={c.id} check={c} />)}
        </div>
      )}

      {/* Warning items */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
            Warnings — review recommended
          </p>
          {warnings.map((c) => <CheckCard key={c.id} check={c} />)}
        </div>
      )}

      {/* Info / passing items */}
      {infos.length > 0 && (
        <details className="group" open={criticals.length === 0 && warnings.length === 0}>
          <summary className="cursor-pointer list-none flex items-center gap-2 py-1 select-none">
            <svg className="h-3.5 w-3.5 text-slate-400 group-open:rotate-90 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Passing checks ({infos.length})
            </p>
          </summary>
          <div className="mt-2 space-y-2">
            {infos.map((c) => <CheckCard key={c.id} check={c} />)}
          </div>
        </details>
      )}

      {/* Skipped / awaiting data items */}
      {skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer list-none flex items-center gap-2 py-1 select-none">
            <svg className="h-3.5 w-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Awaiting data ({skipped.length})
            </p>
          </summary>
          <div className="mt-2 space-y-2">
            {skipped.map((c) => <CheckCard key={c.id} check={c} />)}
          </div>
        </details>
      )}

    </div>
  );
}
