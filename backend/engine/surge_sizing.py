"""
Surge protection device boundary conditions and preliminary sizing helpers.

Five protection device types:
  1. Air vessel (hydropneumatic tank)  — AirVesselBC (stateful BC)
  2. Surge tank (open standpipe)       — SurgeTankBC (stateful BC)
  3. Pressure relief valve (PRV)       — apply_prv_postprocess()
  4. Vacuum relief valve               — apply_vacuum_relief_postprocess()
  5. Slow-closing check valve          — uses existing ValveClosureBC with new t_close

Engineering accuracy: all sizing formulas are screening-level (±30–50 %).
Full engineering design requires project-specific surge analysis per
AS 2941 / AWWA M11 / WIS 4-08-07.

References
----------
- Wylie & Streeter (1993) Fluid Transients in Systems, Ch. 7–8.
- Thorley, A. R. D. (2004) Fluid Transients in Pipeline Systems, Ch. 6.
- Chaudhry, M. H. (2014) Applied Hydraulic Transients 3rd ed., Ch. 10.
- AWWA Manual M51 — Air-Release, Air/Vacuum, and Combination Air Valves.
"""

from __future__ import annotations

import math

from backend.engine.surge_moc import BoundaryCondition

G: float = 9.81  # m/s²


# ---------------------------------------------------------------------------
# 1. Stateful boundary condition — Hydropneumatic Air Vessel
# ---------------------------------------------------------------------------

class AirVesselBC(BoundaryCondition):
    """
    Hydropneumatic air vessel (bladder or free-surface) at a pipeline boundary.

    The vessel absorbs or supplies flow to damp pressure transients.
    Gas pressure follows the polytropic law:

        P_gas × V_gas^n  =  P0 × V_gas_0^n

    where n = 1.4 (adiabatic) is the default for fast transients.

    Limitations (screening tool)
    ----------------------------
    - Vessel modelled at the pipeline boundary node only (inline vessel
      placement requires a modified grid with a junction node — extension point).
    - No orifice restriction between vessel and pipe; omitting is conservative
      for the maximum-pressure check.
    - Liquid phase change inside the vessel is not modelled.
    - Courant = 1 is enforced by the outer solver; dt is fixed.
    """

    def __init__(
        self,
        dt_s: float,
        V_total_m3: float,
        V_gas_0_m3: float,
        P0_kPa: float,
        rho_kg_m3: float = 1000.0,
        polytropic_n: float = 1.4,
    ) -> None:
        """
        Parameters
        ----------
        dt_s        : MOC time step [s]  — computed by build_grid()
        V_total_m3  : total vessel volume (gas + liquid) [m³]
        V_gas_0_m3  : initial gas volume at pre-charge pressure P0 [m³]
        P0_kPa      : initial gas pressure (gauge) [kPa]
        rho_kg_m3   : fluid density [kg/m³]
        polytropic_n: polytropic index (1.0 = isothermal, 1.4 = adiabatic)
        """
        self.dt      = dt_s
        self.V_tot   = V_total_m3
        self.V_gas   = V_gas_0_m3          # mutable — current gas volume [m³]
        self.V_gas_0 = V_gas_0_m3          # reference gas volume at P0
        self.P0      = P0_kPa * 1_000.0    # Pa (gauge)
        self.rho     = rho_kg_m3
        self.n       = polytropic_n
        # Initialise current gas head from pre-charge pressure
        self.H_tank  = self.P0 / (self.rho * G)

    def apply(
        self,
        t: float,
        cp_or_cm: float,
        B: float,
        is_upstream: bool,
    ) -> tuple[float, float]:
        H_P = self.H_tank  # boundary head = current gas-pressure head

        # Flow from pipe into vessel (positive = into vessel)
        if is_upstream:
            Q_P = (H_P - cp_or_cm) / B   # CM convention
        else:
            Q_P = (cp_or_cm - H_P) / B   # CP convention

        # Update gas volume: inflow → liquid rises → gas shrinks
        V_gas_new = self.V_gas - Q_P * self.dt

        # Physical bounds: prevent division-by-zero and overfill
        V_gas_min = max(1.0e-4, self.V_tot * 0.005)   # 0.5 % minimum gas pocket
        V_gas_new = max(V_gas_min, min(self.V_tot * 0.995, V_gas_new))

        # Polytropic pressure update
        P_new = self.P0 * (self.V_gas_0 / V_gas_new) ** self.n

        self.V_gas  = V_gas_new
        self.H_tank = P_new / (self.rho * G)

        return H_P, Q_P


