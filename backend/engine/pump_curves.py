"""
Pump curve engine for ALLL WPS Designer.

Provides:
- Piecewise linear interpolation with clamping and out-of-range detection
- Optional polynomial fit (NumPy least-squares) with non-physical flag
- Operating-point solver via bisection (Brent-style) — no scipy required
- Parallel / series compound H-Q curves
- VFD affinity-law speed curves
- NPSH margin check (Hydraulic Institute recommended margin)
- Curve point generator for charting

All flow values in m³/h, head in m, power in kW, efficiency in %.
"""

from __future__ import annotations

import math
from typing import Callable, List, Optional, Tuple

try:
    import numpy as np
    _HAS_NUMPY = True
except ImportError:  # pragma: no cover
    _HAS_NUMPY = False


# ---------------------------------------------------------------------------
# Piecewise linear interpolation
# ---------------------------------------------------------------------------


def interpolate_curve(
    q_pts: List[float],
    v_pts: List[float],
    q: float,
) -> Tuple[float, bool]:
    """
    Piecewise-linear interpolation.

    Parameters
    ----------
    q_pts   Sorted (ascending) list of Q breakpoints.
    v_pts   Corresponding values at each breakpoint.
    q       Query Q value.

    Returns
    -------
    (interpolated_value, out_of_range)
    out_of_range is True when q is outside [q_pts[0], q_pts[-1]].
    Values are linearly extrapolated at boundaries when out_of_range.
    """
    if len(q_pts) < 2 or len(q_pts) != len(v_pts):
        raise ValueError(
            f"Need ≥ 2 matching-length breakpoint arrays; got "
            f"q_pts={len(q_pts)}, v_pts={len(v_pts)}"
        )

    q_min = q_pts[0]
    q_max = q_pts[-1]
    out_of_range = q < q_min or q > q_max

    # Clamp to data range so we always return a value
    q_c = max(q_min, min(q_max, q))

    for i in range(len(q_pts) - 1):
        if q_pts[i] <= q_c <= q_pts[i + 1]:
            dq = q_pts[i + 1] - q_pts[i]
            if dq == 0:
                return v_pts[i], out_of_range
            t = (q_c - q_pts[i]) / dq
            return v_pts[i] + t * (v_pts[i + 1] - v_pts[i]), out_of_range

    # Should not reach here — return last value
    return v_pts[-1], out_of_range


# ---------------------------------------------------------------------------
# Polynomial fit
# ---------------------------------------------------------------------------


def fit_polynomial(
    q_pts: List[float],
    v_pts: List[float],
    degree: int = 2,
) -> Tuple[List[float], bool]:
    """
    Least-squares polynomial fit using NumPy.

    Returns
    -------
    (coefficients, non_physical)

    coefficients — NumPy descending-order coefficients [a_n, ..., a_1, a_0]
                   suitable for np.polyval(coeffs, q).
    non_physical — True when:
        * The H-Q curve has a local *minimum* or *rising slope* in the
          right-half operating range (Q > Q_bep), or
        * Any evaluated value exceeds 110 (guards η fits).

    Raises
    ------
    ValueError if numpy is not installed or degree+1 > n_pts.
    """
    if not _HAS_NUMPY:  # pragma: no cover
        raise ValueError("NumPy is required for polynomial fitting.")
    if degree < 1:
        raise ValueError(f"Polynomial degree must be ≥ 1, got {degree}")
    if len(q_pts) < degree + 1:
        raise ValueError(
            f"Need ≥ {degree + 1} data points for degree-{degree} polynomial; "
            f"got {len(q_pts)}."
        )

    coeffs = np.polyfit(q_pts, v_pts, degree).tolist()

    # --- Non-physical detection: evaluate on a fine grid ---
    q_eval = [
        q_pts[0] + (q_pts[-1] - q_pts[0]) * i / 199 for i in range(200)
    ]
    v_eval = [sum(c * q ** (degree - i) for i, c in enumerate(coeffs)) for q in q_eval]

    # Rising slope in right half of operating range
    mid = len(q_eval) // 2
    slopes_right = [
        v_eval[i + 1] - v_eval[i]
        for i in range(mid, len(q_eval) - 1)
    ]
    non_physical = (
        any(s > 1e-3 for s in slopes_right)
        or any(v > 110 for v in v_eval)
    )

    return coeffs, non_physical


