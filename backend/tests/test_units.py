"""
Unit tests for backend/engine/units.py

Run with:
    pytest backend/tests/test_units.py -v

Coverage
--------
- All named conversion functions (round-trip accuracy)
- convert() for both SI and US unit systems, every Quantity
- UnitValue model (frozen, field presence)
- Exact constants spot-checked against NIST SP 811
"""

from __future__ import annotations

import math

import pytest

from backend.engine.units import (
    CFS_PER_M3S,
    FPS_PER_MS,
    FT_PER_M,
    GPM_PER_M3H,
    GPM_PER_M3S,
    HP_PER_KW,
    IN_PER_MM,
    KPA_PER_PSI,
    KW_PER_HP,
    M3H_PER_GPM,
    M3S_PER_CFS,
    M3S_PER_GPM,
    MM_PER_IN,
    MS_PER_FPS,
    M_PER_FT,
    PSI_PER_KPA,
    UnitValue,
    cfs_to_m3s,
    convert,
    fps_to_ms,
    ft_to_m,
    ft_water_to_m,
    gpm_to_m3h,
    gpm_to_m3s,
    hp_to_kw,
    in_to_mm,
    kpa_to_psi,
    kw_to_hp,
    m3h_to_gpm,
    m3s_to_cfs,
    m3s_to_gpm,
    m_to_ft,
    m_to_ft_water,
    mm_to_in,
    ms_to_fps,
    psi_to_kpa,
)


# ---------------------------------------------------------------------------
# Exact constants — spot-check against NIST SP 811
# ---------------------------------------------------------------------------


class TestConstants:
    def test_m_per_ft_exact(self):
        # 1 international foot = 0.3048 m exactly
        assert M_PER_FT == pytest.approx(0.3048, rel=0)

    def test_mm_per_in_exact(self):
        # 1 inch = 25.4 mm exactly
        assert MM_PER_IN == pytest.approx(25.4, rel=0)

    def test_m3s_per_gpm_nist(self):
        # NIST: 1 US gal/min = 6.309 020 × 10⁻⁵ m³/s
        assert M3S_PER_GPM == pytest.approx(6.30901964e-5, rel=1e-7)

    def test_kpa_per_psi_nist(self):
        # NIST: 1 psi = 6.894 757 kPa
        assert KPA_PER_PSI == pytest.approx(6.894757, rel=1e-5)

    def test_kw_per_hp_nist(self):
        # NIST: 1 mechanical hp = 0.745 699 87 kW
        assert KW_PER_HP == pytest.approx(0.74569987, rel=1e-6)

    def test_m3s_per_cfs_exact(self):
        # 1 cfs = 0.3048³ m³/s exactly
        assert M3S_PER_CFS == pytest.approx(0.3048 ** 3, rel=0)

    def test_reciprocals_consistent(self):
        assert FT_PER_M * M_PER_FT == pytest.approx(1.0, rel=1e-15)
        assert IN_PER_MM * MM_PER_IN == pytest.approx(1.0, rel=1e-15)
        assert GPM_PER_M3S * M3S_PER_GPM == pytest.approx(1.0, rel=1e-12)
        assert GPM_PER_M3H * M3H_PER_GPM == pytest.approx(1.0, rel=1e-12)
        assert PSI_PER_KPA * KPA_PER_PSI == pytest.approx(1.0, rel=1e-12)
        assert HP_PER_KW * KW_PER_HP == pytest.approx(1.0, rel=1e-12)
        assert FPS_PER_MS * MS_PER_FPS == pytest.approx(1.0, rel=1e-15)
        assert CFS_PER_M3S * M3S_PER_CFS == pytest.approx(1.0, rel=1e-15)


# ---------------------------------------------------------------------------
# Named conversion functions — round-trip tests
# ---------------------------------------------------------------------------


