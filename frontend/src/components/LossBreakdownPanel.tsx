import type { LossBreakdownResponse } from "../utils/api";
import { useUnitSystem } from "../contexts/UnitSystemContext";

const CATEGORY_LABELS: Record<string, string> = {
  check_valve:       "Check Valve",
  isolation_valve:   "Isolation Valve",
  control_valve:     "Control Valve",
  meter:             "Meter / Instrument",
  suction_fitting:   "Suction Fitting",
  discharge_fitting: "Discharge Fitting",
  station_special:   "Station Special",
  pipe_transition:   "Pipe Transition",
};

const CATEGORY_COLOURS: Record<string, string> = {
  check_valve:       "bg-blue-100 text-blue-700",
  isolation_valve:   "bg-purple-100 text-purple-700",
  control_valve:     "bg-orange-100 text-orange-700",
  meter:             "bg-green-100 text-green-700",
  suction_fitting:   "bg-sky-100 text-sky-700",
  discharge_fitting: "bg-indigo-100 text-indigo-700",
  station_special:   "bg-amber-100 text-amber-700",
  pipe_transition:   "bg-rose-100 text-rose-700",
};

interface Props {
  data: LossBreakdownResponse;
}

export default function LossBreakdownPanel({ data }: Props) {
  const { showBoth } = useUnitSystem();
  const isUS = data.unit_system === "US";

  const headUnit = isUS ? "ft" : "m";

  const totalDisplay = data.total_hm_display;

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-teal-300 bg-teal-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
            Total Minor Loss
          </p>
          <p className="font-mono text-xl font-bold text-teal-800">
            {totalDisplay.display_value.toFixed(3)}
            <span className="ml-1 text-sm font-normal text-slate-500">{headUnit}</span>
          </p>
          {showBoth && Math.abs(totalDisplay.si_value - totalDisplay.display_value) > 1e-6 && (
            <p className="text-[10px] font-mono text-slate-400">
              = {totalDisplay.si_value.toFixed(3)} m
            </p>
          )}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
            ΣK (all fittings)
          </p>
          <p className="font-mono text-xl font-bold text-slate-800">
            {data.K_sum.toFixed(3)}
            <span className="ml-1 text-sm font-normal text-slate-500">—</span>
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
            Velocity / V²/2g
          </p>
          <p className="font-mono text-sm font-bold text-slate-800">
            {isUS
              ? (data.velocity_ms * 3.28084).toFixed(3)
              : data.velocity_ms.toFixed(3)}{" "}
            <span className="font-normal text-slate-500 text-xs">
              {isUS ? "fps" : "m/s"}
            </span>
          </p>
          <p className="font-mono text-xs text-slate-500 mt-0.5">
            {isUS
              ? (data.velocity_head_m * 3.28084).toFixed(3)
              : data.velocity_head_m.toFixed(4)}{" "}
            {headUnit}
          </p>
        </div>
      </div>

      {/* Warnings */}
      {data.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-0.5">
          {data.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      {/* Breakdown table */}
      {data.items.length === 0 ? (
        <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
          No accessories selected
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                  Accessory
                </th>
                <th className="text-left py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                  Category
                </th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                  n
                </th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                  K each
                </th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                  K total
                </th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                  h_m ({headUnit})
                </th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">
                  %
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr
                  key={item.accessory_id}
                  className={`border-b border-slate-100 ${
                    i % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                  }`}
                >
                  <td className="py-1.5 px-2 font-medium text-slate-700">
                    {item.name}
                    {showBoth &&
                      Math.abs(item.hm_display.si_value - item.hm_display.display_value) > 1e-6 && (
                        <span className="ml-1 text-[9px] font-mono text-slate-400">
                          ({item.hm_display.si_value.toFixed(4)} m)
                        </span>
                      )}
                  </td>
                  <td className="py-1.5 px-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        CATEGORY_COLOURS[item.category] ?? "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-600">
                    {item.count}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-600">
                    {item.K_each.toFixed(3)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono font-semibold text-slate-700">
                    {item.K_total.toFixed(3)}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-700">
                    {item.hm_display.display_value.toFixed(4)}
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <div className="w-12 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-teal-500"
                          style={{ width: `${Math.min(item.pct_of_total_minor, 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-slate-500 w-8 text-right">
                        {item.pct_of_total_minor.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 font-semibold bg-slate-50">
                <td className="py-1.5 px-2 text-slate-700" colSpan={4}>
                  Total
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-slate-800">
                  {data.K_sum.toFixed(3)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-teal-800">
                  {data.total_hm_display.display_value.toFixed(4)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-slate-500">
                  100%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Per-item potable notes (collapsed, shown only when populated) */}
      {data.items.some((i) => i.potable_notes.length > 0) && (
        <details className="rounded-lg border border-teal-200 bg-teal-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-teal-800 select-none">
            NSF/ANSI 61 &amp; Potable-Water Compliance Notes
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            {data.items
              .filter((i) => i.potable_notes.length > 0)
              .map((item) => (
                <div key={item.accessory_id}>
                  <p className="text-[10px] font-semibold text-teal-900 mb-0.5">
                    {item.name}
                  </p>
                  <ul className="space-y-0.5">
                    {item.potable_notes.map((note, j) => (
                      <li
                        key={j}
                        className="text-[10px] text-teal-800 leading-relaxed flex gap-1"
                      >
                        <span className="shrink-0 text-teal-500">•</span>
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}
