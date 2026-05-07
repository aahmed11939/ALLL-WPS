"""
Unit tests for backend/api/domain_models.py and the /project/validate endpoint.

Run with:
    pytest backend/tests/test_domain_models.py -v

All 31 existing hydraulic tests in test_hydraulics.py continue to pass
independently; this suite does NOT import from hydraulics.
"""

from __future__ import annotations

import datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.domain_models import (
    NPSH_MARGIN_MIN,
    POTABLE_HF_GRADIENT_MAX,
    POTABLE_V_MAX,
    POTABLE_V_MIN,
    AccessoriesLibrary,
    AirVesselConfig,
    CurveUnits,
    MinorLossItem,
    Node,
    PipeAssembly,
    PipelineSegment,
    PRVConfig,
    ProjectMeta,
    ProjectModel,
    PumpCurveSet,
    PumpStation,
    SurgeStudy,
    ValidationResult,
    WetWell,
)
from backend.api.main import app

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_TODAY = datetime.date.today()


def _meta(**kwargs) -> dict:
    base = {
        "name": "Test PS",
        "designer": "J. Smith",
        "date": str(_TODAY),
        "unit_system": "SI",
    }
    base.update(kwargs)
    return base


def _segment(**kwargs) -> dict:
    base = {
        "id": "seg1",
        "name": "Discharge main",
        "length_m": 200.0,
        "diameter_mm": 150.0,
        "material": "ductile_iron",
        "friction_method": "darcy_weisbach",
        "roughness_epsilon_mm": 0.12,
    }
    base.update(kwargs)
    return base


def _minimal_project() -> dict:
    return {"meta": _meta()}


# ---------------------------------------------------------------------------
# T01 – T06: ProjectMeta
# ---------------------------------------------------------------------------


class TestProjectMeta:
    def test_valid_si(self):
        m = ProjectMeta(**_meta())
        assert m.unit_system == "SI"
        assert m.project_number is None

    def test_valid_us(self):
        m = ProjectMeta(**_meta(unit_system="US"))
        assert m.unit_system == "US"

    def test_missing_name_raises(self):
        data = _meta()
        del data["name"]
        with pytest.raises(ValidationError):
            ProjectMeta(**data)

    def test_empty_name_raises(self):
        with pytest.raises(ValidationError):
            ProjectMeta(**_meta(name=""))

    def test_invalid_unit_system(self):
        with pytest.raises(ValidationError):
            ProjectMeta(**_meta(unit_system="metric"))

    def test_valid_revision_pattern(self):
        m = ProjectMeta(**_meta(revision="A"))
        assert m.revision == "A"

    def test_invalid_revision_pattern(self):
        with pytest.raises(ValidationError):
            ProjectMeta(**_meta(revision="a lower case"))

    def test_optional_fields_default_none(self):
        m = ProjectMeta(**_meta())
        assert m.client is None
        assert m.project_number is None
        assert m.revision is None


# ---------------------------------------------------------------------------
# T07 – T09: Node
# ---------------------------------------------------------------------------


class TestNode:
    def test_valid_node(self):
        n = Node(id="N1", name="Wet well", elevation_m=5.0)
        assert n.elevation_m == 5.0

    def test_water_level_ordering_ok(self):
        n = Node(
            id="N1", name="Reservoir", elevation_m=0.0,
            min_water_level_m=10.0, max_water_level_m=15.0,
        )
        assert n.min_water_level_m < n.max_water_level_m

    def test_water_level_ordering_violated(self):
        with pytest.raises(ValidationError, match="min_water_level_m"):
            Node(
                id="N1", name="Bad", elevation_m=0.0,
                min_water_level_m=20.0, max_water_level_m=10.0,
            )

    def test_equal_water_levels_raises(self):
        with pytest.raises(ValidationError):
            Node(
                id="N1", name="Bad", elevation_m=0.0,
                min_water_level_m=10.0, max_water_level_m=10.0,
            )

    def test_negative_pressure_raises(self):
        with pytest.raises(ValidationError):
            Node(id="N1", name="Node", elevation_m=0.0, pressure_kPa=-10.0)


# ---------------------------------------------------------------------------
# T10 – T12: MinorLossItem
# ---------------------------------------------------------------------------


class TestMinorLossItem:
    def test_valid(self):
        item = MinorLossItem(type="gate_valve", count=2, K=0.1)
        assert item.K_total == pytest.approx(0.2)

    def test_negative_k_raises(self):
        with pytest.raises(ValidationError, match="greater_than_equal"):
            MinorLossItem(type="elbow_90", count=1, K=-0.1)

    def test_zero_count_raises(self):
        with pytest.raises(ValidationError, match="greater_than_equal"):
            MinorLossItem(type="elbow_90", count=0, K=1.0)

    def test_unknown_type_allowed(self):
        item = MinorLossItem(type="custom_widget", count=1, K=2.0)
        assert item.type == "custom_widget"


