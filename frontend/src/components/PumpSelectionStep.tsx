import { useState, useEffect } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  fetchPumpTypes,
  computePumpSelection,
  type PumpTypeInfo,
  type PumpSelectionRequest,
  type PumpSelectionResponse,
} from "../utils/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepState = "active" | "bypassed" | "disabled";
type ControlMode = "constant_speed" | "vfd";

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const formSchema = z.object({
  pump_type_key: z.string().min(1, "Select a pump type"),
  control_mode: z.enum(["constant_speed", "vfd"]),
  n_duty: z.number().int().min(1, "At least 1 duty pump"),
  n_standby: z.number().int().min(0),
  // Vertical turbine extras
  vt_bowl_model: z.string().optional(),
  vt_bowl_count: z.number().int().min(1).optional(),
  vt_column_length_m: z.number().positive().optional(),
  vt_min_submergence_m: z.number().min(0).optional(),
  vt_bowl_efficiency_pct: z.number().min(1).max(100).optional(),
  // Submersible extras
  sub_installation_depth_m: z.number().positive().optional(),
  sub_motor_cooling: z.enum(["fluid_cooled", "shroud", "air", "none"]).optional(),
  sub_min_flow_cooling_m3h: z.number().positive().optional(),
  // Booster extras
  boost_setpoint_pressure_kPa: z.number().positive().optional(),
  boost_num_pumps_in_set: z.number().int().min(1).optional(),
  boost_vfd_equipped: z.boolean().optional(),
  // PD pump extras
  pd_displacement_L_per_rev: z.number().positive().optional(),
  pd_max_pressure_kPa: z.number().positive().optional(),
  pd_pulsation_dampener: z.boolean().optional(),
  // Fire pump extras
  fp_nfpa20_compliance: z.boolean().optional(),
});

type FormValues = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// Styling constants
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const labelCls =
  "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";
const errCls = "mt-0.5 text-xs text-red-600";

const POTABLE_TAG_STYLES: Record<string, string> = {
  recommended: "bg-emerald-100 text-emerald-800 border-emerald-300",
  conditional: "bg-amber-100 text-amber-800 border-amber-300",
  niche: "bg-rose-100 text-rose-800 border-rose-300",
};

const POTABLE_TAG_LABELS: Record<string, string> = {
  recommended: "Recommended",
  conditional: "Conditional",
  niche: "Niche",
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-1 mb-3">
      {children}
    </p>
  );
}

