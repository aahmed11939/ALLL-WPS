import { useState } from "react";
import { useProject } from "../../contexts/ProjectContext";

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

export default function StepExports() {
  const { draft } = useProject();
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (label: string) => {
    setToast(label);
    setTimeout(() => setToast(null), 4000);
  };

  const handleDownloadJson = () => {
    const toExport = {
      ...draft,
      hydraulicsResult: null,
      hydraulicsError:  null,
      pumpResult:       null,
    };
    const blob = new Blob([JSON.stringify(toExport, null, 2)], { type: "application/json" });
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

          {/* Excel — placeholder */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 opacity-70">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-700">Calculation Report (.xlsx)</p>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase">
                  Coming soon
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Full hydraulic report with equations, curves, and pump schedule.
              </p>
            </div>
            <button
              type="button"
              onClick={() => showToast("Excel export is in progress")}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Export Excel
            </button>
          </div>

          {/* Word — placeholder */}
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 opacity-70">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-slate-700">Engineering Memo (.docx)</p>
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 uppercase">
                  Coming soon
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Stamped design memorandum with all calculated parameters.
              </p>
            </div>
            <button
              type="button"
              onClick={() => showToast("Word/PDF export is in progress")}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Export Word
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
