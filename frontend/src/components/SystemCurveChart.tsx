import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Dot,
} from "recharts";
import type { CalculationResponse, SystemCurvePoint } from "../utils/api";

interface Props {
  results: CalculationResponse;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: SystemCurvePoint }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.length) return null;
  const pt = payload[0].payload;
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2 shadow-md text-xs font-mono">
      <p className="font-semibold text-teal-700">Q = {pt.Q_m3h.toFixed(2)} m³/h</p>
      <p className="text-slate-600">H = {pt.H_m.toFixed(2)} m</p>
    </div>
  );
}

export default function SystemCurveChart({ results }: Props) {
  const data = results.system_curve;
  const Q_design = results.design_Q_m3h;
  const H_tdh = results.tdh_m;

  const H_max = Math.max(...data.map((p) => p.H_m)) * 1.15;
  const H_min = Math.min(0, Math.min(...data.map((p) => p.H_m)) * 0.9);
  const Q_max = Math.max(...data.map((p) => p.Q_m3h)) * 1.05;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">System H-Q Curve</h3>
          <p className="text-xs text-slate-400">
            Darcy-Weisbach with Colebrook-White friction factor
          </p>
        </div>
        <span className="text-xs font-mono bg-teal-50 text-teal-700 border border-teal-200 px-2 py-0.5 rounded">
          8 pts · 0 → 1.5×Q
        </span>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />

          <XAxis
            dataKey="Q_m3h"
            type="number"
            domain={[0, Q_max]}
            label={{
              value: "Flow Q (m³/h)",
              position: "insideBottomRight",
              offset: -10,
              fontSize: 11,
              fill: "#64748b",
            }}
            tickFormatter={(v: number) => v.toFixed(1)}
            tick={{ fontSize: 11, fontFamily: "monospace", fill: "#64748b" }}
          />

          <YAxis
            domain={[H_min, H_max]}
            label={{
              value: "Head H (m)",
              angle: -90,
              position: "insideLeft",
              offset: 10,
              fontSize: 11,
              fill: "#64748b",
            }}
            tickFormatter={(v: number) => v.toFixed(1)}
            tick={{ fontSize: 11, fontFamily: "monospace", fill: "#64748b" }}
          />

          <Tooltip content={<CustomTooltip />} />

          {/* Design point reference lines */}
          <ReferenceLine
            x={Q_design}
            stroke="#0f766e"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{
              value: `Q_d = ${Q_design.toFixed(1)}`,
              position: "top",
              fontSize: 10,
              fill: "#0f766e",
              fontFamily: "monospace",
            }}
          />
          <ReferenceLine
            y={H_tdh}
            stroke="#0f766e"
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={{
              value: `TDH = ${H_tdh.toFixed(2)} m`,
              position: "right",
              fontSize: 10,
              fill: "#0f766e",
              fontFamily: "monospace",
            }}
          />

          <Line
            type="monotone"
            dataKey="H_m"
            stroke="#0f766e"
            strokeWidth={2.5}
            dot={<Dot r={4} fill="#0f766e" stroke="#fff" strokeWidth={1.5} />}
            activeDot={{ r: 6, fill: "#0d5c55", stroke: "#fff", strokeWidth: 2 }}
            isAnimationActive={true}
            animationDuration={600}
          />
        </LineChart>
      </ResponsiveContainer>

      {/* Data table below chart */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="pb-1 text-left text-slate-500 font-medium">Q (m³/h)</th>
              <th className="pb-1 text-right text-slate-500 font-medium">Q (L/s)</th>
              <th className="pb-1 text-right text-slate-500 font-medium">H_system (m)</th>
            </tr>
          </thead>
          <tbody>
            {data.map((pt, i) => (
              <tr
                key={i}
                className={`border-b border-slate-100 ${
                  Math.abs(pt.Q_m3h - Q_design) < 0.01 ? "bg-teal-50 font-semibold" : ""
                }`}
              >
                <td className="py-0.5 text-slate-700">{pt.Q_m3h.toFixed(2)}</td>
                <td className="py-0.5 text-right text-slate-600">
                  {(pt.Q_m3h / 3.6).toFixed(3)}
                </td>
                <td className="py-0.5 text-right text-teal-700">{pt.H_m.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
