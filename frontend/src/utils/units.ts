/**
 * Unit conversion utilities for ALLL WPS Designer (frontend).
 *
 * Constants mirror backend/engine/units.py exactly.
 * All constants sourced from NIST SP 811 (2008 ed.).
 * EXACT suffix marks values that are exact by international definition.
 */

export type UnitSystem = "SI" | "US";

export type Quantity =
  | "flow_m3s"   // si_value in m³/s
  | "flow_m3h"   // si_value in m³/h
  | "head"       // si_value in m
  | "length"     // si_value in m
  | "diameter"   // si_value in mm
  | "pressure"   // si_value in kPa
  | "power"      // si_value in kW
  | "velocity";  // si_value in m/s

export interface UnitValue {
  si_value: number;
  display_value: number;
  unit: string;
}

// ---------------------------------------------------------------------------
// Exact conversion constants
// ---------------------------------------------------------------------------

/** 1 international foot = 0.3048 m  EXACT */
export const M_PER_FT = 0.3048;
export const FT_PER_M = 1.0 / M_PER_FT;      // 3.280 839 895 ...

/** 1 inch = 25.4 mm  EXACT */
export const MM_PER_IN = 25.4;
export const IN_PER_MM = 1.0 / MM_PER_IN;

/** 1 US gallon = 3.785 411 784 L  EXACT */
const L_PER_US_GAL = 3.785_411_784;
const M3_PER_US_GAL = L_PER_US_GAL * 1e-3;

/** 1 US gal/min = 6.309 019 64 × 10⁻⁵ m³/s */
export const M3S_PER_GPM = M3_PER_US_GAL / 60.0;
export const GPM_PER_M3S = 1.0 / M3S_PER_GPM;

/** m³/h per gpm and gpm per m³/h */
export const M3H_PER_GPM = M3S_PER_GPM * 3600.0;  // 0.227 124 707 04
export const GPM_PER_M3H = 1.0 / M3H_PER_GPM;     // 4.402 867 ...

/** 1 lbf = 0.453 592 37 kg × 9.806 65 m/s²  EXACT */
const _LBF_N = 0.453_592_37 * 9.806_65;           // 4.448 221 615 26 N

/** 1 psi = _LBF_N / (0.0254²) Pa */
export const KPA_PER_PSI = (_LBF_N / (0.0254 * 0.0254)) / 1000.0; // 6.894 757 ...
export const PSI_PER_KPA = 1.0 / KPA_PER_PSI;

/** 1 mechanical hp = 550 ft·lbf/s  EXACT */
export const KW_PER_HP = (550.0 * M_PER_FT * _LBF_N) / 1000.0;  // 0.745 699 87...
export const HP_PER_KW = 1.0 / KW_PER_HP;

/** 1 m/s = 1/0.3048 fps  (EXACT via M_PER_FT) */
export const FPS_PER_MS = FT_PER_M;
export const MS_PER_FPS = M_PER_FT;

// ---------------------------------------------------------------------------
// Named conversion helpers
// ---------------------------------------------------------------------------

export const gpmToM3h = (gpm: number): number => gpm * M3H_PER_GPM;
export const m3hToGpm = (m3h: number): number => m3h * GPM_PER_M3H;
export const ftToM = (ft: number): number => ft * M_PER_FT;
export const mToFt = (m: number): number => m * FT_PER_M;
export const inToMm = (inches: number): number => inches * MM_PER_IN;
export const mmToIn = (mm: number): number => mm * IN_PER_MM;
export const psiToKpa = (psi: number): number => psi * KPA_PER_PSI;
export const kpaToPsi = (kpa: number): number => kpa * PSI_PER_KPA;
export const hpToKw = (hp: number): number => hp * KW_PER_HP;
export const kwToHp = (kw: number): number => kw * HP_PER_KW;
export const fpsToMs = (fps: number): number => fps * MS_PER_FPS;
export const msToFps = (ms: number): number => ms * FPS_PER_MS;

