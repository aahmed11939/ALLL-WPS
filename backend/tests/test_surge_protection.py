"""
Tests for Task #56 — Surge protection devices + what-if comparison.

Covers:
  - AirVesselBC  unit behaviour
  - SurgeTankBC  unit behaviour
  - PRV post-processing helper
  - Vacuum relief valve post-processing helper
  - All 5 sizing helpers
  - POST /surge/whatif  endpoint integration (round-trip)
"""

from __future__ import annotations

import copy
import math

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.engine.surge_moc import ReservoirBC, run_moc
from backend.engine.surge_sizing import (
    AirVesselBC,
    SurgeTankBC,
    apply_prv_postprocess,
    apply_vacuum_relief_postprocess,
    size_air_vessel,
    size_prv,
    size_slow_check_valve,
    size_surge_tank,
    size_vacuum_relief,
    extract_whatif_metrics,
)

client = TestClient(app)

G = 9.81

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

SIMPLE_SEG = {
    "L_m": 500.0, "D_m": 0.2, "roughness_m": 1.5e-4,
    "elev_start_m": 0.0, "elev_end_m": 0.0,
}

SIMPLE_SEGS_API = [
    {
        "L_m": 500.0, "D_m": 0.2, "roughness_m": 1.5e-4,
        "elev_start_m": 0.0, "elev_end_m": 0.0,
    }
]

BASE_REQUEST = {
    "wave_speed_ms": 1000.0,
    "Q_0_m3s": 0.05,
    "H_0_m": 40.0,
    "temperature_C": 20.0,
    "rho_kg_m3": 1000.0,
    "segments": SIMPLE_SEGS_API,
    "boundary_A": {"type": "pump_trip", "H_pump_m": 40.0, "Q_m3s": 0.05,
                   "t_trip_s": 2.0, "H_reservoir_m": 5.0},
    "boundary_B": {"type": "reservoir", "H_m": 35.0},
    "pipeline": "discharge",
    "devices": [],
}


# ===========================================================================
# 1. AirVesselBC unit tests
# ===========================================================================

class TestAirVesselBC:
    def _make(self, V_tot=2.0, V_gas_frac=0.5, P0_kPa=400.0, dt=0.05):
        return AirVesselBC(
            dt_s=dt,
            V_total_m3=V_tot,
            V_gas_0_m3=V_tot * V_gas_frac,
            P0_kPa=P0_kPa,
            rho_kg_m3=1000.0,
            polytropic_n=1.4,
        )

    def test_initial_head(self):
        av = self._make(P0_kPa=400.0)
        expected_H = 400_000 / (1000.0 * G)
        assert abs(av.H_tank - expected_H) < 0.01

    def test_apply_returns_tuple(self):
        av = self._make()
        H, Q = av.apply(t=0.0, cp_or_cm=60.0, B=10.0, is_upstream=False)
        assert isinstance(H, float)
        assert isinstance(Q, float)

    def test_gas_volume_updates_on_inflow(self):
        av = self._make(V_tot=2.0, V_gas_frac=0.5, P0_kPa=400.0, dt=0.05)
        V_gas_before = av.V_gas
        # CP > H_tank → Q_P > 0 → flow into vessel → gas volume decreases
        CP = av.H_tank + 10.0
        av.apply(t=0.0, cp_or_cm=CP, B=10.0, is_upstream=False)
        assert av.V_gas < V_gas_before

    def test_pressure_rises_when_gas_compressed(self):
        av = self._make(V_tot=2.0, V_gas_frac=0.5, P0_kPa=400.0, dt=0.05)
        H_before = av.H_tank
        CP = av.H_tank + 50.0   # large inflow → gas compression
        for _ in range(20):
            av.apply(t=0.0, cp_or_cm=CP, B=10.0, is_upstream=False)
        assert av.H_tank > H_before

    def test_gas_volume_clamped_above_minimum(self):
        av = self._make(V_tot=2.0, V_gas_frac=0.5, P0_kPa=400.0, dt=0.5)
        CP = av.H_tank + 1000.0  # extreme inflow
        for _ in range(100):
            av.apply(t=0.0, cp_or_cm=CP, B=10.0, is_upstream=False)
        assert av.V_gas >= av.V_tot * 0.005   # never below 0.5 %

    def test_upstream_convention(self):
        av = self._make()
        # is_upstream=True → CM convention: Q_P = (H_tank - CM) / B
        H_tank = av.H_tank
        CM = H_tank - 10.0   # head below tank → flow FROM tank INTO pipe
        H_P, Q_P = av.apply(t=0.0, cp_or_cm=CM, B=5.0, is_upstream=True)
        assert Q_P > 0   # positive = flow out of tank into pipe


