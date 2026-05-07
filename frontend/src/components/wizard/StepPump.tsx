import PumpSelectionStep from "../PumpSelectionStep";
import PumpCurveStep from "../PumpCurveStep";
import { useProject } from "../../contexts/ProjectContext";
import type { PumpComputeResponse, CurvePoint } from "../../utils/api";

export default function StepPump() {
  const { draft, dispatch } = useProject();

  const systemCurve: CurvePoint[] | undefined = draft.hydraulicsResult?.system_curve
    ? (draft.hydraulicsResult.system_curve as { Q_m3h: number; H_m: number }[]).map(
        (pt) => ({ Q_m3h: pt.Q_m3h, value: pt.H_m })
      )
    : undefined;

  const handlePumpResult = (result: PumpComputeResponse | null) => {
    dispatch({ type: "SET_PUMP_RESULT", result });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Pump Selection &amp; Curves</h2>
        <p className="text-xs text-slate-500">
          Choose a pump type and configuration, then enter H-Q / efficiency / power curves.
          System curve from Step 7 is overlaid automatically to find the operating point.
        </p>
        {!draft.hydraulicsResult && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Complete Step 7 (Hydraulic Results) to overlay the system curve on the pump chart.
            You can still enter pump data now and revisit after computing.
          </div>
        )}
      </div>

      {/* Type selection */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Part A — Pump Type &amp; Configuration
        </p>
        <PumpSelectionStep />
      </div>

      {/* Divider */}
      <div className="border-t border-slate-200" />

      {/* Curve entry */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Part B — H-Q / Efficiency / Power Curves
        </p>
        <PumpCurveStep
          systemCurve={systemCurve}
          staticHeadM={draft.hydraulicsResult?.static_head_m}
          designFlowM3h={draft.hydraulicsResult?.design_Q_m3h}
          designTdhM={draft.hydraulicsResult?.tdh_m}
          onResult={handlePumpResult}
        />
      </div>
    </div>
  );
}
