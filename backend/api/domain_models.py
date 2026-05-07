"""
ALLL WPS Designer — Pydantic v2 domain models for a complete potable-water
pump station design project.

These models are the data contract for all calculation modules (hydraulics,
wet-well sizing, pump curve fitting, surge analysis, export).  They accept SI
values internally; ``unit_system`` in ``ProjectMeta`` is metadata only.

Advisory thresholds:
    POTABLE_V_MIN           0.6  m/s   — minimum to prevent sedimentation
    POTABLE_V_MAX           3.0  m/s   — maximum to limit losses/noise
    POTABLE_HF_GRADIENT_MAX 10.0 m/100m — maximum friction gradient
    NPSH_MARGIN_MIN         0.5  m     — minimum NPSHa − NPSHr margin
"""

from __future__ import annotations

import datetime
import math
from typing import Annotated, Literal, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

# ---------------------------------------------------------------------------
# Advisory thresholds (potable water, ref. AWWA M11, Ten States Standards)
# ---------------------------------------------------------------------------

POTABLE_V_MIN: float = 0.6          # m/s
POTABLE_V_MAX: float = 3.0          # m/s
POTABLE_HF_GRADIENT_MAX: float = 10.0  # m per 100 m of pipe
NPSH_MARGIN_MIN: float = 0.5        # m

_G = 9.81  # m/s²


# ---------------------------------------------------------------------------
# Controlled-vocabulary aliases
# ---------------------------------------------------------------------------

UnitSystem = Literal["SI", "US"]
WetWellGeometry = Literal["cylindrical", "rectangular"]
PumpType = Literal[
    "end_suction",
    "split_case",
    "vertical_turbine",
    "submersible",
    "axial_flow",
    "multistage",
]
ControlMode = Literal["constant_speed", "vfd"]
SuctionArrangement = Literal["flooded", "suction_lift", "submersible"]
FrictionMethod = Literal["darcy_weisbach", "hazen_williams"]
SurgeMode = Literal["quick", "moc"]
PipelineChoice = Literal["suction", "discharge", "both"]
BoundaryType = Literal["reservoir", "closed", "pressure"]
SurgeEvent = Literal["pump_trip", "pump_start", "valve_closure"]
CurveFlowUnit = Literal["m3h", "ls", "gpm"]
CurveHeadUnit = Literal["m", "ft"]
CurvePowerUnit = Literal["kW", "hp"]


# ---------------------------------------------------------------------------
# ProjectMeta
# ---------------------------------------------------------------------------


class ProjectMeta(BaseModel):
    """Top-level project identification and metadata."""

    model_config = ConfigDict(str_strip_whitespace=True)

    name: Annotated[
        str,
        Field(min_length=1, description="Project name (required)"),
    ]
    designer: Annotated[
        str,
        Field(min_length=1, description="Engineer of record / designer name"),
    ]
    date: Annotated[
        datetime.date,
        Field(description="Design date (ISO 8601, e.g. 2026-05-07)"),
    ]
    unit_system: Annotated[
        UnitSystem,
        Field(description="Display unit system: 'SI' or 'US'. All model fields use SI."),
    ]
    project_number: Annotated[
        Optional[str],
        Field(default=None, description="Client or office project reference number"),
    ]
    client: Annotated[
        Optional[str],
        Field(default=None, description="Client or asset-owner name"),
    ]
    revision: Annotated[
        Optional[str],
        Field(default=None, pattern=r"^[A-Z0-9][A-Z0-9\-\.]*$",
              description="Revision identifier, e.g. 'A', 'B', '1.2'"),
    ]


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------


