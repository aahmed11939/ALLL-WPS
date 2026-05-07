"""
Clear well sizing engine — ALLL WPS Designer.

All calculations follow AWWA Manual M32 (Computer Modeling of Water Distribution
Systems), Ten States Standards (2012), and the Surface Water Treatment Rule CT
requirements for potable-water pump station clear well sizing.

A **clear well** is the finished-water storage compartment downstream of the
treatment process that:
  1. Buffers supply/demand imbalances.
  2. Provides chlorine contact time (CT) required by the SWTR.
  3. Supplies firm pump capacity during peak demand or emergency.

Sizing is governed by:
  - Pump cycle limits (motor thermal protection, AWWA M32 §6.4).
  - Minimum hydraulic detention time for CT compliance.
  - Operating volume between pump start (LWL) and stop (HWL) levels.

Units: SI throughout (m, m³, m³/s, minutes) unless noted.
"""

from __future__ import annotations

import math


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------


def cross_section_area_m2(
    geometry: str,
    diameter_m: float | None,
    length_m: float | None,
    width_m: float | None,
) -> float:
    """
    Return the horizontal cross-section area of the clear well [m²].

    Parameters
    ----------
    geometry   : "cylindrical" | "rectangular"
    diameter_m : Internal diameter [m] — required for cylindrical.
    length_m   : Internal length [m] — required for rectangular.
    width_m    : Internal width  [m] — required for rectangular.

    Raises
    ------
    ValueError on unsupported geometry or missing dimensions.
    """
    if geometry == "cylindrical":
        if diameter_m is None or diameter_m <= 0:
            raise ValueError(
                "diameter_m must be > 0 for cylindrical geometry."
            )
        return math.pi / 4.0 * diameter_m ** 2

    if geometry == "rectangular":
        if length_m is None or length_m <= 0:
            raise ValueError(
                "length_m must be > 0 for rectangular geometry."
            )
        if width_m is None or width_m <= 0:
            raise ValueError(
                "width_m must be > 0 for rectangular geometry."
            )
        return length_m * width_m

    raise ValueError(f"Unknown geometry '{geometry}'. Use 'cylindrical' or 'rectangular'.")


def volume_at_level_m3(
    level_m: float,
    LLL_m: float,
    area_m2: float,
) -> float:
    """
    Return the water volume stored at a given level [m³].

    Volume is measured from LLL (Low-Low Level, the empty reference).
    Returns 0.0 if level_m <= LLL_m.
    """
    depth = max(0.0, level_m - LLL_m)
    return area_m2 * depth


# ---------------------------------------------------------------------------
# Volume curve
# ---------------------------------------------------------------------------


def clearwell_volume_curve(
    geometry: str,
    LLL_m: float,
    HHL_m: float,
    diameter_m: float | None = None,
    length_m: float | None = None,
    width_m: float | None = None,
    n_points: int = 21,
) -> list[dict]:
    """
    Generate a level → volume curve from LLL to HHL.

    Parameters
    ----------
    geometry   : "cylindrical" | "rectangular"
    LLL_m      : Low-Low Level elevation [m above datum]
    HHL_m      : High-High Level elevation [m above datum]
    diameter_m : Required for cylindrical [m]
    length_m   : Required for rectangular [m]
    width_m    : Required for rectangular [m]
    n_points   : Number of points in the curve (default 21)

    Returns
    -------
    list of {"level_m": float, "volume_m3": float, "depth_m": float}
    """
    if n_points < 2:
        raise ValueError("n_points must be >= 2")
    if HHL_m <= LLL_m:
        raise ValueError("HHL_m must be strictly greater than LLL_m")

    area = cross_section_area_m2(geometry, diameter_m, length_m, width_m)
    step = (HHL_m - LLL_m) / (n_points - 1)

    points = []
    for i in range(n_points):
        lev = LLL_m + i * step
        vol = volume_at_level_m3(lev, LLL_m, area)
        points.append({
            "level_m": round(lev, 4),
            "depth_m": round(lev - LLL_m, 4),
            "volume_m3": round(vol, 4),
        })
    return points


# ---------------------------------------------------------------------------
# Operating volume
# ---------------------------------------------------------------------------


def operating_volume_m3(
    geometry: str,
    LWL_m: float,
    HWL_m: float,
    diameter_m: float | None = None,
    length_m: float | None = None,
    width_m: float | None = None,
) -> float:
    """
    Return the usable operating volume between LWL and HWL [m³].

    This is the volume available for pump cycle buffering.
    """
    area = cross_section_area_m2(geometry, diameter_m, length_m, width_m)
    if HWL_m <= LWL_m:
        raise ValueError("HWL_m must be strictly greater than LWL_m")
    return area * (HWL_m - LWL_m)


