"""
Excel workbook builder for ALLL WPS Designer.

Builds a professional .xlsx workbook from a serialised ProjectDraft dict.
All data originates from the cached compute results stored in the draft.

Sheets produced
---------------
1.  Inputs Summary
2.  Hydraulics Breakdown
3.  System Curve              [chart: system curve Q-H]
4.  Pump Curves               [chart: HQ curve + system curve overlay]
5.  Operating Points          [chart: pump efficiency vs Q]
6.  Wet Well                  [chart: volume-depth curve]
7.  Engineering Checks
8.  Surge Quick (Mode A)
9.  Surge MOC Time Histories  [chart: head vs time at observation points]
10. Surge Envelope vs Distance[chart: H_max / H_min vs distance]
11. Protection Comparisons

Chart count: 6 (one per sheet 3, 4, 5, 6, 9, 10).
"""

from __future__ import annotations

import io
from datetime import datetime
from typing import Any

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.chart.series import SeriesLabel
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------------------
# Colour palette
# ---------------------------------------------------------------------------

BLUE_DARK   = "1F3864"   # deep navy — sheet title background
BLUE_MID    = "2E5B8C"   # section header background
BLUE_LIGHT  = "D0E4F5"   # sub-header / alt-row light blue
TEAL_HEADER = "1A5276"   # alternate header for results sheets
WHITE       = "FFFFFF"
GREY_ALT    = "F2F5F8"   # alternate data row

# ---------------------------------------------------------------------------
# Style helpers
# ---------------------------------------------------------------------------

def _hdr_fill(hex_colour: str) -> PatternFill:
    return PatternFill("solid", fgColor=hex_colour)


def _thin_border() -> Border:
    thin = Side(style="thin", color="CCCCCC")
    return Border(left=thin, right=thin, top=thin, bottom=thin)


def _bold(size: int = 10, color: str = WHITE) -> Font:
    return Font(bold=True, size=size, color=color)


def _normal(size: int = 10, color: str = "000000") -> Font:
    return Font(size=size, color=color)


def _header_cell(ws, row: int, col: int, value: str,
                 bg: str = BLUE_MID, fg: str = WHITE,
                 font_size: int = 10) -> None:
    cell = ws.cell(row=row, column=col, value=value)
    cell.fill   = _hdr_fill(bg)
    cell.font   = _bold(font_size, fg)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = _thin_border()


def _data_cell(ws, row: int, col: int, value: Any,
               num_format: str | None = None,
               bold: bool = False,
               align: str = "left",
               alt: bool = False) -> None:
    cell = ws.cell(row=row, column=col, value=value)
    cell.font   = Font(bold=bold, size=10)
    cell.alignment = Alignment(horizontal=align, vertical="center")
    cell.border = _thin_border()
    if alt:
        cell.fill = _hdr_fill(GREY_ALT)
    if num_format:
        cell.number_format = num_format


def _sheet_title(ws, title: str, subtitle: str = "",
                 meta: dict | None = None) -> int:
    """Write a large title banner + optional subtitle + project meta.
    Returns the next available row number."""
    ws.merge_cells("A1:J1")
    cell = ws["A1"]
    cell.value = title
    cell.fill  = _hdr_fill(BLUE_DARK)
    cell.font  = Font(bold=True, size=14, color=WHITE)
    cell.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 28

    row = 2
    if subtitle:
        ws.merge_cells(f"A{row}:J{row}")
        sub = ws[f"A{row}"]
        sub.value = subtitle
        sub.fill  = _hdr_fill(BLUE_MID)
        sub.font  = Font(italic=True, size=10, color=WHITE)
        sub.alignment = Alignment(horizontal="left", vertical="center")
        ws.row_dimensions[row].height = 16
        row += 1

    if meta:
        row += 1
        fields = [
            ("Project",  meta.get("name", "")),
            ("Client",   meta.get("client", "")),
            ("Job No.",  meta.get("job_number", "")),
            ("Date",     meta.get("date", "")),
            ("Engineer", meta.get("engineer", "")),
            ("Generated", datetime.now().strftime("%Y-%m-%d %H:%M")),
        ]
        for i, (lbl, val) in enumerate(fields):
            col_l = 1 + i * 2
            col_v = col_l + 1
            ws.cell(row=row, column=col_l, value=lbl).font = Font(bold=True, size=9, color="555555")
            ws.cell(row=row, column=col_v, value=val).font  = Font(size=9)
        row += 2

    return row


def _set_col_widths(ws, widths: list[float]) -> None:
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w


def _no_data_note(ws, row: int, msg: str = "No data available for this section.") -> None:
    ws.merge_cells(f"A{row}:J{row}")
    cell = ws[f"A{row}"]
    cell.value = msg
    cell.font  = Font(italic=True, color="888888", size=10)
    cell.alignment = Alignment(horizontal="center")


# ---------------------------------------------------------------------------
# Sheet builders
# ---------------------------------------------------------------------------

