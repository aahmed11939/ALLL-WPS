"""
Excel export module — ALLL WPS Designer.

Planned functionality (future implementation):
    - Generate a multi-sheet workbook (openpyxl) containing:
        Sheet 1: Project summary (site data, design criteria, pump schedule).
        Sheet 2: Hydraulic calculation tables (TDH breakdown per duty/standby scenario).
        Sheet 3: System curve and pump curve data tables.
        Sheet 4: Pipe schedule with wall thickness, class, and pressure ratings.
    - Apply corporate report template (logo, header/footer, colour theme).
    - Embed system-curve chart as an embedded Excel chart object.

Dependencies (to be installed):
    openpyxl >= 3.1
    xlsxwriter >= 3.2  (alternative with richer chart support)
"""

# TODO: implement ExcelExporter class
