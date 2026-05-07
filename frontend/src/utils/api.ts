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

// ---------------------------------------------------------------------------
// Pump selection
// ---------------------------------------------------------------------------

export interface HeadFlowRange {
  min: number;
  max: number;
}

export type PotableTag = "recommended" | "conditional" | "niche";

export interface TypeSpecificField {
  key: string;
  label: string;
  field_type: "string" | "integer" | "float" | "boolean" | "select";
  required: boolean;
  unit: string | null;
  min_value: number | null;
  max_value: number | null;
  placeholder: string | null;
  options: string[] | null;
}

export interface PumpTypeInfo {
  key: string;
  display_name: string;
  family: string;
  potable_tag: PotableTag;
  description: string;
  typical_head_range_m: HeadFlowRange;
  typical_flow_range_m3h: HeadFlowRange;
  constraints: string[];
  potable_notes: string[];
  extras_schema: string | null;
  type_specific_inputs: TypeSpecificField[];
}

export interface PumpTypesResponse {
  pump_types: PumpTypeInfo[];
  count: number;
}

export interface VerticalTurbineExtras {
  bowl_model?: string;
  bowl_count: number;
  column_length_m: number;
  min_submergence_m: number;
  bowl_efficiency_pct?: number;
}

export interface SubmersibleExtras {
  installation_depth_m: number;
  motor_cooling: "fluid_cooled" | "shroud" | "air" | "none";
  min_flow_cooling_m3h?: number;
}

export interface BoosterSetExtras {
  setpoint_pressure_kPa: number;
  num_pumps_in_set: number;
  vfd_equipped: boolean;
}

export interface PDPumpExtras {
  displacement_L_per_rev: number;
  max_pressure_kPa: number;
  pulsation_dampener: boolean;
}

export interface FirePumpExtras {
  nfpa20_compliance: boolean;
}

export type PumpExtras =
  | VerticalTurbineExtras
  | SubmersibleExtras
  | BoosterSetExtras
  | PDPumpExtras
  | FirePumpExtras
  | Record<string, unknown>;

export interface PumpSelectionRequest {
  active: boolean;
  pump_type_key?: string;
  control_mode?: "constant_speed" | "vfd" | "cascade";
  n_duty?: number;
  n_standby?: number;
  extras?: PumpExtras | null;
}

export interface PumpSelectionResponse {
  active: boolean;
  type_info: PumpTypeInfo | null;
  config_summary: string | null;
  potable_notes: string[];
  warnings: string[];
}

export async function fetchPumpTypes(): Promise<PumpTypesResponse> {
  const res = await axios.get<PumpTypesResponse>("/compute/pump-types");
  return res.data;
}

export async function computePumpSelection(
  req: PumpSelectionRequest
): Promise<PumpSelectionResponse> {
  const res = await axios.post<PumpSelectionResponse>(
    "/compute/pump-selection",
    req
  );
  return res.data;
}

// ---------------------------------------------------------------------------
// Pump curve compute
// ---------------------------------------------------------------------------

export interface CurvePoint {
  Q_m3h: number;
  value: number;
}

export interface PumpCurveData {
  hq: CurvePoint[];
  eta_q?: CurvePoint[];
  p_q?: CurvePoint[];
  npshr_q?: CurvePoint[];
  interp_method?: "linear" | "poly";
  poly_degree?: number;
}

export interface SpeedCurve {
  speed_pct: number;
  hq_pts: CurvePoint[];
}

export interface PumpOperatingPoint {
  n_pumps: number;
  Q_m3h: number;
  H_m: number;
  eta_pct: number | null;
  power_kW: number | null;
  npshr_m: number | null;
  npsha_m: number | null;
  npsh_margin_m: number | null;
  warnings: string[];
}

