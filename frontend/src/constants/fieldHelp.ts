export interface FieldHelpEntry {
  title: string;
  body: string;
  range?: string;
  equation?: string;
  ref?: string;
}

const _FIELD_HELP = {

  // ── StepMeta ──────────────────────────────────────────────────────────────

  "design_flow": {
    title: "Design Flow Rate (Q)",
    body: "The single-point flow the entire design is optimised for. Set this to the peak instantaneous demand or firm pump duty flow, not the average daily demand.",
    range: "Typical water-supply station: 50–5 000 m³/h (220–22 000 gpm)",
    equation: "Q = V / t — volume per unit time",
    ref: "AWWA M11 §3",
  },

  "unit_system": {
    title: "Unit System",
    body: "Switches all displayed values between SI (metric) and US Customary (imperial). Internal calculations always use SI; conversions are applied only in the display layer.",
    ref: "ISO 80000-1",
  },

  "include_surge": {
    title: "Include Surge Analysis",
    body: "Enables the Water Hammer step (Steps 8–9). Adds the Joukowsky quick analysis and Method of Characteristics (MOC) simulation. Uncheck only if surge assessment is out of scope for this project.",
    ref: "AWWA M11 §6; Wylie & Streeter (1993)",
  },

  // ── StepNodes ────────────────────────────────────────────────────────────

  "upstream_elevation": {
    title: "Upstream Node Elevation",
    body: "Hydraulic datum elevation at the suction source (e.g. clearwell water surface or reservoir HWL). Used to compute static suction head. Accuracy of ±0.1 m is usually sufficient.",
    range: "Any datum; typical range −20 m to +500 m above MSL",
    equation: "H_static = z_downstream − z_upstream",
    ref: "AWWA M11 §4",
  },

  "downstream_elevation": {
    title: "Downstream Node Elevation",
    body: "Hydraulic datum elevation at the delivery point (e.g. reservoir HWL, pressure zone control point). Difference from upstream elevation gives the static head component of TDH.",
    range: "Any datum; must be set consistently with upstream elevation",
    equation: "H_static = z_ds − z_us",
    ref: "AWWA M11 §4",
  },

  "upstream_pressure": {
    title: "Upstream Pressure Zone",
    body: "Gauge pressure at the suction source. Use 0 kPa for an open clearwell or atmospheric suction. For a pressurised interconnect, enter the operating zone pressure.",
    range: "0 kPa (atmospheric) to ~700 kPa for boosted zones",
    equation: "TDH = H_static + H_friction + H_minor + (P_ds − P_us)/(ρg)",
    ref: "AWWA M11 §4",
  },

  "downstream_pressure": {
    title: "Downstream Pressure Zone",
    body: "Gauge pressure at the delivery point. For a reservoir or open storage tank use 0 kPa. For distribution zone delivery enter the minimum required zone pressure.",
    range: "0 kPa (open) to 700 kPa; typical distribution zone 300–550 kPa",
    ref: "AWWA M11 §4",
  },

  // ── StepPipeline ─────────────────────────────────────────────────────────

  "pipe_diameter": {
    title: "Pipe Internal Diameter",
    body: "Nominal bore of the pipe segment. Larger diameter reduces velocity and friction loss but increases cost. Keep velocity in the recommended range for the pipe material.",
    range: "50–1 200 mm (2–48 in). Target velocity 0.6–2.4 m/s (2–8 ft/s)",
    equation: "v = Q / (π D² / 4)",
    ref: "AWWA M11 §5; Ten States Standards",
  },

  "pipe_length": {
    title: "Pipe Segment Length",
    body: "Centreline length of this pipe segment, measured along the pipe route. Used directly in the Darcy-Weisbach friction loss calculation: h_f = f·(L/D)·(v²/2g).",
    equation: "h_f = f · (L/D) · v²/(2g)  (Darcy-Weisbach)",
    ref: "Moody (1944); AWWA M11 §5",
  },

  "pipe_material": {
    title: "Pipe Material",
    body: "Determines absolute roughness ε used in the Colebrook-White equation (Darcy-Weisbach mode) or the Hazen-Williams C coefficient. Choose the material that matches your pipe specification.",
    ref: "Moody Chart; Colebrook-White (1939)",
  },

  "accessories_K": {
    title: "Fittings & Minor Losses (ΣK)",
    body: "Sum of dimensionless K-factors for all fittings and valves in this pipe. Minor head loss h_m = ΣK · v²/(2g). Use manufacturer data for control valves; generic values for standard fittings.",
    range: "Typical range: 0.5–15 for a complete station pipeline",
    equation: "h_m = ΣK · v²/(2g)",
    ref: "Idelchik (2008); AWWA M11",
  },

  // ── StepWaterHammer ───────────────────────────────────────────────────────

  "wave_speed": {
    title: "Wave Speed a (celerity)",
    body: "Speed at which a pressure disturbance travels through the pipe. Depends on fluid bulk modulus K, pipe material elastic modulus E, wall thickness, and restraint condition.",
    range: "300–500 m/s (HDPE/PVC); 900–1 200 m/s (steel/DI)",
    equation: "a = √( K/ρ / (1 + K·D/(E·e)·C) )",
    ref: "Wylie & Streeter (1993) §2",
  },

  "initial_velocity": {
    title: "Initial Flow Velocity V₀",
    body: "Steady-state pipe velocity immediately before the transient event. For pump-trip or valve-closure events ΔV = V₀ (flow drops to zero). Populated automatically from Step 6 hydraulic results.",
    range: "0.6–2.4 m/s typical; must be > 0 for meaningful surge analysis",
    equation: "ΔH = a · V₀ / g  (Joukowsky, instantaneous event)",
    ref: "Joukowsky (1900)",
  },

  "operating_head": {
    title: "Operating Head H₀",
    body: "Steady-state piezometric head at the event location. Used to compute absolute max/min pressures from ΔH. Populated automatically from TDH computed in Step 6.",
    equation: "H_max = H₀ + ΔH_eff;  H_min = H₀ − ΔH_eff",
    ref: "Chaudhry (2014) §3",
  },

  "fluid_density": {
    title: "Fluid Density ρ",
    body: "Mass density of the transported water. Used in the Joukowsky pressure calculation ΔP = ρ·a·ΔV and in the vapour pressure head conversion.",
    range: "Fresh potable water: 997–1 001 kg/m³ at 10–25 °C",
    equation: "ΔP = ρ · a · ΔV / 1 000  [kPa]",
    ref: "ASHRAE Fundamentals / CRC Handbook",
  },

  "closure_time": {
    title: "Valve Closure Time t_c",
    body: "Time for the valve to travel from fully open to fully closed. If t_c < T_char = 2L/a the closure is 'rapid' and the full Joukowsky surge applies. Slower closures receive an Allievi reduction factor K = T/t_c.",
    range: "≥ 2L/a for slow closure; typical control valves 10–120 s",
    equation: "K = T_char / t_c  (when t_c > T_char);  T_char = 2L/a",
    ref: "Allievi (1902); Wylie & Streeter (1993) §4",
  },

  "pressure_rating": {
    title: "Pipe Pressure Class (PN)",
    body: "Maximum allowable operating pressure (MAOP) of the pipe. The tool checks whether the peak transient pressure exceeds this rating and computes a Factor of Safety = PN / P_max.",
    range: "Common classes: PN 10, 16, 20, 25, 32 (kPa × 100 = bar × 100)",
    ref: "ISO 4422; AWWA C900/C905; AS/NZS 4130",
  },

  "water_temperature": {
    title: "Water Temperature",
    body: "Used to compute vapour pressure head h_vap = P_vap(T)/(ρg). If the minimum transient head drops below h_vap the risk of column separation and subsequent cavity collapse is flagged.",
    range: "Potable water: 5–30 °C; use design maximum temperature in summer",
    equation: "h_vap = P_vap(T) / (ρ·g)  [m gauge]",
    ref: "ASHRAE Fundamentals; Chaudhry (2014) §12",
  },

  "pipe_outer_diameter": {
    title: "Pipe Outer Diameter D_o",
    body: "Outside diameter of the pipe barrel. Used together with wall thickness (or SDR) to compute the internal cross-section and the pipe stiffness parameter for wave speed calculation.",
    ref: "ISO 4422; AWWA C900",
  },

  "pipe_wall_thickness": {
    title: "Wall Thickness e",
    body: "Thickness of the pipe wall. A thicker wall increases pipe stiffness and therefore raises wave speed a. Alternatively enter the SDR (Standard Dimension Ratio) to compute e = D_o / SDR.",
    equation: "e = D_o / SDR  (SDR method)",
    ref: "ISO 4422; AWWA C906",
  },

  "sdr": {
    title: "Standard Dimension Ratio (SDR)",
    body: "Ratio of outer diameter to wall thickness (SDR = D_o / e). Commonly used for PE/HDPE pipes. Lower SDR = thicker wall = higher pressure rating and higher wave speed.",
    range: "SDR 11 (high pressure) to SDR 26 (lower pressure); SDR 17 is most common for potable water mains",
    equation: "e = D_o / SDR",
    ref: "ISO 4427; AWWA C906",
  },

  "pipe_restraint": {
    title: "Pipe Restraint Condition",
    body: "Describes how the pipe is constrained against axial movement. Affects the Poisson-ratio correction factor C in the wave speed formula. Buried restrained pipe (C = 1 − ν²) gives a slightly lower wave speed than free-expansion pipe (C = 1).",
    equation: "a = √( K/ρ / (1 + K·C·D/(E·e)) )",
    ref: "Wylie & Streeter (1993) §2.3",
  },

  // ── ClearWellStep ────────────────────────────────────────────────────────

  "clearwell_shape": {
    title: "Clear Well Geometry",
    body: "Cylindrical tanks use a single diameter to compute cross-sectional area A = πD²/4. Rectangular basins use length × width. Plan area determines storage volume between operating levels.",
    equation: "V = A × (HWL − LWL)",
    ref: "AWWA M32 §4",
  },

  "clearwell_lll": {
    title: "Low-Low Level (LLL)",
    body: "The emergency dry-run protection level. If water drops to LLL the pump trips on low-level fault. Must be set below LWL with enough clearance to allow the pump to stop safely before the suction is lost.",
    range: "Typically 200–500 mm below LWL",
    ref: "AWWA M32 §4; Ten States Standards",
  },

  "clearwell_lwl": {
    title: "Low Water Level (LWL) — Pump Start",
    body: "The level at which the pump is commanded to start (fill cycle begins). The useful cycling volume is between LWL and HWL. Lower LWL increases usable storage but reduces the safety margin above LLL.",
    range: "LLL + 0.3 m minimum clearance",
    equation: "V_cycle = A × (HWL − LWL)",
    ref: "AWWA M32 §4",
  },

  "clearwell_hwl": {
    title: "High Water Level (HWL) — Pump Stop",
    body: "The level at which the pump is commanded to stop (fill cycle ends). Together with LWL, defines the usable cycling volume. Must be below HHL to allow for overflow protection.",
    range: "Must satisfy: LWL < HWL < HHL",
    equation: "V_cycle = A × (HWL − LWL)",
    ref: "AWWA M32 §4",
  },

  "clearwell_hhl": {
    title: "High-High Level (HHL) — Overflow Alarm",
    body: "The emergency overflow alarm level. Indicates the tank is overfull — should trigger an alarm and possibly shut down the fill valve. Must be set above HWL by a margin that accounts for sensor lag and valve closing time.",
    range: "Typically 100–300 mm above HWL",
    ref: "AWWA M32 §4; local regulatory requirements",
  },

  "max_cycles_per_hour": {
    title: "Maximum Pump Starts per Hour (n_max)",
    body: "The maximum allowable number of pump start-stop cycles per hour, set by the motor manufacturer to limit thermal stress on the windings. Exceeding this reduces motor life. The required cycling volume is derived from this limit.",
    range: "Typical motors: 4–10 starts/hour; check motor data sheet",
    equation: "V_req = Q_pump × 900 / n_max  (AWWA M32 formula)",
    ref: "AWWA M32 §4; motor manufacturer data",
  },

  "detention_time": {
    title: "Required Detention Time",
    body: "Minimum hydraulic retention time the clear well must provide for chlorine contact (CT) under the Surface Water Treatment Rule (SWTR). Set to 0 if CT is provided elsewhere in the process.",
    range: "SWTR requires 0.5–3 log Giardia inactivation. Typical T10 ≥ 10–30 min for Cl₂ disinfection",
    equation: "CT = C × T₁₀  [mg/L·min]; T₁₀ ≈ 0.7 × V_total / Q_peak",
    ref: "US EPA SWTR (1989); AWWA M37",
  },

  "inflow_type": {
    title: "Inflow Profile",
    body: "Constant rate: uses a single Q_in for all hours — appropriate for groundwater or gravity-fed sources. Hourly 24-table: define demand-driven inflow for each hour — used when the fill rate follows diurnal demand. The cycling analysis uses the peak hour; detention uses the daily average.",
    ref: "AWWA M32 §4",
  },

  "clearwell_constant_inflow": {
    title: "Constant Inflow Rate Q_in",
    body: "The steady inflow entering the clear well from the upstream treatment process. Used together with pump-out flow to determine whether the well fills, drains, or stays level during each interval. The well volume must be large enough that the pump can cycle without exceeding n_max starts per hour.",
    range: "Q_in < Q_pump for any pump to cycle off; if Q_in ≥ Q_pump the well overflows when the pump is off",
    equation: "dV/dt = Q_in − Q_pump (while pump running)",
    ref: "AWWA M32 §4",
  },

  "clearwell_hourly_inflow": {
    title: "Hourly Inflow Table (24-hour)",
    body: "Enter the expected inflow volume for each of the 24 hours of the day. This allows modelling of diurnal demand patterns where the source inflow follows treatment plant output or gravity-feed variations. The cycling calculation uses the peak-hour value; detention time uses the 24-hour average.",
    ref: "AWWA M32 §4",
  },

  "clearwell_diameter": {
    title: "Clear Well Internal Diameter",
    body: "Inside diameter of a cylindrical storage tank. The plan cross-sectional area A = π·D²/4 determines storage volume between operating levels: V = A × (HWL − LWL).",
    range: "Typical municipal clear wells: 3–15 m diameter; confirm structural limits with civil design",
    equation: "A = π·D²/4;  V_cycle = A × (HWL − LWL)",
    ref: "AWWA M32 §4",
  },

  "clearwell_length": {
    title: "Clear Well Length",
    body: "Internal length of a rectangular storage basin. Plan area = Length × Width. Rectangular basins are often used for retrofit into existing structures or when plan geometry constraints prevent circular tanks.",
    equation: "A = L × W;  V_cycle = A × (HWL − LWL)",
    ref: "AWWA M32 §4",
  },

  "clearwell_width": {
    title: "Clear Well Width",
    body: "Internal width of a rectangular storage basin. Together with length determines plan cross-sectional area, and thus storage volume between operating levels.",
    equation: "A = L × W;  V_cycle = A × (HWL − LWL)",
    ref: "AWWA M32 §4",
  },

  "pump_stage_flow": {
    title: "Pump Stage Flow Q_pump",
    body: "The rated flow of this pump stage at the design duty point. Each stage represents one group of pumps operating simultaneously. Used to compute required cycling volume V_req = Q_pump × 900 / n_max.",
    equation: "V_req = Q_pump [m³/h] × 900 / n_max  (AWWA M32)",
    ref: "AWWA M32 §4",
  },

  "pump_stage_label": {
    title: "Pump Stage Label",
    body: "A descriptive name for this pump stage (e.g. Duty, Duty+Standby, Peak). Labels appear in result tables and exported reports. For multi-stage systems each label should clearly identify how many pumps are running.",
    ref: "AWWA M32 §4",
  },

  // ── PumpSelectionStep ─────────────────────────────────────────────────────

  "duty_pumps": {
    title: "Number of Duty Pumps",
    body: "Pumps that run simultaneously to meet the design flow. With n_duty pumps in parallel, each pump handles Q_design / n_duty at the same TDH. Ten States Standards requires the firm capacity (n_duty − 1) to meet peak demand.",
    range: "1–4; potable water stations typically 1–3 duty pumps",
    ref: "Ten States Standards §5; AWWA M11 §8",
  },

  "standby_pumps": {
    title: "Number of Standby Pumps",
    body: "Pumps held in reserve. Ten States Standards typically requires at least one standby so the station can maintain firm capacity when any single duty pump is out of service.",
    range: "≥ 1 for critical supply; regulatory minimum varies by jurisdiction",
    ref: "Ten States Standards §5; AWWA M11 §8",
  },

  "control_mode": {
    title: "Pump Control Mode",
    body: "Constant speed: pump runs at rated speed — simple, robust, efficient only at the design point. VFD (variable frequency drive): speed varies with demand — higher energy efficiency across a range of flows, smoother starts. Cascade: stages are sequenced on/off to match demand.",
    ref: "AWWA M11 §9; HI 9.6.8",
  },

  // ── NPSHa ─────────────────────────────────────────────────────────────────

  "npsha": {
    title: "NPSHa — Net Positive Suction Head Available",
    body: "Absolute head available at the pump inlet above vapour pressure. Must exceed NPSHr + safety margin (typically +0.5 to +1.0 m) to prevent cavitation.",
    range: "NPSHa ≥ NPSHr + 0.5 m (HI 9.6.1 minimum margin)",
    equation: "NPSHa = (P_abs − P_vap)/(ρg) + v²/(2g) + z_suction",
    ref: "HI 9.6.1-2012; AWWA M11",
  },
} satisfies Record<string, FieldHelpEntry>;

export type FieldHelpKey = keyof typeof _FIELD_HELP;
export const FIELD_HELP: Record<FieldHelpKey, FieldHelpEntry> = _FIELD_HELP;
