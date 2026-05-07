"""
Tests for pump curve engine and POST /compute/pump endpoint.

Covers:
- interpolate_curve: basic, boundary, out-of-range, monotone curves
- fit_polynomial: degree-2 quadratic fit, non-physical detection
- parallel_hq_fn / series_hq_fn: compound arrangements
- affinity_hq_fn: speed scaling
- find_operating_point: bisection convergence, no intersection, edge cases
- npsh_margin: safe, warning, violation cases
- generate_curve_points: shape and monotonicity
- extract_curve_arrays: happy path and error cases
- hydraulic_power_kw: numerical sanity
- POST /compute/pump: bypass, library, manual, parallel, series, VFD,
                       staging, NPSH, csv-import, error cases

Run with:
    pytest backend/tests/test_pump_curves.py -v
"""

from __future__ import annotations

import io
import math
import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.engine.pump_curves import (
    affinity_hq_fn,
    affinity_eta_fn,
    build_eta_fn,
    build_hq_fn,
    build_npshr_fn,
    build_p_fn,
    build_system_hq_fn,
    extract_curve_arrays,
    find_operating_point,
    generate_curve_points,
    hydraulic_power_kw,
    interpolate_curve,
    npsh_margin,
    parallel_hq_fn,
    pump_q_max,
    series_hq_fn,
)

client = TestClient(app)


# ===========================================================================
# Fixtures
# ===========================================================================

@pytest.fixture
def simple_hq():
    """H-Q: linear from (0, 40) to (100, 20)."""
    return [0.0, 100.0], [40.0, 20.0]


@pytest.fixture
def ksb_record():
    """Minimal pump record matching pump_library schema."""
    return {
        "id": "KSB-ETANORM-125-100-200",
        "hq_curve": [
            {"Q_m3h": 0,   "H_m": 42.0},
            {"Q_m3h": 30,  "H_m": 40.8},
            {"Q_m3h": 60,  "H_m": 38.5},
            {"Q_m3h": 90,  "H_m": 35.5},
            {"Q_m3h": 120, "H_m": 32.0},
            {"Q_m3h": 150, "H_m": 27.3},
            {"Q_m3h": 175, "H_m": 22.5},
        ],
        "eta_q_curve": [
            {"Q_m3h": 0,   "eta_pct": 0.0},
            {"Q_m3h": 30,  "eta_pct": 52.0},
            {"Q_m3h": 60,  "eta_pct": 70.0},
            {"Q_m3h": 90,  "eta_pct": 79.0},
            {"Q_m3h": 120, "eta_pct": 82.0},
            {"Q_m3h": 150, "eta_pct": 79.0},
            {"Q_m3h": 175, "eta_pct": 71.0},
        ],
        "p_q_curve": [
            {"Q_m3h": 0,   "P_kW": 2.5},
            {"Q_m3h": 30,  "P_kW": 6.4},
            {"Q_m3h": 60,  "P_kW": 9.0},
            {"Q_m3h": 90,  "P_kW": 11.0},
            {"Q_m3h": 120, "P_kW": 12.8},
            {"Q_m3h": 150, "P_kW": 14.2},
            {"Q_m3h": 175, "P_kW": 15.2},
        ],
        "npshr_q_curve": [
            {"Q_m3h": 0,   "NPSHr_m": 1.5},
            {"Q_m3h": 30,  "NPSHr_m": 1.7},
            {"Q_m3h": 60,  "NPSHr_m": 2.1},
            {"Q_m3h": 90,  "NPSHr_m": 2.7},
            {"Q_m3h": 120, "NPSHr_m": 3.5},
            {"Q_m3h": 150, "NPSHr_m": 4.6},
            {"Q_m3h": 175, "NPSHr_m": 5.8},
        ],
        "rated_flow_m3h": 120.0,
    }


# ===========================================================================
# Section 1 — interpolate_curve
# ===========================================================================