def _sheet_inputs(wb: Workbook, draft: dict) -> None:
    ws = wb.create_sheet("Inputs Summary")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "WPS Designer — Inputs Summary",
                        "All user-defined design inputs", meta=meta)

    us = draft.get("unitSystem", "SI")
    Q  = draft.get("designFlow_m3h", 0.0)
    up = draft.get("upstreamNode",   {})
    dn = draft.get("downstreamNode", {})

    # ── Design basis ─────────────────────────────────────────────────────────
    _header_cell(ws, row, 1, "Parameter", BLUE_MID); _header_cell(ws, row, 2, "Value", BLUE_MID)
    _header_cell(ws, row, 3, "Unit",      BLUE_MID); _header_cell(ws, row, 4, "Notes", BLUE_MID)
    ws.merge_cells(f"D{row}:G{row}")
    row += 1

    basis = [
        ("Unit system",            us,                        "—",   ""),
        ("Design flow (Q)",        Q,                         "m³/h",""),
        ("Design flow (Q)",        round(Q / 3.6, 4),         "L/s", "Q / 3.6"),
        ("Upstream elevation",     up.get("elevation_m", 0),  "m",   "Wet-well reference"),
        ("Upstream pressure",      up.get("pressure_kPa", 0), "kPa", "Gauge"),
        ("Downstream elevation",   dn.get("elevation_m", 0),  "m",   "Delivery point"),
        ("Downstream pressure",    dn.get("pressure_kPa", 0), "kPa", "Gauge"),
        ("Static head",            round(dn.get("elevation_m", 0) - up.get("elevation_m", 0), 3),
         "m", "Δ elevation"),
    ]
    for i, (param, val, unit, note) in enumerate(basis):
        alt = (i % 2 == 1)
        _data_cell(ws, row, 1, param, bold=True, alt=alt)
        _data_cell(ws, row, 2, val,   num_format="#,##0.000", align="right", alt=alt)
        _data_cell(ws, row, 3, unit,  align="center", alt=alt)
        ws.merge_cells(f"D{row}:G{row}")
        _data_cell(ws, row, 4, note,  alt=alt)
        row += 1

    # ── Pipeline segments ─────────────────────────────────────────────────────
    row += 1
    for pipeline_key, title_txt in [("suction", "Suction Pipeline"), ("discharge", "Discharge Pipeline")]:
        pipe = draft.get(pipeline_key, {})
        segs = pipe.get("segments", [])

        ws.merge_cells(f"A{row}:G{row}")
        c = ws[f"A{row}"]
        c.value = title_txt
        c.fill  = _hdr_fill(BLUE_MID)
        c.font  = Font(bold=True, size=11, color=WHITE)
        c.alignment = Alignment(horizontal="left", vertical="center")
        ws.row_dimensions[row].height = 18
        row += 1

        hdrs = ["Seg #", "Material", "Diameter (mm)", "Length (m)", "Cumulative (m)"]
        for ci, h in enumerate(hdrs, 1):
            _header_cell(ws, row, ci, h, BLUE_LIGHT, BLUE_DARK)
        row += 1

        cumul = 0.0
        for j, seg in enumerate(segs):
            cumul += seg.get("length_m", 0)
            alt = (j % 2 == 1)
            _data_cell(ws, row, 1, j + 1,                   align="center", alt=alt)
            _data_cell(ws, row, 2, seg.get("material", ""), alt=alt)
            _data_cell(ws, row, 3, seg.get("diameter_mm", 0), num_format="0.0", align="right", alt=alt)
            _data_cell(ws, row, 4, seg.get("length_m",   0), num_format="#,##0.00", align="right", alt=alt)
            _data_cell(ws, row, 5, round(cumul, 2),            num_format="#,##0.00", align="right", alt=alt)
            row += 1

        # Minor losses summary
        k_sum  = pipe.get("accessories_K_sum", 0)
        acc_ct = sum(a.get("count", 1) for a in pipe.get("accessories", []))
        _data_cell(ws, row, 1, "Total",    bold=True, alt=True)
        _data_cell(ws, row, 2, f"{acc_ct} accessories", alt=True)
        ws.merge_cells(f"C{row}:D{row}")
        _data_cell(ws, row, 3, f"ΣK = {k_sum:.4f}", alt=True)
        row += 2

    _set_col_widths(ws, [18, 16, 14, 14, 14, 16, 16])


def _sheet_hydraulics(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Hydraulics Breakdown")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Hydraulic Calculation — Design Flow Results",
                        "Darcy-Weisbach friction + minor losses", meta=meta)

    r = draft.get("hydraulicsResult")
    if not r:
        _no_data_note(ws, row, "Hydraulics not yet computed. Run Step 7 in WPS Designer.")
        return

    params = [
        ("Design flow Q",            r.get("design_Q_m3h",     0),  "m³/h",  ""),
        ("Design flow Q",            round(r.get("design_Q_m3h", 0) / 3.6, 4), "L/s", "Q/3.6"),
        ("Pipe velocity",            r.get("velocity_ms",       0),  "m/s",   ""),
        ("Reynolds number",          r.get("reynolds_number",   0),  "—",     ""),
        ("Darcy friction factor f",  r.get("friction_factor",   0),  "—",     "Colebrook-White"),
        ("K-sum (minor losses)",     r.get("K_sum",             0),  "—",     ""),
        ("Static head",              r.get("static_head_m",     0),  "m",     "Δ elevation"),
        ("Friction head loss (hf)",  r.get("friction_head_m",   0),  "m",     "Darcy-Weisbach"),
        ("Minor head loss (hm)",     r.get("minor_head_m",      0),  "m",     "Σ K·V²/2g"),
        ("Total Dynamic Head (TDH)", r.get("tdh_m",             0),  "m",     "hstatic + hf + hm"),
    ]

    _header_cell(ws, row, 1, "Parameter", BLUE_MID)
    _header_cell(ws, row, 2, "Value",     BLUE_MID)
    _header_cell(ws, row, 3, "Unit",      BLUE_MID)
    ws.merge_cells(f"D{row}:G{row}")
    _header_cell(ws, row, 4, "Notes",     BLUE_MID)
    row += 1

    for i, (param, val, unit, note) in enumerate(params):
        alt = (i % 2 == 1)
        _data_cell(ws, row, 1, param, bold=True, alt=alt)
        _data_cell(ws, row, 2, val,   num_format="#,##0.0000", align="right", alt=alt)
        _data_cell(ws, row, 3, unit,  align="center", alt=alt)
        ws.merge_cells(f"D{row}:G{row}")
        _data_cell(ws, row, 4, note, alt=alt)
        row += 1

    row += 1
    note_txt = ("TDH = Static Head + Friction Head + Minor Head  "
                "| All values at design flow Q  "
                "| Method: Darcy-Weisbach (AS 2200 / AWWA M11)")
    ws.merge_cells(f"A{row}:G{row}")
    c = ws[f"A{row}"]
    c.value = note_txt
    c.font  = Font(italic=True, size=9, color="555555")
    c.alignment = Alignment(wrap_text=True)

    _set_col_widths(ws, [30, 18, 10, 40])


