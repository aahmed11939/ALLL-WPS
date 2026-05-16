import { useState, useEffect, useCallback, useRef } from "react";
import {
  fetchPumpTypes,
  computePumpSelection,
  type PumpTypeInfo,
  type TypeSpecificField,
  type PumpSelectionRequest,
  type PumpSelectionResponse,
} from "../utils/api";
import FieldTip from "./FieldTip";
import { useUnitSystem } from "../contexts/UnitSystemContext";
import { GPM_PER_M3H, FT_PER_M, M_PER_FT, PSI_PER_KPA, KPA_PER_PSI } from "../utils/units";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StepState = "active" | "bypassed" | "disabled";
type ControlMode = "constant_speed" | "vfd" | "cascade";

// ---------------------------------------------------------------------------
// Styling constants
// ---------------------------------------------------------------------------

const inputCls =
  "w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-mono text-slate-800 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600";
const labelCls =
  "block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1";

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

const FAMILY_DISPLAY_LABELS: Record<string, string> = {
  centrifugal: "Centrifugal",
  vertical_turbine: "Vertical Turbine",
  booster: "Inline Booster / Booster Set",
  submersible: "Submersible",
  axial_flow: "Axial Flow / Mixed Flow",
  positive_displacement: "Positive Displacement",
  fire_pump: "Fire Pump",
};

// Preferred family display order
const FAMILY_ORDER = [
  "centrifugal",
  "vertical_turbine",
  "booster",
  "submersible",
  "axial_flow",
  "positive_displacement",
  "fire_pump",
];

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-200 pb-1 mb-3">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Type-picker card
// ---------------------------------------------------------------------------

