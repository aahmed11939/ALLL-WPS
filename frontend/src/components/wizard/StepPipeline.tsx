import { useProject } from "../../contexts/ProjectContext";
import { useUnitSystem } from "../../contexts/UnitSystemContext";
import TermTip from "../TermTip";
import AccessoriesPicker from "../AccessoriesPicker";
import FieldErrorHint from "../FieldErrorHint";
import type { PipelineDraft, PipelineSegment } from "../../types/project";
import type { AccessoryItem } from "../../utils/api";
import { FT_PER_M, IN_PER_MM, M_PER_FT, MM_PER_IN } from "../../utils/units";

const MATERIALS: { key: string; label: string }[] = [
  { key: "pvc",             label: "PVC" },
  { key: "hdpe",            label: "HDPE" },
  { key: "ductile_iron",    label: "Ductile Iron" },
  { key: "cast_iron",       label: "Cast Iron" },
  { key: "steel",           label: "Steel" },
  { key: "galvanized_iron", label: "Galvanized Iron" },
  { key: "fiberglass",      label: "Fiberglass" },
  { key: "concrete",        label: "Concrete" },
  { key: "asbestos_cement", label: "Asbestos Cement" },
  { key: "copper",          label: "Copper" },
];

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const selectCls =
  "w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";

interface Props {
  label: "suction" | "discharge";
}