export interface PumpComputeRequest {
  active: boolean;
  pump_id?: string;
  curve_data?: PumpCurveData;
  arrangement?: "single" | "parallel" | "series";
  n_pumps?: number;
  staging?: boolean;
  vfd?: boolean;
  speed_pct?: number;
  speed_pct_min?: number;
  speed_pct_max?: number;
  n_speed_steps?: number;
  system_curve_pts?: CurvePoint[];
  static_head_m?: number;
  npsha_m?: number;
}

export interface PumpComputeResponse {
  active: boolean;
  hq_curve: CurvePoint[];
  eta_curve: CurvePoint[];
  p_curve: CurvePoint[];
  npshr_curve: CurvePoint[];
  speed_curves: SpeedCurve[];
  operating_points: PumpOperatingPoint[];
  non_physical_fit: boolean;
  warnings: string[];
}

export interface CsvImportResponse {
  curve_data: PumpCurveData;
  warnings: string[];
}

export async function computePump(
  req: PumpComputeRequest
): Promise<PumpComputeResponse> {
  const res = await axios.post<PumpComputeResponse>("/compute/pump", req);
  return res.data;
}

export async function importPumpCurveCsv(file: File): Promise<CsvImportResponse> {
  const form = new FormData();
  form.append("file", file);
  const res = await axios.post<CsvImportResponse>(
    "/compute/pump-curves/import-csv",
    form,
    { headers: { "Content-Type": "multipart/form-data" } }
  );
  return res.data;
}

// ---------------------------------------------------------------------------
// Accessories library
// ---------------------------------------------------------------------------

export interface AccessoryRecord {
  id: string;
  category: string;
  name: string;
  default_K: number;
  K_min: number;
  K_max: number;
  notes: string;
  potable_notes: string[];
}

export interface AccessoryCategoryGroup {
  category: string;
  label: string;
  accessories: AccessoryRecord[];
}

export interface AccessoryLibraryResponse {
  accessories: AccessoryRecord[];
  count: number;
  categories: AccessoryCategoryGroup[];
}

export async function fetchAccessoriesLibrary(): Promise<AccessoryLibraryResponse> {
  const res = await axios.get<AccessoryLibraryResponse>(`${BASE}/library/accessories`);
  return res.data;
}

export async function fetchAccessoryById(id: string): Promise<AccessoryRecord> {
  const res = await axios.get<AccessoryRecord>(`${BASE}/library/accessories/${id}`);
  return res.data;
}

// ---------------------------------------------------------------------------
// Loss breakdown compute
// ---------------------------------------------------------------------------

export interface AccessoryItem {
  accessory_id: string;
  count: number;
  K_override?: number | null;
  segment?: "suction" | "discharge" | null;
  default_K?: number;
}

export interface LossBreakdownSegmentInput {
  L_m: number;
  D_mm: number;
  material: string;
  accessories: AccessoryItem[];
}

export interface LossBreakdownRequest {
  Q_m3h: number;
  D_mm?: number;
  suction?: LossBreakdownSegmentInput;
  discharge?: LossBreakdownSegmentInput;
  accessories?: AccessoryItem[];
  suction_major_head_m?: number;
  discharge_major_head_m?: number;
  unit_system?: "SI" | "US";
}

export interface LossBreakdownItem {
  accessory_id: string;
  name: string;
  category: string;
  segment?: string | null;
  count: number;
  K_each: number;
  K_total: number;
  hm_m: number;
  hm_display: UnitValue;
  pct_of_total_minor: number;
  potable_notes: string[];
}

export interface CategorySubtotal {
  category: string;
  label: string;
  K_sum: number;
  hm_m: number;
  hm_display: UnitValue;
  pct_of_total_minor: number;
}

export interface ContributionRow {
  segment: string;
  loss_type: string;
  category: string;
  label: string;
  h_m: number;
  h_display: UnitValue;
  pct_of_grand_total: number;
}

