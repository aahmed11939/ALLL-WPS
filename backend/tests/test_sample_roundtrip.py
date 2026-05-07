"""
Round-trip tests: post each sample project's exact hydraulic parameters to
POST /api/v1/calculate and verify HTTP 200 plus engineering-grade value assertions.

Payload values are taken directly from the three frontend sample data files:
  - sampleProject.ts      → split-case VFD   (DN150 PVC,           Q=36,  elev 5→35 m)
  - sampleProjectVT.ts    → vertical turbine  (DN200 ductile iron,  Q=50,  elev -4→18 m)
  - sampleProjectBooster.ts → booster set     (DN100 HDPE,          Q=25,  elev 0→2 m)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app

_client = TestClient(app)

# ---------------------------------------------------------------------------
# Payloads — exact values from frontend/src/data/sample*.ts
# ---------------------------------------------------------------------------

# sampleProject.ts: Q=36, elev_us=5, elev_ds=35,
#   suction  [DN150 PVC  200 m], discharge [DN150 PVC  400 m]
#   ⇒ total_pipe_length = 600 m, static_head = 35 − 5 = 30 m
_SPLIT_CASE = {
    "Q_m3h": 36.0,
    "elev_us_m": 5.0,
    "elev_ds_m": 35.0,
    "pipe_length_m": 600.0,
    "pipe_diameter_mm": 150.0,
    "material": "pvc",
    "K_values": [],
    "unit_system": "SI",
}

# sampleProjectVT.ts: Q=50, elev_us=-4, elev_ds=18,
#   suction  [DN200 steel 15 m], discharge [DN200 ductile_iron 280 m]
#   ⇒ total_pipe_length = 295 m, static_head = 18 − (−4) = 22 m
_VERTICAL_TURBINE = {
    "Q_m3h": 50.0,
    "elev_us_m": -4.0,
    "elev_ds_m": 18.0,
    "pipe_length_m": 295.0,
    "pipe_diameter_mm": 200.0,
    "material": "ductile_iron",
    "K_values": [],
    "unit_system": "SI",
}

# sampleProjectBooster.ts: Q=25, elev_us=0, elev_ds=2,
#   suction  [DN100 HDPE 40 m], discharge [DN100 HDPE 120 m]
#   ⇒ total_pipe_length = 160 m, static_head = 2 − 0 = 2 m
_BOOSTER = {
    "Q_m3h": 25.0,
    "elev_us_m": 0.0,
    "elev_ds_m": 2.0,
    "pipe_length_m": 160.0,
    "pipe_diameter_mm": 100.0,
    "material": "hdpe",
    "K_values": [],
    "unit_system": "SI",
}


class TestSampleProjectRoundTrip:
    """POST /api/v1/calculate accepts each sample project and returns correct engineering values."""

    # ── Split-case VFD (DN150 PVC, Q=36 m³/h) ──────────────────────────────

    def test_split_case_returns_200(self):
        resp = _client.post("/api/v1/calculate", json=_SPLIT_CASE)
        assert resp.status_code == 200, resp.text

    def test_split_case_static_head_equals_30m(self):
        """Static head = elev_ds − elev_us = 35 − 5 = 30 m (±0.01)."""
        data = _client.post("/api/v1/calculate", json=_SPLIT_CASE).json()
        assert "static_head_m" in data
        assert abs(data["static_head_m"] - 30.0) < 0.01

    def test_split_case_tdh_greater_than_static_head(self):
        """TDH must exceed static head because friction losses add on top."""
        data = _client.post("/api/v1/calculate", json=_SPLIT_CASE).json()
        assert data["tdh_m"] > data["static_head_m"]

    def test_split_case_velocity_plausible(self):
        """V = Q/A for DN150 at 36 m³/h ≈ 0.566 m/s; expect 0.4–1.5 m/s."""
        data = _client.post("/api/v1/calculate", json=_SPLIT_CASE).json()
        assert 0.4 < data["velocity_ms"] < 1.5

    def test_split_case_system_curve_non_empty(self):
        data = _client.post("/api/v1/calculate", json=_SPLIT_CASE).json()
        assert "system_curve" in data
        assert len(data["system_curve"]) >= 2

    # ── Vertical turbine (DN200 ductile iron, Q=50 m³/h) ───────────────────

    def test_vertical_turbine_returns_200(self):
        resp = _client.post("/api/v1/calculate", json=_VERTICAL_TURBINE)
        assert resp.status_code == 200, resp.text

    def test_vertical_turbine_static_head_equals_22m(self):
        """Static head = 18 − (−4) = 22 m (±0.01)."""
        data = _client.post("/api/v1/calculate", json=_VERTICAL_TURBINE).json()
        assert "static_head_m" in data
        assert abs(data["static_head_m"] - 22.0) < 0.01

    def test_vertical_turbine_tdh_positive(self):
        data = _client.post("/api/v1/calculate", json=_VERTICAL_TURBINE).json()
        assert data["tdh_m"] > 0

    def test_vertical_turbine_velocity_plausible(self):
        """V = Q/A for DN200 at 50 m³/h ≈ 0.442 m/s; expect 0.3–1.2 m/s."""
        data = _client.post("/api/v1/calculate", json=_VERTICAL_TURBINE).json()
        assert 0.3 < data["velocity_ms"] < 1.2

    # ── Booster set (DN100 HDPE, Q=25 m³/h) ────────────────────────────────

    def test_booster_returns_200(self):
        resp = _client.post("/api/v1/calculate", json=_BOOSTER)
        assert resp.status_code == 200, resp.text

    def test_booster_static_head_equals_2m(self):
        """Static head = 2 − 0 = 2 m (±0.01)."""
        data = _client.post("/api/v1/calculate", json=_BOOSTER).json()
        assert "static_head_m" in data
        assert abs(data["static_head_m"] - 2.0) < 0.01

    def test_booster_tdh_greater_than_static_head(self):
        """Even a 2 m static head: friction losses push TDH above it."""
        data = _client.post("/api/v1/calculate", json=_BOOSTER).json()
        assert data["tdh_m"] > data["static_head_m"]

    def test_booster_velocity_plausible(self):
        """V = Q/A for DN100 at 25 m³/h ≈ 0.884 m/s; expect 0.6–2.0 m/s."""
        data = _client.post("/api/v1/calculate", json=_BOOSTER).json()
        assert 0.6 < data["velocity_ms"] < 2.0

    # ── Error-handling (structured 422) ────────────────────────────────────

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
