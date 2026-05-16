import { useProject } from "../../contexts/ProjectContext";
import { useUnitSystem } from "../../contexts/UnitSystemContext";
import type { UnitSystem } from "../../utils/units";
import { GPM_PER_M3H, M3H_PER_GPM } from "../../utils/units";
import FieldTip from "../FieldTip";

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const labelCls =
  "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";

export default function StepMeta() {
  const { draft, dispatch } = useProject();
  const { setUnitSystem, setShowBoth } = useUnitSystem();

  const meta = draft.meta;

  const setMeta = (key: keyof typeof meta, value: string) => {
    dispatch({ type: "SET_META", meta: { ...meta, [key]: value } });
  };

  const handleUnitSystem = (us: UnitSystem) => {
    dispatch({ type: "SET_UNIT_SYSTEM", unitSystem: us });
    setUnitSystem(us);
  };

  const handleShowBoth = (v: boolean) => {
    dispatch({ type: "SET_SHOW_BOTH", showBoth: v });
    setShowBoth(v);
  };

  const isUS = draft.unitSystem === "US";
  const displayFlow = isUS
    ? +(draft.designFlow_m3h * GPM_PER_M3H).toFixed(2)
    : draft.designFlow_m3h;
  const flowUnit = isUS ? "gpm" : "m³/h";

  const handleFlowChange = (raw: string) => {
    const v = parseFloat(raw);
    if (isNaN(v) || v <= 0) return;
    const m3h = isUS ? v * M3H_PER_GPM : v;
    dispatch({ type: "SET_DESIGN_FLOW", flow: +m3h.toFixed(4) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Project Setup</h2>
        <p className="text-xs text-slate-500">
          Enter project metadata and select the unit system that will be used throughout
          the design wizard.
        </p>
      </div>

      {/* Project metadata */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 mb-3">
          Project Information
        </p>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={labelCls}>Project Name *</label>
            <input
              type="text"
              className={inputCls}
              value={meta.name}
              onChange={(e) => setMeta("name", e.target.value)}
              placeholder="e.g. Riverside Pump Station Upgrade"
            />
          </div>
          <div>
            <label className={labelCls}>Client</label>
            <input
              type="text"
              className={inputCls}
              value={meta.client}
              onChange={(e) => setMeta("client", e.target.value)}
              placeholder="Municipality / Water Authority"
            />
          </div>
          <div>
            <label className={labelCls}>Job Number</label>
            <input
              type="text"
              className={inputCls}
              value={meta.job_number}
              onChange={(e) => setMeta("job_number", e.target.value)}
              placeholder="WPS-2024-001"
            />
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input
              type="date"
              className={inputCls}
              value={meta.date}
              onChange={(e) => setMeta("date", e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Engineer</label>
            <input
              type="text"
              className={inputCls}
              value={meta.engineer}
              onChange={(e) => setMeta("engineer", e.target.value)}
              placeholder="Name, P.E."
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Notes</label>
            <textarea
              className={inputCls + " resize-none"}
              rows={2}
              value={meta.notes}
              onChange={(e) => setMeta("notes", e.target.value)}
              placeholder="Design intent, applicable standards, constraints…"
            />
          </div>
        </div>
      </div>

      {/* Unit system */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 mb-4">
          Unit System <FieldTip fieldKey="unit_system" />
        </p>
        <div className="flex gap-3 mb-4">
          {(["SI", "US"] as UnitSystem[]).map((us) => (
            <button
              key={us}
              type="button"
              onClick={() => handleUnitSystem(us)}
              className={`flex-1 rounded-lg border px-4 py-3 text-sm font-semibold transition-all ${
                draft.unitSystem === us
                  ? "border-teal-600 bg-teal-50 text-teal-800 ring-1 ring-teal-400"
                  : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
              }`}
            >
              {us === "SI" ? "SI (metric)" : "US Customary (imperial)"}
              <span className="block text-xs font-normal mt-0.5 text-slate-400">
                {us === "SI" ? "m³/h · m · mm · kPa" : "gpm · ft · in · psi"}
              </span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft.showBoth}
            onChange={(e) => handleShowBoth(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <span className="text-sm text-slate-700">
            Show both SI and US values in result panels
          </span>
        </label>
      </div>

      {/* Optional modules */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 mb-4">
          Optional Modules
        </p>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft.includeSurge ?? true}
            onChange={(e) =>
              dispatch({ type: "SET_INCLUDE_SURGE", includeSurge: e.target.checked })
            }
            className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
          />
          <div>
            <span className="text-sm font-medium text-slate-700">Include Surge Analysis <FieldTip fieldKey="include_surge" /></span>
            <p className="text-xs text-slate-400 mt-0.5">
              Adds the Water Hammer step (Joukowsky quick analysis + Method of Characteristics MOC solver)
            </p>
          </div>
        </label>
      </div>

      {/* Design flow */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-2 mb-4">
          Design Flow Rate
        </p>
        <div className="flex items-end gap-3 max-w-xs">
          <div className="flex-1">
            <label className={labelCls}>
              Q design ({flowUnit}) <FieldTip fieldKey="design_flow" />
            </label>
            <input
              type="number"
              step="any"
              min="0.01"
              className={inputCls + " font-mono"}
              value={displayFlow}
              onChange={(e) => handleFlowChange(e.target.value)}
            />
          </div>
          <div className="pb-2 text-xs text-slate-400 font-mono whitespace-nowrap">
            {isUS
              ? `= ${draft.designFlow_m3h.toFixed(2)} m³/h`
              : `= ${(draft.designFlow_m3h * GPM_PER_M3H).toFixed(1)} gpm`}
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          This is the single design-point flow used throughout all hydraulic calculations.
        </p>
      </div>
    </div>
  );
}
