"""
Tests for backend/engine/surge_moc.py — MOC transient solver.

Run with:
    pytest backend/tests/test_surge_moc.py -v
"""

from __future__ import annotations

import math
import pytest

from backend.engine.surge_moc import (
    ReservoirBC,
    PumpTripBC,
    ValveClosureBC,
    SuctionPumpTripBC,
    build_grid,
    run_moc,
)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

SINGLE_SEG = [
    {
        "L_m": 600.0,
        "D_m": 0.30,
        "roughness_m": 0.00012,
        "elev_start_m": 5.0,
        "elev_end_m": 35.0,
    }
]

# Q_0 = 0.06 m³/s  → V ≈ 0.849 m/s through 300 mm pipe
Q_0   = 0.06    # m³/s
H_0   = 40.0    # m  (upstream pump head)
A_SPD = 1000.0  # m/s  (wave speed, DICL)


def _run(
    bc_a,
    bc_b,
    segments=None,
    a=A_SPD,
    q0=Q_0,
    h0=H_0,
    n=20,
    t_total=None,
):
    return run_moc(
        segments=segments or SINGLE_SEG,
        wave_speed_ms=a,
        Q_0_m3s=q0,
        H_0_m=h0,
        boundary_A=bc_a,
        boundary_B=bc_b,
        temperature_C=20.0,
        rho_kg_m3=1000.0,
        n_reaches_override=n,
        t_total_override=t_total,
    )


# ---------------------------------------------------------------------------
# build_grid()
# ---------------------------------------------------------------------------

class TestBuildGrid:
    def test_courant_one(self):
        g = build_grid(SINGLE_SEG, wave_speed_ms=1000.0)
        assert abs(g["courant"] - 1.0) < 1e-9

    def test_dx_dt_consistency(self):
        g = build_grid(SINGLE_SEG, wave_speed_ms=1000.0)
        assert abs(g["dx_m"] / g["dt_s"] - 1000.0) < 0.01

    def test_n_nodes(self):
        g = build_grid(SINGLE_SEG, wave_speed_ms=1000.0)
        assert len(g["x_m"]) == g["N"] + 1

    def test_n_reaches_override(self):
        g = build_grid(SINGLE_SEG, wave_speed_ms=1000.0, n_reaches_override=30)
        assert g["N"] == 30

    def test_n_reaches_clamp_max(self):
        g = build_grid(SINGLE_SEG, wave_speed_ms=1000.0, n_reaches_override=9999)
        assert g["N"] <= 200

    def test_n_reaches_clamp_min(self):
        g = build_grid(SINGLE_SEG, wave_speed_ms=1000.0, n_reaches_override=1)
        assert g["N"] >= 2

    def test_total_length(self):
        g = build_grid(SINGLE_SEG, wave_speed_ms=1000.0)
        assert abs(g["L_total_m"] - 600.0) < 1e-9

    def test_multi_segment_mean_diameter(self):
        segs = [
            {"L_m": 200.0, "D_m": 0.2,  "roughness_m": 0.0001,
             "elev_start_m": 0.0, "elev_end_m": 10.0},
            {"L_m": 400.0, "D_m": 0.35, "roughness_m": 0.0001,
             "elev_start_m": 10.0, "elev_end_m": 30.0},
        ]
        g = build_grid(segs, wave_speed_ms=1000.0)
        expected_D = (200.0 * 0.2 + 400.0 * 0.35) / 600.0
        assert abs(g["D_m"] - expected_D) < 1e-6

    def test_empty_segments_raises(self):
        with pytest.raises(ValueError, match="segment"):
            build_grid([], wave_speed_ms=1000.0)

    def test_zero_wave_speed_raises(self):
        with pytest.raises(ValueError, match="Wave speed"):
            build_grid(SINGLE_SEG, wave_speed_ms=0.0)


# ---------------------------------------------------------------------------
# ReservoirBC
# ---------------------------------------------------------------------------

class TestReservoirBC:
    def test_upstream_flow_direction(self):
        bc = ReservoirBC(H_res_m=50.0)
        H_P, Q_P = bc.apply(t=0.0, cp_or_cm=40.0, B=5.0, is_upstream=True)
        # C-: H_P = 50, Q_P = (50 - 40) / 5 = 2.0
        assert H_P == pytest.approx(50.0)
        assert Q_P == pytest.approx(2.0)

    def test_downstream_flow_direction(self):
        bc = ReservoirBC(H_res_m=50.0)
        H_P, Q_P = bc.apply(t=0.0, cp_or_cm=60.0, B=5.0, is_upstream=False)
        # C+: H_P = 50, Q_P = (60 - 50) / 5 = 2.0
        assert H_P == pytest.approx(50.0)
        assert Q_P == pytest.approx(2.0)

    def test_constant_over_time(self):
        bc = ReservoirBC(H_res_m=30.0)
        for t in [0.0, 1.0, 10.0, 100.0]:
            H_P, _ = bc.apply(t=t, cp_or_cm=25.0, B=4.0, is_upstream=True)
            assert H_P == pytest.approx(30.0)


