/**
 * Engineering Checks — pure TypeScript module.
 *
 * Derives structured check results from an already-computed ProjectDraft.
 * No API calls. All thresholds are hard-coded industry standards (AWWA M11,
 * AWWA M32, HI 9.6.3, Ten States Standards, common potable-water practice).
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

/** Total pipe length (m) across all suction + discharge segments. */
function totalPipeLength(draft: ProjectDraft): number {
  const sLen = draft.suction.segments.reduce((a, s) => a + s.length_m, 0);
  const dLen = draft.discharge.segments.reduce((a, s) => a + s.length_m, 0);
  return sLen + dLen;
}

function round(v: number, d = 2): string {
  return v.toFixed(d);
}

/** Compute velocity (m/s) from flow (m³/h) and internal pipe diameter (mm). */
function velocityFromGeometry(Q_m3h: number, diameter_mm: number): number | null {
  if (Q_m3h <= 0 || diameter_mm <= 0) return null;
  const A = Math.PI * Math.pow(diameter_mm / 1000 / 2, 2);
  return (Q_m3h / 3600) / A;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Check 1a — Suction pipe velocity vs AWWA M11 potable-water recommendations.
 * Requires hydraulicsResult to be present (skips when absent).
 * Velocity computed from designFlow_m3h + first suction segment diameter.
 * Recommended range: 0.9–3.0 m/s.
 * Warning : > 3.0 m/s  OR  < 0.9 m/s
 * Critical: > 4.5 m/s
 */
function checkSuctionVelocity(draft: ProjectDraft, isUS: boolean): CheckResult {
  if (!draft.hydraulicsResult) {
    return {
      id: "velocity_suction",
      category: "Suction Velocity",
      severity: "info",
      title: "Suction velocity — awaiting hydraulic compute",
      message: "Run 'Compute Hydraulics' on Step 7 to enable the velocity checks.",
      recommendation: "Complete the hydraulic computation to unlock this check.",
      skipped: true,
    };
  }

  const seg = draft.suction.segments[0];
  if (!seg) {
    return {
      id: "velocity_suction",
      category: "Suction Velocity",
      severity: "info",
      title: "Suction velocity — no suction segment defined",
      message: "No suction pipeline segment is configured.",
      recommendation: "Add a suction segment on Step 3.",
      skipped: true,
    };
  }

  const v = velocityFromGeometry(draft.designFlow_m3h, seg.diameter_mm);
  if (v === null) {
    return {
      id: "velocity_suction",
      category: "Suction Velocity",
      severity: "info",
      title: "Suction velocity — invalid geometry",
      message: "Design flow or suction diameter is zero.",
      recommendation: "Check flow and suction pipe diameter inputs.",
      skipped: true,
    };
  }

  const vDisplay = isUS ? v * 3.28084 : v;
  const unit = isUS ? "fps" : "m/s";
  const metric = `${round(vDisplay, 3)} ${unit}`;

  if (v > 4.5) {
    return {
      id: "velocity_suction",
      category: "Suction Velocity",
      severity: "critical",
      title: "Suction velocity critically high — erosion and cavitation risk",
      message: `Suction pipe velocity is ${metric}. Velocities above 4.5 m/s (15 fps) amplify NPSH demand, accelerate pipe wall erosion, and elevate water-hammer surge pressures. AWWA M11 recommended limit is 3.0 m/s (10 fps) for potable suction mains.`,
      recommendation: "Increase the suction pipe diameter immediately. Each nominal size increase typically reduces velocity by ~40%. Re-run hydraulics and review the NPSH check after the change.",
      metric,
    };
  }

  if (v > 3.0) {
    return {
      id: "velocity_suction",
      category: "Suction Velocity",
      severity: "warning",
      title: "Suction velocity above AWWA M11 recommended limit (3.0 m/s)",
      message: `Suction pipe velocity is ${metric}. AWWA M11 recommends ≤ 3.0 m/s (10 fps) for potable suction mains. Higher velocity increases friction head on the suction side, lowering NPSHa and raising cavitation risk.`,
      recommendation: "Increase the suction pipe diameter. Use a larger nominal size on the suction side than the discharge to protect NPSH margin. Re-run hydraulics to confirm improvement.",
      metric,
    };
  }

  if (v < 0.9) {
    return {
      id: "velocity_suction",
      category: "Suction Velocity",
      severity: "warning",
      title: "Suction velocity below AWWA M11 recommended minimum (0.9 m/s)",
      message: `Suction pipe velocity is ${metric}. AWWA M11 recommends ≥ 0.9 m/s (3 fps) to maintain self-cleaning flow and adequate disinfectant residual in potable mains.`,
      recommendation: "Reduce the suction pipe diameter or increase the design flow. Oversized suction piping is a common cause of low velocity.",
      metric,
    };
  }

  return {
    id: "velocity_suction",
    category: "Suction Velocity",
    severity: "info",
    title: "Suction velocity within AWWA M11 recommended range",
    message: `Suction pipe velocity is ${metric} — within the AWWA M11 recommended range of 0.9–3.0 m/s (3–10 fps) for potable suction mains.`,
    recommendation: "No action required.",
    metric,
  };
}

/**
 * Check 1b — Discharge pipe velocity vs AWWA M11 potable-water recommendations.
 * Sources from hydraulicsResult.velocity_ms; skips gracefully when result absent.
 * Recommended range: 0.9–3.5 m/s (AWWA M11 — discharge mains allow slightly more).
 * Warning : > 3.0 m/s  OR  < 0.9 m/s
 * Critical: > 4.5 m/s
 */
function checkDischargeVelocity(draft: ProjectDraft, isUS: boolean): CheckResult {
  const r = draft.hydraulicsResult;

  if (!r) {
    return {
      id: "velocity_discharge",
      category: "Discharge Velocity",
      severity: "info",
      title: "Discharge velocity — awaiting hydraulic compute",
      message: "Run 'Compute Hydraulics' on Step 7 to evaluate discharge pipe velocity.",
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
      id: "velocity_discharge",
      category: "Discharge Velocity",
      severity: "critical",
      title: "Discharge velocity critically high — erosion and water-hammer risk",
      message: `Computed discharge pipe velocity is ${metric}. Velocities above 4.5 m/s (15 fps) cause pipe wall erosion, elevated operating noise, and dangerous water-hammer surge pressures on pump trip. AWWA M11 recommended limit for potable discharge mains is 3.5 m/s (11.5 fps).`,
      recommendation: "Increase the discharge pipe diameter immediately. Review the surge analysis (Step 9) to confirm transient pressures remain within the pipe pressure class rating.",
      metric,
    };
  }

  if (v > 3.0) {
    return {
      id: "velocity_discharge",
      category: "Discharge Velocity",
      severity: "warning",
      title: "Discharge velocity above recommended practice limit (3.0 m/s)",
      message: `Computed discharge pipe velocity is ${metric}. Common design practice recommends ≤ 3.0 m/s (10 fps) for potable pump-station discharge mains to limit friction losses, noise, and water-hammer surge. AWWA M11 allows up to 3.5 m/s (11.5 fps) as an upper bound.`,
      recommendation: "Consider increasing the discharge pipe diameter. Re-run hydraulics to verify the head loss improvement and update the surge analysis.",
      metric,
    };
  }

  if (v < 0.9) {
    return {
      id: "velocity_discharge",
      category: "Discharge Velocity",
      severity: "warning",
      title: "Discharge velocity below AWWA M11 recommended minimum (0.9 m/s)",
      message: `Computed discharge pipe velocity is ${metric}. AWWA M11 recommends ≥ 0.9 m/s (3 fps) in potable distribution mains to prevent sediment deposition and maintain disinfectant residual.`,
      recommendation: "Reduce the discharge pipe diameter or increase the design flow. Review whether the pipe is sized correctly for the design condition.",
      metric,
    };
  }

  return {
    id: "velocity_discharge",
    category: "Discharge Velocity",
    severity: "info",
    title: "Discharge velocity within recommended range",
    message: `Computed discharge pipe velocity is ${metric} — within the recommended range of 0.9–3.5 m/s (3–11.5 fps) for potable pump-station discharge mains (AWWA M11).`,
    recommendation: "No action required.",
    metric,
  };
}

/**
 * Check 2 — Friction head loss gradient per 100 m (or per 100 ft).
 * Gradient is a dimensionless ratio: m/m = ft/ft (numerically identical).
 * Thresholds:
 *   SI : warn > 5 m/100 m; critical > 10 m/100 m
 *   US : warn > 2.4 ft/100 ft; critical > 4.8 ft/100 ft
 */
function checkFrictionLoss(draft: ProjectDraft, isUS: boolean): CheckResult {
  const r = draft.hydraulicsResult;

  if (!r) {
    return {
      id: "friction_loss",
      category: "Friction Loss",
      severity: "info",
      title: "Friction loss — awaiting hydraulic compute",
      message: "Run 'Compute Hydraulics' on Step 7 to evaluate friction head loss gradient.",
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

  // Gradient is dimensionless — the ratio m/m equals ft/ft numerically
  const gradient = (r.friction_head_m / totalLen) * 100;

  // Gradient is dimensionless (ft/100ft = m/100m numerically).
  // Critical threshold is the same ratio in both unit systems (10).
  // Warning threshold follows each system's design practice (SI: 5, US: 2.4).
  const warnThreshold  = isUS ? 2.4 : 5.0;
  const critThreshold  = 10.0;
  const unitLabel      = isUS ? "ft/100 ft" : "m/100 m";
  const metric         = `${round(gradient, 2)} ${unitLabel}`;

  if (gradient > critThreshold) {
    return {
      id: "friction_loss",
      category: "Friction Loss",
      severity: "critical",
      title: "Friction gradient critically high — severe pipe undersizing",
      message: `Friction head loss gradient is ${metric}, well above the design limit of ${critThreshold} ${unitLabel}. This indicates severe pipe undersizing with very high energy consumption and TDH.`,
      recommendation: "Increase pipe diameter on the bottleneck segment(s). Consider economic pipe sizing (EPS) analysis to find the life-cycle optimum. Re-run hydraulics after each change.",
      metric,
    };
  }

  if (gradient > warnThreshold) {
    return {
      id: "friction_loss",
      category: "Friction Loss",
      severity: "warning",
      title: "Friction gradient above typical design range",
      message: `Friction head loss gradient is ${metric}, above the common design guideline of ${warnThreshold} ${unitLabel} for pump station mains. Exceeding this increases energy costs and TDH significantly.`,
      recommendation: "Consider increasing the pipe diameter on the longest or narrowest segment. Re-run hydraulics to verify the improvement in TDH.",
      metric,
    };
  }

  return {
    id: "friction_loss",
    category: "Friction Loss",
    severity: "info",
    title: "Friction gradient within acceptable range",
    message: `Friction head loss gradient is ${metric} — within the design guideline of ≤ ${warnThreshold} ${unitLabel} for potable pump station mains.`,
    recommendation: "No action required.",
    metric,
  };
}

/**
 * Check 3 — NPSH margin (NPSHa − NPSHr) per HI 9.6.3.
 * Uses the first pump operating point's cached margin from pumpResult.
 * Warning : margin < 0.6 m (2 ft) above NPSHr
 * Critical: margin ≤ 0 (cavitation likely)
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
      message: `NPSH margin is ${metric}. The available net positive suction head is at or below the pump's required NPSH; cavitation is expected at the design operating point, leading to impeller damage and flow instability.`,
      recommendation: "Lower the pump installation elevation, increase the suction pipe diameter, shorten the suction run, reduce suction fittings, or select a low-NPSH impeller design.",
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
      recommendation: "Review suction piping layout. Lowering the pump installation or upsizing the suction line are the most effective remedies. Alternatively, throttle discharge slightly to move the operating point left.",
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
 * Uses clearwellResult.cycle_results[0].cycles_per_hour when a cached API
 * result exists; falls back to analytical approximation from config otherwise.
 * Warning: cycles_per_hour > max_cycles_per_hour config value.
 */
function checkCycling(draft: ProjectDraft, _isUS?: boolean): CheckResult {
  const cfg = draft.clearwellConfig;

  if (!cfg) {
    return {
      id: "cycling",
      category: "Clearwell Cycling",
      severity: "info",
      title: "Clearwell cycling — configuration not yet set",
      message: "Visit Step 4 (Clearwell Sizing) to configure the clearwell geometry and pump stages.",
      recommendation: "Complete the clearwell configuration to unlock this check.",
      skipped: true,
    };
  }

  const maxAllowed = cfg.max_cycles_per_hour;

  // ── Prefer the cached API result from clearwellResult ──────────────────────
  const cachedResult = draft.clearwellResult;
  if (cachedResult && cachedResult.active && cachedResult.cycle_results.length > 0) {
    const cr = cachedResult.cycle_results[0];
    const cycles = cr.cycles_per_hour;
    const metric = `${round(cycles, 1)} starts/hr (from Step 4 compute)`;

    if (!cr.cycles_ok || cycles > maxAllowed) {
      return {
        id: "cycling",
        category: "Clearwell Cycling",
        severity: "warning",
        title: "Pump start frequency exceeds configured maximum",
        message: `Computed cycling rate is ${metric}, exceeding the configured maximum of ${maxAllowed} starts/hr (AWWA M32 motor protection guidance). Stage: ${cr.label}, Q_pump = ${round(cr.Q_pump_m3h, 1)} m³/h.`,
        recommendation: "Add a VFD to modulate pump speed and eliminate discrete cycling, or increase the clearwell operating volume (raise HWL or deepen the well) to reduce starts per hour.",
        metric,
      };
    }

    return {
      id: "cycling",
      category: "Clearwell Cycling",
      severity: "info",
      title: "Pump cycling within acceptable limit",
      message: `Computed cycling rate is ${metric} — within the configured maximum of ${maxAllowed} starts/hr (AWWA M32).`,
      recommendation: "No action required. Recheck if inflow varies significantly from the assumed profile.",
      metric,
    };
  }

  // ── Analytical fallback from config when no computed result exists ──────────
  const firstStage = cfg.pump_stages[0];
  if (!firstStage) {
    return {
      id: "cycling",
      category: "Clearwell Cycling",
      severity: "info",
      title: "Clearwell cycling — no pump stage defined",
      message: "No pump stage is configured on Step 4.",
      recommendation: "Add at least one pump stage, then run the clearwell compute to get an accurate cycling rate.",
      skipped: true,
    };
  }

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
      category: "Clearwell Cycling",
      severity: "info",
      title: "Clearwell cycling — cannot compute volume",
      message: "Operating volume could not be derived from the current clearwell geometry. Run the clearwell compute on Step 4 for an accurate result.",
      recommendation: "Check that clearwell dimensions and levels are entered correctly, then compute on Step 4.",
      skipped: true,
    };
  }

  const Q_pump_m3h = firstStage.Q_pump_m3h;
  let Q_in_m3h = 0;
  if (cfg.inflow_type === "constant" && cfg.Q_in_m3h) {
    Q_in_m3h = cfg.Q_in_m3h;
  } else {
    const total = cfg.hourly_Q.reduce((a, h) => a + h.Q, 0);
    Q_in_m3h = total / Math.max(cfg.hourly_Q.length, 1);
  }

  let cycles_per_hour = 0;
  if (Q_pump_m3h > Q_in_m3h && Q_in_m3h > 0) {
    const Q_net_drain = Q_pump_m3h - Q_in_m3h;
    const t_drain_h   = V_op_m3 / Q_net_drain;
    const t_fill_h    = V_op_m3 / Q_in_m3h;
    const t_cycle_h   = t_drain_h + t_fill_h;
    cycles_per_hour   = t_cycle_h > 0 ? 1 / t_cycle_h : 0;
  } else if (Q_pump_m3h <= Q_in_m3h) {
    return {
      id: "cycling",
      category: "Clearwell Cycling",
      severity: "warning",
      title: "Pump capacity ≤ inflow — continuous operation or overflow",
      message: `The first pump stage (${round(Q_pump_m3h, 1)} m³/h) cannot drain faster than the configured inflow (${round(Q_in_m3h, 1)} m³/h). The clearwell will overflow unless a second pump stage is activated. Run Step 4 compute for detailed analysis.`,
      recommendation: "Add a larger pump stage or verify the inflow assumption. Consider an emergency overflow design.",
      metric: `Q_pump ≤ Q_in`,
    };
  }

  const note = " (analytical estimate — run Step 4 compute for accuracy)";
  const metric = `${round(cycles_per_hour, 1)} starts/hr${note}`;

  if (cycles_per_hour > maxAllowed) {
    return {
      id: "cycling",
      category: "Clearwell Cycling",
      severity: "warning",
      title: "Estimated pump start frequency exceeds maximum",
      message: `Analytical cycling estimate is ${metric}, exceeding the configured maximum of ${maxAllowed} starts/hr (AWWA M32). This uses Q_in = ${round(Q_in_m3h, 1)} m³/h and operating volume = ${round(V_op_m3, 1)} m³.`,
      recommendation: "Add a VFD to modulate pump speed and eliminate cycling, or increase the clearwell operating volume. Run the Step 4 compute to confirm.",
      metric,
    };
  }

  return {
    id: "cycling",
    category: "Clearwell Cycling",
    severity: "info",
    title: "Estimated cycling within acceptable limit",
    message: `Analytical cycling estimate is ${metric} — within the configured maximum of ${maxAllowed} starts/hr.`,
    recommendation: "Run the clearwell compute on Step 4 to confirm with the detailed API result.",
    metric,
  };
}

/**
 * Check 5 — Pump duty point location on the H-Q curve (HI 9.6.3 preferred
 * operating region). Uses first pump operating point + hq_curve extent.
 * Warning : Q_op < 15% (near shutoff) or > 85% (near runout) of curve Q range
 * Critical: Q_op > 95% of curve Q range
 */
function checkDutyPoint(draft: ProjectDraft, _isUS?: boolean): CheckResult {
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
      title: "Duty point — curve Q range is zero",
      message: "The H-Q curve Q range is zero; location check not possible.",
      recommendation: "Provide a valid H-Q curve with at least two distinct flow values.",
      skipped: true,
    };
  }

  const Q_op = op.Q_m3h;
  const fracOfMax = (Q_op - Qmin) / range;
  const metric = `Q_op = ${round(Q_op, 1)} m³/h (${round(fracOfMax * 100, 0)}% of curve range)`;

  if (fracOfMax > 0.95) {
    return {
      id: "duty_point",
      category: "Pump Duty Point",
      severity: "critical",
      title: "Pump operating near runout — overload and cavitation risk",
      message: `Operating point ${metric}. At near-runout conditions (>95% of H-Q curve range), shaft power peaks, NPSH requirement spikes, and efficiency collapses. Impeller and motor damage are likely with sustained operation.`,
      recommendation: "Select a larger pump or reduce the design flow. If flow must stay constant, increase static head by throttling discharge, or choose a pump with a steeper curve.",
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
      recommendation: "Consider a steeper pump curve or verify NPSHa is adequate at this flow. Trimming the impeller slightly can also shift the curve left.",
      metric,
    };
  }

  if (fracOfMax < 0.15) {
    return {
      id: "duty_point",
      category: "Pump Duty Point",
      severity: "warning",
      title: "Pump operating near shutoff — recirculation and overheating risk",
      message: `Operating point ${metric}. Operating near shutoff (<15% of H-Q curve range) risks internal recirculation, suction vortexing, temperature rise in the casing, and premature bearing wear.`,
      recommendation: "Select a pump with a lower shutoff head, increase the design flow, or add a VFD to reduce speed at low-demand conditions to avoid near-shutoff operation.",
      metric,
    };
  }

  return {
    id: "duty_point",
    category: "Pump Duty Point",
    severity: "info",
    title: "Duty point within acceptable operating range",
    message: `Operating point ${metric} — within the central preferred operating region of the H-Q curve.`,
    recommendation: "Confirm the point also falls within the pump manufacturer's allowable operating range (AOR).",
    metric,
  };
}

