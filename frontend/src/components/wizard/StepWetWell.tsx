import ClearWellStep from "../ClearWellStep";
import { useProject } from "../../contexts/ProjectContext";
import { DEFAULT_CLEARWELL_CONFIG } from "../../types/project";
import type { ClearwellFormConfig } from "../../types/project";
import type { ClearWellResponse } from "../../utils/api";

export default function StepWetWell() {
  const { draft, dispatch } = useProject();

  const handleConfigChange = (cfg: ClearwellFormConfig) => {
    dispatch({ type: "SET_CLEARWELL_CONFIG", config: cfg });
  };

  const handleComputeResult = (result: ClearWellResponse) => {
    dispatch({ type: "SET_CLEARWELL_RESULT", result });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Clear Well Sizing</h2>
        <p className="text-xs text-slate-500">
          Size the clear well storage volume based on pump cycling requirements
          and minimum detention time. All parameters are independent of the pipeline steps.
        </p>
      </div>
      <ClearWellStep
        initialConfig={draft.clearwellConfig ?? DEFAULT_CLEARWELL_CONFIG}
        onConfigChange={handleConfigChange}
        onComputeResult={handleComputeResult}
      />
    </div>
  );
}
