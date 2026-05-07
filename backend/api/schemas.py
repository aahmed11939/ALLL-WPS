"""
Pydantic v2 request/response schemas for the ALLL WPS Designer API.
"""

from __future__ import annotations

from typing import Annotated, List, Literal, Optional

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


# ---------------------------------------------------------------------------
# Clear well sizing — request schemas
# ---------------------------------------------------------------------------


class ClearWellGeometry(BaseModel):
    """Clear well geometry inputs."""

    model_config = ConfigDict(str_strip_whitespace=True)

    shape: Literal["cylindrical", "rectangular"] = Field(
        default="cylindrical",
        description="Plan geometry: 'cylindrical' (circular tank) or 'rectangular' (basin)",
    )
    diameter_m: Optional[float] = Field(
        default=None,
        gt=0,
        description="Internal diameter [m] — required for cylindrical",
    )
    length_m: Optional[float] = Field(
        default=None,
        gt=0,
        description="Internal length [m] — required for rectangular",
    )
    width_m: Optional[float] = Field(
        default=None,
        gt=0,
        description="Internal width [m] — required for rectangular",
    )

    @model_validator(mode="after")
    def check_dimensions(self) -> "ClearWellGeometry":
        if self.shape == "cylindrical" and self.diameter_m is None:
            raise ValueError("diameter_m is required for cylindrical geometry")
        if self.shape == "rectangular" and (
            self.length_m is None or self.width_m is None
        ):
            raise ValueError(
                "Both length_m and width_m are required for rectangular geometry"
            )
        return self


class ClearWellLevels(BaseModel):
    """Operating level inputs — all elevations above project datum [m]."""

    model_config = ConfigDict()

    LLL_m: float = Field(
        description="Low-Low Level: emergency pump trip / dry-run protection [m]"
    )
    LWL_m: float = Field(
        description="Low Water Level: pump-start (on) elevation [m]"
    )
    HWL_m: float = Field(
        description="High Water Level: pump-stop (off) elevation [m]"
    )
    HHL_m: float = Field(
        description="High-High Level: overflow alarm elevation [m]"
    )

    @model_validator(mode="after")
    def check_level_ordering(self) -> "ClearWellLevels":
        pairs = [
            ("LLL_m", self.LLL_m, "LWL_m", self.LWL_m),
            ("LWL_m", self.LWL_m, "HWL_m", self.HWL_m),
            ("HWL_m", self.HWL_m, "HHL_m", self.HHL_m),
        ]
        for lo_name, lo_val, hi_name, hi_val in pairs:
            if lo_val >= hi_val:
                raise ValueError(
                    f"Level ordering violated: {lo_name} ({lo_val} m) must be "
                    f"strictly less than {hi_name} ({hi_val} m)"
                )
        return self


class PumpStageInput(BaseModel):
    """Flow rate for one pump staging level."""

    model_config = ConfigDict()

    stage: Annotated[int, Field(ge=1, description="Staging level index (1 = single pump, 2 = two pumps, …)")]
    Q_pump_m3h: Annotated[float, Field(gt=0, description="Combined pump flow for this staging level [m³/h]")]
    label: str = Field(default="", description="Optional label (e.g. 'Duty', '2× Duty')")


class InflowProfile(BaseModel):
    """Inflow to the clear well — constant rate or 24-hour hourly array."""

    model_config = ConfigDict()

    type: Literal["constant", "hourly_24"] = Field(
        description="'constant' uses Q_in_m3h for all hours; 'hourly_24' uses a 24-value array"
    )
    Q_in_m3h: Optional[float] = Field(
        default=None,
        gt=0,
        description="Constant inflow rate [m³/h] — required when type='constant'",
    )
    hourly_Q_m3h: Optional[List[float]] = Field(
        default=None,
        description="24-element array of hourly inflows [m³/h] — required when type='hourly_24'",
    )

    @model_validator(mode="after")
    def check_inflow_profile(self) -> "InflowProfile":
        if self.type == "constant":
            if self.Q_in_m3h is None:
                raise ValueError("Q_in_m3h is required when type='constant'")
        if self.type == "hourly_24":
            if self.hourly_Q_m3h is None:
                raise ValueError("hourly_Q_m3h is required when type='hourly_24'")
            if len(self.hourly_Q_m3h) != 24:
                raise ValueError(
                    f"hourly_Q_m3h must have exactly 24 values, got {len(self.hourly_Q_m3h)}"
                )
            for i, q in enumerate(self.hourly_Q_m3h):
                if q < 0:
                    raise ValueError(
                        f"hourly_Q_m3h[{i}] must be >= 0, got {q}"
                    )
        return self

    @property
    def average_Q_m3h(self) -> float:
        """Return the average inflow rate [m³/h]."""
        if self.type == "constant":
            return self.Q_in_m3h or 0.0
        if self.hourly_Q_m3h:
            return sum(self.hourly_Q_m3h) / 24.0
        return 0.0

    @property
    def worst_case_Q_m3h(self) -> float:
        """Return the worst-case (maximum) inflow rate [m³/h]."""
        if self.type == "constant":
            return self.Q_in_m3h or 0.0
        if self.hourly_Q_m3h:
            return max(self.hourly_Q_m3h)
        return 0.0