/**
 * Check 6 — N+1 redundancy compliance (AWWA M32 / Ten States Standards).
 * Uses pumpSelectionConfig.nDuty and nStandby.
 * Rules (per specification):
 *   Warning  : nStandby < 1 AND nDuty = 1 (sole duty pump has no backup)
 *   Critical : nStandby < 1 AND nDuty > 1 (multi-duty station with no standby)
 * Advisory   : nDuty ≥ 3 with only 1 standby
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

  if (nStandby < 1 && nDuty > 1) {
    return {
      id: "redundancy",
      category: "Redundancy (N+1)",
      severity: "critical",
      title: "No standby pump in multi-pump station — N+1 requirement not met",
      message: `Configuration is ${metric}. Ten States Standards and AWWA M32 require at least one standby pump. A multi-duty station (${nDuty} duty pumps) with no standby means a single pump failure drops capacity to ${Math.round((1 - 1/nDuty)*100)}% — or causes a full service outage if all pumps are needed for peak demand.`,
      recommendation: "Add at least one standby pump of equal or greater capacity. For critical supply stations, consider 2 standby pumps.",
      metric,
    };
  }

  if (nStandby < 1) {
    // nDuty <= 1: single duty pump with no standby — warning level
    return {
      id: "redundancy",
      category: "Redundancy (N+1)",
      severity: "warning",
      title: "No standby pump — fails N+1 redundancy requirement",
      message: `Configuration is ${metric}. Ten States Standards (Recommended Standards for Water Works) and AWWA M32 require at least one standby pump for all municipal pump stations. A single-pump station risks complete service interruption on any failure or maintenance outage.`,
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
      message: `Configuration is ${metric}. With ${nDuty} duty pumps, losing the single standby during a repair window leaves the station with no backup for subsequent failures.`,
      recommendation: "For ≥3 duty pumps, consider 2 standby units. Confirm any specific AHJ requirement.",
      metric,
    };
  }

  return {
    id: "redundancy",
    category: "Redundancy (N+1)",
    severity: "info",
    title: "N+1 redundancy requirement met",
    message: `Configuration is ${metric} — satisfies the N+1 requirement for municipal pump stations.`,
    recommendation: "Confirm standby pump is wired to an alternate power feed or emergency generator per AWWA M32.",
    metric,
  };
}

/**
 * Check 7 — Minor losses dominance.
 * Uses hydraulicsResult.minor_head_m / hydraulicsResult.tdh_m.
 * Warning : minor > 25% of TDH
 * Critical: minor > 40% of TDH
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

  const fraction = r.minor_head_m / r.tdh_m * 100;
  const minorDisplay = isUS ? r.minor_head_m * 3.28084 : r.minor_head_m;
  const unit = isUS ? "ft" : "m";
  const metric = `${round(fraction, 1)}% of TDH (${round(minorDisplay, 2)} ${unit})`;

  if (fraction > 40) {
    return {
      id: "minor_losses",
      category: "Minor Losses",
      severity: "critical",
      title: "Minor losses dominate system head — excessive fittings or high-K valves",
      message: `Minor (fitting) losses account for ${metric}. At this fraction, fitting selection and placement drive most of the pump energy cost and TDH. This suggests either too many fittings or high-resistance valve types (globe, needle).`,
      recommendation: "Review all fittings in the accessories list. Replace globe/needle valves with gate or butterfly valves. Eliminate unnecessary bends and tees. Increasing pipe diameter also reduces velocity head and hence minor losses.",
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
    message: `Minor (fitting) losses account for ${metric} of TDH — within the typical design range (<25%).`,
    recommendation: "No action required. Revisit if additional fittings are added during detailed design.",
    metric,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run all engineering checks against a ProjectDraft.
 * Results are ordered: Critical → Warning → Info.
 * Skipped checks appear at the end of their respective severity group.
 */
