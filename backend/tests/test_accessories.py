"""
Tests for the potable-water accessories library and loss breakdown endpoint.

Covers:
- Loader utilities
- GET /library/accessories (flat list + grouped categories)
- GET /library/accessories/{id}
- POST /compute/lossbreakdown — flat mode (backward-compat)
- POST /compute/lossbreakdown — segmented mode with D-W geometry
- Contribution matrix (contribution_rows)
- New catalogue additions (plug_valve, cv_ball_check, ultrasonic_meter, etc.)
"""

from __future__ import annotations

import math

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.data.loader import (
    get_accessory_by_id,
    get_accessories_by_category,
    load_accessories_library,
)

client = TestClient(app)


# ---------------------------------------------------------------------------
# Loader tests
# ---------------------------------------------------------------------------


def test_load_accessories_library_returns_list():
    records = load_accessories_library()
    assert isinstance(records, list)
    assert len(records) >= 30, f"Expected ≥ 30 records, got {len(records)}"


def test_each_record_has_required_fields():
    required_keys = {"id", "category", "name", "default_K", "K_min", "K_max", "notes", "potable_notes"}
    for rec in load_accessories_library():
        missing = required_keys - rec.keys()
        assert not missing, f"Record '{rec.get('id')}' missing keys: {missing}"


def test_all_categories_present():
    expected_categories = {
        "check_valve",
        "isolation_valve",
        "control_valve",
        "meter",
        "strainer",
        "air_valve",
        "suction_fitting",
        "discharge_fitting",
        "station_special",
        "pipe_transition",
    }
    actual_categories = {r["category"] for r in load_accessories_library()}
    assert expected_categories.issubset(actual_categories), (
        f"Missing categories: {expected_categories - actual_categories}"
    )


def test_k_values_non_negative():
    for rec in load_accessories_library():
        assert rec["default_K"] >= 0, f"{rec['id']}: default_K < 0"
        assert rec["K_min"]     >= 0, f"{rec['id']}: K_min < 0"
        assert rec["K_max"]     >= 0, f"{rec['id']}: K_max < 0"


def test_k_range_ordering():
    for rec in load_accessories_library():
        assert rec["K_min"] <= rec["default_K"] <= rec["K_max"] or (
            rec["K_min"] == rec["K_max"] == rec["default_K"]
        ), (
            f"{rec['id']}: K_min={rec['K_min']} default_K={rec['default_K']} K_max={rec['K_max']} out of order"
        )


def test_get_accessory_by_id_known():
    rec = get_accessory_by_id("cv_swing")
    assert rec is not None
    assert rec["name"] == "Swing Check Valve"
    assert rec["category"] == "check_valve"


def test_get_accessory_by_id_unknown():
    rec = get_accessory_by_id("does_not_exist_xyz")
    assert rec is None


def test_get_accessories_by_category():
    recs = get_accessories_by_category("meter")
    assert len(recs) >= 3
    for r in recs:
        assert r["category"] == "meter"


def test_get_accessories_by_category_unknown():
    recs = get_accessories_by_category("nonexistent_category")
    assert recs == []


def test_all_ids_unique():
    ids = [r["id"] for r in load_accessories_library()]
    assert len(ids) == len(set(ids)), "Duplicate IDs found in accessories library"


def test_potable_notes_are_lists():
    for rec in load_accessories_library():
        assert isinstance(rec["potable_notes"], list), (
            f"{rec['id']}: potable_notes is not a list"
        )


# ---------------------------------------------------------------------------
# New catalogue items
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("acc_id,expected_category", [
    ("plug_valve",           "isolation_valve"),
    ("cv_ball_check",        "check_valve"),
    ("ultrasonic_meter",     "meter"),
    ("pressure_transmitter", "meter"),
    ("flow_transmitter",     "meter"),
    ("level_sensor",         "meter"),
    ("y_strainer",           "strainer"),
    ("basket_strainer",      "strainer"),
    ("air_valve",            "air_valve"),
])
def test_new_catalogue_items_present(acc_id: str, expected_category: str):
    rec = get_accessory_by_id(acc_id)
    assert rec is not None, f"Missing catalogue item: {acc_id}"
    assert rec["category"] == expected_category, (
        f"{acc_id}: expected category '{expected_category}', got '{rec['category']}'"
    )
    assert rec["default_K"] >= 0


# ---------------------------------------------------------------------------
# GET /library/accessories — flat list
# ---------------------------------------------------------------------------