# ---------------------------------------------------------------------------
# Cycle analysis (AWWA M32)
# ---------------------------------------------------------------------------


def cycle_analysis(
    Q_pump_m3s: float,
    Q_in_m3s: float,
    V_op_m3: float,
    max_cycles_per_hour: int,
) -> dict:
    """
    Compute pump cycle time, cycles per hour, and required volume.

    Uses the AWWA M32 formula for the minimum operating volume to limit
    pump starts to ``max_cycles_per_hour``:

        V_req = Q_pump / (4 × n_max)                      [m³, Q in m³/s, n in starts/s]
              = Q_pump_m3s × 900 / max_cycles_per_hour     [m³]

    At the worst-case inflow (Q_in = Q_pump / 2), the cycle time is
    minimised to:

        T_min = 4 × V_op / Q_pump

    which gives n_max = Q_pump / (4 × V_op) starts/s.

    When Q_in >= Q_pump, the pump cannot drain the well; it runs
    continuously and the cycle count is 0.

    Parameters
    ----------
    Q_pump_m3s          : Net pump discharge rate [m³/s]
    Q_in_m3s            : Inflow rate for this hour (or average) [m³/s]
    V_op_m3             : Operating volume between LWL and HWL [m³]
    max_cycles_per_hour : Motor thermal limit [starts/hour]

    Returns
    -------
    dict with keys:
        Q_pump_m3s, Q_in_m3s, V_op_m3
        t_fill_s    — time for well to fill from LWL to HWL when pump is off [s]
        t_drain_s   — time to drain from HWL to LWL when pump runs [s]
        t_cycle_s   — total cycle time (fill + drain) [s]
        cycles_per_hour — actual cycles per hour at this Q_in
        V_req_m3    — minimum V_op to stay within max_cycles (AWWA M32)
        cycles_ok   — True if V_op_m3 >= V_req_m3
        pump_can_drain — False if Q_pump <= Q_in (pump cannot drain)
    """
    if Q_pump_m3s <= 0:
        raise ValueError(f"Q_pump_m3s must be > 0, got {Q_pump_m3s}")
    if Q_in_m3s < 0:
        raise ValueError(f"Q_in_m3s must be >= 0, got {Q_in_m3s}")
    if V_op_m3 <= 0:
        raise ValueError(f"V_op_m3 must be > 0, got {V_op_m3}")
    if max_cycles_per_hour < 1:
        raise ValueError(f"max_cycles_per_hour must be >= 1, got {max_cycles_per_hour}")

    # AWWA M32 required volume (independent of Q_in — worst-case formula)
    V_req_m3 = Q_pump_m3s * 900.0 / max_cycles_per_hour

    # Pump cannot drain: runs continuously, zero cycles/hour
    if Q_pump_m3s <= Q_in_m3s:
        return {
            "Q_pump_m3s": Q_pump_m3s,
            "Q_in_m3s": Q_in_m3s,
            "V_op_m3": V_op_m3,
            "t_fill_s": None,
            "t_drain_s": None,
            "t_cycle_s": None,
            "cycles_per_hour": 0.0,
            "V_req_m3": round(V_req_m3, 4),
            "cycles_ok": V_op_m3 >= V_req_m3,
            "pump_can_drain": False,
        }

    # Zero inflow: pump drains, no refill → one-shot, no cycling
    if Q_in_m3s == 0.0:
        t_drain_s = V_op_m3 / Q_pump_m3s
        return {
            "Q_pump_m3s": Q_pump_m3s,
            "Q_in_m3s": Q_in_m3s,
            "V_op_m3": V_op_m3,
            "t_fill_s": None,
            "t_drain_s": round(t_drain_s, 2),
            "t_cycle_s": None,
            "cycles_per_hour": 0.0,
            "V_req_m3": round(V_req_m3, 4),
            "cycles_ok": V_op_m3 >= V_req_m3,
            "pump_can_drain": True,
        }

    # Normal cycling
    t_drain_s = V_op_m3 / (Q_pump_m3s - Q_in_m3s)  # pump on, draining
    t_fill_s = V_op_m3 / Q_in_m3s                   # pump off, filling
    t_cycle_s = t_drain_s + t_fill_s
    cycles_per_hour = 3600.0 / t_cycle_s

    return {
        "Q_pump_m3s": Q_pump_m3s,
        "Q_in_m3s": Q_in_m3s,
        "V_op_m3": V_op_m3,
        "t_fill_s": round(t_fill_s, 2),
        "t_drain_s": round(t_drain_s, 2),
        "t_cycle_s": round(t_cycle_s, 2),
        "cycles_per_hour": round(cycles_per_hour, 3),
        "V_req_m3": round(V_req_m3, 4),
        "cycles_ok": V_op_m3 >= V_req_m3,
        "pump_can_drain": True,
    }