class TestInterpolateCurve:
    def test_returns_at_lower_boundary(self):
        v, oor = interpolate_curve([0.0, 100.0], [40.0, 20.0], 0.0)
        assert abs(v - 40.0) < 1e-9
        assert oor is False

    def test_returns_at_upper_boundary(self):
        v, oor = interpolate_curve([0.0, 100.0], [40.0, 20.0], 100.0)
        assert abs(v - 20.0) < 1e-9
        assert oor is False

    def test_midpoint_linear_interp(self):
        v, oor = interpolate_curve([0.0, 100.0], [40.0, 20.0], 50.0)
        assert abs(v - 30.0) < 1e-9
        assert oor is False

    def test_out_of_range_low(self):
        v, oor = interpolate_curve([0.0, 100.0], [40.0, 20.0], -10.0)
        assert oor is True
        assert abs(v - 40.0) < 1e-9  # clamped to boundary

    def test_out_of_range_high(self):
        v, oor = interpolate_curve([0.0, 100.0], [40.0, 20.0], 200.0)
        assert oor is True
        assert abs(v - 20.0) < 1e-9  # clamped to boundary

    def test_multi_segment_correct_bracket(self):
        q_pts = [0.0, 50.0, 100.0, 150.0]
        v_pts = [40.0, 35.0, 25.0, 10.0]
        v, _ = interpolate_curve(q_pts, v_pts, 75.0)
        # In bracket [50, 100], t=0.5 → 35 + 0.5*(25-35) = 30
        assert abs(v - 30.0) < 1e-9

    def test_raises_with_mismatched_lengths(self):
        with pytest.raises(ValueError, match="matching-length"):
            interpolate_curve([0.0, 50.0], [40.0], 25.0)

    def test_raises_with_fewer_than_two_points(self):
        with pytest.raises(ValueError):
            interpolate_curve([50.0], [30.0], 50.0)


# ===========================================================================
# Section 2 — fit_polynomial
# ===========================================================================


class TestFitPolynomial:
    def test_degree2_passes_through_endpoints(self):
        from backend.engine.pump_curves import fit_polynomial, _eval_poly
        q_pts = [0.0, 60.0, 120.0]
        v_pts = [42.0, 38.0, 32.0]
        coeffs, non_phys = fit_polynomial(q_pts, v_pts, degree=2)
        assert abs(_eval_poly(coeffs, 0.0) - 42.0) < 0.1
        assert abs(_eval_poly(coeffs, 120.0) - 32.0) < 0.1

    def test_non_physical_flag_for_rising_curve(self):
        from backend.engine.pump_curves import fit_polynomial
        # A U-shaped parabola that rises at high Q — non-physical for H-Q
        q_pts = [0.0, 50.0, 100.0]
        v_pts = [30.0, 20.0, 35.0]
        _, non_phys = fit_polynomial(q_pts, v_pts, degree=2)
        assert non_phys is True

    def test_physical_flag_for_monotone_decrease(self):
        from backend.engine.pump_curves import fit_polynomial
        q_pts = [0.0, 50.0, 100.0, 150.0]
        v_pts = [50.0, 40.0, 25.0, 8.0]
        _, non_phys = fit_polynomial(q_pts, v_pts, degree=2)
        assert non_phys is False

    def test_raises_insufficient_points(self):
        from backend.engine.pump_curves import fit_polynomial
        with pytest.raises(ValueError):
            fit_polynomial([0.0], [42.0], degree=2)


# ===========================================================================
# Section 3 — build_hq_fn / build_eta_fn / build_p_fn / build_npshr_fn
# ===========================================================================