def _eval_poly(coeffs: List[float], q: float) -> float:
    """Evaluate a descending-order polynomial at q."""
    degree = len(coeffs) - 1
    return sum(c * q ** (degree - i) for i, c in enumerate(coeffs))


# ---------------------------------------------------------------------------
# Curve builder helpers
# ---------------------------------------------------------------------------


def _make_linear_fn(
    q_pts: List[float],
    v_pts: List[float],
    lo_clamp: float = 0.0,
    hi_clamp: float = math.inf,
) -> Callable[[float], float]:
    """Return a piecewise-linear interpolant clamped to [lo_clamp, hi_clamp]."""
    def fn(q: float) -> float:
        v, _ = interpolate_curve(q_pts, v_pts, q)
        return max(lo_clamp, min(hi_clamp, v))
    return fn


def _make_poly_fn(
    coeffs: List[float],
    lo_clamp: float = 0.0,
    hi_clamp: float = math.inf,
) -> Callable[[float], float]:
    def fn(q: float) -> float:
        v = _eval_poly(coeffs, q)
        return max(lo_clamp, min(hi_clamp, v))
    return fn


def build_hq_fn(
    q_pts: List[float],
    h_pts: List[float],
    interp_method: str = "linear",
    poly_degree: int = 2,
) -> Callable[[float], float]:
    """
    Build H-Q function (returns head in m ≥ 0) from tabular data.

    Beyond the maximum tabulated flow (runout), head is returned as 0.0
    (the pump cannot operate past its runout point).

    Parameters
    ----------
    interp_method  ``"linear"`` (default) or ``"poly"`` (polynomial fit).
    poly_degree    Polynomial degree for ``"poly"`` method.
    """
    q_max_data = max(q_pts)

    if interp_method == "poly":
        coeffs, _ = fit_polynomial(q_pts, h_pts, poly_degree)
        base_fn = _make_poly_fn(coeffs, lo_clamp=0.0)
    else:
        base_fn = _make_linear_fn(q_pts, h_pts, lo_clamp=0.0)

    def hq_fn(q: float) -> float:
        if q > q_max_data:
            return 0.0
        return base_fn(q)

    return hq_fn


def build_eta_fn(
    q_pts: List[float],
    eta_pts: List[float],
    interp_method: str = "linear",
    poly_degree: int = 2,
) -> Callable[[float], float]:
    """Build η(Q) function returning efficiency in % clamped to [0, 100]."""
    if interp_method == "poly":
        coeffs, _ = fit_polynomial(q_pts, eta_pts, poly_degree)
        return _make_poly_fn(coeffs, lo_clamp=0.0, hi_clamp=100.0)
    return _make_linear_fn(q_pts, eta_pts, lo_clamp=0.0, hi_clamp=100.0)


def build_p_fn(
    q_pts: List[float],
    p_pts: List[float],
    interp_method: str = "linear",
    poly_degree: int = 2,
) -> Callable[[float], float]:
    """Build P(Q) function returning shaft power in kW ≥ 0."""
    if interp_method == "poly":
        coeffs, _ = fit_polynomial(q_pts, p_pts, poly_degree)
        return _make_poly_fn(coeffs, lo_clamp=0.0)
    return _make_linear_fn(q_pts, p_pts, lo_clamp=0.0)


def build_npshr_fn(
    q_pts: List[float],
    npshr_pts: List[float],
    interp_method: str = "linear",
    poly_degree: int = 2,
) -> Callable[[float], float]:
    """Build NPSHr(Q) function returning required NPSH in m ≥ 0."""
    if interp_method == "poly":
        coeffs, _ = fit_polynomial(q_pts, npshr_pts, poly_degree)
        return _make_poly_fn(coeffs, lo_clamp=0.0)
    return _make_linear_fn(q_pts, npshr_pts, lo_clamp=0.0)


