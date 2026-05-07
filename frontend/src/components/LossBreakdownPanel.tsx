import type { LossBreakdownResponse } from "../utils/api";
import { useUnitSystem } from "../contexts/UnitSystemContext";

const CATEGORY_LABELS: Record<string, string> = {
  check_valve:       "Check Valve",
  isolation_valve:   "Isolation Valve",
  control_valve:     "Control Valve",
  meter:             "Meter / Instrument",
  strainer:          "Strainer",
  air_valve:         "Air Valve",
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
  strainer:          "bg-cyan-100 text-cyan-700",
  air_valve:         "bg-lime-100 text-lime-700",
  suction_fitting:   "bg-sky-100 text-sky-700",
  discharge_fitting: "bg-indigo-100 text-indigo-700",
  station_special:   "bg-amber-100 text-amber-700",
  pipe_transition:   "bg-rose-100 text-rose-700",
};

const SEGMENT_COLOURS: Record<string, string> = {
  suction:   "bg-sky-100 text-sky-700",
  discharge: "bg-indigo-100 text-indigo-700",
  untagged:  "bg-slate-100 text-slate-500",
};

interface Props {
  data: LossBreakdownResponse;
}

export default function LossBreakdownPanel({ data }: Props) {
  const { showBoth } = useUnitSystem();
  const isUS = data.unit_system === "US";

  const headUnit = isUS ? "ft" : "m";
  const hasMajor    = data.major_hm_m > 0;
  const hasSegments = data.suction_minor_hm_m > 0 || data.discharge_minor_hm_m > 0;
  const hasContrib  = (data.contribution_rows ?? []).length > 0;

  const fmt = (m: number) => (isUS ? (m * 3.28084).toFixed(3) : m.toFixed(3));

  return (
    <div className="space-y-4">
      {/* ── Summary KPI row ─────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-teal-300 bg-teal-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5">
            Total Minor Loss
          </p>
          <p className="font-mono text-xl font-bold text-teal-800">
            {data.total_hm_display.display_value.toFixed(3)}
            <span className="ml-1 text-sm font-normal text-slate-500">{headUnit}</span>
          </p>
          {showBoth && Math.abs(data.total_hm_display.si_value - data.total_hm_display.display_value) > 1e-6 && (
            <p className="text-[10px] font-mono text-slate-400">
              = {data.total_hm_display.si_value.toFixed(3)} m
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
            {isUS ? (data.velocity_ms * 3.28084).toFixed(3) : data.velocity_ms.toFixed(3)}{" "}
            <span className="font-normal text-slate-500 text-xs">
              {isUS ? "fps" : "m/s"}
            </span>
          </p>
          <p className="font-mono text-xs text-slate-500 mt-0.5">
            {isUS ? (data.velocity_head_m * 3.28084).toFixed(3) : data.velocity_head_m.toFixed(4)}{" "}
            {headUnit}
          </p>
        </div>
      </div>

      {/* ── Major vs Minor stacked bar ───────────────────────────────── */}
      {hasMajor && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Major vs Minor — Grand Total{" "}
            <span className="font-mono">{fmt(data.grand_total_hm_m)} {headUnit}</span>
          </p>
          <div className="h-3 rounded-full bg-slate-200 overflow-hidden flex">
            <div
              className="h-full bg-teal-500 transition-all"
              style={{ width: `${data.pct_minor_of_grand_total}%` }}
              title={`Minor ${data.pct_minor_of_grand_total.toFixed(1)}%`}
            />
            <div
              className="h-full bg-orange-400"
              style={{ width: `${data.pct_major_of_grand_total}%` }}
              title={`Major ${data.pct_major_of_grand_total.toFixed(1)}%`}
            />
          </div>
          <div className="flex gap-4 text-[10px] font-mono">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-teal-500" />
              Minor {fmt(data.total_hm_m)} {headUnit}
              <span className="text-slate-400">({data.pct_minor_of_grand_total.toFixed(1)}%)</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
              Major {fmt(data.major_hm_m)} {headUnit}
              <span className="text-slate-400">({data.pct_major_of_grand_total.toFixed(1)}%)</span>
            </span>
          </div>
        </div>
      )}

      {/* ── Segment subtotals (minor + major per segment) ────────────── */}
      {(hasSegments || hasMajor) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-2.5 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-600">
              Suction
            </p>
            {data.suction_major_hm_m > 0 && (
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-slate-500">Major (friction)</span>
                <span className="text-orange-700 font-semibold">{fmt(data.suction_major_hm_m)} {headUnit}</span>
              </div>
            )}
            {data.suction_minor_hm_m > 0 && (
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-slate-500">Minor (fittings)</span>
                <span className="text-sky-800 font-semibold">{fmt(data.suction_minor_hm_m)} {headUnit}</span>
              </div>
            )}
            {data.suction_major_hm_m === 0 && data.suction_minor_hm_m === 0 && (
              <p className="text-[10px] text-slate-300 italic">no items</p>
            )}
          </div>
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
              Discharge
            </p>
            {data.discharge_major_hm_m > 0 && (
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-slate-500">Major (friction)</span>
                <span className="text-orange-700 font-semibold">{fmt(data.discharge_major_hm_m)} {headUnit}</span>
              </div>
            )}
            {data.discharge_minor_hm_m > 0 && (
              <div className="flex justify-between text-[10px] font-mono">
                <span className="text-slate-500">Minor (fittings)</span>
                <span className="text-indigo-800 font-semibold">{fmt(data.discharge_minor_hm_m)} {headUnit}</span>
              </div>
            )}
            {data.discharge_major_hm_m === 0 && data.discharge_minor_hm_m === 0 && (
              <p className="text-[10px] text-slate-300 italic">no items</p>
            )}
          </div>
        </div>
      )}

      {/* ── Warnings ─────────────────────────────────────────────────── */}
      {data.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-0.5">
          {data.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-800">⚠ {w}</p>
          ))}
        </div>
      )}

      {/* ── Per-accessory breakdown table ─────────────────────────────── */}
      {data.items.length === 0 ? (
        <div className="flex h-20 items-center justify-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
          No accessories selected
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Accessory</th>
                <th className="text-left py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Category</th>
                <th className="text-left py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Seg</th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">n</th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">K each</th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">K total</th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">h_m ({headUnit})</th>
                <th className="text-right py-1.5 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">%</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr
                  key={`${item.accessory_id}-${item.segment ?? "flat"}`}
                  className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
                >
                  <td className="py-1.5 px-2 font-medium text-slate-700">
                    {item.name}
                    {showBoth && Math.abs(item.hm_display.si_value - item.hm_display.display_value) > 1e-6 && (
                      <span className="ml-1 text-[9px] font-mono text-slate-400">
                        ({item.hm_display.si_value.toFixed(4)} m)
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 px-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      CATEGORY_COLOURS[item.category] ?? "bg-slate-100 text-slate-600"
                    }`}>
                      {CATEGORY_LABELS[item.category] ?? item.category}
                    </span>
                  </td>
                  <td className="py-1.5 px-2">
                    {item.segment ? (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        item.segment === "suction"
                          ? "bg-sky-100 text-sky-700"
                          : "bg-indigo-100 text-indigo-700"
                      }`}>
                        {item.segment === "suction" ? "S" : "D"}
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-600">{item.count}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-600">{item.K_each.toFixed(3)}</td>
                  <td className="py-1.5 px-2 text-right font-mono font-semibold text-slate-700">{item.K_total.toFixed(3)}</td>
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
                <td className="py-1.5 px-2 text-slate-700" colSpan={5}>Total</td>
                <td className="py-1.5 px-2 text-right font-mono text-slate-800">{data.K_sum.toFixed(3)}</td>
                <td className="py-1.5 px-2 text-right font-mono text-teal-800">
                  {data.total_hm_display.display_value.toFixed(4)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-slate-500">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── Contribution matrix (segment × loss_type × category) ─────── */}
      {hasContrib && (
        <details className="rounded-lg border border-slate-200" open>
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600 select-none flex items-center justify-between">
            <span>Contribution Matrix — Segment × Loss Type × Category</span>
            <span className="text-[10px] text-slate-400 font-normal">
              Grand total {fmt(data.grand_total_hm_m)} {headUnit}
            </span>
          </summary>
          <div className="px-3 pb-3 pt-1 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Segment</th>
                  <th className="text-left py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Type</th>
                  <th className="text-left py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Category / Description</th>
                  <th className="text-right py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">h_m ({headUnit})</th>
                  <th className="text-right py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">% of total</th>
                </tr>
              </thead>
              <tbody>
                {(data.contribution_rows ?? []).map((row, i) => (
                  <tr
                    key={`${row.segment}-${row.loss_type}-${row.category}`}
                    className={`border-b border-slate-100 ${i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
                  >
                    <td className="py-1 px-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        SEGMENT_COLOURS[row.segment] ?? "bg-slate-100 text-slate-500"
                      }`}>
                        {row.segment.charAt(0).toUpperCase() + row.segment.slice(1)}
                      </span>
                    </td>
                    <td className="py-1 px-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        row.loss_type === "major"
                          ? "bg-orange-100 text-orange-700"
                          : "bg-teal-100 text-teal-700"
                      }`}>
                        {row.loss_type === "major" ? "Major" : "Minor"}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-slate-600">{row.label}</td>
                    <td className="py-1 px-2 text-right font-mono text-slate-700">
                      {isUS
                        ? (row.h_display.display_value).toFixed(4)
                        : row.h_m.toFixed(4)}
                    </td>
                    <td className="py-1 px-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <div className="w-16 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              row.loss_type === "major" ? "bg-orange-400" : "bg-teal-500"
                            }`}
                            style={{ width: `${Math.min(row.pct_of_grand_total, 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-slate-500 w-10 text-right">
                          {row.pct_of_grand_total.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-300 font-semibold bg-slate-50">
                  <td className="py-1 px-2 text-slate-700" colSpan={3}>Grand Total</td>
                  <td className="py-1 px-2 text-right font-mono text-slate-800">
                    {fmt(data.grand_total_hm_m)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono text-slate-500">100%</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      )}

      {/* ── Per-category subtotals ────────────────────────────────────── */}
      {data.category_subtotals.length > 1 && (
        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-slate-600 select-none">
            By Category
          </summary>
          <div className="px-3 pb-3 pt-1 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">Category</th>
                  <th className="text-right py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">ΣK</th>
                  <th className="text-right py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">h_m ({headUnit})</th>
                  <th className="text-right py-1 px-2 font-semibold text-slate-500 uppercase tracking-wide text-[10px]">% minor</th>
                </tr>
              </thead>
              <tbody>
                {data.category_subtotals.map((sub, i) => (
                  <tr key={sub.category} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                    <td className="py-1 px-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        CATEGORY_COLOURS[sub.category] ?? "bg-slate-100 text-slate-600"
                      }`}>
                        {sub.label}
                      </span>
                    </td>
                    <td className="py-1 px-2 text-right font-mono text-slate-600">{sub.K_sum.toFixed(3)}</td>
                    <td className="py-1 px-2 text-right font-mono text-slate-700">
                      {sub.hm_display.display_value.toFixed(4)}
                    </td>
                    <td className="py-1 px-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <div className="w-10 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-teal-400"
                            style={{ width: `${Math.min(sub.pct_of_total_minor, 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-slate-500 w-8 text-right">
                          {sub.pct_of_total_minor.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {/* ── Potable-water compliance notes ───────────────────────────── */}
      {data.items.some((i) => i.potable_notes.length > 0) && (
        <details className="rounded-lg border border-teal-200 bg-teal-50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-teal-800 select-none">
            NSF/ANSI 61 &amp; Potable-Water Compliance Notes
          </summary>
          <div className="px-3 pb-3 pt-1 space-y-2">
            {data.items
              .filter((i) => i.potable_notes.length > 0)
              .map((item) => (
                <div key={`${item.accessory_id}-${item.segment ?? "flat"}`}>
                  <p className="text-[10px] font-semibold text-teal-900 mb-0.5">{item.name}</p>
                  <ul className="space-y-0.5">
                    {item.potable_notes.map((note, j) => (
                      <li key={j} className="text-[10px] text-teal-800 leading-relaxed flex gap-1">
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