# ===========================================================================
# 2. SurgeTankBC unit tests
# ===========================================================================

class TestSurgeTankBC:
    def _make(self, A=1.0, z0=30.0, z_max=50.0, dt=0.05):
        return SurgeTankBC(dt_s=dt, A_tank_m2=A, z_initial_m=z0, z_max_m=z_max)

    def test_initial_head_equals_z(self):
        st = self._make(z0=30.0)
        # First apply: H_P should be z_initial
        H_P, _ = st.apply(t=0.0, cp_or_cm=20.0, B=5.0, is_upstream=False)
        assert abs(H_P - 30.0) < 1e-9

    def test_level_rises_on_inflow(self):
        st = self._make(A=1.0, z0=30.0, z_max=50.0, dt=0.1)
        # CP > z → Q_P > 0 → inflow → level rises
        CP = 40.0   # > z=30
        z_before = st.z
        st.apply(t=0.0, cp_or_cm=CP, B=5.0, is_upstream=False)
        assert st.z > z_before

    def test_level_capped_at_z_max(self):
        st = self._make(A=0.1, z0=49.9, z_max=50.0, dt=1.0)
        # Massive inflow — level must be clamped at z_max
        for _ in range(50):
            st.apply(t=0.0, cp_or_cm=100.0, B=1.0, is_upstream=False)
        assert st.z <= st.z_max

    def test_level_does_not_go_below_zero(self):
        st = self._make(A=0.1, z0=0.1, z_max=50.0, dt=1.0)
        for _ in range(50):
            st.apply(t=0.0, cp_or_cm=-100.0, B=1.0, is_upstream=False)
        assert st.z >= 0.0

    def test_upstream_convention(self):
        st = self._make(z0=30.0)
        # CM < z → flow FROM tank INTO pipe → level drops
        CM = 20.0
        z_before = st.z
        st.apply(t=0.0, cp_or_cm=CM, B=5.0, is_upstream=True)
        assert st.z < z_before


# ===========================================================================
# 3. PRV post-processing tests
# ===========================================================================

class TestPRVPostprocess:
    def _make_raw(self, n_pts=5, max_H=80.0, min_H=10.0):
        env = [
            {
                "x_m": i * 100.0,
                "elev_m": 0.0,
                "H_max_m": max_H,
                "H_min_m": min_H,
                "P_max_kPa": round(max_H * 1000 * G / 1000, 2),
                "P_min_kPa": round(min_H * 1000 * G / 1000, 2),
            }
            for i in range(n_pts)
        ]
        raw = {
            "envelope": env,
            "global_max_H_m": max_H,
            "global_min_H_m": min_H,
            "global_max_P_kPa": max_H * 1000 * G / 1000,
            "global_min_P_kPa": min_H * 1000 * G / 1000,
            "cavitation_x_m": [],
        }
        return raw

    def test_max_head_capped(self):
        raw = self._make_raw(max_H=80.0)
        apply_prv_postprocess(raw, H_set_m=60.0)
        assert all(pt["H_max_m"] <= 60.0 for pt in raw["envelope"])

    def test_global_max_updated(self):
        raw = self._make_raw(max_H=80.0)
        apply_prv_postprocess(raw, H_set_m=60.0)
        assert raw["global_max_H_m"] <= 60.0

    def test_min_head_unchanged(self):
        raw = self._make_raw(max_H=80.0, min_H=10.0)
        apply_prv_postprocess(raw, H_set_m=60.0)
        assert all(pt["H_min_m"] == 10.0 for pt in raw["envelope"])

    def test_no_change_when_below_set(self):
        raw = self._make_raw(max_H=50.0)
        apply_prv_postprocess(raw, H_set_m=60.0)
        assert all(pt["H_max_m"] == 50.0 for pt in raw["envelope"])