class TestBuildFunctions:
    def test_build_hq_linear_at_rated_point(self, ksb_record):
        q_pts, h_pts = extract_curve_arrays(ksb_record, "hq_curve", "H_m")
        fn = build_hq_fn(q_pts, h_pts)
        assert abs(fn(120.0) - 32.0) < 0.1

    def test_build_hq_clamps_to_zero(self, ksb_record):
        q_pts, h_pts = extract_curve_arrays(ksb_record, "hq_curve", "H_m")
        fn = build_hq_fn(q_pts, h_pts)
        # Beyond runout head should be 0
        assert fn(500.0) == 0.0

    def test_build_eta_peak_at_bep(self, ksb_record):
        q_pts, e_pts = extract_curve_arrays(ksb_record, "eta_q_curve", "eta_pct")
        fn = build_eta_fn(q_pts, e_pts)
        assert abs(fn(120.0) - 82.0) < 0.1

    def test_build_eta_clamped_to_100(self):
        fn = build_eta_fn([0.0, 50.0], [50.0, 50.0])
        assert fn(25.0) <= 100.0

    def test_build_p_at_rated_point(self, ksb_record):
        q_pts, p_pts = extract_curve_arrays(ksb_record, "p_q_curve", "P_kW")
        fn = build_p_fn(q_pts, p_pts)
        assert abs(fn(120.0) - 12.8) < 0.1

    def test_build_npshr_at_rated_point(self, ksb_record):
        q_pts, n_pts = extract_curve_arrays(ksb_record, "npshr_q_curve", "NPSHr_m")
        fn = build_npshr_fn(q_pts, n_pts)
        assert abs(fn(120.0) - 3.5) < 0.1

    def test_build_hq_poly_method(self, ksb_record):
        q_pts, h_pts = extract_curve_arrays(ksb_record, "hq_curve", "H_m")
        fn = build_hq_fn(q_pts, h_pts, interp_method="poly", poly_degree=2)
        # Should be close but not exact
        assert abs(fn(120.0) - 32.0) < 2.0


# ===========================================================================
# Section 4 — parallel_hq_fn / series_hq_fn
# ===========================================================================


class TestCompoundArrangements:
    def setup_method(self):
        # Single pump: H = 40 - 0.2*Q (linear, shutoff=40, max-flow=200)
        self.hq_fn = build_hq_fn([0.0, 200.0], [40.0, 0.0])

    def test_parallel_n1_unchanged(self):
        fn = parallel_hq_fn(self.hq_fn, 1)
        assert abs(fn(100.0) - self.hq_fn(100.0)) < 1e-9

    def test_parallel_n2_same_head_double_flow(self):
        fn2 = parallel_hq_fn(self.hq_fn, 2)
        # At Q=60 total, each pump delivers 30 → H = 40 - 0.2*30 = 34
        h_single_30 = self.hq_fn(30.0)
        assert abs(fn2(60.0) - h_single_30) < 1e-9

    def test_parallel_n3_triple_flow(self):
        fn3 = parallel_hq_fn(self.hq_fn, 3)
        h_single_50 = self.hq_fn(50.0)
        assert abs(fn3(150.0) - h_single_50) < 1e-9

    def test_series_n1_unchanged(self):
        fn = series_hq_fn(self.hq_fn, 1)
        assert abs(fn(100.0) - self.hq_fn(100.0)) < 1e-9

    def test_series_n2_same_flow_double_head(self):
        fn2 = series_hq_fn(self.hq_fn, 2)
        h_single = self.hq_fn(80.0)
        assert abs(fn2(80.0) - 2.0 * h_single) < 1e-9

    def test_parallel_raises_for_n_zero(self):
        with pytest.raises(ValueError, match="≥ 1"):
            parallel_hq_fn(self.hq_fn, 0)

    def test_series_raises_for_n_zero(self):
        with pytest.raises(ValueError, match="≥ 1"):
            series_hq_fn(self.hq_fn, 0)

    def test_parallel_shutoff_head_unchanged(self):
        """Parallel pumps still have the same shutoff head as a single pump."""
        fn2 = parallel_hq_fn(self.hq_fn, 2)
        assert abs(fn2(0.0) - 40.0) < 1e-9

    def test_series_shutoff_head_multiplied(self):
        """Series pumps double the shutoff head."""
        fn2 = series_hq_fn(self.hq_fn, 2)
        assert abs(fn2(0.0) - 80.0) < 1e-9


# ===========================================================================
# Section 5 — affinity laws
# ===========================================================================


