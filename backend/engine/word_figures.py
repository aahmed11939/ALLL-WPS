"""
Matplotlib figure generators for the ALLL WPS Designer Word report.

Each public function accepts the raw ``draft`` dict (serialised ProjectDraft)
and returns a PNG byte string ready for embedding, or ``None`` when the
required data is absent.

Public API
----------
fig_system_curve(draft, us="SI") -> bytes | None
    Pump H-Q + system curve overlay with operating duty point(s).
    Includes VFD speed-step curves when present.

fig_efficiency_power(draft) -> bytes | None
    Pump efficiency η (%) vs flow — single panel.

fig_npsh(draft) -> bytes | None
    NPSHr and NPSHa vs flow — single panel.

fig_surge_envelope_suction(draft) -> bytes | None
    MOC pressure envelope (H_max, H_min, elevation) for the suction pipeline.

fig_surge_envelope_discharge(draft) -> bytes | None
    MOC pressure envelope (H_max, H_min, elevation) for the discharge pipeline.

fig_moc_histories(draft) -> bytes | None
    Head time histories at each observation node (up to 5 nodes).

fig_protection_comparison(draft) -> bytes | None
    Bar chart: global H_max and H_min for baseline + each device run.
"""

from __future__ import annotations

import io
from typing import Any


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _mpl():
    """Lazy-import matplotlib in Agg mode to avoid GUI dependencies."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    return plt


def _to_png(fig) -> bytes:
    """Save a matplotlib Figure to PNG bytes at 150 dpi, then close it."""
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight")
    _mpl().close(fig)
    buf.seek(0)
    return buf.read()


_COLORS = {
    "navy":   "#1F3864",
    "teal":   "#1A5276",
    "blue":   "#2E5B8C",
    "red":    "#C0392B",
    "green":  "#27AE60",
    "orange": "#E67E22",
    "purple": "#8E44AD",
    "grey":   "#5D6D7E",
    "steel":  "#5D8AA8",
}


def _speed_colors(n: int) -> list[str]:
    """Return a list of *n* blue-range colours for speed-step curves."""
    import matplotlib.pyplot as _plt
    cmap = _plt.get_cmap("Blues")
    return [cmap(0.4 + 0.5 * i / max(n - 1, 1)) for i in range(n)]


# ---------------------------------------------------------------------------
# Public figure functions
# ---------------------------------------------------------------------------


def fig_system_curve(draft: dict, us: str = "SI") -> bytes | None:
    """
    Pump H-Q curve(s) + system curve overlay with duty operating point(s).

    Renders:
    - System H-Q curve (blue solid)
    - Full-speed pump H-Q curve (dark navy solid, thicker)
    - VFD speed-step curves (blue dashed, thin, up to 5 steps)
    - Duty operating point(s) (red scatter)

    Parameters
    ----------
    draft : dict
        Serialised ProjectDraft.
    us : str
        Unit system label shown in axis labels ("SI" or "US").

    Returns None when both system_curve and pump hq_curve are absent.
    """
    hyd  = draft.get("hydraulicsResult") or {}
    pump = draft.get("pumpResult")       or {}

    sys_pts  = hyd.get("system_curve", [])       or []
    hq_pts   = pump.get("hq_curve", [])           or []
    sp_curves= pump.get("speed_curves", [])        or []
    ops      = pump.get("operating_points", [])    or []

    if not sys_pts and not hq_pts:
        return None

    plt = _mpl()
    fig, ax = plt.subplots(figsize=(6.5, 4.0))

    if sys_pts:
        qs = [p.get("Q_m3h", 0) for p in sys_pts]
        hs = [p.get("H_m", 0)   for p in sys_pts]
        ax.plot(qs, hs, color=_COLORS["blue"], linewidth=2.2,
                label="System curve", zorder=3)

    if hq_pts:
        qs = [p.get("Q_m3h", 0) for p in hq_pts]
        hs = [p.get("value", 0) for p in hq_pts]
        ax.plot(qs, hs, color=_COLORS["navy"], linewidth=2.8,
                label="Pump H-Q (rated speed)", zorder=4)

    if sp_curves:
        colours = _speed_colors(len(sp_curves))
        for sc, col in zip(sp_curves[:5], colours):
            spd = sc.get("speed_pct", 100)
            pts = sc.get("hq_pts", []) or []
            if pts:
                qs2 = [p.get("Q_m3h", 0) for p in pts]
                hs2 = [p.get("value", p.get("H_m", 0)) for p in pts]
                ax.plot(qs2, hs2, "--", linewidth=1.4, color=col,
                        label=f"{spd}% speed", zorder=2)

    for op in ops:
        n  = op.get("n_pumps", 1)
        qo = op.get("Q_m3h", 0)
        ho = op.get("H_m", 0)
        ax.scatter([qo], [ho], color=_COLORS["red"], s=60, zorder=6,
                   label=f"Duty point (n={n} pump{'s' if n > 1 else ''})")

    q_unit = "gpm" if us == "US" else "m³/h"
    h_unit = "ft"  if us == "US" else "m"
    ax.set_xlabel(f"Flow Q ({q_unit})", fontsize=9)
    ax.set_ylabel(f"Head H ({h_unit})", fontsize=9)
    ax.set_title("Pump H-Q and System Curve", fontsize=10, fontweight="bold")
    ax.legend(fontsize=8, loc="best")
    ax.grid(True, alpha=0.3)
    ax.set_xlim(left=0)
    ax.set_ylim(bottom=0)
    ax.tick_params(labelsize=8)

    return _to_png(fig)


def fig_efficiency_power(draft: dict) -> bytes | None:
    """
    Two-panel figure: pump efficiency η (%) vs Q and shaft power P (kW) vs Q.

    Returns None when eta_curve is absent.
    """
    pump = draft.get("pumpResult") or {}
    eta_pts = pump.get("eta_curve", []) or []
    p_pts   = pump.get("p_curve",   []) or []

    if not eta_pts:
        return None

    plt = _mpl()
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8.0, 3.5))

    # Efficiency
    qs  = [p.get("Q_m3h", 0) for p in eta_pts]
    etas= [p.get("value", 0) for p in eta_pts]
    ax1.plot(qs, etas, color=_COLORS["green"], linewidth=2.2)
    ax1.fill_between(qs, etas, alpha=0.12, color=_COLORS["green"])
    ax1.set_xlabel("Flow Q (m³/h)", fontsize=9)
    ax1.set_ylabel("Efficiency η (%)", fontsize=9)
    ax1.set_title("Pump Efficiency", fontsize=10, fontweight="bold")
    ax1.grid(True, alpha=0.3)
    ax1.set_xlim(left=0)
    ax1.set_ylim(bottom=0)
    ax1.tick_params(labelsize=8)

    # Power
    if p_pts:
        qsp = [p.get("Q_m3h", 0) for p in p_pts]
        ps  = [p.get("value", 0) for p in p_pts]
        ax2.plot(qsp, ps, color=_COLORS["orange"], linewidth=2.2)
        ax2.fill_between(qsp, ps, alpha=0.12, color=_COLORS["orange"])
    ax2.set_xlabel("Flow Q (m³/h)", fontsize=9)
    ax2.set_ylabel("Shaft Power P (kW)", fontsize=9)
    ax2.set_title("Pump Shaft Power", fontsize=10, fontweight="bold")
    ax2.grid(True, alpha=0.3)
    ax2.set_xlim(left=0)
    ax2.set_ylim(bottom=0)
    ax2.tick_params(labelsize=8)

    fig.tight_layout()
    return _to_png(fig)


def fig_npsh(draft: dict) -> bytes | None:
    """
    NPSHr (required) and NPSHa (available at operating point) vs flow.

    Draws:
    - NPSHr curve (solid purple)
    - NPSHa as horizontal dashed line per operating point
    - Shaded margin area between curves

    Returns None when npshr_curve is absent.
    """
    pump     = draft.get("pumpResult") or {}
    npshr_pts= pump.get("npshr_curve", []) or []
    ops      = pump.get("operating_points", []) or []

    if not npshr_pts:
        return None

    plt = _mpl()
    fig, ax = plt.subplots(figsize=(5.5, 3.5))

    qs = [p.get("Q_m3h", 0) for p in npshr_pts]
    rs = [p.get("value", 0) for p in npshr_pts]
    ax.plot(qs, rs, color=_COLORS["purple"], linewidth=2.2, label="NPSHr")
    ax.fill_between(qs, rs, alpha=0.12, color=_COLORS["purple"])

    for op in ops:
        npsha = op.get("npsha_m")
        qo    = op.get("Q_m3h", 0)
        if npsha is not None:
            ax.axhline(npsha, color=_COLORS["teal"], linewidth=1.6,
                       linestyle="--",
                       label=f"NPSHa = {npsha:.2f} m (n={op.get('n_pumps',1)})")
            ax.scatter([qo], [npsha], color=_COLORS["teal"], s=50, zorder=5)

    ax.set_xlabel("Flow Q (m³/h)", fontsize=9)
    ax.set_ylabel("NPSH (m)", fontsize=9)
    ax.set_title("NPSHr vs NPSHa", fontsize=10, fontweight="bold")
    ax.legend(fontsize=8, loc="best")
    ax.grid(True, alpha=0.3)
    ax.set_xlim(left=0)
    ax.set_ylim(bottom=0)
    ax.tick_params(labelsize=8)
    fig.tight_layout()

    return _to_png(fig)


def _fig_surge_envelope_for(draft: dict, pipeline: str) -> bytes | None:
    """
    Internal: MOC pressure envelope for a named pipeline ("suction" or "discharge").

    Filters envelope data by the ``pipeline`` field in mocResult.
    Returns None when envelope data for the requested pipeline is absent.
    """
    moc = draft.get("mocResult") or {}
    env = moc.get("envelope", []) or []

    # Accept if pipeline matches OR if it's the only envelope present
    moc_pipeline = moc.get("pipeline", "")
    if moc_pipeline and moc_pipeline.lower() != pipeline.lower() and env:
        return None
    if not env:
        return None

    plt = _mpl()
    fig, ax = plt.subplots(figsize=(6.5, 3.8))

    xs    = [p.get("x_m", 0)     for p in env]
    h_max = [p.get("H_max_m", 0) for p in env]
    h_min = [p.get("H_min_m", 0) for p in env]
    elev  = [p.get("elev_m", 0)  for p in env]

    ax.plot(xs, h_max, color=_COLORS["red"],  linewidth=2.2, label="H max (transient)")
    ax.plot(xs, h_min, color=_COLORS["blue"], linewidth=2.2, label="H min (transient)")
    ax.plot(xs, elev,  color="black", linewidth=1.0, linestyle="--", label="Pipe elevation")
    ax.fill_between(xs, h_min, h_max, alpha=0.10, color=_COLORS["grey"])

    ax.set_xlabel("Distance from pump (m)", fontsize=9)
    ax.set_ylabel("Head (m)", fontsize=9)
    ax.set_title(
        f"MOC Surge Pressure Envelope — {pipeline.capitalize()} Pipeline",
        fontsize=10, fontweight="bold",
    )
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3)
    ax.tick_params(labelsize=8)
    fig.tight_layout()

    return _to_png(fig)


def fig_surge_envelope_suction(draft: dict) -> bytes | None:
    """
    MOC pressure envelope (H_max, H_min, elevation) for the suction pipeline.

    Returns None when MOC suction envelope data is absent.
    """
    return _fig_surge_envelope_for(draft, "suction")


def fig_surge_envelope_discharge(draft: dict) -> bytes | None:
    """
    MOC pressure envelope (H_max, H_min, elevation) for the discharge pipeline.

    Returns None when MOC discharge envelope data is absent.
    """
    return _fig_surge_envelope_for(draft, "discharge")


def fig_moc_histories(draft: dict) -> bytes | None:
    """
    Head time histories at key MOC observation nodes (up to 5 nodes).

    Returns None when no observations are present.
    """
    moc = draft.get("mocResult") or {}
    obs = moc.get("observations", []) or []

    if not obs:
        return None

    plt = _mpl()
    fig, ax = plt.subplots(figsize=(6.5, 3.8))

    palette = [
        _COLORS["navy"], _COLORS["red"], _COLORS["green"],
        _COLORS["orange"], _COLORS["purple"],
    ]
    for idx, ob in enumerate(obs[:5]):
        hist  = ob.get("history", []) or []
        label = ob.get("label", f"Node {idx}")
        if hist:
            ts = [h.get("t_s", 0) for h in hist]
            hs = [h.get("H_m", 0) for h in hist]
            ax.plot(ts, hs, color=palette[idx % len(palette)],
                    linewidth=1.8, label=label)

    ax.set_xlabel("Time (s)", fontsize=9)
    ax.set_ylabel("Head H (m)", fontsize=9)
    ax.set_title("MOC Head Time Histories at Key Nodes", fontsize=10, fontweight="bold")
    ax.legend(fontsize=8, loc="best")
    ax.grid(True, alpha=0.3)
    ax.tick_params(labelsize=8)
    fig.tight_layout()

    return _to_png(fig)


def fig_protection_comparison(draft: dict) -> bytes | None:
    """
    Bar chart comparing global H_max and H_min across baseline + device runs.

    Returns None when whatIfResult is absent.
    """
    wi       = draft.get("whatIfResult") or {}
    baseline = wi.get("baseline")    or {}
    runs     = wi.get("device_runs", []) or []

    all_runs = [baseline] + runs
    labels   = [r.get("label", f"Run {i}") for i, r in enumerate(all_runs)]
    h_max    = [r.get("global_max_H_m", 0) or 0 for r in all_runs]
    h_min    = [r.get("global_min_H_m", 0) or 0 for r in all_runs]

    if not labels or not any(h_max):
        return None

    plt = _mpl()
    n   = len(labels)
    x   = list(range(n))
    fig, ax = plt.subplots(figsize=(max(5.0, n * 1.4 + 1.0), 3.8))

    w = 0.36
    ax.bar([i - w / 2 for i in x], h_max, width=w,
           color=_COLORS["red"],  alpha=0.82, label="H max (transient)")
    ax.bar([i + w / 2 for i in x], h_min, width=w,
           color=_COLORS["blue"], alpha=0.82, label="H min (transient)")

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=18, ha="right", fontsize=8)
    ax.set_ylabel("Head (m)", fontsize=9)
    ax.set_title("Surge Protection — Peak Pressure Comparison",
                 fontsize=10, fontweight="bold")
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3, axis="y")
    ax.tick_params(axis="y", labelsize=8)
    fig.tight_layout()

    return _to_png(fig)