# ---------------------------------------------------------------------------
# Compound arrangements
# ---------------------------------------------------------------------------


def parallel_hq_fn(
    hq_fn: Callable[[float], float],
    n: int,
) -> Callable[[float], float]:
    """
    N identical pumps in parallel.

    At any given head, each pump delivers Q_single, so total flow is n × Q_single.
    Equivalently: H_parallel(Q) = H_single(Q / n).

    Parameters
    ----------
    n   Number of identical pumps running in parallel (≥ 1).
    """
    if n < 1:
        raise ValueError(f"n must be ≥ 1, got {n}")
    if n == 1:
        return hq_fn

    def fn(q: float) -> float:
        return hq_fn(q / n)
    return fn


def series_hq_fn(
    hq_fn: Callable[[float], float],
    n: int,
) -> Callable[[float], float]:
    """
    N identical pumps in series.

    At any given flow, each pump delivers H_single, so total head is n × H_single.
    H_series(Q) = n × H_single(Q).

    Parameters
    ----------
    n   Number of identical pumps in series (≥ 1).
    """
    if n < 1:
        raise ValueError(f"n must be ≥ 1, got {n}")
    if n == 1:
        return hq_fn

    def fn(q: float) -> float:
        return n * hq_fn(q)
    return fn


# ---------------------------------------------------------------------------
# VFD affinity laws
# ---------------------------------------------------------------------------


def affinity_hq_fn(
    base_hq_fn: Callable[[float], float],
    speed_ratio: float,
) -> Callable[[float], float]:
    """
    Apply centrifugal pump affinity laws at fractional speed ratio N/N_rated.

    Affinity laws:
        Q ∝ N   →  Q_s = speed_ratio × Q_rated
        H ∝ N²  →  H_s(Q) = speed_ratio² × H_base(Q / speed_ratio)

    Parameters
    ----------
    base_hq_fn   H-Q function at rated speed.
    speed_ratio  N/N_rated in (0, 1].  Values > 1 are allowed (over-speed).
    """
    if speed_ratio <= 0:
        raise ValueError(f"speed_ratio must be > 0, got {speed_ratio}")

    sr2 = speed_ratio ** 2

    def fn(q: float) -> float:
        q_base = q / speed_ratio
        return sr2 * base_hq_fn(q_base)
    return fn


def affinity_eta_fn(
    base_eta_fn: Callable[[float], float],
    speed_ratio: float,
) -> Callable[[float], float]:
    """
    Efficiency vs Q at a different speed.

    Affinity laws: η is approximately constant at the same duty point
    (same Q/Q_rated ratio).  So η_s(Q) ≈ η_base(Q / speed_ratio).

    Parameters
    ----------
    speed_ratio  N/N_rated.
    """
    if speed_ratio <= 0:
        raise ValueError(f"speed_ratio must be > 0")

    def fn(q: float) -> float:
        return base_eta_fn(q / speed_ratio)
    return fn


# ---------------------------------------------------------------------------
# Operating-point solver (bisection — no scipy required)
# ---------------------------------------------------------------------------