# ---------------------------------------------------------------------------
# 2. Stateful boundary condition — Open Surge Tank (standpipe)
# ---------------------------------------------------------------------------

class SurgeTankBC(BoundaryCondition):
    """
    Open-surface surge tank (standpipe) at a pipeline boundary node.

    Water level z rises / falls with net pipe inflow / outflow.
    The boundary head equals the current water level (gauge, above datum).

    Limitations (screening tool)
    ----------------------------
    - Tank modelled at the pipeline boundary node only.
    - No overflow spill modelled beyond z_max (head is capped).
    - Column inertia inside the standpipe riser is neglected.
    - Friction losses in the connecting orifice / riser are not modelled.
    """

    def __init__(
        self,
        dt_s: float,
        A_tank_m2: float,
        z_initial_m: float,
        z_max_m: float,
    ) -> None:
        """
        Parameters
        ----------
        dt_s        : MOC time step [s]
        A_tank_m2   : tank cross-sectional area [m²]
        z_initial_m : initial water level in tank [m above datum]
        z_max_m     : maximum water level / overflow elevation [m]
        """
        self.dt    = dt_s
        self.A     = A_tank_m2
        self.z     = z_initial_m   # mutable — current water level [m]
        self.z_max = z_max_m

    def apply(
        self,
        t: float,
        cp_or_cm: float,
        B: float,
        is_upstream: bool,
    ) -> tuple[float, float]:
        H_P = self.z  # open-surface head = water level

        if is_upstream:
            # CM convention: Q_P > 0 → flow FROM tank INTO pipe → level drops
            Q_P = (H_P - cp_or_cm) / B
            dz  = -Q_P * self.dt / self.A
        else:
            # CP convention: Q_P > 0 → flow FROM pipe INTO tank → level rises
            Q_P = (cp_or_cm - H_P) / B
            dz  = Q_P * self.dt / self.A

        self.z = min(self.z_max, max(0.0, self.z + dz))

        return H_P, Q_P


# ---------------------------------------------------------------------------
# 3. PRV post-processing helper
# ---------------------------------------------------------------------------

def apply_prv_postprocess(
    raw: dict,
    H_set_m: float,
    rho_kg_m3: float = 1000.0,
) -> None:
    """
    Conservative post-processing model for a pressure relief valve (PRV).

    Caps the maximum head across the entire pressure envelope to H_set_m.
    This represents a fully effective, instantaneous PRV — a conservative
    upper bound for preliminary protection assessment.

    Modifies *raw* in-place (as returned by run_moc()).
    """
    for pt in raw["envelope"]:
        if pt["H_max_m"] > H_set_m:
            pt["H_max_m"]   = H_set_m
            pt["P_max_kPa"] = round(H_set_m * rho_kg_m3 * G / 1_000.0, 2)

    if raw["envelope"]:
        raw["global_max_H_m"]   = max(pt["H_max_m"]   for pt in raw["envelope"])
        raw["global_max_P_kPa"] = max(pt["P_max_kPa"] for pt in raw["envelope"])


# ---------------------------------------------------------------------------
# 4. Vacuum relief valve post-processing helper
# ---------------------------------------------------------------------------

