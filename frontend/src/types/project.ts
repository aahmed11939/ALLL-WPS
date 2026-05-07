import type { UnitSystem } from "../utils/units";
import type { AccessoryItem, CalculationResponse, ClearWellResponse, PumpComputeResponse, SurgeQuickResponse, SurgeEventType, MOCResponse } from "../utils/api";

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

/** Persisted form state for the Water Hammer step. */
export interface WaterHammerConfig {
  pipeline: "suction" | "discharge";
  wave_speed_ms: number;
  V0_override: string;
  event_type: SurgeEventType;
  closure_time_s: string;
  H_operating_override: string;
  rho_kg_m3: number;
  temperature_C: string;
  pressure_rating_kPa: string;
  pipe_material: string;
  D_o_mm: string;
  wall_thickness_mm: string;
  sdr: string;
  use_sdr: boolean;
  restraint: string;
}

// ---------------------------------------------------------------------------
// MOC (Mode B) config types
// ---------------------------------------------------------------------------

export type MOCBCType =
  | "reservoir"
  | "pump_trip"
  | "valve_closure"
  | "suction_pump_trip";

export interface MOCBoundaryConfig {
  type: MOCBCType;
  H_m: string;
  H_pump_m: string;
  Q_m3s: string;
  t_trip_s: string;
  H_reservoir_m: string;
  t_close_s: string;
  profile: "linear" | "equal_percentage";
  H_sump_m: string;
}

export interface MOCObsConfig {
  label: string;
  frac: string;
}

/** Persisted form state for the Water Hammer step Mode B (MOC). */
export interface MOCConfig {
  pipeline: "suction" | "discharge";
  wave_speed_ms: number;
  Q_0_m3s_override: string;
  H_0_m_override: string;
  rho_kg_m3: string;
  temperature_C: string;
  pressure_rating_kPa: string;
  boundary_A: MOCBoundaryConfig;
  boundary_B: MOCBoundaryConfig;
  obs_points: MOCObsConfig[];
  n_reaches: string;
  t_total_s: string;
}

// ---------------------------------------------------------------------------
// Suction surge config / result
// ---------------------------------------------------------------------------

/** Persisted form state for the Suction Surge MOC tab. */
export interface SuctionSurgeConfig {
  wave_speed_ms: number;
  Q_0_m3s_override: string;
  H_0_m_override: string;
  rho_kg_m3: string;
  temperature_C: string;
  pressure_rating_kPa: string;
  atm_pressure_kPa: string;
  NPSHr_m_override: string;
  pump_node_frac: number;
  boundary_A: MOCBoundaryConfig;
  boundary_B: MOCBoundaryConfig;
  obs_points: MOCObsConfig[];
  n_reaches: string;
  t_total_s: string;
}

/** One time-step of the NPSHa transient at the pump suction node. */
export interface NPSHaPoint {
  t_s: number;
  H_suction_m: number;
  NPSHa_m: number;
  margin_m: number | null;
  at_risk: boolean;
}

/** Cached result for the suction transient endpoint. */
export interface SuctionTransientResult {
  pipeline: string;
  N: number;
  dx_m: number;
  dt_s: number;
  courant: number;
  t_total_s: number;
  n_steps: number;
  D_m: number;
  f: number;
  T_char_s: number;
  h_vap_m: number;
  temperature_C: number;
  global_max_H_m: number;
  global_min_H_m: number;
  global_max_P_kPa: number;
  global_min_P_kPa: number;
  cavitation_x_m: number[];
  npsha_series: NPSHaPoint[];
  npsha_min_m: number;
  npsha_steady_m: number;
  npsha_margin_min_m: number | null;
  transient_npsh_risk: boolean;
  npsha_risk_duration_s: number;
  atm_pressure_kPa: number;
  NPSHr_m: number | null;
  pump_node_frac: number;
  /** Inline to avoid circular import — mirrors PressureRatingCheck from api.ts */
  rating_check: {
    steady_state_pressure_kPa: number;
    max_transient_kPa: number;
    min_transient_kPa: number;
    pressure_rating_kPa: number;
    factor_of_safety: number;
    rating_status: "pass" | "caution" | "fail";
  } | null;
  /** Inline MOCEnvelopePoint */
  envelope: {
    x_m: number; elev_m: number;
    H_max_m: number; H_min_m: number;
    P_max_kPa: number; P_min_kPa: number;
  }[];
  /** Inline MOCObservationResult */
  observations: {
    label: string; frac: number; node_index: number; x_m: number;
    history: { t_s: number; H_m: number; P_kPa: number }[];
  }[];
  assumption_notes: string[];
  unit_system: string;
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
  /** Cached clearwell compute result — used by Engineering Checks for cycling analysis. */
  clearwellResult: ClearWellResponse | null;
  /** Editable state of Water Hammer step (Step 8) — discharge Quick mode. Null until user visits step. */
  waterHammerConfig: WaterHammerConfig | null;
  /** Cached water hammer compute result (discharge Quick mode). */
  waterHammerResult: SurgeQuickResponse | null;
  /** Editable state of Discharge Surge MOC (Mode B). Null until user runs Mode B. */
  mocConfig: MOCConfig | null;
  /** Cached Discharge Surge MOC result. */
  mocResult: MOCResponse | null;
  /** Editable state of Suction Surge MOC. Null until user visits suction MOC tab. */
  suctionSurgeConfig: SuctionSurgeConfig | null;
  /** Cached suction transient result (NPSHa time series + MOC). */
  suctionSurgeResult: SuctionTransientResult | null;
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
  clearwellResult: null,
  waterHammerConfig: null,
  waterHammerResult: null,
  mocConfig: null,
  mocResult: null,
  suctionSurgeConfig: null,
  suctionSurgeResult: null,
};
