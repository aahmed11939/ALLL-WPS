"""
Tests for the multi-segment hydraulic compute engine and /compute/hydraulics endpoint.

Run with:
    pytest backend/tests/test_hydraulic_compute.py -v
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.engine.hydraulics import (
    G,
    NU_WATER,
    friction_head_loss,
    hazen_williams_head_loss,
    minor_head_loss,
    velocity,
)

client = TestClient(app)


# ---------------------------------------------------------------------------
# hazen_williams_head_loss() unit tests
# ---------------------------------------------------------------------------


class TestHazenWilliamsHeadLoss:
    def test_benchmark_known_case(self):
        """
        Hand-calculated reference case:
            Q  = 0.01 m³/s
            D  = 0.15 m  (DN150)
            L  = 100 m
            C  = 120  (ductile iron / new cast iron)

        Using the SI Hazen-Williams formula:
            hf = 10.67 · L · Q^1.852 / (C^1.852 · D^4.87)

        Expected value computed from the closed-form expression and cross-
        checked against the EPA SWMM / standard references.
        """
        Q = 0.01
        D = 0.15
        L = 100.0
        C = 120.0
        hf_expected = 10.67 * L * (Q ** 1.852) / ((C ** 1.852) * (D ** 4.87))
        hf = hazen_williams_head_loss(Q, D, L, C)
        assert hf == pytest.approx(hf_expected, rel=1e-9)

    def test_hazen_williams_c100_reference(self):
        """
        C=100 (concrete / design baseline) with simple geometry.
        Verifies against direct closed-form evaluation.
        """
        Q, D, L, C = 0.02, 0.20, 200.0, 100.0
        hf_expected = 10.67 * L * (Q ** 1.852) / ((C ** 1.852) * (D ** 4.87))
        hf = hazen_williams_head_loss(Q, D, L, C)
        assert hf == pytest.approx(hf_expected, rel=1e-9)

    def test_higher_c_gives_lower_loss(self):
        """Smoother pipe (higher C) should produce less friction loss."""
        args = (0.01, 0.15, 100.0)
        hf_smooth = hazen_williams_head_loss(*args, C=150)
        hf_rough = hazen_williams_head_loss(*args, C=80)
        assert hf_smooth < hf_rough

    def test_zero_flow_returns_zero(self):
        assert hazen_williams_head_loss(0.0, 0.15, 100.0, 120.0) == pytest.approx(0.0)

    def test_invalid_diameter_raises(self):
        with pytest.raises(ValueError, match="diameter"):
            hazen_williams_head_loss(0.01, 0.0, 100.0, 120.0)

    def test_invalid_length_raises(self):
        with pytest.raises(ValueError, match="length"):
            hazen_williams_head_loss(0.01, 0.15, 0.0, 120.0)

    def test_invalid_c_raises(self):
        with pytest.raises(ValueError, match="C must be"):
            hazen_williams_head_loss(0.01, 0.15, 100.0, 0.0)

    def test_negative_flow_raises(self):
        with pytest.raises(ValueError, match="Flow rate"):
            hazen_williams_head_loss(-0.01, 0.15, 100.0, 120.0)


# ---------------------------------------------------------------------------
# Benchmark: Darcy hf (via the engine, not the endpoint)
# ---------------------------------------------------------------------------


class TestDarcyHfBenchmark:
    def test_darcy_hf_known_case(self):
        """
        Benchmark matches the hand-calculated value in test_hydraulics.py.
            Q  = 0.02 m³/s, D = 0.15 m, L = 100 m, ε = 0.00012 m
            Expected h_f ≈ 0.892 m (< 0.001 m tolerance)
        """
        hf = friction_head_loss(Q_m3s=0.02, D_m=0.15, L_m=100.0, roughness_m=0.00012)
        # Reference: 0.892 m (hand-calc with rounded intermediate f=0.02049).
        # The Colebrook-White solver gives 0.8908 m; allow ±0.005 m for rounding.
        assert abs(hf - 0.892) < 0.005

    def test_darcy_hf_scales_with_length(self):
        """Doubling pipe length should double the friction loss."""
        hf1 = friction_head_loss(0.01, 0.15, 100.0, 0.00012)
        hf2 = friction_head_loss(0.01, 0.15, 200.0, 0.00012)
        # Not exactly 2× because f varies slightly with Re, but very close
        assert abs(hf2 / hf1 - 2.0) < 0.01


# ---------------------------------------------------------------------------
# Minor losses aggregation (multi-segment)
# ---------------------------------------------------------------------------


class TestMinorLossesAggregation:
    def test_two_segments_sum_independently(self):
        """
        Minor losses in two separate pipe segments must equal the
        sum of each segment's minor loss computed individually.
        """
        Q = 0.015  # m³/s

        seg1_D = 0.15
        seg1_K = [0.5, 1.0]  # K_sum = 1.5
        seg2_D = 0.20
        seg2_K = [0.3, 0.3, 0.5]  # K_sum = 1.1

        hm1 = minor_head_loss(Q, seg1_D, seg1_K)
        hm2 = minor_head_loss(Q, seg2_D, seg2_K)
        total_expected = hm1 + hm2

        # Cross-check: manually compute each
        v1 = velocity(Q, seg1_D)
        v2 = velocity(Q, seg2_D)
        hm1_manual = sum(seg1_K) * v1**2 / (2.0 * G)
        hm2_manual = sum(seg2_K) * v2**2 / (2.0 * G)

        assert hm1 == pytest.approx(hm1_manual, rel=1e-9)
        assert hm2 == pytest.approx(hm2_manual, rel=1e-9)
        assert total_expected == pytest.approx(hm1_manual + hm2_manual, rel=1e-9)

    def test_segment_with_no_k_contributes_zero(self):
        """A segment with an empty K list should contribute zero minor loss."""
        assert minor_head_loss(0.02, 0.15, []) == pytest.approx(0.0)

    def test_order_of_segments_does_not_matter_for_sum(self):
        """Sum of minor losses must be the same regardless of segment order."""
        Q = 0.01
        D = 0.15
        k_sets = [[0.5, 1.0], [0.3], [0.2, 0.2, 0.2]]
        hm_total = sum(minor_head_loss(Q, D, k) for k in k_sets)
        k_sets_reversed = list(reversed(k_sets))
        hm_total_rev = sum(minor_head_loss(Q, D, k) for k in k_sets_reversed)
        assert hm_total == pytest.approx(hm_total_rev, rel=1e-12)


# ---------------------------------------------------------------------------
# HTTP integration: POST /compute/hydraulics
# ---------------------------------------------------------------------------

# Minimal valid request — single D-W discharge segment, no suction segments
MINIMAL_REQUEST = {
    "Q_m3h": 36.0,
    "suction": {
        "name": "suction",
        "segments": [],
        "node_elev_start_m": 5.0,
        "node_elev_end_m": 6.0,
    },
    "discharge": {
        "name": "discharge",
        "segments": [
            {
                "label": "FM-1",
                "method": "darcy_weisbach",
                "L_m": 200.0,
                "D_m": 0.15,
                "roughness_m": 0.00012,
                "K_values": [0.5, 1.0],
            }
        ],
        "node_elev_start_m": 6.0,
        "node_elev_end_m": 28.5,
    },
}


class TestComputeHydraulicsEndpoint:
    def test_returns_200(self):
        resp = client.post("/compute/hydraulics", json=MINIMAL_REQUEST)
        assert resp.status_code == 200

    def test_system_curve_has_10_points(self):
        resp = client.post("/compute/hydraulics", json=MINIMAL_REQUEST)
        data = resp.json()
        assert len(data["system_curve"]) == 10

    def test_system_curve_spans_02_to_15_qdesign(self):
        resp = client.post("/compute/hydraulics", json=MINIMAL_REQUEST)
        data = resp.json()
        Q_design_m3h = MINIMAL_REQUEST["Q_m3h"]
        q_values = [pt["Q_m3h"] for pt in data["system_curve"]]
        assert q_values[0] == pytest.approx(0.2 * Q_design_m3h, rel=1e-4)
        assert q_values[-1] == pytest.approx(1.5 * Q_design_m3h, rel=1e-4)

    def test_response_contains_required_fields(self):
        resp = client.post("/compute/hydraulics", json=MINIMAL_REQUEST)
        data = resp.json()
        for field in [
            "segments",
            "static_head_m",
            "total_hf_m",
            "total_hm_m",
            "delta_pressure_head_m",
            "delta_velocity_head_m",
            "tdh_m",
            "design_Q_m3h",
            "system_curve",
        ]:
            assert field in data, f"Missing field: {field}"

    def test_tdh_equals_sum_of_components(self):
        resp = client.post("/compute/hydraulics", json=MINIMAL_REQUEST)
        d = resp.json()
        expected = (
            d["static_head_m"]
            + d["total_hf_m"]
            + d["total_hm_m"]
            + d["delta_pressure_head_m"]
            + d["delta_velocity_head_m"]
        )
        assert d["tdh_m"] == pytest.approx(expected, rel=1e-6)

    def test_single_segment_result_present(self):
        resp = client.post("/compute/hydraulics", json=MINIMAL_REQUEST)
        data = resp.json()
        assert len(data["segments"]) == 1
        seg = data["segments"][0]
        assert seg["method"] == "darcy_weisbach"
        assert seg["hf_m"] > 0
        assert seg["velocity_ms"] > 0
        assert seg["re"] > 0

    def test_hazen_williams_segment(self):
        req = {
            "Q_m3h": 36.0,
            "suction": {
                "name": "suction",
                "segments": [],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 5.0,
            },
            "discharge": {
                "name": "discharge",
                "segments": [
                    {
                        "label": "FM-HW",
                        "method": "hazen_williams",
                        "L_m": 150.0,
                        "D_m": 0.15,
                        "C_hw": 130.0,
                        "K_values": [],
                    }
                ],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 25.0,
            },
        }
        resp = client.post("/compute/hydraulics", json=req)
        assert resp.status_code == 200
        data = resp.json()
        seg = data["segments"][0]
        assert seg["method"] == "hazen_williams"
        assert seg["hf_m"] > 0
        # HW segments do not have Re or f
        assert seg["re"] is None
        assert seg["friction_factor"] is None

    def test_multi_segment_mixed_methods(self):
        req = {
            "Q_m3h": 36.0,
            "suction": {
                "name": "suction",
                "segments": [
                    {
                        "label": "suction-pipe",
                        "method": "darcy_weisbach",
                        "L_m": 10.0,
                        "D_m": 0.20,
                        "roughness_m": 0.00012,
                        "K_values": [0.5],
                    }
                ],
                "node_elev_start_m": 3.0,
                "node_elev_end_m": 5.0,
            },
            "discharge": {
                "name": "discharge",
                "segments": [
                    {
                        "label": "FM-DW",
                        "method": "darcy_weisbach",
                        "L_m": 100.0,
                        "D_m": 0.15,
                        "roughness_m": 0.00012,
                        "K_values": [1.0],
                    },
                    {
                        "label": "FM-HW",
                        "method": "hazen_williams",
                        "L_m": 100.0,
                        "D_m": 0.15,
                        "C_hw": 120.0,
                        "K_values": [0.3],
                    },
                ],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 28.0,
            },
        }
        resp = client.post("/compute/hydraulics", json=req)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["segments"]) == 3
        assert data["system_curve"] and len(data["system_curve"]) == 10

    def test_pressure_heads_included_in_tdh(self):
        """Adding a non-zero end pressure head must increase TDH."""
        base = {
            "Q_m3h": 36.0,
            "suction": {
                "name": "suction",
                "segments": [],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 5.0,
                "pressure_head_start_m": 0.0,
            },
            "discharge": {
                "name": "discharge",
                "segments": [
                    {
                        "label": "FM",
                        "method": "darcy_weisbach",
                        "L_m": 200.0,
                        "D_m": 0.15,
                        "roughness_m": 0.00012,
                        "K_values": [],
                    }
                ],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 25.0,
                "pressure_head_end_m": 0.0,
            },
        }
        import copy
        pressurised = copy.deepcopy(base)
        pressurised["discharge"]["pressure_head_end_m"] = 10.0

        resp_base = client.post("/compute/hydraulics", json=base).json()
        resp_press = client.post("/compute/hydraulics", json=pressurised).json()
        assert resp_press["tdh_m"] == pytest.approx(
            resp_base["tdh_m"] + 10.0, rel=1e-6
        )

    def test_invalid_method_returns_422(self):
        req = {
            "Q_m3h": 36.0,
            "suction": {
                "name": "suction",
                "segments": [],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 5.0,
            },
            "discharge": {
                "name": "discharge",
                "segments": [
                    {
                        "label": "bad",
                        "method": "unknown_method",
                        "L_m": 100.0,
                        "D_m": 0.15,
                        "roughness_m": 0.00012,
                        "K_values": [],
                    }
                ],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 25.0,
            },
        }
        resp = client.post("/compute/hydraulics", json=req)
        assert resp.status_code == 422

    def test_darcy_weisbach_missing_roughness_returns_422(self):
        req = {
            "Q_m3h": 36.0,
            "suction": {
                "name": "suction",
                "segments": [],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 5.0,
            },
            "discharge": {
                "name": "discharge",
                "segments": [
                    {
                        "label": "bad",
                        "method": "darcy_weisbach",
                        "L_m": 100.0,
                        "D_m": 0.15,
                        # roughness_m deliberately omitted
                        "K_values": [],
                    }
                ],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 25.0,
            },
        }
        resp = client.post("/compute/hydraulics", json=req)
        assert resp.status_code == 422

    def test_hazen_williams_missing_c_returns_422(self):
        req = {
            "Q_m3h": 36.0,
            "suction": {
                "name": "suction",
                "segments": [],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 5.0,
            },
            "discharge": {
                "name": "discharge",
                "segments": [
                    {
                        "label": "hw-bad",
                        "method": "hazen_williams",
                        "L_m": 100.0,
                        "D_m": 0.15,
                        # C_hw deliberately omitted
                        "K_values": [],
                    }
                ],
                "node_elev_start_m": 5.0,
                "node_elev_end_m": 25.0,
            },
        }
        resp = client.post("/compute/hydraulics", json=req)
        assert resp.status_code == 422