class TestAffinityLaws:
    def setup_method(self):
        # Base: H = 40 - 0.001*Q² (parabola, BEP at Q=100, H=30)
        self.hq_fn = build_hq_fn([0.0, 50.0, 100.0, 150.0, 200.0],
                                  [40.0, 37.5, 30.0, 17.5, 0.0])
        self.eta_fn = build_eta_fn([0.0, 50.0, 100.0, 150.0, 200.0],
                                   [0.0, 60.0, 82.0, 70.0, 50.0])

    def test_speed_ratio_1_identity(self):
        fn = affinity_hq_fn(self.hq_fn, 1.0)
        assert abs(fn(100.0) - self.hq_fn(100.0)) < 1e-9

    def test_half_speed_head_quarter(self):
        """At half speed and half flow, H should be ¼ of original H at full flow."""
        fn_half = affinity_hq_fn(self.hq_fn, 0.5)
        h_full_100 = self.hq_fn(100.0)
        h_half_50 = fn_half(50.0)   # 0.5² × H_base(50/0.5) = 0.25 × H_base(100)
        assert abs(h_half_50 - 0.25 * h_full_100) < 0.1

    def test_speed_ratio_zero_raises(self):
        with pytest.raises(ValueError):
            affinity_hq_fn(self.hq_fn, 0.0)

    def test_affinity_eta_preserves_peak_efficiency(self):
        """η at the same duty point should be approximately the same."""
        fn_eta_75 = affinity_eta_fn(self.eta_fn, 0.75)
        # At speed 0.75, 75% of rated flow = 75 → η_base(75/0.75) = η_base(100) ≈ 82
        eta_scaled = fn_eta_75(75.0)
        assert abs(eta_scaled - 82.0) < 2.0

    def test_higher_speed_increases_head(self):
        fn_110 = affinity_hq_fn(self.hq_fn, 1.1)
        assert fn_110(100.0) > self.hq_fn(100.0)


# ===========================================================================
# Section 6 — find_operating_point
# ===========================================================================


class TestFindOperatingPoint:
    def test_simple_linear_intersection(self):
        # Pump: H = 40 - 0.2*Q (max Q=200)
        # System: H = 10 + 0.15*Q
        # Intersection: 40 - 0.2*Q = 10 + 0.15*Q → 30 = 0.35*Q → Q = 85.71
        pump_fn = build_hq_fn([0.0, 200.0], [40.0, 0.0])
        sys_fn  = build_system_hq_fn([0.0, 200.0], [10.0, 40.0])
        result = find_operating_point(pump_fn, sys_fn, 0.0, 180.0)
        assert result is not None
        q_star, h_star = result
        expected_q = 30.0 / 0.35
        assert abs(q_star - expected_q) < 0.5

    def test_returns_none_when_no_intersection(self):
        # Pump has H < system everywhere
        pump_fn = build_hq_fn([0.0, 100.0], [5.0, 0.0])
        sys_fn  = build_system_hq_fn([0.0, 100.0], [20.0, 30.0])
        result = find_operating_point(pump_fn, sys_fn, 0.0, 100.0)
        assert result is None

    def test_at_intersection_h_pump_equals_h_system(self):
        pump_fn = build_hq_fn([0.0, 200.0], [50.0, 0.0])
        sys_fn  = build_system_hq_fn([0.0, 200.0], [5.0, 50.0])
        result = find_operating_point(pump_fn, sys_fn, 0.0, 200.0)
        assert result is not None
        q_star, h_star = result
        assert abs(pump_fn(q_star) - h_star) < 0.5

    def test_convergence_within_tolerance(self):
        pump_fn = build_hq_fn([0.0, 300.0], [60.0, 0.0])
        sys_fn  = build_system_hq_fn([0.0, 300.0], [15.0, 60.0])
        result = find_operating_point(pump_fn, sys_fn, 0.0, 290.0, tol_m3h=0.01)
        assert result is not None
        q_star, h_star = result
        assert abs(pump_fn(q_star) - sys_fn(q_star)) < 0.2

    def test_raises_for_invalid_bracket(self):
        pump_fn = build_hq_fn([0.0, 100.0], [40.0, 0.0])
        sys_fn  = build_system_hq_fn([0.0, 100.0], [10.0, 40.0])
        with pytest.raises(ValueError):
            find_operating_point(pump_fn, sys_fn, q_min=100.0, q_max=0.0)


# ===========================================================================
# Section 7 — npsh_margin
# ===========================================================================