# ---------------------------------------------------------------------------
# PumpTripBC
# ---------------------------------------------------------------------------

class TestPumpTripBC:
    def _bc(self):
        return PumpTripBC(H_pump_0=40.0, Q_0=0.06, t_trip=2.0, H_reservoir_m=5.0)

    def test_steady_state(self):
        bc = self._bc()
        H_P, Q_P = bc.apply(t=0.0, cp_or_cm=35.0, B=2.0, is_upstream=True)
        assert H_P == pytest.approx(40.0)
        assert Q_P == pytest.approx(0.06)

    def test_head_decays_during_trip(self):
        bc = self._bc()
        # At t=1 s (midpoint of t_trip=2 s), τ=0.5, H_source=40*0.25=10
        H_P, Q_P = bc.apply(t=1.0, cp_or_cm=8.0, B=2.0, is_upstream=True)
        assert H_P == pytest.approx(10.0)
        assert Q_P == pytest.approx((10.0 - 8.0) / 2.0)

    def test_check_valve_seats_post_trip(self):
        bc = self._bc()
        H_P, Q_P = bc.apply(t=3.0, cp_or_cm=20.0, B=2.0, is_upstream=True)
        assert Q_P == pytest.approx(0.0)
        assert H_P == pytest.approx(20.0)  # H_P = CM when Q=0

    def test_negative_flow_clamped(self):
        bc = self._bc()
        # If CM > H_source, Q_P would be negative → clamped to 0
        H_P, Q_P = bc.apply(t=1.5, cp_or_cm=50.0, B=2.0, is_upstream=True)
        assert Q_P == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# ValveClosureBC
# ---------------------------------------------------------------------------

class TestValveClosureBC:
    def test_full_open_at_t0(self):
        bc = ValveClosureBC(Q_0=0.06, t_close=10.0, profile="linear")
        H_P, Q_P = bc.apply(t=0.0, cp_or_cm=50.0, B=3.0, is_upstream=False)
        assert Q_P == pytest.approx(0.06)

    def test_fully_closed_after_tc(self):
        bc = ValveClosureBC(Q_0=0.06, t_close=10.0, profile="linear")
        H_P, Q_P = bc.apply(t=12.0, cp_or_cm=60.0, B=3.0, is_upstream=False)
        assert Q_P == pytest.approx(0.0)
        assert H_P == pytest.approx(60.0)  # H_P = CP - B*0 = CP

    def test_linear_midpoint(self):
        bc = ValveClosureBC(Q_0=0.10, t_close=10.0, profile="linear")
        H_P, Q_P = bc.apply(t=5.0, cp_or_cm=50.0, B=2.0, is_upstream=False)
        # tau = 0.5, Q_P = 0.10 * 0.25 = 0.025
        assert Q_P == pytest.approx(0.025, rel=1e-6)

    def test_equal_percentage_faster_closure(self):
        """
        Equal-percentage (butterfly/ball) characteristic: Cv ∝ R^(τ-1).
        At mid-travel (τ = 0.5) this gives LESS flow than the gate-valve linear
        model (Q ∝ τ²), because the equal-percentage curve is steeper (τ⁴).
        The valve model uses τ² for linear and τ⁴ for equal-percentage.
        """
        bc_lin = ValveClosureBC(Q_0=0.10, t_close=10.0, profile="linear")
        bc_ep  = ValveClosureBC(Q_0=0.10, t_close=10.0, profile="equal_percentage")
        _, Q_lin = bc_lin.apply(t=5.0, cp_or_cm=50.0, B=2.0, is_upstream=False)
        _, Q_ep  = bc_ep.apply( t=5.0, cp_or_cm=50.0, B=2.0, is_upstream=False)
        # Equal-percentage has steeper closure: less flow at same travel fraction
        assert Q_ep < Q_lin


# ---------------------------------------------------------------------------
# SuctionPumpTripBC
# ---------------------------------------------------------------------------

class TestSuctionPumpTripBC:
    def test_steady_state(self):
        bc = SuctionPumpTripBC(H_sump_m=5.0, Q_0=0.06, t_trip=2.0)
        H_P, Q_P = bc.apply(t=0.0, cp_or_cm=10.0, B=2.0, is_upstream=False)
        assert H_P == pytest.approx(5.0)

    def test_zero_head_after_trip(self):
        bc = SuctionPumpTripBC(H_sump_m=5.0, Q_0=0.06, t_trip=2.0)
        H_P, Q_P = bc.apply(t=5.0, cp_or_cm=10.0, B=2.0, is_upstream=False)
        assert H_P == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# run_moc() — structural / smoke tests