def _sheet_system_curve(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("System Curve")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "System Curve — H vs Q", "Tabulated system resistance curve", meta=meta)

    r    = draft.get("hydraulicsResult")
    pts  = r.get("system_curve", []) if r else []

    if not pts:
        _no_data_note(ws, row, "System curve not available. Run hydraulics first.")
        return

    data_start = row
    _header_cell(ws, row, 1, "Q (m³/h)",  BLUE_MID)
    _header_cell(ws, row, 2, "H_sys (m)", BLUE_MID)
    row += 1

    for pt in pts:
        _data_cell(ws, row, 1, pt.get("Q_m3h", 0), num_format="#,##0.00", align="right")
        _data_cell(ws, row, 2, pt.get("H_m",   0), num_format="#,##0.00", align="right")
        row += 1

    data_end = row - 1

    # Chart
    chart = LineChart()
    chart.title  = "System Curve"
    chart.style  = 10
    chart.y_axis.title = "Head (m)"
    chart.x_axis.title = "Flow (m³/h)"
    chart.height = 14
    chart.width  = 22

    y_ref = Reference(ws, min_col=2, min_row=data_start, max_row=data_end)
    x_ref = Reference(ws, min_col=1, min_row=data_start + 1, max_row=data_end)
    chart.add_data(y_ref, titles_from_data=True)
    chart.set_categories(x_ref)
    chart.series[0].graphicalProperties.line.solidFill = "1F3864"
    chart.series[0].graphicalProperties.line.width = 20000

    ws.add_chart(chart, f"D{data_start}")
    _set_col_widths(ws, [14, 14, 4])


def _sheet_pump_curves(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Pump Curves")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Pump Performance Curves",
                        "H-Q, efficiency, power, NPSHR at rated speed", meta=meta)

    pr = draft.get("pumpResult")
    if not pr:
        _no_data_note(ws, row, "Pump curves not computed. Configure pumps in Step 8.")
        return

    hq_pts    = pr.get("hq_curve",    [])
    eta_pts   = pr.get("eta_curve",   [])
    p_pts     = pr.get("p_curve",     [])
    npshr_pts = pr.get("npshr_curve", [])
    sys_curve = draft.get("hydraulicsResult", {}).get("system_curve", []) if draft.get("hydraulicsResult") else []

    # ── Table ─────────────────────────────────────────────────────────────────
    data_start = row
    hdrs = ["Q (m³/h)", "H_pump (m)", "η (%)", "P (kW)", "NPSHR (m)", "H_sys (m)"]
    for ci, h in enumerate(hdrs, 1):
        _header_cell(ws, row, ci, h, BLUE_MID)
    row += 1

    n = max(len(hq_pts), len(eta_pts), len(p_pts), len(npshr_pts))
    sys_dict = {round(p.get("Q_m3h", 0), 3): p.get("H_m", 0) for p in sys_curve}

    for i in range(n):
        Q_val  = hq_pts[i].get("Q_m3h", "")   if i < len(hq_pts)    else ""
        H_val  = hq_pts[i].get("value",  "")   if i < len(hq_pts)    else ""
        e_val  = eta_pts[i].get("value",  "")  if i < len(eta_pts)   else ""
        p_val  = p_pts[i].get("value",   "")   if i < len(p_pts)     else ""
        n_val  = npshr_pts[i].get("value","")  if i < len(npshr_pts) else ""
        q_key  = round(Q_val, 3) if isinstance(Q_val, float) else None
        s_val  = sys_dict.get(q_key, "") if q_key is not None else ""

        alt = (i % 2 == 1)
        for ci, v in enumerate([Q_val, H_val, e_val, p_val, n_val, s_val], 1):
            _data_cell(ws, row, ci, v, num_format="#,##0.00" if v != "" else None,
                       align="right", alt=alt)
        row += 1

    data_end = row - 1

    # ── HQ + System Curve chart ───────────────────────────────────────────────
    chart1 = LineChart()
    chart1.title  = "H-Q Curve vs System Curve"
    chart1.style  = 10
    chart1.y_axis.title = "Head (m)"
    chart1.x_axis.title = "Flow (m³/h)"
    chart1.height = 14
    chart1.width  = 22

    hq_ref  = Reference(ws, min_col=2, min_row=data_start, max_row=data_end)
    sys_ref = Reference(ws, min_col=6, min_row=data_start, max_row=data_end)
    x_ref   = Reference(ws, min_col=1, min_row=data_start + 1, max_row=data_end)
    chart1.add_data(hq_ref,  titles_from_data=True)
    chart1.add_data(sys_ref, titles_from_data=True)
    chart1.set_categories(x_ref)
    chart1.series[0].graphicalProperties.line.solidFill = "1F3864"
    chart1.series[0].graphicalProperties.line.width = 20000
    if len(chart1.series) > 1:
        chart1.series[1].graphicalProperties.line.solidFill = "E74C3C"
        chart1.series[1].graphicalProperties.line.width = 18000
        chart1.series[1].graphicalProperties.line.dashDot = "dash"

    ws.add_chart(chart1, f"H{data_start}")
    _set_col_widths(ws, [12, 12, 10, 10, 12, 12])