# ===========================================================================
# 4. Vacuum relief valve post-processing tests
# ===========================================================================

class TestVacuumReliefPostprocess:
    def _make_raw(self, n_pts=5, max_H=80.0, min_H=-5.0):
        env = [
            {
                "x_m": i * 100.0,
                "elev_m": 0.0,
                "H_max_m": max_H,
                "H_min_m": min_H,
                "P_max_kPa": round(max_H * 1000 * G / 1000, 2),
                "P_min_kPa": round(min_H * 1000 * G / 1000, 2),
            }
            for i in range(n_pts)
        ]
        raw = {
            "envelope": env,
            "global_max_H_m": max_H,
            "global_min_H_m": min_H,
            "global_max_P_kPa": max_H * 1000 * G / 1000,
            "global_min_P_kPa": min_H * 1000 * G / 1000,
            "cavitation_x_m": [100.0, 200.0],
        }
        return raw

    def test_min_head_clamped(self):
        raw = self._make_raw(min_H=-5.0)
        apply_vacuum_relief_postprocess(raw, H_admit_m=0.0)
        assert all(pt["H_min_m"] >= 0.0 for pt in raw["envelope"])

    def test_global_min_updated(self):
        raw = self._make_raw(min_H=-5.0)
        apply_vacuum_relief_postprocess(raw, H_admit_m=0.0)
        assert raw["global_min_H_m"] >= 0.0

    def test_cavitation_nodes_cleared(self):
        raw = self._make_raw(min_H=-5.0)
        apply_vacuum_relief_postprocess(raw, H_admit_m=0.0)
        assert raw["cavitation_x_m"] == []

    def test_max_head_unchanged(self):
        raw = self._make_raw(max_H=80.0, min_H=-5.0)
        apply_vacuum_relief_postprocess(raw, H_admit_m=0.0)
        assert all(pt["H_max_m"] == 80.0 for pt in raw["envelope"])


# ===========================================================================
# 5. Sizing helper tests
# ===========================================================================

class TestSizingHelpers:
    def test_air_vessel_returns_positive_volumes(self):
        res = size_air_vessel(
            Q_0_m3s=0.05, a_ms=1000, A_pipe_m2=0.03, H_0_m=40, H_max_target_m=60
        )
        assert res["V_gas_0_m3"] > 0
        assert res["V_total_m3"] > res["V_gas_0_m3"]
        assert res["P0_kPa"] > 0

    def test_air_vessel_joukowsky(self):
        A = math.pi * 0.2 ** 2 / 4
        res = size_air_vessel(Q_0_m3s=0.05, a_ms=1000, A_pipe_m2=A, H_0_m=40, H_max_target_m=60)
        expected_J = 1000 * 0.05 / (G * A)
        assert abs(res["H_joukowsky_m"] - expected_J) < 0.5

    def test_surge_tank_returns_positive_area(self):
        res = size_surge_tank(
            Q_0_m3s=0.05, a_ms=1000, L_m=500, D_m=0.2, H_0_m=40, H_max_target_m=60
        )
        assert res["A_tank_m2"] > 0
        assert res["D_equiv_m"] > 0
        assert res["z_max_m"] > res["z_initial_m"]

    def test_surge_tank_minimum_area(self):
        res = size_surge_tank(
            Q_0_m3s=0.001, a_ms=100, L_m=10, D_m=0.05, H_0_m=5, H_max_target_m=6
        )
        assert res["A_tank_m2"] >= 0.25   # enforced minimum

    def test_prv_sizing_kv(self):
        res = size_prv(Q_relief_m3s=0.05, P_upstream_kPa=800, P_set_kPa=600)
        assert res["Kv_m3h_bar05"] > 0
        assert res["Cv"] > 0
        assert res["DN_mm"] in [15, 25, 40, 50, 80, 100]

    def test_prv_sizing_small_dp(self):
        res = size_prv(Q_relief_m3s=0.001, P_upstream_kPa=300, P_set_kPa=299)
        assert res["Kv_m3h_bar05"] > 0

    def test_vacuum_relief_sizing(self):
        res = size_vacuum_relief(D_pipe_m=0.2)
        assert res["DN_rec_mm"] >= 25
        assert res["A_req_m2"] > 0
        assert res["D_pipe_mm"] == pytest.approx(200.0, abs=0.1)

    def test_slow_check_valve_sizing(self):
        res = size_slow_check_valve(
            Q_0_m3s=0.05, a_ms=1000, L_m=500, D_m=0.2, H_0_m=40, H_max_target_m=60
        )
        assert res["t_close_rec_s"] >= 5.0
        assert res["t_close_rec_s"] >= res["t_close_min_s"]
        assert res["T_char_s"] == pytest.approx(2 * 500 / 1000, rel=1e-6)


