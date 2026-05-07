import { useState, useEffect, useRef } from "react";
import { useForm, useFieldArray, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  computeClearWell,
  type ClearWellRequest,
  type ClearWellResponse,
} from "../utils/api";
import ClearWellDiagram from "./ClearWellDiagram";

// ---------------------------------------------------------------------------
// Zod schema for the form
// ---------------------------------------------------------------------------

const hourlySchema = z.object({ Q: z.number().min(0, "Must be ≥ 0") });

const formSchema = z.object({
  shape: z.enum(["cylindrical", "rectangular"]),
  diameter_m: z.number().positive().optional(),
  length_m: z.number().positive().optional(),
  width_m: z.number().positive().optional(),
  LLL_m: z.number(),
  LWL_m: z.number(),
  HWL_m: z.number(),
  HHL_m: z.number(),
  pump_stages: z
    .array(
      z.object({
        stage: z.number().int().min(1),
        Q_pump_m3h: z.number().positive("Pump flow must be > 0"),
        label: z.string(),
      })
    )
    .min(1, "Add at least one pump stage"),
  inflow_type: z.enum(["constant", "hourly_24"]),
  Q_in_m3h: z.number().positive().optional(),
  hourly_Q: z.array(hourlySchema).length(24),
  max_cycles_per_hour: z.number().int().min(1).max(30),
  required_detention_min: z.number().min(0),
});

type FormValues = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// Step state
// ---------------------------------------------------------------------------

type StepState = "active" | "bypassed" | "disabled";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const labelCls =
  "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";
const errCls = "mt-0.5 text-xs text-red-600";

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-1 mb-3">
      {children}
    </p>
  );
}

const DEFAULT_HOURLY = Array(24).fill({ Q: 36 });

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface ClearWellStepProps {
  /** Seeds the form on first mount. Re-mount (new key) to apply a fresh project. */
  initialConfig?: Partial<FormValues>;
  /** Called (debounced 600 ms) whenever any form value changes. */
  onConfigChange?: (cfg: FormValues) => void;
  /** Called when a successful compute result is available. Used to cache the result in ProjectDraft. */
  onComputeResult?: (result: ClearWellResponse) => void;
}

const BUILT_IN_DEFAULTS: FormValues = {
  shape: "cylindrical",
  diameter_m: 5.0,
  LLL_m: 0.30,
  LWL_m: 0.80,
  HWL_m: 2.50,
  HHL_m: 3.00,
  pump_stages: [{ stage: 1, Q_pump_m3h: 72.0, label: "Duty" }],
  inflow_type: "constant",
  Q_in_m3h: 36.0,
  hourly_Q: DEFAULT_HOURLY,
  max_cycles_per_hour: 6,
  required_detention_min: 0,
};