class Node(BaseModel):
    """A hydraulic node: reservoir, junction, delivery point, or sensor location."""

    model_config = ConfigDict(str_strip_whitespace=True)

    id: Annotated[str, Field(min_length=1, description="Unique node identifier")]
    name: Annotated[str, Field(min_length=1, description="Human-readable node label")]
    elevation_m: Annotated[
        float,
        Field(description="Node elevation above project datum [m]"),
    ]
    pressure_kPa: Annotated[
        Optional[float],
        Field(default=None, ge=0.0,
              description="Known gauge pressure at node [kPa]. None if unknown."),
    ]
    min_water_level_m: Annotated[
        Optional[float],
        Field(default=None,
              description="Minimum operating water surface elevation [m above datum]"),
    ]
    max_water_level_m: Annotated[
        Optional[float],
        Field(default=None,
              description="Maximum operating water surface elevation [m above datum]"),
    ]

    @model_validator(mode="after")
    def check_water_level_ordering(self) -> "Node":
        if (
            self.min_water_level_m is not None
            and self.max_water_level_m is not None
            and self.min_water_level_m >= self.max_water_level_m
        ):
            raise ValueError(
                f"Node '{self.id}': min_water_level_m ({self.min_water_level_m}) "
                f"must be less than max_water_level_m ({self.max_water_level_m})"
            )
        return self


# ---------------------------------------------------------------------------
# MinorLossItem
# ---------------------------------------------------------------------------

_POTABLE_FITTING_TYPES = {
    "gate_valve",
    "butterfly_valve",
    "ball_valve",
    "check_valve_swing",
    "check_valve_dual_disc",
    "check_valve_tilting_disc",
    "foot_valve",
    "strainer_y",
    "strainer_basket",
    "elbow_90",
    "elbow_45",
    "tee_through",
    "tee_branch",
    "reducer_concentric",
    "reducer_eccentric",
    "coupling",
    "flow_meter_mag",
    "flow_meter_vortex",
    "air_valve_kinetic",
    "air_valve_triple_function",
    "pressure_relief_valve",
    "entry_sharp",
    "entry_reentrant",
    "exit",
    "other",
}


class MinorLossItem(BaseModel):
    """A single fitting or valve contributing a minor (local) head loss."""

    model_config = ConfigDict(str_strip_whitespace=True)

    type: Annotated[
        str,
        Field(
            min_length=1,
            description=(
                "Fitting type key. Recognised potable-service types: "
                + ", ".join(sorted(_POTABLE_FITTING_TYPES))
            ),
        ),
    ]
    count: Annotated[
        int,
        Field(ge=1, description="Number of identical fittings of this type"),
    ]
    K: Annotated[
        float,
        Field(ge=0.0,
              description="Velocity-head loss coefficient K for ONE fitting (total = count × K)"),
    ]
    notes: str = Field(default="", description="Reference standard, manufacturer, or source note")

    @property
    def K_total(self) -> float:
        """Sum of K for all fittings of this type."""
        return self.count * self.K

    @field_validator("type", mode="after")
    @classmethod
    def hint_potable_type(cls, v: str) -> str:
        if v not in _POTABLE_FITTING_TYPES:
            pass  # allow unknown types; caller receives advisory warning at project level
        return v


# ---------------------------------------------------------------------------
# PipelineSegment
# ---------------------------------------------------------------------------