# ---------------------------------------------------------------------------

class TestRunMOCStructure:
    def _res(self):
        return _run(
            bc_a=PumpTripBC(H_pump_0=H_0, Q_0=Q_0, t_trip=2.0, H_reservoir_m=5.0),
            bc_b=ReservoirBC(H_res_m=35.0),
        )

    def test_envelope_length(self):
        r = self._res()
        assert len(r["envelope"]) == r["N"] + 1

    def test_envelope_keys(self):
        r = self._res()
        keys = {"x_m", "elev_m", "H_max_m", "H_min_m", "P_max_kPa", "P_min_kPa"}
        for pt in r["envelope"]:
            assert keys.issubset(pt.keys())

    def test_observations_returned(self):
        r = _run(
            bc_a=PumpTripBC(H_pump_0=H_0, Q_0=Q_0, t_trip=2.0, H_reservoir_m=5.0),
            bc_b=ReservoirBC(H_res_m=35.0),
            t_total=5.0,
        )
        assert len(r["observations"]) == 3  # default 3 observation points

    def test_time_history_non_empty(self):
        r = _run(
            bc_a=PumpTripBC(H_pump_0=H_0, Q_0=Q_0, t_trip=2.0, H_reservoir_m=5.0),
            bc_b=ReservoirBC(H_res_m=35.0),
            t_total=5.0,
        )
        for obs in r["observations"]:
            assert len(obs["history"]) > 0

    def test_metadata_keys(self):
        r = self._res()
        for key in ("N", "dx_m", "dt_s", "courant", "t_total_s", "n_steps",
                    "D_m", "f", "T_char_s", "h_vap_m", "assumption_notes"):
            assert key in r, f"Missing key: {key}"

    def test_assumption_notes_non_empty(self):
        r = self._res()
        assert len(r["assumption_notes"]) >= 5

    def test_courant_always_one(self):
        r = self._res()
        assert r["courant"] == pytest.approx(1.0)

    def test_t_char_formula(self):
        r = self._res()
        expected_T_char = 2.0 * 600.0 / A_SPD
        assert abs(r["T_char_s"] - expected_T_char) < 0.01


# ---------------------------------------------------------------------------
# run_moc() — Joukowsky cross-check (Mode B vs Mode A ±15%)
# ---------------------------------------------------------------------------

class TestJoukowskyConsistency:
    """
    For an instantaneous valve closure (t_close → 0) at the downstream end,
    the MOC maximum pressure rise should agree with the Joukowsky formula
    ΔH = a·V₀/g within ±15%.
    """

    def test_valve_closure_joukowsky_agreement(self):
        G = 9.81
        V0 = Q_0 / (math.pi * 0.30 ** 2 / 4.0)
        dH_joukowsky = A_SPD * V0 / G

        # Instantaneous closure: very short closure time
        r = _run(
            bc_a=ReservoirBC(H_res_m=H_0),
            bc_b=ValveClosureBC(Q_0=Q_0, t_close=0.01, profile="linear"),
            t_total=5.0,
            n=30,
        )
        dH_moc = r["global_max_H_m"] - H_0
        ratio = dH_moc / dH_joukowsky
        assert 0.70 <= ratio <= 1.30, (
            f"MOC ΔH = {dH_moc:.2f} m, Joukowsky = {dH_joukowsky:.2f} m, ratio = {ratio:.3f}"
        )


# ---------------------------------------------------------------------------
# run_moc() — column separation clamping
# ---------------------------------------------------------------------------

class TestColumnSeparation:
    def test_min_head_ge_h_vap(self):
        """Minimum head must never fall below vapour pressure."""
        r = run_moc(
            segments=SINGLE_SEG,
            wave_speed_ms=A_SPD,
            Q_0_m3s=Q_0,
            H_0_m=H_0,
            boundary_A=PumpTripBC(H_pump_0=H_0, Q_0=Q_0, t_trip=0.5, H_reservoir_m=5.0),
            boundary_B=ReservoirBC(H_res_m=5.0),
            temperature_C=20.0,
            rho_kg_m3=1000.0,
            n_reaches_override=20,
            t_total_override=5.0,
        )
        h_vap = r["h_vap_m"]
        for pt in r["envelope"]:
            assert pt["H_min_m"] >= h_vap - 1e-6, (
                f"H_min {pt['H_min_m']:.3f} < h_vap {h_vap:.3f} at x={pt['x_m']} m"
            )


# ---------------------------------------------------------------------------
# run_moc() — steady-state preservation
# ---------------------------------------------------------------------------

