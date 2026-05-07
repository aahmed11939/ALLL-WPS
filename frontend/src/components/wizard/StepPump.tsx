import PumpSelectionStep from "../PumpSelectionStep";

export default function StepPump() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Pump Selection</h2>
        <p className="text-xs text-slate-500">
          Choose a pump type and configuration. Pump type selection feeds into the
          pump curve analysis in the next step.
        </p>
      </div>
      <PumpSelectionStep />
    </div>
  );
}