# ---------------------------------------------------------------------------
# T13 – T16: PipelineSegment
# ---------------------------------------------------------------------------


class TestPipelineSegment:
    def test_valid_darcy_weisbach(self):
        seg = PipelineSegment(**_segment())
        assert seg.K_sum == 0.0

    def test_darcy_weisbach_missing_roughness(self):
        data = _segment()
        del data["roughness_epsilon_mm"]
        with pytest.raises(ValidationError, match="roughness_epsilon_mm"):
            PipelineSegment(**data)

    def test_hazen_williams_valid(self):
        seg = PipelineSegment(
            id="seg1", name="HW pipe", length_m=100.0, diameter_mm=200.0,
            material="pvc", friction_method="hazen_williams", hazen_williams_C=150.0,
        )
        assert seg.hazen_williams_C == 150.0

    def test_hazen_williams_missing_c(self):
        with pytest.raises(ValidationError, match="hazen_williams_C"):
            PipelineSegment(
                id="seg1", name="HW pipe", length_m=100.0, diameter_mm=200.0,
                material="pvc", friction_method="hazen_williams",
            )

    def test_velocity_calculation(self):
        seg = PipelineSegment(**_segment(diameter_mm=150.0))
        Q_m3s = 36.0 / 3600.0  # 36 m³/h
        V = seg.velocity_ms(Q_m3s)
        # D=0.15m → A = π/4·0.0225 = 0.017671 m² → V = 0.01/0.017671 = 0.566 m/s
        assert abs(V - 0.566) < 0.01

    def test_minor_losses_k_sum(self):
        seg = PipelineSegment(
            **_segment(),
            minor_losses=[
                {"type": "gate_valve", "count": 2, "K": 0.1},
                {"type": "elbow_90", "count": 1, "K": 0.9},
            ],
        )
        assert seg.K_sum == pytest.approx(2 * 0.1 + 0.9)


# ---------------------------------------------------------------------------
# T17 – T22: WetWell
# ---------------------------------------------------------------------------


class TestWetWell:
    def _cyl(self, **kwargs) -> dict:
        base = {
            "geometry": "cylindrical",
            "diameter_m": 3.0,
            "LLL_m": 0.5,
            "LWL_m": 1.0,
            "HWL_m": 2.5,
            "HHL_m": 3.0,
        }
        base.update(kwargs)
        return base

    def test_valid_cylindrical(self):
        ww = WetWell(**self._cyl())
        assert ww.geometry == "cylindrical"
        vol = ww.usable_volume_m3
        assert vol == pytest.approx(3.14159 / 4 * 9.0 * 1.5, rel=1e-3)

    def test_cylindrical_missing_diameter(self):
        data = self._cyl()
        del data["diameter_m"]
        with pytest.raises(ValidationError, match="diameter_m"):
            WetWell(**data)

    def test_valid_rectangular(self):
        ww = WetWell(
            geometry="rectangular", length_m=4.0, width_m=3.0,
            LLL_m=0.3, LWL_m=0.8, HWL_m=2.0, HHL_m=2.5,
        )
        assert ww.usable_volume_m3 == pytest.approx(4.0 * 3.0 * (2.0 - 0.8))

    def test_rectangular_missing_width(self):
        with pytest.raises(ValidationError, match="length_m and width_m"):
            WetWell(
                geometry="rectangular", length_m=4.0,
                LLL_m=0.3, LWL_m=0.8, HWL_m=2.0, HHL_m=2.5,
            )

    def test_level_ordering_lll_ge_lwl(self):
        with pytest.raises(ValidationError, match="LLL_m"):
            WetWell(**self._cyl(LLL_m=1.5, LWL_m=1.0))

    def test_level_ordering_lwl_ge_hwl(self):
        with pytest.raises(ValidationError, match="LWL_m"):
            WetWell(**self._cyl(LWL_m=2.5, HWL_m=2.0))

    def test_level_ordering_hwl_ge_hhl(self):
        with pytest.raises(ValidationError, match="HWL_m"):
            WetWell(**self._cyl(HWL_m=3.5, HHL_m=3.0))

    def test_max_starts_bounds(self):
        with pytest.raises(ValidationError):
            WetWell(**self._cyl(max_starts_per_hour=0))
        with pytest.raises(ValidationError):
            WetWell(**self._cyl(max_starts_per_hour=31))