export interface LossBreakdownResponse {
  items: LossBreakdownItem[];
  K_sum: number;
  total_hm_m: number;
  total_hm_display: UnitValue;
  suction_minor_hm_m: number;
  discharge_minor_hm_m: number;
  suction_major_hm_m: number;
  discharge_major_hm_m: number;
  major_hm_m: number;
  grand_total_hm_m: number;
  pct_minor_of_grand_total: number;
  pct_major_of_grand_total: number;
  category_subtotals: CategorySubtotal[];
  contribution_rows: ContributionRow[];
  velocity_ms: number;
  velocity_head_m: number;
  design_Q_m3h: number;
  D_mm: number;
  unit_system: "SI" | "US";
  warnings: string[];
}

export async function computeLossBreakdown(
  req: LossBreakdownRequest
): Promise<LossBreakdownResponse> {
  const res = await axios.post<LossBreakdownResponse>(`${BASE}/compute/lossbreakdown`, req);
  return res.data;
}

// ---------------------------------------------------------------------------
// Surge / Water Hammer — Mode A Quick Check
// ---------------------------------------------------------------------------

export interface SurgeEnvelopePoint {
  location: string;
  max_head_m: number;
  min_head_m: number;
  max_pressure_kPa: number;
  min_pressure_kPa: number;
}

export type SurgeEventType =
  | "pump_trip"
  | "valve_closure_downstream"
  | "valve_closure_upstream"
  | "check_valve_slam";

export interface SurgeQuickRequest {
  pipeline: "suction" | "discharge";
  wave_speed_ms: number;
  V0_ms: number;
  event_type: SurgeEventType;
  closure_time_s?: number | null;
  pipe_length_m: number;
  rho_kg_m3: number;
  H_operating_m: number;
  temperature_C?: number;
  pressure_rating_kPa?: number | null;
  unit_system: "SI" | "US";
}

export interface PressureRatingCheck {
  steady_state_pressure_kPa: number;
  max_transient_kPa: number;
  min_transient_kPa: number;
  pressure_rating_kPa: number;
  factor_of_safety: number;
  rating_status: "pass" | "caution" | "fail";
}

export interface SurgeQuickResponse {
  pipeline: string;
  event_type: string;
  wave_speed_ms: number;
  V0_ms: number;
  pipe_length_m: number;
  rho_kg_m3: number;
  H_operating_m: number;
  delta_V_ms: number;
  delta_H_joukowsky_m: number;
  delta_P_joukowsky_kPa: number;
  T_char_s: number;
  closure_time_s: number | null;
  reduction_factor: number;
  reduction_method: string;
  delta_H_m: number;
  delta_P_kPa: number;
  envelope: SurgeEnvelopePoint[];
  min_pressure_head_m: number;
  max_pressure_head_m: number;
  min_pressure_kPa: number;
  max_pressure_kPa: number;
  cavitation_risk: boolean;
  vacuum_risk: boolean;
  vapor_pressure_head_m: number;
  temperature_C: number;
  rating_check?: PressureRatingCheck | null;
  unit_system: string;
}

export interface WaveSpeedRequest {
  material: string;
  D_o_mm: number;
  wall_thickness_mm?: number | null;
  sdr?: number | null;
  restraint: "free" | "anchored_upstream" | "restrained";
  K_f_GPa?: number;
  rho_kg_m3?: number;
}

export interface WaveSpeedResponse {
  wave_speed_ms: number;
  D_i_mm: number;
  D_o_mm: number;
  wall_mm: number;
  sdr_used: number;
  material: string;
  material_name: string;
  E_p_MPa: number;
  nu: number;
  restraint: string;
  C: number;
  K_f_Pa: number;
  rho_kg_m3: number;
  term_acoustic_ms: number;
  flexibility: number;
  denominator: number;
  equation_trace: string;
}

export async function computeSurgeQuick(
  req: SurgeQuickRequest
): Promise<SurgeQuickResponse> {
  const res = await axios.post<SurgeQuickResponse>("/surge/quick", req);
  return res.data;
}

export async function computeWaveSpeed(
  req: WaveSpeedRequest
): Promise<WaveSpeedResponse> {
  const res = await axios.post<WaveSpeedResponse>("/surge/wavespeed", req);
  return res.data;
}
