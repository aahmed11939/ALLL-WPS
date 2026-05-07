"""
Unit tests for backend/engine/hydraulics.py

Run with:
    pytest backend/tests/test_hydraulics.py -v
"""

from __future__ import annotations

import math

import pytest

from backend.engine.hydraulics import (
    G,
    NU_WATER,
    friction_factor_colebrook,
    friction_head_loss,
    minor_head_loss,
    reynolds_number,
    static_head,
    system_curve,
    tdh,
    velocity,
)


# ---------------------------------------------------------------------------
# velocity()
# ---------------------------------------------------------------------------


class TestVelocity:
    def test_known_value(self):
        # Q = 0.01 m³/s, D = 0.1 m → A = π/4·0.01 = 0.007854 m²
        # V = 0.01 / 0.007854 ≈ 1.2732 m/s
        V = velocity(0.01, 0.1)
        assert abs(V - 1.2732) < 1e-3

    def test_zero_flow(self):
        assert velocity(0.0, 0.15) == pytest.approx(0.0)

    def test_invalid_diameter(self):
        with pytest.raises(ValueError, match="diameter"):
            velocity(0.01, 0.0)

    def test_negative_flow_raises(self):
        with pytest.raises(ValueError, match="Flow rate"):
            velocity(-0.001, 0.1)


# ---------------------------------------------------------------------------
# reynolds_number()
# ---------------------------------------------------------------------------


class TestReynoldsNumber:
    def test_turbulent_regime(self):
        # Q = 0.01 m³/s, D = 0.1 m → V ≈ 1.2732 m/s
        # Re = 1.2732 × 0.1 / 1.004e-6 ≈ 126,813
        Re = reynolds_number(0.01, 0.1)
        assert abs(Re - 126_813) < 500

    def test_laminar_regime(self):
        # Very small flow to get Re < 2300
        Re = reynolds_number(1e-6, 0.1)
        assert Re < 2300


# ---------------------------------------------------------------------------
# friction_factor_colebrook()
# ---------------------------------------------------------------------------


class TestFrictionFactor:
    """
    Benchmark values taken from the Moody chart and Colebrook-White equation.
    """

    def test_laminar(self):
        # Re = 1000, any roughness → f = 64/Re = 0.064
        f = friction_factor_colebrook(1000, 0.0)
        assert f == pytest.approx(0.064, rel=1e-6)

    def test_moody_turbulent_rough(self):
        # Re = 1e5, ε/D = 0.001 → Colebrook-White iterative solution = 0.02218
        # Verified by hand iteration: x = 1/√f converges to 6.7149 ⟹ f = 0.02218
        f = friction_factor_colebrook(1e5, 0.001)
        assert f == pytest.approx(0.0222, abs=0.001)

    def test_smooth_pipe_high_re(self):
        # Re = 1e6, smooth (ε/D = 0) → Colebrook-White iterative = 0.01165
        # Consistent with Filonenko (0.0025·(log Re − 0.8)⁻²) ≈ 0.01162
        f = friction_factor_colebrook(1e6, 0.0)
        assert f == pytest.approx(0.0116, abs=0.001)

    def test_fully_rough(self):
        # Re = 1e8, ε/D = 0.05 → fully-rough regime, f ≈ 1/(1.14 - 2 log(ε/D))²
        eps_D = 0.05
        f_ref = 1.0 / (-2.0 * math.log10(eps_D / 3.7)) ** 2
        f = friction_factor_colebrook(1e8, eps_D)
        assert abs(f - f_ref) < 0.001

    def test_invalid_re(self):
        with pytest.raises(ValueError, match="Reynolds"):
            friction_factor_colebrook(0, 0.001)

    def test_negative_roughness_raises(self):
        with pytest.raises(ValueError, match="roughness"):
            friction_factor_colebrook(1e5, -0.001)


# ---------------------------------------------------------------------------
# friction_head_loss()
# ---------------------------------------------------------------------------