# ---------------------------------------------------------------------------
# Detention time
# ---------------------------------------------------------------------------


def detention_time(
    V_op_m3: float,
    Q_in_m3s: float,
    required_detention_min: float = 0.0,
) -> dict:
    """
    Compute hydraulic detention time and check against required minimum.

    The average stored volume is approximated as V_op / 2 (mid-band).
    Detention time t_d = V_avg / Q_in.

    Parameters
    ----------
    V_op_m3               : Operating volume between LWL and HWL [m³]
    Q_in_m3s              : Average inflow rate [m³/s]
    required_detention_min: Minimum CT detention time required [min]

    Returns
    -------
    dict with keys:
        V_avg_m3             — average volume [m³]
        detention_time_min   — computed detention time [min]
        required_min         — echoed requirement [min]
        detention_ok         — True if detention_time_min >= required_min
    """
    if V_op_m3 <= 0:
        raise ValueError(f"V_op_m3 must be > 0, got {V_op_m3}")
    if Q_in_m3s < 0:
        raise ValueError(f"Q_in_m3s must be >= 0, got {Q_in_m3s}")

    V_avg_m3 = V_op_m3 / 2.0

    if Q_in_m3s == 0.0:
        dt_min = float("inf")
        dt_ok = True
    else:
        dt_min = (V_avg_m3 / Q_in_m3s) / 60.0

    dt_ok = dt_min >= required_detention_min

    return {
        "V_avg_m3": round(V_avg_m3, 4),
        "detention_time_min": round(dt_min, 2) if math.isfinite(dt_min) else None,
        "required_min": required_detention_min,
        "detention_ok": dt_ok,
    }


# ---------------------------------------------------------------------------
# Warning generator
# ---------------------------------------------------------------------------


def generate_warnings(
    cycle_results: list[dict],
    detention_result: dict,
    geometry: str,
    diameter_m: float | None,
    length_m: float | None,
    width_m: float | None,
    LWL_m: float,
    HWL_m: float,
) -> list[str]:
    """
    Return a list of actionable warning strings from cycle and detention results.
    """
    warnings: list[str] = []

    for cr in cycle_results:
        if not cr["cycles_ok"]:
            V_op = cr["V_op_m3"]
            V_req = cr["V_req_m3"]
            shortfall = V_req - V_op
            Q_pump = cr["Q_pump_m3s"]

            # Suggest increasing start-stop range
            try:
                area = cross_section_area_m2(geometry, diameter_m, length_m, width_m)
                delta_h = shortfall / area if area > 0 else None
            except ValueError:
                area = None
                delta_h = None

            if delta_h is not None:
                warnings.append(
                    f"Stage Q={Q_pump * 3600:.1f} m³/h: operating volume {V_op:.1f} m³ "
                    f"< required {V_req:.1f} m³ (AWWA M32). "
                    f"Increase start–stop range by ≥ {delta_h:.2f} m, or reduce max cycles/hour."
                )
            else:
                warnings.append(
                    f"Stage Q={Q_pump * 3600:.1f} m³/h: operating volume {V_op:.1f} m³ "
                    f"< required {V_req:.1f} m³ (AWWA M32). "
                    f"Increase clear well size or reduce max cycles/hour."
                )

        if not cr.get("pump_can_drain", True):
            warnings.append(
                f"Stage Q={cr['Q_pump_m3s'] * 3600:.1f} m³/h: pump flow "
                f"({cr['Q_pump_m3s'] * 3600:.1f} m³/h) ≤ inflow "
                f"({cr['Q_in_m3s'] * 3600:.1f} m³/h). "
                "Pump cannot drain the clear well. "
                "Increase pump capacity or add a standby unit."
            )

    if not detention_result["detention_ok"] and detention_result["detention_time_min"] is not None:
        dt = detention_result["detention_time_min"]
        req = detention_result["required_min"]
        warnings.append(
            f"Detention time {dt:.1f} min is less than required {req:.1f} min (CT compliance). "
            "Increase clear well diameter/area, raise HWL, or lower LWL."
        )

    return warnings
