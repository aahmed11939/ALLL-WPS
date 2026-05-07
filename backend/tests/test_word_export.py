"""
Tests for backend/export/word_export.py and the POST /export/word endpoint.

Covers:
  - build_document() with empty / minimal / full drafts
  - _doc_to_bytes() serialises to valid .docx bytes
  - Endpoint returns 200 with correct content-type and Content-Disposition
  - Endpoint returns valid .docx bytes openable by python-docx
  - Endpoint handles empty body ({}), partial draft, and full draft
  - Project name used in filename
  - All major report sections present in the document body text
"""

from __future__ import annotations

import io

import pytest
from docx import Document
from docx.document import Document as DocxDocument
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.export.word_export import _doc_to_bytes, build_document
from backend.engine.word_figures import (
    fig_system_curve,
    fig_efficiency_power,
    fig_npsh,
    fig_surge_envelope_suction,
    fig_surge_envelope_discharge,
    fig_moc_histories,
    fig_protection_comparison,
)

client = TestClient(app)

# ---------------------------------------------------------------------------
# Reuse fixtures from the Excel test (copied inline for independence)
# ---------------------------------------------------------------------------

EMPTY_DRAFT: dict = {
    "meta": {
        "name": "Test Project",
        "client": "ACME Water",
        "job_number": "WPS-001",
        "date": "2026-05-07",
        "engineer": "J. Smith",
        "notes": "",
    },
    "unitSystem": "SI",
    "designFlow_m3h": 36.0,
    "upstreamNode":   {"elevation_m": 5.0,  "pressure_kPa": 0},
    "downstreamNode": {"elevation_m": 35.0, "pressure_kPa": 0},
    "suction": {
        "segments": [{"material": "pvc", "diameter_mm": 150, "length_m": 100}],
        "accessories": [],
        "accessories_K_sum": 0.5,
    },
    "discharge": {
        "segments": [{"material": "dicl", "diameter_mm": 200, "length_m": 400}],
        "accessories": [],
        "accessories_K_sum": 1.2,
    },
    "hydraulicsResult": None,
    "pumpResult":       None,
    "clearwellResult":  None,
    "waterHammerResult": None,
    "mocResult":        None,
    "whatIfResult":     None,
}

HYDRAULICS_RESULT = {
    "design_Q_m3h":    36.0,
    "velocity_ms":     1.35,
    "reynolds_number": 225000.0,
    "friction_factor": 0.0165,
    "K_sum":           1.5,
    "static_head_m":   30.0,
    "friction_head_m": 8.4,
    "minor_head_m":    0.14,
    "tdh_m":           38.54,
    "system_curve": [
        {"Q_m3h":  0.0,  "H_m": 30.0},
        {"Q_m3h": 18.0,  "H_m": 32.0},
        {"Q_m3h": 36.0,  "H_m": 38.5},
        {"Q_m3h": 54.0,  "H_m": 49.5},
        {"Q_m3h": 72.0,  "H_m": 65.0},
    ],
}

PUMP_RESULT = {
    "active": True,
    "hq_curve": [
        {"Q_m3h": 0.0,  "value": 42.0},
        {"Q_m3h": 36.0, "value": 38.5},
        {"Q_m3h": 72.0, "value": 28.0},
    ],
    "eta_curve": [
        {"Q_m3h": 0.0,  "value": 0.0},
        {"Q_m3h": 36.0, "value": 72.0},
        {"Q_m3h": 72.0, "value": 55.0},
    ],
    "p_curve": [
        {"Q_m3h": 0.0,  "value": 0.0},
        {"Q_m3h": 36.0, "value": 5.3},
        {"Q_m3h": 72.0, "value": 9.8},
    ],
    "npshr_curve": [
        {"Q_m3h": 0.0,  "value": 2.0},
        {"Q_m3h": 36.0, "value": 3.5},
        {"Q_m3h": 72.0, "value": 5.2},
    ],
    "speed_curves": [],
    "operating_points": [
        {
            "n_pumps":       1,
            "Q_m3h":         36.2,
            "H_m":           38.4,
            "eta_pct":       71.8,
            "power_kW":      5.3,
            "npshr_m":       3.5,
            "npsha_m":       4.5,
            "npsh_margin_m": 1.0,
            "warnings":      [],
        }
    ],
    "non_physical_fit": False,
    "warnings": [],
}

