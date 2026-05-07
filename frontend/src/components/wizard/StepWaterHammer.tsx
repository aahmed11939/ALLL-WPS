export default function StepWaterHammer() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold text-slate-800 mb-1">Water Hammer Analysis</h2>
        <p className="text-xs text-slate-500">
          Transient surge analysis using the Joukowsky equation to evaluate pressure rise
          on sudden pump trip and recommend surge protection devices.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-10 flex flex-col items-center justify-center text-center gap-3">
        <div className="h-12 w-12 rounded-full bg-amber-100 flex items-center justify-center">
          <svg
            className="h-6 w-6 text-amber-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <p className="text-sm font-semibold text-slate-700">Coming in Task #43</p>
        <p className="text-xs text-slate-400 max-w-sm">
          Joukowsky surge analysis, wave speed calculation, and surge protection
          recommendations will be available once Task #43 is complete.
        </p>
        <div className="rounded-lg bg-white border border-slate-200 px-4 py-3 text-left text-xs text-slate-500 mt-2 max-w-sm w-full space-y-1">
          <p className="font-semibold text-slate-600">Planned features:</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Joukowsky pressure rise: ΔH = a·ΔV/g</li>
            <li>Wave speed (a) for pipe materials</li>
            <li>Pump trip scenario analysis</li>
            <li>Surge tank / air vessel sizing</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