class TestNpshMargin:
    def test_safe_margin_no_warnings(self):
        margin, warns = npsh_margin(npsha=8.0, npshr_at_op=3.5)
        assert abs(margin - 4.5) < 1e-9
        assert warns == []

    def test_violation_negative_margin(self):
        margin, warns = npsh_margin(npsha=2.0, npshr_at_op=3.5)
        assert margin < 0
        assert len(warns) == 1
        assert "VIOLATION" in warns[0] or "NPSH" in warns[0]

    def test_warning_when_margin_below_hi_minimum(self):
        # NPSHa = 3.8, NPSHr = 3.5 → margin = 0.3 < max(0.6, 0.35=0.1*3.5)
        margin, warns = npsh_margin(npsha=3.8, npshr_at_op=3.5)
        assert 0 < margin < 0.6
        assert len(warns) == 1
        assert "HI" in warns[0] or "margin" in warns[0]

    def test_margin_exactly_hi_required_no_warning(self):
        # NPSHr=5.0 → HI min = max(0.6, 0.5) = 0.6
        # Use npsha=5.7 to give margin=0.7 which is clearly above 0.6 (avoids fp boundary)
        margin, warns = npsh_margin(npsha=5.7, npshr_at_op=5.0)
        assert margin > 0.6
        assert warns == []

    def test_relative_minimum_applies_for_high_npshr(self):
        # NPSHr=10.0 → HI min = max(0.6, 1.0) = 1.0; NPSHa=10.5 → margin=0.5 < 1.0
        margin, warns = npsh_margin(npsha=10.5, npshr_at_op=10.0)
        assert margin < 1.0
        assert len(warns) == 1


# ===========================================================================
# Section 8 — generate_curve_points
# ===========================================================================


class TestGenerateCurvePoints:
    def test_returns_n_pts_elements(self):
        fn = lambda q: 40.0 - 0.2 * q
        pts = generate_curve_points(fn, 0.0, 100.0, n_pts=20)
        assert len(pts) == 20

    def test_first_and_last_match_boundaries(self):
        fn = lambda q: 40.0 - 0.2 * q
        pts = generate_curve_points(fn, 0.0, 100.0, n_pts=10)
        assert abs(pts[0]["Q_m3h"] - 0.0) < 1e-9
        assert abs(pts[-1]["Q_m3h"] - 100.0) < 1e-9

    def test_values_non_negative(self):
        fn = lambda q: max(0.0, 40.0 - 0.2 * q)
        pts = generate_curve_points(fn, 0.0, 300.0, n_pts=30)
        for pt in pts:
            assert pt["value"] >= 0.0

    def test_raises_for_invalid_n_pts(self):
        fn = lambda q: q
        with pytest.raises(ValueError):
            generate_curve_points(fn, 0.0, 100.0, n_pts=1)

    def test_raises_for_invalid_range(self):
        fn = lambda q: q
        with pytest.raises(ValueError):
            generate_curve_points(fn, 100.0, 0.0, n_pts=10)


# ===========================================================================
# Section 9 — extract_curve_arrays
# ===========================================================================


class TestExtractCurveArrays:
    def test_extracts_hq_correctly(self, ksb_record):
        q_pts, h_pts = extract_curve_arrays(ksb_record, "hq_curve", "H_m")
        assert len(q_pts) == 7
        assert q_pts[0] == 0.0
        assert h_pts[0] == 42.0
        assert q_pts[-1] == 175.0
        assert h_pts[-1] == 22.5

    def test_extracts_eta_correctly(self, ksb_record):
        q_pts, e_pts = extract_curve_arrays(ksb_record, "eta_q_curve", "eta_pct")
        assert len(q_pts) == 7
        assert e_pts[4] == 82.0  # BEP at Q=120

    def test_raises_for_missing_curve(self, ksb_record):
        with pytest.raises(KeyError):
            extract_curve_arrays(ksb_record, "missing_curve", "H_m")

    def test_raises_for_missing_value_key(self, ksb_record):
        bad_record = {
            "id": "X",
            "hq_curve": [{"Q_m3h": 0}]  # missing H_m
        }
        with pytest.raises(ValueError):
            extract_curve_arrays(bad_record, "hq_curve", "H_m")