CLEARWELL_RESULT = {
    "active": True,
    "volume_curve": [
        {"level_m": 0.0, "depth_m": 0.0, "volume_m3": 0.0},
        {"level_m": 1.0, "depth_m": 1.0, "volume_m3": 19.6},
        {"level_m": 2.0, "depth_m": 2.0, "volume_m3": 39.3},
    ],
    "operating_volume_m3": 39.3,
    "cycle_results": [
        {
            "stage": 1,
            "label": "Duty",
            "Q_pump_m3h": 72.0,
            "Q_in_m3h": 36.0,
            "t_fill_s": None,
            "t_drain_s": 1965.6,
            "t_cycle_s": 2944.0,
            "cycles_per_hour": 1.22,
            "V_req_m3": 19.6,
            "cycles_ok": True,
            "pump_can_drain": True,
        }
    ],
    "detention_time_min": 65.5,
    "required_detention_min": 30.0,
    "detention_ok": True,
    "warnings": [],
}

SURGE_QUICK_RESULT = {
    "pipeline":              "discharge",
    "event_type":            "pump_trip",
    "wave_speed_ms":         1000.0,
    "V0_ms":                 1.35,
    "pipe_length_m":         400.0,
    "rho_kg_m3":             1000.0,
    "H_operating_m":         38.5,
    "delta_V_ms":            1.35,
    "delta_H_joukowsky_m":   137.7,
    "delta_P_joukowsky_kPa": 1377.0,
    "T_char_s":              0.8,
    "closure_time_s":        None,
    "reduction_factor":      1.0,
    "reduction_method":      "instantaneous",
    "delta_H_m":             137.7,
    "delta_P_kPa":           1377.0,
    "envelope":              [],
    "min_pressure_head_m":  -99.2,
    "max_pressure_head_m":  176.2,
    "min_pressure_kPa":     -973.0,
    "max_pressure_kPa":     1730.0,
    "cavitation_risk":       True,
    "vacuum_risk":           True,
    "vapor_pressure_head_m": -10.3,
    "temperature_C":         20.0,
    "rating_check":          None,
    "unit_system":           "SI",
}

MOC_RESULT = {
    "pipeline":          "discharge",
    "N":                 10,
    "dx_m":              40.0,
    "dt_s":              0.04,
    "courant":           1.0,
    "t_total_s":         2.0,
    "n_steps":           50,
    "D_m":               0.2,
    "f":                 0.018,
    "T_char_s":          0.8,
    "envelope": [
        {"x_m": 0.0,   "elev_m": 35.0, "H_max_m": 50.0, "H_min_m": 10.0,
         "P_max_kPa": 147.0, "P_min_kPa": -245.0},
        {"x_m": 200.0, "elev_m": 20.0, "H_max_m": 45.0, "H_min_m":  5.0,
         "P_max_kPa": 245.0, "P_min_kPa": -147.0},
        {"x_m": 400.0, "elev_m":  5.0, "H_max_m": 40.0, "H_min_m":  0.0,
         "P_max_kPa": 343.0, "P_min_kPa":    0.0},
    ],
    "observations": [
        {
            "label":      "Pump outlet",
            "frac":       0.0,
            "node_index": 0,
            "x_m":        0.0,
            "history": [
                {"t_s": 0.0,  "H_m": 38.5, "P_kPa": 328.0},
                {"t_s": 0.04, "H_m": 42.1, "P_kPa": 373.0},
                {"t_s": 0.08, "H_m": 38.0, "P_kPa": 323.0},
            ],
        }
    ],
    "global_max_H_m":   50.0,
    "global_min_H_m":   0.0,
    "global_max_P_kPa": 343.0,
    "global_min_P_kPa": 0.0,
    "cavitation_x_m":   [400.0],
    "h_vap_m":          -10.3,
    "temperature_C":    20.0,
    "assumption_notes": [],
    "rating_check":     None,
    "unit_system":      "SI",
}

WHATIF_RESULT = {
    "baseline": {
        "label":                   "Baseline (no device)",
        "run_error":               None,
        "global_max_H_m":          50.0,
        "global_min_H_m":          0.0,
        "global_max_P_kPa":        343.0,
        "global_min_P_kPa":        0.0,
        "max_surge_reduction_m":   None,
        "max_surge_reduction_pct": None,
        "min_head_improvement_m":  None,
        "cavitation_x_m":          [400.0],
        "cavitation_risk":         True,
        "risk_duration_s":         0.2,
        "envelope_reduction_pct":  None,
        "rating_check":            None,
        "sizing_summary":          None,
        "envelope":                [],
    },
    "device_runs": [
        {
            "label":                   "Air Vessel 0.5 m³",
            "run_error":               None,
            "global_max_H_m":          42.0,
            "global_min_H_m":          5.0,
            "global_max_P_kPa":        285.0,
            "global_min_P_kPa":        49.0,
            "max_surge_reduction_m":   8.0,
            "max_surge_reduction_pct": 16.0,
            "min_head_improvement_m":  5.0,
            "cavitation_x_m":          [],
            "cavitation_risk":         False,
            "risk_duration_s":         0.0,
            "envelope_reduction_pct":  16.0,
            "rating_check":            None,
            "sizing_summary":          None,
            "envelope":                [],
        }
    ],
    "assumption_notes": ["Screening-level analysis. ±30–50 % accuracy."],
    "t_total_s":        2.0,
    "T_char_s":         0.8,
    "pipeline":         "discharge",
}