export default function StepPipeline({ label }: Props) {
  const { draft, dispatch } = useProject();
  const { unitSystem } = useUnitSystem();
  const fieldErrors = draft.hydraulicsFieldErrors ?? [];
  const isUS = unitSystem === "US";

  const pipeline: PipelineDraft = label === "suction" ? draft.suction : draft.discharge;

  const setPipeline = (p: PipelineDraft) => {
    if (label === "suction") {
      dispatch({ type: "SET_SUCTION", suction: p });
    } else {
      dispatch({ type: "SET_DISCHARGE", discharge: p });
    }
  };

  const lengthUnit = isUS ? "ft" : "m";
  const diamUnit   = isUS ? "in" : "mm";

  const toDispLen   = (m: number)  => isUS ? +(m  * FT_PER_M).toFixed(2)  : m;
  const fromDispLen = (v: number)  => isUS ? v * M_PER_FT : v;
  const toDispDiam  = (mm: number) => isUS ? +(mm * IN_PER_MM).toFixed(3) : mm;
  const fromDispDiam= (v: number)  => isUS ? v * MM_PER_IN : v;

  const updateSegment = (idx: number, key: keyof PipelineSegment, raw: string) => {
    const segs = pipeline.segments.map((s, i) => {
      if (i !== idx) return s;
      if (key === "material") return { ...s, material: raw };
      const v = parseFloat(raw);
      if (isNaN(v) || v <= 0) return s;
      if (key === "diameter_mm") return { ...s, diameter_mm: fromDispDiam(v) };
      if (key === "length_m")    return { ...s, length_m: fromDispLen(v) };
      return s;
    });
    setPipeline({ ...pipeline, segments: segs });
  };

  const addSegment = () => {
    const last = pipeline.segments[pipeline.segments.length - 1];
    const newSeg: PipelineSegment = { ...(last ?? { material: "pvc", diameter_mm: 150, length_m: 100 }) };
    setPipeline({ ...pipeline, segments: [...pipeline.segments, newSeg] });
  };

  const removeSegment = (idx: number) => {
    if (pipeline.segments.length <= 1) return;
    setPipeline({ ...pipeline, segments: pipeline.segments.filter((_, i) => i !== idx) });
  };

  const moveSegment = (idx: number, dir: -1 | 1) => {
    const segs = [...pipeline.segments];
    const target = idx + dir;
    if (target < 0 || target >= segs.length) return;
    [segs[idx], segs[target]] = [segs[target], segs[idx]];
    setPipeline({ ...pipeline, segments: segs });
  };

  const handleAccessoriesChange = (items: AccessoryItem[], kSum: number) => {
    setPipeline({ ...pipeline, accessories: items, accessories_K_sum: kSum });
  };

  const totalLength     = pipeline.segments.reduce((a, s) => a + s.length_m, 0);
  const totalLengthDisp = isUS ? (totalLength * FT_PER_M).toFixed(1) : totalLength.toFixed(1);

  const title = label === "suction" ? "Suction Pipeline" : "Discharge Pipeline";
  const desc  = label === "suction"
    ? "Define suction pipe segments from the wet well to the pump(s)."
    : "Define discharge pipe segments from the pump(s) to the delivery node.";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">{title}</h2>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>

      {/* Segments table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between bg-slate-50 border-b border-slate-200 px-4 py-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Pipe Segments
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 font-mono">
              Total: {totalLengthDisp} {lengthUnit}
            </span>
            <button
              type="button"
              onClick={addSegment}
              className="text-xs font-semibold text-teal-600 hover:text-teal-800 transition-colors"
            >
              + Add segment
            </button>
          </div>
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 w-8">
                #
              </th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Material <TermTip term="roughness" /> <TermTip term="Hazen-C" />
              </th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Dia ({diamUnit})
              </th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Length ({lengthUnit})
              </th>
              <th className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-400 w-20">
                Order
              </th>
              <th className="px-2 py-2 w-8" />
            </tr>
          </thead>
          <tbody>
            {pipeline.segments.map((seg, idx) => (
              <tr key={idx} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-2 text-xs font-mono text-slate-400">{idx + 1}</td>
                <td className="px-2 py-2">
                  <select
                    className={selectCls}
                    value={seg.material}
                    onChange={(e) => updateSegment(idx, "material", e.target.value)}
                  >
                    {MATERIALS.map((m) => (
                      <option key={m.key} value={m.key}>{m.label}</option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    step="any"
                    min="1"
                    className={`${inputCls} ${
                      fieldErrors.some(e => e.loc.includes("pipe_diameter_mm"))
                        ? "border-rose-400 bg-rose-50 focus:border-rose-500 focus:ring-rose-400"
                        : ""
                    }`}
                    value={toDispDiam(seg.diameter_mm)}
                    onChange={(e) => updateSegment(idx, "diameter_mm", e.target.value)}
                  />
                  {idx === 0 && (
                    <FieldErrorHint fieldPath="pipe_diameter_mm" errors={fieldErrors} />
                  )}
                </td>
                <td className="px-2 py-2">
                  <input
                    type="number"
                    step="any"
                    min="0.1"
                    className={inputCls}
                    value={toDispLen(seg.length_m)}
                    onChange={(e) => updateSegment(idx, "length_m", e.target.value)}
                  />
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveSegment(idx, -1)}
                      disabled={idx === 0}
                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 disabled:opacity-30 text-xs"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSegment(idx, 1)}
                      disabled={idx === pipeline.segments.length - 1}
                      className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 text-slate-400 hover:border-slate-300 hover:text-slate-600 disabled:opacity-30 text-xs"
                      title="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </td>
                <td className="px-2 py-2 text-center">
                  <button
                    type="button"
                    onClick={() => removeSegment(idx)}
                    disabled={pipeline.segments.length <= 1}
                    className="text-rose-400 hover:text-rose-600 disabled:opacity-30 text-xs"
                    title="Remove segment"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SI summary (when in US mode) */}
      {isUS && pipeline.segments.length > 0 && (
        <p className="text-[10px] text-slate-400 font-mono -mt-4">
          Stored in SI:{" "}
          {pipeline.segments.map((s, i) => (
            <span key={i}>
              {i > 0 ? " → " : ""}
              Seg {i+1}: {s.material} DN{Math.round(s.diameter_mm)} × {s.length_m.toFixed(1)} m
            </span>
          ))}
        </p>
      )}

      {/* Accessories picker */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Fittings &amp; Accessories
          </p>
          <span className="text-xs font-mono text-slate-400">
            ΣK = {pipeline.accessories_K_sum.toFixed(3)}
          </span>
        </div>
        <div className="p-4">
          <AccessoriesPicker
            segment={label}
            onChange={handleAccessoriesChange}
            initialItems={pipeline.accessories}
          />
        </div>
      </div>
    </div>
  );
}
