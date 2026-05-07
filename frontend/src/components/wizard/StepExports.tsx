import { useProject } from "../../contexts/ProjectContext";

export default function StepExports() {
  const { draft } = useProject();

  const handleDownload = () => {
    const toExport = {
      ...draft,
      hydraulicsResult: null,
      hydraulicsError:  null,
      pumpResult:       null,
    };
    const blob = new Blob([JSON.stringify(toExport, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (draft.meta.name || "project")
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 40);
    a.href = url;
    a.download = `${safeName}.wps.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const r = draft.hydraulicsResult;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Summary &amp; Export</h2>
        <p className="text-xs text-slate-500">
          Review the project summary and download the project file for archiving or sharing.
        </p>
      </div>

      {/* Project summary card */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 mb-3">
          Project Summary
        </p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <SummaryRow label="Project" value={draft.meta.name} />
          <SummaryRow label="Client" value={draft.meta.client || "—"} />
          <SummaryRow label="Job No." value={draft.meta.job_number || "—"} />
          <SummaryRow label="Date" value={draft.meta.date || "—"} />
          <SummaryRow label="Engineer" value={draft.meta.engineer || "—"} />
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
      {r && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-3">
            Hydraulic Compute Results
          </p>
          <div className="grid grid-cols-3 gap-4">
            <ResultMetric label="TDH" value={`${r.tdh_m.toFixed(2)} m`} highlight />
            <ResultMetric label="Friction head" value={`${r.friction_head_m.toFixed(2)} m`} />
            <ResultMetric label="Minor head" value={`${r.minor_head_m.toFixed(2)} m`} />
            <ResultMetric label="Velocity" value={`${r.velocity_ms.toFixed(3)} m/s`} />
            <ResultMetric label="Reynolds No." value={Math.round(r.reynolds_number).toLocaleString()} />
            <ResultMetric label="Friction f" value={r.friction_factor.toFixed(5)} />
          </div>
        </div>
      )}

      {!r && (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-400">
          No hydraulic results yet — run the compute on Step 8 first.
        </div>
      )}

      {/* Download */}
      <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <div>
          <p className="text-sm font-semibold text-slate-700">Download Project File</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Saves all inputs (except computed results) as a .wps.json file.
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownload}
          className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-600 transition-colors"
        >
          Download .wps.json
        </button>
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
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
        {title}
      </p>
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