# ---------------------------------------------------------------------------
# T23 – T26: PumpStation
# ---------------------------------------------------------------------------


class TestPumpStation:
    def test_valid_defaults(self):
        ps = PumpStation()
        assert ps.pump_type == "end_suction"
        assert ps.control == "constant_speed"
        assert ps.NPSHa_m is None

    def test_staging_exceeds_duty_raises(self):
        with pytest.raises(ValidationError, match="staging"):
            PumpStation(num_duty=2, staging=3)

    def test_invalid_pump_type(self):
        with pytest.raises(ValidationError):
            PumpStation(pump_type="jet_pump")

    def test_motor_efficiency_bounds(self):
        with pytest.raises(ValidationError):
            PumpStation(motor_efficiency_pct=0.0)
        with pytest.raises(ValidationError):
            PumpStation(motor_efficiency_pct=101.0)

    def test_negative_npsha_raises(self):
        with pytest.raises(ValidationError):
            PumpStation(NPSHa_m=-1.0)


# ---------------------------------------------------------------------------
# T27 – T29: PumpCurveSet
# ---------------------------------------------------------------------------


class TestPumpCurveSet:
    def _hq(self):
        return [(0, 45), (30, 40), (60, 32), (90, 20), (110, 0)]

    def test_valid_curve_set(self):
        cs = PumpCurveSet(pump_id="P1", HQ_points=self._hq())
        assert len(cs.HQ_points) == 5

    def test_hq_requires_min_2_points(self):
        with pytest.raises(ValidationError):
            PumpCurveSet(pump_id="P1", HQ_points=[(0, 45)])

    def test_hq_non_ascending_flow_raises(self):
        with pytest.raises(ValidationError, match="ascending"):
            PumpCurveSet(pump_id="P1", HQ_points=[(0, 45), (60, 32), (30, 40)])

    def test_hq_negative_head_raises(self):
        with pytest.raises(ValidationError, match="≥ 0"):
            PumpCurveSet(pump_id="P1", HQ_points=[(0, 45), (60, -5)])

    def test_curve_units_defaults(self):
        cs = PumpCurveSet(pump_id="P1", HQ_points=self._hq())
        assert cs.curve_units.flow == "m3h"
        assert cs.curve_units.head == "m"


# ---------------------------------------------------------------------------
# T30 – T31: SurgeStudy
# ---------------------------------------------------------------------------


class TestSurgeStudy:
    def test_disabled_by_default(self):
        s = SurgeStudy()
        assert s.enabled is False

    def test_prv_disabled_by_default(self):
        s = SurgeStudy()
        assert s.prv.enabled is False
        assert s.air_vessel.enabled is False

    def test_prv_enabled_requires_set_pressure(self):
        with pytest.raises(ValidationError, match="set_pressure_kPa"):
            PRVConfig(enabled=True)

    def test_air_vessel_enabled_requires_volume(self):
        with pytest.raises(ValidationError, match="volume_L"):
            AirVesselConfig(enabled=True, pre_charge_kPa=150.0)

    def test_wave_speed_bounds(self):
        with pytest.raises(ValidationError):
            SurgeStudy(enabled=True, wave_speed_ms=0.0)
        with pytest.raises(ValidationError):
            SurgeStudy(enabled=True, wave_speed_ms=2500.0)


# ---------------------------------------------------------------------------
# T32 – T34: ProjectModel advisory warnings
# ---------------------------------------------------------------------------


