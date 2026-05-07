import { useState } from "react";
import { useProject } from "../../contexts/ProjectContext";
import { runChecks, checksToText, type CheckResult } from "../../utils/engineeringChecks";
import { exportExcel, exportWord } from "../../utils/api";

function FeatureToast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 shadow-lg px-4 py-3 max-w-sm animate-in slide-in-from-bottom-2">
      <div className="h-8 w-8 shrink-0 rounded-full bg-amber-100 flex items-center justify-center">
        <svg className="h-4 w-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-800">{message}</p>
        <p className="text-xs text-amber-600 mt-0.5">This feature is in progress — coming in a future update.</p>
      </div>
      <button type="button" onClick={onClose} className="text-amber-400 hover:text-amber-600 text-lg leading-none">
        ×
      </button>
    </div>
  );
}

/** Tiny inline badge for check severity counts in the summary card. */
function SevBadge({ count, label, color }: { count: number; label: string; color: string }) {
  if (count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${color}`}>
      {count} {label}
    </span>
  );
}

/** Compact row for one check result in the export summary. */
function CheckSummaryRow({ check }: { check: CheckResult }) {
  const colors: Record<string, string> = {
    critical: "text-rose-700 bg-rose-50 border-rose-200",
    warning:  "text-amber-700 bg-amber-50 border-amber-200",
    info:     "text-teal-700 bg-teal-50 border-teal-200",
  };
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${colors[check.severity]}`}>
      <span className="text-[10px] font-bold uppercase shrink-0 mt-0.5 w-14">{check.severity}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-snug">{check.title}</p>
        {check.metric && (
          <p className="text-[10px] font-mono text-slate-500 mt-0.5">{check.metric}</p>
        )}
      </div>
    </div>
  );
}

function SuccessToast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 shadow-lg px-4 py-3 max-w-sm animate-in slide-in-from-bottom-2">
      <div className="h-8 w-8 shrink-0 rounded-full bg-emerald-100 flex items-center justify-center">
        <svg className="h-4 w-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-emerald-800">{message}</p>
        <p className="text-xs text-emerald-600 mt-0.5">Your download has started automatically.</p>
      </div>
      <button type="button" onClick={onClose} className="text-emerald-400 hover:text-emerald-600 text-lg leading-none">
        ×
      </button>
    </div>
  );
}

