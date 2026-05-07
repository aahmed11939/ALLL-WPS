"""
Pydantic v2 request/response schemas for the ALLL WPS Designer API.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from backend.engine.units import UnitValue


# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class CalculationRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    Q_m3h: Annotated[float, Field(gt=0, description="Design flow rate [m³/h] — always SI")]
    elev_us_m: Annotated[float, Field(description="Upstream (suction) elevation above datum [m]")]
    elev_ds_m: Annotated[float, Field(description="Downstream (delivery) elevation above datum [m]")]
    pipe_length_m: Annotated[float, Field(gt=0, description="Pipe length [m]")]
    pipe_diameter_mm: Annotated[float, Field(gt=0, description="Internal pipe diameter [mm]")]
    material: Annotated[str, Field(description="Pipe material key (must exist in pipe_materials.yaml)")]
    K_values: list[float] = Field(
        default=[],
        description="Minor-loss K coefficients for each fitting/valve [-]",
    )
    unit_system: Literal["SI", "US"] = Field(
        default="SI",
        description=(
            "Display unit system for the response 'display' block. "
            "All numeric inputs MUST be in SI regardless of this field."
        ),
    )

    @field_validator("K_values", mode="before")
    @classmethod
    def validate_k_values(cls, v: list) -> list[float]:
        if v is None:
            return []
        for k in v:
            if k < 0:
                raise ValueError(f"K values must be >= 0, got {k}")
        return v


# ---------------------------------------------------------------------------
# Response — display block
# ---------------------------------------------------------------------------


class DisplayValues(BaseModel):
    """
    All primary hydraulic results expressed in the requested display unit system.
    Each field is a UnitValue with si_value, display_value, and unit string.
    """

    model_config = ConfigDict(frozen=True)

    velocity: UnitValue = Field(description="Mean pipe velocity at design Q")
    static_head: UnitValue = Field(description="Static (elevation) head")
    friction_head: UnitValue = Field(description="Darcy-Weisbach friction head loss at design Q")
    minor_head: UnitValue = Field(description="Total minor (fitting) head loss at design Q")
    tdh: UnitValue = Field(description="Total Dynamic Head at design Q")
    design_flow: UnitValue = Field(description="Design flow rate (echoed)")


# ---------------------------------------------------------------------------
# Response — system curve point
# ---------------------------------------------------------------------------


class SystemCurvePoint(BaseModel):
    model_config = ConfigDict(frozen=True)

    Q_m3h: float = Field(description="Flow rate — SI [m³/h]")
    H_m: float = Field(description="System head at this flow — SI [m]")
    Q_display: UnitValue = Field(description="Flow rate in display units")
    H_display: UnitValue = Field(description="System head in display units")


# ---------------------------------------------------------------------------
# Response — top-level
# ---------------------------------------------------------------------------


class CalculationResponse(BaseModel):
    model_config = ConfigDict()

    # Primary hydraulic results — canonical SI (kept for backward-compat)
    velocity_ms: float = Field(description="Mean pipe velocity at design Q [m/s]")
    reynolds_number: float = Field(description="Reynolds number at design Q [-]")
    friction_factor: float = Field(description="Darcy-Weisbach friction factor at design Q [-]")

    static_head_m: float = Field(description="Static head (elevation difference) [m]")
    friction_head_m: float = Field(description="Darcy-Weisbach friction head loss at design Q [m]")
    minor_head_m: float = Field(description="Total minor (fitting) head loss at design Q [m]")
    tdh_m: float = Field(description="Total Dynamic Head at design Q [m]")

    # System curve dataset
    system_curve: list[SystemCurvePoint] = Field(
        description="H-Q system curve: 8 points from Q=0 to Q=1.5×Q_design"
    )

    # Echo inputs for traceability
    design_Q_m3h: float = Field(description="Design flow rate echoed back [m³/h]")
    K_sum: float = Field(description="Sum of all minor-loss K values [-]")

    # Display block — values in the requested unit system
    display: DisplayValues = Field(
        description="All primary results in the requested display unit system"
    )
    unit_system: Literal["SI", "US"] = Field(
        default="SI",
        description="Display unit system echoed from the request",
    )


# ---------------------------------------------------------------------------
# Pump library
# ---------------------------------------------------------------------------


class PumpCurveCoefficients(BaseModel):
    A: float = Field(description="Constant term in H = A + B·Q + C·Q² [m]")
    B: float = Field(description="Linear coefficient [m/(m³/h)]")
    C: float = Field(description="Quadratic coefficient [m/(m³/h)²]")


class BEP(BaseModel):
    Q_m3h: float
    H_m: float


class PumpRecord(BaseModel):
    id: str
    name: str
    manufacturer: str
    type: str
    nominal_flow_m3h: float
    rated_flow_m3h: float
    rated_head_m: float
    shutoff_head_m: float
    rated_efficiency_pct: float
    rated_power_kW: float
    rated_speed_rpm: int
    impeller_diameter_mm: float
    curve_coefficients: PumpCurveCoefficients
    best_efficiency_point: BEP
    notes: str = ""


class PumpLibraryResponse(BaseModel):
    pumps: list[PumpRecord]
    count: int


# ---------------------------------------------------------------------------
# Material options (for the UI dropdown)
# ---------------------------------------------------------------------------


class MaterialOption(BaseModel):
    key: str
    label: str


class MaterialOptionsResponse(BaseModel):
    materials: list[MaterialOption]
