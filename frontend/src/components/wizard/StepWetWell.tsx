import ClearWellStep from "../ClearWellStep";

export default function StepWetWell() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Wet Well Sizing</h2>
        <p className="text-xs text-slate-500">
          Size the wet well (clear well) storage volume based on pump cycling requirements
          and minimum detention time. All parameters are independent of the pipeline steps.
        </p>
      </div>
      <ClearWellStep />
    </div>
  );
}
