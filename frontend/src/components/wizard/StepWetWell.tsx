import ClearWellStep from "../ClearWellStep";
import { useProject } from "../../contexts/ProjectContext";
import { DEFAULT_CLEARWELL_CONFIG } from "../../types/project";
import type { ClearwellFormConfig } from "../../types/project";

export default function StepWetWell() {
  const { draft, dispatch } = useProject();

  const handleConfigChange = (cfg: ClearwellFormConfig) => {
    dispatch({ type: "SET_CLEARWELL_CONFIG", config: cfg });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Wet Well Sizing</h2>
        <p className="text-xs text-slate-500">
          Size the wet well (clear well) storage volume based on pump cycling requirements
          and minimum detention time. All parameters are independent of the pipeline steps.
        </p>
      </div>
      <ClearWellStep
        initialConfig={draft.clearwellConfig ?? DEFAULT_CLEARWELL_CONFIG}
        onConfigChange={handleConfigChange}
      />
    </div>
  );
}