class PipelineSegment(BaseModel):
    """One pipe segment with geometry, material, friction method, and fittings."""

    model_config = ConfigDict(str_strip_whitespace=True)

    id: Annotated[str, Field(min_length=1, description="Unique segment identifier")]
    name: Annotated[str, Field(min_length=1, description="Human-readable segment label")]
    length_m: Annotated[float, Field(gt=0.0, description="Pipe centre-line length [m]")]
    diameter_mm: Annotated[float, Field(gt=0.0, description="Internal pipe diameter [mm]")]
    material: Annotated[
        str,
        Field(min_length=1,
              description="Pipe material key (must match pipe_materials.yaml for Darcy-Weisbach)"),
    ]
    friction_method: Annotated[
        FrictionMethod,
        Field(default="darcy_weisbach",
              description="Friction-loss method: 'darcy_weisbach' (default) or 'hazen_williams'"),
    ]
    roughness_epsilon_mm: Annotated[
        Optional[float],
        Field(default=None, ge=0.0,
              description="Absolute roughness ε [mm]. Required for Darcy-Weisbach."),
    ]
    hazen_williams_C: Annotated[
        Optional[float],
        Field(default=None, gt=0.0,
              description=(
                  "Hazen-Williams C coefficient. Required for hazen_williams method. "
                  "Typical potable: HDPE/PVC 150, DI cement-lined 130-140, steel 120."
              )),
    ]
    minor_losses: list[MinorLossItem] = Field(
        default_factory=list,
        description="Fittings and valves contributing minor losses in this segment",
    )

    @model_validator(mode="after")
    def check_friction_params(self) -> "PipelineSegment":
        if self.friction_method == "darcy_weisbach" and self.roughness_epsilon_mm is None:
            raise ValueError(
                f"Segment '{self.id}': roughness_epsilon_mm is required "
                "when friction_method is 'darcy_weisbach'."
            )
        if self.friction_method == "hazen_williams" and self.hazen_williams_C is None:
            raise ValueError(
                f"Segment '{self.id}': hazen_williams_C is required "
                "when friction_method is 'hazen_williams'."
            )
        return self

    @property
    def K_sum(self) -> float:
        return sum(item.K_total for item in self.minor_losses)

    def velocity_ms(self, Q_m3s: float) -> float:
        """Pipe velocity for given flow [m/s]."""
        D = self.diameter_mm / 1000.0
        A = math.pi / 4.0 * D ** 2
        return Q_m3s / A if A > 0 else 0.0

    def friction_gradient_m_per_100m(self, Q_m3s: float, roughness_m: float) -> float:
        """Darcy-Weisbach friction gradient [m/100 m] — approximate, for advisory check only."""
        from backend.engine.hydraulics import friction_head_loss

        if Q_m3s <= 0 or self.length_m <= 0:
            return 0.0
        D = self.diameter_mm / 1000.0
        h_f = friction_head_loss(Q_m3s, D, self.length_m, roughness_m)
        return h_f / self.length_m * 100.0


# ---------------------------------------------------------------------------
# PipeAssembly
# ---------------------------------------------------------------------------


class PipeAssembly(BaseModel):
    """An ordered series of pipe segments (suction or discharge pipeline)."""

    label: Annotated[
        str,
        Field(min_length=1,
              description="Assembly label, e.g. 'Suction' or 'Discharge'"),
    ]
    segments: Annotated[
        list[PipelineSegment],
        Field(min_length=1, description="Ordered series of pipe segments"),
    ]
    design_flow_m3h: Annotated[
        Optional[float],
        Field(default=None, gt=0.0,
              description="Design flow rate through this assembly [m³/h]. Used for velocity advisory checks."),
    ]


# ---------------------------------------------------------------------------
# WetWell
# ---------------------------------------------------------------------------