class TestProjectModelWarnings:
    def _base_project(self) -> dict:
        return {
            "meta": _meta(),
            "pump_station": {
                "NPSHa_m": 3.0,
                "NPSHr_m": 2.8,
            },
        }

    def test_npsh_margin_warning_triggered(self):
        data = self._base_project()
        data["pump_station"]["NPSHa_m"] = 1.0
        data["pump_station"]["NPSHr_m"] = 0.8  # margin = 0.2 < 0.5
        proj = ProjectModel.model_validate(data)
        npsh_warns = [w for w in proj.warnings if "NPSH" in w]
        assert len(npsh_warns) == 1
        assert "0.20" in npsh_warns[0] or "margin" in npsh_warns[0].lower()

    def test_npsh_margin_ok_no_warning(self):
        data = self._base_project()
        data["pump_station"]["NPSHa_m"] = 5.0
        data["pump_station"]["NPSHr_m"] = 2.0  # margin = 3.0 ≥ 0.5
        proj = ProjectModel.model_validate(data)
        npsh_warns = [w for w in proj.warnings if "NPSH" in w]
        assert len(npsh_warns) == 0

    def test_velocity_too_low_warning(self):
        data = {
            "meta": _meta(),
            "discharge": {
                "label": "Discharge",
                "segments": [_segment(diameter_mm=500.0)],  # large pipe → low velocity
                "design_flow_m3h": 10.0,   # Q=10 m³/h → V ≈ 0.014 m/s < 0.6 m/s
            },
        }
        proj = ProjectModel.model_validate(data)
        vel_warns = [w for w in proj.warnings if "velocity" in w.lower()]
        assert any("below" in w.lower() for w in vel_warns)

    def test_velocity_too_high_warning(self):
        data = {
            "meta": _meta(),
            "discharge": {
                "label": "Discharge",
                "segments": [_segment(diameter_mm=50.0)],  # small pipe → high velocity
                "design_flow_m3h": 100.0,  # Q=100 m³/h → V ≈ 14 m/s > 3.0 m/s
            },
        }
        proj = ProjectModel.model_validate(data)
        vel_warns = [w for w in proj.warnings if "velocity" in w.lower()]
        assert any("exceed" in w.lower() for w in vel_warns)

    def test_unknown_fitting_type_warning(self):
        data = {
            "meta": _meta(),
            "discharge": {
                "label": "Discharge",
                "segments": [
                    _segment(minor_losses=[{"type": "mystery_device", "count": 1, "K": 1.5}]),
                ],
                "design_flow_m3h": 36.0,
            },
        }
        proj = ProjectModel.model_validate(data)
        fit_warns = [w for w in proj.warnings if "mystery_device" in w]
        assert len(fit_warns) == 1

    def test_surge_enabled_no_devices_warning(self):
        data = {
            "meta": _meta(),
            "surge": {"enabled": True},
        }
        proj = ProjectModel.model_validate(data)
        surge_warns = [w for w in proj.warnings if "surge" in w.lower()]
        assert len(surge_warns) >= 1

    def test_no_flow_no_velocity_warning(self):
        data = {
            "meta": _meta(),
            "discharge": {
                "label": "Discharge",
                "segments": [_segment()],
                # design_flow_m3h omitted → no velocity warning expected
            },
        }
        proj = ProjectModel.model_validate(data)
        vel_warns = [w for w in proj.warnings if "velocity" in w.lower()]
        assert len(vel_warns) == 0


# ---------------------------------------------------------------------------
# T35 – T37: Minimal and full round-trip ProjectModel
# ---------------------------------------------------------------------------


class TestProjectModel:
    def test_minimal_project_valid(self):
        proj = ProjectModel.model_validate(_minimal_project())
        assert proj.meta.name == "Test PS"
        assert proj.surge.enabled is False
        assert proj.warnings == []

    def test_accessories_defaults(self):
        proj = ProjectModel.model_validate(_minimal_project())
        assert proj.accessories.flow_meters is True
        assert proj.accessories.pressure_relief_valves is False

    def test_full_project_round_trip(self):
        data = {
            "meta": _meta(unit_system="SI", revision="B"),
            "nodes": [
                {"id": "N1", "name": "Wet well", "elevation_m": 2.0},
                {"id": "N2", "name": "Reservoir", "elevation_m": 30.0,
                 "min_water_level_m": 25.0, "max_water_level_m": 32.0},
            ],
            "suction": {
                "label": "Suction",
                "segments": [_segment(id="s1", name="Suction pipe", length_m=5.0,
                                      diameter_mm=200.0)],
                "design_flow_m3h": 36.0,
            },
            "discharge": {
                "label": "Discharge",
                "segments": [
                    _segment(id="d1", name="Discharge main", length_m=200.0,
                             minor_losses=[
                                 {"type": "gate_valve", "count": 2, "K": 0.1},
                                 {"type": "check_valve_dual_disc", "count": 1, "K": 2.5},
                             ]),
                ],
                "design_flow_m3h": 36.0,
            },
            "wet_well": {
                "geometry": "cylindrical",
                "diameter_m": 3.0,
                "LLL_m": 1.0, "LWL_m": 1.5, "HWL_m": 3.0, "HHL_m": 3.5,
                "max_starts_per_hour": 6,
            },
            "pump_station": {
                "pump_type": "end_suction",
                "control": "vfd",
                "num_duty": 2,
                "num_standby": 1,
                "staging": 1,
                "NPSHa_m": 6.0,
                "NPSHr_m": 2.0,
            },
            "pump_curves": [
                {
                    "pump_id": "KSB-ETANORM-125-100-200",
                    "HQ_points": [(0, 42), (30, 38), (60, 32), (90, 22), (120, 0)],
                    "Eff_points": [(30, 65), (60, 78), (90, 82), (120, 70)],
                },
            ],
            "accessories": {"chlorine_analyzer": True},
            "surge": {"enabled": False},
        }
        proj = ProjectModel.model_validate(data)
        assert len(proj.nodes) == 2
        assert len(proj.discharge.segments[0].minor_losses) == 2  # type: ignore[union-attr]
        assert proj.pump_station.control == "vfd"  # type: ignore[union-attr]
        assert proj.accessories.chlorine_analyzer is True


