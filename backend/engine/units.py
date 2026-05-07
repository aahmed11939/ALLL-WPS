"""
Unit conversion engine for ALLL WPS Designer.

All internal computations use canonical SI (m, m³/s, m/s, Pa, W).
This module converts between SI and US Customary display units without
intermediate chaining — each constant is derived directly from the
primary definition to avoid accumulated floating-point drift.

References
----------
NIST SP 811 (2008 ed.)  — Guide for the Use of the International System of Units
ASTM E380               — Standard Practice for Use of the International System
                          of Units (SI); the Modern Metric System

Suffix convention
-----------------
Comments marked EXACT denote constants that are exact by international definition.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Exact conversion constants
# ---------------------------------------------------------------------------

# --- Length --------------------------------------------------------------- #
M_PER_FT: float = 0.3048           # 1 international foot = 0.3048 m  EXACT
FT_PER_M: float = 1.0 / M_PER_FT  # 3.280 839 895 ...
MM_PER_IN: float = 25.4            # 1 inch = 25.4 mm  EXACT
IN_PER_MM: float = 1.0 / MM_PER_IN

# --- Volume / Flow -------------------------------------------------------- #
L_PER_US_GAL: float = 3.785_411_784        # 1 US gallon = 3.785 411 784 L  EXACT
M3_PER_US_GAL: float = L_PER_US_GAL * 1e-3 # 3.785 411 784 × 10⁻³ m³  EXACT
M3S_PER_GPM: float = M3_PER_US_GAL / 60.0  # 6.309 019 64 × 10⁻⁵ m³/s
GPM_PER_M3S: float = 1.0 / M3S_PER_GPM    # 15 850.323 ...

M3H_PER_GPM: float = M3S_PER_GPM * 3600.0  # 0.227 124 707 04 m³/h per gpm
GPM_PER_M3H: float = 1.0 / M3H_PER_GPM     # 4.402 867 ... gpm per m³/h

# 1 cfs = 1 ft³/s = (0.3048)³ m³/s  EXACT
M3S_PER_CFS: float = M_PER_FT ** 3    # 0.028 316 846 592 m³/s
CFS_PER_M3S: float = 1.0 / M3S_PER_CFS

# --- Pressure ------------------------------------------------------------ #
# 1 lbf = 0.453 592 37 kg × 9.806 65 m/s²  (both exact by definition)
_LBF_N: float = 0.453_592_37 * 9.806_65   # 4.448 221 615 26 N  EXACT
# 1 psi = 1 lbf / (1 in)² = _LBF_N / (0.0254 m)²
KPA_PER_PSI: float = _LBF_N / (0.0254 ** 2) / 1000.0  # 6.894 757 293 ... kPa
PSI_PER_KPA: float = 1.0 / KPA_PER_PSI

# Head of water: same fluid so ft_water ↔ m is the same as ft ↔ m  EXACT
# (density cancels; valid at any temperature for differential head comparison)

# --- Power --------------------------------------------------------------- #
# 1 mechanical hp = 550 ft·lbf/s  EXACT
KW_PER_HP: float = 550.0 * M_PER_FT * _LBF_N / 1000.0  # 0.745 699 871 582 ... kW
HP_PER_KW: float = 1.0 / KW_PER_HP                       # 1.341 022 ...

# --- Velocity ------------------------------------------------------------ #
FPS_PER_MS: float = FT_PER_M   # 1 m/s = 1/0.3048 fps
MS_PER_FPS: float = M_PER_FT   # 1 fps = 0.3048 m/s  EXACT


# ---------------------------------------------------------------------------
# Named conversion functions (for explicit use in tests and engine code)
# ---------------------------------------------------------------------------

def gpm_to_m3s(gpm: float) -> float:
    """Convert US gallons per minute to m³/s."""
    return gpm * M3S_PER_GPM


def m3s_to_gpm(m3s: float) -> float:
    """Convert m³/s to US gallons per minute."""
    return m3s * GPM_PER_M3S


def cfs_to_m3s(cfs: float) -> float:
    """Convert cubic feet per second to m³/s."""
    return cfs * M3S_PER_CFS


def m3s_to_cfs(m3s: float) -> float:
    """Convert m³/s to cubic feet per second."""
    return m3s * CFS_PER_M3S


def m3h_to_gpm(m3h: float) -> float:
    """Convert m³/h to US gallons per minute."""
    return m3h * GPM_PER_M3H


def gpm_to_m3h(gpm: float) -> float:
    """Convert US gallons per minute to m³/h."""
    return gpm * M3H_PER_GPM


def ft_to_m(ft: float) -> float:
    """Convert feet to metres."""
    return ft * M_PER_FT


def m_to_ft(m: float) -> float:
    """Convert metres to feet."""
    return m * FT_PER_M


def in_to_mm(inches: float) -> float:
    """Convert inches to millimetres."""
    return inches * MM_PER_IN


def mm_to_in(mm: float) -> float:
    """Convert millimetres to inches."""
    return mm * IN_PER_MM


def psi_to_kpa(psi: float) -> float:
    """Convert pounds per square inch (gauge or absolute) to kilopascals."""
    return psi * KPA_PER_PSI


def kpa_to_psi(kpa: float) -> float:
    """Convert kilopascals to pounds per square inch."""
    return kpa * PSI_PER_KPA


def ft_water_to_m(ft: float) -> float:
    """Convert feet of water (head) to metres of water (head)."""
    return ft * M_PER_FT  # density cancels; exact


def m_to_ft_water(m: float) -> float:
    """Convert metres of water (head) to feet of water (head)."""
    return m * FT_PER_M


def hp_to_kw(hp: float) -> float:
    """Convert mechanical horsepower to kilowatts."""
    return hp * KW_PER_HP


def kw_to_hp(kw: float) -> float:
    """Convert kilowatts to mechanical horsepower."""
    return kw * HP_PER_KW


def fps_to_ms(fps: float) -> float:
    """Convert feet per second to metres per second."""
    return fps * MS_PER_FPS


def ms_to_fps(ms: float) -> float:
    """Convert metres per second to feet per second."""
    return ms * FPS_PER_MS


# ---------------------------------------------------------------------------
# UnitValue — structured display value
# ---------------------------------------------------------------------------

class UnitValue(BaseModel):
    """
    A numeric quantity together with its SI canonical value and the
    display value in the selected unit system.

    ``si_value``      — value in the canonical SI unit for this quantity
    ``display_value`` — value in the display unit (may equal si_value when SI selected)
    ``unit``          — display unit symbol string (e.g. 'm', 'ft', 'gpm', 'fps')
    """

    model_config = ConfigDict(frozen=True)

    si_value: float = Field(
        description=(
            "Canonical SI value. Units by quantity: "
            "flow_m3h → m³/h; flow_m3s → m³/s; head/length → m; "
            "diameter → mm; pressure → kPa; power → kW; velocity → m/s."
        )
    )
    display_value: float = Field(
        description="Value in the selected display unit (si_value when unit_system='SI')"
    )
    unit: str = Field(description="Display unit symbol, e.g. 'm', 'ft', 'gpm', 'fps', 'psi'")


# ---------------------------------------------------------------------------
# Quantity type and convert() helper
# ---------------------------------------------------------------------------

Quantity = Literal[
    "flow_m3s",   # si_value in m³/s
    "flow_m3h",   # si_value in m³/h
    "head",       # si_value in m   (elevation head, friction head, TDH …)
    "length",     # si_value in m   (pipe length, depth …)
    "diameter",   # si_value in mm  (internal pipe diameter)
    "pressure",   # si_value in kPa
    "power",      # si_value in kW
    "velocity",   # si_value in m/s
]

_SI_UNITS: dict[str, str] = {
    "flow_m3s": "m³/s",
    "flow_m3h": "m³/h",
    "head":     "m",
    "length":   "m",
    "diameter": "mm",
    "pressure": "kPa",
    "power":    "kW",
    "velocity": "m/s",
}

_US_FACTORS: dict[str, tuple[float, str]] = {
    "flow_m3s": (GPM_PER_M3S, "gpm"),
    "flow_m3h": (GPM_PER_M3H, "gpm"),
    "head":     (FT_PER_M,    "ft"),
    "length":   (FT_PER_M,    "ft"),
    "diameter": (IN_PER_MM,   "in"),
    "pressure": (PSI_PER_KPA, "psi"),
    "power":    (HP_PER_KW,   "hp"),
    "velocity": (FPS_PER_MS,  "fps"),
}


def convert(
    si_value: float,
    quantity: Quantity,
    unit_system: Literal["SI", "US"],
) -> UnitValue:
    """
    Convert a canonical SI value into a ``UnitValue`` for the target unit system.

    Parameters
    ----------
    si_value    : float     Value in canonical SI unit (see Quantity docstring).
    quantity    : Quantity  Physical quantity identifier.
    unit_system : str       Target display system: ``'SI'`` or ``'US'``.

    Returns
    -------
    UnitValue   Frozen Pydantic model with si_value, display_value, and unit.
    """
    if unit_system == "SI":
        return UnitValue(
            si_value=si_value,
            display_value=si_value,
            unit=_SI_UNITS[quantity],
        )

    factor, unit = _US_FACTORS[quantity]
    return UnitValue(
        si_value=si_value,
        display_value=si_value * factor,
        unit=unit,
    )