class WetWell(BaseModel):
    """Wet-well (sump) geometry and operating level configuration."""

    model_config = ConfigDict()

    geometry: Annotated[
        WetWellGeometry,
        Field(default="cylindrical",
              description="Wet-well plan geometry: 'cylindrical' or 'rectangular'"),
    ]

    # Cylindrical geometry
    diameter_m: Annotated[
        Optional[float],
        Field(default=None, gt=0.0,
              description="Internal diameter [m]. Required when geometry='cylindrical'."),
    ]

    # Rectangular geometry
    length_m: Annotated[
        Optional[float],
        Field(default=None, gt=0.0,
              description="Internal length [m]. Required when geometry='rectangular'."),
    ]
    width_m: Annotated[
        Optional[float],
        Field(default=None, gt=0.0,
              description="Internal width [m]. Required when geometry='rectangular'."),
    ]

    # Operating levels — all elevations above project datum [m]
    LLL_m: Annotated[
        float,
        Field(description="Low-Low Level: emergency pump trip / dry-run protection elevation [m]"),
    ]
    LWL_m: Annotated[
        float,
        Field(description="Low Water Level: pump-on (duty start) elevation [m]"),
    ]
    HWL_m: Annotated[
        float,
        Field(description="High Water Level: pump-off elevation [m]"),
    ]
    HHL_m: Annotated[
        float,
        Field(description="High-High Level: overflow alarm elevation [m]"),
    ]

    # Cycle constraints
    max_starts_per_hour: Annotated[
        int,
        Field(default=6, ge=1, le=30,
              description="Maximum pump starts per hour (motor thermal limit). Typical: 4-6."),
    ]
    required_detention_min: Annotated[
        float,
        Field(default=0.0, ge=0.0,
              description="Minimum hydraulic detention time [min] for chlorine contact or sedimentation control."),
    ]

    @model_validator(mode="after")
    def check_level_ordering(self) -> "WetWell":
        levels = [
            ("LLL_m", self.LLL_m),
            ("LWL_m", self.LWL_m),
            ("HWL_m", self.HWL_m),
            ("HHL_m", self.HHL_m),
        ]
        for i in range(len(levels) - 1):
            name_lo, val_lo = levels[i]
            name_hi, val_hi = levels[i + 1]
            if val_lo >= val_hi:
                raise ValueError(
                    f"Wet-well level ordering violated: {name_lo} ({val_lo} m) "
                    f"must be strictly less than {name_hi} ({val_hi} m)."
                )
        return self

    @model_validator(mode="after")
    def check_geometry_dimensions(self) -> "WetWell":
        if self.geometry == "cylindrical":
            if self.diameter_m is None:
                raise ValueError(
                    "diameter_m is required when geometry is 'cylindrical'."
                )
        elif self.geometry == "rectangular":
            if self.length_m is None or self.width_m is None:
                raise ValueError(
                    "Both length_m and width_m are required when geometry is 'rectangular'."
                )
        return self

    @property
    def usable_volume_m3(self) -> float:
        """Approximate usable volume between LWL and HWL [m³]."""
        depth = self.HWL_m - self.LWL_m
        if self.geometry == "cylindrical" and self.diameter_m is not None:
            return math.pi / 4.0 * self.diameter_m ** 2 * depth
        if (
            self.geometry == "rectangular"
            and self.length_m is not None
            and self.width_m is not None
        ):
            return self.length_m * self.width_m * depth
        return 0.0


# ---------------------------------------------------------------------------
# PumpStation
# ---------------------------------------------------------------------------


class PumpStation(BaseModel):
    """Pump station configuration — pump type, control, duty/standby, NPSH inputs."""

    model_config = ConfigDict()

    pump_type: Annotated[
        PumpType,
        Field(default="end_suction",
              description=(
                  "Pump type. Potable-service common choices: 'end_suction', "
                  "'split_case' (large stations), 'vertical_turbine' (deep sumps), "
                  "'submersible' (wet-well installation)."
              )),
    ]
    potable_compliant_materials: Annotated[
        bool,
        Field(default=True,
              description=(
                  "If True, pump wetted materials comply with NSF/ANSI 61 (or equivalent) "
                  "for potable water contact. Set False to suppress advisory tag."
              )),
    ]
    control: Annotated[
        ControlMode,
        Field(default="constant_speed",
              description="Speed control: 'constant_speed' or 'vfd' (variable frequency drive)"),
    ]
    num_duty: Annotated[
        int,
        Field(default=1, ge=1,
              description="Number of duty pumps running at design flow"),
    ]
    num_standby: Annotated[
        int,
        Field(default=1, ge=0,
              description="Number of standby pumps (n+m arrangement)"),
    ]
    staging: Annotated[
        int,
        Field(default=1, ge=1,
              description="Number of pumps staged-in simultaneously at maximum demand (1 = single-pump operation)"),
    ]
    motor_efficiency_pct: Annotated[
        float,
        Field(default=92.0, gt=0.0, le=100.0,
              description="Motor efficiency at rated load [%]. Typical IE3: 90-95%."),
    ]
    drive_efficiency_pct: Annotated[
        float,
        Field(default=98.0, gt=0.0, le=100.0,
              description=(
                  "Drive efficiency [%]. Use 100.0 for direct-on-line constant-speed drives. "
                  "Typical VFD at full speed: 97-98%."
              )),
    ]
    suction_arrangement: Annotated[
        SuctionArrangement,
        Field(default="flooded",
              description="Suction arrangement: 'flooded' (preferred), 'suction_lift', or 'submersible'"),
    ]

    # NPSH inputs
    NPSHa_m: Annotated[
        Optional[float],
        Field(default=None, ge=0.0,
              description="Available NPSH at pump inlet [m]. Computed from suction conditions."),
    ]
    NPSHr_m: Annotated[
        Optional[float],
        Field(default=None, ge=0.0,
              description="Required NPSH per pump manufacturer's curve [m] at design flow."),
    ]

    @model_validator(mode="after")
    def check_staging_le_duty(self) -> "PumpStation":
        if self.staging > self.num_duty:
            raise ValueError(
                f"staging ({self.staging}) cannot exceed num_duty ({self.num_duty})."
            )
        return self


