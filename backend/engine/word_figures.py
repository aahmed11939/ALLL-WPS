"""
Matplotlib figure generators for the ALLL WPS Designer Word report.

Each public function accepts the raw ``draft`` dict (serialised ProjectDraft)
and returns a PNG byte string ready for embedding, or ``None`` when the
required data is absent.

Design note — full-draft coupling
----------------------------------
All public functions accept the complete ``draft`` dict rather than the
individual result sub-dict for each calculation.  This is intentional:

* Several figures need data from multiple sub-results simultaneously
  (e.g. ``fig_system_curve`` needs both ``hydraulicsResult.system_curve``
  and ``pumpResult.hq_curve``; ``fig_npsh`` combines ``npshr_curve`` with
  ``operating_points``).
* Passing the full draft avoids N distinct function signatures and lets the
  caller (``word_export.build_document``) forward a single object.
* The caller is always ``build_document``, which already holds the full
  draft — there is no abstraction cost.

If the figure helpers are ever reused outside the Word exporter, the
relevant sub-dicts can be extracted at the call site and wrapped in a
minimal dict (e.g. ``{"pumpResult": pump_result, ...}``).

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

    Data source resolution (mirrors the Excel exporter convention):
      - suction  → ``draft["suctionSurgeResult"]`` first; falls back to
                   ``draft["mocResult"]`` when that result has pipeline="suction".
      - discharge → ``draft["mocResult"]``; skipped when pipeline tag says "suction".

    Returns None when envelope data for the requested pipeline is absent.
    """
    if pipeline.lower() == "suction":
        # Prefer the dedicated suction result
        moc = draft.get("suctionSurgeResult") or {}
        if not moc:
            # Fall back: use mocResult only if it is tagged suction
            fallback = draft.get("mocResult") or {}
            tag = fallback.get("pipeline", "")
            moc = fallback if (not tag or tag.lower() == "suction") else {}
    else:
        # Discharge: use mocResult; skip if explicitly tagged "suction"
        moc = draft.get("mocResult") or {}
        tag = moc.get("pipeline", "")
        if tag and tag.lower() == "suction":
            moc = {}

    env = moc.get("envelope", []) or []
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