def find_operating_point(
    pump_hq_fn: Callable[[float], float],
    system_hq_fn: Callable[[float], float],
    q_min: float,
    q_max: float,
    tol_m3h: float = 0.01,
) -> Optional[Tuple[float, float]]:
    """
    Find the intersection of the pump H-Q curve and the system H-Q curve.

    Uses bisection (100 iterations maximum).

    Parameters
    ----------
    pump_hq_fn    Pump H as a function of Q [m³/h → m].
    system_hq_fn  System head as a function of Q [m³/h → m].
    q_min, q_max  Search bracket [m³/h].
    tol_m3h       Convergence tolerance [m³/h].

    Returns
    -------
    (Q*, H*)  operating point, or None if no intersection found in [q_min, q_max].
    """
    if q_min >= q_max:
        raise ValueError(f"q_min ({q_min}) must be < q_max ({q_max})")

    def residual(q: float) -> float:
        return pump_hq_fn(q) - system_hq_fn(q)

    f_lo = residual(q_min)
    f_hi = residual(q_max)

    # Check for sign change
    if f_lo * f_hi > 0:
        # No intersection in bracket — try a sweep to find one
        n_sweep = 50
        dq = (q_max - q_min) / n_sweep
        prev_q = q_min
        prev_f = f_lo
        for i in range(1, n_sweep + 1):
            curr_q = q_min + i * dq
            curr_f = residual(curr_q)
            if prev_f * curr_f <= 0:
                q_min, q_max = prev_q, curr_q
                f_lo, f_hi = prev_f, curr_f
                break
            prev_q, prev_f = curr_q, curr_f
        else:
            return None  # Truly no intersection

    # Bisection
    for _ in range(100):
        q_mid = 0.5 * (q_min + q_max)
        f_mid = residual(q_mid)
        if abs(f_mid) < 1e-6 or (q_max - q_min) < tol_m3h:
            h_star = 0.5 * (pump_hq_fn(q_mid) + system_hq_fn(q_mid))
            return q_mid, h_star
        if f_lo * f_mid < 0:
            q_max = q_mid
            f_hi = f_mid
        else:
            q_min = q_mid
            f_lo = f_mid

    q_mid = 0.5 * (q_min + q_max)
    h_star = 0.5 * (pump_hq_fn(q_mid) + system_hq_fn(q_mid))
    return q_mid, h_star


# ---------------------------------------------------------------------------
# System curve from tabular points
# ---------------------------------------------------------------------------


def build_system_hq_fn(
    q_pts: List[float],
    h_pts: List[float],
    static_head_m: float = 0.0,
) -> Callable[[float], float]:
    """
    Build a system-curve function from tabular Q-H points.

    When no points are supplied, returns a flat function equal to static_head_m
    (which gives an intersection at H = static_head_m regardless of Q — useful
    only for sanity checks).

    Parameters
    ----------
    q_pts, h_pts  Tabular system Q-H data.
    static_head_m Minimum head (static component); the system curve is
                  clamped so H ≥ static_head_m everywhere.
    """
    if len(q_pts) >= 2:
        q_sorted = sorted(range(len(q_pts)), key=lambda i: q_pts[i])
        qs = [q_pts[i] for i in q_sorted]
        hs = [h_pts[i] for i in q_sorted]
        base_fn = _make_linear_fn(qs, hs, lo_clamp=static_head_m)
        return base_fn
    else:
        def flat(q: float) -> float:
            return static_head_m
        return flat


# ---------------------------------------------------------------------------
# NPSH margin
# ---------------------------------------------------------------------------

_HI_MARGIN_ABSOLUTE_M = 0.6   # HI absolute minimum margin [m]
_HI_MARGIN_RELATIVE = 0.10    # HI relative minimum margin (10 % of NPSHr)


def npsh_margin(
    npsha: float,
    npshr_at_op: float,
) -> Tuple[float, List[str]]:
    """
    Compute NPSH margin and generate advisory warnings.

    Hydraulic Institute Standard 9.6.1 requires:
        margin ≥ max(0.6 m, 0.10 × NPSHr)

    Parameters
    ----------
    npsha         Available NPSH [m] at the operating point.
    npshr_at_op   Required NPSH from the pump curve at the operating flow [m].

    Returns
    -------
    (margin_m, warnings)
    """
    margin = npsha - npshr_at_op
    warns: List[str] = []
    hi_required = max(_HI_MARGIN_ABSOLUTE_M, _HI_MARGIN_RELATIVE * npshr_at_op)

    if margin < 0:
        warns.append(
            f"NPSH VIOLATION: NPSHa = {npsha:.2f} m < NPSHr = {npshr_at_op:.2f} m "
            f"at the operating point. Cavitation is expected — increase suction head, "
            f"reduce suction pipe losses, or select a lower-NPSHr impeller."
        )
    elif margin < hi_required:
        warns.append(
            f"NPSH margin ({margin:.2f} m) is below the HI 9.6.1 recommended minimum of "
            f"{hi_required:.2f} m (max of 0.6 m or 10 % of NPSHr = {npshr_at_op:.2f} m). "
            f"Consider increasing suction-side head or lowering the pump."
        )
    return margin, warns