def _sheet_operating_points(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Operating Points")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Pump Operating Points",
                        "Intersection of pump and system curves", meta=meta)

    pr = draft.get("pumpResult")
    if not pr:
        _no_data_note(ws, row, "No pump result. Run pump computation first.")
        return

    ops = pr.get("operating_points", [])
    eta_pts = pr.get("eta_curve", [])

    data_start = row
    hdrs = ["Pumps in service", "Q (m³/h)", "Q (L/s)", "H (m)", "η (%)", "P (kW)", "NPSHR (m)", "NPSHA (m)", "NPSH margin (m)", "Status"]
    for ci, h in enumerate(hdrs, 1):
        _header_cell(ws, row, ci, h, BLUE_MID)
    row += 1

    for i, op in enumerate(ops):
        n_pu    = op.get("n_pumps", 1)
        Q_val   = op.get("Q_m3h", 0)
        H_val   = op.get("H_m",   0)
        eta_v   = op.get("eta_pct")
        pw_v    = op.get("power_kW")
        npshr_v = op.get("npshr_m")
        npsha_v = op.get("npsha_m")
        marg_v  = op.get("npsh_margin_m")
        warns   = op.get("warnings", [])
        status  = "OK" if not warns else f"WARN: {warns[0]}"
        alt = (i % 2 == 1)

        _data_cell(ws, row, 1,  n_pu,          align="center", alt=alt)
        _data_cell(ws, row, 2,  Q_val,          num_format="#,##0.00", align="right", alt=alt)
        _data_cell(ws, row, 3,  round(Q_val / 3.6, 3) if Q_val else "", num_format="#,##0.000", align="right", alt=alt)
        _data_cell(ws, row, 4,  H_val,          num_format="#,##0.00", align="right", alt=alt)
        _data_cell(ws, row, 5,  eta_v,          num_format="#,##0.0",  align="right", alt=alt)
        _data_cell(ws, row, 6,  pw_v,           num_format="#,##0.00", align="right", alt=alt)
        _data_cell(ws, row, 7,  npshr_v,        num_format="#,##0.00", align="right", alt=alt)
        _data_cell(ws, row, 8,  npsha_v,        num_format="#,##0.00", align="right", alt=alt)
        _data_cell(ws, row, 9,  marg_v,         num_format="#,##0.00", align="right", alt=alt)
        _data_cell(ws, row, 10, status, alt=alt)
        row += 1

    data_end = row - 1

    # Efficiency vs Q chart
    if eta_pts:
        chart2 = LineChart()
        chart2.title  = "Pump Efficiency vs Flow"
        chart2.style  = 10
        chart2.y_axis.title = "Efficiency (%)"
        chart2.x_axis.title = "Flow (m³/h)"
        chart2.height = 12
        chart2.width  = 20

        # Write eta data to side columns for chart reference
        eta_col_q = 12
        eta_col_e = 13
        ws.cell(row=1, column=eta_col_q, value="Q_eta")
        ws.cell(row=1, column=eta_col_e, value="η (%)")
        for ei, ep in enumerate(eta_pts):
            ws.cell(row=2 + ei, column=eta_col_q, value=ep.get("Q_m3h", 0))
            ws.cell(row=2 + ei, column=eta_col_e, value=ep.get("value",  0))

        eta_n = len(eta_pts)
        y_ref = Reference(ws, min_col=eta_col_e, min_row=1, max_row=1 + eta_n)
        x_ref = Reference(ws, min_col=eta_col_q, min_row=2, max_row=1 + eta_n)
        chart2.add_data(y_ref, titles_from_data=True)
        chart2.set_categories(x_ref)
        chart2.series[0].graphicalProperties.line.solidFill = "27AE60"
        chart2.series[0].graphicalProperties.line.width = 20000

        ws.add_chart(chart2, f"A{data_end + 3}")

    _set_col_widths(ws, [16, 12, 10, 10, 10, 10, 12, 12, 16, 20])


