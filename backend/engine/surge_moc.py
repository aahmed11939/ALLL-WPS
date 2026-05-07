"""
Surge / water-hammer Mode B — Method of Characteristics (MOC) transient solver.

Discretises a single pipeline into N reaches and advances the MOC equations
in time using the explicit characteristic-line method (Wylie & Streeter §3-4).

Key simplifications (documented as engineering assumptions):
1. Quasi-steady friction: f is evaluated at steady-state Re and held constant.
   Conservative for screening; widely accepted in engineering practice.
2. Simplified pump-trip model: pump head decays quadratically over t_trip; no
   rotating-inertia (Suter curve) model. Extension point is documented.
3. Multi-segment collapse: flow-weighted mean internal diameter and length-
   weighted mean roughness represent the equivalent uniform grid.
4. Column separation: vapour-pocket model — head clamped at h_vap(T).
   Void volume growth is not tracked; local clamping is conservative.
5. Courant = 1.0 enforced: Δt = Δx / a.

References
----------
- Wylie, E. B. & Streeter, V. L. (1993). Fluid Transients in Systems. Ch. 3.
- Chaudhry, M. H. (2014). Applied Hydraulic Transients. 3rd ed. Ch. 4.
- AWWA Manual M51 — Air-Release, Air/Vacuum, and Combination Air Valves.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod

from backend.engine.hydraulics import NU_WATER, friction_factor_colebrook
from backend.engine.surge import vapor_pressure_head_gauge_m

G: float = 9.81  # m/s²

ASSUMPTION_NOTES: list[str] = [
    "Quasi-steady Darcy-Weisbach friction: f evaluated at steady-state Re and "
    "held constant throughout the simulation (Wylie & Streeter §2.4). "
    "Acceptable for engineering screening.",
    "Simplified pump-trip head-decay model: H_source(t) = H_pump × (1 − t/t_trip)². "
    "No rotating-inertia (Suter curve) model. PumpTripBC is structured for "
    "future replacement with a full inertia model.",
    "Multi-segment pipeline: flow-weighted mean internal diameter D̄ and "
    "length-weighted mean roughness ε̄ define a single uniform grid. "
    "Elevation profile is piecewise-linearly interpolated from each segment's "
    "elev_start_m / elev_end_m breakpoints. Diameter changes are not modelled "
    "explicitly (conservative for screening).",
    "Column separation: minimum head clamped to vapour pressure h_vap(T) "
    "(vapour-pocket model). Void volume growth is not tracked.",
    "Courant number = 1.0 enforced: Δt = Δx / a. Total simulation duration "
    "= max(10 × T_char, 30 s) unless overridden.",
]


# ---------------------------------------------------------------------------
# Grid builder
# ---------------------------------------------------------------------------

def build_grid(
    segments: list[dict],
    wave_speed_ms: float,
    n_reaches_override: int | None = None,
    dx_target_m: float = 60.0,
) -> dict:
    """
    Collapse a multi-segment pipeline into a uniform MOC grid.

    Parameters
    ----------
    segments          : list of dicts, each with keys L_m, D_m, roughness_m,
                        elev_start_m, elev_end_m
    wave_speed_ms     : acoustic wave speed a [m/s]
    n_reaches_override: override automatic N calculation (10–200)
    dx_target_m       : target reach length [m] (default 60 m)

    Returns
    -------
    dict with all grid quantities needed by run_moc().
    """
    if not segments:
        raise ValueError("At least one pipeline segment is required.")

    L_total = sum(float(s["L_m"]) for s in segments)
    if L_total <= 0:
        raise ValueError("Total pipeline length must be > 0 m.")
    if wave_speed_ms <= 0:
        raise ValueError("Wave speed must be > 0 m/s.")

    # Flow-weighted mean internal diameter
    D_mean = sum(float(s["L_m"]) * float(s["D_m"]) for s in segments) / L_total

    # Length-weighted mean roughness
    roughness_mean = (
        sum(float(s["L_m"]) * float(s.get("roughness_m", 1e-4)) for s in segments)
        / L_total
    )

    # Grid resolution
    if n_reaches_override is not None:
        N = max(10, min(200, int(n_reaches_override)))
    else:
        N = max(10, min(200, round(L_total / dx_target_m)))

    dx = L_total / N
    dt = dx / wave_speed_ms  # Courant = 1 exactly

    # Node positions
    x_nodes = [i * dx for i in range(N + 1)]

    # Piecewise-linear elevation profile across segment breakpoints.
    # Each segment contributes its own start/end elevation, so undulating
    # profiles (e.g. rising then falling) are captured correctly.
    bp_x: list[float] = [0.0]
    bp_e: list[float] = [float(segments[0].get("elev_start_m", 0.0))]
    cumx = 0.0
    for seg in segments:
        cumx += float(seg["L_m"])
        bp_x.append(cumx)
        bp_e.append(float(seg.get("elev_end_m", bp_e[-1])))

    def _interp_elev(xi: float) -> float:
        """Return piecewise-linearly interpolated elevation at grid position xi."""
        for k in range(len(bp_x) - 1):
            x0, x1 = bp_x[k], bp_x[k + 1]
            if xi <= x1 + 1e-9:
                span = x1 - x0
                t = (xi - x0) / span if span > 1e-12 else 0.0
                return bp_e[k] + t * (bp_e[k + 1] - bp_e[k])
        return bp_e[-1]

    elev_nodes = [_interp_elev(xi) for xi in x_nodes]

    A = math.pi * D_mean ** 2 / 4.0
    B_imp = wave_speed_ms / (G * A)   # pipeline impedance [s/m²]

    return {
        "N":           N,
        "dx_m":        dx,
        "dt_s":        dt,
        "courant":     1.0,
        "L_total_m":   L_total,
        "D_m":         D_mean,
        "roughness_m": roughness_mean,
        "x_m":         x_nodes,
        "elev_m":      elev_nodes,
        "A_m2":        A,
        "B":           B_imp,
    }


# ---------------------------------------------------------------------------
# Boundary condition abstractions
# ---------------------------------------------------------------------------

class BoundaryCondition(ABC):
    """
    Abstract base for MOC boundary conditions.

    Each BC receives the characteristic intercept (CM for upstream node,
    CP for downstream node) and the pipeline impedance B, and returns
    (H_P, Q_P) at the boundary node.
    """

    @abstractmethod
    def apply(
        self,
        t: float,
        cp_or_cm: float,
        B: float,
        is_upstream: bool,
    ) -> tuple[float, float]:
        """
        Compute (H_P, Q_P) at boundary node at simulation time t.

        Parameters
        ----------
        t           : current time [s]
        cp_or_cm    : upstream → CM (C- intercept from node 1);
                      downstream → CP (C+ intercept from node N-1)
        B           : pipeline impedance a/(g·A) [s/m²]
        is_upstream : True for node 0, False for node N
        """


class ReservoirBC(BoundaryCondition):
    """Constant-head reservoir / fixed-HGL boundary."""

    def __init__(self, H_res_m: float) -> None:
        self.H_res = H_res_m

    def apply(
        self,
        t: float,
        cp_or_cm: float,
        B: float,
        is_upstream: bool,
    ) -> tuple[float, float]:
        H_P = self.H_res
        if is_upstream:
            # C-: H_P - B·Q_P = CM  →  Q_P = (H_P - CM) / B
            Q_P = (H_P - cp_or_cm) / B
        else:
            # C+: H_P + B·Q_P = CP  →  Q_P = (CP - H_P) / B
            Q_P = (cp_or_cm - H_P) / B
        return H_P, Q_P


class PumpTripBC(BoundaryCondition):
    """
    Upstream pump boundary for a discharge pipeline with pump trip.

    Pre-trip  (t ≤ 0)       : steady-state pump head H_pump_0.
    During trip (0 < t ≤ t_trip): head decays quadratically:
        H_source(t) = H_pump_0 × (1 − t/t_trip)²
    Post-trip  (t > t_trip) : check valve seated, Q = 0.

    # TODO: replace the head-decay model with a full rotating-inertia
    #        (Suter curve) model for physically realistic pump-trip transients.
    """

    def __init__(
        self,
        H_pump_0: float,
        Q_0: float,
        t_trip: float,
        H_reservoir_m: float,
    ) -> None:
        self.H_pump_0  = H_pump_0
        self.Q_0       = Q_0
        self.t_trip    = max(t_trip, 1e-9)
        self.H_res     = H_reservoir_m

    def apply(
        self,
        t: float,
        cp_or_cm: float,
        B: float,
        is_upstream: bool,
    ) -> tuple[float, float]:
        CM = cp_or_cm  # C- intercept from node 1

        if t <= 0.0:
            return self.H_pump_0, self.Q_0

        if t <= self.t_trip:
            tau = 1.0 - t / self.t_trip
            H_source = self.H_pump_0 * tau ** 2
            Q_P = (H_source - CM) / B
            if Q_P <= 0.0:
                # Check valve seats
                return CM, 0.0
            return H_source, Q_P

        # Post-trip: check valve seated; Q = 0, H from C- only
        return CM, 0.0


class ValveClosureBC(BoundaryCondition):
    """
    Downstream valve closure boundary.

    Gate-valve model: Q_P = Q_0 · τ(t)²  where τ is the opening fraction.
    Linear closure:         τ(t) = max(0, 1 − t / t_close)
    Equal-percentage:       τ(t) = max(0, 1 − t / t_close)²  → Q ∝ fraction⁴
    """

    def __init__(
        self,
        Q_0: float,
        t_close: float,
        profile: str = "linear",
    ) -> None:
        self.Q_0     = Q_0
        self.t_close = max(t_close, 1e-9)
        self.profile = profile

    def _tau(self, t: float) -> float:
        if t <= 0.0:
            return 1.0
        if t >= self.t_close:
            return 0.0
        frac = 1.0 - t / self.t_close
        return frac ** 2 if self.profile == "equal_percentage" else frac

    def apply(
        self,
        t: float,
        cp_or_cm: float,
        B: float,
        is_upstream: bool,
    ) -> tuple[float, float]:
        CP  = cp_or_cm
        tau = self._tau(t)
        Q_P = self.Q_0 * tau ** 2          # orifice / gate-valve model
        H_P = CP - B * Q_P                 # from C+ equation
        return H_P, Q_P


class SuctionPumpTripBC(BoundaryCondition):
    """
    Downstream boundary for a suction pipeline modelling pump demand collapse.

    The pump inlet head drops linearly from H_sump to 0 over t_trip,
    representing the cessation of pump demand. Flow is derived from the C+
    characteristic.
    """

    def __init__(
        self,
        H_sump_m: float,
        Q_0: float,
        t_trip: float,
    ) -> None:
        self.H_sump = H_sump_m
        self.Q_0    = Q_0
        self.t_trip = max(t_trip, 1e-9)

    def apply(
        self,
        t: float,
        cp_or_cm: float,
        B: float,
        is_upstream: bool,
    ) -> tuple[float, float]:
        CP = cp_or_cm
        if t <= 0.0:
            H_P = self.H_sump
        elif t <= self.t_trip:
            tau = 1.0 - t / self.t_trip
            H_P = self.H_sump * tau
        else:
            H_P = 0.0
        Q_P = (CP - H_P) / B
        return H_P, Q_P


# ---------------------------------------------------------------------------
# MOC solver
# ---------------------------------------------------------------------------

def run_moc(
    *,
    segments: list[dict],
    wave_speed_ms: float,
    Q_0_m3s: float,
    H_0_m: float,
    boundary_A: BoundaryCondition,
    boundary_B: BoundaryCondition,
    temperature_C: float = 20.0,
    rho_kg_m3: float = 1000.0,
    pressure_rating_kPa: float | None = None,
    observation_fracs: list[float] | None = None,
    observation_labels: list[str] | None = None,
    n_reaches_override: int | None = None,
    t_total_override: float | None = None,
    nu: float = NU_WATER,
) -> dict:
    """
    Run a 1-D MOC transient simulation on a single pipeline.

    Parameters
    ----------
    segments            : list of dicts with L_m, D_m, roughness_m,
                          elev_start_m, elev_end_m
    wave_speed_ms       : acoustic wave speed a [m/s]
    Q_0_m3s             : steady-state design flow rate [m³/s]
    H_0_m               : steady-state upstream piezometric head [m]
    boundary_A          : upstream boundary condition (node 0)
    boundary_B          : downstream boundary condition (node N)
    temperature_C       : water temperature [°C] (for vapour pressure)
    rho_kg_m3           : fluid density [kg/m³]
    pressure_rating_kPa : optional pipe pressure class for FoS check
    observation_fracs   : fractional positions 0–1 for time histories
    observation_labels  : labels for observation points
    n_reaches_override  : override N (10–200)
    t_total_override    : simulation duration override [s]
    nu                  : kinematic viscosity [m²/s]

    Returns
    -------
    dict with envelope arrays, time histories, grid metadata,
    assumption notes, and optional rating check.
    """
    # ── 1. Build grid ───────────────────────────────────────────────────────
    grid = build_grid(
        segments=segments,
        wave_speed_ms=wave_speed_ms,
        n_reaches_override=n_reaches_override,
    )

    N            = grid["N"]
    dx           = grid["dx_m"]
    dt           = grid["dt_s"]
    D            = grid["D_m"]
    A            = grid["A_m2"]
    roughness    = grid["roughness_m"]
    x_nodes      = grid["x_m"]
    elev_nodes   = grid["elev_m"]
    L            = grid["L_total_m"]
    B_imp        = grid["B"]

    # ── 2. Quasi-steady friction factor ────────────────────────────────────
    if Q_0_m3s > 0.0 and A > 0.0 and D > 0.0:
        V0   = Q_0_m3s / A
        Re   = V0 * D / nu if nu > 0 else 1e5
        eps_D = roughness / D
        try:
            f = friction_factor_colebrook(Re, eps_D)
        except ValueError:
            f = 0.02
    else:
        f = 0.02

    # Quasi-steady friction resistance R [s²/m⁶] — see Wylie & Streeter §2.4
    R = f / (2.0 * G * D * A ** 2) if (D > 0.0 and A > 0.0) else 0.0

    # ── 3. Simulation duration ──────────────────────────────────────────────
    T_char = 2.0 * L / wave_speed_ms
    if t_total_override is not None and t_total_override > 0.0:
        t_total = float(t_total_override)
    else:
        t_total = max(10.0 * T_char, 30.0)

    n_steps = min(20_000, max(2, int(math.ceil(t_total / dt))))
    t_total = n_steps * dt  # actual duration after capping

    # ── 4. Vapour pressure head ─────────────────────────────────────────────
    h_vap = vapor_pressure_head_gauge_m(temperature_C, rho_kg_m3)

    # ── 5. Observation nodes ─────────────────────────────────────────────────
    if not observation_fracs:
        observation_fracs  = [0.0, 0.5, 1.0]
        observation_labels = [
            f"Upstream (x=0 m)",
            f"Midpoint (x={L/2:.0f} m)",
            f"Downstream (x={L:.0f} m)",
        ]
    if observation_labels is None:
        observation_labels = [f"x = {f * L:.0f} m" for f in observation_fracs]

    obs_nodes = [
        min(N, max(0, round(frac * N)))
        for frac in observation_fracs
    ]

    # Downsample factor so total history points ≤ ~2000
    record_every = max(1, n_steps // 2000)

    # Storage for time histories
    history_t: list[float] = []
    history_H: list[list[float]] = [[] for _ in obs_nodes]
    history_Q: list[list[float]] = [[] for _ in obs_nodes]

    # ── 6. Steady-state initial conditions ─────────────────────────────────
    # Linear head profile: H_0 at x=0, dropping by friction losses.
    if Q_0_m3s > 0.0 and A > 0.0:
        hf_total = f * (L / D) * (Q_0_m3s / A) ** 2 / (2.0 * G) if D > 0 else 0.0
    else:
        hf_total = 0.0

    H: list[float] = [
        H_0_m - hf_total * (xi / L) for xi in x_nodes
    ]
    Q: list[float] = [Q_0_m3s] * (N + 1)

    # ── 7. Envelope tracking ────────────────────────────────────────────────
    H_max: list[float] = H[:]
    H_min: list[float] = H[:]

    # Working arrays (pre-allocated)
    H_new: list[float] = [0.0] * (N + 1)
    Q_new: list[float] = [0.0] * (N + 1)

    # ── 8. Time loop ────────────────────────────────────────────────────────
    for step in range(n_steps):
        t = step * dt

        # Record time history (downsampled)
        if step % record_every == 0:
            history_t.append(round(t, 6))
            for ki, ni in enumerate(obs_nodes):
                history_H[ki].append(round(H[ni], 4))
                history_Q[ki].append(round(Q[ni], 6))

        # ── 8a. Interior nodes (i = 1 … N-1) ────────────────────────────
        for i in range(1, N):
            CP = H[i-1] + B_imp * Q[i-1] - R * dx * Q[i-1] * abs(Q[i-1])
            CM = H[i+1] - B_imp * Q[i+1] + R * dx * Q[i+1] * abs(Q[i+1])
            H_new[i] = (CP + CM) / 2.0
            Q_new[i] = (CP - CM) / (2.0 * B_imp)

        # ── 8b. Upstream boundary (node 0) ───────────────────────────────
        CM0 = H[1] - B_imp * Q[1] + R * dx * Q[1] * abs(Q[1])
        H_new[0], Q_new[0] = boundary_A.apply(t, CM0, B_imp, is_upstream=True)

        # ── 8c. Downstream boundary (node N) ────────────────────────────
        CP_N = H[N-1] + B_imp * Q[N-1] - R * dx * Q[N-1] * abs(Q[N-1])
        H_new[N], Q_new[N] = boundary_B.apply(t, CP_N, B_imp, is_upstream=False)

        # ── 8d. Column separation clamping ───────────────────────────────
        for i in range(N + 1):
            if H_new[i] < h_vap:
                H_new[i] = h_vap

        # ── 8e. Update envelope ──────────────────────────────────────────
        for i in range(N + 1):
            if H_new[i] > H_max[i]:
                H_max[i] = H_new[i]
            if H_new[i] < H_min[i]:
                H_min[i] = H_new[i]

        # Swap arrays (avoids allocation inside the loop)
        H, H_new = H_new, H
        Q, Q_new = Q_new, Q

    # ── 9. Build response dictionary ─────────────────────────────────────────

    def _kPa(h_m: float) -> float:
        return h_m * rho_kg_m3 * G / 1000.0

    envelope = [
        {
            "x_m":       round(x_nodes[i], 3),
            "elev_m":    round(elev_nodes[i], 3),
            "H_max_m":   round(H_max[i], 3),
            "H_min_m":   round(H_min[i], 3),
            "P_max_kPa": round(_kPa(H_max[i]), 2),
            "P_min_kPa": round(_kPa(H_min[i]), 2),
        }
        for i in range(N + 1)
    ]

    global_max_H = max(H_max)
    global_min_H = min(H_min)

    # Cavitation nodes: H_min was clamped to h_vap
    cavitation_x = [
        round(x_nodes[i], 3)
        for i in range(N + 1)
        if abs(H_min[i] - h_vap) < 0.05
    ]

    # Build observation results
    observations = []
    for ki, (ni, frac, label) in enumerate(
        zip(obs_nodes, observation_fracs, observation_labels)
    ):
        points = [
            {
                "t_s":   history_t[j],
                "H_m":   history_H[ki][j],
                "P_kPa": round(_kPa(history_H[ki][j]), 2),
            }
            for j in range(len(history_t))
        ]
        observations.append(
            {
                "label":      label,
                "frac":       frac,
                "node_index": ni,
                "x_m":        round(x_nodes[ni], 3),
                "history":    points,
            }
        )

    # Optional pressure rating check
    rating_check: dict | None = None
    if pressure_rating_kPa is not None and pressure_rating_kPa > 0:
        max_kPa = _kPa(global_max_H)
        min_kPa = _kPa(global_min_H)
        fos = (
            pressure_rating_kPa / max_kPa
            if max_kPa > 0
            else float("inf")
        )
        status = "pass" if fos >= 1.25 else ("caution" if fos >= 1.0 else "fail")
        rating_check = {
            "steady_state_pressure_kPa": round(_kPa(H_0_m), 2),
            "max_transient_kPa":         round(max_kPa, 2),
            "min_transient_kPa":         round(min_kPa, 2),
            "pressure_rating_kPa":       round(pressure_rating_kPa, 2),
            "factor_of_safety":          round(fos, 3),
            "rating_status":             status,
        }

    return {
        "N":              N,
        "dx_m":           round(dx, 4),
        "dt_s":           round(dt, 6),
        "courant":        1.0,
        "t_total_s":      round(t_total, 3),
        "n_steps":        n_steps,
        "D_m":            round(D, 6),
        "f":              round(f, 6),
        "T_char_s":       round(T_char, 3),
        "envelope":       envelope,
        "observations":   observations,
        "global_max_H_m": round(global_max_H, 3),
        "global_min_H_m": round(global_min_H, 3),
        "global_max_P_kPa": round(_kPa(global_max_H), 2),
        "global_min_P_kPa": round(_kPa(global_min_H), 2),
        "cavitation_x_m": cavitation_x,
        "h_vap_m":        round(h_vap, 3),
        "temperature_C":  temperature_C,
        "assumption_notes": ASSUMPTION_NOTES,
        "rating_check":   rating_check,
    }