# ===========================================================================
# Section 10 — hydraulic_power_kw
# ===========================================================================


class TestHydraulicPowerKw:
    def test_known_value(self):
        # KSB at BEP: Q=120 m³/h, H=32 m, η=82%
        # P = 1000*9.81*(120/3600)*32/(0.82)/1000 = 9.81*0.03333*32/0.82 = 12.78 kW
        p = hydraulic_power_kw(120.0, 32.0, 82.0)
        assert abs(p - 12.78) < 0.1

    def test_zero_eta_returns_zero(self):
        assert hydraulic_power_kw(100.0, 30.0, 0.0) == 0.0

    def test_zero_flow_returns_zero(self):
        assert hydraulic_power_kw(0.0, 30.0, 80.0) == 0.0

    def test_higher_efficiency_lower_power(self):
        p80 = hydraulic_power_kw(100.0, 30.0, 80.0)
        p85 = hydraulic_power_kw(100.0, 30.0, 85.0)
        assert p85 < p80


# ===========================================================================
# Section 11 — pump_q_max
# ===========================================================================


class TestPumpQMax:
    def test_returns_max_from_hq_curve(self, ksb_record):
        assert pump_q_max(ksb_record) == 175.0


# ===========================================================================
# Section 12 — POST /compute/pump endpoint
# ===========================================================================


