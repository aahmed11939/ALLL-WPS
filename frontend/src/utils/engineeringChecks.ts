/**
 * Engineering Checks — pure TypeScript module.
 *
 * Derives structured check results from an already-computed ProjectDraft.
 * No API calls. All thresholds are hard-coded industry standards (AWWA M11,
 * AWWA M32, HI 9.6.3, common potable-water engineering practice).
 */

import type { ProjectDraft } from "../types/project";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CheckSeverity = "info" | "warning" | "critical";

export interface CheckResult {
  /** Stable identifier — used as React key and for export ordering. */
  id: string;
  /** Human-readable category label shown in the panel header. */
  category: string;
  severity: CheckSeverity;
  title: string;
  /** One or two sentences explaining the finding and the threshold crossed. */
  message: string;
  /** Concrete next step the engineer can take. */
  recommendation: string;
  /** Optional numeric metric rendered alongside the badge (e.g. "2.14 m/s"). */
  metric?: string;
  /** True when the required compute result is absent and the check was skipped. */
  skipped?: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Total pipe length (m) across suction + discharge segments. */
function totalPipeLength(draft: ProjectDraft): number {
  const sLen = draft.suction.segments.reduce((a, s) => a + s.length_m, 0);
  const dLen = draft.discharge.segments.reduce((a, s) => a + s.length_m, 0);
  return sLen + dLen;
}

function pct(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}

function round(v: number, d = 2): string {
  return v.toFixed(d);
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Check 1 — Pipe velocity vs AWWA M11 potable-water recommendations.
 * Uses the combined velocity from the hydraulics result (based on the primary
 * pipe diameter the user configured). Thresholds:
 *   Warning  : > 3.0 m/s
 *   Critical : > 4.5 m/s
 * Lower bound warning (< 0.6 m/s) for stagnation / biofilm risk.
 */
function checkVelocity(draft: ProjectDraft, isUS: boolean): CheckResult {
  const r = draft.hydraulicsResult;

  if (!r) {
    return {
      id: "velocity",
      category: "Pipe Velocity",
      severity: "info",
      title: "Velocity — awaiting hydraulic compute",
      message: "Run 'Compute Hydraulics' on Step 7 to evaluate pipe velocity.",
      recommendation: "Complete the hydraulic computation to unlock this check.",
      skipped: true,
    };
  }

  const v = r.velocity_ms;
  const vDisplay = isUS ? v * 3.28084 : v;
  const unit = isUS ? "fps" : "m/s";
  const metric = `${round(vDisplay, 3)} ${unit}`;

  if (v > 4.5) {
    return {
      id: "velocity",
      category: "Pipe Velocity",
      severity: "critical",
      title: "Velocity exceeds maximum — risk of erosion and surge",
      message: `Computed pipe velocity is ${metric}. AWWA M11 recommends ≤ 3.0 m/s (10 fps) for potable mains; velocities above 4.5 m/s (15 fps) cause erosion, excessive head loss, and water-hammer amplification.`,
      recommendation: "Increase the pipe diameter on the limiting segment. A step up of one nominal size (e.g. DN150 → DN200) typically reduces velocity by ~40%.",
      metric,
    };
  }

  if (v > 3.0) {
    return {
      id: "velocity",
      category: "Pipe Velocity",
      severity: "warning",
      title: "Velocity above recommended potable-water limit",
      message: `Computed pipe velocity is ${metric}. AWWA M11 recommends ≤ 3.0 m/s (10 fps) for potable distribution; exceeding this increases head loss non-linearly and raises noise / erosion risk.`,
      recommendation: "Consider increasing pipe diameter to bring velocity below 3.0 m/s (10 fps). Review which segment is the bottleneck.",
      metric,
    };
  }

  if (v < 0.6) {
    return {
      id: "velocity",
      category: "Pipe Velocity",
      severity: "warning",
      title: "Velocity below minimum — stagnation and biofilm risk",
      message: `Computed pipe velocity is ${metric}. Velocities below 0.6 m/s (2 fps) in potable mains may lead to sediment deposition and disinfectant residual decay (AWWA M58).`,
      recommendation: "Reduce pipe diameter or review the design flow assumption. Consider a smaller diameter on long suction/discharge legs.",
      metric,
    };
  }

  return {
    id: "velocity",
    category: "Pipe Velocity",
    severity: "info",
    title: "Velocity within recommended range",
    message: `Computed pipe velocity is ${metric} — within the AWWA M11 recommended range of 0.6–3.0 m/s (2–10 fps) for potable mains.`,
    recommendation: "No action required.",
    metric,
  };
}

/**
 * Check 2 — Friction head loss per 100 m (or per 100 ft).
 * Thresholds (SI):
 *   Warning  : > 5 m / 100 m
 *   Critical : > 10 m / 100 m
 */
function checkFrictionLoss(draft: ProjectDraft, isUS: boolean): CheckResult {
  const r = draft.hydraulicsResult;

  if (!r) {
    return {
      id: "friction_loss",
      category: "Friction Loss",
      severity: "info",
      title: "Friction loss — awaiting hydraulic compute",
      message: "Run 'Compute Hydraulics' on Step 7 to evaluate friction head loss per 100 m.",
      recommendation: "Complete the hydraulic computation to unlock this check.",
      skipped: true,
    };
  }

  const totalLen = totalPipeLength(draft);

  if (totalLen <= 0) {
    return {
      id: "friction_loss",
      category: "Friction Loss",
      severity: "info",
      title: "Friction loss — no pipe length defined",
      message: "No suction or discharge segments are configured.",
      recommendation: "Add pipeline segments on Steps 3 and 6.",
      skipped: true,
    };
  }

  const per100m = (r.friction_head_m / totalLen) * 100;

  if (isUS) {
    const per100ft = per100m * 0.3048; // convert m/100m → ft/100ft (they're the same ratio, display changes)
    const metric = `${round(per100ft, 2)} ft / 100 ft`;

    if (per100m > 10) {
      return {
        id: "friction_loss",
        category: "Friction Loss",
        severity: "critical",
        title: "Friction gradient critically high",
        message: `Friction head loss is ${metric}. This is well above the typical guideline of ≤ 4 ft/100 ft for pump station mains, indicating severe pipe undersizing.`,
        recommendation: "Increase pipe diameter immediately. For long runs, evaluate economic pipe sizing (EPS) to find the life-cycle optimum diameter.",
        metric,
      };
    }
    if (per100m > 5) {
      return {
        id: "friction_loss",
        category: "Friction Loss",
        severity: "warning",
        title: "Friction gradient above typical design range",
        message: `Friction head loss is ${metric}. Common design guidance for pump station mains is ≤ 2 ft/100 ft; exceeding this increases energy costs and TDH significantly.`,
        recommendation: "Consider increasing the pipe diameter on the longest segment. Re-run hydraulics to verify the improvement.",
        metric,
      };
    }
    return {
      id: "friction_loss",
      category: "Friction Loss",
      severity: "info",
      title: "Friction gradient within acceptable range",
      message: `Friction head loss is ${metric} — within typical design limits for potable pump station mains.`,
      recommendation: "No action required.",
      metric,
    };
  }

  const metric = `${round(per100m, 2)} m / 100 m`;

  if (per100m > 10) {
    return {
      id: "friction_loss",
      category: "Friction Loss",
      severity: "critical",
      title: "Friction gradient critically high",
      message: `Friction head loss is ${metric}. This far exceeds the typical guideline of ≤ 5 m/100 m for pump station mains, indicating severe pipe undersizing and very high energy consumption.`,
      recommendation: "Increase pipe diameter immediately. For long runs, evaluate economic pipe sizing (EPS) to find the optimum life-cycle diameter.",
      metric,
    };
  }

  if (per100m > 5) {
    return {
      id: "friction_loss",
      category: "Friction Loss",
      severity: "warning",
      title: "Friction gradient above typical design range",
      message: `Friction head loss is ${metric}. Common design guidance for pump station mains is ≤ 5 m/100 m; exceeding this increases energy costs and TDH significantly.`,
      recommendation: "Consider increasing the pipe diameter on the longest or smallest-diameter segment. Re-run hydraulics to verify the improvement.",
      metric,
    };
  }

  return {
    id: "friction_loss",
    category: "Friction Loss",
    severity: "info",
    title: "Friction gradient within acceptable range",
    message: `Friction head loss is ${metric} — within typical design limits for potable pump station mains.`,
    recommendation: "No action required.",
    metric,
  };
}

/**
 * Check 3 — NPSH margin (NPSHa − NPSHr) per HI 9.6.3.
 * Thresholds:
 *   Warning  : margin < 0.6 m (2 ft) above NPSHr
 *   Critical : margin ≤ 0 (cavitation likely)
 */
function checkNpsh(draft: ProjectDraft, isUS: boolean): CheckResult {
  const pr = draft.pumpResult;

  if (!pr || pr.operating_points.length === 0) {
    return {
      id: "npsh",
      category: "NPSH Margin",
      severity: "info",
      title: "NPSH margin — awaiting pump compute",
      message: "Run the pump curve analysis on Step 5 or Step 7 to evaluate NPSH margin.",
      recommendation: "Complete the pump computation to unlock this check.",
      skipped: true,
    };
  }

  const op = pr.operating_points[0];

  if (op.npsh_margin_m === null) {
    return {
      id: "npsh",
      category: "NPSH Margin",
      severity: "info",
      title: "NPSH margin — insufficient data",
      message: "NPSHa or NPSHr was not provided; margin cannot be evaluated.",
      recommendation: "Enter NPSHa in the Pump Curves step and ensure an NPSHr curve is available for the selected pump.",
      skipped: true,
    };
  }

  const margin = op.npsh_margin_m;
  const displayMargin = isUS ? margin * 3.28084 : margin;
  const unit = isUS ? "ft" : "m";
  const metric = `${round(displayMargin, 2)} ${unit} margin`;

  if (margin <= 0) {
    return {
      id: "npsh",
      category: "NPSH Margin",
      severity: "critical",
      title: "Cavitation likely — NPSHa ≤ NPSHr",
      message: `NPSH margin is ${metric}. The available net positive suction head is at or below the pump's required NPSH, meaning cavitation is expected at the design operating point.`,
      recommendation: "Lower the pump installation elevation, increase the suction pipe diameter, shorten the suction run, reduce suction-side fittings, or select a low-NPSH impeller. Consider adding suction-side pressurization.",
      metric,
    };
  }

  if (margin < 0.6) {
    return {
      id: "npsh",
      category: "NPSH Margin",
      severity: "warning",
      title: "NPSH margin below HI 9.6.3 recommended minimum",
      message: `NPSH margin is ${metric}. HI Standard 9.6.3 recommends a minimum margin of 0.6 m (2 ft) above NPSHr to account for suction piping losses and operating variability.`,
      recommendation: "Review suction piping layout. Lowering the pump or upsizing the suction line are the most effective remedies. Alternatively, throttle the discharge slightly to move the operating point left on the curve.",
      metric,
    };
  }

  return {
    id: "npsh",
    category: "NPSH Margin",
    severity: "info",
    title: "NPSH margin satisfactory",
    message: `NPSH margin is ${metric} — above the HI 9.6.3 recommended minimum of 0.6 m (2 ft).`,
    recommendation: "No action required. Verify this margin holds at the maximum design flow.",
    metric,
  };
}

/**
 * Check 4 — Wet well cycling rate vs AWWA M32.
 * Derived analytically from ClearwellFormConfig without a stored API result.
 * Uses the first pump stage and constant inflow. If hourly inflow, uses the
 * 24-h average. The analytical worst-case formula for max cycles/hr:
 *   C_max = Q_pump / (4 · V_op)        [Q in m³/h, V in m³]
 * which applies when Q_in = Q_pump / 2.
 */
function checkCycling(draft: ProjectDraft, isUS: boolean): CheckResult {
  const cfg = draft.clearwellConfig;

  if (!cfg) {
    return {
      id: "cycling",
      category: "Wet Well Cycling",
      severity: "info",
      title: "Wet well cycling — configuration not yet set",
      message: "Visit Step 4 (Wet Well Sizing) to configure the wet well geometry and pump stages.",
      recommendation: "Complete the wet well configuration to unlock this check.",
      skipped: true,
    };
  }

  const firstStage = cfg.pump_stages[0];
  if (!firstStage) {
    return {
      id: "cycling",
      category: "Wet Well Cycling",
      severity: "info",
      title: "Wet well cycling — no pump stage defined",
      message: "No pump stage is configured on Step 4.",
      recommendation: "Add at least one pump stage to the wet well configuration.",
      skipped: true,
    };
  }

  // Operating volume between LWL and HWL
  let V_op_m3 = 0;
  if (cfg.shape === "cylindrical" && cfg.diameter_m) {
    const r = cfg.diameter_m / 2;
    V_op_m3 = Math.PI * r * r * (cfg.HWL_m - cfg.LWL_m);
  } else if (cfg.shape === "rectangular" && cfg.length_m && cfg.width_m) {
    V_op_m3 = cfg.length_m * cfg.width_m * (cfg.HWL_m - cfg.LWL_m);
  }

  if (V_op_m3 <= 0) {
    return {
      id: "cycling",
      category: "Wet Well Cycling",
      severity: "info",
      title: "Wet well cycling — cannot compute volume",
      message: "Operating volume could not be computed from the current wet well geometry.",
      recommendation: "Check that the wet well dimensions (diameter / length × width) and levels are entered correctly on Step 4.",
      skipped: true,
    };
  }

  const Q_pump_m3h = firstStage.Q_pump_m3h;

  // Average inflow
  let Q_in_m3h = 0;
  if (cfg.inflow_type === "constant" && cfg.Q_in_m3h) {
    Q_in_m3h = cfg.Q_in_m3h;
  } else {
    const total = cfg.hourly_Q.reduce((a, h) => a + h.Q, 0);
    Q_in_m3h = total / Math.max(cfg.hourly_Q.length, 1);
  }

  // Worst-case cycles/hr: C = Q_pump · Q_in / (V_op · (Q_pump - Q_in)) * (1/4) ... derived from fill+drain
  // General formula: C = (Q_pump - Q_in) * Q_in / (Q_pump * V_op) * 60  — in cycles/hr when V in m³, Q in m³/min
  // Using m³/h: C = (Q_pump - Q_in) * Q_in / (Q_pump * V_op)  cycles/hr
  let cycles_per_hour = 0;
  if (Q_pump_m3h > Q_in_m3h && Q_in_m3h > 0) {
    const Q_net_drain = Q_pump_m3h - Q_in_m3h;
    const t_drain_h   = V_op_m3 / Q_net_drain;
    const t_fill_h    = V_op_m3 / Q_in_m3h;
    const t_cycle_h   = t_drain_h + t_fill_h;
    cycles_per_hour   = t_cycle_h > 0 ? 1 / t_cycle_h : 0;
  } else if (Q_pump_m3h <= Q_in_m3h) {
    // Pump cannot keep up — no cycling, continuous run
    const V_op_display = isUS ? V_op_m3 * 264.172 : V_op_m3;
    const unit = isUS ? "gal" : "m³";
    return {
      id: "cycling",
      category: "Wet Well Cycling",
      severity: "warning",
      title: "Pump capacity ≤ inflow — continuous operation expected",
      message: `The first pump stage (${round(Q_pump_m3h, 1)} m³/h) cannot drain faster than the inflow (${round(Q_in_m3h, 1)} m³/h). The wet well will overflow unless a second pump stage is added. Operating volume = ${round(V_op_display, 1)} ${unit}.`,
      recommendation: "Add a larger pump stage or reduce the design inflow. Verify the inflow assumptions.",
      metric: `Q_pump ≤ Q_in`,
    };
  }

  const maxAllowed = cfg.max_cycles_per_hour;
  const metric = `${round(cycles_per_hour, 1)} starts/hr`;

  if (cycles_per_hour > maxAllowed) {
    return {
      id: "cycling",
      category: "Wet Well Cycling",
      severity: "warning",
      title: "Pump start frequency exceeds limit",
      message: `Estimated cycling rate is ${metric}, exceeding the configured maximum of ${maxAllowed} starts/hr (AWWA M32 motor protection guidance). Analytical worst case at Q_in = ${round(Q_in_m3h, 1)} m³/h; operating volume = ${round(V_op_m3, 1)} m³.`,
      recommendation: "Add a VFD to modulate pump speed and eliminate cycling, or increase the wet well operating volume (raise HWL or deepen the well) to reduce starts per hour.",
      metric,
    };
  }

  return {
    id: "cycling",
    category: "Wet Well Cycling",
    severity: "info",
    title: "Pump cycling within acceptable limit",
    message: `Estimated cycling rate is ${metric} — within the configured maximum of ${maxAllowed} starts/hr. Operating volume = ${round(V_op_m3, 1)} m³.`,
    recommendation: "No action required. Recheck if inflow varies significantly from the constant rate assumed.",
    metric,
  };
}

/**
 * Check 5 — Pump duty point location on the H-Q curve (HI 9.6.3 preferred
 * operating region).
 * Uses the first operating point's Q and the hq_curve extent.
 * Preferred region: 70–110 % of BEP flow.
 * We approximate BEP as 75 % of the max-Q curve point (common centrifugal fit).
 * Simpler guards: warn if Q_op < 15 % or > 85 % of max-curve-Q; critical > 95 %.
 */
function checkDutyPoint(draft: ProjectDraft): CheckResult {
  const pr = draft.pumpResult;

  if (!pr || pr.operating_points.length === 0) {
    return {
      id: "duty_point",
      category: "Pump Duty Point",
      severity: "info",
      title: "Duty point — awaiting pump compute",
      message: "Run the pump curve analysis on Step 5 or Step 7 to evaluate the duty point location.",
      recommendation: "Complete the pump computation to unlock this check.",
      skipped: true,
    };
  }

  const op = pr.operating_points[0];
  const curve = pr.hq_curve;

  if (!curve || curve.length < 2) {
    return {
      id: "duty_point",
      category: "Pump Duty Point",
      severity: "info",
      title: "Duty point — insufficient curve data",
      message: "The pump H-Q curve does not have enough points to evaluate duty point location.",
      recommendation: "Add more H-Q curve points on Step 5.",
      skipped: true,
    };
  }

  const Qmax = Math.max(...curve.map((p) => p.Q_m3h));
  const Qmin = Math.min(...curve.map((p) => p.Q_m3h));
  const range = Qmax - Qmin;

  if (range <= 0) {
    return {
      id: "duty_point",
      category: "Pump Duty Point",
      severity: "info",
      title: "Duty point — curve range is zero",
      message: "The H-Q curve Q range is zero; location check not possible.",
      recommendation: "Provide a valid H-Q curve with at least two distinct flow points.",
      skipped: true,
    };
  }

  const Q_op = op.Q_m3h;
  const fracOfMax = range > 0 ? (Q_op - Qmin) / range : 0.5;
  const metric = `Q_op = ${round(Q_op, 1)} m³/h (${round(fracOfMax * 100, 0)}% of curve)`;

  if (fracOfMax > 0.95) {
    return {
      id: "duty_point",
      category: "Pump Duty Point",
      severity: "critical",
      title: "Pump operating near runout — overload and cavitation risk",
      message: `Operating point ${metric}. At near-runout conditions (>95% of max curve Q), the pump draws maximum shaft power, NPSH requirement spikes, and efficiency drops sharply. Impeller and motor damage are likely.`,
      recommendation: "Select a larger pump or reduce design flow. If flow must stay constant, increase static head by throttling discharge or selecting a steeper curve pump.",
      metric,
    };
  }

  if (fracOfMax > 0.85) {
    return {
      id: "duty_point",
      category: "Pump Duty Point",
      severity: "warning",
      title: "Pump operating near runout — reduced efficiency and NPSH risk",
      message: `Operating point ${metric}. HI 9.6.3 preferred operating region (POR) typically ends at ~110% of BEP flow. Operating near runout increases hydraulic noise, vibration, and NPSH demand.`,
      recommendation: "Consider a steeper pump curve or verify that NPSHa is adequate at this flow. Alternatively, trim the impeller slightly to shift the curve.",
      metric,
    };
  }

  if (fracOfMax < 0.15) {
    return {
      id: "duty_point",
      category: "Pump Duty Point",
      severity: "warning",
      title: "Pump operating near shutoff — recirculation and overheating risk",
      message: `Operating point ${metric}. Operating near shutoff (<15% of curve Q) risks internal recirculation, suction vortexing, temperature rise in the casing, and premature bearing wear.`,
      recommendation: "Select a pump with a lower shutoff head or increase the design flow. A VFD to reduce speed at low-demand conditions can also help avoid shutoff operation.",
      metric,
    };
  }

  return {
    id: "duty_point",
    category: "Pump Duty Point",
    severity: "info",
    title: "Duty point within acceptable operating range",
    message: `Operating point ${metric} — within the central preferred operating region of the H-Q curve.`,
    recommendation: "Confirm the point is also within the pump manufacturer's allowable operating range (AOR).",
    metric,
  };
}

/**
 * Check 6 — N+1 redundancy compliance (AWWA M32 / Ten States Standards).
 * Uses pumpSelectionConfig.nDuty and nStandby.
 * Rule: nStandby ≥ 1 always; for nDuty ≥ 2, nStandby ≥ 1 is still required.
 */
function checkRedundancy(draft: ProjectDraft): CheckResult {
  const sel = draft.pumpSelectionConfig;

  if (!sel) {
    return {
      id: "redundancy",
      category: "Redundancy (N+1)",
      severity: "info",
      title: "Redundancy — configuration not yet set",
      message: "Visit Step 5 (Pump Selection) to configure duty and standby pump counts.",
      recommendation: "Complete the pump selection configuration to unlock this check.",
      skipped: true,
    };
  }

  const { nDuty, nStandby } = sel;
  const total = nDuty + nStandby;
  const metric = `${nDuty}D + ${nStandby}S = ${total} total`;

  if (nStandby < 1) {
    return {
      id: "redundancy",
      category: "Redundancy (N+1)",
      severity: "critical",
      title: "No standby pump — fails N+1 redundancy requirement",
      message: `Configuration is ${metric}. Ten States Standards (Recommended Standards for Water Works) and AWWA M32 require at least one standby pump for all municipal pump stations. A single-pump station risks service interruption on any failure.`,
      recommendation: "Add at least one standby pump of equal or greater capacity to the duty configuration.",
      metric,
    };
  }

  if (nDuty >= 3 && nStandby < 2) {
    return {
      id: "redundancy",
      category: "Redundancy (N+1)",
      severity: "warning",
      title: "Consider additional standby for large multi-pump station",
      message: `Configuration is ${metric}. With ${nDuty} duty pumps, losing a single standby may not fully protect peak-demand delivery if another pump fails during the repair window.`,
      recommendation: "For ≥3 duty pumps, consider 2 standby units or a fire-pump-rated spare. Confirm with the authority having jurisdiction (AHJ) for any specific requirement.",
      metric,
    };
  }

  return {
    id: "redundancy",
    category: "Redundancy (N+1)",
    severity: "info",
    title: "N+1 redundancy requirement met",
    message: `Configuration is ${metric} — satisfies the N+1 requirement for municipal pump stations.`,
    recommendation: "Confirm standby pump is wired to alternate power feed or emergency generator.",
    metric,
  };
}

/**
 * Check 7 — Minor losses dominance.
 * Uses hydraulicsResult.minor_head_m / hydraulicsResult.tdh_m.
 * Thresholds:
 *   Warning  : minor > 25 % of TDH
 *   Critical : minor > 40 % of TDH
 */
function checkMinorLosses(draft: ProjectDraft, isUS: boolean): CheckResult {
  const r = draft.hydraulicsResult;

  if (!r) {
    return {
      id: "minor_losses",
      category: "Minor Losses",
      severity: "info",
      title: "Minor losses — awaiting hydraulic compute",
      message: "Run 'Compute Hydraulics' on Step 7 to evaluate minor loss dominance.",
      recommendation: "Complete the hydraulic computation to unlock this check.",
      skipped: true,
    };
  }

  if (r.tdh_m <= 0) {
    return {
      id: "minor_losses",
      category: "Minor Losses",
      severity: "info",
      title: "Minor losses — TDH is zero",
      message: "TDH is zero; proportion check not meaningful.",
      recommendation: "Check pipeline and node elevation inputs.",
      skipped: true,
    };
  }

  const fraction = pct(r.minor_head_m, r.tdh_m);
  const minorDisplay = isUS ? r.minor_head_m * 3.28084 : r.minor_head_m;
  const unit = isUS ? "ft" : "m";
  const metric = `${round(fraction, 1)} % of TDH (${round(minorDisplay, 2)} ${unit})`;

  if (fraction > 40) {
    return {
      id: "minor_losses",
      category: "Minor Losses",
      severity: "critical",
      title: "Minor losses dominate system head — excessive fittings/valves",
      message: `Minor (fitting) losses account for ${metric}. This suggests an excessive number or high-resistance type of fittings. At this fraction, fitting selection and placement drive most of the pump energy cost.`,
      recommendation: "Review all fittings in the accessories list. Replace globe valves or needle valves with gate valves or butterfly valves (lower K). Eliminate unnecessary bends and tees. Consider increasing pipe diameter to reduce velocity head.",
      metric,
    };
  }

  if (fraction > 25) {
    return {
      id: "minor_losses",
      category: "Minor Losses",
      severity: "warning",
      title: "Minor losses contribute more than 25% of TDH",
      message: `Minor (fitting) losses account for ${metric}. While not critical, this fraction warrants a fitting review to identify high-K items that could be eliminated or replaced.`,
      recommendation: "Check the loss breakdown panel for high-K contributors (strainers, control valves, globe valves). Replacing a single high-K fitting can save significant head loss.",
      metric,
    };
  }

  return {
    id: "minor_losses",
    category: "Minor Losses",
    severity: "info",
    title: "Minor losses within acceptable proportion",
    message: `Minor (fitting) losses account for ${metric} of TDH — within the typical design range (< 25 %).`,
    recommendation: "No action required. Revisit if additional fittings are added.",
    metric,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run all engineering checks against a ProjectDraft.
 * Results are ordered: Critical → Warning → Info.
 * Skipped checks appear at the end as Info items.
 */
export function runChecks(draft: ProjectDraft): CheckResult[] {
  const isUS = draft.unitSystem === "US";

  const raw: CheckResult[] = [
    checkVelocity(draft, isUS),
    checkFrictionLoss(draft, isUS),
    checkNpsh(draft, isUS),
    checkCycling(draft, isUS),
    checkDutyPoint(draft),
    checkRedundancy(draft),
    checkMinorLosses(draft, isUS),
  ];

  const order: Record<CheckSeverity, number> = { critical: 0, warning: 1, info: 2 };

  return [...raw].sort((a, b) => {
    // skipped checks always last within their severity
    if (a.skipped !== b.skipped) return a.skipped ? 1 : -1;
    return order[a.severity] - order[b.severity];
  });
}

/** Returns a summary string suitable for inclusion in plain-text / CSV exports. */
export function checksToText(checks: CheckResult[]): string {
  const lines: string[] = ["ENGINEERING CHECKS", "=================="];
  for (const c of checks) {
    const sev = c.severity.toUpperCase().padEnd(8);
    const skip = c.skipped ? " [SKIPPED]" : "";
    lines.push(`[${sev}] ${c.category}${skip}`);
    lines.push(`  ${c.title}`);
    if (!c.skipped) {
      lines.push(`  ${c.message}`);
      lines.push(`  → ${c.recommendation}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