// ---------------------------------------------------------------------------
// SI unit symbols (for display)
// ---------------------------------------------------------------------------

const SI_UNITS: Record<Quantity, string> = {
  flow_m3s: "m³/s",
  flow_m3h: "m³/h",
  head:     "m",
  length:   "m",
  diameter: "mm",
  pressure: "kPa",
  power:    "kW",
  velocity: "m/s",
};

const US_FACTORS: Record<Quantity, [number, string]> = {
  flow_m3s: [GPM_PER_M3S, "gpm"],
  flow_m3h: [GPM_PER_M3H, "gpm"],
  head:     [FT_PER_M,    "ft"],
  length:   [FT_PER_M,    "ft"],
  diameter: [IN_PER_MM,   "in"],
  pressure: [PSI_PER_KPA, "psi"],
  power:    [HP_PER_KW,   "hp"],
  velocity: [FPS_PER_MS,  "fps"],
};

// ---------------------------------------------------------------------------
// displayValue() — main conversion function
// ---------------------------------------------------------------------------

/**
 * Convert a canonical SI value into a UnitValue for the given unit system.
 *
 * @param siValue  - Value in canonical SI unit (see Quantity)
 * @param quantity - Physical quantity type
 * @param system   - Target display unit system
 */
export function displayValue(
  siValue: number,
  quantity: Quantity,
  system: UnitSystem
): UnitValue {
  if (system === "SI") {
    return {
      si_value:      siValue,
      display_value: siValue,
      unit:          SI_UNITS[quantity],
    };
  }
  const [factor, unit] = US_FACTORS[quantity];
  return {
    si_value:      siValue,
    display_value: siValue * factor,
    unit,
  };
}

// ---------------------------------------------------------------------------
// Form-value conversion helpers (for unit system toggle in CalculationForm)
// ---------------------------------------------------------------------------

/**
 * Convert a flow value from the source display unit to the target display unit.
 * flowUnit: "m3h" | "ls" | "gpm"
 */
export function convertFlowDisplay(
  value: number,
  fromUnit: "m3h" | "ls" | "gpm",
  toUnit: "m3h" | "ls" | "gpm"
): number {
  if (fromUnit === toUnit) return value;
  // Convert to m³/h first
  let m3h: number;
  switch (fromUnit) {
    case "m3h": m3h = value; break;
    case "ls":  m3h = value * 3.6; break;
    case "gpm": m3h = gpmToM3h(value); break;
  }
  // Then to target
  switch (toUnit) {
    case "m3h": return m3h;
    case "ls":  return m3h / 3.6;
    case "gpm": return m3hToGpm(m3h);
  }
}

/** Convert a length value between SI (m) and US (ft). */
export function convertLength(value: number, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return value;
  return from === "SI" ? mToFt(value) : ftToM(value);
}

/** Convert a diameter value between SI (mm) and US (in). */
export function convertDiameter(value: number, from: UnitSystem, to: UnitSystem): number {
  if (from === to) return value;
  return from === "SI" ? mmToIn(value) : inToMm(value);
}

/** Default form values in SI (m³/h, m, mm). */
export const SI_DEFAULTS = {
  Q:             36.0,
  flowUnit:      "m3h" as const,
  elev_us:       5.0,
  elev_ds:       28.5,
  pipe_length:   200.0,
  pipe_diameter: 150.0,
};

/** Default form values in US Customary (gpm, ft, in). */
export const US_DEFAULTS = {
  Q:             m3hToGpm(36.0),          // ~158.5 gpm
  flowUnit:      "gpm" as const,
  elev_us:       mToFt(5.0),              // ~16.4 ft
  elev_ds:       mToFt(28.5),             // ~93.5 ft
  pipe_length:   mToFt(200.0),            // ~656.2 ft
  pipe_diameter: mmToIn(150.0),           // ~5.906 in
};
