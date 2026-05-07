import { useProject } from "../../contexts/ProjectContext";
import PumpCurveStep from "../PumpCurveStep";
import type { PumpComputeResponse, CurvePoint } from "../../utils/api";

export default function StepCurves() {
  const { draft, dispatch } = useProject();

  const systemCurve: CurvePoint[] | undefined = draft.hydraulicsResult?.system_curve
    ? (draft.hydraulicsResult.system_curve as { Q_m3h: number; H_m: number }[]).map(
        (pt) => ({ Q_m3h: pt.Q_m3h, value: pt.H_m })
      )
    : undefined;

  const handleResult = (result: PumpComputeResponse | null) => {
    dispatch({ type: "SET_PUMP_RESULT", result });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Pump Curves</h2>
        <p className="text-xs text-slate-500">
          Enter pump H-Q, efficiency, and power curves. The system curve from Step 8
          is overlaid automatically to find the operating point.
        </p>
        {!draft.hydraulicsResult && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Run the hydraulic compute on Step 8 first to overlay the system curve on the pump chart.
          </div>
        )}
      </div>

      <PumpCurveStep
        systemCurve={systemCurve}
        staticHeadM={draft.hydraulicsResult?.static_head_m}
        designFlowM3h={draft.hydraulicsResult?.design_Q_m3h}
        designTdhM={draft.hydraulicsResult?.tdh_m}
        onResult={handleResult}
      />
    </div>
  );
}
