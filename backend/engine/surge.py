"""
Surge / water-hammer quick-check engine — Mode A.

Implements the Joukowsky equation with Allievi/Bergeron slow-closure reduction
and a simplified pressure envelope at each pipe end.

References
----------
- Joukowsky, N. (1898). Waterhammer (trans. ASME 1904).
- Wylie, E. B. & Streeter, V. L. (1993). Fluid Transients in Systems. §3.
- AWWA M11 — Steel Pipe: A Guide for Design and Installation.
"""

from __future__ import annotations

G: float = 9.81  # m/s²

# Vapour pressure of water at 20 °C as gauge head [m]:
#   P_vap ≈ 2.34 kPa absolute; P_atm ≈ 101.325 kPa
#   h_vap_gauge = (2.34 − 101.325) × 1000 / (1000 × 9.81) ≈ −10.09 m
VAPOR_PRESSURE_HEAD_GAUGE_M: float = -10.09


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
) -> dict:
    """
    Mode A (quick-check) water-hammer analysis.

    Parameters
    ----------
    pipeline        : ``"suction"`` or ``"discharge"``
    wave_speed_ms   : acoustic wave speed *a* [m/s]
    V0_ms           : initial steady-state flow velocity [m/s]
    event_type      : one of ``"pump_trip"``, ``"valve_closure_downstream"``,
                      ``"valve_closure_upstream"``, ``"check_valve_slam"``
    pipe_length_m   : pipe length *L* [m]
    closure_time_s  : valve/event closure time *tc* [s], or ``None`` for
                      instantaneous events
    rho_kg_m3       : fluid density ρ [kg/m³]
    H_operating_m   : steady-state operating head at point of interest [m gauge]

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

    # ── 1. Full Joukowsky (instantaneous) surge ───────────────────────────────
    # Mode A: assume full velocity change ΔV = V0 (complete stoppage).
    delta_V_ms: float = V0_ms

    # ΔH = a · ΔV / g  [m]
    delta_H_joukowsky_m: float = (wave_speed_ms * delta_V_ms) / G
    # ΔP = ρ · a · ΔV  [Pa] → kPa
    delta_P_joukowsky_kPa: float = (rho_kg_m3 * wave_speed_ms * delta_V_ms) / 1000.0

    # ── 2. Characteristic time  T = 2L/a  [s] ────────────────────────────────
    T_char_s: float = (2.0 * pipe_length_m) / wave_speed_ms

    # ── 3. Slow-closure reduction factor K ───────────────────────────────────
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

    # ── 4. Pressure envelope at pipe ends (simplified Mode A) ─────────────────
    def _kpa(h_m: float) -> float:
        return h_m * rho_kg_m3 * G / 1000.0

    if event_type == "pump_trip":
        # Flow decelerates at pump → negative wave propagates downstream.
        # Pump discharge (origin): immediate head drop.
        # System end / reservoir: negative reflects as positive (+ΔH).
        near_label = "Pump discharge end (origin)"
        far_label  = "System end / reservoir"
        near_max_h = H_operating_m
        near_min_h = H_operating_m - delta_H_m
        far_max_h  = H_operating_m + delta_H_m
        far_min_h  = H_operating_m

    elif event_type == "valve_closure_downstream":
        # Positive wave (+ΔH) at downstream valve; reflects as negative (−ΔH) upstream.
        near_label = "Valve — downstream end (origin)"
        far_label  = "Pump / upstream end"
        near_max_h = H_operating_m + delta_H_m
        near_min_h = H_operating_m
        far_max_h  = H_operating_m
        far_min_h  = H_operating_m - delta_H_m

    elif event_type == "valve_closure_upstream":
        # Positive wave at upstream valve; negative wave propagates toward pump suction.
        near_label = "Valve — upstream end (origin)"
        far_label  = "Pump suction end (downstream)"
        near_max_h = H_operating_m + delta_H_m
        near_min_h = H_operating_m
        far_max_h  = H_operating_m
        far_min_h  = H_operating_m - delta_H_m

    else:  # check_valve_slam — same physics as rapid downstream closure
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
    cavitation_risk = global_min_h < VAPOR_PRESSURE_HEAD_GAUGE_M

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
        "vapor_pressure_head_m":    VAPOR_PRESSURE_HEAD_GAUGE_M,
    }
