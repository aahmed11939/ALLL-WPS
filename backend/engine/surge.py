"""
Surge / water-hammer quick-check engine — Mode A.

Implements the Joukowsky equation with Allievi/Bergeron slow-closure reduction
and a simplified pressure envelope at each pipe end.

References
----------
- Joukowsky, N. (1898). Waterhammer (trans. ASME 1904).
- Wylie, E. B. & Streeter, V. L. (1993). Fluid Transients in Systems. §2–3.
- Halliwell, A. R. (1963). Velocity of a water-hammer wave in an elastic pipe.
  ASCE J. Hydraulics Div., 89(4), 1–21.
- AWWA M11 — Steel Pipe: A Guide for Design and Installation.
"""

from __future__ import annotations

import math

G: float = 9.81  # m/s²

# ---------------------------------------------------------------------------
# Pipe material table
# E_p [MPa], Poisson's ratio ν, display name
# ---------------------------------------------------------------------------
PIPE_MATERIALS: dict[str, dict] = {
    "dicl":            {"E_p_MPa": 168_000, "nu": 0.28, "name": "Ductile Iron (DICL)"},
    "grey_cast_iron":  {"E_p_MPa":  96_500, "nu": 0.26, "name": "Grey Cast Iron"},
    "steel":           {"E_p_MPa": 206_000, "nu": 0.30, "name": "Steel (welded)"},
    "pvc_upvc":        {"E_p_MPa":   3_000, "nu": 0.45, "name": "PVC / uPVC"},
    "hdpe_pe100":      {"E_p_MPa":     900, "nu": 0.46, "name": "HDPE PE100"},
    "grp_frp":         {"E_p_MPa":  25_000, "nu": 0.28, "name": "GRP / FRP"},
    "asbestos_cement": {"E_p_MPa":  24_000, "nu": 0.27, "name": "Asbestos Cement"},
    "concrete_rccp":   {"E_p_MPa":  30_000, "nu": 0.15, "name": "Concrete / RCCP"},
}

RESTRAINT_PRESETS: dict[str, str] = {
    "free":              "Free / expansion joints throughout (C = 1.0)",
    "anchored_upstream": "Anchored upstream end, free downstream (C = 1 − ν/2)",
    "restrained":        "Fully restrained / buried (C = 1 − ν²)",
}


# ---------------------------------------------------------------------------
# Vapour pressure
# ---------------------------------------------------------------------------

def vapor_pressure_kPa(T_C: float) -> float:
    """
    Saturation vapour pressure of water [kPa absolute] at temperature T_C [°C].

    Uses Antoine equation (log₁₀ base, mmHg, valid −10 to 100 °C):
        log₁₀(P/mmHg) = 8.07131 − 1730.63 / (233.426 + T)
    1 mmHg = 0.133322 kPa.
    """
    if not (-10.0 <= T_C <= 100.0):
        raise ValueError(
            f"Temperature {T_C} °C is outside the valid range −10 to 100 °C."
        )
    log_p_mmhg = 8.07131 - 1730.63 / (233.426 + T_C)
    p_mmhg = 10.0 ** log_p_mmhg
    return p_mmhg * 0.133322  # kPa absolute


def vapor_pressure_head_gauge_m(
    T_C: float = 20.0,
    rho_kg_m3: float = 1000.0,
) -> float:
    """
    Vapour pressure expressed as gauge head [m]:
        h_vap = (P_vap_kPa − 101.325) × 1000 / (ρ × g)

    At 20 °C: ≈ −10.09 m gauge.
    """
    p_vap_kPa = vapor_pressure_kPa(T_C)
    return (p_vap_kPa - 101.325) * 1000.0 / (rho_kg_m3 * G)


# ---------------------------------------------------------------------------
# Wave speed
# ---------------------------------------------------------------------------