# ===========================================================================
# 6. extract_whatif_metrics tests
# ===========================================================================

class TestExtractWhatifMetrics:
    def _raw(self, max_H=80.0, min_H=10.0):
        return {
            "global_max_H_m": max_H,
            "global_min_H_m": min_H,
            "global_max_P_kPa": max_H * G,
            "global_min_P_kPa": min_H * G,
            "cavitation_x_m": [],
            "envelope": [{"x_m": 0, "elev_m": 0, "H_max_m": max_H, "H_min_m": min_H,
                           "P_max_kPa": max_H * G, "P_min_kPa": min_H * G}],
        }

    def test_baseline_no_reduction(self):
        m = extract_whatif_metrics(self._raw(), "Baseline", None, None)
        assert m["max_surge_reduction_m"] is None
        assert m["max_surge_reduction_pct"] is None

    def test_device_reduction_positive(self):
        m = extract_whatif_metrics(self._raw(max_H=60.0), "PRV", 80.0, 10.0)
        assert m["max_surge_reduction_m"] == pytest.approx(20.0, abs=0.01)
        assert m["max_surge_reduction_pct"] == pytest.approx(25.0, abs=0.1)

    def test_min_head_improvement(self):
        m = extract_whatif_metrics(self._raw(min_H=0.0), "VRV", 80.0, -5.0)
        assert m["min_head_improvement_m"] == pytest.approx(5.0, abs=0.01)

    def test_envelope_preserved(self):
        m = extract_whatif_metrics(self._raw(), "Test", None, None)
        assert len(m["envelope"]) == 1
        assert "H_max_m" in m["envelope"][0]


# ===========================================================================
# 7. POST /surge/whatif endpoint integration tests
# ===========================================================================