export default function StepExports() {
  const { draft } = useProject();
  const [toast, setToast]             = useState<string | null>(null);
  const [excelLoading, setExcelLoading] = useState(false);
  const [excelError,   setExcelError]   = useState<string | null>(null);
  const [excelSuccess, setExcelSuccess] = useState(false);
  const [wordLoading,  setWordLoading]  = useState(false);
  const [wordError,    setWordError]    = useState<string | null>(null);
  const [wordSuccess,  setWordSuccess]  = useState(false);

  const handleExportWord = async () => {
    setWordError(null);
    setWordSuccess(false);
    setWordLoading(true);
    try {
      const safeName = (draft.meta.name || "project")
        .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      await exportWord(draft, `${safeName}.docx`);
      setWordSuccess(true);
      setTimeout(() => setWordSuccess(false), 4000);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ??
        (e as Error)?.message ??
        "Export failed.";
      setWordError(msg);
    } finally {
      setWordLoading(false);
    }
  };

  const handleExportExcel = async () => {
    setExcelError(null);
    setExcelSuccess(false);
    setExcelLoading(true);
    try {
      const safeName = (draft.meta.name || "project")
        .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      await exportExcel(draft, `${safeName}.xlsx`);
      setExcelSuccess(true);
      setTimeout(() => setExcelSuccess(false), 4000);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { detail?: string } }; message?: string })
          ?.response?.data?.detail ??
        (e as Error)?.message ??
        "Export failed.";
      setExcelError(msg);
    } finally {
      setExcelLoading(false);
    }
  };

  // Derive engineering checks — always fresh, no API call needed
  const checks = runChecks(draft);
  const criticals = checks.filter((c) => c.severity === "critical" && !c.skipped).length;
  const warnings  = checks.filter((c) => c.severity === "warning"  && !c.skipped).length;
  const actionable = checks.filter((c) => !c.skipped && c.severity !== "info");

  const handleDownloadText = () => {
    const text = checksToText(checks);
    const blob = new Blob([text], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const safeName = (draft.meta.name || "project")
      .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    a.href     = url;
    a.download = `${safeName}.checks.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    // Export full project state + derived engineering checks so the file is
    // a complete record of the design session and can be reloaded with results.
    const payload = {
      ...draft,
      engineeringChecks: checks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    const safeName = (draft.meta.name || "project")
      .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    a.href     = url;
    a.download = `${safeName}.wps.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const r = draft.hydraulicsResult;

  return (
    <div className="space-y-6">
      {excelSuccess && (
        <SuccessToast
          message="Excel workbook exported successfully!"
          onClose={() => setExcelSuccess(false)}
        />
      )}
      {wordSuccess && (
        <SuccessToast
          message="Word design report exported successfully!"
          onClose={() => setWordSuccess(false)}
        />
      )}
      {toast && <FeatureToast message={toast} onClose={() => setToast(null)} />}

      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Summary &amp; Export</h2>
        <p className="text-xs text-slate-500">
          Review the project summary and export deliverables for archiving, reporting, or sharing.
        </p>
      </div>

      {/* Project summary card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 mb-3">
          Project Summary
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <SummaryRow label="Project"    value={draft.meta.name || "—"} />
          <SummaryRow label="Client"     value={draft.meta.client || "—"} />
          <SummaryRow label="Job No."    value={draft.meta.job_number || "—"} />
          <SummaryRow label="Date"       value={draft.meta.date || "—"} />
          <SummaryRow label="Engineer"   value={draft.meta.engineer || "—"} />
          <SummaryRow label="Unit system" value={draft.unitSystem} />
          <SummaryRow label="Design flow" value={`${draft.designFlow_m3h.toFixed(2)} m³/h`} />
          <SummaryRow
            label="Static head"
            value={`${(draft.downstreamNode.elevation_m - draft.upstreamNode.elevation_m).toFixed(2)} m`}
          />
        </div>
      </div>

      {/* Pipeline summary */}
      <div className="grid grid-cols-2 gap-4">
        <PipelineSummaryCard
          title="Suction Pipeline"
          segments={draft.suction.segments}
          kSum={draft.suction.accessories_K_sum}
          accessoryCount={draft.suction.accessories.reduce((a, i) => a + i.count, 0)}
        />
        <PipelineSummaryCard
          title="Discharge Pipeline"
          segments={draft.discharge.segments}
          kSum={draft.discharge.accessories_K_sum}
          accessoryCount={draft.discharge.accessories.reduce((a, i) => a + i.count, 0)}
        />
      </div>

      {/* Engineering checks summary */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Engineering Checks Summary
          </p>
          <div className="flex gap-1.5">
            <SevBadge count={criticals} label="Critical" color="bg-rose-100 text-rose-700" />
            <SevBadge count={warnings}  label={warnings === 1 ? "Warning" : "Warnings"} color="bg-amber-100 text-amber-700" />
            {criticals === 0 && warnings === 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-bold text-teal-700">
                All clear
              </span>
            )}
          </div>
        </div>
        <div className="p-4 space-y-2">
          {actionable.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">
              No critical issues or warnings. Visit Step 10 for the full checklist.
            </p>
          ) : (
            actionable.map((c) => <CheckSummaryRow key={c.id} check={c} />)
          )}
          <p className="text-[10px] text-slate-400 pt-1">
            Full detail, standards references, and recommendations are on Step 10 (Engineering Checks).
            Checks are included in the JSON export under <span className="font-mono">engineeringChecks</span>.
          </p>
        </div>
      </div>

      {/* Hydraulic results summary */}
      {r ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-3">
            Hydraulic Compute Results
          </p>
          <div className="grid grid-cols-3 gap-4">
            <ResultMetric label="TDH"          value={`${r.tdh_m.toFixed(2)} m`}            highlight />
            <ResultMetric label="Friction head" value={`${r.friction_head_m.toFixed(2)} m`} />
            <ResultMetric label="Minor head"    value={`${r.minor_head_m.toFixed(2)} m`}    />
            <ResultMetric label="Velocity"      value={`${r.velocity_ms.toFixed(3)} m/s`}   />
            <ResultMetric label="Reynolds No."  value={Math.round(r.reynolds_number).toLocaleString()} />
            <ResultMetric label="Friction f"    value={r.friction_factor.toFixed(5)}         />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-sm text-slate-400">
          No hydraulic results yet — run Compute on Step 7 first.
        </div>
      )}

      {/* Export options */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Export &amp; Download
          </p>
        </div>
        <div className="p-4 space-y-3">

          {/* JSON — functional */}
          <div className="flex items-center justify-between rounded-lg border border-teal-200 bg-teal-50 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-teal-800">Project File (.wps.json)</p>
              <p className="text-xs text-teal-600 mt-0.5">
                All design inputs as JSON — reload in WPS Designer or process programmatically.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="shrink-0 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-600 transition-colors"
            >
              Download JSON
            </button>
          </div>

          {/* Text Report — functional */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">Engineering Checks Report (.txt)</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Plain-text compliance checklist — all check results with standards references and recommended actions.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDownloadText}
              className="shrink-0 rounded-lg bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-600 transition-colors"
            >
              Download Report
            </button>
          </div>

          {/* Excel — live */}
          <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-emerald-800">Calculation Report (.xlsx)</p>
                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 uppercase">
                  Ready
                </span>
              </div>
              <p className="text-xs text-emerald-700 mt-0.5">
                11-sheet workbook — inputs, hydraulics, pump curves, wet well, surge analysis &amp; engineering checks.
              </p>
              {excelError && (
                <p className="text-xs text-red-600 mt-1 font-semibold">⚠ {excelError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={excelLoading}
              className="shrink-0 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {excelLoading ? "Building…" : "Export Excel"}
            </button>
          </div>

          {/* Word — live */}
          <div className="flex items-center justify-between rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-indigo-800">Engineering Report (.docx)</p>
                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 uppercase">
                  Ready
                </span>
              </div>
              <p className="text-xs text-indigo-700 mt-0.5">
                Stamped design memorandum — hydraulics, pump curves, wet well, surge analysis &amp; figures.
              </p>
              {wordError && (
                <p className="text-xs text-red-600 mt-1 font-semibold">⚠ {wordError}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleExportWord}
              disabled={wordLoading}
              className="shrink-0 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {wordLoading ? "Building…" : "Download Word Report"}
            </button>
          </div>

        </div>
      </div>

      {/* Notes */}
      {draft.meta.notes && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Design Notes
          </p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{draft.meta.notes}</p>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-slate-400 shrink-0 w-24">{label}</span>
      <span className="font-medium text-slate-700 truncate">{value}</span>
    </div>
  );
}

function ResultMetric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`font-mono text-sm font-bold ${highlight ? "text-teal-800" : "text-slate-700"}`}>
        {value}
      </p>
    </div>
  );
}

function PipelineSummaryCard({
  title,
  segments,
  kSum,
  accessoryCount,
}: {
  title: string;
  segments: { material: string; diameter_mm: number; length_m: number }[];
  kSum: number;
  accessoryCount: number;
}) {
  const totalLength = segments.reduce((a, s) => a + s.length_m, 0);
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-400">Segments</span>
          <span className="font-mono text-slate-700">{segments.length}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Total length</span>
          <span className="font-mono text-slate-700">{totalLength.toFixed(1)} m</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">Accessories</span>
          <span className="font-mono text-slate-700">{accessoryCount} items</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-400">ΣK</span>
          <span className="font-mono text-slate-700">{kSum.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}