def full_draft() -> dict:
    d = dict(EMPTY_DRAFT)
    d["hydraulicsResult"]  = HYDRAULICS_RESULT
    d["pumpResult"]        = PUMP_RESULT
    d["clearwellResult"]   = CLEARWELL_RESULT
    d["waterHammerResult"] = SURGE_QUICK_RESULT
    d["mocResult"]         = MOC_RESULT
    d["whatIfResult"]      = WHATIF_RESULT
    return d


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _all_text(doc: Document) -> str:
    return "\n".join(p.text for p in doc.paragraphs)


def _table_text(doc: Document) -> str:
    parts = []
    for tbl in doc.tables:
        for row in tbl.rows:
            for cell in row.cells:
                parts.append(cell.text)
    return "\n".join(parts)


def _full_text(doc: Document) -> str:
    return _all_text(doc) + "\n" + _table_text(doc)


# ===========================================================================
# Unit tests — build_document()
# ===========================================================================


class TestBuildDocument:
    def test_returns_document(self):
        doc = build_document(EMPTY_DRAFT)
        assert isinstance(doc, DocxDocument)

    def test_doc_to_bytes_produces_bytes(self):
        doc   = build_document(EMPTY_DRAFT)
        data  = _doc_to_bytes(doc)
        assert isinstance(data, bytes)
        assert len(data) > 500

    def test_bytes_is_valid_docx(self):
        doc  = build_document(EMPTY_DRAFT)
        data = _doc_to_bytes(doc)
        reopened = Document(io.BytesIO(data))
        assert reopened is not None

    def test_empty_dict_no_raise(self):
        doc  = build_document({})
        data = _doc_to_bytes(doc)
        assert len(data) > 100

    def test_title_page_has_project_name(self):
        doc  = build_document(EMPTY_DRAFT)
        text = _full_text(doc)
        assert "Test Project" in text

    def test_title_page_has_engineer(self):
        doc  = build_document(EMPTY_DRAFT)
        text = _full_text(doc)
        assert "J. Smith" in text

    def test_executive_summary_section_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Executive Summary" in text

    def test_hydraulics_section_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Hydraulic Analysis" in text

    def test_hydraulics_tdh_in_tables(self):
        doc  = build_document(full_draft())
        text = _table_text(doc)
        assert "TDH" in text or "38.54" in text

    def test_pump_section_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Pump Analysis" in text

    def test_pump_operating_point_in_tables(self):
        doc  = build_document(full_draft())
        text = _table_text(doc)
        assert "36.20" in text or "71.8" in text

    def test_wetwell_section_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Wet Well" in text

    def test_wetwell_volume_in_tables(self):
        doc  = build_document(full_draft())
        text = _table_text(doc)
        assert "39.30" in text or "39.3" in text

    def test_engineering_checks_section_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Engineering Checks" in text

    def test_surge_section_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Surge" in text or "Water Hammer" in text

    def test_joukowsky_delta_h_in_tables(self):
        doc  = build_document(full_draft())
        text = _table_text(doc)
        assert "137.7" in text or "137.70" in text

    def test_moc_section_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Method of Characteristics" in text

    def test_surge_protection_comparison_present(self):
        doc  = build_document(full_draft())
        text = _full_text(doc)
        assert "Baseline" in text or "Air Vessel" in text

    def test_appendix_a_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Appendix A" in text

    def test_appendix_b_present(self):
        doc  = build_document(full_draft())
        text = _all_text(doc)
        assert "Appendix B" in text

    def test_pipeline_materials_in_appendix(self):
        doc  = build_document(full_draft())
        text = _table_text(doc)
        assert "pvc" in text.lower() or "dicl" in text.lower()

    def test_partial_draft_hydraulics_only_no_raise(self):
        d = dict(EMPTY_DRAFT)
        d["hydraulicsResult"] = HYDRAULICS_RESULT
        doc  = build_document(d)
        data = _doc_to_bytes(doc)
        assert len(data) > 500

    def test_document_has_tables(self):
        doc = build_document(full_draft())
        assert len(doc.tables) >= 5

    def test_document_has_paragraphs(self):
        doc = build_document(full_draft())
        assert len(doc.paragraphs) >= 10