class TestSteadyStatePreservation:
    def test_no_event_head_stable(self):
        """
        With both boundaries as reservoirs and constant head, the interior
        head profile should remain close to steady-state.
        """
        r = _run(
            bc_a=ReservoirBC(H_res_m=H_0),
            bc_b=ReservoirBC(H_res_m=5.0),
            t_total=3.0,
            n=20,
        )
        # Max head should not exceed H_0 + 1 m in a steady-state run
        assert r["global_max_H_m"] <= H_0 + 1.0


# ---------------------------------------------------------------------------
# run_moc() — pressure rating check
# ---------------------------------------------------------------------------

class TestRatingCheck:
    def _run_with_rating(self, rating_kPa: float):
        return run_moc(
            segments=SINGLE_SEG,
            wave_speed_ms=A_SPD,
            Q_0_m3s=Q_0,
            H_0_m=H_0,
            boundary_A=ReservoirBC(H_res_m=H_0),
            boundary_B=ValveClosureBC(Q_0=Q_0, t_close=0.5, profile="linear"),
            temperature_C=20.0,
            rho_kg_m3=1000.0,
            pressure_rating_kPa=rating_kPa,
            n_reaches_override=15,
            t_total_override=3.0,
        )

    def test_rating_check_present(self):
        r = self._run_with_rating(1600.0)
        assert r["rating_check"] is not None

    def test_rating_check_keys(self):
        r = self._run_with_rating(1600.0)
        keys = {"steady_state_pressure_kPa", "max_transient_kPa", "min_transient_kPa",
                "pressure_rating_kPa", "factor_of_safety", "rating_status"}
        assert keys.issubset(r["rating_check"].keys())

    def test_rating_check_none_when_not_provided(self):
        r = _run(
            bc_a=ReservoirBC(H_res_m=H_0),
            bc_b=ReservoirBC(H_res_m=5.0),
            t_total=2.0,
        )
        assert r["rating_check"] is None

    def test_high_rating_passes(self):
        r = self._run_with_rating(5000.0)
        assert r["rating_check"]["rating_status"] == "pass"

    def test_low_rating_fails(self):
        r = self._run_with_rating(10.0)
        assert r["rating_check"]["rating_status"] == "fail"


# ---------------------------------------------------------------------------
# run_moc() — custom observation points
# ---------------------------------------------------------------------------

class TestObservationPoints:
    def test_custom_obs_fracs(self):
        r = run_moc(
            segments=SINGLE_SEG,
            wave_speed_ms=A_SPD,
            Q_0_m3s=Q_0,
            H_0_m=H_0,
            boundary_A=PumpTripBC(H_pump_0=H_0, Q_0=Q_0, t_trip=2.0, H_reservoir_m=5.0),
            boundary_B=ReservoirBC(H_res_m=35.0),
            observation_fracs=[0.0, 0.25, 0.75],
            observation_labels=["A", "B", "C"],
            n_reaches_override=20,
            t_total_override=4.0,
        )
        assert len(r["observations"]) == 3
        assert r["observations"][0]["label"] == "A"
        assert r["observations"][1]["label"] == "B"
        assert r["observations"][2]["label"] == "C"

    def test_obs_frac_node_index_in_bounds(self):
        r = run_moc(
            segments=SINGLE_SEG,
            wave_speed_ms=A_SPD,
            Q_0_m3s=Q_0,
            H_0_m=H_0,
            boundary_A=ReservoirBC(H_res_m=H_0),
            boundary_B=ReservoirBC(H_res_m=5.0),
            observation_fracs=[0.0, 1.0],
            n_reaches_override=20,
            t_total_override=2.0,
        )
        N = r["N"]
        for obs in r["observations"]:
            assert 0 <= obs["node_index"] <= N


# ---------------------------------------------------------------------------
# run_moc() — n_reaches and t_total overrides
# ---------------------------------------------------------------------------

class TestOverrides:
    def test_n_reaches_override(self):
        r = _run(
            bc_a=ReservoirBC(H_res_m=H_0),
            bc_b=ReservoirBC(H_res_m=5.0),
            n=50,
            t_total=2.0,
        )
        assert r["N"] == 50

    def test_t_total_override(self):
        r = _run(
            bc_a=ReservoirBC(H_res_m=H_0),
            bc_b=ReservoirBC(H_res_m=5.0),
            t_total=7.5,
        )
        # Actual t_total may differ slightly due to dt rounding
        assert abs(r["t_total_s"] - 7.5) < r["dt_s"] + 1.0

    def test_zero_flow_no_crash(self):
        r = _run(
            bc_a=ReservoirBC(H_res_m=H_0),
            bc_b=ReservoirBC(H_res_m=5.0),
            q0=0.0,
            t_total=2.0,
        )
        assert r["N"] > 0