# ---------------------------------------------------------------------------
# PumpCurveSet
# ---------------------------------------------------------------------------


class CurveUnits(BaseModel):
    """Unit metadata for the pump performance curves."""

    flow: Annotated[CurveFlowUnit, Field(default="m3h", description="Flow unit for curve data")]
    head: Annotated[CurveHeadUnit, Field(default="m", description="Head unit for curve data")]
    power: Annotated[CurvePowerUnit, Field(default="kW", description="Power unit for curve data")]


class PumpCurveSet(BaseModel):
    """
    Digitised pump performance curves for a single pump model.

    All point lists are (flow, value) pairs sorted by ascending flow.
    Flow and value units are declared in ``curve_units``.
    """

    model_config = ConfigDict()

    pump_id: Annotated[
        str,
        Field(min_length=1,
              description="Identifier linking this curve set to a PumpRecord in the library"),
    ]
    curve_units: CurveUnits = Field(default_factory=CurveUnits)

    HQ_points: Annotated[
        list[tuple[float, float]],
        Field(min_length=2,
              description="Head-flow (Q, H) pairs. At least 2 points required. Typically 5-10."),
    ]
    Eff_points: Annotated[
        Optional[list[tuple[float, float]]],
        Field(default=None,
              description="Efficiency-flow (Q, Eff%) pairs. Optional but recommended."),
    ]
    Power_points: Annotated[
        Optional[list[tuple[float, float]]],
        Field(default=None,
              description="Power-flow (Q, P) pairs in declared power unit. Optional."),
    ]
    NPSHr_points: Annotated[
        Optional[list[tuple[float, float]]],
        Field(default=None,
              description="NPSHr-flow (Q, NPSHr_m) pairs. Strongly recommended for potable service."),
    ]

    @field_validator("HQ_points", mode="after")
    @classmethod
    def check_hq_ascending_flow(
        cls, pts: list[tuple[float, float]]
    ) -> list[tuple[float, float]]:
        flows = [p[0] for p in pts]
        for i in range(len(flows) - 1):
            if flows[i] >= flows[i + 1]:
                raise ValueError(
                    f"HQ_points must have strictly ascending flow values; "
                    f"got {flows[i]} ≥ {flows[i + 1]} at index {i}."
                )
        return pts

    @field_validator("HQ_points", mode="after")
    @classmethod
    def check_hq_non_negative(
        cls, pts: list[tuple[float, float]]
    ) -> list[tuple[float, float]]:
        for q, h in pts:
            if q < 0:
                raise ValueError(f"HQ_points: flow value {q} must be ≥ 0.")
            if h < 0:
                raise ValueError(f"HQ_points: head value {h} at Q={q} must be ≥ 0.")
        return pts


# ---------------------------------------------------------------------------
# AccessoriesLibrary
# ---------------------------------------------------------------------------


