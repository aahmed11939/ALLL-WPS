import type { UnitSystem } from "../utils/units";
import type { AccessoryItem, CalculationResponse, PumpComputeResponse } from "../utils/api";

export interface ProjectMeta {
  name: string;
  client: string;
  job_number: string;
  date: string;
  engineer: string;
  notes: string;
}

export interface PipelineSegment {
  material: string;
  diameter_mm: number;
  length_m: number;
}

export interface PipelineDraft {
  segments: PipelineSegment[];
  accessories: AccessoryItem[];
  accessories_K_sum: number;
}

export interface NodeDraft {
  elevation_m: number;
  pressure_kPa: number;
}

// ---------------------------------------------------------------------------
// Step-specific editable configs persisted in ProjectDraft so save/load
// faithfully reconstructs the full design session.
// ---------------------------------------------------------------------------

/** Mirrors ClearWellStep's react-hook-form FormValues schema. */
export interface ClearwellFormConfig {
  shape: "cylindrical" | "rectangular";
  diameter_m?: number;
  length_m?: number;
  width_m?: number;
  LLL_m: number;
  LWL_m: number;
  HWL_m: number;
  HHL_m: number;
  pump_stages: Array<{ stage: number; Q_pump_m3h: number; label: string }>;
  inflow_type: "constant" | "hourly_24";
  Q_in_m3h?: number;
  hourly_Q: Array<{ Q: number }>;
  max_cycles_per_hour: number;
  required_detention_min: number;
}

/** Mirrors PumpSelectionStep's internal control state. */
export interface PumpSelectionConfig {
  selectedTypeKey: string | null;
  controlMode: "constant_speed" | "vfd" | "cascade";
  nDuty: number;
  nStandby: number;
  extrasValues: Record<string, string | number | boolean>;
}

/** Mirrors the key arrangement / source state inside PumpCurveStep. */
export interface PumpCurveConfig {
  sourceTab: "library" | "manual" | "csv";
  selectedPumpId: string;
  arrangement: "single" | "parallel" | "series";
  nPumps: number;
  staging: boolean;
  vfd: boolean;
  speedPct: number;
  speedMin: number;
  speedMax: number;
  hqRows: Array<{ Q: string; value: string }>;
  etaRows: Array<{ Q: string; value: string }>;
  pRows: Array<{ Q: string; value: string }>;
  npshRows: Array<{ Q: string; value: string }>;
  npsha: string;
  staticHeadOverride: number;
}

// ---------------------------------------------------------------------------
// Top-level draft
// ---------------------------------------------------------------------------

export interface ProjectDraft {
  meta: ProjectMeta;
  unitSystem: UnitSystem;
  showBoth: boolean;
  designFlow_m3h: number;
  upstreamNode: NodeDraft;
  downstreamNode: NodeDraft;
  suction: PipelineDraft;
  discharge: PipelineDraft;
  /** Editable state of ClearWellStep (Step 4). Null until user visits step. */
  clearwellConfig: ClearwellFormConfig | null;
  /** Editable state of PumpSelectionStep (Step 5 Part A). */
  pumpSelectionConfig: PumpSelectionConfig | null;
  /** Editable state of PumpCurveStep (Step 5 Part B). */
  pumpCurveConfig: PumpCurveConfig | null;
  /** Cached compute results. Included in save/load for full session restore. */
  hydraulicsResult: CalculationResponse | null;
  hydraulicsError: string | null;
  pumpResult: PumpComputeResponse | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HOURLY_24 = Array.from({ length: 24 }, () => ({ Q: 36 }));

export const DEFAULT_PIPELINE: PipelineDraft = {
  segments: [{ material: "pvc", diameter_mm: 150, length_m: 200 }],
  accessories: [],
  accessories_K_sum: 0,
};

export const DEFAULT_CLEARWELL_CONFIG: ClearwellFormConfig = {
  shape: "cylindrical",
  diameter_m: 5.0,
  LLL_m: 0.30,
  LWL_m: 0.80,
  HWL_m: 2.50,
  HHL_m: 3.00,
  pump_stages: [{ stage: 1, Q_pump_m3h: 72.0, label: "Duty" }],
  inflow_type: "constant",
  Q_in_m3h: 36.0,
  hourly_Q: DEFAULT_HOURLY_24,
  max_cycles_per_hour: 6,
  required_detention_min: 0,
};

export const DEFAULT_PUMP_SELECTION_CONFIG: PumpSelectionConfig = {
  selectedTypeKey: null,
  controlMode: "constant_speed",
  nDuty: 1,
  nStandby: 1,
  extrasValues: {},
};

export const DEFAULT_PUMP_CURVE_CONFIG: PumpCurveConfig = {
  sourceTab: "library",
  selectedPumpId: "",
  arrangement: "single",
  nPumps: 1,
  staging: false,
  vfd: false,
  speedPct: 100,
  speedMin: 50,
  speedMax: 100,
  hqRows: [
    { Q: "0",   value: "42" },
    { Q: "60",  value: "36" },
    { Q: "120", value: "28" },
    { Q: "160", value: "18" },
  ],
  etaRows: [],
  pRows: [],
  npshRows: [],
  npsha: "",
  staticHeadOverride: 10,
};

export const DEFAULT_DRAFT: ProjectDraft = {
  meta: {
    name: "Untitled Project",
    client: "",
    job_number: "",
    date: new Date().toISOString().slice(0, 10),
    engineer: "",
    notes: "",
  },
  unitSystem: "SI",
  showBoth: false,
  designFlow_m3h: 36,
  upstreamNode: { elevation_m: 5.0, pressure_kPa: 0 },
  downstreamNode: { elevation_m: 35.0, pressure_kPa: 0 },
  suction: {
    segments: [{ material: "pvc", diameter_mm: 150, length_m: 200 }],
    accessories: [],
    accessories_K_sum: 0,
  },
  discharge: {
    segments: [{ material: "pvc", diameter_mm: 150, length_m: 400 }],
    accessories: [],
    accessories_K_sum: 0,
  },
  clearwellConfig: null,
  pumpSelectionConfig: null,
  pumpCurveConfig: null,
  hydraulicsResult: null,
  hydraulicsError: null,
  pumpResult: null,
};