def _sheet_wet_well(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Wet Well")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Wet Well / Clear Well Sizing",
                        "Volume curve, cycle analysis, detention time", meta=meta)

    cw = draft.get("clearwellResult")
    if not cw:
        _no_data_note(ws, row, "Clear well not computed. Configure wet well in Step 5.")
        return

    # ── Summary KPIs ─────────────────────────────────────────────────────────
    kpi_data = [
        ("Operating volume",  cw.get("operating_volume_m3"), "m³"),
        ("Detention time",    cw.get("detention_time_min"),  "min"),
        ("Required detention", cw.get("required_detention_min"), "min"),
        ("Detention OK",      cw.get("detention_ok"),        "—"),
    ]
    for lbl, val, unit in kpi_data:
        _data_cell(ws, row, 1, lbl,  bold=True)
        _data_cell(ws, row, 2, val,  num_format="#,##0.00" if isinstance(val, float) else None, align="right")
        _data_cell(ws, row, 3, unit, align="center")
        row += 1

    row += 1

    # ── Volume curve ──────────────────────────────────────────────────────────
    vc = cw.get("volume_curve", [])
    vol_start = row
    hdrs = ["Level (m)", "Depth (m)", "Volume (m³)"]
    for ci, h in enumerate(hdrs, 1):
        _header_cell(ws, row, ci, h, BLUE_MID)
    row += 1

    for i, pt in enumerate(vc):
        alt = (i % 2 == 1)
        _data_cell(ws, row, 1, pt.get("level_m",  0), num_format="#,##0.000", align="right", alt=alt)
        _data_cell(ws, row, 2, pt.get("depth_m",  0), num_format="#,##0.000", align="right", alt=alt)
        _data_cell(ws, row, 3, pt.get("volume_m3", 0), num_format="#,##0.00",  align="right", alt=alt)
        row += 1

    vol_end = row - 1

    # ── Cycle results ─────────────────────────────────────────────────────────
    row += 1
    cr_list = cw.get("cycle_results", [])
    if cr_list:
        cr_hdrs = ["Stage", "Label", "Q_pump (m³/h)", "Q_in (m³/h)",
                   "t_fill (s)", "t_drain (s)", "t_cycle (s)", "Cycles/hr", "V_req (m³)", "Drain OK"]
        for ci, h in enumerate(cr_hdrs, 1):
            _header_cell(ws, row, ci, h, TEAL_HEADER)
        row += 1
        for i, cr in enumerate(cr_list):
            alt = (i % 2 == 1)
            vals = [
                cr.get("stage"),          cr.get("label"),
                cr.get("Q_pump_m3h"),     cr.get("Q_in_m3h"),
                cr.get("t_fill_s"),       cr.get("t_drain_s"),
                cr.get("t_cycle_s"),      cr.get("cycles_per_hour"),
                cr.get("V_req_m3"),       "Yes" if cr.get("pump_can_drain") else "No",
            ]
            for ci, v in enumerate(vals, 1):
                _data_cell(ws, row, ci, v,
                           num_format="#,##0.00" if isinstance(v, float) else None,
                           align="right" if isinstance(v, (int, float)) else "left",
                           alt=alt)
            row += 1

    # ── Volume curve chart ────────────────────────────────────────────────────
    if vc:
        chart = LineChart()
        chart.title  = "Clear Well Volume Curve"
        chart.style  = 10
        chart.y_axis.title = "Volume (m³)"
        chart.x_axis.title = "Water Level (m)"
        chart.height = 14
        chart.width  = 20

        y_ref = Reference(ws, min_col=3, min_row=vol_start, max_row=vol_end)
        x_ref = Reference(ws, min_col=1, min_row=vol_start + 1, max_row=vol_end)
        chart.add_data(y_ref, titles_from_data=True)
        chart.set_categories(x_ref)
        chart.series[0].graphicalProperties.line.solidFill = "2980B9"
        chart.series[0].graphicalProperties.line.width = 20000

        ws.add_chart(chart, f"E{vol_start}")

    _set_col_widths(ws, [14, 14, 14, 14, 14, 14, 14, 12, 14, 12])


def _sheet_eng_checks(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Engineering Checks")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Engineering Checks — Compliance Summary",
                        "Velocity, TDH, NPSH, cycling, surge screening per AS 2200 / AWWA", meta=meta)

    r    = draft.get("hydraulicsResult", {}) or {}
    pr   = draft.get("pumpResult",       {}) or {}
    cw   = draft.get("clearwellResult",  {}) or {}
    whr  = draft.get("waterHammerResult",{}) or {}
    Q    = draft.get("designFlow_m3h", 0.0)

    # Build check rows
    checks = []

    # Velocity check: 0.6–3.0 m/s per AS 2200
    v = r.get("velocity_ms", 0)
    if v:
        if v < 0.6:
            sev, note = "WARNING",  f"Velocity {v:.3f} m/s is below 0.6 m/s — risk of sediment deposition"
        elif v > 3.0:
            sev, note = "CRITICAL", f"Velocity {v:.3f} m/s exceeds 3.0 m/s — excessive friction and noise"
        else:
            sev, note = "OK",       f"Velocity {v:.3f} m/s is within 0.6–3.0 m/s range"
        checks.append(("Pipe velocity", f"{v:.3f} m/s", "0.6–3.0 m/s", "AS 2200", sev, note))

    # TDH sanity
    tdh = r.get("tdh_m", 0)
    if tdh:
        sev  = "OK" if tdh < 200 else "WARNING"
        note = "TDH within normal pump range" if tdh < 200 else f"TDH {tdh:.1f} m is high — verify pump selection"
        checks.append(("TDH", f"{tdh:.2f} m", "< 200 m typical", "AWWA M11", sev, note))

    # Reynolds number
    re = r.get("reynolds_number", 0)
    if re:
        if re > 4000:
            sev, note = "OK", f"Re = {re:,.0f} — turbulent flow"
        elif re > 2300:
            sev, note = "WARNING", f"Re = {re:,.0f} — transitional flow regime"
        else:
            sev, note = "CRITICAL", f"Re = {re:,.0f} — laminar flow at design Q"
        checks.append(("Reynolds No.", f"{re:,.0f}", "> 4000 (turbulent)", "Darcy-Weisbach", sev, note))

    # NPSH
    ops = pr.get("operating_points", [])
    for op in ops:
        m = op.get("npsh_margin_m")
        if m is not None:
            sev  = "OK" if m >= 0.5 else ("WARNING" if m >= 0 else "CRITICAL")
            note = f"NPSHa margin = {m:.2f} m. Min recommended ≥ 0.5 m per pump manufacturer."
            checks.append((f"NPSH margin (N={op.get('n_pumps',1)})", f"{m:.2f} m", "≥ 0.5 m", "ISO 9906", sev, note))

    # Cycling
    for cr in cw.get("cycle_results", []):
        cph = cr.get("cycles_per_hour", 0)
        ok  = cr.get("cycles_ok", True)
        sev  = "OK" if ok else "WARNING"
        note = f"Stage {cr.get('stage',1)} — {cph:.1f} cycles/hr. Max allowed: {draft.get('clearwellConfig', {}).get('max_cycles_per_hour', 6) if draft.get('clearwellConfig') else 6}"
        checks.append((f"Cycling (stage {cr.get('stage',1)})", f"{cph:.2f} /hr", "≤ 6 /hr typical", "AWWA M37", sev, note))

    # Surge
    if whr.get("cavitation_risk"):
        checks.append(("Surge — cavitation risk", "YES", "NO", "AS 2941", "CRITICAL",
                        f"Min head {whr.get('min_pressure_head_m',0):.2f} m < vapour pressure. Column separation risk."))
    elif whr.get("delta_H_m"):
        dH = whr.get("delta_H_m", 0)
        sev  = "WARNING" if dH > 50 else "OK"
        note = f"Joukowsky ΔH = {dH:.1f} m. {'Consider surge protection.' if dH > 50 else 'Within acceptable limits.'}"
        checks.append(("Surge — Joukowsky ΔH", f"{dH:.1f} m", "< 50 m guideline", "AS 2941", sev, note))

    if not checks:
        _no_data_note(ws, row, "No compute results found. Run hydraulics, pump, and surge analyses first.")
        return

    # Headers
    hdrs = ["Check", "Value", "Criterion", "Standard", "Result", "Notes"]
    bg_map = {"OK": "27AE60", "WARNING": "F39C12", "CRITICAL": "E74C3C"}
    for ci, h in enumerate(hdrs, 1):
        _header_cell(ws, row, ci, h, BLUE_MID)
    ws.merge_cells(f"F{row}:J{row}")
    row += 1

    for i, (check, val, crit, std, sev, note) in enumerate(checks):
        alt = (i % 2 == 1)
        _data_cell(ws, row, 1, check, bold=True, alt=alt)
        _data_cell(ws, row, 2, val,   align="right", alt=alt)
        _data_cell(ws, row, 3, crit,  alt=alt)
        _data_cell(ws, row, 4, std,   alt=alt)
        sev_cell = ws.cell(row=row, column=5, value=sev)
        sev_cell.fill   = _hdr_fill(bg_map.get(sev, BLUE_MID))
        sev_cell.font   = Font(bold=True, size=10, color=WHITE)
        sev_cell.alignment = Alignment(horizontal="center")
        sev_cell.border = _thin_border()
        ws.merge_cells(f"F{row}:J{row}")
        _data_cell(ws, row, 6, note, alt=alt)
        row += 1

    _set_col_widths(ws, [30, 16, 22, 14, 12, 60])


