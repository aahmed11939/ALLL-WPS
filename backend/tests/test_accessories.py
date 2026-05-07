"""
Tests for the potable-water accessories library and loss breakdown endpoint.
"""

from __future__ import annotations

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
        assert rec["K_min"] >= 0,     f"{rec['id']}: K_min < 0"
        assert rec["K_max"] >= 0,     f"{rec['id']}: K_max < 0"


def test_k_range_ordering():
    for rec in load_accessories_library():
        assert rec["K_min"] <= rec["default_K"] <= rec["K_max"] or rec["K_min"] == rec["K_max"] == rec["default_K"], (
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
# GET /library/accessories
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
    accessories = resp.json()["accessories"]
    first = accessories[0]
    required = {"id", "category", "name", "default_K", "K_min", "K_max", "notes", "potable_notes"}
    assert required.issubset(first.keys())


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
# POST /compute/lossbreakdown
# ---------------------------------------------------------------------------


BASIC_REQUEST = {
    "Q_m3h": 100.0,
    "D_mm": 200.0,
    "accessories": [
        {"accessory_id": "cv_swing",      "count": 1},
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
    expected_k = 2.5 * 1 + 0.2 * 2  # cv_swing K=2.5, gate K=0.2 × 2
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
        "accessories": [
            {"accessory_id": "cv_swing", "count": 1, "K_override": 3.5},
        ],
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
        "accessories": [
            {"accessory_id": "gate_fully_open", "count": 5},
        ],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    item = data["items"][0]
    assert item["count"] == 5
    assert abs(item["K_total"] - item["K_each"] * 5) < 1e-9


def test_lossbreakdown_unknown_id_returns_422():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [
            {"accessory_id": "does_not_exist", "count": 1},
        ],
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
    """V²/(2g) must equal total_hm / K_sum when K_sum > 0."""
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    if data["K_sum"] > 0:
        expected_vh = data["total_hm_m"] / data["K_sum"]
        assert abs(data["velocity_head_m"] - expected_vh) < 1e-6


def test_lossbreakdown_us_unit_system():
    req = {**BASIC_REQUEST, "unit_system": "US"}
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert data["unit_system"] == "US"
    total_ft = data["total_hm_display"]["display_value"]
    total_m  = data["total_hm_m"]
    assert abs(total_ft - total_m * 3.28084) < 0.01


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
    assert data["D_mm"] == pytest.approx(200.0)


def test_lossbreakdown_all_categories_can_be_computed():
    """Spot-check one item from each category."""
    items_to_test = [
        "cv_swing",
        "gate_fully_open",
        "prv_fully_open",
        "mag_meter",
        "eccentric_reducer",
        "elbow_90_standard",
        "y_strainer",
        "pipe_entrance_sharp",
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
# New fields: segments, category subtotals, major-vs-minor breakdown
# ---------------------------------------------------------------------------


def test_lossbreakdown_response_has_segment_fields():
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    for field in (
        "suction_minor_hm_m", "discharge_minor_hm_m",
        "major_hm_m", "grand_total_hm_m",
        "pct_minor_of_grand_total", "pct_major_of_grand_total",
        "category_subtotals",
    ):
        assert field in data, f"Missing field: {field}"


def test_lossbreakdown_segment_tagging():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [
            {"accessory_id": "cv_swing",       "count": 1, "segment": "discharge"},
            {"accessory_id": "gate_fully_open", "count": 1, "segment": "suction"},
        ],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    assert resp.status_code == 200
    data = resp.json()
    assert data["suction_minor_hm_m"] > 0
    assert data["discharge_minor_hm_m"] > 0
    cv_item = next(it for it in data["items"] if it["accessory_id"] == "cv_swing")
    gate_item = next(it for it in data["items"] if it["accessory_id"] == "gate_fully_open")
    assert cv_item["segment"] == "discharge"
    assert gate_item["segment"] == "suction"
    assert abs(data["suction_minor_hm_m"] - gate_item["hm_m"]) < 1e-6
    assert abs(data["discharge_minor_hm_m"] - cv_item["hm_m"]) < 1e-6


def test_lossbreakdown_major_head_contribution():
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
    data = resp.json()
    subtotals = data["category_subtotals"]
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
    """Items without segment are included in total but suction/discharge subtotals stay 0."""
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [
            {"accessory_id": "cv_swing", "count": 1},
        ],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    data = resp.json()
    assert data["suction_minor_hm_m"] == 0.0
    assert data["discharge_minor_hm_m"] == 0.0
    assert data["total_hm_m"] > 0


def test_lossbreakdown_item_segment_echoed():
    req = {
        "Q_m3h": 100.0,
        "D_mm": 200.0,
        "accessories": [
            {"accessory_id": "cv_swing", "count": 1, "segment": "discharge"},
        ],
        "unit_system": "SI",
    }
    resp = client.post("/compute/lossbreakdown", json=req)
    item = resp.json()["items"][0]
    assert item["segment"] == "discharge"


def test_lossbreakdown_grand_total_no_major():
    """When no major head provided, grand_total == total minor."""
    resp = client.post("/compute/lossbreakdown", json=BASIC_REQUEST)
    data = resp.json()
    assert abs(data["grand_total_hm_m"] - data["total_hm_m"]) < 1e-6
    assert data["major_hm_m"] == 0.0
    assert data["pct_minor_of_grand_total"] == pytest.approx(100.0, abs=0.01) or data["total_hm_m"] == 0.0
