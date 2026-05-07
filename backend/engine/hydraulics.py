"""
Hydraulic calculation engine for ALLL WPS Designer.

All calculations follow AWWA M11 / Hydraulic Institute standards.
Units: SI throughout (m, m³/s, m/s, Pa).
"""

from __future__ import annotations

import math
from typing import NamedTuple

# Kinematic viscosity of water at 20 °C [m²/s]
NU_WATER: float = 1.004e-6
# Gravitational acceleration [m/s²]
G: float = 9.81


# ---------------------------------------------------------------------------
# Low-level primitives
# ---------------------------------------------------------------------------


def velocity(Q_m3s: float, D_m: float) -> float:
    """
    Return mean flow velocity in a full circular pipe [m/s].

    Parameters
    ----------
    Q_m3s : float  Volumetric flow rate [m³/s]
    D_m   : float  Internal pipe diameter [m]

    Raises
    ------
    ValueError if D_m <= 0 or Q_m3s < 0.
    """
    if D_m <= 0:
        raise ValueError(f"Pipe diameter must be > 0, got {D_m}")
    if Q_m3s < 0:
        raise ValueError(f"Flow rate must be >= 0, got {Q_m3s}")
    A = math.pi * D_m**2 / 4.0
    return Q_m3s / A


def reynolds_number(Q_m3s: float, D_m: float, nu: float = NU_WATER) -> float:
    """
    Return the Reynolds number Re = V·D / ν [-].

    Parameters
    ----------
    Q_m3s : float  Volumetric flow rate [m³/s]
    D_m   : float  Internal pipe diameter [m]
    nu    : float  Kinematic viscosity [m²/s]  (default 20 °C water)
    """
    V = velocity(Q_m3s, D_m)
    return V * D_m / nu


def friction_factor_colebrook(Re: float, relative_roughness: float) -> float:
    """
    Compute the Darcy-Weisbach friction factor f using the Colebrook-White
    implicit equation, iterated to convergence.

    For laminar flow (Re < 2300) the exact relation f = 64/Re is returned.
    The Swamee-Jain explicit approximation is used as the initial guess for
    Newton-Raphson iteration (Colebrook-White is reformulated as a root-finding
    problem on 1/√f for fast convergence).

    Parameters
    ----------
    Re               : float  Reynolds number [-]
    relative_roughness: float  ε/D  [-]  (must be >= 0)

    Returns
    -------
    f : float  Darcy-Weisbach friction factor [-]

    Raises
    ------
    ValueError if Re <= 0.
    """
    if Re <= 0:
        raise ValueError(f"Reynolds number must be > 0, got {Re}")
    if relative_roughness < 0:
        raise ValueError(f"Relative roughness must be >= 0, got {relative_roughness}")

    # Laminar regime
    if Re < 2300:
        return 64.0 / Re

    # Swamee-Jain explicit approximation as initial guess
    eps_D = relative_roughness
    if Re >= 2300 and eps_D == 0.0:
        # Smooth pipe — use Filonenko approximation
        f_guess = (0.79 * math.log(Re) - 1.64) ** (-2)
    else:
        f_guess = 0.25 / (math.log10(eps_D / 3.7 + 5.74 / Re**0.9)) ** 2

    # Iterate Colebrook-White in the form 1/√f = -2 log10(ε/(3.7D) + 2.51/(Re·√f))
    # Let x = 1/√f, so √f = 1/x and the fixed-point form is:
    #   x_{n+1} = -2 log10(ε/(3.7D) + 2.51·x_n / Re)
    # (since 2.51/(Re·√f) = 2.51/(Re/x) = 2.51·x/Re)
    x = 1.0 / math.sqrt(f_guess)
    for _ in range(50):
        x_new = -2.0 * math.log10(eps_D / 3.7 + 2.51 * x / Re)
        if abs(x_new - x) < 1e-9:
            x = x_new
            break
        x = x_new

    f = 1.0 / x**2
    return f


