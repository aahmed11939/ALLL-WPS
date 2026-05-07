"""
Tests for the clear well sizing engine and POST /compute/clearwell endpoint.

Run with:
    pytest backend/tests/test_clearwell.py -v
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.engine.clearwell import (
    clearwell_volume_curve,
    cross_section_area_m2,
    cycle_analysis,
    detention_time,
    operating_volume_m3,
    volume_at_level_m3,
)

client = TestClient(app)


# ---------------------------------------------------------------------------
# Helpers — shared request payloads
# ---------------------------------------------------------------------------

CYLINDRICAL_CW = {
    "shape": "cylindrical",
    "diameter_m": 5.0,
}

RECT_CW = {
    "shape": "rectangular",
    "length_m": 6.0,
    "width_m": 4.0,
}

LEVELS = {
    "LLL_m": 0.3,
    "LWL_m": 0.8,
    "HWL_m": 2.5,
    "HHL_m": 3.0,
}

CONSTANT_INFLOW = {
    "type": "constant",
    "Q_in_m3h": 36.0,
}

MINIMAL_CW_REQUEST = {
    "active": True,
    "geometry": CYLINDRICAL_CW,
    "levels": LEVELS,
    "pump_stages": [{"stage": 1, "Q_pump_m3h": 72.0, "label": "Duty"}],
    "inflow": CONSTANT_INFLOW,
    "max_cycles_per_hour": 6,
    "required_detention_min": 0.0,
}


# ---------------------------------------------------------------------------
# Engine unit tests: cross_section_area_m2
# ---------------------------------------------------------------------------


class TestCrossSectionArea:
    def test_cylindrical_area(self):
        area = cross_section_area_m2("cylindrical", diameter_m=4.0, length_m=None, width_m=None)
        assert area == pytest.approx(math.pi / 4.0 * 16.0, rel=1e-9)

    def test_rectangular_area(self):
        area = cross_section_area_m2("rectangular", diameter_m=None, length_m=6.0, width_m=4.0)
        assert area == pytest.approx(24.0, rel=1e-9)

    def test_cylindrical_missing_diameter_raises(self):
        with pytest.raises(ValueError, match="diameter_m"):
            cross_section_area_m2("cylindrical", diameter_m=None, length_m=None, width_m=None)

    def test_rectangular_missing_width_raises(self):
        with pytest.raises(ValueError, match="width_m"):
            cross_section_area_m2("rectangular", diameter_m=None, length_m=6.0, width_m=None)

    def test_unknown_geometry_raises(self):
        with pytest.raises(ValueError, match="Unknown geometry"):
            cross_section_area_m2("triangular", diameter_m=None, length_m=None, width_m=None)


# ---------------------------------------------------------------------------
# Engine unit tests: volume_at_level_m3
# ---------------------------------------------------------------------------


class TestVolumeAtLevel:
    def test_basic_volume(self):
        area = 20.0  # m²
        LLL = 1.0
        vol = volume_at_level_m3(level_m=3.0, LLL_m=LLL, area_m2=area)
        assert vol == pytest.approx(40.0)  # 20 * (3 - 1)

    def test_at_lll_returns_zero(self):
        assert volume_at_level_m3(level_m=1.0, LLL_m=1.0, area_m2=10.0) == pytest.approx(0.0)

    def test_below_lll_returns_zero(self):
        assert volume_at_level_m3(level_m=0.5, LLL_m=1.0, area_m2=10.0) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# Engine unit tests: clearwell_volume_curve
# ---------------------------------------------------------------------------


class TestClearwellVolumeCurve:
    def test_cylindrical_curve_length(self):
        pts = clearwell_volume_curve(
            "cylindrical", LLL_m=0.3, HHL_m=3.0, diameter_m=5.0, n_points=21
        )
        assert len(pts) == 21

    def test_first_point_zero_volume(self):
        pts = clearwell_volume_curve(
            "cylindrical", LLL_m=0.3, HHL_m=3.0, diameter_m=5.0, n_points=11
        )
        assert pts[0]["volume_m3"] == pytest.approx(0.0, abs=1e-6)
        assert pts[0]["depth_m"] == pytest.approx(0.0, abs=1e-6)

    def test_last_point_volume_cylindrical(self):
        D = 5.0
        LLL = 0.3
        HHL = 3.0
        pts = clearwell_volume_curve("cylindrical", LLL_m=LLL, HHL_m=HHL, diameter_m=D, n_points=11)
        expected = math.pi / 4.0 * D**2 * (HHL - LLL)
        assert pts[-1]["volume_m3"] == pytest.approx(expected, rel=1e-4)

    def test_last_point_volume_rectangular(self):
        L, W = 6.0, 4.0
        LLL, HHL = 0.5, 2.5
        pts = clearwell_volume_curve(
            "rectangular", LLL_m=LLL, HHL_m=HHL, length_m=L, width_m=W, n_points=11
        )
        expected = L * W * (HHL - LLL)
        assert pts[-1]["volume_m3"] == pytest.approx(expected, rel=1e-4)

    def test_volume_is_monotonically_increasing(self):
        pts = clearwell_volume_curve("cylindrical", LLL_m=0.0, HHL_m=3.0, diameter_m=4.0, n_points=10)
        volumes = [p["volume_m3"] for p in pts]
        assert all(volumes[i] <= volumes[i + 1] for i in range(len(volumes) - 1))

    def test_n_points_less_than_2_raises(self):
        with pytest.raises(ValueError, match="n_points"):
            clearwell_volume_curve("cylindrical", LLL_m=0.0, HHL_m=3.0, diameter_m=4.0, n_points=1)

    def test_hhl_le_lll_raises(self):
        with pytest.raises(ValueError, match="HHL_m must be strictly greater"):
            clearwell_volume_curve("cylindrical", LLL_m=3.0, HHL_m=1.0, diameter_m=4.0)


# ---------------------------------------------------------------------------
# Engine unit tests: operating_volume_m3
# ---------------------------------------------------------------------------


class TestOperatingVolume:
    def test_cylindrical_operating_volume(self):
        D = 4.0
        LWL, HWL = 1.0, 2.5
        expected = math.pi / 4.0 * D**2 * (HWL - LWL)
        vol = operating_volume_m3("cylindrical", LWL_m=LWL, HWL_m=HWL, diameter_m=D)
        assert vol == pytest.approx(expected, rel=1e-9)

    def test_rectangular_operating_volume(self):
        L, W = 5.0, 3.0
        LWL, HWL = 0.5, 2.0
        expected = L * W * (HWL - LWL)
        vol = operating_volume_m3("rectangular", LWL_m=LWL, HWL_m=HWL, length_m=L, width_m=W)
        assert vol == pytest.approx(expected, rel=1e-9)

    def test_hwl_le_lwl_raises(self):
        with pytest.raises(ValueError, match="HWL_m must be strictly greater"):
            operating_volume_m3("cylindrical", LWL_m=2.5, HWL_m=1.0, diameter_m=4.0)


# ---------------------------------------------------------------------------
# Engine unit tests: cycle_analysis (AWWA M32)
# ---------------------------------------------------------------------------


class TestCycleAnalysis:
    def test_awwa_m32_required_volume(self):
        """V_req = Q_pump [m³/s] × 900 / n_max."""
        Q_pump_m3s = 72.0 / 3600.0  # = 0.02 m³/s
        n_max = 6
        expected_V_req = Q_pump_m3s * 900.0 / n_max
        result = cycle_analysis(Q_pump_m3s, Q_in_m3s=0.005, V_op_m3=20.0, max_cycles_per_hour=n_max)
        assert result["V_req_m3"] == pytest.approx(expected_V_req, rel=1e-6)

    def test_cycles_ok_when_v_op_gte_v_req(self):
        Q_pump_m3s = 0.02
        V_req = Q_pump_m3s * 900.0 / 6
        result = cycle_analysis(Q_pump_m3s, Q_in_m3s=0.01, V_op_m3=V_req * 1.1, max_cycles_per_hour=6)
        assert result["cycles_ok"] is True

    def test_cycles_fail_when_v_op_lt_v_req(self):
        Q_pump_m3s = 0.02
        V_req = Q_pump_m3s * 900.0 / 6
        result = cycle_analysis(Q_pump_m3s, Q_in_m3s=0.01, V_op_m3=V_req * 0.5, max_cycles_per_hour=6)
        assert result["cycles_ok"] is False

    def test_worst_case_q_in_half_q_pump_gives_max_cycles(self):
        """At Q_in = Q_pump/2, cycles/hour is maximised."""
        Q_pump_m3s = 0.02
        V_op = 5.0
        Q_in_half = Q_pump_m3s / 2.0
        result = cycle_analysis(Q_pump_m3s, Q_in_m3s=Q_in_half, V_op_m3=V_op, max_cycles_per_hour=6)
        # Cycle time at Q_in = Q_pump/2 is minimised: T = 4V/Q_pump
        expected_cph = 3600.0 * Q_pump_m3s / (4.0 * V_op)
        assert result["cycles_per_hour"] == pytest.approx(expected_cph, rel=1e-6)

    def test_pump_cannot_drain_flag(self):
        """When Q_pump <= Q_in the pump cannot drain the well."""
        result = cycle_analysis(
            Q_pump_m3s=0.01, Q_in_m3s=0.015, V_op_m3=10.0, max_cycles_per_hour=6
        )
        assert result["pump_can_drain"] is False
        assert result["cycles_per_hour"] == 0.0

    def test_zero_inflow_no_cycling(self):
        result = cycle_analysis(
            Q_pump_m3s=0.02, Q_in_m3s=0.0, V_op_m3=5.0, max_cycles_per_hour=6
        )
        assert result["cycles_per_hour"] == 0.0
        assert result["pump_can_drain"] is True

    def test_cycle_times_positive(self):
        result = cycle_analysis(0.02, 0.005, 5.0, 6)
        assert result["t_fill_s"] > 0
        assert result["t_drain_s"] > 0
        assert result["t_cycle_s"] == pytest.approx(result["t_fill_s"] + result["t_drain_s"], rel=1e-9)

    def test_invalid_q_pump_raises(self):
        with pytest.raises(ValueError, match="Q_pump_m3s"):
            cycle_analysis(Q_pump_m3s=0.0, Q_in_m3s=0.01, V_op_m3=5.0, max_cycles_per_hour=6)

    def test_invalid_v_op_raises(self):
        with pytest.raises(ValueError, match="V_op_m3"):
            cycle_analysis(Q_pump_m3s=0.02, Q_in_m3s=0.01, V_op_m3=0.0, max_cycles_per_hour=6)


# ---------------------------------------------------------------------------
# Engine unit tests: detention_time
# ---------------------------------------------------------------------------


class TestDetentionTime:
    def test_basic_detention(self):
        """t_d = (V_op/2) / Q_in / 60."""
        V_op = 60.0  # m³
        Q_in = 0.01   # m³/s → 36 m³/h
        expected_min = (V_op / 2.0) / Q_in / 60.0
        result = detention_time(V_op, Q_in, required_detention_min=0.0)
        assert result["detention_time_min"] == pytest.approx(expected_min, rel=1e-6)

    def test_detention_ok_when_above_required(self):
        result = detention_time(V_op_m3=120.0, Q_in_m3s=0.01, required_detention_min=1.0)
        assert result["detention_ok"] is True

    def test_detention_fail_when_below_required(self):
        result = detention_time(V_op_m3=1.0, Q_in_m3s=0.1, required_detention_min=60.0)
        assert result["detention_ok"] is False

    def test_zero_inflow_always_ok(self):
        result = detention_time(V_op_m3=10.0, Q_in_m3s=0.0, required_detention_min=30.0)
        assert result["detention_ok"] is True
        assert result["detention_time_min"] is None

    def test_invalid_v_op_raises(self):
        with pytest.raises(ValueError, match="V_op_m3"):
            detention_time(V_op_m3=0.0, Q_in_m3s=0.01, required_detention_min=0.0)


# ---------------------------------------------------------------------------
# HTTP integration tests: POST /compute/clearwell
# ---------------------------------------------------------------------------


class TestComputeClearwellEndpoint:
    def test_active_request_returns_200(self):
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        assert resp.status_code == 200

    def test_response_active_flag_true(self):
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        assert resp.json()["active"] is True

    def test_volume_curve_has_21_points(self):
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        data = resp.json()
        assert len(data["volume_curve"]) == 21

    def test_volume_curve_starts_at_zero(self):
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        first = resp.json()["volume_curve"][0]
        assert first["volume_m3"] == pytest.approx(0.0, abs=1e-4)

    def test_operating_volume_positive(self):
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        assert resp.json()["operating_volume_m3"] > 0

    def test_cycle_results_has_one_entry_for_one_stage(self):
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        assert len(resp.json()["cycle_results"]) == 1

    def test_cycle_result_fields_present(self):
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        cr = resp.json()["cycle_results"][0]
        for field in ["stage", "Q_pump_m3h", "Q_in_m3h", "cycles_per_hour", "V_req_m3", "cycles_ok"]:
            assert field in cr, f"Missing field: {field}"

    def test_response_contains_required_fields(self):
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        data = resp.json()
        for field in [
            "active", "volume_curve", "operating_volume_m3",
            "cycle_results", "detention_time_min", "required_detention_min",
            "detention_ok", "warnings",
        ]:
            assert field in data, f"Missing top-level field: {field}"

    def test_bypass_mode_returns_empty_response(self):
        resp = client.post("/compute/clearwell", json={"active": False})
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is False
        assert data["volume_curve"] == []
        assert data["cycle_results"] == []
        assert data["warnings"] == []
        assert data["operating_volume_m3"] is None

    def test_rectangular_geometry(self):
        req = {
            **MINIMAL_CW_REQUEST,
            "geometry": RECT_CW,
        }
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 200
        data = resp.json()
        # Area = 6×4 = 24 m², depth = HWL - LWL = 1.7 m → V_op ≈ 40.8 m³
        assert data["operating_volume_m3"] == pytest.approx(24.0 * 1.7, rel=1e-3)

    def test_cylindrical_operating_volume_formula(self):
        D = MINIMAL_CW_REQUEST["geometry"]["diameter_m"]
        LWL = LEVELS["LWL_m"]
        HWL = LEVELS["HWL_m"]
        expected = math.pi / 4.0 * D**2 * (HWL - LWL)
        resp = client.post("/compute/clearwell", json=MINIMAL_CW_REQUEST)
        assert resp.json()["operating_volume_m3"] == pytest.approx(expected, rel=1e-4)

    def test_two_pump_stages(self):
        req = {
            **MINIMAL_CW_REQUEST,
            "pump_stages": [
                {"stage": 1, "Q_pump_m3h": 72.0, "label": "Duty"},
                {"stage": 2, "Q_pump_m3h": 144.0, "label": "2× Duty"},
            ],
        }
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 200
        assert len(resp.json()["cycle_results"]) == 2

    def test_hourly_24_inflow(self):
        hourly = [20.0 + i for i in range(24)]  # 20–43 m³/h
        req = {
            **MINIMAL_CW_REQUEST,
            "inflow": {"type": "hourly_24", "hourly_Q_m3h": hourly},
        }
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 200
        assert resp.json()["active"] is True

    def test_detention_time_check_with_requirement(self):
        req = {**MINIMAL_CW_REQUEST, "required_detention_min": 30.0}
        resp = client.post("/compute/clearwell", json=req)
        data = resp.json()
        assert data["required_detention_min"] == 30.0
        assert isinstance(data["detention_ok"], bool)

    def test_warnings_present_when_v_op_too_small(self):
        """A very small diameter should trigger an undersized warning."""
        req = {
            **MINIMAL_CW_REQUEST,
            "geometry": {"shape": "cylindrical", "diameter_m": 0.5},  # tiny tank
            "pump_stages": [{"stage": 1, "Q_pump_m3h": 360.0, "label": "Duty"}],  # large pump
            "max_cycles_per_hour": 6,
        }
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 200
        assert len(resp.json()["warnings"]) > 0

    def test_active_missing_geometry_returns_422(self):
        req = {
            "active": True,
            "levels": LEVELS,
            "pump_stages": [{"stage": 1, "Q_pump_m3h": 72.0}],
            "inflow": CONSTANT_INFLOW,
        }
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 422

    def test_active_missing_levels_returns_422(self):
        req = {
            "active": True,
            "geometry": CYLINDRICAL_CW,
            "pump_stages": [{"stage": 1, "Q_pump_m3h": 72.0}],
            "inflow": CONSTANT_INFLOW,
        }
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 422

    def test_active_empty_stages_returns_422(self):
        req = {
            "active": True,
            "geometry": CYLINDRICAL_CW,
            "levels": LEVELS,
            "pump_stages": [],
            "inflow": CONSTANT_INFLOW,
        }
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 422

    def test_level_ordering_violated_returns_422(self):
        bad_levels = {**LEVELS, "LWL_m": 3.0, "HWL_m": 1.0}  # reversed
        req = {**MINIMAL_CW_REQUEST, "levels": bad_levels}
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 422

    def test_hourly_24_wrong_count_returns_422(self):
        req = {
            **MINIMAL_CW_REQUEST,
            "inflow": {"type": "hourly_24", "hourly_Q_m3h": [10.0] * 12},  # only 12 values
        }
        resp = client.post("/compute/clearwell", json=req)
        assert resp.status_code == 422