export default function ClearWellStep({ initialConfig, onConfigChange, onComputeResult }: ClearWellStepProps = {}) {
  const [stepState, setStepState] = useState<StepState>("active");
  const [result, setResult] = useState<ClearWellResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialConfig ? { ...BUILT_IN_DEFAULTS, ...initialConfig } : BUILT_IN_DEFAULTS,
  });

  // Propagate form changes to parent so ProjectDraft stays in sync (debounced)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const subscription = watch((values) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onConfigChange?.(values as FormValues);
      }, 600);
    });
    return () => {
      subscription.unsubscribe();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [watch, onConfigChange]);

  const watchShape = watch("shape");
  const watchInflowType = watch("inflow_type");

  // Live-watch all diagram-relevant fields
  const watchDiameter = watch("diameter_m");
  const watchLength = watch("length_m");
  const watchWidth = watch("width_m");
  const watchLLL = watch("LLL_m");
  const watchLWL = watch("LWL_m");
  const watchHWL = watch("HWL_m");
  const watchHHL = watch("HHL_m");
  const watchStages = watch("pump_stages");
  const watchMaxCycles = watch("max_cycles_per_hour");

  const { fields: stageFields, append: appendStage, remove: removeStage } =
    useFieldArray({ control, name: "pump_stages" });

  const { fields: hourlyFields } = useFieldArray({ control, name: "hourly_Q" });

  const submit: SubmitHandler<FormValues> = async (values) => {
    setLoading(true);
    setApiError(null);
    try {
      let inflow: ClearWellRequest["inflow"];
      if (values.inflow_type === "constant") {
        inflow = { type: "constant", Q_in_m3h: values.Q_in_m3h ?? 0 };
      } else {
        inflow = {
          type: "hourly_24",
          hourly_Q_m3h: values.hourly_Q.map((h) => h.Q),
        };
      }

      const req: ClearWellRequest = {
        active: true,
        geometry: {
          shape: values.shape,
          diameter_m: values.shape === "cylindrical" ? values.diameter_m : undefined,
          length_m: values.shape === "rectangular" ? values.length_m : undefined,
          width_m: values.shape === "rectangular" ? values.width_m : undefined,
        },
        levels: {
          LLL_m: values.LLL_m,
          LWL_m: values.LWL_m,
          HWL_m: values.HWL_m,
          HHL_m: values.HHL_m,
        },
        pump_stages: values.pump_stages,
        inflow,
        max_cycles_per_hour: values.max_cycles_per_hour,
        required_detention_min: values.required_detention_min,
      };

      const data = await computeClearWell(req);
      setResult(data);
      onComputeResult?.(data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string } } })?.response?.data
          ?.detail ?? "Unexpected error — check console.";
      setApiError(typeof msg === "string" ? msg : JSON.stringify(msg));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render — always render the container so the toggle is always visible
  // ---------------------------------------------------------------------------

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* ---- Step header — always visible ---- */}
      <div className="flex items-center justify-between bg-teal-700 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm tracking-wide">
            CLEAR WELL SIZING
          </span>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className="flex items-center justify-center h-5 w-5 rounded-full bg-teal-600 text-white text-xs font-bold hover:bg-teal-500 transition-colors"
            title="What is a clear well?"
          >
            i
          </button>
        </div>

        {/* 3-state toggle — always visible */}
        <div className="flex rounded overflow-hidden border border-teal-500 text-xs font-semibold">
          {(["active", "bypassed", "disabled"] as StepState[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStepState(s)}
              className={`px-3 py-1 capitalize transition-colors ${
                stepState === s
                  ? "bg-white text-teal-800"
                  : "bg-transparent text-teal-100 hover:bg-teal-600"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* ---- Info panel ---- */}
      {showInfo && (
        <div className="bg-blue-50 border-b border-blue-200 px-5 py-3 text-xs text-blue-800 space-y-1">
          <p className="font-semibold">What is a clear well?</p>
          <p>
            A clear well is a finished-water storage reservoir located between
            the treatment process and the distribution pump station. It serves
            three functions:
          </p>
          <ol className="list-decimal list-inside space-y-0.5 ml-1">
            <li>Buffers supply/demand imbalances.</li>
            <li>
              Provides chlorine contact time (CT) required by the Surface Water
              Treatment Rule (SWTR).
            </li>
            <li>
              Supplies firm pump capacity during peak demand or emergency.
            </li>
          </ol>
          <p className="text-blue-600 mt-1">
            Sizing formula (AWWA M32): V<sub>req</sub> = Q<sub>pump</sub> ×
            900 / n<sub>max</sub>
          </p>
        </div>
      )}

      {/* ---- Disabled notice ---- */}
      {stepState === "disabled" && (
        <div className="px-5 py-4 text-sm text-slate-500 italic bg-slate-50">
          Clear well step is disabled — it will not appear in design results.
          Use the toggle above to re-enable it.
        </div>
      )}

      {/* ---- Bypassed notice ---- */}
      {stepState === "bypassed" && (
        <div className="px-5 py-4 text-sm text-slate-500 italic bg-slate-50">
          Clear well step is bypassed — results will not include clear well
          sizing. Use the toggle above to activate it.
        </div>
      )}

      {/* ---- Active: form + results ---- */}
      {stepState === "active" && (
        <div className="p-5 space-y-6">
          {/* Two-column layout: form left, live diagram right */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-6 items-start">
          {/* ---- Form column ---- */}
          <div>
          <form onSubmit={handleSubmit(submit)} className="space-y-6">
            {/* ---- Geometry ---- */}
            <div>
              <SectionHeader>Geometry</SectionHeader>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={labelCls}>Shape</label>
                  <select {...register("shape")} className={inputCls}>
                    <option value="cylindrical">Cylindrical (circular tank)</option>
                    <option value="rectangular">Rectangular (basin)</option>
                  </select>
                </div>
                {watchShape === "cylindrical" ? (
                  <div>
                    <label className={labelCls}>Internal Diameter (m)</label>
                    <div className="relative">
                      <input
                        {...register("diameter_m", { valueAsNumber: true })}
                        type="number"
                        step="0.1"
                        className={inputCls}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                        m
                      </span>
                    </div>
                    {errors.diameter_m && (
                      <p className={errCls}>{errors.diameter_m.message}</p>
                    )}
                  </div>
                ) : (
                  <>
                    <div>
                      <label className={labelCls}>Length (m)</label>
                      <div className="relative">
                        <input
                          {...register("length_m", { valueAsNumber: true })}
                          type="number"
                          step="0.1"
                          className={inputCls}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                          m
                        </span>
                      </div>
                      {errors.length_m && (
                        <p className={errCls}>{errors.length_m.message}</p>
                      )}
                    </div>
                    <div>
                      <label className={labelCls}>Width (m)</label>
                      <div className="relative">
                        <input
                          {...register("width_m", { valueAsNumber: true })}
                          type="number"
                          step="0.1"
                          className={inputCls}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                          m
                        </span>
                      </div>
                      {errors.width_m && (
                        <p className={errCls}>{errors.width_m.message}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ---- Operating levels ---- */}
            <div>
              <SectionHeader>Operating Levels (m above datum)</SectionHeader>
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["LLL_m", "LLL — Low-Low Level (dry-run trip)"],
                    ["LWL_m", "LWL — Pump Start (on)"],
                    ["HWL_m", "HWL — Pump Stop (off)"],
                    ["HHL_m", "HHL — High-High (overflow alarm)"],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <label className={labelCls}>{label}</label>
                    <div className="relative">
                      <input
                        {...register(field, { valueAsNumber: true })}
                        type="number"
                        step="0.05"
                        className={inputCls}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                        m
                      </span>
                    </div>
                    {errors[field] && (
                      <p className={errCls}>{errors[field]?.message}</p>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-400 font-mono">
                Required order: LLL &lt; LWL &lt; HWL &lt; HHL
              </p>
            </div>

            {/* ---- Pump stages ---- */}
            <div>
              <SectionHeader>Pump Staging</SectionHeader>
              <div className="space-y-2">
                {stageFields.map((field, i) => (
                  <div key={field.id} className="flex items-center gap-2">
                    <span className="text-xs text-slate-400 w-5 text-right">
                      {i + 1}.
                    </span>
                    <div className="flex-1">
                      <input
                        {...register(`pump_stages.${i}.label`)}
                        type="text"
                        placeholder="Label (e.g. Duty)"
                        className={inputCls}
                      />
                    </div>
                    <div className="flex-1">
                      <div className="relative">
                        <input
                          {...register(`pump_stages.${i}.Q_pump_m3h`, {
                            valueAsNumber: true,
                          })}
                          type="number"
                          step="1"
                          placeholder="Flow"
                          className={inputCls}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                          m³/h
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeStage(i)}
                      disabled={stageFields.length === 1}
                      className="text-slate-400 hover:text-red-500 transition-colors text-lg leading-none px-1 disabled:opacity-30"
                      title="Remove stage"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  appendStage({
                    stage: stageFields.length + 1,
                    Q_pump_m3h: 72.0,
                    label: `Stage ${stageFields.length + 1}`,
                  })
                }
                className="mt-2 text-xs text-teal-700 font-semibold hover:text-teal-900 transition-colors"
              >
                + Add staging level
              </button>
              {errors.pump_stages && (
                <p className={errCls}>{errors.pump_stages.message}</p>
              )}
            </div>

            {/* ---- Inflow profile ---- */}
            <div>
              <SectionHeader>Inflow Profile</SectionHeader>
              <div className="mb-3">
                <label className={labelCls}>Inflow Type</label>
                <select {...register("inflow_type")} className={inputCls}>
                  <option value="constant">Constant rate</option>
                  <option value="hourly_24">24-hour hourly table</option>
                </select>
              </div>

              {watchInflowType === "constant" ? (
                <div>
                  <label className={labelCls}>Constant Inflow Q_in</label>
                  <div className="relative">
                    <input
                      {...register("Q_in_m3h", { valueAsNumber: true })}
                      type="number"
                      step="0.5"
                      className={inputCls}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                      m³/h
                    </span>
                  </div>
                  {errors.Q_in_m3h && (
                    <p className={errCls}>{errors.Q_in_m3h.message}</p>
                  )}
                </div>
              ) : (
                <div>
                  <label className={labelCls}>Hourly Inflow — 24 values (m³/h)</label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {hourlyFields.map((field, i) => (
                      <div key={field.id} className="flex flex-col gap-0.5">
                        <span className="text-center text-[10px] font-mono text-slate-400">
                          {String(i).padStart(2, "0")}h
                        </span>
                        <input
                          {...register(`hourly_Q.${i}.Q`, {
                            valueAsNumber: true,
                          })}
                          type="number"
                          step="0.5"
                          min="0"
                          className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 text-center"
                        />
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    Cycle analysis uses the maximum hour; detention time uses the daily average.
                  </p>
                </div>
              )}
            </div>

            {/* ---- Design limits ---- */}
            <div>
              <SectionHeader>Design Limits</SectionHeader>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Max Cycles / Hour</label>
                  <div className="relative">
                    <input
                      {...register("max_cycles_per_hour", {
                        valueAsNumber: true,
                      })}
                      type="number"
                      step="1"
                      min="1"
                      max="30"
                      className={inputCls}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                      starts/h
                    </span>
                  </div>
                  {errors.max_cycles_per_hour && (
                    <p className={errCls}>{errors.max_cycles_per_hour.message}</p>
                  )}
                  <p className="mt-0.5 text-xs text-slate-400">
                    Typical: 4–6 (motor thermal limit)
                  </p>
                </div>
                <div>
                  <label className={labelCls}>Required Detention Time</label>
                  <div className="relative">
                    <input
                      {...register("required_detention_min", {
                        valueAsNumber: true,
                      })}
                      type="number"
                      step="1"
                      min="0"
                      className={inputCls}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                      min
                    </span>
                  </div>
                  {errors.required_detention_min && (
                    <p className={errCls}>
                      {errors.required_detention_min.message}
                    </p>
                  )}
                  <p className="mt-0.5 text-xs text-slate-400">0 = skip CT check</p>
                </div>
              </div>
            </div>

            {/* ---- Submit ---- */}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded bg-teal-700 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "Computing…" : "Compute Clear Well Sizing"}
            </button>
          </form>
          </div>{/* end form column */}

          {/* ---- Diagram column (sticky, updates live) ---- */}
          <div className="xl:sticky xl:top-4">
            <ClearWellDiagram
              shape={watchShape}
              diameter_m={watchDiameter}
              length_m={watchLength}
              width_m={watchWidth}
              LLL_m={watchLLL}
              LWL_m={watchLWL}
              HWL_m={watchHWL}
              HHL_m={watchHHL}
              pump_stages={watchStages ?? []}
              max_cycles_per_hour={watchMaxCycles ?? 6}
            />
          </div>

          </div>{/* end two-column grid */}

          {/* ---- API error ---- */}
          {apiError && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              <strong>Error:</strong> {apiError}
            </div>
          )}

          {/* ====== Results ====== */}
          {result && result.active && (
            <div className="space-y-4 pt-2 border-t border-slate-200">

              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-teal-300 bg-teal-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 mb-1">
                    Operating Volume
                  </p>
                  <p className="font-mono text-2xl font-bold text-teal-800">
                    {result.operating_volume_m3?.toFixed(2)}
                    <span className="ml-1.5 text-sm font-normal text-teal-600">
                      m³
                    </span>
                  </p>
                  <p className="text-xs text-teal-600 mt-0.5">LWL → HWL</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Detention Time
                  </p>
                  <p className="font-mono text-2xl font-bold text-slate-800">
                    {result.detention_time_min != null
                      ? result.detention_time_min.toFixed(1)
                      : "—"}
                    <span className="ml-1.5 text-sm font-normal text-slate-500">
                      min
                    </span>
                  </p>
                  <p className="text-xs mt-0.5">
                    {result.detention_ok === true ? (
                      <span className="text-emerald-600">CT check passed</span>
                    ) : result.detention_ok === false ? (
                      <span className="text-amber-600">CT check failed</span>
                    ) : (
                      <span className="text-slate-400">Not required</span>
                    )}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Max Volume (HHL)
                  </p>
                  <p className="font-mono text-2xl font-bold text-slate-800">
                    {result.volume_curve.at(-1)?.volume_m3.toFixed(2) ?? "—"}
                    <span className="ml-1.5 text-sm font-normal text-slate-500">
                      m³
                    </span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">LLL to HHL</p>
                </div>
              </div>

              {/* Cycle analysis table */}
              {result.cycle_results.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 pt-3 pb-2">
                    Pump Cycle Analysis (AWWA M32)
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-t border-slate-200 bg-slate-50">
                        <th className="text-left py-1.5 px-4 font-semibold text-slate-600">
                          Stage
                        </th>
                        <th className="text-right py-1.5 pr-3 font-semibold text-slate-600">
                          Q pump (m³/h)
                        </th>
                        <th className="text-right py-1.5 pr-3 font-semibold text-slate-600">
                          Q in (m³/h)
                        </th>
                        <th className="text-right py-1.5 pr-3 font-semibold text-slate-600">
                          Cycles/h
                        </th>
                        <th className="text-right py-1.5 pr-3 font-semibold text-slate-600">
                          V req (m³)
                        </th>
                        <th className="text-center py-1.5 pr-4 font-semibold text-slate-600">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.cycle_results.map((cr) => (
                        <tr
                          key={cr.stage}
                          className="border-t border-slate-100"
                        >
                          <td className="py-1.5 px-4 font-mono text-slate-700">
                            {cr.label || `Stage ${cr.stage}`}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono text-slate-700">
                            {cr.Q_pump_m3h.toFixed(1)}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono text-slate-700">
                            {cr.Q_in_m3h.toFixed(1)}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono text-slate-700">
                            {cr.cycles_per_hour > 0
                              ? cr.cycles_per_hour.toFixed(2)
                              : "—"}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono text-slate-700">
                            {cr.V_req_m3.toFixed(2)}
                          </td>
                          <td className="py-1.5 pr-4 text-center">
                            {!cr.pump_can_drain ? (
                              <span className="inline-block rounded bg-red-100 text-red-700 text-xs px-2 py-0.5 font-semibold">
                                OVERLOAD
                              </span>
                            ) : cr.cycles_ok ? (
                              <span className="inline-block rounded bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 font-semibold">
                                OK
                              </span>
                            ) : (
                              <span className="inline-block rounded bg-amber-100 text-amber-700 text-xs px-2 py-0.5 font-semibold">
                                UNDER
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Volume curve table */}
              {result.volume_curve.length > 0 && (
                <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 pt-3 pb-2">
                    Volume vs. Level Curve (LLL → HHL)
                  </p>
                  <div className="overflow-y-auto max-h-56">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-slate-50 border-t border-slate-200">
                        <tr>
                          <th className="text-right py-1.5 px-4 font-semibold text-slate-600">
                            Level (m)
                          </th>
                          <th className="text-right py-1.5 pr-4 font-semibold text-slate-600">
                            Depth above LLL (m)
                          </th>
                          <th className="text-right py-1.5 pr-4 font-semibold text-slate-600">
                            Volume (m³)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.volume_curve.map((pt, i) => (
                          <tr
                            key={i}
                            className="border-t border-slate-100 odd:bg-white even:bg-slate-50"
                          >
                            <td className="py-1 px-4 text-right font-mono text-slate-700">
                              {pt.level_m.toFixed(3)}
                            </td>
                            <td className="py-1 pr-4 text-right font-mono text-slate-700">
                              {pt.depth_m.toFixed(3)}
                            </td>
                            <td className="py-1 pr-4 text-right font-mono text-slate-700">
                              {pt.volume_m3.toFixed(3)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 ? (
                <div className="space-y-2">
                  {result.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"
                    >
                      <span className="text-amber-500 font-bold mt-0.5 shrink-0">
                        ⚠
                      </span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  <span className="font-bold shrink-0">✓</span>
                  <span>All clear well sizing criteria satisfied.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