class TestFrictionHeadLoss:
    def test_known_case(self):
        """
        Hand-calculated reference case:
            Q  = 0.02 m³/s
            D  = 0.15 m  (DN150)
            L  = 100 m
            ε  = 0.00012 m  (ductile iron)
            ν  = 1.004e-6 m²/s

            A = π/4 × 0.15² = 0.017671 m²
            V = 0.02 / 0.017671 = 1.1318 m/s
            Re = 1.1318 × 0.15 / 1.004e-6 = 169 178
            ε/D = 0.00012/0.15 = 0.0008
            Colebrook → f ≈ 0.02049 (by iteration)
            h_f = 0.02049 × (100/0.15) × 1.1318²/(2×9.81)
                = 0.02049 × 666.67 × 0.06530
                = 0.892 m  (approx)
        """
        h_f = friction_head_loss(
            Q_m3s=0.02,
            D_m=0.15,
            L_m=100.0,
            roughness_m=0.00012,
        )
        # Allow ±5% tolerance around the hand-calc value
        assert abs(h_f - 0.892) < 0.050

    def test_zero_flow_gives_zero(self):
        h_f = friction_head_loss(0.0, 0.15, 100.0, 0.00012)
        assert h_f == pytest.approx(0.0)

    def test_invalid_length(self):
        with pytest.raises(ValueError, match="length"):
            friction_head_loss(0.01, 0.1, -1.0, 0.0001)


# ---------------------------------------------------------------------------
# minor_head_loss()
# ---------------------------------------------------------------------------


class TestMinorHeadLoss:
    def test_single_k(self):
        # Q = 0.01 m³/s, D = 0.1 m → V = 1.2732 m/s
        # h_m = 1.5 × 1.2732²/(2×9.81) = 1.5 × 0.08262 = 0.1239 m
        h_m = minor_head_loss(0.01, 0.1, [1.5])
        assert abs(h_m - 0.1239) < 0.002

    def test_multiple_k(self):
        h_m_sum = minor_head_loss(0.01, 0.1, [0.5, 0.5, 0.5])
        h_m_single = minor_head_loss(0.01, 0.1, [1.5])
        assert h_m_sum == pytest.approx(h_m_single, rel=1e-6)

    def test_zero_flow(self):
        assert minor_head_loss(0.0, 0.1, [2.0]) == pytest.approx(0.0)

    def test_empty_k_list(self):
        assert minor_head_loss(0.01, 0.1, []) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# static_head()
# ---------------------------------------------------------------------------


class TestStaticHead:
    def test_positive(self):
        # Downstream higher than upstream → pump lifts water
        assert static_head(50.0, 20.0) == pytest.approx(30.0)

    def test_negative(self):
        # Downstream lower → gravity assist
        assert static_head(10.0, 50.0) == pytest.approx(-40.0)

    def test_equal(self):
        assert static_head(100.0, 100.0) == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# tdh()
# ---------------------------------------------------------------------------


class TestTDH:
    def test_basic_sum(self):
        assert tdh(30.0, 5.5, 1.2) == pytest.approx(36.7)

    def test_zero_losses(self):
        assert tdh(25.0, 0.0, 0.0) == pytest.approx(25.0)

    def test_negative_static(self):
        # Downhill run — losses can still exceed gravity benefit
        result = tdh(-10.0, 8.0, 2.0)
        assert result == pytest.approx(0.0)


# ---------------------------------------------------------------------------
# system_curve()
# ---------------------------------------------------------------------------


class TestSystemCurve:
    def _base_curve(self, n_points=8):
        return system_curve(
            Q_design_m3s=0.01,   # 36 m³/h
            D_m=0.15,
            L_m=200.0,
            roughness_m=0.00012,
            K_sum=2.0,
            h_s=20.0,
            n_points=n_points,
        )

    def test_returns_n_points(self):
        curve = self._base_curve(8)
        assert len(curve) == 8

    def test_first_point_zero_flow(self):
        curve = self._base_curve()
        assert curve[0]["Q_m3h"] == pytest.approx(0.0)

    def test_last_point_1_5x_design(self):
        Q_design_m3h = 0.01 * 3600.0
        curve = self._base_curve()
        assert curve[-1]["Q_m3h"] == pytest.approx(1.5 * Q_design_m3h, rel=1e-3)

    def test_static_head_at_zero_flow(self):
        # At Q=0 there are no dynamic losses → H = h_s
        curve = self._base_curve()
        assert curve[0]["H_m"] == pytest.approx(20.0, rel=1e-4)

    def test_head_increases_with_flow(self):
        # System curve should be monotonically increasing for h_s > 0
        curve = self._base_curve()
        heads = [pt["H_m"] for pt in curve]
        for i in range(len(heads) - 1):
            assert heads[i + 1] >= heads[i], (
                f"Head decreased from point {i} to {i+1}: {heads[i]} → {heads[i+1]}"
            )

    def test_invalid_n_points(self):
        with pytest.raises(ValueError, match="n_points"):
            system_curve(0.01, 0.15, 200.0, 0.00012, 2.0, 20.0, n_points=1)