export function runChecks(draft: ProjectDraft): CheckResult[] {
  const isUS = draft.unitSystem === "US";

  const raw: CheckResult[] = [
    checkSuctionVelocity(draft, isUS),
    checkDischargeVelocity(draft, isUS),
    checkFrictionLoss(draft, isUS),
    checkNpsh(draft, isUS),
    checkCycling(draft, isUS),
    checkDutyPoint(draft),
    checkRedundancy(draft),
    checkMinorLosses(draft, isUS),
  ];

  const order: Record<CheckSeverity, number> = { critical: 0, warning: 1, info: 2 };

  return [...raw].sort((a, b) => {
    if (a.skipped !== b.skipped) return a.skipped ? 1 : -1;
    return order[a.severity] - order[b.severity];
  });
}

/**
 * Returns a plain-text summary suitable for inclusion in reports or CSV exports.
 */
export function checksToText(checks: CheckResult[]): string {
  const lines: string[] = [
    "ENGINEERING CHECKS REPORT",
    "=========================",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];
  for (const c of checks) {
    const sev  = c.severity.toUpperCase().padEnd(8);
    const skip = c.skipped ? " [AWAITING DATA]" : "";
    lines.push(`[${sev}] ${c.category}${skip}`);
    lines.push(`  Finding: ${c.title}`);
    if (c.metric) lines.push(`  Metric : ${c.metric}`);
    if (!c.skipped) {
      lines.push(`  Detail : ${c.message}`);
      lines.push(`  Action : ${c.recommendation}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