# ---------------------------------------------------------------------------
# T38 – T44: /project/validate endpoint
# ---------------------------------------------------------------------------


class TestValidateEndpoint:
    def test_valid_project_returns_valid_true(self):
        resp = client.post("/project/validate", json=_minimal_project())
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is True
        assert body["errors"] == []

    def test_invalid_project_returns_valid_false(self):
        bad = {"meta": {"name": "", "designer": "J", "date": "2026-01-01", "unit_system": "SI"}}
        resp = client.post("/project/validate", json=bad)
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert len(body["errors"]) >= 1

    def test_missing_meta_returns_errors(self):
        resp = client.post("/project/validate", json={})
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert any("meta" in e for e in body["errors"])

    def test_invalid_json_body(self):
        resp = client.post(
            "/project/validate",
            content=b"not valid json",
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False

    def test_npsh_warning_surfaced_in_response(self):
        data = {
            "meta": _meta(),
            "pump_station": {"NPSHa_m": 1.0, "NPSHr_m": 0.9},  # margin 0.1 < 0.5
        }
        resp = client.post("/project/validate", json=data)
        body = resp.json()
        assert body["valid"] is True
        assert any("NPSH" in w for w in body["warnings"])

    def test_wetwell_level_error_surfaced(self):
        data = {
            "meta": _meta(),
            "wet_well": {
                "geometry": "cylindrical",
                "diameter_m": 3.0,
                "LLL_m": 2.0, "LWL_m": 1.0,  # ordering violated
                "HWL_m": 3.0, "HHL_m": 4.0,
            },
        }
        resp = client.post("/project/validate", json=data)
        body = resp.json()
        assert body["valid"] is False
        assert any("LLL_m" in e or "level" in e.lower() for e in body["errors"])

    def test_warnings_empty_for_clean_project(self):
        resp = client.post("/project/validate", json=_minimal_project())
        body = resp.json()
        assert body["warnings"] == []


# ---------------------------------------------------------------------------
# T45: /project/validate/schema endpoint
# ---------------------------------------------------------------------------


class TestSchemaEndpoint:
    def test_schema_endpoint_returns_json_schema(self):
        resp = client.get("/project/validate/schema")
        assert resp.status_code == 200
        schema = resp.json()
        assert schema.get("title") == "ProjectModel"
        assert "properties" in schema

    def test_schema_contains_meta(self):
        resp = client.get("/project/validate/schema")
        schema = resp.json()
        props = schema.get("properties", {})
        assert "meta" in props

    def test_schema_contains_surge(self):
        resp = client.get("/project/validate/schema")
        props = resp.json().get("properties", {})
        assert "surge" in props


# ---------------------------------------------------------------------------
# T46: Advisory threshold constants are correct values
# ---------------------------------------------------------------------------


class TestAdvisoryConstants:
    def test_potable_v_min(self):
        assert POTABLE_V_MIN == 0.6

    def test_potable_v_max(self):
        assert POTABLE_V_MAX == 3.0

    def test_potable_hf_gradient_max(self):
        assert POTABLE_HF_GRADIENT_MAX == 10.0

    def test_npsh_margin_min(self):
        assert NPSH_MARGIN_MIN == 0.5


# ---------------------------------------------------------------------------
# T47: Existing hydraulic endpoint still works
# ---------------------------------------------------------------------------


class TestExistingEndpointsUnchanged:
    def test_health(self):
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_materials(self):
        resp = client.get("/api/v1/materials")
        assert resp.status_code == 200
        assert len(resp.json()["materials"]) > 0

    def test_calculate(self):
        payload = {
            "Q_m3h": 36.0,
            "elev_us_m": 5.0,
            "elev_ds_m": 28.5,
            "pipe_length_m": 200.0,
            "pipe_diameter_mm": 150.0,
            "material": "ductile_iron",
            "K_values": [0.5, 0.3, 1.0],
        }
        resp = client.post("/api/v1/calculate", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert "tdh_m" in body
        assert body["tdh_m"] > 0
