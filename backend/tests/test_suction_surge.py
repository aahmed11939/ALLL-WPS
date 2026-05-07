"""
T002 — Backend tests: suction transient / NPSHa analysis.

Covers:
  1. compute_npsha_transient() engine helper (unit tests)
  2. POST /surge/suction endpoint round-trip (integration tests)
  3. Risk flag logic (no-NPSHr, safe NPSHr, critical NPSHr)
  4. Schema validation (max_length, missing segments, zero wave speed)
  5. Edge cases (custom atm pressure, pump_node_frac, n_reaches)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.engine.surge_moc import (
    ReservoirBC,
    SuctionPumpTripBC,
    compute_npsha_transient,
    run_moc,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

client = TestClient(app)

_SEGMENT = {
    "L_m": 200.0,
    "D_m": 0.25,
    "roughness_m": 0.00012,
    "elev_start_m": 2.0,
    "elev_end_m": 2.0,
}

_BC_A = {"type": "reservoir", "H_m": 2.0}
_BC_B = {
    "type": "suction_pump_trip",
    "H_sump_m": 2.0,
    "Q_m3s": 0.06,
    "t_trip_s": 2.0,
}

_OBS = [
    {"frac": 0.0, "label": "Source"},
    {"frac": 0.5, "label": "Mid"},
    {"frac": 1.0, "label": "Pump"},
]


def _payload(**overrides) -> dict:
    """Minimal valid POST /surge/suction payload."""
    p = {
        "wave_speed_ms": 1000.0,
        "Q_0_m3s": 0.06,
        "H_0_m": 5.0,
        "temperature_C": 20.0,
        "rho_kg_m3": 1000.0,
        "NPSHr_m": None,
        "segments": [_SEGMENT],
        "boundary_A": _BC_A,
        "boundary_B": _BC_B,
        "observation_points": _OBS,
        "pump_node_frac": 1.0,
    }
    p.update(overrides)
    return p


def _raw_moc(n_reaches: int = 20) -> dict:
    """Run the engine directly and return the raw MOC result dict."""
    bcA = ReservoirBC(H_res_m=2.0)
    bcB = SuctionPumpTripBC(H_sump_m=2.0, Q_0=0.06, t_trip=2.0)
    return run_moc(
        segments=[_SEGMENT],
        wave_speed_ms=1000.0,
        Q_0_m3s=0.06,
        H_0_m=5.0,
        boundary_A=bcA,
        boundary_B=bcB,
        temperature_C=20.0,
        rho_kg_m3=1000.0,
        pressure_rating_kPa=None,
        observation_fracs=[0.0, 0.5, 1.0],
        observation_labels=["Source", "Mid", "Pump"],
        n_reaches_override=n_reaches,
        t_total_override=None,
    )


# ---------------------------------------------------------------------------
# Unit tests — compute_npsha_transient()
# ---------------------------------------------------------------------------


class TestComputeNPSHaTransient:
    """Engine-level unit tests for compute_npsha_transient()."""

    def test_returns_required_keys(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        for key in ("npsha_series", "npsha_min_m", "npsha_steady_m",
                    "npsha_margin_min_m", "transient_npsh_risk",
                    "npsha_risk_duration_s"):
            assert key in res, f"Missing key: {key}"

    def test_npsha_series_is_non_empty_list(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        assert isinstance(res["npsha_series"], list)
        assert len(res["npsha_series"]) > 0

    def test_npsha_point_has_required_fields(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        pt = res["npsha_series"][0]
        for field in ("t_s", "H_suction_m", "NPSHa_m", "margin_m", "at_risk"):
            assert field in pt, f"Point missing field: {field}"

    def test_margin_none_when_no_npshr(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        assert res["npsha_margin_min_m"] is None
        assert res["npsha_series"][0]["margin_m"] is None

    def test_margin_set_when_npshr_given(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=3.0)
        assert res["npsha_margin_min_m"] is not None
        assert isinstance(res["npsha_margin_min_m"], float)

    def test_no_risk_when_no_npshr(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        assert res["transient_npsh_risk"] is False
        assert res["npsha_risk_duration_s"] == 0.0

    def test_no_risk_when_npshr_tiny(self):
        """NPSHr = 0.001 m → reservoir at 2 m gives NPSHa ≫ 0.001."""
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=0.001)
        assert res["transient_npsh_risk"] is False

    def test_risk_true_when_npshr_enormous(self):
        """NPSHr = 1000 m → always at risk."""
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=1000.0)
        assert res["transient_npsh_risk"] is True
        assert res["npsha_risk_duration_s"] > 0.0

    def test_npsha_steady_equals_first_point(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        first = res["npsha_series"][0]["NPSHa_m"]
        assert abs(res["npsha_steady_m"] - first) < 1e-3

    def test_npsha_min_le_steady(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        assert res["npsha_min_m"] <= res["npsha_steady_m"] + 1e-9

    def test_margin_min_arithmetic(self):
        moc = _raw_moc()
        NPSHr = 4.0
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=NPSHr)
        expected = round(res["npsha_min_m"] - NPSHr, 4)
        assert abs(res["npsha_margin_min_m"] - expected) < 1e-3

    def test_at_risk_flag_consistent_with_margin(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=1000.0)
        for pt in res["npsha_series"]:
            if pt["margin_m"] is not None:
                assert pt["at_risk"] == (pt["margin_m"] < 0)

    def test_time_series_monotonically_increasing(self):
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        times = [pt["t_s"] for pt in res["npsha_series"]]
        assert times == sorted(times)

    def test_npsha_equals_H_minus_hvap(self):
        moc = _raw_moc()
        h_vap = moc["h_vap_m"]
        res = compute_npsha_transient(moc, obs_index=2, NPSHr_m=None)
        pt = res["npsha_series"][0]
        assert abs(pt["NPSHa_m"] - round(pt["H_suction_m"] - h_vap, 4)) < 1e-3

    def test_different_obs_index(self):
        """obs_index=0 (Source) should also return valid data."""
        moc = _raw_moc()
        res = compute_npsha_transient(moc, obs_index=0, NPSHr_m=None)
        assert len(res["npsha_series"]) > 0


# ---------------------------------------------------------------------------
# Integration tests — POST /surge/suction
# ---------------------------------------------------------------------------


class TestSuctionEndpoint:
    """Round-trip tests via the FastAPI TestClient."""

    def test_200_ok(self):
        r = client.post("/surge/suction", json=_payload())
        assert r.status_code == 200, r.text

    def test_response_has_npsha_series(self):
        r = client.post("/surge/suction", json=_payload())
        data = r.json()
        assert "npsha_series" in data
        assert len(data["npsha_series"]) > 0

    def test_all_npsha_fields_present(self):
        r = client.post("/surge/suction", json=_payload())
        data = r.json()
        for f in ("npsha_min_m", "npsha_steady_m", "npsha_margin_min_m",
                  "transient_npsh_risk", "npsha_risk_duration_s",
                  "atm_pressure_kPa", "NPSHr_m", "pump_node_frac"):
            assert f in data, f"Missing field: {f}"

    def test_pipeline_is_suction(self):
        r = client.post("/surge/suction", json=_payload())
        assert r.json()["pipeline"] == "suction"

    def test_no_risk_no_npshr(self):
        r = client.post("/surge/suction", json=_payload(NPSHr_m=None))
        data = r.json()
        assert data["transient_npsh_risk"] is False
        assert data["npsha_margin_min_m"] is None

    def test_risk_true_huge_npshr(self):
        r = client.post("/surge/suction", json=_payload(NPSHr_m=9999.0))
        data = r.json()
        assert data["transient_npsh_risk"] is True
        assert data["npsha_risk_duration_s"] > 0.0

    def test_risk_false_tiny_npshr(self):
        r = client.post("/surge/suction", json=_payload(NPSHr_m=0.001))
        assert r.json()["transient_npsh_risk"] is False

    def test_atm_pressure_echoed(self):
        r = client.post("/surge/suction", json=_payload(atm_pressure_kPa=90.0))
        assert abs(r.json()["atm_pressure_kPa"] - 90.0) < 0.5

    def test_pump_node_frac_echoed(self):
        r = client.post("/surge/suction", json=_payload(pump_node_frac=0.9))
        assert abs(r.json()["pump_node_frac"] - 0.9) < 0.01

    def test_envelope_present(self):
        r = client.post("/surge/suction", json=_payload())
        assert len(r.json()["envelope"]) > 0

    def test_observations_present(self):
        r = client.post("/surge/suction", json=_payload())
        assert len(r.json()["observations"]) > 0

    def test_up_to_10_obs_points_accepted(self):
        obs = [{"frac": i / 9, "label": f"P{i}"} for i in range(10)]
        r = client.post("/surge/suction", json=_payload(observation_points=obs))
        assert r.status_code == 200, r.text

    def test_11_obs_points_rejected(self):
        obs = [{"frac": i / 10, "label": f"P{i}"} for i in range(11)]
        r = client.post("/surge/suction", json=_payload(observation_points=obs))
        assert r.status_code == 422

    def test_zero_wave_speed_rejected(self):
        r = client.post("/surge/suction", json=_payload(wave_speed_ms=0))
        assert r.status_code == 422

    def test_empty_segments_rejected(self):
        r = client.post("/surge/suction", json=_payload(segments=[]))
        assert r.status_code == 422

    def test_npsha_steady_positive_with_reservoir_bc(self):
        """Reservoir at H=2 m, 20 °C → NPSHa_steady ≈ 11 m > 0."""
        r = client.post("/surge/suction", json=_payload())
        assert r.json()["npsha_steady_m"] > 0.0

    def test_n_reaches_sets_grid(self):
        r = client.post("/surge/suction", json=_payload(n_reaches=20))
        assert r.json()["N"] == 20

    def test_margin_arithmetic(self):
        npshr = 3.0
        r = client.post("/surge/suction", json=_payload(NPSHr_m=npshr))
        data = r.json()
        expected = round(data["npsha_min_m"] - npshr, 3)
        assert abs(data["npsha_margin_min_m"] - expected) < 0.01

    def test_npsha_series_point_structure(self):
        r = client.post("/surge/suction", json=_payload())
        pt = r.json()["npsha_series"][0]
        for field in ("t_s", "H_suction_m", "NPSHa_m", "margin_m", "at_risk"):
            assert field in pt, f"Point missing: {field}"