# ---------------------------------------------------------------------------
# Curve-point generator (for charting)
# ---------------------------------------------------------------------------


def generate_curve_points(
    fn: Callable[[float], float],
    q_min: float,
    q_max: float,
    n_pts: int = 30,
) -> List[dict]:
    """
    Evaluate fn at n_pts equally-spaced flow values.

    Returns
    -------
    List of {"Q_m3h": ..., "value": ...} dicts.
    """
    if n_pts < 2:
        raise ValueError(f"n_pts must be ≥ 2, got {n_pts}")
    if q_min >= q_max:
        raise ValueError(f"q_min ({q_min}) must be < q_max ({q_max})")

    pts = []
    for i in range(n_pts):
        q = q_min + (q_max - q_min) * i / (n_pts - 1)
        v = fn(q)
        pts.append({"Q_m3h": round(q, 4), "value": round(max(0.0, v), 6)})
    return pts


# ---------------------------------------------------------------------------
# Helpers for loading tabular data from a pump record dict
# ---------------------------------------------------------------------------


def extract_curve_arrays(
    pump_record: dict,
    curve_key: str,
    value_key: str,
) -> Tuple[List[float], List[float]]:
    """
    Extract Q and value arrays from a pump library record.

    Parameters
    ----------
    pump_record  Raw dict from pump_library.yaml.
    curve_key    e.g. ``"hq_curve"``, ``"eta_q_curve"``.
    value_key    e.g. ``"H_m"``, ``"eta_pct"``, ``"P_kW"``, ``"NPSHr_m"``.

    Returns
    -------
    (q_pts, v_pts) — parallel lists.

    Raises
    ------
    KeyError if the curve is missing from the record.
    ValueError if any point is missing the expected key.
    """
    points = pump_record.get(curve_key)
    if not points:
        raise KeyError(
            f"Pump '{pump_record.get('id', '?')}' has no '{curve_key}' data."
        )
    q_pts = []
    v_pts = []
    for pt in points:
        if "Q_m3h" not in pt or value_key not in pt:
            raise ValueError(
                f"Curve point in '{curve_key}' missing 'Q_m3h' or '{value_key}': {pt}"
            )
        q_pts.append(float(pt["Q_m3h"]))
        v_pts.append(float(pt[value_key]))
    return q_pts, v_pts


def pump_q_max(pump_record: dict) -> float:
    """Return the maximum Q from the pump's H-Q tabular data."""
    q_pts, _ = extract_curve_arrays(pump_record, "hq_curve", "H_m")
    return max(q_pts)


def pump_q_rated(pump_record: dict) -> float:
    """Return the rated flow from the pump record."""
    return float(pump_record.get("rated_flow_m3h", pump_q_max(pump_record)))


# ---------------------------------------------------------------------------
# Power from H and η (for when P-Q data is absent)
# ---------------------------------------------------------------------------

_RHO_W_KG_M3 = 1000.0
_G_M_S2 = 9.81


def hydraulic_power_kw(Q_m3h: float, H_m: float, eta_pct: float) -> float:
    """
    Compute shaft power from flow, head, and pump efficiency.

    P = ρ·g·Q·H / η  [kW]

    Parameters
    ----------
    Q_m3h    Flow [m³/h].
    H_m      Head [m].
    eta_pct  Pump efficiency [%].
    """
    if eta_pct <= 0:
        return 0.0
    Q_m3s = Q_m3h / 3600.0
    return _RHO_W_KG_M3 * _G_M_S2 * Q_m3s * H_m / (eta_pct / 100.0) / 1000.0