def wave_speed(
    *,
    material: str,
    D_o_m: float,
    e_m: float | None = None,
    sdr: float | None = None,
    restraint: str = "restrained",
    K_f_Pa: float = 2.1e9,
    rho_kg_m3: float = 1000.0,
) -> dict:
    """
    Compute acoustic wave speed in a pressurised pipe (Halliwell thin-wall formula).

    a = sqrt(K_f/ρ) / sqrt(1 + K_f·Dᵢ/(Eₚ·e)·C)

    Parameters
    ----------
    material    : pipe material key (see PIPE_MATERIALS)
    D_o_m       : outer diameter [m]
    e_m         : wall thickness [m]  — provide exactly one of e_m or sdr
    sdr         : standard dimension ratio (e = D_o/SDR)
    restraint   : "free" | "anchored_upstream" | "restrained"
    K_f_Pa      : bulk modulus of fluid [Pa] (default 2.1 GPa for water at 20 °C)
    rho_kg_m3   : fluid density [kg/m³]

    Returns
    -------
    dict  with wave_speed_ms, all intermediate values, and equation_trace string.
    """
    if material not in PIPE_MATERIALS:
        raise ValueError(
            f"Unknown material '{material}'. "
            f"Choose from: {list(PIPE_MATERIALS)}"
        )
    if D_o_m <= 0:
        raise ValueError("Outer diameter D_o must be > 0 m.")
    if restraint not in RESTRAINT_PRESETS:
        raise ValueError(
            f"Unknown restraint '{restraint}'. "
            f"Choose from: {list(RESTRAINT_PRESETS)}"
        )
    if rho_kg_m3 <= 0:
        raise ValueError("Fluid density must be > 0 kg/m³.")
    if K_f_Pa <= 0:
        raise ValueError("Bulk modulus K_f must be > 0 Pa.")

    mat = PIPE_MATERIALS[material]
    E_p_MPa: float = mat["E_p_MPa"]
    nu: float = mat["nu"]
    E_p_Pa: float = E_p_MPa * 1.0e6

    if e_m is not None:
        if e_m <= 0:
            raise ValueError("Wall thickness e must be > 0 m.")
        wall_m = e_m
        sdr_used = D_o_m / e_m
    elif sdr is not None:
        if sdr <= 2.0:
            raise ValueError("SDR must be > 2.")
        wall_m = D_o_m / sdr
        sdr_used = float(sdr)
    else:
        raise ValueError("Provide either wall thickness e_m [m] or SDR.")

    D_i_m: float = D_o_m - 2.0 * wall_m
    if D_i_m <= 0:
        raise ValueError(
            f"Inner diameter D_i = {D_i_m * 1000:.2f} mm ≤ 0 — "
            "wall thickness exceeds pipe radius."
        )

    if restraint == "free":
        C = 1.0
        C_expr = "1.0  (free / expansion joints throughout)"
    elif restraint == "anchored_upstream":
        C = 1.0 - nu / 2.0
        C_expr = f"1 − ν/2 = 1 − {nu}/2 = {C:.4f}"
    else:
        C = 1.0 - nu ** 2
        C_expr = f"1 − ν² = 1 − {nu}² = {C:.4f}"

    term_acoustic: float = math.sqrt(K_f_Pa / rho_kg_m3)
    flexibility: float = K_f_Pa * D_i_m / (E_p_Pa * wall_m)
    denominator: float = math.sqrt(1.0 + flexibility * C)
    a: float = term_acoustic / denominator

    trace = (
        f"a = sqrt(K_f/rho) / sqrt(1 + K_f*Di/(Ep*e)*C)\n"
        f"\n"
        f"  sqrt(K_f/rho)     = sqrt({K_f_Pa:.3e} / {rho_kg_m3:.1f})\n"
        f"                    = {term_acoustic:.3f} m/s\n"
        f"\n"
        f"  Di = Do - 2e      = {D_o_m * 1000:.1f} - 2*{wall_m * 1000:.3f}\n"
        f"                    = {D_i_m * 1000:.3f} mm\n"
        f"\n"
        f"  Ep ({mat['name']}) = {E_p_MPa:,.0f} MPa\n"
        f"\n"
        f"  K_f*Di/(Ep*e)     = {K_f_Pa:.3e}*{D_i_m:.5f}"
        f" / ({E_p_Pa:.3e}*{wall_m:.5f})\n"
        f"                    = {flexibility:.5f}\n"
        f"\n"
        f"  C ({restraint}) = {C_expr}\n"
        f"\n"
        f"  sqrt(1 + {flexibility:.5f}*{C:.4f}) = {denominator:.5f}\n"
        f"\n"
        f"  a = {term_acoustic:.3f} / {denominator:.5f} = {a:.2f} m/s"
    )

    return {
        "wave_speed_ms":    round(a, 2),
        "D_i_mm":           round(D_i_m * 1000.0, 3),
        "D_o_mm":           round(D_o_m * 1000.0, 3),
        "wall_mm":          round(wall_m * 1000.0, 3),
        "sdr_used":         round(sdr_used, 2),
        "material":         material,
        "material_name":    mat["name"],
        "E_p_MPa":          E_p_MPa,
        "nu":               nu,
        "restraint":        restraint,
        "C":                round(C, 6),
        "K_f_Pa":           K_f_Pa,
        "rho_kg_m3":        rho_kg_m3,
        "term_acoustic_ms": round(term_acoustic, 3),
        "flexibility":      round(flexibility, 6),
        "denominator":      round(denominator, 6),
        "equation_trace":   trace,
    }