def fig_station_schematic(draft: dict) -> bytes | None:
    """
    Server-side elevation-view schematic of the pump station.

    Renders (mirroring PumpStationSchematic.tsx):
    - Clearwell cross-section with LLL / LWL / HWL / HHL water-level bands
    - Suction pipeline segment(s) — horizontal at upstream elevation
    - Centrifugal pump symbol(s) — duty (solid teal) + standby (grey)
    - Discharge pipeline segment(s) — sloped from pump to downstream node
    - Downstream reservoir node
    - Elevation datum rail with ticks
    - Pipe size / material callout labels

    Returns None when there is no meaningful station data to draw.
    """
    suction   = draft.get("suction",        {}) or {}
    discharge = draft.get("discharge",      {}) or {}
    up_node   = draft.get("upstreamNode",   {}) or {}
    dn_node   = draft.get("downstreamNode", {}) or {}
    cw_cfg    = draft.get("clearwellConfig")
    ps_cfg    = draft.get("pumpSelectionConfig") or {}

    s_segs = suction.get("segments",  []) or []
    d_segs = discharge.get("segments", []) or []

    has_cw   = (cw_cfg and
                cw_cfg.get("LLL_m", 0) < cw_cfg.get("LWL_m", 1) and
                cw_cfg.get("LWL_m", 0) < cw_cfg.get("HWL_m", 2) and
                cw_cfg.get("HWL_m", 0) < cw_cfg.get("HHL_m", 3))
    has_data = bool(s_segs or d_segs or has_cw or ps_cfg)

    if not has_data:
        return None

    up_elev = up_node.get("elevation_m", 0.0)
    dn_elev = dn_node.get("elevation_m", 0.0)
    cw_top_elev = (up_elev + cw_cfg["HHL_m"]) if has_cw else up_elev

    max_elev = max(up_elev, dn_elev, cw_top_elev)
    min_elev = min(up_elev, dn_elev)
    elev_span = max(max_elev - min_elev, 5.0)

    # ---------------------------------------------------------------------------
    # Matplotlib figure
    # ---------------------------------------------------------------------------
    plt = _mpl()
    fig, ax = plt.subplots(figsize=(8.5, 4.8))
    ax.set_aspect("auto")
    ax.set_facecolor("#F8FAFC")
    fig.patch.set_facecolor("white")

    # Horizontal layout: x positions (arbitrary units that look good at 8.5 in)
    CW_X1    = 0.5
    CW_X2    = 1.8
    SUCT_X1  = CW_X2
    SUCT_X2  = 4.2
    PUMP_CX  = 5.0
    PUMP_R   = 0.28
    DISC_X1  = PUMP_CX + PUMP_R
    DISC_X2  = 8.0
    DS_CX    = 8.3
    DS_R     = 0.18
    X_MAX    = 9.0

    # Map elevation → y (SVG-style: higher elev → higher y, but matplotlib y increases up)
    def to_y(elev: float) -> float:
        return (elev - min_elev) / elev_span * 3.8 + 0.4  # 0.4..4.2 range

    up_y = to_y(up_elev)
    dn_y = to_y(dn_elev)
    cw_top_y = max(to_y(cw_top_elev), up_y + 0.45)

    # ---- Datum rail ----
    ax.axhline(to_y(min_elev), color="#94a3b8", linewidth=0.8, linestyle="--", alpha=0.6)
    ax.text(0.1, to_y(min_elev) - 0.12, "Datum", fontsize=6, color="#94a3b8",
            va="top", style="italic")

    # ---- Clearwell ----
    if has_cw:
        lll = cw_cfg["LLL_m"]
        lwl = cw_cfg["LWL_m"]
        hwl = cw_cfg["HWL_m"]
        hhl = cw_cfg["HHL_m"]

        y_lll = to_y(up_elev + lll)
        y_lwl = to_y(up_elev + lwl)
        y_hwl = to_y(up_elev + hwl)
        y_hhl = to_y(up_elev + hhl)

        from matplotlib.patches import Rectangle as MplRect
        # Bands (bottom to top: dead zone amber, operating teal, alarm red)
        ax.add_patch(MplRect((CW_X1, up_y), CW_X2 - CW_X1, y_lll - up_y,
                              facecolor="#fef3c7", edgecolor="none", zorder=2))
        ax.add_patch(MplRect((CW_X1, y_lll), CW_X2 - CW_X1, y_lwl - y_lll,
                              facecolor="#fef3c7", edgecolor="none", zorder=2))
        ax.add_patch(MplRect((CW_X1, y_lwl), CW_X2 - CW_X1, y_hwl - y_lwl,
                              facecolor="#ccfbf1", edgecolor="none", zorder=2))
        ax.add_patch(MplRect((CW_X1, y_hwl), CW_X2 - CW_X1, y_hhl - y_hwl,
                              facecolor="#fee2e2", edgecolor="none", zorder=2))

        # Tank walls
        ax.add_patch(MplRect((CW_X1, up_y), 0.06, cw_top_y - up_y,
                              facecolor="#cbd5e1", edgecolor="#94a3b8", linewidth=0.8, zorder=3))
        ax.add_patch(MplRect((CW_X2 - 0.06, up_y), 0.06, cw_top_y - up_y,
                              facecolor="#cbd5e1", edgecolor="#94a3b8", linewidth=0.8, zorder=3))
        # Floor
        ax.add_patch(MplRect((CW_X1, up_y - 0.04), CW_X2 - CW_X1, 0.04,
                              facecolor="#cbd5e1", edgecolor="#94a3b8", linewidth=0.8, zorder=3))

        # Level markers
        level_defs = [
            ("HHL", y_hhl, "#ef4444"),
            ("HWL", y_hwl, "#0f766e"),
            ("LWL", y_lwl, "#0f766e"),
            ("LLL", y_lll, "#f59e0b"),
        ]
        for lbl, ly, col in level_defs:
            ax.axhline(ly, xmin=(CW_X1 / X_MAX), xmax=(CW_X2 / X_MAX),
                       color=col, linewidth=1.0, linestyle=":", alpha=0.85, zorder=4)
            ax.text(CW_X1 - 0.06, ly, lbl, fontsize=5.5, color=col, ha="right",
                    va="center", fontweight="bold", zorder=5)

        # Clearwell label
        ax.text((CW_X1 + CW_X2) / 2, cw_top_y + 0.08, "Clearwell",
                ha="center", va="bottom", fontsize=7.5, fontweight="bold",
                color="#334155", zorder=5)
    else:
        # Simple upstream node box
        from matplotlib.patches import Rectangle as MplRect
        ax.add_patch(MplRect((CW_X1, up_y - 0.2), CW_X2 - CW_X1, 0.4,
                              facecolor="#e2e8f0", edgecolor="#94a3b8", linewidth=0.8, zorder=3))
        ax.text((CW_X1 + CW_X2) / 2, up_y + 0.25, "Upstream\nNode",
                ha="center", va="bottom", fontsize=6.5, color="#334155", zorder=5)

    # ---- Suction pipe ----
    PIPE_H = 0.10
    if s_segs:
        from matplotlib.patches import Rectangle as _R
        ax.add_patch(_R((SUCT_X1, up_y - PIPE_H / 2), SUCT_X2 - SUCT_X1, PIPE_H,
                         facecolor="#e2e8f0", edgecolor="#94a3b8", linewidth=0.8, zorder=3))
        ax.plot([SUCT_X1, SUCT_X2], [up_y, up_y],
                color="#94a3b8", linewidth=0.6, linestyle="--", zorder=4)
        # Segment labels
        total_s = sum(s.get("length_m", 0) for s in s_segs)
        x_cur = SUCT_X1
        for i, seg in enumerate(s_segs):
            seg_w = (seg.get("length_m", 0) / max(total_s, 1)) * (SUCT_X2 - SUCT_X1)
            mid_x = x_cur + seg_w / 2
            dn_mm = seg.get("diameter_mm", 0)
            mat   = seg.get("material", "").upper().replace("_", " ")
            lbl   = f"DN{int(dn_mm)}" if dn_mm else "—"
            ax.text(mid_x, up_y + PIPE_H / 2 + 0.08, lbl,
                    ha="center", va="bottom", fontsize=6.5, fontweight="600",
                    color="#475569", zorder=5,
                    fontfamily="monospace")
            ax.text(mid_x, up_y - PIPE_H / 2 - 0.04, f"{mat} · {seg.get('length_m', 0):.0f} m",
                    ha="center", va="top", fontsize=5.5, color="#94a3b8", zorder=5,
                    fontfamily="monospace")
            x_cur += seg_w
    else:
        # Dashed connector
        ax.plot([SUCT_X1, SUCT_X2], [up_y, up_y],
                color="#cbd5e1", linewidth=1.2, linestyle="--", zorder=3)

    # ---- Pump symbol(s) ----
    n_duty    = ps_cfg.get("nDuty", 1) if ps_cfg else 1
    n_standby = ps_cfg.get("nStandby", 0) if ps_cfg else 0
    total_pumps = max(n_duty + n_standby, 1)
    spacing  = min(0.30, 0.60 / total_pumps)
    p_offset = -((total_pumps - 1) * spacing) / 2

    pump_label_key = ps_cfg.get("selectedTypeKey", "") if ps_cfg else ""
    pump_label = (pump_label_key.replace("_", " ").title()
                  if pump_label_key else "Pump")

    for i in range(total_pumps):
        pcx = PUMP_CX + p_offset + i * spacing
        pcy = up_y
        is_stby = i >= n_duty
        fc = "#ccfbf1" if not is_stby else "#f1f5f9"
        ec = "#0f766e" if not is_stby else "#94a3b8"
        alpha = 1.0 if not is_stby else 0.55

        circ = plt.Circle((pcx, pcy), PUMP_R, facecolor=fc, edgecolor=ec,
                           linewidth=1.8, zorder=6, alpha=alpha)
        ax.add_patch(circ)
        tri_s = PUMP_R * 0.55
        tri_pts = plt.Polygon(
            [[pcx + tri_s, pcy],
             [pcx - tri_s * 0.5, pcy + tri_s * 0.9],
             [pcx - tri_s * 0.5, pcy - tri_s * 0.9]],
            closed=True, facecolor=ec, alpha=0.7 * alpha, zorder=7,
        )
        ax.add_patch(tri_pts)
        p_lbl = "Stby" if is_stby else (f"D{i+1}" if total_pumps > 1 else pump_label[:8])
        ax.text(pcx, pcy - PUMP_R - 0.12, p_lbl,
                ha="center", va="top", fontsize=6.0, fontweight="600",
                color=ec, alpha=alpha, zorder=8)

    # ---- Discharge pipe ----
    if d_segs:
        from matplotlib.patches import Polygon as MplPoly
        ph2 = PIPE_H / 2
        # Pipe body as a filled quad (sloped from up_y to dn_y)
        pts = [
            [DISC_X1, up_y - ph2],
            [DISC_X2, dn_y - ph2],
            [DISC_X2, dn_y + ph2],
            [DISC_X1, up_y + ph2],
        ]
        ax.add_patch(MplPoly(pts, closed=True,
                              facecolor="#e2e8f0", edgecolor="#94a3b8", linewidth=0.8, zorder=3))
        # Centreline dashed
        ax.plot([DISC_X1, DISC_X2], [up_y, dn_y],
                color="#94a3b8", linewidth=0.6, linestyle="--", zorder=4)

        total_d = sum(s.get("length_m", 0) for s in d_segs)
        x_cur = DISC_X1
        dx_span = DISC_X2 - DISC_X1
        for i, seg in enumerate(d_segs):
            seg_w = (seg.get("length_m", 0) / max(total_d, 1)) * dx_span
            mid_x = x_cur + seg_w / 2
            frac  = (mid_x - DISC_X1) / max(dx_span, 1)
            mid_y = up_y + frac * (dn_y - up_y)
            dn_mm = seg.get("diameter_mm", 0)
            mat   = seg.get("material", "").upper().replace("_", " ")
            lbl   = f"DN{int(dn_mm)}" if dn_mm else "—"
            # Label above pipe
            perp_up = ph2 + 0.09
            ax.text(mid_x, mid_y + perp_up, lbl,
                    ha="center", va="bottom", fontsize=6.5, fontweight="600",
                    color="#475569", zorder=5, fontfamily="monospace")
            ax.text(mid_x, mid_y - perp_up - 0.01,
                    f"{mat} · {seg.get('length_m', 0):.0f} m",
                    ha="center", va="top", fontsize=5.5, color="#94a3b8",
                    zorder=5, fontfamily="monospace")
            x_cur += seg_w
    else:
        ax.plot([DISC_X1, DISC_X2], [up_y, dn_y],
                color="#cbd5e1", linewidth=1.2, linestyle="--", zorder=3)

    # ---- Downstream reservoir node ----
    ds_circ = plt.Circle((DS_CX, dn_y), DS_R, facecolor="#e0f2fe",
                           edgecolor="#0284c7", linewidth=1.4, zorder=6)
    ax.add_patch(ds_circ)
    ax.text(DS_CX, dn_y + DS_R + 0.08, "DS Node",
            ha="center", va="bottom", fontsize=6.0, color="#0369a1", fontweight="600", zorder=7)

    # ---- Elevation ticks on left Y axis ----
    for ev, lbl in [(up_elev, f"US\n{up_elev:.1f} m"), (dn_elev, f"DS\n{dn_elev:.1f} m")]:
        ty = to_y(ev)
        ax.plot([CW_X1 - 0.25, CW_X1 - 0.08], [ty, ty],
                color="#64748b", linewidth=0.8, zorder=3)
        ax.text(CW_X1 - 0.28, ty, f"{ev:.1f} m",
                ha="right", va="center", fontsize=5.5, color="#64748b",
                fontfamily="monospace")

    # ---- Flow arrow ----
    ax.annotate("", xy=(SUCT_X2 - 0.1, up_y + 0.22),
                xytext=(SUCT_X1 + 0.15, up_y + 0.22),
                arrowprops=dict(arrowstyle="-|>", color="#0f766e", lw=1.2),
                zorder=8)
    ax.text((SUCT_X1 + SUCT_X2) / 2, up_y + 0.28, "flow →",
            ha="center", va="bottom", fontsize=6.0, color="#0f766e", style="italic", zorder=8)

    # ---- Title & axis tidy ----
    ax.set_xlim(0.0, X_MAX)
    ax.set_ylim(to_y(min_elev) - 0.35, max(cw_top_y, to_y(max_elev)) + 0.55)
    ax.set_xlabel("→ Station Layout (elevation view — not to scale in x)", fontsize=8)
    ax.set_ylabel("Elevation (m)", fontsize=8)
    ax.set_title("Pump Station Schematic — Elevation View", fontsize=10, fontweight="bold",
                 color="#1F3864")
    ax.tick_params(axis="x", which="both", bottom=False, labelbottom=False)
    ax.tick_params(axis="y", labelsize=7)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["bottom"].set_visible(False)

    # Custom Y ticks to show actual elevations
    tick_levels = sorted({up_elev, dn_elev})
    if has_cw:
        tick_levels += [up_elev + cw_cfg["LLL_m"], up_elev + cw_cfg["LWL_m"],
                        up_elev + cw_cfg["HWL_m"], up_elev + cw_cfg["HHL_m"]]
    tick_levels = sorted(set(tick_levels))
    ax.set_yticks([to_y(e) for e in tick_levels])
    ax.set_yticklabels([f"{e:.2f}" for e in tick_levels], fontsize=6.5)

    # Legend for clearwell bands
    if has_cw:
        from matplotlib.patches import Patch
        legend_patches = [
            Patch(facecolor="#fee2e2", label="Above HWL (alarm)"),
            Patch(facecolor="#ccfbf1", label="Operating zone (LWL–HWL)"),
            Patch(facecolor="#fef3c7", label="Below LWL (low / dead)"),
        ]
        ax.legend(handles=legend_patches, loc="upper right",
                  fontsize=6, framealpha=0.85, edgecolor="#e2e8f0")

    fig.tight_layout(pad=0.6)
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