class ValveSpec(BaseModel):
    """Specification for a valve type within the accessories library."""

    model_config = ConfigDict(str_strip_whitespace=True)

    type: Annotated[str, Field(min_length=1, description="Valve type name")]
    standard: Annotated[
        str,
        Field(default="",
              description="Governing standard, e.g. 'AWWA C500', 'AS 4087'"),
    ]
    material: Annotated[
        str,
        Field(default="",
              description="Body/trim material, e.g. 'ductile iron / stainless trim'"),
    ]
    nsf61_listed: Annotated[
        bool,
        Field(default=True,
              description="Whether this valve is NSF/ANSI 61 listed for potable water contact"),
    ]
    notes: str = Field(default="")


class InstrumentSpec(BaseModel):
    """Specification for an instrument or sensor."""

    model_config = ConfigDict(str_strip_whitespace=True)

    type: Annotated[str, Field(min_length=1, description="Instrument type")]
    enabled: bool = Field(default=True)
    standard: str = Field(default="")
    notes: str = Field(default="")


class AccessoriesLibrary(BaseModel):
    """
    Accessories and instruments included in the pump station.

    Defaults represent a typical potable-water duty station per AWWA guidelines.
    All valves default to NSF/ANSI 61-listed materials.
    """

    model_config = ConfigDict()

    isolation_valves: list[ValveSpec] = Field(
        default_factory=list,
        description="Isolation valves (gate, butterfly, ball) on suction and discharge",
    )
    check_valves: list[ValveSpec] = Field(
        default_factory=list,
        description="Non-return / check valves on pump discharge",
    )
    pressure_gauges: Annotated[
        bool,
        Field(default=True,
              description="Include suction and discharge pressure gauges"),
    ]
    flow_meters: Annotated[
        bool,
        Field(default=True,
              description="Include electromagnetic or ultrasonic flow meters"),
    ]
    strainers: Annotated[
        bool,
        Field(default=True,
              description="Include Y-strainer or basket strainer on pump suction"),
    ]
    air_release_valves: Annotated[
        bool,
        Field(default=True,
              description="Include combination air-release/air-vacuum valves on discharge"),
    ]
    pressure_relief_valves: Annotated[
        bool,
        Field(default=False,
              description="Include pressure-relief valve on discharge (required if surge risk)"),
    ]
    electromagnetic_flow_meter: Annotated[
        bool,
        Field(default=True,
              description="Magnetic flow meter (preferred for potable — no moving parts)"),
    ]
    chlorine_analyzer: Annotated[
        bool,
        Field(default=False,
              description="Include online chlorine residual analyzer"),
    ]
    turbidity_meter: Annotated[
        bool,
        Field(default=False,
              description="Include online turbidity meter"),
    ]
    instruments: list[InstrumentSpec] = Field(
        default_factory=list,
        description="Additional instruments (pressure transmitters, level sensors, etc.)",
    )


# ---------------------------------------------------------------------------
# SurgeStudy
# ---------------------------------------------------------------------------


class PRVConfig(BaseModel):
    """Pressure-relief valve surge-protection option."""

    enabled: bool = Field(default=False, description="Include PRV in surge model")
    set_pressure_kPa: Annotated[
        Optional[float],
        Field(default=None, ge=0.0,
              description="PRV relief set-point [kPa gauge]. Required if enabled."),
    ]

    @model_validator(mode="after")
    def check_set_pressure_when_enabled(self) -> "PRVConfig":
        if self.enabled and self.set_pressure_kPa is None:
            raise ValueError("PRVConfig: set_pressure_kPa is required when enabled=True.")
        return self


