import { useProject } from "../../contexts/ProjectContext";
import { useUnitSystem } from "../../contexts/UnitSystemContext";
import { FT_PER_M, M_PER_FT } from "../../utils/units";

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const labelCls =
  "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";

export default function StepNodes() {
  const { draft, dispatch } = useProject();
  const { unitSystem } = useUnitSystem();
  const isUS = unitSystem === "US";

  const elevUnit = isUS ? "ft" : "m";
  const pressUnit = isUS ? "psi" : "kPa";

  const toDisplay = (m: number) => isUS ? +(m * FT_PER_M).toFixed(3) : m;
  const fromDisplay = (v: number) => isUS ? v * M_PER_FT : v;

  const upEl = toDisplay(draft.upstreamNode.elevation_m);
  const dnEl = toDisplay(draft.downstreamNode.elevation_m);
  const staticHead_m = draft.downstreamNode.elevation_m - draft.upstreamNode.elevation_m;
  const staticHead_d = isUS ? staticHead_m * FT_PER_M : staticHead_m;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">System Nodes</h2>
        <p className="text-xs text-slate-500">
          Define the hydraulic grade line reference elevations and operating pressure zones
          at the suction source and delivery point.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Upstream node */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="h-6 w-6 rounded-full bg-teal-600 text-white text-xs flex items-center justify-center font-bold">
              US
            </span>
            <p className="text-sm font-bold text-slate-700">Upstream (Source)</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Elevation ({elevUnit})</label>
              <input
                type="number"
                step="any"
                className={inputCls}
                value={upEl}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v))
                    dispatch({
                      type: "SET_UPSTREAM_NODE",
                      node: { ...draft.upstreamNode, elevation_m: fromDisplay(v) },
                    });
                }}
              />
              {isUS && (
                <p className="mt-0.5 text-[10px] text-slate-400 font-mono">
                  = {draft.upstreamNode.elevation_m.toFixed(3)} m
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Pressure zone ({pressUnit})</label>
              <input
                type="number"
                step="any"
                min="0"
                className={inputCls}
                value={draft.upstreamNode.pressure_kPa}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v))
                    dispatch({
                      type: "SET_UPSTREAM_NODE",
                      node: { ...draft.upstreamNode, pressure_kPa: v },
                    });
                }}
              />
              <p className="mt-0.5 text-[10px] text-slate-400">
                Suction-side static pressure (0 for open wet well)
              </p>
            </div>
          </div>
        </div>

        {/* Downstream node */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="h-6 w-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">
              DS
            </span>
            <p className="text-sm font-bold text-slate-700">Downstream (Delivery)</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Elevation ({elevUnit})</label>
              <input
                type="number"
                step="any"
                className={inputCls}
                value={dnEl}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v))
                    dispatch({
                      type: "SET_DOWNSTREAM_NODE",
                      node: { ...draft.downstreamNode, elevation_m: fromDisplay(v) },
                    });
                }}
              />
              {isUS && (
                <p className="mt-0.5 text-[10px] text-slate-400 font-mono">
                  = {draft.downstreamNode.elevation_m.toFixed(3)} m
                </p>
              )}
            </div>
            <div>
              <label className={labelCls}>Pressure zone ({pressUnit})</label>
              <input
                type="number"
                step="any"
                min="0"
                className={inputCls}
                value={draft.downstreamNode.pressure_kPa}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v))
                    dispatch({
                      type: "SET_DOWNSTREAM_NODE",
                      node: { ...draft.downstreamNode, pressure_kPa: v },
                    });
                }}
              />
              <p className="mt-0.5 text-[10px] text-slate-400">
                Delivery pressure at zone boundary (0 if atmospheric)
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Computed static head preview */}
      <div className="rounded-xl border border-teal-200 bg-teal-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-teal-600 mb-2">
          Computed Static Head Preview
        </p>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-2xl font-bold text-teal-800">
            {staticHead_d.toFixed(2)}
            <span className="ml-1 text-sm font-normal text-teal-600">{elevUnit}</span>
          </span>
          {isUS && (
            <span className="font-mono text-sm text-slate-500">
              = {staticHead_m.toFixed(3)} m
            </span>
          )}
          <span className="text-xs text-slate-500">
            = downstream elevation − upstream elevation
          </span>
        </div>
        {staticHead_m < 0 && (
          <p className="mt-1 text-xs text-amber-700 font-semibold">
            Warning: negative static head — this is a downhill system.
          </p>
        )}
      </div>
    </div>
  );
}