def friction_head_loss(
    Q_m3s: float,
    D_m: float,
    L_m: float,
    roughness_m: float,
    nu: float = NU_WATER,
) -> float:
    """
    Return Darcy-Weisbach friction head loss h_f [m].

        h_f = f · (L/D) · V²/(2g)

    Parameters
    ----------
    Q_m3s      : float  Flow rate [m³/s]
    D_m        : float  Internal diameter [m]
    L_m        : float  Pipe length [m]
    roughness_m: float  Absolute roughness ε [m]
    nu         : float  Kinematic viscosity [m²/s]

    Raises
    ------
    ValueError if D_m, L_m <= 0 or roughness_m < 0.
    """
    if L_m <= 0:
        raise ValueError(f"Pipe length must be > 0, got {L_m}")
    if roughness_m < 0:
        raise ValueError(f"Roughness must be >= 0, got {roughness_m}")

    if Q_m3s == 0.0:
        return 0.0

    V = velocity(Q_m3s, D_m)
    Re = reynolds_number(Q_m3s, D_m, nu)
    eps_D = roughness_m / D_m
    f = friction_factor_colebrook(Re, eps_D)
    h_f = f * (L_m / D_m) * (V**2 / (2.0 * G))
    return h_f


def minor_head_loss(
    Q_m3s: float,
    D_m: float,
    K_values: list[float],
) -> float:
    """
    Return total minor (fitting) head loss h_m [m].

        h_m = (ΣK) · V²/(2g)

    Parameters
    ----------
    Q_m3s    : float        Flow rate [m³/s]
    D_m      : float        Internal diameter [m]
    K_values : list[float]  Loss coefficients K for each fitting [-]
    """
    if Q_m3s == 0.0 or not K_values:
        return 0.0

    V = velocity(Q_m3s, D_m)
    K_sum = sum(K_values)
    h_m = K_sum * (V**2 / (2.0 * G))
    return h_m


def static_head(elev_ds_m: float, elev_us_m: float) -> float:
    """
    Return the static head h_s = downstream elevation − upstream elevation [m].

    A positive value means the system must lift water (pumping up).
    A negative value means the downstream point is lower (gravity assist).

    Parameters
    ----------
    elev_ds_m : float  Downstream (delivery) elevation above datum [m]
    elev_us_m : float  Upstream (suction) elevation above datum [m]
    """
    return elev_ds_m - elev_us_m


def tdh(h_s: float, h_f: float, h_m: float) -> float:
    """
    Return Total Dynamic Head TDH [m].

        TDH = h_s + h_f + h_m

    Parameters
    ----------
    h_s : float  Static head [m]
    h_f : float  Friction head loss [m]
    h_m : float  Minor head loss [m]
    """
    return h_s + h_f + h_m


# ---------------------------------------------------------------------------
# System curve
# ---------------------------------------------------------------------------


class SystemCurvePoint(NamedTuple):
    Q_m3h: float   # Flow rate [m³/h]
    H_m: float     # System head [m]


def system_curve(
    Q_design_m3s: float,
    D_m: float,
    L_m: float,
    roughness_m: float,
    K_sum: float,
    h_s: float,
    n_points: int = 8,
    nu: float = NU_WATER,
) -> list[dict]:
    """
    Compute the system H-Q curve over [0, 1.5 × Q_design].

    The static head component h_s is constant (elevation difference).
    Friction and minor losses scale with Q (quadratically for turbulent flow,
    but the exact Colebrook-White f is re-evaluated at each Q so the friction
    factor variation across the curve is captured correctly).

    Parameters
    ----------
    Q_design_m3s : float  Design flow rate [m³/s]
    D_m          : float  Internal diameter [m]
    L_m          : float  Pipe length [m]
    roughness_m  : float  Absolute roughness ε [m]
    K_sum        : float  Sum of all minor-loss coefficients [-]
    h_s          : float  Static head [m]
    n_points     : int    Number of curve points (default 8)
    nu           : float  Kinematic viscosity [m²/s]

    Returns
    -------
    list of dict  Each dict has keys 'Q_m3h' and 'H_m'.
    """
    if n_points < 2:
        raise ValueError("n_points must be >= 2")

    Q_max = 1.5 * Q_design_m3s
    step = Q_max / (n_points - 1)

    points: list[dict] = []
    for i in range(n_points):
        Q_i = i * step
        h_f_i = friction_head_loss(Q_i, D_m, L_m, roughness_m, nu) if Q_i > 0 else 0.0
        h_m_i = minor_head_loss(Q_i, D_m, [K_sum]) if (Q_i > 0 and K_sum > 0) else 0.0
        H_i = tdh(h_s, h_f_i, h_m_i)
        points.append({"Q_m3h": round(Q_i * 3600.0, 4), "H_m": round(H_i, 4)})

    return points
