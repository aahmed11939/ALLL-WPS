import axios from "axios";
import type { UnitSystem } from "./units";

const BASE = "/api/v1";

export interface CalculationRequest {
  Q_m3h: number;
  elev_us_m: number;
  elev_ds_m: number;
  pipe_length_m: number;
  pipe_diameter_mm: number;
  material: string;
  K_values: number[];
  unit_system?: UnitSystem;
}

export interface UnitValue {
  si_value: number;
  display_value: number;
  unit: string;
}

export interface SystemCurvePoint {
  Q_m3h: number;
  H_m: number;
  Q_display: UnitValue;
  H_display: UnitValue;
}

export interface DisplayValues {
  velocity: UnitValue;
  static_head: UnitValue;
  friction_head: UnitValue;
  minor_head: UnitValue;
  tdh: UnitValue;
  design_flow: UnitValue;
}

export interface CalculationResponse {
  velocity_ms: number;
  reynolds_number: number;
  friction_factor: number;
  static_head_m: number;
  friction_head_m: number;
  minor_head_m: number;
  tdh_m: number;
  system_curve: SystemCurvePoint[];
  design_Q_m3h: number;
  K_sum: number;
  display: DisplayValues;
  unit_system: UnitSystem;
}

export interface MaterialOption {
  key: string;
  label: string;
}

export interface PumpCurveCoefficients {
  A: number;
  B: number;
  C: number;
}

export interface PumpRecord {
  id: string;
  name: string;
  manufacturer: string;
  type: string;
  nominal_flow_m3h: number;
  rated_flow_m3h: number;
  rated_head_m: number;
  shutoff_head_m: number;
  rated_efficiency_pct: number;
  rated_power_kW: number;
  rated_speed_rpm: number;
  impeller_diameter_mm: number;
  curve_coefficients: PumpCurveCoefficients;
  notes: string;
}

export async function fetchMaterials(): Promise<MaterialOption[]> {
  const res = await axios.get<{ materials: MaterialOption[] }>(
    `${BASE}/materials`
  );
  return res.data.materials;
}

export async function calculate(
  req: CalculationRequest
): Promise<CalculationResponse> {
  const res = await axios.post<CalculationResponse>(`${BASE}/calculate`, req);
  return res.data;
}

export async function fetchPumpLibrary(): Promise<PumpRecord[]> {
  const res = await axios.get<{ pumps: PumpRecord[]; count: number }>(
    `${BASE}/pump-library`
  );
  return res.data.pumps;
}

// ---------------------------------------------------------------------------
// Clear well sizing
// ---------------------------------------------------------------------------

export interface ClearWellGeometryInput {
  shape: "cylindrical" | "rectangular";
  diameter_m?: number;
  length_m?: number;
  width_m?: number;
}

export interface ClearWellLevelsInput {
  LLL_m: number;
  LWL_m: number;
  HWL_m: number;
  HHL_m: number;
}

export interface PumpStageInput {
  stage: number;
  Q_pump_m3h: number;
  label?: string;
}

export interface InflowProfileInput {
  type: "constant" | "hourly_24";
  Q_in_m3h?: number;
  hourly_Q_m3h?: number[];
}

export interface ClearWellRequest {
  active: boolean;
  geometry?: ClearWellGeometryInput;
  levels?: ClearWellLevelsInput;
  pump_stages?: PumpStageInput[];
  inflow?: InflowProfileInput;
  max_cycles_per_hour?: number;
  required_detention_min?: number;
}

export interface VolumeCurvePoint {
  level_m: number;
  depth_m: number;
  volume_m3: number;
}

export interface CycleResult {
  stage: number;
  label: string;
  Q_pump_m3h: number;
  Q_in_m3h: number;
  t_fill_s: number | null;
  t_drain_s: number | null;
  t_cycle_s: number | null;
  cycles_per_hour: number;
  V_req_m3: number;
  cycles_ok: boolean;
  pump_can_drain: boolean;
}

export interface ClearWellResponse {
  active: boolean;
  volume_curve: VolumeCurvePoint[];
  operating_volume_m3: number | null;
  cycle_results: CycleResult[];
  detention_time_min: number | null;
  required_detention_min: number;
  detention_ok: boolean | null;
  warnings: string[];
}

export async function computeClearWell(
  req: ClearWellRequest
): Promise<ClearWellResponse> {
  const res = await axios.post<ClearWellResponse>("/compute/clearwell", req);
  return res.data;
}