class TestFlowConversions:
    def test_gpm_to_m3s_known(self):
        # 1 US gal/min → 6.30901964e-5 m³/s
        assert gpm_to_m3s(1.0) == pytest.approx(6.30901964e-5, rel=1e-7)

    def test_m3s_to_gpm_known(self):
        # 1 m³/s → ~15 850.3 gpm
        assert m3s_to_gpm(1.0) == pytest.approx(15850.32, rel=1e-4)

    def test_gpm_m3s_round_trip(self):
        for q in [0.0, 1.0, 100.0, 5000.0]:
            assert m3s_to_gpm(gpm_to_m3s(q)) == pytest.approx(q, rel=1e-12)

    def test_m3h_to_gpm_known(self):
        # 1 m³/h → 4.4029 gpm
        assert m3h_to_gpm(1.0) == pytest.approx(4.402867, rel=1e-5)

    def test_gpm_to_m3h_known(self):
        # 100 gpm → 22.712 m³/h
        assert gpm_to_m3h(100.0) == pytest.approx(22.71247, rel=1e-5)

    def test_gpm_m3h_round_trip(self):
        for q in [0.0, 1.0, 50.0, 500.0]:
            assert gpm_to_m3h(m3h_to_gpm(q)) == pytest.approx(q, rel=1e-12)

    def test_cfs_to_m3s_known(self):
        # 1 cfs = 0.028316847 m³/s
        assert cfs_to_m3s(1.0) == pytest.approx(0.028316846592, rel=1e-10)

    def test_cfs_round_trip(self):
        for q in [0.0, 1.0, 10.0]:
            assert m3s_to_cfs(cfs_to_m3s(q)) == pytest.approx(q, rel=1e-12)

    def test_flow_consistency_gpm_m3s_m3h(self):
        # 1 gpm expressed two ways must agree
        via_m3s = gpm_to_m3s(1.0) * 3600.0
        via_m3h = gpm_to_m3h(1.0)
        assert via_m3s == pytest.approx(via_m3h, rel=1e-12)


class TestLengthConversions:
    def test_ft_to_m_exact(self):
        assert ft_to_m(1.0) == pytest.approx(0.3048, rel=0)

    def test_m_to_ft_known(self):
        assert m_to_ft(1.0) == pytest.approx(3.280839895, rel=1e-7)

    def test_ft_m_round_trip(self):
        for v in [0.0, 1.0, 10.0, 100.0]:
            assert m_to_ft(ft_to_m(v)) == pytest.approx(v, rel=1e-12)

    def test_in_to_mm_exact(self):
        assert in_to_mm(1.0) == pytest.approx(25.4, rel=0)

    def test_mm_to_in_known(self):
        # 150 mm = 5.905 511... inches
        assert mm_to_in(150.0) == pytest.approx(150 / 25.4, rel=1e-12)

    def test_mm_in_round_trip(self):
        for v in [1.0, 25.4, 150.0, 300.0]:
            assert in_to_mm(mm_to_in(v)) == pytest.approx(v, rel=1e-12)

    def test_ft_water_head_same_as_ft_length(self):
        # Head is purely geometric; ft_water ↔ m same as ft ↔ m
        assert ft_water_to_m(10.0) == pytest.approx(ft_to_m(10.0), rel=1e-15)
        assert m_to_ft_water(3.048) == pytest.approx(m_to_ft(3.048), rel=1e-15)


class TestPressureConversions:
    def test_psi_to_kpa_known(self):
        # 1 psi = 6.894757 kPa
        assert psi_to_kpa(1.0) == pytest.approx(6.894757, rel=1e-5)

    def test_kpa_to_psi_known(self):
        # 100 kPa = 14.5038 psi
        assert kpa_to_psi(100.0) == pytest.approx(14.5038, rel=1e-4)

    def test_psi_kpa_round_trip(self):
        for p in [0.0, 1.0, 50.0, 500.0]:
            assert kpa_to_psi(psi_to_kpa(p)) == pytest.approx(p, rel=1e-12)


class TestPowerConversions:
    def test_hp_to_kw_known(self):
        # 1 hp = 0.745699872 kW
        assert hp_to_kw(1.0) == pytest.approx(0.74569987, rel=1e-6)

    def test_kw_to_hp_known(self):
        # 1 kW = 1.341022 hp
        assert kw_to_hp(1.0) == pytest.approx(1.341022, rel=1e-5)

    def test_hp_kw_round_trip(self):
        for p in [0.0, 1.0, 10.0, 100.0]:
            assert kw_to_hp(hp_to_kw(p)) == pytest.approx(p, rel=1e-12)


class TestVelocityConversions:
    def test_ms_to_fps_known(self):
        # 1 m/s = 3.280839895 fps
        assert ms_to_fps(1.0) == pytest.approx(3.280839895, rel=1e-7)

    def test_fps_to_ms_exact(self):
        # 1 fps = 0.3048 m/s
        assert fps_to_ms(1.0) == pytest.approx(0.3048, rel=0)

    def test_ms_fps_round_trip(self):
        for v in [0.0, 1.0, 3.0, 10.0]:
            assert fps_to_ms(ms_to_fps(v)) == pytest.approx(v, rel=1e-12)


# ---------------------------------------------------------------------------
# convert() — UnitValue output
# ---------------------------------------------------------------------------