def test_get_library_accessories_status():
    resp = client.get("/library/accessories")
    assert resp.status_code == 200


def test_get_library_accessories_structure():
    resp = client.get("/library/accessories")
    data = resp.json()
    assert "accessories" in data
    assert "count" in data
    assert data["count"] == len(data["accessories"])
    assert data["count"] >= 30


def test_get_library_accessories_record_shape():
    resp = client.get("/library/accessories")
    first = resp.json()["accessories"][0]
    required = {"id", "category", "name", "default_K", "K_min", "K_max", "notes", "potable_notes"}
    assert required.issubset(first.keys())


# ---------------------------------------------------------------------------
# GET /library/accessories — grouped categories field
# ---------------------------------------------------------------------------


def test_get_library_accessories_has_categories_field():
    resp = client.get("/library/accessories")
    data = resp.json()
    assert "categories" in data, "Response missing 'categories' field"
    assert isinstance(data["categories"], list)
    assert len(data["categories"]) >= 9, "Expected ≥ 9 category groups (including strainer and air_valve)"


def test_get_library_accessories_strainer_and_air_valve_groups():
    resp = client.get("/library/accessories")
    cats = {grp["category"] for grp in resp.json()["categories"]}
    assert "strainer"  in cats, "Expected explicit 'strainer' category group"
    assert "air_valve" in cats, "Expected explicit 'air_valve' category group"


def test_get_library_accessories_categories_structure():
    resp = client.get("/library/accessories")
    categories = resp.json()["categories"]
    for grp in categories:
        assert "category" in grp
        assert "label" in grp
        assert "accessories" in grp
        assert isinstance(grp["accessories"], list)
        assert len(grp["accessories"]) > 0


def test_get_library_accessories_categories_cover_all_items():
    resp = client.get("/library/accessories")
    data = resp.json()
    flat_ids = {a["id"] for a in data["accessories"]}
    grouped_ids = {a["id"] for grp in data["categories"] for a in grp["accessories"]}
    assert flat_ids == grouped_ids, (
        f"Category groups don't cover all items. Missing: {flat_ids - grouped_ids}"
    )


def test_get_library_accessories_categories_in_canonical_order():
    _CANONICAL = [
        "check_valve", "isolation_valve", "control_valve", "meter",
        "suction_fitting", "discharge_fitting", "station_special", "pipe_transition",
    ]
    resp = client.get("/library/accessories")
    cats = [grp["category"] for grp in resp.json()["categories"]]
    canonical_present = [c for c in _CANONICAL if c in cats]
    cats_present = [c for c in cats if c in _CANONICAL]
    assert cats_present == canonical_present


def test_get_library_accessories_each_group_sorted_alphabetically():
    resp = client.get("/library/accessories")
    for grp in resp.json()["categories"]:
        names = [a["name"] for a in grp["accessories"]]
        assert names == sorted(names), (
            f"Category '{grp['category']}' not alphabetically sorted: {names}"
        )


# ---------------------------------------------------------------------------
# GET /library/accessories/{id}
# ---------------------------------------------------------------------------


def test_get_accessory_by_id_endpoint():
    resp = client.get("/library/accessories/cv_swing")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "cv_swing"
    assert data["category"] == "check_valve"
    assert data["default_K"] == 2.5


def test_get_accessory_by_id_endpoint_not_found():
    resp = client.get("/library/accessories/nonexistent_id_xyz")
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_get_accessory_mag_meter():
    resp = client.get("/library/accessories/mag_meter")
    assert resp.status_code == 200
    data = resp.json()
    assert data["category"] == "meter"
    assert len(data["potable_notes"]) > 0


# ---------------------------------------------------------------------------
# POST /compute/lossbreakdown — flat mode (backward-compatible)
# ---------------------------------------------------------------------------


BASIC_REQUEST = {
    "Q_m3h": 100.0,
    "D_mm": 200.0,
    "accessories": [
        {"accessory_id": "cv_swing",       "count": 1},
        {"accessory_id": "gate_fully_open", "count": 2},
    ],
    "unit_system": "SI",
}


def test_lossbreakdown_status():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    assert resp.status_code == 200


def test_lossbreakdown_k_sum():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    expected_k = 2.5 * 1 + 0.2 * 2
    assert abs(data["K_sum"] - expected_k) < 1e-6


def test_lossbreakdown_items_sorted_descending():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    items = resp.json()["items"]
    losses = [it["hm_m"] for it in items]
    assert losses == sorted(losses, reverse=True)