class TestWhatIfEndpoint:
    def _req(self, devices=None):
        r = copy.deepcopy(BASE_REQUEST)
        if devices is not None:
            r["devices"] = devices
        return r

    def test_baseline_only(self):
        r = client.post("/surge/whatif", json=self._req(devices=[]))
        assert r.status_code == 200
        data = r.json()
        assert "baseline" in data
        assert "device_runs" in data
        assert data["device_runs"] == []
        assert data["baseline"]["global_max_H_m"] > 0

    def test_prv_device(self):
        req = self._req(devices=[
            {"type": "prv", "enabled": True, "H_set_m": 55.0}
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        assert len(data["device_runs"]) == 1
        run = data["device_runs"][0]
        assert run["global_max_H_m"] <= 55.0 + 0.1   # capped at set-point

    def test_vacuum_relief_clears_cavitation(self):
        req = self._req(devices=[
            {"type": "vacuum_relief", "enabled": True, "H_admit_m": 0.0}
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        run = data["device_runs"][0]
        assert run["global_min_H_m"] >= 0.0 - 0.01

    def test_air_vessel_device(self):
        req = self._req(devices=[
            {
                "type": "air_vessel",
                "enabled": True,
                "boundary_side": "A",
                "V_total_m3": 2.0,
                "V_gas_frac": 0.5,
                "P0_kPa": 400.0,
                "polytropic_n": 1.4,
            }
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        assert len(data["device_runs"]) == 1
        run = data["device_runs"][0]
        assert run["global_max_H_m"] > 0

    def test_surge_tank_device(self):
        req = self._req(devices=[
            {
                "type": "surge_tank",
                "enabled": True,
                "boundary_side": "B",
                "A_tank_m2": 2.0,
                "z_initial_m": 35.0,
                "z_max_m": 60.0,
            }
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        assert len(data["device_runs"]) == 1

    def test_slow_check_valve_device(self):
        req = self._req(devices=[
            {
                "type": "slow_check_valve",
                "enabled": True,
                "boundary_side": "B",
                "t_close_s": 30.0,
                "profile": "linear",
            }
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        assert len(data["device_runs"]) == 1

    def test_multiple_devices(self):
        req = self._req(devices=[
            {"type": "prv", "enabled": True, "H_set_m": 70.0},
            {"type": "vacuum_relief", "enabled": True, "H_admit_m": 0.0},
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        assert len(data["device_runs"]) == 2

    def test_disabled_device_skipped(self):
        req = self._req(devices=[
            {"type": "prv", "enabled": False, "H_set_m": 60.0},
            {"type": "vacuum_relief", "enabled": True, "H_admit_m": 0.0},
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        assert len(data["device_runs"]) == 1   # only VRV runs

    def test_response_has_sizing_summary(self):
        req = self._req(devices=[
            {"type": "prv", "enabled": True, "H_set_m": 60.0}
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        run = data["device_runs"][0]
        assert run["sizing_summary"] is not None
        assert "Kv_m3h_bar05" in run["sizing_summary"]

    def test_prv_reduction_positive_vs_baseline(self):
        req = self._req(devices=[
            {"type": "prv", "enabled": True, "H_set_m": 50.0}
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        run = data["device_runs"][0]
        assert run["max_surge_reduction_m"] is not None
        assert run["max_surge_reduction_m"] >= 0.0

    def test_envelope_included_in_device_run(self):
        req = self._req(devices=[
            {"type": "vacuum_relief", "enabled": True, "H_admit_m": 0.0}
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        data = r.json()
        run = data["device_runs"][0]
        assert isinstance(run["envelope"], list)
        assert len(run["envelope"]) > 0
        pt = run["envelope"][0]
        assert "x_m" in pt and "H_max_m" in pt and "H_min_m" in pt

    def test_assumption_notes_present(self):
        r = client.post("/surge/whatif", json=self._req())
        data = r.json()
        assert isinstance(data["assumption_notes"], list)
        assert len(data["assumption_notes"]) > 0

    def test_max_5_devices(self):
        devices = [{"type": "prv", "enabled": True, "H_set_m": 60.0}] * 6
        r = client.post("/surge/whatif", json=self._req(devices=devices))
        assert r.status_code == 422   # max_length=5 validation error

    def test_invalid_segment_raises_422(self):
        req = self._req()
        req["segments"] = []   # no segments
        r = client.post("/surge/whatif", json=req)
        assert r.status_code in (422, 422)

    def test_air_vessel_sizing_summary(self):
        req = self._req(devices=[
            {
                "type": "air_vessel", "enabled": True, "boundary_side": "A",
                "V_total_m3": 3.0, "V_gas_frac": 0.5, "P0_kPa": 392.0,
                "polytropic_n": 1.4,
            }
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        run = r.json()["device_runs"][0]
        s = run["sizing_summary"]
        assert s is not None
        assert "V_gas_0_m3" in s
        assert "H_joukowsky_m" in s

    def test_surge_tank_sizing_summary(self):
        req = self._req(devices=[
            {
                "type": "surge_tank", "enabled": True, "boundary_side": "B",
                "A_tank_m2": 1.5, "z_initial_m": 35.0, "z_max_m": 55.0,
            }
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        run = r.json()["device_runs"][0]
        s = run["sizing_summary"]
        assert s is not None
        assert "A_tank_m2" in s
        assert "D_equiv_m" in s

    def test_slow_check_valve_sizing_summary(self):
        req = self._req(devices=[
            {
                "type": "slow_check_valve", "enabled": True, "boundary_side": "B",
                "t_close_s": 20.0, "profile": "equal_percentage",
            }
        ])
        r = client.post("/surge/whatif", json=req)
        assert r.status_code == 200
        run = r.json()["device_runs"][0]
        s = run["sizing_summary"]
        assert s is not None
        assert "t_close_rec_s" in s