class AirVesselConfig(BaseModel):
    """Air vessel (hydro-pneumatic tank) surge-protection option."""

    enabled: bool = Field(default=False, description="Include air vessel in surge model")
    volume_L: Annotated[
        Optional[float],
        Field(default=None, gt=0.0,
              description="Air vessel total volume [L]. Required if enabled."),
    ]
    pre_charge_kPa: Annotated[
        Optional[float],
        Field(default=None, ge=0.0,
              description="Air pre-charge pressure [kPa gauge]. Required if enabled."),
    ]

    @model_validator(mode="after")
    def check_params_when_enabled(self) -> "AirVesselConfig":
        if self.enabled:
            if self.volume_L is None:
                raise ValueError("AirVesselConfig: volume_L is required when enabled=True.")
            if self.pre_charge_kPa is None:
                raise ValueError(
                    "AirVesselConfig: pre_charge_kPa is required when enabled=True."
                )
        return self


class SurgeStudy(BaseModel):
    """
    Surge / water-hammer analysis configuration.

    Disabled by default.  When enabled, the chosen mode drives the calculation
    engine (quick = Joukowsky estimate; moc = method-of-characteristics).
    """

    model_config = ConfigDict()

    enabled: Annotated[
        bool,
        Field(default=False,
              description="Enable surge analysis. False by default — must be explicitly activated."),
    ]
    mode: Annotated[
        SurgeMode,
        Field(default="quick",
              description="Analysis method: 'quick' (Joukowsky) or 'moc' (Method of Characteristics)"),
    ]
    pipeline_choice: Annotated[
        PipelineChoice,
        Field(default="discharge",
              description="Pipeline(s) to analyse: 'suction', 'discharge', or 'both'"),
    ]
    boundary_upstream: Annotated[
        BoundaryType,
        Field(default="reservoir",
              description="Upstream boundary condition type"),
    ]
    boundary_downstream: Annotated[
        BoundaryType,
        Field(default="reservoir",
              description="Downstream boundary condition type"),
    ]
    event_type: Annotated[
        SurgeEvent,
        Field(default="pump_trip",
              description="Triggering event: 'pump_trip', 'pump_start', or 'valve_closure'"),
    ]
    wave_speed_ms: Annotated[
        float,
        Field(default=1200.0, gt=0.0, le=2000.0,
              description=(
                  "Joukowsky wave speed [m/s]. Typical: PVC 300-400, DI 1000-1200, "
                  "steel 1100-1300. Default 1200 m/s (conservative)."
              )),
    ]
    prv: PRVConfig = Field(default_factory=PRVConfig)
    air_vessel: AirVesselConfig = Field(default_factory=AirVesselConfig)


# ---------------------------------------------------------------------------
# ProjectModel (top-level composite)
# ---------------------------------------------------------------------------


