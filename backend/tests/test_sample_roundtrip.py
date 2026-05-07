"""
Smoke tests: post each sample project's hydraulic parameters to
POST /api/v1/calculate and confirm the endpoint returns HTTP 200.

These tests verify that the sample data files contain inputs that
the backend accepts without 422/500 errors.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app

_client = TestClient(app)

# ---------------------------------------------------------------------------
# Minimal hydraulic payloads mirroring each sample project
# ---------------------------------------------------------------------------

# Sample 1: Municipal split-case VFD (DN150 PVC, 36 m³/h, static head 30 m)
_SPLIT_CASE = {
    "Q_m3h": 36.0,
    "elev_us_m": 5.0,
    "elev_ds_m": 35.0,
    "pipe_length_m": 600.0,   # 200 m suction + 400 m discharge
    "pipe_diameter_mm": 150.0,
    "material": "pvc",
    "K_values": [],
    "unit_system": "SI",
}

# Sample 2: Deep wet well vertical turbine (DN200 steel/DI, 50 m³/h, static head 22 m)
_VERTICAL_TURBINE = {
    "Q_m3h": 50.0,
    "elev_us_m": -4.0,
    "elev_ds_m": 18.0,
    "pipe_length_m": 295.0,   # 15 m suction riser + 280 m discharge
    "pipe_diameter_mm": 200.0,
    "material": "ductile_iron",
    "K_values": [],
    "unit_system": "SI",
}

# Sample 3: Pressure booster set (DN100 HDPE, 25 m³/h)
_BOOSTER = {
    "Q_m3h": 25.0,
    "elev_us_m": 0.0,
    "elev_ds_m": 2.0,
    "pipe_length_m": 160.0,   # 40 m suction + 120 m discharge
    "pipe_diameter_mm": 100.0,
    "material": "hdpe",
    "K_values": [],
    "unit_system": "SI",
}


class TestSampleProjectRoundTrip:
    """POST /api/v1/calculate accepts each sample project without errors."""

    def test_split_case_vfd_returns_200(self):
        resp = _client.post("/api/v1/calculate", json=_SPLIT_CASE)
        assert resp.status_code == 200, resp.text

    def test_split_case_vfd_has_tdh(self):
        resp = _client.post("/api/v1/calculate", json=_SPLIT_CASE)
        data = resp.json()
        assert "tdh_m" in data
        assert data["tdh_m"] > 0

    def test_split_case_vfd_has_system_curve(self):
        resp = _client.post("/api/v1/calculate", json=_SPLIT_CASE)
        data = resp.json()
        assert "system_curve" in data
        assert len(data["system_curve"]) >= 2

    def test_vertical_turbine_returns_200(self):
        resp = _client.post("/api/v1/calculate", json=_VERTICAL_TURBINE)
        assert resp.status_code == 200, resp.text

    def test_vertical_turbine_has_tdh(self):
        resp = _client.post("/api/v1/calculate", json=_VERTICAL_TURBINE)
        data = resp.json()
        assert "tdh_m" in data
        assert data["tdh_m"] > 0

    def test_booster_returns_200(self):
        resp = _client.post("/api/v1/calculate", json=_BOOSTER)
        assert resp.status_code == 200, resp.text

    def test_booster_has_static_head(self):
        resp = _client.post("/api/v1/calculate", json=_BOOSTER)
        data = resp.json()
        assert "static_head_m" in data

    def test_invalid_flow_returns_422(self):
        """Confirm the structured error handler fires for bad input."""
        bad = {**_SPLIT_CASE, "Q_m3h": -5.0}
        resp = _client.post("/api/v1/calculate", json=bad)
        assert resp.status_code == 422
        body = resp.json()
        assert "errors" in body
        assert isinstance(body["errors"], list)
        assert len(body["errors"]) > 0
        first = body["errors"][0]
        assert "loc" in first and "msg" in first and "type" in first

    def test_missing_required_field_returns_422_with_errors(self):
        """Missing required field triggers structured 422."""
        incomplete = {k: v for k, v in _SPLIT_CASE.items() if k != "material"}
        resp = _client.post("/api/v1/calculate", json=incomplete)
        assert resp.status_code == 422
        body = resp.json()
        assert "errors" in body


class TestSurgeQuickCheckEndpoint:
    """POST /surge/quick accepts a valid request and returns expected fields."""

    _REQ = {
        "pipeline": "discharge",
        "wave_speed_ms": 1200.0,
        "V0_ms": 1.5,
        "event_type": "pump_trip",
        "pipe_length_m": 400.0,
        "rho_kg_m3": 1000.0,
        "H_operating_m": 35.0,
        "temperature_C": 20.0,
        "unit_system": "SI",
    }

    def test_returns_200(self):
        resp = _client.post("/surge/quick", json=self._REQ)
        assert resp.status_code == 200, resp.text

    def test_has_delta_H_field(self):
        resp = _client.post("/surge/quick", json=self._REQ)
        data = resp.json()
        assert "delta_H_m" in data
        assert data["delta_H_m"] > 0

    def test_has_T_char_field(self):
        resp = _client.post("/surge/quick", json=self._REQ)
        data = resp.json()
        assert "T_char_s" in data
        expected = 2.0 * 400.0 / 1200.0
        assert abs(data["T_char_s"] - expected) < 0.01

    def test_joukowsky_field_present(self):
        resp = _client.post("/surge/quick", json=self._REQ)
        data = resp.json()
        assert "delta_H_joukowsky_m" in data

    def test_envelope_non_empty(self):
        resp = _client.post("/surge/quick", json=self._REQ)
        data = resp.json()
        assert "envelope" in data
        assert len(data["envelope"]) >= 2

    def test_plausible_joukowsky_magnitude(self):
        """ΔH_Joukowsky = a·V₀/g = 1200×1.5/9.81 ≈ 183.5 m."""
        resp = _client.post("/surge/quick", json=self._REQ)
        data = resp.json()
        expected_dh = 1200.0 * 1.5 / 9.81
        assert abs(data["delta_H_joukowsky_m"] - expected_dh) < 2.0

    def test_valve_closure_returns_200(self):
        req = {**self._REQ, "event_type": "valve_closure_downstream", "closure_time_s": 5.0}
        resp = _client.post("/surge/quick", json=req)
        assert resp.status_code == 200

    def test_invalid_wave_speed_returns_422(self):
        bad = {**self._REQ, "wave_speed_ms": -100.0}
        resp = _client.post("/surge/quick", json=bad)
        assert resp.status_code == 422