function FieldRow({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
      {error && <p className={errCls}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type-picker card
// ---------------------------------------------------------------------------

function TypeCard({
  pt,
  selected,
  onSelect,
}: {
  pt: PumpTypeInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`text-left rounded-lg border p-3 transition-all cursor-pointer ${
        selected
          ? "border-teal-600 bg-teal-50 ring-1 ring-teal-400"
          : "border-slate-200 bg-white hover:border-teal-300 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-sm font-semibold text-slate-800 leading-tight">
          {pt.display_name}
        </span>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            POTABLE_TAG_STYLES[pt.potable_tag]
          }`}
        >
          {POTABLE_TAG_LABELS[pt.potable_tag]}
        </span>
      </div>
      <p className="text-xs text-slate-500 leading-snug line-clamp-2">
        {pt.description}
      </p>
      <div className="mt-2 flex gap-3 text-[10px] font-mono text-slate-400">
        <span>
          H: {pt.typical_head_range_m.min}–{pt.typical_head_range_m.max} m
        </span>
        <span>
          Q: {pt.typical_flow_range_m3h.min}–{pt.typical_flow_range_m3h.max} m³/h
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Extras form sections (rendered conditionally)
// ---------------------------------------------------------------------------

function VerticalTurbineForm({
  register,
  errors,
}: {
  register: ReturnType<typeof useForm<FormValues>>["register"];
  errors: ReturnType<typeof useForm<FormValues>>["formState"]["errors"];
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldRow label="Bowl Count" error={errors.vt_bowl_count?.message}>
        <input
          {...register("vt_bowl_count", { valueAsNumber: true })}
          type="number" step="1" min="1" className={inputCls}
        />
      </FieldRow>
      <FieldRow label="Column Length (m)" error={errors.vt_column_length_m?.message}>
        <div className="relative">
          <input {...register("vt_column_length_m", { valueAsNumber: true })} type="number" step="0.5" min="0.1" className={inputCls} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">m</span>
        </div>
      </FieldRow>
      <FieldRow label="Min. Bowl Submergence (m)" error={errors.vt_min_submergence_m?.message}>
        <div className="relative">
          <input {...register("vt_min_submergence_m", { valueAsNumber: true })} type="number" step="0.1" min="0" className={inputCls} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">m</span>
        </div>
      </FieldRow>
      <FieldRow label="Bowl Efficiency (%) — optional" error={errors.vt_bowl_efficiency_pct?.message}>
        <div className="relative">
          <input {...register("vt_bowl_efficiency_pct", { valueAsNumber: true })} type="number" step="0.5" min="1" max="100" placeholder="—" className={inputCls} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">%</span>
        </div>
      </FieldRow>
      <div className="col-span-2">
        <FieldRow label="Bowl Model — optional" error={undefined}>
          <input {...register("vt_bowl_model")} type="text" placeholder="e.g. Flowserve VTP-14" className={inputCls} />
        </FieldRow>
      </div>
    </div>
  );
}

function SubmersibleForm({
  register,
  errors,
}: {
  register: ReturnType<typeof useForm<FormValues>>["register"];
  errors: ReturnType<typeof useForm<FormValues>>["formState"]["errors"];
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldRow label="Installation Depth (m)" error={errors.sub_installation_depth_m?.message}>
        <div className="relative">
          <input {...register("sub_installation_depth_m", { valueAsNumber: true })} type="number" step="0.5" min="0.1" className={inputCls} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">m</span>
        </div>
      </FieldRow>
      <FieldRow label="Motor Cooling" error={undefined}>
        <select {...register("sub_motor_cooling")} className={inputCls}>
          <option value="fluid_cooled">Fluid-cooled (through-flow)</option>
          <option value="shroud">Cooling shroud</option>
          <option value="air">Air-cooled (dry-pit)</option>
          <option value="none">None</option>
        </select>
      </FieldRow>
      <div className="col-span-2">
        <FieldRow label="Min. Cooling Flow (m³/h) — optional" error={errors.sub_min_flow_cooling_m3h?.message}>
          <div className="relative">
            <input {...register("sub_min_flow_cooling_m3h", { valueAsNumber: true })} type="number" step="0.5" min="0" placeholder="From data sheet" className={inputCls} />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">m³/h</span>
          </div>
        </FieldRow>
      </div>
    </div>
  );
}

function BoosterForm({
  register,
  errors,
}: {
  register: ReturnType<typeof useForm<FormValues>>["register"];
  errors: ReturnType<typeof useForm<FormValues>>["formState"]["errors"];
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldRow label="Setpoint Pressure (kPa)" error={errors.boost_setpoint_pressure_kPa?.message}>
        <div className="relative">
          <input {...register("boost_setpoint_pressure_kPa", { valueAsNumber: true })} type="number" step="10" min="1" className={inputCls} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">kPa</span>
        </div>
      </FieldRow>
      <FieldRow label="Pumps in Set" error={errors.boost_num_pumps_in_set?.message}>
        <input {...register("boost_num_pumps_in_set", { valueAsNumber: true })} type="number" step="1" min="1" className={inputCls} />
      </FieldRow>
      <div className="col-span-2 flex items-center gap-2">
        <input {...register("boost_vfd_equipped")} type="checkbox" id="boost_vfd" className="h-4 w-4 rounded border-slate-300 text-teal-600" />
        <label htmlFor="boost_vfd" className="text-sm text-slate-700">VFD-equipped booster set</label>
      </div>
    </div>
  );
}

function PDPumpForm({
  register,
  errors,
}: {
  register: ReturnType<typeof useForm<FormValues>>["register"];
  errors: ReturnType<typeof useForm<FormValues>>["formState"]["errors"];
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FieldRow label="Displacement (L/rev)" error={errors.pd_displacement_L_per_rev?.message}>
        <div className="relative">
          <input {...register("pd_displacement_L_per_rev", { valueAsNumber: true })} type="number" step="0.1" min="0.001" className={inputCls} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">L/rev</span>
        </div>
      </FieldRow>
      <FieldRow label="Max Rated Pressure (kPa)" error={errors.pd_max_pressure_kPa?.message}>
        <div className="relative">
          <input {...register("pd_max_pressure_kPa", { valueAsNumber: true })} type="number" step="50" min="1" className={inputCls} />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">kPa</span>
        </div>
      </FieldRow>
      <div className="col-span-2 flex items-center gap-2">
        <input {...register("pd_pulsation_dampener")} type="checkbox" id="pd_dampener" className="h-4 w-4 rounded border-slate-300 text-teal-600" />
        <label htmlFor="pd_dampener" className="text-sm text-slate-700">Pulsation dampener specified on discharge</label>
      </div>
    </div>
  );
}

function FirePumpForm({
  register,
}: {
  register: ReturnType<typeof useForm<FormValues>>["register"];
}) {
  return (
    <div className="flex items-center gap-2">
      <input {...register("fp_nfpa20_compliance")} type="checkbox" id="fp_nfpa20" className="h-4 w-4 rounded border-slate-300 text-teal-600" />
      <label htmlFor="fp_nfpa20" className="text-sm text-slate-700 font-medium">
        Pump is listed and labeled per NFPA 20
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PumpSelectionStep() {
  const [stepState, setStepState] = useState<StepState>("active");
  const [pumpTypes, setPumpTypes] = useState<PumpTypeInfo[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [selectedType, setSelectedType] = useState<PumpTypeInfo | null>(null);
  const [result, setResult] = useState<PumpSelectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [familyFilter, setFamilyFilter] = useState<string>("all");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pump_type_key: "",
      control_mode: "constant_speed",
      n_duty: 1,
      n_standby: 1,
      vt_bowl_count: 4,
      vt_column_length_m: 10.0,
      vt_min_submergence_m: 1.0,
      sub_installation_depth_m: 5.0,
      sub_motor_cooling: "fluid_cooled",
      boost_setpoint_pressure_kPa: 500.0,
      boost_num_pumps_in_set: 2,
      boost_vfd_equipped: true,
      pd_displacement_L_per_rev: 1.0,
      pd_max_pressure_kPa: 700.0,
      pd_pulsation_dampener: false,
      fp_nfpa20_compliance: false,
    },
  });

  const watchControlMode = watch("control_mode") as ControlMode;

  useEffect(() => {
    fetchPumpTypes()
      .then((data) => setPumpTypes(data.pump_types))
      .catch(() => setPumpTypes([]))
      .finally(() => setLoadingTypes(false));
  }, []);

  const families = ["all", ...Array.from(new Set(pumpTypes.map((p) => p.family))).sort()];

  const filteredTypes =
    familyFilter === "all"
      ? pumpTypes
      : pumpTypes.filter((p) => p.family === familyFilter);

  const handleSelectType = (pt: PumpTypeInfo) => {
    setSelectedType(pt);
    setValue("pump_type_key", pt.key);
    setResult(null);
    setApiError(null);
  };

  const buildExtras = (values: FormValues, extrasSchema: string | null) => {
    if (!extrasSchema) return undefined;
    switch (extrasSchema) {
      case "vertical_turbine":
        return {
          bowl_model: values.vt_bowl_model || undefined,
          bowl_count: values.vt_bowl_count ?? 1,
          column_length_m: values.vt_column_length_m ?? 10,
          min_submergence_m: values.vt_min_submergence_m ?? 1,
          bowl_efficiency_pct: values.vt_bowl_efficiency_pct || undefined,
        };
      case "submersible":
        return {
          installation_depth_m: values.sub_installation_depth_m ?? 5,
          motor_cooling: values.sub_motor_cooling ?? "fluid_cooled",
          min_flow_cooling_m3h: values.sub_min_flow_cooling_m3h || undefined,
        };
      case "booster_set":
        return {
          setpoint_pressure_kPa: values.boost_setpoint_pressure_kPa ?? 500,
          num_pumps_in_set: values.boost_num_pumps_in_set ?? 2,
          vfd_equipped: values.boost_vfd_equipped ?? false,
        };
      case "pd_pump":
        return {
          displacement_L_per_rev: values.pd_displacement_L_per_rev ?? 1,
          max_pressure_kPa: values.pd_max_pressure_kPa ?? 700,
          pulsation_dampener: values.pd_pulsation_dampener ?? false,
        };
      case "fire_pump":
        return {
          nfpa20_compliance: values.fp_nfpa20_compliance ?? false,
        };
      default:
        return undefined;
    }
  };

  const submit: SubmitHandler<FormValues> = async (values) => {
    setLoading(true);
    setApiError(null);
    try {
      const extras = buildExtras(values, selectedType?.extras_schema ?? null);
      const req: PumpSelectionRequest = {
        active: true,
        pump_type_key: values.pump_type_key,
        control_mode: values.control_mode,
        n_duty: values.n_duty,
        n_standby: values.n_standby,
        extras: extras ?? null,
      };
      const data = await computePumpSelection(req);
      setResult(data);
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

  const FAMILY_LABELS: Record<string, string> = {
    all: "All Families",
    centrifugal: "Centrifugal",
    vertical_turbine: "Vertical Turbine",
    booster: "Booster",
    submersible: "Submersible",
    axial_flow: "Axial / Mixed Flow",
    positive_displacement: "Positive Displacement",
    fire_pump: "Fire Pump",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* ---- Step header ---- */}
      <div className="flex items-center justify-between bg-teal-700 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-sm tracking-wide">
            PUMP TYPE SELECTION
          </span>
          <button
            type="button"
            onClick={() => setShowInfo((v) => !v)}
            className="flex items-center justify-center h-5 w-5 rounded-full bg-teal-600 text-white text-xs font-bold hover:bg-teal-500 transition-colors"
            title="About pump type selection"
          >
            i
          </button>
        </div>
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
          <p className="font-semibold">Pump Type Selection</p>
          <p>
            Choose the appropriate pump type for your municipal drinking-water station.
            Types are classified by potable suitability:
          </p>
          <ul className="list-disc list-inside space-y-0.5 ml-1">
            <li><strong>Recommended</strong> — Standard first choice; well-established for potable service.</li>
            <li><strong>Conditional</strong> — Acceptable with specific constraints documented in notes.</li>
            <li><strong>Niche</strong> — Unusual for municipal potable; verify with project engineer.</li>
          </ul>
          <p className="text-blue-600 mt-1">
            All wetted materials must comply with NSF/ANSI 61 and NSF/ANSI 372 (lead content).
          </p>
        </div>
      )}

      {/* ---- Disabled / Bypassed notices ---- */}
      {stepState === "disabled" && (
        <div className="px-5 py-4 text-sm text-slate-500 italic bg-slate-50">
          Pump type selection is disabled — it will not appear in design results.
          Use the toggle above to re-enable it.
        </div>
      )}
      {stepState === "bypassed" && (
        <div className="px-5 py-4 text-sm text-slate-500 italic bg-slate-50">
          Pump type selection is bypassed — use the toggle above to activate it.
        </div>
      )}

      {/* ---- Active: form + results ---- */}
      {stepState === "active" && (
        <div className="p-5 space-y-6">
          <form onSubmit={handleSubmit(submit)} className="space-y-6">

            {/* ---- Type-picker ---- */}
            <div>
              <SectionHeader>Select Pump Type</SectionHeader>

              {/* Family filter tabs */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {families.map((fam) => (
                  <button
                    key={fam}
                    type="button"
                    onClick={() => setFamilyFilter(fam)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      familyFilter === fam
                        ? "bg-teal-700 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {FAMILY_LABELS[fam] ?? fam}
                  </button>
                ))}
              </div>

              {loadingTypes ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  Loading pump catalogue…
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {filteredTypes.map((pt) => (
                    <TypeCard
                      key={pt.key}
                      pt={pt}
                      selected={selectedType?.key === pt.key}
                      onSelect={() => handleSelectType(pt)}
                    />
                  ))}
                </div>
              )}
              {errors.pump_type_key && (
                <p className={errCls}>{errors.pump_type_key.message}</p>
              )}
            </div>

            {/* ---- Configuration ---- */}
            <div>
              <SectionHeader>Configuration</SectionHeader>
              <div className="grid grid-cols-3 gap-3">
                <FieldRow label="Duty Pumps" error={errors.n_duty?.message}>
                  <input {...register("n_duty", { valueAsNumber: true })} type="number" step="1" min="1" className={inputCls} />
                </FieldRow>
                <FieldRow label="Standby Pumps" error={errors.n_standby?.message}>
                  <input {...register("n_standby", { valueAsNumber: true })} type="number" step="1" min="0" className={inputCls} />
                </FieldRow>
                <FieldRow label="Speed Control" error={undefined}>
                  <select {...register("control_mode")} className={inputCls}>
                    <option value="constant_speed">Constant speed (DOL/soft-start)</option>
                    <option value="vfd">Variable frequency drive (VFD)</option>
                  </select>
                </FieldRow>
              </div>
              {watchControlMode === "constant_speed" && (
                <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                  Constant-speed pumps cycle between on/off — verify operating volume in the Clear Well step to limit starts per hour.
                </p>
              )}
            </div>

            {/* ---- Type-specific extras ---- */}
            {selectedType?.extras_schema && (
              <div>
                <SectionHeader>
                  {selectedType.display_name} — Additional Parameters
                </SectionHeader>
                {selectedType.extras_schema === "vertical_turbine" && (
                  <VerticalTurbineForm register={register} errors={errors} />
                )}
                {selectedType.extras_schema === "submersible" && (
                  <SubmersibleForm register={register} errors={errors} />
                )}
                {selectedType.extras_schema === "booster_set" && (
                  <BoosterForm register={register} errors={errors} />
                )}
                {selectedType.extras_schema === "pd_pump" && (
                  <PDPumpForm register={register} errors={errors} />
                )}
                {selectedType.extras_schema === "fire_pump" && (
                  <FirePumpForm register={register} />
                )}
              </div>
            )}

            {/* ---- Constraints panel (auto-show when type selected) ---- */}
            {selectedType && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Engineering Constraints
                </p>
                <ul className="space-y-1">
                  {selectedType.constraints.map((c, i) => (
                    <li key={i} className="flex gap-2 text-xs text-slate-600">
                      <span className="mt-0.5 shrink-0 h-1.5 w-1.5 rounded-full bg-slate-400" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !selectedType}
              className="w-full rounded-lg bg-teal-700 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Analysing…" : "Confirm Pump Selection"}
            </button>
          </form>

          {/* ---- API Error ---- */}
          {apiError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              <span className="font-semibold">Error: </span>
              {apiError}
            </div>
          )}

          {/* ---- Results ---- */}
          {result && result.active && result.type_info && (
            <div className="space-y-4">
              <div className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide ${
                      POTABLE_TAG_STYLES[result.type_info.potable_tag]
                    }`}
                  >
                    {POTABLE_TAG_LABELS[result.type_info.potable_tag]}
                  </span>
                  <span className="text-sm font-semibold text-slate-800">
                    {result.type_info.display_name}
                  </span>
                  {result.config_summary && (
                    <span className="ml-auto text-xs font-mono text-slate-500">
                      {result.config_summary}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600">{result.type_info.description}</p>
              </div>

              {result.potable_notes.length > 0 && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-2">
                    Potable-Water Compliance Notes
                  </p>
                  <ul className="space-y-1.5">
                    {result.potable_notes.map((note, i) => (
                      <li key={i} className="flex gap-2 text-xs text-blue-800">
                        <span className="mt-0.5 shrink-0 text-blue-400">▸</span>
                        {note}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-2">
                    Warnings
                  </p>
                  <ul className="space-y-1.5">
                    {result.warnings.map((w, i) => (
                      <li key={i} className="flex gap-2 text-xs text-amber-800">
                        <span className="mt-0.5 shrink-0">⚠</span>
                        {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
