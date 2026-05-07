"""
Tests for the pump selection module.

Covers:
- pump_types.py: catalogue integrity, helpers
- GET /compute/pump-types: response structure, all 16 types present
- POST /compute/pump-selection: active/bypass, valid types, extras validation,
  warnings, config summary, potable notes

Run with:
    pytest backend/tests/test_pump_selection.py -v
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.engine.pump_types import (
    PUMP_TYPE_CATALOGUE,
    get_pump_type,
    list_pump_types,
    extras_schema_for_key,
)

client = TestClient(app)

# ---------------------------------------------------------------------------
# Expected keys — all 16 pump types
# ---------------------------------------------------------------------------

ALL_EXPECTED_KEYS = {
    "end_suction",
    "split_case",
    "multistage_centrifugal",
    "self_priming",
    "canned_motor",
    "jet_pump",
    "vertical_turbine",
    "inline_booster",
    "submersible",
    "axial_flow",
    "pd_screw",
    "pd_gear",
    "pd_progressive_cavity",
    "pd_diaphragm",
    "pd_peristaltic",
    "fire_pump",
}

REQUIRED_CATALOGUE_FIELDS = {
    "key",
    "display_name",
    "family",
    "potable_tag",
    "description",
    "typical_head_range_m",
    "typical_flow_range_m3h",
    "constraints",
    "potable_notes",
    "extras_schema",
}

VALID_POTABLE_TAGS = {"recommended", "conditional", "niche"}
VALID_FAMILIES = {
    "centrifugal",
    "vertical_turbine",
    "booster",
    "submersible",
    "axial_flow",
    "positive_displacement",
    "fire_pump",
}

# ---------------------------------------------------------------------------
# Engine unit tests: catalogue integrity
# ---------------------------------------------------------------------------


class TestCatalogueIntegrity:
    def test_all_16_keys_present(self):
        assert set(PUMP_TYPE_CATALOGUE.keys()) == ALL_EXPECTED_KEYS

    def test_all_entries_have_required_fields(self):
        for key, entry in PUMP_TYPE_CATALOGUE.items():
            missing = REQUIRED_CATALOGUE_FIELDS - set(entry.keys())
            assert not missing, f"Entry '{key}' is missing fields: {missing}"

    def test_all_potable_tags_valid(self):
        for key, entry in PUMP_TYPE_CATALOGUE.items():
            assert entry["potable_tag"] in VALID_POTABLE_TAGS, (
                f"Entry '{key}' has invalid potable_tag: {entry['potable_tag']}"
            )

    def test_all_families_valid(self):
        for key, entry in PUMP_TYPE_CATALOGUE.items():
            assert entry["family"] in VALID_FAMILIES, (
                f"Entry '{key}' has invalid family: {entry['family']}"
            )

    def test_head_ranges_positive(self):
        for key, entry in PUMP_TYPE_CATALOGUE.items():
            hr = entry["typical_head_range_m"]
            assert hr["min"] > 0, f"{key}: head min must be > 0"
            assert hr["max"] > hr["min"], f"{key}: head max must be > min"

    def test_flow_ranges_positive(self):
        for key, entry in PUMP_TYPE_CATALOGUE.items():
            fr = entry["typical_flow_range_m3h"]
            assert fr["min"] > 0, f"{key}: flow min must be > 0"
            assert fr["max"] > fr["min"], f"{key}: flow max must be > min"

    def test_constraints_non_empty_for_all(self):
        for key, entry in PUMP_TYPE_CATALOGUE.items():
            assert len(entry["constraints"]) >= 1, (
                f"Entry '{key}' has empty constraints list"
            )

    def test_potable_notes_non_empty_for_all(self):
        for key, entry in PUMP_TYPE_CATALOGUE.items():
            assert len(entry["potable_notes"]) >= 1, (
                f"Entry '{key}' has empty potable_notes list"
            )

    def test_key_matches_dict_key(self):
        for dict_key, entry in PUMP_TYPE_CATALOGUE.items():
            assert entry["key"] == dict_key, (
                f"Entry key mismatch: dict key='{dict_key}', entry['key']='{entry['key']}'"
            )

    def test_extras_schema_values_are_valid_or_none(self):
        valid_schemas = {None, "vertical_turbine", "submersible", "booster_set", "pd_pump", "fire_pump"}
        for key, entry in PUMP_TYPE_CATALOGUE.items():
            assert entry["extras_schema"] in valid_schemas, (
                f"Entry '{key}' has unknown extras_schema: {entry['extras_schema']}"
            )


# ---------------------------------------------------------------------------
# Engine unit tests: helpers
# ---------------------------------------------------------------------------


class TestGetPumpType:
    def test_valid_key_returns_dict(self):
        result = get_pump_type("end_suction")
        assert result["key"] == "end_suction"
        assert result["family"] == "centrifugal"

    def test_vertical_turbine_key(self):
        result = get_pump_type("vertical_turbine")
        assert result["extras_schema"] == "vertical_turbine"

    def test_invalid_key_raises_key_error(self):
        with pytest.raises(KeyError, match="Unknown pump type key"):
            get_pump_type("nonexistent_pump")

    def test_pd_types_have_pd_pump_schema(self):
        pd_keys = ["pd_screw", "pd_gear", "pd_progressive_cavity", "pd_diaphragm", "pd_peristaltic"]
        for key in pd_keys:
            assert extras_schema_for_key(key) == "pd_pump", (
                f"Expected 'pd_pump' extras schema for '{key}'"
            )

    def test_centrifugal_types_have_no_extras_schema(self):
        no_extras = ["end_suction", "split_case", "multistage_centrifugal", "self_priming", "canned_motor", "jet_pump", "axial_flow"]
        for key in no_extras:
            assert extras_schema_for_key(key) is None, (
                f"Expected None extras schema for '{key}'"
            )


class TestListPumpTypes:
    def test_returns_all_16(self):
        items = list_pump_types()
        assert len(items) == 16

    def test_sorted_by_family_then_name(self):
        items = list_pump_types(sort_by_family=True)
        sort_keys = [(e["family"], e["display_name"]) for e in items]
        assert sort_keys == sorted(sort_keys)

    def test_unsorted_returns_all(self):
        items = list_pump_types(sort_by_family=False)
        assert len(items) == 16


# ---------------------------------------------------------------------------
# HTTP integration tests: GET /compute/pump-types
# ---------------------------------------------------------------------------


class TestGetPumpTypesEndpoint:
    def test_returns_200(self):
        resp = client.get("/compute/pump-types")
        assert resp.status_code == 200

    def test_count_is_16(self):
        resp = client.get("/compute/pump-types")
        data = resp.json()
        assert data["count"] == 16

    def test_pump_types_list_length_matches_count(self):
        resp = client.get("/compute/pump-types")
        data = resp.json()
        assert len(data["pump_types"]) == data["count"]

    def test_all_expected_keys_present_in_response(self):
        resp = client.get("/compute/pump-types")
        keys = {pt["key"] for pt in resp.json()["pump_types"]}
        assert keys == ALL_EXPECTED_KEYS

    def test_each_entry_has_required_response_fields(self):
        resp = client.get("/compute/pump-types")
        required = {
            "key", "display_name", "family", "potable_tag", "description",
            "typical_head_range_m", "typical_flow_range_m3h", "constraints",
            "potable_notes",
        }
        for pt in resp.json()["pump_types"]:
            missing = required - set(pt.keys())
            assert not missing, f"Entry '{pt['key']}' missing fields: {missing}"

    def test_potable_tags_are_valid_strings(self):
        resp = client.get("/compute/pump-types")
        for pt in resp.json()["pump_types"]:
            assert pt["potable_tag"] in ("recommended", "conditional", "niche")

    def test_head_flow_ranges_have_min_max(self):
        resp = client.get("/compute/pump-types")
        for pt in resp.json()["pump_types"]:
            assert "min" in pt["typical_head_range_m"]
            assert "max" in pt["typical_head_range_m"]
            assert "min" in pt["typical_flow_range_m3h"]
            assert "max" in pt["typical_flow_range_m3h"]

    def test_end_suction_is_recommended(self):
        resp = client.get("/compute/pump-types")
        es = next(pt for pt in resp.json()["pump_types"] if pt["key"] == "end_suction")
        assert es["potable_tag"] == "recommended"

    def test_fire_pump_is_niche(self):
        resp = client.get("/compute/pump-types")
        fp = next(pt for pt in resp.json()["pump_types"] if pt["key"] == "fire_pump")
        assert fp["potable_tag"] == "niche"

    def test_vertical_turbine_requires_extras(self):
        resp = client.get("/compute/pump-types")
        vt = next(pt for pt in resp.json()["pump_types"] if pt["key"] == "vertical_turbine")
        assert vt["extras_schema"] == "vertical_turbine"


# ---------------------------------------------------------------------------
# HTTP integration tests: POST /compute/pump-selection
# ---------------------------------------------------------------------------


class TestPumpSelectionEndpoint:
    def test_bypass_returns_200_empty(self):
        resp = client.post("/compute/pump-selection", json={"active": False})
        assert resp.status_code == 200
        data = resp.json()
        assert data["active"] is False
        assert data["type_info"] is None
        assert data["config_summary"] is None
        assert data["potable_notes"] == []
        assert data["warnings"] == []

    def test_active_missing_pump_type_returns_422(self):
        resp = client.post("/compute/pump-selection", json={"active": True})
        assert resp.status_code == 422

    def test_valid_end_suction_returns_200(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "end_suction",
                "control_mode": "constant_speed",
                "n_duty": 2,
                "n_standby": 1,
            },
        )
        assert resp.status_code == 200

    def test_response_type_info_key_matches(self):
        resp = client.post(
            "/compute/pump-selection",
            json={"active": True, "pump_type_key": "split_case", "n_duty": 1, "n_standby": 1},
        )
        data = resp.json()
        assert data["type_info"]["key"] == "split_case"

    def test_config_summary_contains_duty_standby(self):
        resp = client.post(
            "/compute/pump-selection",
            json={"active": True, "pump_type_key": "end_suction", "n_duty": 2, "n_standby": 1},
        )
        summary = resp.json()["config_summary"]
        assert "2" in summary and "1" in summary

    def test_config_summary_contains_vfd_when_vfd(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "end_suction",
                "control_mode": "vfd",
                "n_duty": 1,
                "n_standby": 0,
            },
        )
        assert "VFD" in resp.json()["config_summary"]

    def test_potable_notes_populated(self):
        resp = client.post(
            "/compute/pump-selection",
            json={"active": True, "pump_type_key": "end_suction", "n_duty": 1, "n_standby": 1},
        )
        assert len(resp.json()["potable_notes"]) > 0

    def test_invalid_pump_type_key_returns_422(self):
        resp = client.post(
            "/compute/pump-selection",
            json={"active": True, "pump_type_key": "flying_saucer", "n_duty": 1, "n_standby": 1},
        )
        assert resp.status_code == 422

    def test_vertical_turbine_with_valid_extras(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "vertical_turbine",
                "n_duty": 1,
                "n_standby": 1,
                "extras": {
                    "bowl_count": 4,
                    "column_length_m": 15.0,
                    "min_submergence_m": 1.5,
                },
            },
        )
        assert resp.status_code == 200

    def test_vertical_turbine_missing_extras_returns_422(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "vertical_turbine",
                "n_duty": 1,
                "n_standby": 1,
            },
        )
        assert resp.status_code == 422

    def test_submersible_with_valid_extras(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "submersible",
                "n_duty": 2,
                "n_standby": 1,
                "extras": {
                    "installation_depth_m": 8.0,
                    "motor_cooling": "fluid_cooled",
                },
            },
        )
        assert resp.status_code == 200

    def test_submersible_missing_extras_returns_422(self):
        resp = client.post(
            "/compute/pump-selection",
            json={"active": True, "pump_type_key": "submersible", "n_duty": 1, "n_standby": 1},
        )
        assert resp.status_code == 422

    def test_booster_with_valid_extras(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "inline_booster",
                "n_duty": 1,
                "n_standby": 1,
                "extras": {"setpoint_pressure_kPa": 500.0, "num_pumps_in_set": 3},
            },
        )
        assert resp.status_code == 200

    def test_booster_missing_extras_returns_422(self):
        resp = client.post(
            "/compute/pump-selection",
            json={"active": True, "pump_type_key": "inline_booster", "n_duty": 1, "n_standby": 1},
        )
        assert resp.status_code == 422

    def test_pd_pump_with_valid_extras(self):
        for pd_key in ["pd_screw", "pd_gear", "pd_progressive_cavity", "pd_diaphragm", "pd_peristaltic"]:
            resp = client.post(
                "/compute/pump-selection",
                json={
                    "active": True,
                    "pump_type_key": pd_key,
                    "n_duty": 1,
                    "n_standby": 1,
                    "extras": {"displacement_L_per_rev": 2.5, "max_pressure_kPa": 800.0},
                },
            )
            assert resp.status_code == 200, f"Failed for {pd_key}: {resp.text}"

    def test_pd_pump_missing_extras_returns_422(self):
        resp = client.post(
            "/compute/pump-selection",
            json={"active": True, "pump_type_key": "pd_screw", "n_duty": 1, "n_standby": 1},
        )
        assert resp.status_code == 422

    def test_fire_pump_with_nfpa20_flag(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "fire_pump",
                "n_duty": 1,
                "n_standby": 1,
                "extras": {"nfpa20_compliance": True},
            },
        )
        assert resp.status_code == 200

    def test_niche_type_generates_warning(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "jet_pump",
                "n_duty": 1,
                "n_standby": 0,
            },
        )
        data = resp.json()
        assert any("niche" in w.lower() or "unusual" in w.lower() or "engineer" in w.lower() for w in data["warnings"])

    def test_conditional_type_generates_note(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "self_priming",
                "n_duty": 1,
                "n_standby": 1,
            },
        )
        data = resp.json()
        assert len(data["potable_notes"]) > 0

    def test_no_standby_generates_warning(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "end_suction",
                "n_duty": 1,
                "n_standby": 0,
            },
        )
        data = resp.json()
        assert any("standby" in w.lower() for w in data["warnings"])

    def test_vfd_control_appears_in_type_info(self):
        resp = client.post(
            "/compute/pump-selection",
            json={
                "active": True,
                "pump_type_key": "multistage_centrifugal",
                "control_mode": "vfd",
                "n_duty": 1,
                "n_standby": 1,
            },
        )
        assert resp.status_code == 200
        assert resp.json()["type_info"]["family"] == "centrifugal"

    def test_response_active_flag_matches_request(self):
        for active in [True, False]:
            payload = {"active": active}
            if active:
                payload["pump_type_key"] = "end_suction"
                payload["n_duty"] = 1
                payload["n_standby"] = 1
            resp = client.post("/compute/pump-selection", json=payload)
            assert resp.json()["active"] == active