def _sheet_surge_quick(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Surge Quick (Mode A)")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Water Hammer — Joukowsky / Allievi Quick Analysis",
                        "Mode A: instantaneous valve closure or pump trip", meta=meta)

    whr = draft.get("waterHammerResult")
    if not whr:
        _no_data_note(ws, row, "No surge quick result. Run water hammer Mode A analysis first.")
        return

    params = [
        ("Pipeline",                 whr.get("pipeline",           ""),  "—"),
        ("Event type",               whr.get("event_type",         ""),  "—"),
        ("Wave speed (a)",           whr.get("wave_speed_ms",       0),  "m/s"),
        ("Steady-state velocity V₀", whr.get("V0_ms",               0),  "m/s"),
        ("Pipe length (L)",          whr.get("pipe_length_m",       0),  "m"),
        ("Fluid density (ρ)",        whr.get("rho_kg_m3",          1000),"kg/m³"),
        ("Operating head H₀",        whr.get("H_operating_m",       0),  "m"),
        ("Joukowsky ΔH",             whr.get("delta_H_joukowsky_m", 0),  "m"),
        ("Joukowsky ΔP",             whr.get("delta_P_joukowsky_kPa",0), "kPa"),
        ("Pipe period T = 2L/a",     whr.get("T_char_s",            0),  "s"),
        ("Closure time t_c",         whr.get("closure_time_s"),         "s"),
        ("Reduction factor K",       whr.get("reduction_factor",    1.0),"—"),
        ("Effective ΔH",             whr.get("delta_H_m",           0),  "m"),
        ("Effective ΔP",             whr.get("delta_P_kPa",         0),  "kPa"),
        ("Max pressure head",        whr.get("max_pressure_head_m", 0),  "m"),
        ("Min pressure head",        whr.get("min_pressure_head_m", 0),  "m"),
        ("Max pressure",             whr.get("max_pressure_kPa",    0),  "kPa"),
        ("Min pressure",             whr.get("min_pressure_kPa",    0),  "kPa"),
        ("Vapor pressure head",      whr.get("vapor_pressure_head_m",0), "m"),
        ("Temperature",              whr.get("temperature_C",       20),  "°C"),
        ("Cavitation risk",          "YES" if whr.get("cavitation_risk") else "NO", "—"),
        ("Vacuum risk",              "YES" if whr.get("vacuum_risk")     else "NO", "—"),
    ]

    _header_cell(ws, row, 1, "Parameter", BLUE_MID)
    _header_cell(ws, row, 2, "Value",     BLUE_MID)
    _header_cell(ws, row, 3, "Unit",      BLUE_MID)
    row += 1

    for i, (param, val, unit) in enumerate(params):
        alt = (i % 2 == 1)
        _data_cell(ws, row, 1, param, bold=True, alt=alt)
        if isinstance(val, float):
            _data_cell(ws, row, 2, val, num_format="#,##0.0000", align="right", alt=alt)
        else:
            _data_cell(ws, row, 2, val, align="right", alt=alt)
        _data_cell(ws, row, 3, unit, align="center", alt=alt)
        row += 1

    # Rating check
    rc = whr.get("rating_check")
    if rc:
        row += 1
        ws.merge_cells(f"A{row}:C{row}")
        c = ws[f"A{row}"]
        c.value = "Pressure Rating Check"
        c.fill  = _hdr_fill(TEAL_HEADER)
        c.font  = Font(bold=True, size=11, color=WHITE)
        c.alignment = Alignment(horizontal="left")
        row += 1
        rc_rows = [
            ("Rating status",          rc.get("rating_status", "").upper()),
            ("Pressure rating (PN)",   rc.get("pressure_rating_kPa",  0)),
            ("Max transient pressure", rc.get("max_transient_kPa",    0)),
            ("Factor of safety",       rc.get("factor_of_safety",     0)),
        ]
        status_colors = {"PASS": "27AE60", "CAUTION": "F39C12", "FAIL": "E74C3C"}
        for param, val in rc_rows:
            _data_cell(ws, row, 1, param, bold=True)
            if isinstance(val, str):
                c2 = ws.cell(row=row, column=2, value=val)
                sc = status_colors.get(val.upper(), "555555")
                c2.fill = _hdr_fill(sc)
                c2.font = Font(bold=True, color=WHITE, size=10)
                c2.alignment = Alignment(horizontal="center")
                c2.border = _thin_border()
            else:
                _data_cell(ws, row, 2, val, num_format="#,##0.00", align="right")
            row += 1

    _set_col_widths(ws, [35, 18, 10])