def apply_vacuum_relief_postprocess(
    raw: dict,
    H_admit_m: float = 0.0,
    rho_kg_m3: float = 1000.0,
) -> None:
    """
    Conservative post-processing model for a vacuum relief (air-inlet) valve.

    Clamps minimum head across the entire pressure envelope to H_admit_m
    (default 0 m gauge = atmospheric).  Nodes below this head are assumed to
    admit air and hold atmospheric pressure instead of forming a vapour pocket.

    Modifies *raw* in-place.
    """
    for pt in raw["envelope"]:
        if pt["H_min_m"] < H_admit_m:
            pt["H_min_m"]   = H_admit_m
            pt["P_min_kPa"] = round(H_admit_m * rho_kg_m3 * G / 1_000.0, 2)

    if raw["envelope"]:
        raw["global_min_H_m"]   = min(pt["H_min_m"]   for pt in raw["envelope"])
        raw["global_min_P_kPa"] = min(pt["P_min_kPa"] for pt in raw["envelope"])

    # Air admission prevents column separation → clear cavitation nodes
    raw["cavitation_x_m"] = []


# ---------------------------------------------------------------------------
# Sizing helpers
# ---------------------------------------------------------------------------

def size_air_vessel(
    Q_0_m3s: float,
    a_ms: float,
    A_pipe_m2: float,
    H_0_m: float,
    H_max_target_m: float,
    polytropic_n: float = 1.4,
) -> dict:
    """
    Preliminary air vessel sizing — Thorley/Joukowsky screening method.

    Estimates the minimum initial gas volume V_gas_0 required to limit peak
    surge to H_max_target_m.  Accuracy ±30–50 %; apply ×1.5 safety factor.

    Returns
    -------
    dict with V_gas_0_m3, V_total_m3, P0_kPa, H_joukowsky_m, notes.
    """
    H_joukowsky = a_ms * Q_0_m3s / (G * max(A_pipe_m2, 1.0e-6))
    delta_H     = max(H_max_target_m - H_0_m, 0.1)

    # Screening formula: V_gas_0 ≈ a·Q₀² / (g·H₀·ΔH_target·0.5)
    V_gas_0_min = (a_ms * Q_0_m3s ** 2) / (G * max(H_0_m, 1.0) * delta_H * 0.5 + 1.0e-9)
    V_gas_0_rec = V_gas_0_min * 1.5     # ×1.5 safety factor

    # Pre-charge pressure ≈ steady-state operating pressure
    P0_kPa_rec  = H_0_m * rho_ref * G / 1_000.0 if (rho_ref := 1000.0) else H_0_m * 9.81

    # Typical gas fraction at max compression ~ 30 % of total volume
    V_total_rec = V_gas_0_rec / 0.5     # gas fraction 0.5 at pre-charge

    return {
        "V_gas_0_m3":    round(max(V_gas_0_rec, 0.05), 3),
        "V_total_m3":    round(max(V_total_rec, 0.1),  3),
        "P0_kPa":        round(P0_kPa_rec, 1),
        "H_joukowsky_m": round(H_joukowsky, 2),
        "notes": (
            f"Screening estimate ±30–50 %. "
            f"Joukowsky surge = {H_joukowsky:.1f} m. "
            f"Recommended V_gas_0 = {max(V_gas_0_rec, 0.05):.2f} m³ "
            f"(×1.5 safety factor applied). "
            "Verify with full dynamic simulation."
        ),
    }