# ---------------------------------------------------------------------------
# Mode A quick-check
# ---------------------------------------------------------------------------

def surge_quick(
    *,
    pipeline: str,
    wave_speed_ms: float,
    V0_ms: float,
    event_type: str,
    pipe_length_m: float,
    closure_time_s: float | None,
    rho_kg_m3: float,
    H_operating_m: float,
    temperature_C: float = 20.0,
    pressure_rating_kPa: float | None = None,
) -> dict:
    """
    Mode A (quick-check) water-hammer analysis.

    Parameters
    ----------
    pipeline             : ``"suction"`` or ``"discharge"``
    wave_speed_ms        : acoustic wave speed *a* [m/s]
    V0_ms                : initial steady-state flow velocity [m/s]
    event_type           : one of ``"pump_trip"``, ``"valve_closure_downstream"``,
                           ``"valve_closure_upstream"``, ``"check_valve_slam"``
    pipe_length_m        : pipe length *L* [m]
    closure_time_s       : valve/event closure time *tc* [s], or ``None`` for
                           instantaneous events
    rho_kg_m3            : fluid density ρ [kg/m³]
    H_operating_m        : steady-state operating head at point of interest [m gauge]
    temperature_C        : water temperature [°C] — drives vapour pressure threshold
    pressure_rating_kPa  : pipe pressure class [kPa]; if supplied, a rating check
                           sub-object is returned in the response

    Returns
    -------
    dict
        All computed results, ready to unpack into ``SurgeQuickResponse``.
    """
    if wave_speed_ms <= 0:
        raise ValueError("Wave speed a must be > 0 m/s.")
    if V0_ms < 0:
        raise ValueError("Initial velocity V0 must be ≥ 0 m/s.")
    if pipe_length_m <= 0:
        raise ValueError("Pipe length L must be > 0 m.")
    if rho_kg_m3 <= 0:
        raise ValueError("Fluid density ρ must be > 0 kg/m³.")
    if closure_time_s is not None and closure_time_s <= 0:
        raise ValueError("Closure time tc must be > 0 s when provided.")

    vap_head_m: float = vapor_pressure_head_gauge_m(temperature_C, rho_kg_m3)

    # ── 1. Full Joukowsky (instantaneous) surge ────────────────────────────────
    delta_V_ms: float = V0_ms
    delta_H_joukowsky_m: float = (wave_speed_ms * delta_V_ms) / G
    delta_P_joukowsky_kPa: float = (rho_kg_m3 * wave_speed_ms * delta_V_ms) / 1000.0

    # ── 2. Characteristic time  T = 2L/a  [s] ─────────────────────────────────
    T_char_s: float = (2.0 * pipe_length_m) / wave_speed_ms

    # ── 3. Slow-closure reduction factor K ────────────────────────────────────
    if closure_time_s is not None:
        tc = closure_time_s
        if tc > T_char_s:
            K = T_char_s / tc
            reduction_method = (
                f"Slow closure (tc = {tc:.2f} s > T = {T_char_s:.2f} s): "
                f"linear reduction K = T/tc = {T_char_s:.2f}/{tc:.2f} = {K:.4f} "
                f"(Wylie & Streeter §3.9)"
            )
        else:
            K = 1.0
            reduction_method = (
                f"Rapid closure (tc = {tc:.2f} s ≤ T = {T_char_s:.2f} s): "
                f"full Joukowsky applies (K = 1.0)"
            )
    else:
        K = 1.0
        reduction_method = (
            f"Instantaneous event — full Joukowsky (K = 1.0). "
            f"T = {T_char_s:.2f} s"
        )

    delta_H_m: float = delta_H_joukowsky_m * K
    delta_P_kPa: float = delta_P_joukowsky_kPa * K

    # ── 4. Pressure envelope at pipe ends (simplified Mode A) ──────────────────
    def _kpa(h_m: float) -> float:
        return h_m * rho_kg_m3 * G / 1000.0

    if event_type == "pump_trip":
        near_label = "Pump discharge end (origin)"
        far_label  = "System end / reservoir"
        near_max_h = H_operating_m
        near_min_h = H_operating_m - delta_H_m
        far_max_h  = H_operating_m + delta_H_m
        far_min_h  = H_operating_m

    elif event_type == "valve_closure_downstream":
        near_label = "Valve — downstream end (origin)"
        far_label  = "Pump / upstream end"
        near_max_h = H_operating_m + delta_H_m
        near_min_h = H_operating_m
        far_max_h  = H_operating_m
        far_min_h  = H_operating_m - delta_H_m

    elif event_type == "valve_closure_upstream":
        near_label = "Valve — upstream end (origin)"
        far_label  = "Pump suction end (downstream)"
        near_max_h = H_operating_m + delta_H_m
        near_min_h = H_operating_m
        far_max_h  = H_operating_m
        far_min_h  = H_operating_m - delta_H_m

    else:  # check_valve_slam
        near_label = "Check valve (slam location)"
        far_label  = "Pump / upstream end"
        near_max_h = H_operating_m + delta_H_m
        near_min_h = H_operating_m
        far_max_h  = H_operating_m
        far_min_h  = H_operating_m - delta_H_m

    envelope: list[dict] = [
        {
            "location":         near_label,
            "max_head_m":       round(near_max_h, 3),
            "min_head_m":       round(near_min_h, 3),
            "max_pressure_kPa": round(_kpa(near_max_h), 2),
            "min_pressure_kPa": round(_kpa(near_min_h), 2),
        },
        {
            "location":         far_label,
            "max_head_m":       round(far_max_h, 3),
            "min_head_m":       round(far_min_h, 3),
            "max_pressure_kPa": round(_kpa(far_max_h), 2),
            "min_pressure_kPa": round(_kpa(far_min_h), 2),
        },
    ]

    # ── 5. Risk indicators ─────────────────────────────────────────────────────
    global_min_h = min(near_min_h, far_min_h)
    global_max_h = max(near_max_h, far_max_h)

    vacuum_risk     = global_min_h < 0.0
    cavitation_risk = global_min_h < vap_head_m

    # ── 6. Optional pressure rating check ─────────────────────────────────────
    rating_check: dict | None = None
    if pressure_rating_kPa is not None and pressure_rating_kPa > 0:
        steady_kPa    = _kpa(H_operating_m)
        max_trans_kPa = _kpa(global_max_h)
        min_trans_kPa = _kpa(global_min_h)
        fos = (
            pressure_rating_kPa / max_trans_kPa
            if max_trans_kPa > 0
            else float("inf")
        )
        if fos >= 1.25:
            rating_status = "pass"
        elif fos >= 1.0:
            rating_status = "caution"
        else:
            rating_status = "fail"

        rating_check = {
            "steady_state_pressure_kPa": round(steady_kPa, 2),
            "max_transient_kPa":         round(max_trans_kPa, 2),
            "min_transient_kPa":         round(min_trans_kPa, 2),
            "pressure_rating_kPa":       round(pressure_rating_kPa, 2),
            "factor_of_safety":          round(fos, 3),
            "rating_status":             rating_status,
        }

    return {
        "delta_V_ms":               round(delta_V_ms, 4),
        "delta_H_joukowsky_m":      round(delta_H_joukowsky_m, 4),
        "delta_P_joukowsky_kPa":    round(delta_P_joukowsky_kPa, 4),
        "T_char_s":                 round(T_char_s, 4),
        "reduction_factor":         round(K, 6),
        "reduction_method":         reduction_method,
        "delta_H_m":                round(delta_H_m, 4),
        "delta_P_kPa":              round(delta_P_kPa, 4),
        "envelope":                 envelope,
        "min_pressure_head_m":      round(global_min_h, 3),
        "max_pressure_head_m":      round(global_max_h, 3),
        "min_pressure_kPa":         round(_kpa(global_min_h), 2),
        "max_pressure_kPa":         round(_kpa(global_max_h), 2),
        "vacuum_risk":              vacuum_risk,
        "cavitation_risk":          cavitation_risk,
        "vapor_pressure_head_m":    round(vap_head_m, 3),
        "temperature_C":            temperature_C,
        "rating_check":             rating_check,
    }