def _sheet_moc_histories(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Surge MOC Time Histories")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Surge MOC — Time History at Observation Points",
                        "Head and pressure vs time (Method of Characteristics)", meta=meta)

    moc = draft.get("mocResult") or draft.get("suctionSurgeResult")
    if not moc:
        _no_data_note(ws, row, "No MOC result. Run Mode B (MOC) analysis first.")
        return

    obs_pts = moc.get("observations", [])
    if not obs_pts:
        _no_data_note(ws, row, "No observation points in MOC result.")
        return

    # Write all observation point histories side by side
    col_base  = 1
    chart_pts: list[tuple[int, int, int, str]] = []  # (col_t, col_H, n_rows, label)

    for obs in obs_pts:
        label   = obs.get("label", "Obs")
        history = obs.get("history", [])
        if not history:
            continue

        n_rows = len(history)
        h_row  = row
        ws.cell(row=h_row, column=col_base,     value=f"{label} — t (s)").font = Font(bold=True, size=10, color=WHITE)
        ws.cell(row=h_row, column=col_base).fill = _hdr_fill(BLUE_MID)
        ws.cell(row=h_row, column=col_base + 1, value=f"{label} — H (m)").font = Font(bold=True, size=10, color=WHITE)
        ws.cell(row=h_row, column=col_base + 1).fill = _hdr_fill(BLUE_MID)

        for i, pt in enumerate(history):
            ws.cell(row=h_row + 1 + i, column=col_base,     value=pt.get("t_s", 0))
            ws.cell(row=h_row + 1 + i, column=col_base + 1, value=pt.get("H_m", 0))

        chart_pts.append((col_base, col_base + 1, h_row, h_row + n_rows, label))
        col_base += 3

    # ── Chart: head vs time for first 3 observation points ───────────────────
    if chart_pts:
        chart = LineChart()
        chart.title  = "MOC Time Histories — Head at Observation Points"
        chart.style  = 10
        chart.y_axis.title = "Head (m)"
        chart.x_axis.title = "Time (s)"
        chart.height = 16
        chart.width  = 26

        colors_c = ["1F3864", "E74C3C", "27AE60", "8E44AD", "F39C12"]
        for idx, (col_t, col_H, r_start, r_end, label) in enumerate(chart_pts[:5]):
            y_ref = Reference(ws, min_col=col_H, min_row=r_start, max_row=r_end)
            x_ref = Reference(ws, min_col=col_t, min_row=r_start + 1, max_row=r_end)
            chart.add_data(y_ref, titles_from_data=True)
            chart.set_categories(x_ref)
            if idx < len(chart.series):
                chart.series[idx].graphicalProperties.line.solidFill = colors_c[idx % len(colors_c)]
                chart.series[idx].graphicalProperties.line.width = 18000

        chart_row = row + max(len(obs.get("history", [])) for obs in obs_pts) + 3
        ws.add_chart(chart, f"A{chart_row}")

    _set_col_widths(ws, [12, 12, 2] * 5)