# ===========================================================================
# Integration tests — POST /export/word endpoint
# ===========================================================================


class TestExportWordEndpoint:
    def test_endpoint_200_full_draft(self):
        resp = client.post("/export/word", json=full_draft())
        assert resp.status_code == 200

    def test_endpoint_200_empty_draft(self):
        resp = client.post("/export/word", json={})
        assert resp.status_code == 200

    def test_endpoint_content_type_docx(self):
        resp = client.post("/export/word", json=full_draft())
        ct = resp.headers.get("content-type", "")
        assert "wordprocessingml" in ct or "vnd.openxmlformats" in ct

    def test_endpoint_content_disposition_attachment(self):
        resp = client.post("/export/word", json=full_draft())
        cd   = resp.headers.get("content-disposition", "")
        assert "attachment" in cd

    def test_endpoint_filename_has_docx_extension(self):
        resp = client.post("/export/word", json=full_draft())
        cd   = resp.headers.get("content-disposition", "")
        assert ".docx" in cd

    def test_endpoint_filename_uses_project_name(self):
        d = dict(EMPTY_DRAFT)
        d["meta"] = dict(EMPTY_DRAFT["meta"], name="Riverview Station")
        resp = client.post("/export/word", json=d)
        assert resp.status_code == 200
        cd = resp.headers.get("content-disposition", "")
        assert "Riverview" in cd or "Station" in cd

    def test_endpoint_returns_valid_docx_bytes(self):
        resp = client.post("/export/word", json=full_draft())
        doc  = Document(io.BytesIO(resp.content))
        assert doc is not None

    def test_endpoint_partial_draft_200(self):
        d = dict(EMPTY_DRAFT)
        d["hydraulicsResult"] = HYDRAULICS_RESULT
        resp = client.post("/export/word", json=d)
        assert resp.status_code == 200

    def test_endpoint_invalid_json_422(self):
        resp = client.post(
            "/export/word",
            content=b"NOT JSON",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 422

    def test_endpoint_document_contains_project_name(self):
        resp = client.post("/export/word", json=full_draft())
        doc  = Document(io.BytesIO(resp.content))
        text = _full_text(doc)
        assert "Test Project" in text


# ===========================================================================
# word_figures module — public API contract
# Each function must return bytes (when data present) or None (when absent).
# ===========================================================================


class TestWordFiguresApiContract:
    """Verify every public figure function honours its bytes | None contract."""

    def test_fig_system_curve_returns_bytes_when_data_present(self):
        result = fig_system_curve(full_draft())
        assert isinstance(result, bytes) and len(result) > 100

    def test_fig_system_curve_returns_none_when_no_curves(self):
        result = fig_system_curve(EMPTY_DRAFT)
        assert result is None

    def test_fig_efficiency_power_returns_bytes_when_data_present(self):
        result = fig_efficiency_power(full_draft())
        assert isinstance(result, bytes) and len(result) > 100

    def test_fig_efficiency_power_returns_none_when_no_eta(self):
        result = fig_efficiency_power(EMPTY_DRAFT)
        assert result is None

    def test_fig_npsh_returns_bytes_when_data_present(self):
        result = fig_npsh(full_draft())
        assert isinstance(result, bytes) and len(result) > 100

    def test_fig_npsh_returns_none_when_no_npshr(self):
        result = fig_npsh(EMPTY_DRAFT)
        assert result is None

    def test_fig_surge_envelope_discharge_returns_bytes_when_data_present(self):
        result = fig_surge_envelope_discharge(full_draft())
        assert isinstance(result, bytes) and len(result) > 100

    def test_fig_surge_envelope_suction_returns_none_for_discharge_data(self):
        # MOC_RESULT has pipeline="discharge"; suction envelope should be None
        result = fig_surge_envelope_suction(full_draft())
        assert result is None

    def test_fig_surge_envelope_suction_returns_bytes_for_suction_data(self):
        d = full_draft()
        d["mocResult"] = dict(MOC_RESULT, pipeline="suction")
        result = fig_surge_envelope_suction(d)
        assert isinstance(result, bytes) and len(result) > 100

    def test_fig_moc_histories_returns_bytes_when_observations_present(self):
        result = fig_moc_histories(full_draft())
        assert isinstance(result, bytes) and len(result) > 100

    def test_fig_moc_histories_returns_none_when_no_observations(self):
        result = fig_moc_histories(EMPTY_DRAFT)
        assert result is None

    def test_fig_protection_comparison_returns_bytes_when_whatif_present(self):
        result = fig_protection_comparison(full_draft())
        assert isinstance(result, bytes) and len(result) > 100

    def test_fig_protection_comparison_returns_none_when_no_whatif(self):
        result = fig_protection_comparison(EMPTY_DRAFT)
        assert result is None


# ===========================================================================
# Document structure contracts — revision table, system description,
# appendices C and D, page numbering footer, Courier New equations.
# ===========================================================================


class TestDocumentStructureContracts:
    """Verify required structural and styling elements are present."""

    def _get_doc_and_text(self, draft: dict):
        doc  = build_document(draft)
        text = _full_text(doc)
        return doc, text

    # --- Revision table ---

    def test_revision_table_has_rev_0_row(self):
        doc, text = self._get_doc_and_text(EMPTY_DRAFT)
        # Revision table must contain "Rev", "0", and "Preliminary"
        assert "Rev" in text
        assert "Preliminary" in text

    def test_revision_table_has_rev_column_header(self):
        doc, _ = self._get_doc_and_text(EMPTY_DRAFT)
        # The revision table header cells must include "Rev"
        found = any(
            "Rev" in cell.text
            for tbl in doc.tables
            for row in tbl.rows
            for cell in row.cells
        )
        assert found

    def test_revision_table_has_date_column(self):
        doc, _ = self._get_doc_and_text(EMPTY_DRAFT)
        found = any(
            "Date" in cell.text
            for tbl in doc.tables
            for row in tbl.rows
            for cell in row.cells
        )
        assert found

    def test_revision_table_has_prepared_by(self):
        doc, _ = self._get_doc_and_text(EMPTY_DRAFT)
        found = any(
            "Prepared" in cell.text
            for tbl in doc.tables
            for row in tbl.rows
            for cell in row.cells
        )
        assert found

    # --- System Description section ---

    def test_system_description_section_present(self):
        doc, text = self._get_doc_and_text(EMPTY_DRAFT)
        assert "System Description" in text

    def test_system_description_mentions_pipeline_segments(self):
        doc, text = self._get_doc_and_text(EMPTY_DRAFT)
        # Must mention suction or discharge segment count
        assert "segment" in text.lower()

    def test_system_description_mentions_static_head(self):
        _, text = self._get_doc_and_text(EMPTY_DRAFT)
        assert "static head" in text.lower() or "30.00" in text

    # --- Appendix C — surge time-series snapshot ---

    def test_appendix_c_present(self):
        _, text = self._get_doc_and_text(full_draft())
        assert "Appendix C" in text

    def test_appendix_c_has_timeseries_data(self):
        doc, _ = self._get_doc_and_text(full_draft())
        # Should have at least one row from the observation history
        found = any(
            "0.000" in cell.text or "38.5" in cell.text
            for tbl in doc.tables
            for row in tbl.rows
            for cell in row.cells
        )
        assert found

    def test_appendix_c_no_data_no_raise(self):
        doc  = build_document(EMPTY_DRAFT)
        data = _doc_to_bytes(doc)
        assert len(data) > 100

    # --- Appendix D — roughness reference ---

    def test_appendix_d_present(self):
        _, text = self._get_doc_and_text(full_draft())
        assert "Appendix D" in text

    def test_appendix_d_contains_roughness_data(self):
        _, text = self._get_doc_and_text(full_draft())
        assert "PVC" in text or "Roughness" in text

    # --- Page numbering ---

    def test_footer_has_page_field(self):
        """Section footer must contain a PAGE fldChar XML element."""
        from docx.oxml.ns import qn as _qn
        doc = build_document(EMPTY_DRAFT)
        found = False
        for section in doc.sections:
            footer = section.footer
            for para in footer.paragraphs:
                xml = para._p.xml
                if "PAGE" in xml or "fldChar" in xml:
                    found = True
        assert found, "No PAGE field found in any section footer"

    # --- Courier New equations ---

    def test_equations_use_courier_new_font(self):
        """At least one run must use Courier New (equation paragraphs)."""
        from docx.oxml.ns import qn as _qn
        doc   = build_document(full_draft())
        found = any(
            run.font.name == "Courier New"
            for para in doc.paragraphs
            for run in para.runs
        )
        assert found, "No Courier New run found — equation styling missing"