class ClearWellRequest(BaseModel):
    """
    Full clear well sizing request.

    When ``active=False`` the endpoint returns immediately with an empty
    response (no computation); use this for 'bypassed' or 'disabled' states
    in the UI without sending incomplete data.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    active: bool = Field(
        default=True,
        description=(
            "True = compute sizing. False = skip computation (bypassed/disabled state). "
            "When False, all other fields are optional and ignored."
        ),
    )
    geometry: Optional[ClearWellGeometry] = Field(
        default=None,
        description="Clear well geometry — required when active=True",
    )
    levels: Optional[ClearWellLevels] = Field(
        default=None,
        description="Operating levels (LLL/LWL/HWL/HHL) — required when active=True",
    )
    pump_stages: List[PumpStageInput] = Field(
        default_factory=list,
        description="One entry per staging level (e.g. 1-pump, 2-pump). At least 1 required when active=True.",
    )
    inflow: Optional[InflowProfile] = Field(
        default=None,
        description="Inflow profile — required when active=True",
    )
    max_cycles_per_hour: Annotated[int, Field(default=6, ge=1, le=30)] = Field(
        default=6,
        description="Maximum allowable pump starts per hour (motor thermal limit). Typical: 4-6.",
    )
    required_detention_min: float = Field(
        default=0.0,
        ge=0.0,
        description=(
            "Minimum hydraulic detention time [min] for CT compliance (SWTR). "
            "Use 0 to skip the detention check."
        ),
    )

    @model_validator(mode="after")
    def check_active_fields(self) -> "ClearWellRequest":
        if not self.active:
            return self
        if self.geometry is None:
            raise ValueError("geometry is required when active=True")
        if self.levels is None:
            raise ValueError("levels is required when active=True")
        if not self.pump_stages:
            raise ValueError("At least one pump_stage is required when active=True")
        if self.inflow is None:
            raise ValueError("inflow is required when active=True")
        return self


# ---------------------------------------------------------------------------
# Clear well sizing — response schemas
# ---------------------------------------------------------------------------


class VolumeCurvePoint(BaseModel):
    """One point on the level → volume curve."""

    model_config = ConfigDict(frozen=True)

    level_m: float = Field(description="Water level elevation [m above datum]")
    depth_m: float = Field(description="Depth above LLL [m]")
    volume_m3: float = Field(description="Stored volume at this level [m³]")


class CycleResult(BaseModel):
    """Pump cycle analysis result for one staging level."""

    model_config = ConfigDict(frozen=True)

    stage: int = Field(description="Staging level index")
    label: str = Field(description="Staging level label")
    Q_pump_m3h: float = Field(description="Pump flow for this stage [m³/h]")
    Q_in_m3h: float = Field(description="Inflow used for this cycle analysis [m³/h]")
    t_fill_s: Optional[float] = Field(default=None, description="Well fill time (pump off) [s]")
    t_drain_s: Optional[float] = Field(default=None, description="Well drain time (pump on) [s]")
    t_cycle_s: Optional[float] = Field(default=None, description="Total cycle time [s]")
    cycles_per_hour: float = Field(description="Computed cycles per hour at this Q_in")
    V_req_m3: float = Field(description="AWWA M32 required volume for max cycles constraint [m³]")
    cycles_ok: bool = Field(description="True if operating volume >= required volume")
    pump_can_drain: bool = Field(description="False if pump cannot overcome inflow (Q_pump <= Q_in)")


class ClearWellResponse(BaseModel):
    """Full response from POST /compute/clearwell."""

    model_config = ConfigDict()

    active: bool = Field(description="Mirrors the request active flag")

    # Volume curve — empty when active=False
    volume_curve: List[VolumeCurvePoint] = Field(
        default_factory=list,
        description="Level → volume relationship from LLL to HHL (21 points)",
    )

    # Operating volume summary
    operating_volume_m3: Optional[float] = Field(
        default=None,
        description="Usable volume between LWL and HWL [m³]",
    )

    # Per-stage cycle analysis
    cycle_results: List[CycleResult] = Field(
        default_factory=list,
        description="Cycle analysis for each pump staging level",
    )

    # Detention time
    detention_time_min: Optional[float] = Field(
        default=None,
        description="Hydraulic detention time based on average inflow and average stored volume [min]",
    )
    required_detention_min: float = Field(
        default=0.0,
        description="Minimum required detention time [min] echoed from request",
    )
    detention_ok: Optional[bool] = Field(
        default=None,
        description="True if detention_time_min >= required_detention_min",
    )

    # Warnings
    warnings: List[str] = Field(
        default_factory=list,
        description="Actionable advisory warnings with suggested remedies",
    )


# ---------------------------------------------------------------------------
# Pump selection — type catalogue response
# ---------------------------------------------------------------------------


class HeadFlowRange(BaseModel):
    """Typical operating range for head or flow."""

    model_config = ConfigDict(frozen=True)

    min: float
    max: float


class TypeSpecificField(BaseModel):
    """
    Machine-readable field specification for one type-specific extras parameter.

    Frontend consumers use this to dynamically render the correct input widget
    for each pump type without hardcoding field logic in the UI.
    """

    model_config = ConfigDict(frozen=True)

    key: str = Field(description="Matches the key in the extras dict sent to POST /compute/pump-selection")
    label: str = Field(description="Human-readable label for the input field")
    field_type: Literal["string", "integer", "float", "boolean", "select"] = Field(
        description="Input type: string, integer, float, boolean (checkbox), or select (dropdown)"
    )
    required: bool = Field(description="True if the API will return 422 when this field is absent")
    unit: Optional[str] = Field(
        default=None,
        description="Display unit string appended to the input, e.g. 'm', 'kPa', '%' — null if unitless",
    )
    min_value: Optional[float] = Field(
        default=None,
        description="Inclusive minimum numeric value (null = no constraint)",
    )
    max_value: Optional[float] = Field(
        default=None,
        description="Inclusive maximum numeric value (null = no constraint)",
    )
    placeholder: Optional[str] = Field(
        default=None,
        description="Placeholder text for string/number inputs (null = none)",
    )
    options: Optional[List[str]] = Field(
        default=None,
        description="Allowed values for select fields (null for all other field types)",
    )


class PumpTypeInfo(BaseModel):
    """Full metadata record for one pump type in the catalogue."""

    model_config = ConfigDict(frozen=True)

    key: str = Field(description="Unique identifier used in API requests")
    display_name: str = Field(description="Human-readable name shown in the UI")
    family: str = Field(
        description=(
            "Pump family: centrifugal | vertical_turbine | booster | "
            "submersible | axial_flow | positive_displacement | fire_pump"
        )
    )
    potable_tag: Literal["recommended", "conditional", "niche"] = Field(
        description=(
            "Potable-water suitability: "
            "'recommended' = standard first choice; "
            "'conditional' = acceptable with specific constraints; "
            "'niche' = unusual for municipal potable service"
        )
    )
    description: str = Field(description="Brief engineering description of this pump type")
    typical_head_range_m: HeadFlowRange = Field(description="Typical TDH range [m]")
    typical_flow_range_m3h: HeadFlowRange = Field(description="Typical flow range [m³/h]")
    constraints: List[str] = Field(
        default_factory=list,
        description="Engineering constraints and sizing considerations",
    )
    potable_notes: List[str] = Field(
        default_factory=list,
        description="Potable-water compliance notes and AHJ guidance",
    )
    extras_schema: Optional[str] = Field(
        default=None,
        description=(
            "Name of the type-specific extras schema required for this pump type, "
            "or null if no extras are required."
        ),
    )
    type_specific_inputs: List[TypeSpecificField] = Field(
        default_factory=list,
        description=(
            "Ordered list of field specifications for type-specific extras parameters. "
            "Empty for pump types that require no extras. "
            "Consumers use this to render dynamic forms without hardcoding field logic."
        ),
    )


class PumpTypesResponse(BaseModel):
    """Response from GET /compute/pump-types."""

    pump_types: List[PumpTypeInfo] = Field(description="All 16 pump types, sorted by family then name")
    count: int = Field(description="Total number of pump types in the catalogue")


# ---------------------------------------------------------------------------
# Pump selection — type-specific extras models
# ---------------------------------------------------------------------------


class VerticalTurbineExtras(BaseModel):
    """Extra design parameters required for vertical turbine pumps."""

    model_config = ConfigDict()

    bowl_model: Optional[str] = Field(
        default=None,
        description="Bowl assembly model designation (optional — for traceability)",
    )
    bowl_count: Annotated[int, Field(ge=1, description="Number of bowl stages")] = 1
    column_length_m: Annotated[float, Field(gt=0, description="Column pipe setting length [m]")] = 10.0
    min_submergence_m: Annotated[float, Field(ge=0, description="Minimum required bowl submergence [m]")] = 1.0
    bowl_efficiency_pct: Optional[float] = Field(
        default=None,
        ge=1.0,
        le=100.0,
        description="Bowl assembly efficiency at BEP [%] — optional",
    )


class SubmersibleExtras(BaseModel):
    """Extra design parameters required for submersible pumps."""

    model_config = ConfigDict()

    installation_depth_m: Annotated[float, Field(gt=0, description="Pump centreline depth below water surface [m]")] = 5.0
    motor_cooling: Literal["fluid_cooled", "shroud", "air", "none"] = Field(
        default="fluid_cooled",
        description=(
            "Motor cooling method: "
            "'fluid_cooled' = through-flow over motor; "
            "'shroud' = cooling shroud forces flow past motor; "
            "'air' = air-cooled (dry-pit); "
            "'none' = no forced cooling"
        ),
    )
    min_flow_cooling_m3h: Optional[float] = Field(
        default=None,
        gt=0,
        description="Minimum flow required to cool the motor [m³/h] — from manufacturer's data sheet",
    )


class BoosterSetExtras(BaseModel):
    """Extra design parameters required for inline booster / booster-set pumps."""

    model_config = ConfigDict()

    setpoint_pressure_kPa: Annotated[float, Field(gt=0, description="Discharge pressure setpoint [kPa]")] = 500.0
    num_pumps_in_set: Annotated[int, Field(ge=1, description="Number of pump units in the factory set")] = 2
    vfd_equipped: bool = Field(default=True, description="True if the booster set includes variable-frequency drives")


class PDPumpExtras(BaseModel):
    """Extra design parameters required for positive-displacement pumps (all sub-types)."""

    model_config = ConfigDict()

    displacement_L_per_rev: Annotated[float, Field(gt=0, description="Volumetric displacement per revolution [L/rev]")] = 1.0
    max_pressure_kPa: Annotated[float, Field(gt=0, description="Maximum rated differential pressure [kPa]")] = 700.0
    pulsation_dampener: bool = Field(
        default=False,
        description="True if a pulsation dampener is specified on the discharge line",
    )


class FirePumpExtras(BaseModel):
    """Extra design parameters for fire pumps."""

    model_config = ConfigDict()

    nfpa20_compliance: bool = Field(
        default=False,
        description="Confirm the pump is listed and labeled per NFPA 20",
    )


# ---------------------------------------------------------------------------
# Pump selection — request / response
# ---------------------------------------------------------------------------


class PumpSelectionRequest(BaseModel):
    """
    Pump selection input.

    When ``active=False`` the endpoint returns immediately with an empty
    response — matching the bypass pattern used by ClearWell and other steps.
    """

    model_config = ConfigDict(str_strip_whitespace=True)

    active: bool = Field(
        default=True,
        description="True = perform selection logic. False = skip (bypassed/disabled state).",
    )
    pump_type_key: Optional[str] = Field(
        default=None,
        description="Catalogue key identifying the chosen pump type. Required when active=True.",
    )
    control_mode: Literal["constant_speed", "vfd"] = Field(
        default="constant_speed",
        description="Speed control: 'constant_speed' (DOL/soft-start) or 'vfd' (variable-frequency drive)",
    )
    n_duty: Annotated[int, Field(ge=1, description="Number of duty pumps")] = 1
    n_standby: Annotated[int, Field(ge=0, description="Number of standby pumps")] = 1
    extras: Optional[dict] = Field(
        default=None,
        description=(
            "Type-specific extra parameters. "
            "Required for: vertical_turbine, submersible, inline_booster, "
            "pd_* types, fire_pump. Pass null for centrifugal / axial_flow types."
        ),
    )

    @model_validator(mode="after")
    def check_active_fields(self) -> "PumpSelectionRequest":
        if self.active and not self.pump_type_key:
            raise ValueError("pump_type_key is required when active=True")
        return self


class PumpSelectionResponse(BaseModel):
    """Response from POST /compute/pump-selection."""

    model_config = ConfigDict()

    active: bool = Field(description="Mirrors the request active flag")
    type_info: Optional[PumpTypeInfo] = Field(
        default=None,
        description="Full catalogue record for the selected pump type",
    )
    config_summary: Optional[str] = Field(
        default=None,
        description="Human-readable configuration summary (e.g. '2+1 duty/standby | VFD | End-Suction Centrifugal')",
    )
    potable_notes: List[str] = Field(
        default_factory=list,
        description="Potable-water compliance notes for the selected type",
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Actionable advisory warnings for this pump selection",
    )