def _sheet_surge_envelope(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Surge Envelope vs Distance")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Surge Pressure Envelope — Max/Min vs Distance",
                        "Extreme HGL from MOC transient simulation", meta=meta)

    moc = draft.get("mocResult") or draft.get("suctionSurgeResult")
    if not moc:
        _no_data_note(ws, row, "No MOC result. Run Mode B (MOC) analysis first.")
        return

    env = moc.get("envelope", [])
    if not env:
        _no_data_note(ws, row, "No envelope data in MOC result.")
        return

    # Global summary
    summary_rows = [
        ("Global max head",  moc.get("global_max_H_m",   0), "m"),
        ("Global min head",  moc.get("global_min_H_m",   0), "m"),
        ("Global max press", moc.get("global_max_P_kPa", 0), "kPa"),
        ("Global min press", moc.get("global_min_P_kPa", 0), "kPa"),
        ("Cavitation nodes", len(moc.get("cavitation_x_m", [])), "—"),
        ("Temperature",      moc.get("temperature_C", 20),    "°C"),
        ("h_vap",            moc.get("h_vap_m", -10.3),       "m"),
    ]
    for lbl, val, unit in summary_rows:
        _data_cell(ws, row, 1, lbl,  bold=True)
        _data_cell(ws, row, 2, val,  num_format="#,##0.00" if isinstance(val, float) else None, align="right")
        _data_cell(ws, row, 3, unit, align="center")
        row += 1

    row += 1

    data_start = row
    hdrs = ["x (m)", "Elev (m)", "H_max (m)", "H_min (m)", "P_max (kPa)", "P_min (kPa)"]
    for ci, h in enumerate(hdrs, 1):
        _header_cell(ws, row, ci, h, BLUE_MID)
    row += 1

    for i, pt in enumerate(env):
        alt = (i % 2 == 1)
        vals = [
            pt.get("x_m",     0), pt.get("elev_m",     0),
            pt.get("H_max_m", 0), pt.get("H_min_m",    0),
            pt.get("P_max_kPa", 0), pt.get("P_min_kPa", 0),
        ]
        for ci, v in enumerate(vals, 1):
            _data_cell(ws, row, ci, v, num_format="#,##0.00", align="right", alt=alt)
        row += 1

    data_end = row - 1

    # Chart: H_max and H_min vs x
    chart = LineChart()
    chart.title  = "Surge Pressure Envelope"
    chart.style  = 10
    chart.y_axis.title = "Head (m)"
    chart.x_axis.title = "Distance (m)"
    chart.height = 16
    chart.width  = 26

    hmax_ref = Reference(ws, min_col=3, min_row=data_start, max_row=data_end)
    hmin_ref = Reference(ws, min_col=4, min_row=data_start, max_row=data_end)
    x_ref    = Reference(ws, min_col=1, min_row=data_start + 1, max_row=data_end)

    chart.add_data(hmax_ref, titles_from_data=True)
    chart.add_data(hmin_ref, titles_from_data=True)
    chart.set_categories(x_ref)
    chart.series[0].graphicalProperties.line.solidFill = "E74C3C"
    chart.series[0].graphicalProperties.line.width = 20000
    if len(chart.series) > 1:
        chart.series[1].graphicalProperties.line.solidFill = "2980B9"
        chart.series[1].graphicalProperties.line.width = 20000

    ws.add_chart(chart, f"H{data_start}")
    _set_col_widths(ws, [12, 12, 14, 14, 16, 16])


def _sheet_protection(wb: Workbook, draft: dict) -> None:
    ws  = wb.create_sheet("Protection Comparisons")
    meta = draft.get("meta", {})
    row  = _sheet_title(ws, "Surge Protection — What-If Comparison",
                        "Baseline vs protection device alternatives", meta=meta)

    wi = draft.get("whatIfResult")
    if not wi:
        _no_data_note(ws, row, "No what-if comparison result. Run Protection Devices panel first.")
        return

    baseline = wi.get("baseline", {})
    runs     = wi.get("device_runs", [])
    all_runs = [baseline] + runs

    hdrs = ["Scenario", "Global Max H (m)", "Global Min H (m)", "Max Pressure (kPa)",
            "Min Pressure (kPa)", "Surge Reduction (m)", "Surge Reduction (%)",
            "Cavitation Nodes", "Cavitation Risk", "Rating Status"]
    for ci, h in enumerate(hdrs, 1):
        _header_cell(ws, row, ci, h, BLUE_MID)
    row += 1

    for i, run in enumerate(all_runs):
        alt = (i % 2 == 1)
        rc  = run.get("rating_check") or {}

        if run.get("run_error"):
            _data_cell(ws, row, 1, run.get("label", f"Run {i}"), bold=True, alt=alt)
            ws.merge_cells(f"B{row}:J{row}")
            _data_cell(ws, row, 2, f"ERROR — {run['run_error']}", alt=alt)
            row += 1
            continue

        vals = [
            run.get("label",                  "Baseline"),
            run.get("global_max_H_m",         0),
            run.get("global_min_H_m",         0),
            run.get("global_max_P_kPa",       0),
            run.get("global_min_P_kPa",       0),
            run.get("max_surge_reduction_m"),
            run.get("max_surge_reduction_pct"),
            len(run.get("cavitation_x_m",    [])),
            "YES" if run.get("cavitation_risk") else "NO",
            rc.get("rating_status", "N/A").upper() if rc else "N/A",
        ]
        for ci, v in enumerate(vals, 1):
            _data_cell(ws, row, ci, v,
                       num_format="#,##0.00" if isinstance(v, float) else None,
                       align="right" if isinstance(v, (int, float)) else "left",
                       alt=alt)
        row += 1

    # Assumption notes
    notes = wi.get("assumption_notes", [])
    if notes:
        row += 1
        ws.merge_cells(f"A{row}:J{row}")
        c = ws[f"A{row}"]
        c.value = "Assumption Notes"
        c.fill  = _hdr_fill(TEAL_HEADER)
        c.font  = Font(bold=True, size=10, color=WHITE)
        row += 1
        for note in notes:
            ws.merge_cells(f"A{row}:J{row}")
            _data_cell(ws, row, 1, f"• {note}")
            row += 1

    _set_col_widths(ws, [28, 16, 16, 16, 16, 18, 18, 16, 14, 14])


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def build_workbook(draft: dict) -> bytes:
    """
    Build a .xlsx workbook from a serialised ProjectDraft dict.

    Returns
    -------
    bytes — the raw .xlsx file content ready for a streaming HTTP response.
    """
    wb = Workbook()
    # Remove the default sheet created by openpyxl
    default = wb.active
    if default is not None:
        wb.remove(default)

    _sheet_inputs(wb, draft)
    _sheet_hydraulics(wb, draft)
    _sheet_system_curve(wb, draft)
    _sheet_pump_curves(wb, draft)
    _sheet_operating_points(wb, draft)
    _sheet_wet_well(wb, draft)
    _sheet_eng_checks(wb, draft)
    _sheet_surge_quick(wb, draft)
    _sheet_moc_histories(wb, draft)
    _sheet_surge_envelope(wb, draft)
    _sheet_protection(wb, draft)

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.read()