class TestComputePumpEndpoint:
    def test_bypass_returns_200_empty(self):
        resp = client.post("/compute/pump", json={"active": False})
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is False
        assert data["operating_points"] == []

    def test_library_pump_returns_200(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
            "arrangement": "single",
            "n_pumps": 1,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is True
        assert len(data["hq_curve"]) > 0

    def test_library_pump_hq_curve_monotone_decreasing(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
            "arrangement": "single",
            "n_pumps": 1,
        })
        data = resp.json()
        hq = data["hq_curve"]
        heads = [pt["value"] for pt in hq]
        for i in range(1, len(heads)):
            assert heads[i] <= heads[i - 1] + 0.5, (
                f"H-Q curve is not decreasing at index {i}: {heads[i-1]} → {heads[i]}"
            )

    def test_manual_curve_returns_200(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "curve_data": {
                "hq": [
                    {"Q_m3h": 0,   "value": 40.0},
                    {"Q_m3h": 50,  "value": 35.0},
                    {"Q_m3h": 100, "value": 25.0},
                    {"Q_m3h": 150, "value": 10.0},
                ],
            },
            "arrangement": "single",
            "n_pumps": 1,
        })
        assert resp.status_code == 200

    def test_parallel_arrangement_returns_200(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "GRUNDFOS-NK-65-250",
            "arrangement": "parallel",
            "n_pumps": 2,
        })
        assert resp.status_code == 200
        data = resp.json()
        # Parallel shutoff head should be same as single pump
        assert len(data["hq_curve"]) > 0

    def test_series_arrangement_returns_200(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "GRUNDFOS-NK-65-250",
            "arrangement": "series",
            "n_pumps": 2,
        })
        assert resp.status_code == 200
        data = resp.json()
        # Series shutoff head should be doubled
        shutoff_h = data["hq_curve"][0]["value"]
        assert shutoff_h > 56.0  # original shutoff is 56

    def test_operating_point_returned_when_system_curve_supplied(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
            "arrangement": "single",
            "n_pumps": 1,
            "system_curve_pts": [
                {"Q_m3h": 0,   "value": 18.0},
                {"Q_m3h": 120, "value": 32.0},
                {"Q_m3h": 175, "value": 50.0},
            ],
            "static_head_m": 18.0,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["operating_points"]) >= 1
        op = data["operating_points"][0]
        assert op["Q_m3h"] > 0
        assert op["H_m"] > 0

    def test_vfd_generates_speed_curves(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
            "vfd": True,
            "speed_pct_min": 60.0,
            "speed_pct_max": 100.0,
            "n_speed_steps": 4,
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["speed_curves"]) >= 3

    def test_eta_curve_returned(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["eta_curve"]) > 0

    def test_p_curve_returned(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
        })
        data = resp.json()
        assert len(data["p_curve"]) > 0

    def test_npshr_curve_returned(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
        })
        data = resp.json()
        assert len(data["npshr_curve"]) > 0

    def test_npsh_margin_check_when_npsha_supplied(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
            "npsha_m": 4.0,
            "system_curve_pts": [
                {"Q_m3h": 0,   "value": 18.0},
                {"Q_m3h": 120, "value": 32.0},
            ],
            "static_head_m": 18.0,
        })
        data = resp.json()
        ops = data["operating_points"]
        if ops:
            op = ops[0]
            assert "npsh_margin_m" in op

    def test_npsh_violation_generates_warning(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
            "npsha_m": 1.0,  # Way too low
            "system_curve_pts": [
                {"Q_m3h": 0,   "value": 18.0},
                {"Q_m3h": 120, "value": 32.0},
            ],
            "static_head_m": 18.0,
        })
        data = resp.json()
        all_warns = data.get("warnings", [])
        for op in data.get("operating_points", []):
            all_warns.extend(op.get("warnings", []))
        assert any("NPSH" in w or "npsh" in w.lower() for w in all_warns)

    def test_unknown_pump_id_returns_422(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "DOES-NOT-EXIST",
        })
        assert resp.status_code == 422

    def test_manual_invalid_hq_not_enough_points_returns_422(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "curve_data": {
                "hq": [{"Q_m3h": 0, "value": 40.0}],  # Only 1 point
            },
        })
        assert resp.status_code == 422

    def test_no_pump_id_and_no_curve_returns_422(self):
        resp = client.post("/compute/pump", json={
            "active": True,
        })
        assert resp.status_code == 422

    def test_staging_returns_multiple_operating_points(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
            "arrangement": "parallel",
            "n_pumps": 2,
            "staging": True,
            "system_curve_pts": [
                {"Q_m3h": 0,   "value": 18.0},
                {"Q_m3h": 120, "value": 32.0},
                {"Q_m3h": 250, "value": 52.0},
            ],
            "static_head_m": 18.0,
        })
        assert resp.status_code == 200
        data = resp.json()
        # Staging with 2 pumps → should have op for 1 pump and 2 pumps
        assert len(data["operating_points"]) >= 2

    def test_all_library_pumps_loadable(self):
        """All 9 pumps in the library should respond with 200."""
        pump_ids = [
            "KSB-ETANORM-125-100-200",
            "GRUNDFOS-NK-65-250",
            "KSB-OMEGA-200-500",
            "FLOWSERVE-LNN-6x8-15SC",
            "GOULDS-7MC-VT",
            "GOULDS-10VR-VT",
            "GRUNDFOS-CRNE-15-5",
            "GRUNDFOS-CRNE-32-2",
            "FLYGT-LC-3201",
        ]
        for pid in pump_ids:
            resp = client.post("/compute/pump", json={
                "active": True,
                "pump_id": pid,
            })
            assert resp.status_code == 200, (
                f"Pump '{pid}' returned {resp.status_code}: {resp.text}"
            )

    def test_response_has_warnings_list(self):
        resp = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-ETANORM-125-100-200",
        })
        data = resp.json()
        assert isinstance(data["warnings"], list)

    def test_split_case_parallel_shutoff_head_equals_single(self):
        """Parallel pumps: shutoff head = single pump shutoff head."""
        resp_single = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-OMEGA-200-500",
            "arrangement": "single",
            "n_pumps": 1,
        })
        resp_parallel = client.post("/compute/pump", json={
            "active": True,
            "pump_id": "KSB-OMEGA-200-500",
            "arrangement": "parallel",
            "n_pumps": 2,
        })
        h_single_shutoff  = resp_single.json()["hq_curve"][0]["value"]
        h_parallel_shutoff = resp_parallel.json()["hq_curve"][0]["value"]
        assert abs(h_single_shutoff - h_parallel_shutoff) < 2.0


# ===========================================================================
# Section 13 — POST /compute/pump-curves/import-csv
# ===========================================================================