def test_lossbreakdown_pct_sums_to_100():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    items = resp.json()["items"]
    total_pct = sum(it["pct_of_total_minor"] for it in items)
    assert abs(total_pct - 100.0) < 0.1


def test_lossbreakdown_total_equals_sum_of_items():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    item_sum = sum(it["hm_m"] for it in data["items"])
    assert abs(data["total_hm_m"] - item_sum) < 1e-5


def test_lossbreakdown_k_override():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [{"accessory_id": "cv_swing", "count": 1, "K_override": 3.5}],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert abs(data["K_sum"] - 3.5) < 1e-6
    assert data["items"][0]["K_each"] == pytest.approx(3.5)


def test_lossbreakdown_count_multiplies_k():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [{"accessory_id": "gate_fully_open", "count": 5}],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    item = resp.json()["items"][0]
    assert item["count"] == 5
    assert abs(item["K_total"] - item["K_each"] * 5) < 1e-9


def test_lossbreakdown_unknown_id_returns_422():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [{"accessory_id": "does_not_exist", "count": 1}],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    assert resp.status_code == 422
    assert "does_not_exist" in resp.json()["detail"]


def test_lossbreakdown_empty_accessories():
    req = {"Q_m3h": 100.0, "D_mm": 200.0, "accessories": [], "unit_system": "SI"}
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert data["K_sum"] == 0.0
    assert data["total_hm_m"] == 0.0
    assert data["items"] == []


def test_lossbreakdown_velocity_head_physics():
    """In flat mode with uniform D, V²/(2g) must equal total_hm / K_sum."""
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    if data["K_sum"] > 0:
        expected_vh = data["total_hm_m"] / data["K_sum"]
        assert abs(data["velocity_head_m"] - expected_vh) < 1e-6


def test_lossbreakdown_suction_flat_items_use_D_mm_not_default():
    """
    When suction accessories are passed in the flat list (no suction segment
    geometry), their velocity head must be computed from the supplied D_mm,
    NOT from the 200 mm schema default.  A D_mm of 400 mm gives a velocity
    that is (200/400)^2 = 0.25× the default-diameter velocity, so the
    head loss must be ≤ 25 % of what the 200 mm default would give.
    """
    req_with_D = {
        "Q_m3h": 100.0,
        "D_mm":  400.0,   # explicit — should override schema default of 200 mm
        "accessories": [{"accessory_id": "gate_fully_open", "count": 1, "segment": "suction"}],
        "unit_system": "SI",
    }
    req_default_D = {
        "Q_m3h": 100.0,
        "D_mm":  200.0,   # explicit — matches schema default for comparison
        "accessories": [{"accessory_id": "gate_fully_open", "count": 1, "segment": "suction"}],
        "unit_system": "SI",
    }
    resp_400 = client.post("/compute/lossbreakdown", json=req_with_D)
    resp_200 = client.post("/compute/lossbreakdown", json=req_default_D)
    assert resp_400.status_code == 200
    assert resp_200.status_code == 200
    hm_400 = resp_400.json()["total_hm_m"]
    hm_200 = resp_200.json()["total_hm_m"]
    # v ~ 1/D^2, hm ~ v^2 ~ 1/D^4  →  ratio = (200/400)^4 = 1/16
    assert hm_400 < hm_200, "Larger D must produce smaller minor loss"
    expected_ratio = (200.0 / 400.0) ** 4
    actual_ratio   = hm_400 / hm_200
    assert abs(actual_ratio - expected_ratio) < 0.02 * expected_ratio