def size_surge_tank(
    Q_0_m3s: float,
    a_ms: float,
    L_m: float,
    D_m: float,
    H_0_m: float,
    H_max_target_m: float,
) -> dict:
    """
    Preliminary surge tank cross-section sizing.

    Combines the Thoma stability criterion and mass-balance flow estimate.
    Accuracy ±40 %; apply ×1.5 safety factor.

    Returns
    -------
    dict with A_tank_m2, D_equiv_m, z_initial_m, z_max_m, notes.
    """
    A_pipe  = math.pi * D_m ** 2 / 4.0
    T_char  = 2.0 * L_m / max(a_ms, 1.0)   # 2L/a [s]
    delta_H = max(H_max_target_m - H_0_m, 1.0)

    # Thoma criterion: A_t ≥ a·A_pipe·L / (2·g·H₀·T_char)
    A_thoma = (a_ms * A_pipe * L_m) / (2.0 * G * max(H_0_m, 1.0) * T_char + 1.0e-9)

    # Flow-balance criterion: A_t ≥ Q₀·T_char / delta_H
    A_flow  = Q_0_m3s * T_char / delta_H

    A_tank_rec = max(A_thoma, A_flow) * 1.5    # ×1.5 safety factor
    A_tank_rec = max(A_tank_rec, 0.25)          # minimum 0.25 m² (DN 560 equivalent)

    D_equiv    = math.sqrt(4.0 * A_tank_rec / math.pi)

    # Tank height: initial level ≈ HGL at connection point; max ≈ 2× surge swing
    dz_swing   = max(2.0 * delta_H * A_pipe / max(A_tank_rec, 1.0e-6), 1.0)
    z_initial  = H_0_m
    z_max      = z_initial + dz_swing

    return {
        "A_tank_m2":   round(A_tank_rec, 3),
        "D_equiv_m":   round(D_equiv, 3),
        "z_initial_m": round(z_initial, 2),
        "z_max_m":     round(z_max, 2),
        "notes": (
            f"Screening estimate ±40 %. "
            f"Thoma: {A_thoma:.3f} m², flow balance: {A_flow:.3f} m². "
            f"Recommended A_tank = {A_tank_rec:.2f} m² (D ≈ {D_equiv:.2f} m). "
            "Verify with full dynamic simulation."
        ),
    }


def size_prv(
    Q_relief_m3s: float,
    P_upstream_kPa: float,
    P_set_kPa: float,
) -> dict:
    """
    Preliminary PRV sizing using the SI valve-sizing Kv method.

        Kv [m³/h/√bar] = Q [m³/h] / √(ΔP [bar])

    Accuracy ±25 %.  Verify with manufacturer's Cv/Kv curve.

    Returns
    -------
    dict with Kv, Cv, DN_mm, notes.
    """
    dP_bar = max((P_upstream_kPa - P_set_kPa) / 100.0, 0.01)
    Q_m3h  = Q_relief_m3s * 3600.0
    Kv     = Q_m3h / math.sqrt(dP_bar)
    Cv     = Kv * 1.156   # 1 Kv ≈ 1.156 Cv (water at 15 °C)

    # Nominal DN lookup (indicative guide only)
    if   Kv < 4:   DN = 15
    elif Kv < 16:  DN = 25
    elif Kv < 40:  DN = 40
    elif Kv < 100: DN = 50
    elif Kv < 250: DN = 80
    else:          DN = 100

    return {
        "Kv_m3h_bar05":  round(Kv,  2),
        "Cv":            round(Cv,  2),
        "DN_mm":         DN,
        "Q_relief_m3h":  round(Q_m3h, 3),
        "dP_bar":        round(dP_bar, 3),
        "notes": (
            f"Screening estimate ±25 %. "
            f"Kv = {Kv:.1f} m³/h/√bar → DN {DN} mm guide. "
            "Verify with manufacturer's Cv curve at rated conditions."
        ),
    }


def size_vacuum_relief(
    D_pipe_m: float,
) -> dict:
    """
    Preliminary vacuum relief valve sizing.

    Air-inlet area ≥ 50 % of pipe cross-section (conservative, free-flow
    admission per AWWA M51 / AS 2941 §11).

    Returns
    -------
    dict with DN_rec_mm, A_req_m2, notes.
    """
    A_pipe   = math.pi * D_pipe_m ** 2 / 4.0
    A_req    = A_pipe * 0.5
    D_valve  = math.sqrt(4.0 * A_req / math.pi)
    # Round up to nearest DN 25 increment
    DN_rec   = max(25, int(math.ceil(D_valve * 1000 / 25)) * 25)

    return {
        "D_pipe_mm": round(D_pipe_m * 1000, 1),
        "DN_rec_mm": DN_rec,
        "A_req_m2":  round(A_req, 5),
        "notes": (
            f"Air-inlet area ≥ 50 % of pipe area → DN {DN_rec} mm recommended. "
            "AWWA M51 / AS 2941 §11 guidance. "
            "Locate at all high points along the pipeline profile."
        ),
    }