class TestConvertSI:
    """convert() with unit_system='SI' returns the same value with SI unit symbols."""

    QUANTITIES = [
        ("flow_m3s", 0.005, "m³/s"),
        ("flow_m3h", 18.0,  "m³/h"),
        ("head",     25.0,  "m"),
        ("length",   200.0, "m"),
        ("diameter", 150.0, "mm"),
        ("pressure", 350.0, "kPa"),
        ("power",    15.0,  "kW"),
        ("velocity", 1.5,   "m/s"),
    ]

    @pytest.mark.parametrize("qty,val,unit", QUANTITIES)
    def test_si_passthrough(self, qty, val, unit):
        uv = convert(val, qty, "SI")  # type: ignore[arg-type]
        assert uv.si_value == pytest.approx(val, rel=1e-12)
        assert uv.display_value == pytest.approx(val, rel=1e-12)
        assert uv.unit == unit

    def test_zero_si(self):
        uv = convert(0.0, "head", "SI")
        assert uv.display_value == 0.0
        assert uv.unit == "m"


class TestConvertUS:
    """convert() with unit_system='US' converts to US Customary display units."""

    def test_flow_m3h_to_gpm(self):
        uv = convert(1.0, "flow_m3h", "US")
        assert uv.si_value == pytest.approx(1.0)
        assert uv.display_value == pytest.approx(gpm_to_m3h.__module__ and m3h_to_gpm(1.0), rel=1e-10)
        assert uv.unit == "gpm"

    def test_flow_m3s_to_gpm(self):
        uv = convert(1.0, "flow_m3s", "US")
        assert uv.display_value == pytest.approx(m3s_to_gpm(1.0), rel=1e-10)
        assert uv.unit == "gpm"

    def test_head_m_to_ft(self):
        uv = convert(10.0, "head", "US")
        assert uv.display_value == pytest.approx(m_to_ft(10.0), rel=1e-10)
        assert uv.unit == "ft"

    def test_head_zero(self):
        uv = convert(0.0, "head", "US")
        assert uv.display_value == 0.0
        assert uv.unit == "ft"

    def test_length_m_to_ft(self):
        uv = convert(100.0, "length", "US")
        assert uv.display_value == pytest.approx(m_to_ft(100.0), rel=1e-10)
        assert uv.unit == "ft"

    def test_diameter_mm_to_in(self):
        uv = convert(150.0, "diameter", "US")
        assert uv.display_value == pytest.approx(mm_to_in(150.0), rel=1e-10)
        assert uv.unit == "in"

    def test_pressure_kpa_to_psi(self):
        uv = convert(100.0, "pressure", "US")
        assert uv.display_value == pytest.approx(kpa_to_psi(100.0), rel=1e-10)
        assert uv.unit == "psi"

    def test_power_kw_to_hp(self):
        uv = convert(10.0, "power", "US")
        assert uv.display_value == pytest.approx(kw_to_hp(10.0), rel=1e-10)
        assert uv.unit == "hp"

    def test_velocity_ms_to_fps(self):
        uv = convert(1.5, "velocity", "US")
        assert uv.display_value == pytest.approx(ms_to_fps(1.5), rel=1e-10)
        assert uv.unit == "fps"

    def test_si_value_preserved_in_us_output(self):
        # si_value must always carry the canonical SI value unchanged
        uv = convert(36.0, "flow_m3h", "US")
        assert uv.si_value == pytest.approx(36.0, rel=0)

    def test_design_point_36m3h(self):
        # 36 m³/h ≈ 158.5 gpm — common design reference point
        uv = convert(36.0, "flow_m3h", "US")
        assert uv.display_value == pytest.approx(158.5, abs=0.1)

    def test_head_30m_to_ft(self):
        # 30 m ≈ 98.43 ft
        uv = convert(30.0, "head", "US")
        assert uv.display_value == pytest.approx(98.425, abs=0.01)


# ---------------------------------------------------------------------------
# UnitValue model constraints
# ---------------------------------------------------------------------------


class TestUnitValueModel:
    def test_frozen_raises_on_mutation(self):
        uv = UnitValue(si_value=1.0, display_value=3.28, unit="ft")
        with pytest.raises(Exception):  # ValidationError or TypeError on frozen model
            uv.display_value = 99.0  # type: ignore[misc]

    def test_fields_present(self):
        uv = UnitValue(si_value=10.0, display_value=32.8, unit="ft")
        assert hasattr(uv, "si_value")
        assert hasattr(uv, "display_value")
        assert hasattr(uv, "unit")

    def test_negative_values_allowed(self):
        # Negative head (downhill) must not raise
        uv = convert(-5.0, "head", "US")
        assert uv.display_value < 0
        assert uv.si_value < 0