def test_lossbreakdown_mixed_diameter_segments_physics():
    """
    When suction D > discharge D, suction velocity < discharge velocity.
    Suction minor losses (same K) must therefore be smaller than discharge minor losses.
    """
    req = {
        "Q_m3h": 100.0,
        "suction": {
            "L_m": 20.0,
            "D_mm": 300.0,   # larger pipe → lower velocity
            "material": "ductile_iron",
            "accessories": [{"accessory_id": "gate_fully_open", "count": 1}],
        },
        "discharge": {
            "L_m": 100.0,
            "D_mm": 200.0,   # smaller pipe → higher velocity
            "material": "ductile_iron",
            "accessories": [{"accessory_id": "gate_fully_open", "count": 1}],
        },
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    assert resp.status_code == 200
    data = resp.json()
    # Same K, different D → suction loss must be less than discharge loss
    assert data["suction_minor_hm_m"] < data["discharge_minor_hm_m"], (
        f"Suction loss {data['suction_minor_hm_m']:.6f} should be less than "
        f"discharge loss {data['discharge_minor_hm_m']:.6f} (larger pipe → lower velocity)"
    )
    # Verify physics: ratio of losses ≈ (D_discharge/D_suction)^4 (same K, same Q)
    ratio_actual   = data["discharge_minor_hm_m"] / data["suction_minor_hm_m"]
    ratio_expected = (300.0 / 200.0) ** 4  # (D_s/D_d)^4
    assert abs(ratio_actual - ratio_expected) < 0.05 * ratio_expected, (
        f"Loss ratio {ratio_actual:.4f} deviates from expected (D_s/D_d)^4 = {ratio_expected:.4f}"
    )


def test_lossbreakdown_us_unit_system():
    req = {**BASIC_REQUEST, "unit_system": "US"}
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert data["unit_system"] == "US"
    assert abs(data["total_hm_display"]["display_value"] - data["total_hm_m"] * 3.28084) < 0.01


def test_lossbreakdown_si_unit_system():
    req = {**BASIC_REQUEST, "unit_system": "SI"}
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert data["unit_system"] == "SI"
    assert data["total_hm_display"]["unit"] == "m"


def test_lossbreakdown_potable_notes_returned():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    items = resp.json()["items"]
    swing = next((it for it in items if it["accessory_id"] == "cv_swing"), None)
    assert swing is not None
    assert len(swing["potable_notes"]) > 0


def test_lossbreakdown_echo_fields():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    assert data["design_Q_m3h"] == pytest.approx(100.0)


def test_lossbreakdown_all_categories_can_be_computed():
    items_to_test = [
        "cv_swing", "gate_fully_open", "prv_fully_open", "mag_meter",
        "eccentric_reducer", "elbow_90_standard", "y_strainer", "pipe_entrance_sharp",
    ]
    req = {
        "Q_m3h": 150.0,
        "D_mm": 250.0,
        "accessories": [{"accessory_id": aid, "count": 1} for aid in items_to_test],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["items"]) == len(items_to_test)
    assert data["K_sum"] > 0


# ---------------------------------------------------------------------------
# Segment tagging & subtotals (flat mode)
# ---------------------------------------------------------------------------


def test_lossbreakdown_response_has_segment_fields():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    for field in (
        "suction_minor_hm_m", "discharge_minor_hm_m",
        "suction_major_hm_m", "discharge_major_hm_m",
        "major_hm_m", "grand_total_hm_m",
        "pct_minor_of_grand_total", "pct_major_of_grand_total",
        "category_subtotals", "contribution_rows",
    ):
        assert field in data, f"Missing field: {field}"


def test_lossbreakdown_segment_tagging():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [
            {"accessory_id": "cv_swing",        "count": 1, "segment": "discharge"},
            {"accessory_id": "gate_fully_open",  "count": 1, "segment": "suction"},
        ],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    assert resp.status_code == 200
    data = resp.json()
    assert data["suction_minor_hm_m"]   > 0
    assert data["discharge_minor_hm_m"] > 0
    cv_item   = next(it for it in data["items"] if it["accessory_id"] == "cv_swing")
    gate_item = next(it for it in data["items"] if it["accessory_id"] == "gate_fully_open")
    assert cv_item["segment"]   == "discharge"
    assert gate_item["segment"] == "suction"
    assert abs(data["suction_minor_hm_m"]   - gate_item["hm_m"]) < 1e-6
    assert abs(data["discharge_minor_hm_m"] - cv_item["hm_m"])   < 1e-6


def test_lossbreakdown_major_head_caller_supplied():
    req = {
        **BASIC_REQUEST,
        "suction_major_head_m":   1.5,
        "discharge_major_head_m": 3.0,
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert abs(data["major_hm_m"] - 4.5) < 1e-6
    assert abs(data["grand_total_hm_m"] - (data["total_hm_m"] + 4.5)) < 1e-6
    assert data["pct_major_of_grand_total"] > 0
    assert abs(data["pct_minor_of_grand_total"] + data["pct_major_of_grand_total"] - 100.0) < 0.1


def test_lossbreakdown_category_subtotals_present():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    subtotals = resp.json()["category_subtotals"]
    assert isinstance(subtotals, list)
    assert len(subtotals) >= 1
    first = subtotals[0]
    for field in ("category", "label", "K_sum", "hm_m", "hm_display", "pct_of_total_minor"):
        assert field in first, f"category_subtotals item missing: {field}"


def test_lossbreakdown_category_subtotals_sum_to_total():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    subtotal_hm = sum(s["hm_m"] for s in data["category_subtotals"])
    assert abs(subtotal_hm - data["total_hm_m"]) < 1e-5


def test_lossbreakdown_no_segment_no_subtotal_penalty():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [{"accessory_id": "cv_swing", "count": 1}],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert data["suction_minor_hm_m"]   == 0.0
    assert data["discharge_minor_hm_m"] == 0.0
    assert data["total_hm_m"]           > 0


def test_lossbreakdown_item_segment_echoed():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [{"accessory_id": "cv_swing", "count": 1, "segment": "discharge"}],
        "unit_system": "SI",
    }
    item = client.post("/compute/lossbreakdown", json=req).json()["items"][0]
    assert item["segment"] == "discharge"


def test_lossbreakdown_grand_total_no_major():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    assert abs(data["grand_total_hm_m"] - data["total_hm_m"]) < 1e-6
    assert data["major_hm_m"] == 0.0
    if data["total_hm_m"] > 0:
        assert data["pct_minor_of_grand_total"] == pytest.approx(100.0, abs=0.01)


# ---------------------------------------------------------------------------
# POST /compute/lossbreakdown — SEGMENTED MODE with pipe geometry (D-W)
# ---------------------------------------------------------------------------

SEGMENTED_REQUEST = {
    "Q_m3h": 100.0,
    "discharge": {
        "L_m":      150.0,
        "D_mm":     200.0,
        "material": "ductile_iron",
        "accessories": [
            {"accessory_id": "cv_swing",  "count": 1},
            {"accessory_id": "gate_fully_open", "count": 1},
        ],
    },
    "accessories": [
        {"accessory_id": "elbow_90_standard", "count": 2, "segment": "suction"},
    ],
    "unit_system": "SI",
}


def test_segmented_mode_status():
    resp = client.post("/compute/lossbreakdown", json=SEGMENTED_REQUEST)
    assert resp.status_code == 200


def test_segmented_mode_computes_discharge_major_dw():
    """Backend must compute discharge major loss from geometry — result should be > 0."""
    resp = client.post("/compute/lossbreakdown", json=SEGMENTED_REQUEST)
    data = resp.json()
    assert data["discharge_major_hm_m"] > 0, (
        "Discharge major (Darcy-Weisbach) loss should be > 0 for L=150m, D=200mm, Q=100 m³/h"
    )


def test_segmented_mode_discharge_major_physics():
    """D-W formula: hf = f * L/D * V²/2g.  Result must be in ballpark 0.5–20 m."""
    resp = client.post("/compute/lossbreakdown", json=SEGMENTED_REQUEST)
    data = resp.json()
    hf = data["discharge_major_hm_m"]
    assert 0.1 < hf < 50.0, f"Unexpected discharge friction loss: {hf} m"


def test_segmented_mode_suction_major_zero_when_no_geometry():
    """No suction segment supplied → suction_major_hm_m should be 0."""
    resp = client.post("/compute/lossbreakdown", json=SEGMENTED_REQUEST)
    data = resp.json()
    assert data["suction_major_hm_m"] == 0.0


def test_segmented_mode_accessories_attributed_to_discharge():
    """Accessories inside the discharge segment input should be tagged 'discharge'."""
    resp = client.post("/compute/lossbreakdown", json=SEGMENTED_REQUEST)
    items = resp.json()["items"]
    discharge_items = [it for it in items if it["segment"] == "discharge"]
    assert len(discharge_items) == 2
    ids = {it["accessory_id"] for it in discharge_items}
    assert ids == {"cv_swing", "gate_fully_open"}


def test_segmented_mode_flat_accessories_keep_segment_tag():
    """Flat accessories with segment='suction' tag must arrive in suction."""
    resp = client.post("/compute/lossbreakdown", json=SEGMENTED_REQUEST)
    items = resp.json()["items"]
    suction_items = [it for it in items if it["segment"] == "suction"]
    assert len(suction_items) == 1
    assert suction_items[0]["accessory_id"] == "elbow_90_standard"


def test_segmented_mode_grand_total_correct():
    resp = client.post("/compute/lossbreakdown", json=SEGMENTED_REQUEST)
    data = resp.json()
    expected_grand = data["total_hm_m"] + data["discharge_major_hm_m"] + data["suction_major_hm_m"]
    assert abs(data["grand_total_hm_m"] - expected_grand) < 1e-5


def test_segmented_mode_invalid_material_returns_422():
    req = {
        "Q_m3h": 100.0,
        "discharge": {
            "L_m": 100.0,
            "D_mm": 200.0,
            "material": "unobtainium_pipe",
            "accessories": [],
        },
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    assert resp.status_code == 422


def test_segmented_mode_unknown_accessory_in_segment_returns_422():
    req = {
        "Q_m3h": 100.0,
        "discharge": {
            "L_m": 100.0,
            "D_mm": 200.0,
            "material": "ductile_iron",
            "accessories": [{"accessory_id": "ghost_fitting", "count": 1}],
        },
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    assert resp.status_code == 422
    assert "ghost_fitting" in resp.json()["detail"]


def test_segmented_mode_both_suction_and_discharge_geometry():
    req = {
        "Q_m3h": 80.0,
        "suction": {
            "L_m": 20.0,
            "D_mm": 250.0,
            "material": "cast_iron",
            "accessories": [{"accessory_id": "gate_fully_open", "count": 1}],
        },
        "discharge": {
            "L_m": 100.0,
            "D_mm": 200.0,
            "material": "ductile_iron",
            "accessories": [{"accessory_id": "cv_swing", "count": 1}],
        },
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    assert resp.status_code == 200
    data = resp.json()
    assert data["suction_major_hm_m"]   > 0
    assert data["discharge_major_hm_m"] > 0
    assert data["major_hm_m"] == pytest.approx(
        data["suction_major_hm_m"] + data["discharge_major_hm_m"], abs=1e-6
    )


# ---------------------------------------------------------------------------
# Contribution matrix (contribution_rows)
# ---------------------------------------------------------------------------


def test_contribution_rows_present():
    req = {
        "Q_m3h": 100.0,
        "discharge": {
            "L_m": 150.0, "D_mm": 200.0, "material": "ductile_iron",
            "accessories": [{"accessory_id": "cv_swing", "count": 1}],
        },
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert "contribution_rows" in data
    rows = data["contribution_rows"]
    assert isinstance(rows, list)
    assert len(rows) >= 1


def test_contribution_rows_structure():
    req = {
        "Q_m3h": 100.0,
        "discharge": {
            "L_m": 150.0, "D_mm": 200.0, "material": "ductile_iron",
            "accessories": [{"accessory_id": "cv_swing", "count": 1}],
        },
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    for row in resp.json()["contribution_rows"]:
        for field in ("segment", "loss_type", "category", "label", "h_m", "h_display", "pct_of_grand_total"):
            assert field in row, f"contribution_rows row missing: {field}"
        assert row["loss_type"] in ("major", "minor")
        assert row["h_m"] >= 0


def test_contribution_rows_sorted_descending():
    req = {
        "Q_m3h": 100.0,
        "discharge": {
            "L_m": 200.0, "D_mm": 200.0, "material": "ductile_iron",
            "accessories": [
                {"accessory_id": "cv_swing", "count": 1},
                {"accessory_id": "gate_fully_open", "count": 2},
            ],
        },
        "accessories": [{"accessory_id": "elbow_90_standard", "count": 1, "segment": "suction"}],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    rows = resp.json()["contribution_rows"]
    h_values = [r["h_m"] for r in rows]
    assert h_values == sorted(h_values, reverse=True)


def test_contribution_rows_pct_sums_to_100():
    req = {
        "Q_m3h": 100.0,
        "discharge": {
            "L_m": 150.0, "D_mm": 200.0, "material": "ductile_iron",
            "accessories": [{"accessory_id": "cv_swing", "count": 1}],
        },
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    rows = resp.json()["contribution_rows"]
    total_pct = sum(r["pct_of_grand_total"] for r in rows)
    assert abs(total_pct - 100.0) < 0.5, f"Contribution % sum = {total_pct:.2f}, expected ~100"


def test_contribution_rows_major_row_present():
    req = {
        "Q_m3h": 100.0,
        "discharge": {
            "L_m": 150.0, "D_mm": 200.0, "material": "ductile_iron",
            "accessories": [],
        },
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    rows = resp.json()["contribution_rows"]
    major_rows = [r for r in rows if r["loss_type"] == "major"]
    assert len(major_rows) >= 1
    assert major_rows[0]["segment"] == "discharge"
    assert major_rows[0]["category"] == "friction"