function TypeCard({
  pt,
  selected,
  onSelect,
  isUS = false,
}: {
  pt: PumpTypeInfo;
  selected: boolean;
  onSelect: () => void;
  isUS?: boolean;
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
          H: {isUS ? (pt.typical_head_range_m.min * FT_PER_M).toFixed(0) : pt.typical_head_range_m.min}–{isUS ? (pt.typical_head_range_m.max * FT_PER_M).toFixed(0) : pt.typical_head_range_m.max} {isUS ? "ft" : "m"}
        </span>
        <span>
          Q: {isUS ? (pt.typical_flow_range_m3h.min * GPM_PER_M3H).toFixed(0) : pt.typical_flow_range_m3h.min}–{isUS ? (pt.typical_flow_range_m3h.max * GPM_PER_M3H).toFixed(0) : pt.typical_flow_range_m3h.max} {isUS ? "gpm" : "m³/h"}
        </span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Dynamic extras form — fully driven by type_specific_inputs from the API
// ---------------------------------------------------------------------------

type ExtrasValues = Record<string, string | number | boolean>;

function DynamicExtrasForm({
  fields,
  values,
  onChange,
  isUS = false,
}: {
  fields: TypeSpecificField[];
  values: ExtrasValues;
  onChange: (key: string, value: string | number | boolean) => void;
  isUS?: boolean;
}) {
  if (fields.length === 0) return null;

  const toDisplayUnit = (unit: string | null | undefined): string | undefined => {
    if (!isUS || !unit) return unit ?? undefined;
    if (unit === "m") return "ft";
    if (unit === "kPa") return "psi";
    return unit;
  };

  const toDisplayValue = (val: string | number | boolean, unit: string | null | undefined): string => {
    if (typeof val === "boolean" || val === "") return String(val);
    const n = Number(val);
    if (isNaN(n) || !isUS) return String(val);
    if (unit === "m") return (n * FT_PER_M).toFixed(2);
    if (unit === "kPa") return (n * PSI_PER_KPA).toFixed(2);
    return String(val);
  };

  const fromDisplayValue = (raw: number, unit: string | null | undefined): number => {
    if (!isUS) return raw;
    if (unit === "m") return raw * M_PER_FT;
    if (unit === "kPa") return raw * KPA_PER_PSI;
    return raw;
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map((f) => {
        const currentValue = values[f.key] ?? "";

        if (f.field_type === "boolean") {
          return (
            <div key={f.key} className="col-span-2 flex items-center gap-2">
              <input
                type="checkbox"
                id={`extras-${f.key}`}
                checked={Boolean(currentValue)}
                onChange={(e) => onChange(f.key, e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <label
                htmlFor={`extras-${f.key}`}
                className="text-sm text-slate-700"
              >
                {f.label}
                {!f.required && (
                  <span className="ml-1 text-xs text-slate-400">(optional)</span>
                )}
              </label>
            </div>
          );
        }

        if (f.field_type === "select" && f.options) {
          const optionLabels: Record<string, string> = {
            fluid_cooled: "Fluid-cooled (through-flow)",
            shroud: "Cooling shroud",
            air: "Air-cooled (dry-pit)",
            none: "None",
          };
          return (
            <div
              key={f.key}
              className={f.field_type === "select" ? "" : ""}
            >
              <label className={labelCls}>
                {f.label}
                {f.required && <span className="ml-1 text-red-500">*</span>}
              </label>
              <select
                value={String(currentValue)}
                onChange={(e) => onChange(f.key, e.target.value)}
                className={inputCls}
              >
                {f.options.map((opt) => (
                  <option key={opt} value={opt}>
                    {optionLabels[opt] ?? opt}
                  </option>
                ))}
              </select>
            </div>
          );
        }

        // string, integer, float
        const inputType =
          f.field_type === "string" ? "text" : "number";
        const step =
          f.field_type === "integer"
            ? "1"
            : f.field_type === "float"
            ? "any"
            : undefined;

        return (
          <div key={f.key}>
            <label className={labelCls}>
              {f.label}
              {f.unit && (
                <span className="ml-1 text-slate-400 normal-case">({toDisplayUnit(f.unit)})</span>
              )}
              {f.required && <span className="ml-1 text-red-500">*</span>}
              {!f.required && (
                <span className="ml-1 text-slate-400 normal-case font-normal">— optional</span>
              )}
            </label>
            <div className="relative">
              <input
                type={inputType}
                step={step}
                min={f.min_value ?? undefined}
                max={f.max_value ?? undefined}
                placeholder={f.placeholder ?? ""}
                value={toDisplayValue(currentValue, f.unit)}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (f.field_type === "integer") {
                    const n = parseInt(raw, 10);
                    onChange(f.key, isNaN(n) ? "" : fromDisplayValue(n, f.unit));
                  } else if (f.field_type === "float") {
                    const n = parseFloat(raw);
                    onChange(f.key, isNaN(n) ? "" : fromDisplayValue(n, f.unit));
                  } else {
                    onChange(f.key, raw);
                  }
                }}
                className={inputCls + (f.unit ? " pr-12" : "")}
              />
              {f.unit && (
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">
                  {toDisplayUnit(f.unit)}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grouped type picker
// ---------------------------------------------------------------------------

function GroupedTypePicker({
  pumpTypes,
  selectedKey,
  onSelect,
  isUS = false,
}: {
  pumpTypes: PumpTypeInfo[];
  selectedKey: string | null;
  onSelect: (pt: PumpTypeInfo) => void;
  isUS?: boolean;
}) {
  // Build family → types map in the preferred order
  const grouped: { family: string; types: PumpTypeInfo[] }[] = [];
  const familyMap = new Map<string, PumpTypeInfo[]>();
  for (const pt of pumpTypes) {
    if (!familyMap.has(pt.family)) familyMap.set(pt.family, []);
    familyMap.get(pt.family)!.push(pt);
  }
  for (const family of FAMILY_ORDER) {
    const types = familyMap.get(family);
    if (types && types.length > 0) {
      grouped.push({ family, types });
    }
  }
  // Any families not in the preferred order go at the end
  for (const [family, types] of familyMap.entries()) {
    if (!FAMILY_ORDER.includes(family)) {
      grouped.push({ family, types });
    }
  }

  return (
    <div className="space-y-5">
      {grouped.map(({ family, types }) => (
        <div key={family}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
              {FAMILY_DISPLAY_LABELS[family] ?? family}
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {types.length} {types.length === 1 ? "type" : "types"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {types.map((pt) => (
              <TypeCard
                key={pt.key}
                pt={pt}
                selected={selectedKey === pt.key}
                onSelect={() => onSelect(pt)}
                isUS={isUS}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default extras values per extras_schema
// ---------------------------------------------------------------------------

function defaultExtrasForSchema(schema: string | null): ExtrasValues {
  switch (schema) {
    case "vertical_turbine":
      return {
        bowl_count: 4,
        column_length_m: 10.0,
        min_submergence_m: 1.0,
        bowl_efficiency_pct: "",
        bowl_model: "",
      };
    case "submersible":
      return {
        installation_depth_m: 5.0,
        motor_cooling: "fluid_cooled",
        min_flow_cooling_m3h: "",
      };
    case "booster_set":
      return {
        setpoint_pressure_kPa: 500.0,
        num_pumps_in_set: 2,
        vfd_equipped: true,
      };
    case "pd_pump":
      return {
        displacement_L_per_rev: 1.0,
        max_pressure_kPa: 700.0,
        pulsation_dampener: false,
      };
    case "fire_pump":
      return { nfpa20_compliance: false };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface PumpSelectionStepProps {
  /** Seeds control state on first mount. Re-mount (new key) to apply a fresh project. */
  initialConfig?: {
    selectedTypeKey: string | null;
    controlMode: ControlMode;
    nDuty: number;
    nStandby: number;
    extrasValues: ExtrasValues;
  };
  /** Called whenever any selection/control state changes. */
  onConfigChange?: (cfg: {
    selectedTypeKey: string | null;
    controlMode: ControlMode;
    nDuty: number;
    nStandby: number;
    extrasValues: ExtrasValues;
  }) => void;
}

export default function PumpSelectionStep({ initialConfig, onConfigChange }: PumpSelectionStepProps = {}) {
  const { unitSystem } = useUnitSystem();
  const isUS = unitSystem === "US";
  const [stepState, setStepState] = useState<StepState>("active");
  const [pumpTypes, setPumpTypes] = useState<PumpTypeInfo[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(true);
  const [selectedType, setSelectedType] = useState<PumpTypeInfo | null>(null);
  const [controlMode, setControlMode] = useState<ControlMode>(initialConfig?.controlMode ?? "constant_speed");
  const [nDuty, setNDuty] = useState(initialConfig?.nDuty ?? 1);
  const [nStandby, setNStandby] = useState(initialConfig?.nStandby ?? 1);
  const [extrasValues, setExtrasValues] = useState<ExtrasValues>(initialConfig?.extrasValues ?? {});
  const [result, setResult] = useState<PumpSelectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // When pump types arrive from backend, restore selectedType from initialConfig
  const appliedInitialRef = useRef(false);
  useEffect(() => {
    fetchPumpTypes()
      .then((data) => {
        const types = data.pump_types ?? [];
        setPumpTypes(types);
        if (!appliedInitialRef.current && initialConfig?.selectedTypeKey) {
          const match = types.find((t) => t.key === initialConfig.selectedTypeKey);
          if (match) {
            setSelectedType(match);
            setExtrasValues(initialConfig.extrasValues ?? {});
          }
          appliedInitialRef.current = true;
        }
      })
      .catch(() => setPumpTypes([]))
      .finally(() => setLoadingTypes(false));
  // run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Report config changes to parent (ProjectDraft)
  useEffect(() => {
    onConfigChange?.({
      selectedTypeKey: selectedType?.key ?? null,
      controlMode,
      nDuty,
      nStandby,
      extrasValues,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, controlMode, nDuty, nStandby, extrasValues]);

  const handleSelectType = useCallback((pt: PumpTypeInfo) => {
    setSelectedType(pt);
    setExtrasValues(defaultExtrasForSchema(pt.extras_schema));
    setResult(null);
    setApiError(null);
    setFormError(null);
  }, []);

  const handleExtrasChange = useCallback(
    (key: string, value: string | number | boolean) => {
      setExtrasValues((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const buildExtrasPayload = (): Record<string, unknown> | null => {
    if (!selectedType?.extras_schema) return null;
    const payload: Record<string, unknown> = {};
    for (const field of selectedType.type_specific_inputs) {
      const raw = extrasValues[field.key];
      if (raw === "" || raw === undefined) {
        if (field.required) return null; // missing required field
        continue; // optional — omit
      }
      payload[field.key] = raw;
    }
    return payload;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setApiError(null);

    if (!selectedType) {
      setFormError("Please select a pump type before confirming.");
      return;
    }

    // Validate required extras
    if (selectedType.extras_schema) {
      const missing = selectedType.type_specific_inputs
        .filter((f) => f.required && (extrasValues[f.key] === "" || extrasValues[f.key] === undefined))
        .map((f) => f.label);
      if (missing.length > 0) {
        setFormError(`Required fields missing: ${missing.join(", ")}`);
        return;
      }
    }

    setLoading(true);
    try {
      const extras = buildExtrasPayload();
      const req: PumpSelectionRequest = {
        active: true,
        pump_type_key: selectedType.key,
        control_mode: controlMode,
        n_duty: nDuty,
        n_standby: nStandby,
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
          <form onSubmit={handleSubmit} className="space-y-6">

            {/* ---- Grouped type picker ---- */}
            <div>
              <SectionHeader>Select Pump Type (grouped by family)</SectionHeader>
              {loadingTypes ? (
                <div className="py-8 text-center text-sm text-slate-400">
                  Loading pump catalogue…
                </div>
              ) : (
                <GroupedTypePicker
                  pumpTypes={pumpTypes}
                  selectedKey={selectedType?.key ?? null}
                  onSelect={handleSelectType}
                  isUS={isUS}
                />
              )}
              {formError && !selectedType && (
                <p className="mt-2 text-xs text-red-600">{formError}</p>
              )}
            </div>

            {/* ---- Configuration ---- */}
            <div>
              <SectionHeader>Configuration</SectionHeader>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={labelCls}>Duty Pumps (1–4) <FieldTip fieldKey="duty_pumps" /></label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="4"
                    value={nDuty}
                    onChange={(e) => setNDuty(Math.min(4, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Standby Pumps (0–4) <FieldTip fieldKey="standby_pumps" /></label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    max="4"
                    value={nStandby}
                    onChange={(e) => setNStandby(Math.min(4, Math.max(0, parseInt(e.target.value, 10) || 0)))}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Speed Control <FieldTip fieldKey="control_mode" /></label>
                  <select
                    value={controlMode}
                    onChange={(e) => setControlMode(e.target.value as ControlMode)}
                    className={inputCls}
                  >
                    <option value="constant_speed">Constant speed (DOL / soft-start)</option>
                    <option value="vfd">Variable frequency drive (VFD)</option>
                    <option value="cascade">Cascade staging (duty pumps sequence)</option>
                  </select>
                </div>
              </div>
              {controlMode === "constant_speed" && (
                <p className="mt-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                  Constant-speed pumps cycle on/off — verify operating volume in the Clearwell step to limit starts per hour.
                </p>
              )}
              {controlMode === "cascade" && (
                <p className="mt-1.5 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-2.5 py-1.5">
                  Cascade staging: duty pumps start sequentially as demand increases. Requires pressure transmitter feedback and PLC sequencing logic. Typically used with ≥2 duty pumps.
                </p>
              )}
            </div>

            {/* ---- Dynamic type-specific extras ---- */}
            {selectedType && selectedType.type_specific_inputs.length > 0 && (
              <div>
                <SectionHeader>
                  {selectedType.display_name} — Additional Parameters
                </SectionHeader>
                <DynamicExtrasForm
                  fields={selectedType.type_specific_inputs}
                  values={extrasValues}
                  onChange={handleExtrasChange}
                  isUS={isUS}
                />
              </div>
            )}

            {/* ---- Engineering constraints panel ---- */}
            {selectedType && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Engineering Constraints — {selectedType.display_name}
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

            {formError && selectedType && (
              <p className="text-xs text-red-600">{formError}</p>
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