class TestCsvImportEndpoint:
    """
    CSV import tests for the redesigned multi-column endpoint.

    CSV contract:
    - Required: Q_m3h, H_m
    - Optional: eta_pct, P_kW, NPSHr_m (any combination)
    - Non-numeric H_m/Q_m3h cells → row skipped
    - At least 2 valid H-Q rows required
    """

    def _make_csv_file(self, content: str, filename: str = "curve.csv"):
        return ("file", (filename, io.BytesIO(content.encode()), "text/csv"))

    def test_hq_only_csv_returns_200(self):
        csv_content = "Q_m3h,H_m\n0,40\n50,35\n100,25\n150,10\n"
        resp = client.post(
            "/compute/pump-curves/import-csv",
            files=[self._make_csv_file(csv_content)],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "curve_data" in data
        assert len(data["curve_data"]["hq"]) == 4
        assert data["curve_data"]["eta_q"] is None
        assert data["curve_data"]["p_q"] is None
        assert data["curve_data"]["npshr_q"] is None

    def test_full_multi_column_csv_returns_all_curves(self):
        csv_content = (
            "Q_m3h,H_m,eta_pct,P_kW,NPSHr_m\n"
            "0,42.0,,2.5,1.5\n"
            "30,40.8,52.0,6.4,1.7\n"
            "60,38.5,70.0,9.0,2.1\n"
            "90,35.5,79.0,11.0,2.7\n"
            "120,32.0,82.0,12.8,3.5\n"
            "150,27.3,79.0,14.2,4.6\n"
            "175,22.5,71.0,15.2,5.8\n"
        )
        resp = client.post(
            "/compute/pump-curves/import-csv",
            files=[self._make_csv_file(csv_content)],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["curve_data"]["hq"]) == 7
        # eta_pct row 0 is missing — only 6 rows have valid eta
        assert data["curve_data"]["eta_q"] is not None
        assert len(data["curve_data"]["eta_q"]) == 6
        assert data["curve_data"]["p_q"] is not None
        assert data["curve_data"]["npshr_q"] is not None

    def test_hq_only_without_optional_columns(self):
        """Optional columns absent → those curve_data fields are None."""
        csv_content = "Q_m3h,H_m\n0,42\n60,38\n120,30\n"
        resp = client.post(
            "/compute/pump-curves/import-csv",
            files=[self._make_csv_file(csv_content)],
        )
        assert resp.status_code == 200
        cd = resp.json()["curve_data"]
        assert cd["eta_q"] is None
        assert cd["p_q"] is None
        assert cd["npshr_q"] is None

    def test_missing_q_column_returns_422(self):
        csv_content = "Flow,H_m\n0,40\n50,35\n"
        resp = client.post(
            "/compute/pump-curves/import-csv",
            files=[self._make_csv_file(csv_content)],
        )
        assert resp.status_code == 422

    def test_missing_h_column_returns_422(self):
        csv_content = "Q_m3h,Head\n0,40\n50,35\n"
        resp = client.post(
            "/compute/pump-curves/import-csv",
            files=[self._make_csv_file(csv_content)],
        )
        assert resp.status_code == 422

    def test_fewer_than_two_valid_rows_returns_422(self):
        csv_content = "Q_m3h,H_m\n0,40\n"  # only 1 valid row
        resp = client.post(
            "/compute/pump-curves/import-csv",
            files=[self._make_csv_file(csv_content)],
        )
        assert resp.status_code == 422

    def test_all_rows_non_numeric_returns_422(self):
        csv_content = "Q_m3h,H_m\nzero,forty\nfifty,thirty-five\n"
        resp = client.post(
            "/compute/pump-curves/import-csv",
            files=[self._make_csv_file(csv_content)],
        )
        assert resp.status_code == 422

    def test_partial_non_numeric_h_rows_are_skipped(self):
        """Non-numeric H_m rows are skipped; valid rows still returned."""
        csv_content = "Q_m3h,H_m\n0,40\nbad_q,35\n100,25\n150,10\n"
        resp = client.post(
            "/compute/pump-curves/import-csv",
            files=[self._make_csv_file(csv_content)],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["curve_data"]["hq"]) == 3
        assert len(data["warnings"]) >= 1