def size_slow_check_valve(
    Q_0_m3s: float,
    a_ms: float,
    L_m: float,
    D_m: float,
    H_0_m: float,
    H_max_target_m: float,
) -> dict:
    """
    Minimum slow-closing check valve closure time recommendation.

    Derived from the Joukowsky equation: for a linear closure,
    the peak pressure rise ΔH = a·Q₀/(g·A) × (2L/a)/t_close.
    Solving for t_close:

        t_close_min ≥ 2L·Q₀ / (g·A·delta_H)

    Accuracy ±30 %.  Power-assisted actuator required for long closure times.

    Returns
    -------
    dict with t_close_rec_s, t_close_min_s, T_char_s, notes.
    """
    A_pipe         = math.pi * D_m ** 2 / 4.0
    T_char         = 2.0 * L_m / max(a_ms, 1.0)
    H_joukowsky    = a_ms * Q_0_m3s / (G * max(A_pipe, 1.0e-9))
    delta_H_target = max(H_max_target_m - H_0_m, 1.0)

    # Minimum closure time so that distributed surge ≤ delta_H_target
    t_close_min = T_char * (H_joukowsky / delta_H_target)
    t_close_rec = max(t_close_min * 1.3, 5.0)   # ×1.3 safety factor; min 5 s

    return {
        "t_close_rec_s": round(t_close_rec, 1),
        "t_close_min_s": round(t_close_min, 1),
        "T_char_s":      round(T_char, 2),
        "H_joukowsky_m": round(H_joukowsky, 2),
        "notes": (
            f"Screening estimate ±30 %. "
            f"Joukowsky surge = {H_joukowsky:.1f} m. "
            f"Minimum t_close ≈ {t_close_min:.1f} s → "
            f"recommended {t_close_rec:.1f} s (×1.3 safety factor, min 5 s). "
            "Use power-assisted actuator; verify with full MOC simulation."
        ),
    }


# ---------------------------------------------------------------------------
# What-if metrics extractor
# ---------------------------------------------------------------------------

def extract_whatif_metrics(
    raw: dict,
    label: str,
    baseline_max_H: float | None,
    baseline_min_H: float | None,
    rho_kg_m3: float = 1000.0,
) -> dict:
    """
    Build a WhatIfRunMetrics-compatible dict from a run_moc() raw result.

    Parameters
    ----------
    raw            : raw result dict from run_moc()
    label          : scenario display name
    baseline_max_H : baseline global_max_H_m (None = this IS the baseline)
    baseline_min_H : baseline global_min_H_m
    rho_kg_m3      : fluid density
    """
    max_H = raw["global_max_H_m"]
    min_H = raw["global_min_H_m"]
    max_P = raw["global_max_P_kPa"]
    min_P = raw["global_min_P_kPa"]

    reduction_m    = None
    reduction_pct  = None
    improvement_m  = None

    if baseline_max_H is not None:
        reduction_m   = round(baseline_max_H - max_H, 3)
        reduction_pct = round(reduction_m / max(abs(baseline_max_H), 1.0e-6) * 100.0, 1)

    if baseline_min_H is not None:
        improvement_m = round(min_H - baseline_min_H, 3)

    # Lightweight envelope — all columns included for chart overlay
    env_lite = [
        {
            "x_m":       pt["x_m"],
            "elev_m":    pt["elev_m"],
            "H_max_m":   pt["H_max_m"],
            "H_min_m":   pt["H_min_m"],
            "P_max_kPa": pt["P_max_kPa"],
            "P_min_kPa": pt["P_min_kPa"],
        }
        for pt in raw["envelope"]
    ]

    return {
        "label":                   label,
        "global_max_H_m":          round(max_H, 3),
        "global_min_H_m":          round(min_H, 3),
        "global_max_P_kPa":        round(max_P, 2),
        "global_min_P_kPa":        round(min_P, 2),
        "max_surge_reduction_m":   reduction_m,
        "max_surge_reduction_pct": reduction_pct,
        "min_head_improvement_m":  improvement_m,
        "cavitation_x_m":          raw["cavitation_x_m"],
        "rating_check":            raw.get("rating_check"),
        "envelope":                env_lite,
        "sizing_summary":          None,   # filled by caller
    }