class ProjectModel(BaseModel):
    """
    Complete potable-water pump station design project.

    Composes all domain sub-models.  After construction, ``warnings`` contains
    non-blocking advisory messages for typical potable-service guidelines.
    """

    model_config = ConfigDict()

    meta: ProjectMeta
    nodes: list[Node] = Field(
        default_factory=list,
        description="Hydraulic nodes (reservoirs, junctions, delivery points)",
    )
    suction: Annotated[
        Optional[PipeAssembly],
        Field(default=None, description="Suction pipeline assembly"),
    ]
    discharge: Annotated[
        Optional[PipeAssembly],
        Field(default=None, description="Discharge pipeline assembly"),
    ]
    wet_well: Annotated[
        Optional[WetWell],
        Field(default=None, description="Wet-well / sump configuration"),
    ]
    pump_station: Annotated[
        Optional[PumpStation],
        Field(default=None, description="Pump station configuration"),
    ]
    pump_curves: list[PumpCurveSet] = Field(
        default_factory=list,
        description="Digitised pump performance curves (one set per pump model)",
    )
    accessories: AccessoriesLibrary = Field(
        default_factory=AccessoriesLibrary,
        description="Station accessories and instrumentation",
    )
    surge: SurgeStudy = Field(
        default_factory=SurgeStudy,
        description="Surge study configuration (disabled by default)",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-blocking advisory warnings generated during validation",
    )

    @model_validator(mode="after")
    def compute_advisory_warnings(self) -> "ProjectModel":
        """
        Populate ``warnings`` with non-blocking advisory messages.

        Checks performed:
        - NPSH margin (NPSHa − NPSHr ≥ NPSH_MARGIN_MIN)
        - Pipe velocity within potable guideline range (POTABLE_V_MIN–POTABLE_V_MAX)
        - Friction gradient below POTABLE_HF_GRADIENT_MAX
        - Unknown fitting types on pipeline segments
        """
        warns: list[str] = []

        # --- NPSH margin check ---
        ps = self.pump_station
        if ps is not None and ps.NPSHa_m is not None and ps.NPSHr_m is not None:
            margin = ps.NPSHa_m - ps.NPSHr_m
            if margin < NPSH_MARGIN_MIN:
                warns.append(
                    f"NPSH margin ({margin:.2f} m) is below the recommended minimum of "
                    f"{NPSH_MARGIN_MIN} m (NPSHa={ps.NPSHa_m} m, NPSHr={ps.NPSHr_m} m). "
                    "Risk of cavitation — review suction conditions."
                )

        # --- Velocity and friction gradient checks ---
        for assembly in (self.suction, self.discharge):
            if assembly is None:
                continue
            if assembly.design_flow_m3h is None:
                continue
            Q_m3s = assembly.design_flow_m3h / 3600.0
            for seg in assembly.segments:
                V = seg.velocity_ms(Q_m3s)
                label = f"{assembly.label} / segment '{seg.id}'"
                if V > 0 and V < POTABLE_V_MIN:
                    warns.append(
                        f"{label}: velocity {V:.2f} m/s is below the potable-service "
                        f"guideline minimum of {POTABLE_V_MIN} m/s. "
                        "Consider reducing pipe diameter to prevent sedimentation."
                    )
                if V > POTABLE_V_MAX:
                    warns.append(
                        f"{label}: velocity {V:.2f} m/s exceeds the potable-service "
                        f"guideline maximum of {POTABLE_V_MAX} m/s. "
                        "Consider increasing pipe diameter to reduce losses and noise."
                    )
                # Friction gradient (Darcy-Weisbach only, requires roughness)
                if (
                    seg.friction_method == "darcy_weisbach"
                    and seg.roughness_epsilon_mm is not None
                ):
                    roughness_m = seg.roughness_epsilon_mm / 1000.0
                    try:
                        grad = seg.friction_gradient_m_per_100m(Q_m3s, roughness_m)
                        if grad > POTABLE_HF_GRADIENT_MAX:
                            warns.append(
                                f"{label}: friction gradient {grad:.1f} m/100 m exceeds "
                                f"the potable-service guideline of {POTABLE_HF_GRADIENT_MAX} m/100 m. "
                                "Review pipe sizing."
                            )
                    except Exception:
                        pass  # advisory only; never block construction

        # --- Unknown fitting types ---
        for assembly in (self.suction, self.discharge):
            if assembly is None:
                continue
            for seg in assembly.segments:
                for item in seg.minor_losses:
                    if item.type not in _POTABLE_FITTING_TYPES:
                        warns.append(
                            f"Fitting type '{item.type}' in segment '{seg.id}' is not in the "
                            "recognised potable-service fitting library. Verify K value manually."
                        )

        # --- Surge study with no PRV and no air vessel ---
        if self.surge.enabled:
            if not self.surge.prv.enabled and not self.surge.air_vessel.enabled:
                warns.append(
                    "Surge study is enabled but no surge-protection devices (PRV or air vessel) "
                    "are configured. Review upsurge/downsurge pressures before finalising design."
                )

        self.warnings = warns
        return self


# ---------------------------------------------------------------------------
# Validate-endpoint response schema
# ---------------------------------------------------------------------------


class ValidationResult(BaseModel):
    """Response from POST /project/validate."""

    valid: bool = Field(description="True if the project model passed all hard validations")
    errors: list[str] = Field(description="Human-readable hard validation errors (from Pydantic)")
    warnings: list[str] = Field(description="Non-blocking advisory warnings")
