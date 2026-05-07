"""
Pydantic v2 request/response schemas for the ALLL WPS Designer API.
"""

from __future__ import annotations

from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


# ---------------------------------------------------------------------------
# Multi-segment hydraulic compute — request schemas
# ---------------------------------------------------------------------------


class PipeSegment(BaseModel):
    """A single pipe segment within a suction or discharge assembly."""

    model_config = ConfigDict(str_strip_whitespace=True)

    label: str = Field(default="", description="Human-readable segment identifier")
    method: Literal["darcy_weisbach", "hazen_williams"] = Field(
        description="Friction loss method for this segment"
    )
    L_m: Annotated[float, Field(gt=0, description="Pipe length [m]")]
    D_m: Annotated[float, Field(gt=0, description="Internal pipe diameter [m]")]

    # Darcy-Weisbach only
    roughness_m: Optional[float] = Field(
        default=None,
        ge=0,
        description="Absolute roughness ε [m] — required for darcy_weisbach",
    )

    # Hazen-Williams only
    C_hw: Optional[float] = Field(
        default=None,
        gt=0,
        description="Hazen-Williams C coefficient [-] — required for hazen_williams",
    )

    K_values: list[float] = Field(
        default_factory=list,
        description="Minor-loss K coefficients for fittings in this segment [-]",
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

    @model_validator(mode="after")
    def check_method_params(self) -> "PipeSegment":
        if self.method == "darcy_weisbach" and self.roughness_m is None:
            raise ValueError(
                "roughness_m is required when method='darcy_weisbach'"
            )
        if self.method == "hazen_williams" and self.C_hw is None:
            raise ValueError(
                "C_hw is required when method='hazen_williams'"
            )
        return self


class AssemblyInput(BaseModel):
    """A suction or discharge pipe assembly — an ordered list of segments."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(default="", description="Assembly name (e.g. 'suction', 'discharge')")
    segments: list[PipeSegment] = Field(
        default_factory=list,
        description="Ordered list of pipe segments in this assembly",
    )

    # Node elevations [m above datum]
    node_elev_start_m: float = Field(
        description="Elevation of the start node of this assembly [m]"
    )
    node_elev_end_m: float = Field(
        description="Elevation of the end node of this assembly [m]"
    )

    # Optional pressure boundary conditions [m of water head]
    pressure_head_start_m: float = Field(
        default=0.0,
        description="Pressure head at the start node [m water] (e.g. suction well gauge)",
    )
    pressure_head_end_m: float = Field(
        default=0.0,
        description="Pressure head at the end node [m water] (e.g. discharge tank gauge)",
    )


class HydraulicComputeRequest(BaseModel):
    """Full multi-segment hydraulic calculation request."""

    model_config = ConfigDict(str_strip_whitespace=True)

    Q_m3h: Annotated[float, Field(gt=0, description="Design flow rate [m³/h] — SI")]
    suction: AssemblyInput = Field(description="Suction-side pipe assembly")
    discharge: AssemblyInput = Field(description="Discharge-side pipe assembly")
    unit_system: Literal["SI", "US"] = Field(
        default="SI",
        description=(
            "Display unit system (informational — all inputs must be in SI). "
            "Reserved for future display-unit conversion on this endpoint."
        ),
    )


# ---------------------------------------------------------------------------
# Multi-segment hydraulic compute — response schemas
# ---------------------------------------------------------------------------


class SegmentResult(BaseModel):
    """Per-segment hydraulic results."""

    model_config = ConfigDict(frozen=True)

    segment_index: int = Field(description="0-based index across suction + discharge segments")
    assembly: str = Field(description="Assembly name ('suction' or 'discharge')")
    label: str = Field(description="Human-readable label from the request")
    method: Literal["darcy_weisbach", "hazen_williams"]

    D_m: float = Field(description="Internal diameter [m]")
    L_m: float = Field(description="Pipe length [m]")
    K_sum: float = Field(description="Sum of minor-loss K values for this segment [-]")

    velocity_ms: float = Field(description="Mean flow velocity [m/s]")
    velocity_head_m: float = Field(description="Velocity head V²/(2g) [m]")

    # Darcy-Weisbach specific (None for Hazen-Williams)
    re: Optional[float] = Field(default=None, description="Reynolds number [-]")
    friction_factor: Optional[float] = Field(
        default=None, description="Darcy-Weisbach friction factor f [-]"
    )

    # Hazen-Williams specific (None for Darcy-Weisbach)
    C_hw: Optional[float] = Field(default=None, description="Hazen-Williams C [-]")

    hf_m: float = Field(description="Friction head loss in this segment [m]")
    hm_m: float = Field(description="Minor head loss in this segment [m]")
    segment_loss_m: float = Field(description="Total head loss in this segment hf + hm [m]")


class ComputeSystemCurvePoint(BaseModel):
    """One point on the multi-segment system H-Q curve."""

    model_config = ConfigDict(frozen=True)

    Q_m3h: float = Field(description="Flow rate [m³/h]")
    H_m: float = Field(description="System head [m]")


class HydraulicComputeResponse(BaseModel):
    """Full response from POST /compute/hydraulics."""

    model_config = ConfigDict()

    # Per-segment breakdown
    segments: list[SegmentResult] = Field(
        description="Hydraulic results for each pipe segment (suction then discharge order)"
    )

    # Summary head budget
    static_head_m: float = Field(
        description="Net elevation head: discharge end elev − suction start elev [m]"
    )
    total_hf_m: float = Field(description="Sum of friction head losses across all segments [m]")
    total_hm_m: float = Field(description="Sum of minor head losses across all segments [m]")
    delta_pressure_head_m: float = Field(
        description="Net pressure boundary head: discharge end − suction start [m water]"
    )
    delta_velocity_head_m: float = Field(
        description="Velocity head change from first to last segment V²/(2g) [m]"
    )
    tdh_m: float = Field(description="Total Dynamic Head [m]")

    # Echo
    design_Q_m3h: float = Field(description="Design flow rate echoed back [m³/h]")

    # System curve — 10 points from 0.2 Qd to 1.5 Qd
    system_curve: list[ComputeSystemCurvePoint] = Field(
        description="System H-Q curve: 10 points from 0.2 × Q_design to 1.5 × Q_design"
    )
