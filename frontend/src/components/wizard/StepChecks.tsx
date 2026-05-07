import { useProject } from "../../contexts/ProjectContext";
import { runChecks } from "../../utils/engineeringChecks";
import EngineeringChecksPanel from "../EngineeringChecksPanel";

export default function StepChecks() {
  const { draft } = useProject();
  const checks = runChecks(draft);

  const criticals = checks.filter((c) => c.severity === "critical" && !c.skipped).length;
  const warnings  = checks.filter((c) => c.severity === "warning"  && !c.skipped).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-800 mb-1">Engineering Checks</h2>
          <p className="text-xs text-slate-500 max-w-xl">
            Automated code-compliance and best-practice review based on AWWA M11, AWWA M32, HI 9.6.3,
            and common potable-water engineering standards. Checks are derived from the current design
            inputs and computed results — no additional calculation required.
          </p>
        </div>
        {(criticals > 0 || warnings > 0) && (
          <div className="shrink-0 flex gap-2">
            {criticals > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-700">
                {criticals} Critical
              </span>
            )}
            {warnings > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-700">
                {warnings} Warning{warnings > 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Reference standards bar */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500">
        <span>AWWA M11 — Pipe velocity</span>
        <span>AWWA M32 — Wet well cycling</span>
        <span>HI 9.6.3 — NPSH margin &amp; duty point</span>
        <span>Ten States Standards — Redundancy</span>
      </div>

      <EngineeringChecksPanel checks={checks} />
    </div>
  );
}
