"""
ALLL WPS Designer — FastAPI application entry point.

Run with:
    uvicorn backend.api.main:app --reload --port 8000
"""

from __future__ import annotations

import copy
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

from backend.api.domain_models import ProjectModel, ValidationResult
from backend.api.schemas import (
    AccessoryCategoryGroup,
    AccessoryItem,
    AccessoryLibraryResponse,
    AccessoryRecord,
    CalculationRequest,
    CalculationResponse,
    CategorySubtotal,
    ClearWellRequest,
    ClearWellResponse,
    ComputeSystemCurvePoint,
    ContributionRow,
    CsvImportResponse,
    CurvePoint,
    CycleResult,
    DisplayValues,
    HydraulicComputeRequest,
    HydraulicComputeResponse,
    LossBreakdownItem,
    LossBreakdownRequest,
    LossBreakdownResponse,
    LossBreakdownSegmentInput,
    MaterialOption,
    MaterialOptionsResponse,
    OperatingPoint,
    PDPumpExtras,
    PipeSegment,
    BoosterSetExtras,
    FirePumpExtras,
    HeadFlowRange,
    PumpComputeRequest,
    PumpComputeResponse,
    PumpCurveData,
    PumpLibraryResponse,
    PumpRecord,
    PumpSelectionRequest,
    PumpSelectionResponse,
    PumpTypeInfo,
    PumpTypesResponse,
    SegmentResult,
    SpeedCurve,
    SubmersibleExtras,
    PressureRatingCheck,
    SurgeEnvelopePoint,
    SurgeQuickRequest,
    SurgeQuickResponse,
    WaveSpeedRequest,
    WaveSpeedResponse,
    MOCRequest,
    MOCResponse,
    MOCBCReservoir,
    MOCBCPumpTrip,
    MOCBCValveClosure,
    MOCBCSuctionPumpTrip,
    MOCEnvelopePoint,
    MOCTimePoint,
    MOCObservationResult,
    NPSHaPoint,
    SuctionTransientRequest,
    SuctionTransientResponse,
    MOCSegmentInput,
    ProtectionDeviceConfig,
    AirVesselDeviceConfig,
    SurgeTankDeviceConfig,
    PRVDeviceConfig,
    VacuumReliefDeviceConfig,
    SlowCheckValveDeviceConfig,
    WhatIfRequest,
    WhatIfResponse,
    WhatIfRunMetrics,
    WhatIfEnvelopePoint,
    SystemCurvePoint,
    TypeSpecificField,
    VerticalTurbineExtras,
    VolumeCurvePoint,
    ExcelExportRequest,
)
from backend.engine.pump_types import (
    get_pump_type,
    list_pump_types,
)
from backend.data.loader import (
    get_accessory_by_id,
    get_material_options,
    get_pump_by_id,
    get_roughness_m,
    load_accessories_library,
    load_pump_library,
)
from backend.engine.pump_curves import (
    affinity_hq_fn,
    affinity_eta_fn,
    build_eta_fn,
    build_hq_fn,
    build_npshr_fn,
    build_p_fn,
    build_system_hq_fn,
    extract_curve_arrays,
    find_operating_point,
    generate_curve_points,
    hydraulic_power_kw,
    npsh_margin,
    parallel_hq_fn,
    pump_q_max,
    series_hq_fn,
)
from backend.engine.surge import surge_quick, wave_speed as compute_wave_speed
from backend.engine.surge_moc import (
    build_grid,
    run_moc,
    compute_npsha_transient,
    BoundaryCondition,
    ReservoirBC,
    PumpTripBC,
    ValveClosureBC,
    SuctionPumpTripBC,
)
from backend.engine.surge_sizing import (
    AirVesselBC,
    SurgeTankBC,
    PRVBC,
    VacuumReliefBC,
    apply_prv_postprocess,
    apply_vacuum_relief_postprocess,
    extract_whatif_metrics,
    size_air_vessel,
    size_surge_tank,
    size_prv,
    size_vacuum_relief,
    size_slow_check_valve,
)
from backend.engine.clearwell import (
    clearwell_volume_curve,
    cycle_analysis,
    detention_time,
    generate_warnings,
    operating_volume_m3,
)
from backend.engine.hydraulics import (
    G,
    friction_factor_colebrook,
    friction_head_loss,
    hazen_williams_head_loss,
    minor_head_loss,
    reynolds_number,
    static_head,
    system_curve,
    system_curve_extended,
    tdh,
    velocity,
)
from backend.engine.units import convert
from backend.engine.excel_export import _wb_to_bytes, build_workbook
from backend.export.word_export import build_document, _doc_to_bytes

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ALLL WPS Designer API",
    description=(
        "Hydraulic calculation API for municipal drinking-water pump station design. "
        "Implements Darcy-Weisbach friction losses with Colebrook-White iteration."
    ),
    version="0.1.0",
    docs_url="/api/v1/docs",
    redoc_url="/api/v1/redoc",
    openapi_url="/api/v1/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/api/v1/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "service": "ALLL WPS Designer API", "version": "0.1.0"}


@app.get(
    "/api/v1/materials",
    response_model=MaterialOptionsResponse,
    tags=["reference"],
    summary="List available pipe materials",
)
def get_materials() -> MaterialOptionsResponse:
    """Return all pipe materials with their UI labels, for populating the material dropdown."""
    options = get_material_options()
    return MaterialOptionsResponse(
        materials=[MaterialOption(**o) for o in options]
    )


@app.get(
    "/api/v1/pump-library",
    response_model=PumpLibraryResponse,
    tags=["reference"],
    summary="Return example pump catalogue",
)
def get_pump_library() -> PumpLibraryResponse:
    """Return the built-in illustrative pump library."""
    raw = load_pump_library()
    pumps = [PumpRecord(**p) for p in raw]
    return PumpLibraryResponse(pumps=pumps, count=len(pumps))


@app.post(
    "/api/v1/calculate",
    response_model=CalculationResponse,
    tags=["hydraulics"],
    summary="Compute system TDH and system curve",
    status_code=status.HTTP_200_OK,
)
def calculate(req: CalculationRequest) -> CalculationResponse:
    """
    Accept hydraulic design inputs (all numeric fields in SI) and return:
    - Pipe velocity, Reynolds number, friction factor
    - Static head, friction loss, minor loss, TDH
    - 8-point H-Q system curve from Q=0 to Q=1.5×Q_design
    - ``display`` block with all results in the requested unit system (SI or US)

    The ``unit_system`` request field controls the ``display`` block only.
    All numeric input fields must be in SI regardless of unit_system.
    """
    try:
        roughness_m = get_roughness_m(req.material)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    Q_m3s = req.Q_m3h / 3600.0
    D_m = req.pipe_diameter_mm / 1000.0
    K_sum = sum(req.K_values)

    try:
        V = velocity(Q_m3s, D_m)
        Re = reynolds_number(Q_m3s, D_m)
        eps_D = roughness_m / D_m
        f = friction_factor_colebrook(Re, eps_D)
        h_s = static_head(req.elev_ds_m, req.elev_us_m)
        h_f = friction_head_loss(Q_m3s, D_m, req.pipe_length_m, roughness_m)
        h_m = minor_head_loss(Q_m3s, D_m, req.K_values)
        H_tdh = tdh(h_s, h_f, h_m)

        curve_raw = system_curve(
            Q_design_m3s=Q_m3s,
            D_m=D_m,
            L_m=req.pipe_length_m,
            roughness_m=roughness_m,
            K_sum=K_sum,
            h_s=h_s,
            n_points=8,
        )
    except (ValueError, ZeroDivisionError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Hydraulic calculation error: {exc}",
        )

    us = req.unit_system

    display = DisplayValues(
        velocity=convert(round(V, 4), "velocity", us),
        static_head=convert(round(h_s, 4), "head", us),
        friction_head=convert(round(h_f, 4), "head", us),
        minor_head=convert(round(h_m, 4), "head", us),
        tdh=convert(round(H_tdh, 4), "head", us),
        design_flow=convert(round(req.Q_m3h, 4), "flow_m3h", us),
    )

    curve_points = [
        SystemCurvePoint(
            Q_m3h=pt["Q_m3h"],
            H_m=pt["H_m"],
            Q_display=convert(pt["Q_m3h"], "flow_m3h", us),
            H_display=convert(pt["H_m"], "head", us),
        )
        for pt in curve_raw
    ]

    return CalculationResponse(
        velocity_ms=round(V, 4),
        reynolds_number=round(Re, 1),
        friction_factor=round(f, 6),
        static_head_m=round(h_s, 4),
        friction_head_m=round(h_f, 4),
        minor_head_m=round(h_m, 4),
        tdh_m=round(H_tdh, 4),
        system_curve=curve_points,
        design_Q_m3h=req.Q_m3h,
        K_sum=K_sum,
        display=display,
        unit_system=us,
    )


# ---------------------------------------------------------------------------
# Multi-segment hydraulic compute endpoint
# ---------------------------------------------------------------------------


def _compute_segment(
    Q_m3s: float,
    seg: PipeSegment,
    assembly_name: str,
    index: int,
) -> tuple[SegmentResult, float, float]:
    """
    Compute hydraulics for one segment and return (SegmentResult, hf, hm).
    """
    V = velocity(Q_m3s, seg.D_m) if Q_m3s > 0 else 0.0
    vh = V ** 2 / (2.0 * G)
    K_sum = sum(seg.K_values)
    hm = minor_head_loss(Q_m3s, seg.D_m, seg.K_values)

    if seg.method == "darcy_weisbach":
        hf = friction_head_loss(Q_m3s, seg.D_m, seg.L_m, seg.roughness_m) if Q_m3s > 0 else 0.0
        if Q_m3s > 0:
            Re = reynolds_number(Q_m3s, seg.D_m)
            f = friction_factor_colebrook(Re, seg.roughness_m / seg.D_m)
        else:
            Re = 0.0
            f = 0.0
        result = SegmentResult(
            segment_index=index,
            assembly=assembly_name,
            label=seg.label,
            method="darcy_weisbach",
            D_m=round(seg.D_m, 6),
            L_m=round(seg.L_m, 4),
            K_sum=round(K_sum, 4),
            velocity_ms=round(V, 4),
            velocity_head_m=round(vh, 6),
            re=round(Re, 1) if Q_m3s > 0 else None,
            friction_factor=round(f, 6) if Q_m3s > 0 else None,
            C_hw=None,
            hf_m=round(hf, 6),
            hm_m=round(hm, 6),
            segment_loss_m=round(hf + hm, 6),
        )
    else:
        hf = hazen_williams_head_loss(Q_m3s, seg.D_m, seg.L_m, seg.C_hw) if Q_m3s > 0 else 0.0
        result = SegmentResult(
            segment_index=index,
            assembly=assembly_name,
            label=seg.label,
            method="hazen_williams",
            D_m=round(seg.D_m, 6),
            L_m=round(seg.L_m, 4),
            K_sum=round(K_sum, 4),
            velocity_ms=round(V, 4),
            velocity_head_m=round(vh, 6),
            re=None,
            friction_factor=None,
            C_hw=seg.C_hw,
            hf_m=round(hf, 6),
            hm_m=round(hm, 6),
            segment_loss_m=round(hf + hm, 6),
        )

    return result, hf, hm


@app.post(
    "/compute/hydraulics",
    response_model=HydraulicComputeResponse,
    tags=["hydraulics"],
    summary="Multi-segment hydraulic compute (Darcy-Weisbach + Hazen-Williams)",
    status_code=status.HTTP_200_OK,
)
def compute_hydraulics(req: HydraulicComputeRequest) -> HydraulicComputeResponse:
    """
    Compute total dynamic head for a multi-segment pipeline with separate
    suction and discharge assemblies.

    Each segment independently chooses its friction method:
    - **darcy_weisbach**: requires ``roughness_m``; computes Re and Colebrook-White *f*.
    - **hazen_williams**: requires ``C_hw``; no Re/f output.

    TDH = static_head + Σhf + Σhm + Δpressure_head + Δvelocity_head

    Returns a full per-segment breakdown table and a 10-point system H-Q curve
    spanning 0.2 × Q_design to 1.5 × Q_design.
    """
    Q_m3s = req.Q_m3h / 3600.0

    # ------------------------------------------------------------------ #
    # Iterate segments: suction first, then discharge                      #
    # ------------------------------------------------------------------ #
    segment_results: list[SegmentResult] = []
    total_hf = 0.0
    total_hm = 0.0
    # Track full-precision velocities separately for Δvelocity_head computation.
    velocities_raw: list[float] = []

    try:
        idx = 0
        for seg in req.suction.segments:
            res, hf, hm = _compute_segment(Q_m3s, seg, req.suction.name or "suction", idx)
            segment_results.append(res)
            total_hf += hf
            total_hm += hm
            velocities_raw.append(velocity(Q_m3s, seg.D_m) if Q_m3s > 0 else 0.0)
            idx += 1

        for seg in req.discharge.segments:
            res, hf, hm = _compute_segment(Q_m3s, seg, req.discharge.name or "discharge", idx)
            segment_results.append(res)
            total_hf += hf
            total_hm += hm
            velocities_raw.append(velocity(Q_m3s, seg.D_m) if Q_m3s > 0 else 0.0)
            idx += 1

    except (ValueError, ZeroDivisionError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Hydraulic calculation error: {exc}",
        )

    # ------------------------------------------------------------------ #
    # Head budget                                                           #
    # ------------------------------------------------------------------ #
    # Static head: net elevation difference across entire system
    h_static = (
        req.discharge.node_elev_end_m - req.suction.node_elev_start_m
    )

    # Pressure boundary head difference
    h_dp = (
        req.discharge.pressure_head_end_m - req.suction.pressure_head_start_m
    )

    # Velocity head change: last segment outlet vs. first segment inlet.
    # Uses full-precision (unrounded) velocities to avoid accumulated rounding drift.
    if velocities_raw:
        v_in = velocities_raw[0]
        v_out = velocities_raw[-1]
    else:
        v_in = v_out = 0.0
    dv_head = (v_out ** 2 - v_in ** 2) / (2.0 * G)

    H_tdh = h_static + total_hf + total_hm + h_dp + dv_head

    # ------------------------------------------------------------------ #
    # System curve — 10 points, 0.2 Qd → 1.5 Qd                           #
    # ------------------------------------------------------------------ #
    suction_segs = req.suction.segments
    discharge_segs = req.discharge.segments

    def _tdh_at_q(Q_i: float) -> float:
        """
        Re-evaluate full-system TDH at an arbitrary flow Q_i [m³/s].
        Called only with validated geometry; errors propagate as-is.
        """
        hf_i = 0.0
        hm_i = 0.0
        _velocities: list[float] = []
        for seg in suction_segs:
            if seg.method == "darcy_weisbach":
                hf_i += friction_head_loss(Q_i, seg.D_m, seg.L_m, seg.roughness_m) if Q_i > 0 else 0.0
            else:
                hf_i += hazen_williams_head_loss(Q_i, seg.D_m, seg.L_m, seg.C_hw) if Q_i > 0 else 0.0
            hm_i += minor_head_loss(Q_i, seg.D_m, seg.K_values)
            _velocities.append(velocity(Q_i, seg.D_m) if Q_i > 0 else 0.0)
        for seg in discharge_segs:
            if seg.method == "darcy_weisbach":
                hf_i += friction_head_loss(Q_i, seg.D_m, seg.L_m, seg.roughness_m) if Q_i > 0 else 0.0
            else:
                hf_i += hazen_williams_head_loss(Q_i, seg.D_m, seg.L_m, seg.C_hw) if Q_i > 0 else 0.0
            hm_i += minor_head_loss(Q_i, seg.D_m, seg.K_values)
            _velocities.append(velocity(Q_i, seg.D_m) if Q_i > 0 else 0.0)
        v_i_in = _velocities[0] if _velocities else 0.0
        v_i_out = _velocities[-1] if _velocities else 0.0
        dv_i = (v_i_out ** 2 - v_i_in ** 2) / (2.0 * G)
        return h_static + hf_i + hm_i + h_dp + dv_i

    curve_raw = system_curve_extended(
        Q_design_m3s=Q_m3s,
        compute_tdh=_tdh_at_q,
        n_points=10,
        q_min_factor=0.2,
        q_max_factor=1.5,
    )

    curve_points = [
        ComputeSystemCurvePoint(Q_m3h=pt["Q_m3h"], H_m=pt["H_m"])
        for pt in curve_raw
    ]

    return HydraulicComputeResponse(
        segments=segment_results,
        static_head_m=round(h_static, 4),
        total_hf_m=round(total_hf, 6),
        total_hm_m=round(total_hm, 6),
        delta_pressure_head_m=round(h_dp, 4),
        delta_velocity_head_m=round(dv_head, 6),
        tdh_m=round(H_tdh, 4),
        design_Q_m3h=req.Q_m3h,
        system_curve=curve_points,
    )


# ---------------------------------------------------------------------------
# Project domain-model endpoints
# ---------------------------------------------------------------------------


def _fmt_validation_error(exc: ValidationError) -> list[str]:
    """Convert a Pydantic ValidationError into human-readable strings."""
    messages: list[str] = []
    for err in exc.errors():
        loc = " → ".join(str(p) for p in err["loc"]) if err["loc"] else "body"
        messages.append(f"{loc}: {err['msg']}")
    return messages


@app.post(
    "/project/validate",
    response_model=ValidationResult,
    tags=["project"],
    summary="Validate a complete project model",
    status_code=status.HTTP_200_OK,
)
async def validate_project(request: Request) -> ValidationResult:
    """
    Parse and validate a ``ProjectModel`` JSON body.

    Always returns HTTP 200 with a structured result:
    - ``valid``: False if Pydantic raised hard validation errors.
    - ``errors``: Human-readable list of hard errors (empty when valid).
    - ``warnings``: Non-blocking advisory messages (potable-service guidelines).
    """
    try:
        body: Any = await request.json()
    except Exception:
        return ValidationResult(
            valid=False,
            errors=["Request body is not valid JSON."],
            warnings=[],
        )

    try:
        project = ProjectModel.model_validate(body)
        return ValidationResult(
            valid=True,
            errors=[],
            warnings=project.warnings,
        )
    except ValidationError as exc:
        return ValidationResult(
            valid=False,
            errors=_fmt_validation_error(exc),
            warnings=[],
        )


@app.get(
    "/project/validate/schema",
    tags=["project"],
    summary="Return the JSON Schema for ProjectModel",
    status_code=status.HTTP_200_OK,
)
def project_schema() -> dict:
    """Return the JSON Schema for ``ProjectModel``."""
    return ProjectModel.model_json_schema()


# ---------------------------------------------------------------------------
# Clear well sizing
# ---------------------------------------------------------------------------


@app.post(
    "/compute/clearwell",
    tags=["compute"],
    summary="Size a clear well and run pump cycle analysis (AWWA M32)",
    status_code=status.HTTP_200_OK,
)
def compute_clearwell(req: ClearWellRequest) -> ClearWellResponse:
    """
    Size a clear well storage volume and verify pump cycle limits.

    When ``active=False`` the computation is skipped and an empty response
    is returned immediately — suitable for the 'Bypassed' / 'Disabled' UI states.

    Calculations follow:
    - AWWA M32 required volume: V_req = Q_pump [m³/s] × 900 / n_max
    - Detention time: t_d = (V_op / 2) / Q_in [minutes]
    - Level ordering: LLL < LWL < HWL < HHL
    """
    if not req.active:
        return ClearWellResponse(active=False)

    geom = req.geometry
    lvl = req.levels
    inflow = req.inflow

    # ------------------------------------------------------------------
    # Volume curve (LLL → HHL, 21 points)
    # ------------------------------------------------------------------
    raw_curve = clearwell_volume_curve(
        geometry=geom.shape,
        LLL_m=lvl.LLL_m,
        HHL_m=lvl.HHL_m,
        diameter_m=geom.diameter_m,
        length_m=geom.length_m,
        width_m=geom.width_m,
        n_points=21,
    )
    volume_curve = [
        VolumeCurvePoint(
            level_m=pt["level_m"],
            depth_m=pt["depth_m"],
            volume_m3=pt["volume_m3"],
        )
        for pt in raw_curve
    ]

    # ------------------------------------------------------------------
    # Operating volume
    # ------------------------------------------------------------------
    V_op = operating_volume_m3(
        geometry=geom.shape,
        LWL_m=lvl.LWL_m,
        HWL_m=lvl.HWL_m,
        diameter_m=geom.diameter_m,
        length_m=geom.length_m,
        width_m=geom.width_m,
    )

    # ------------------------------------------------------------------
    # Inflow rates for analysis
    # ------------------------------------------------------------------
    if inflow.type == "constant":
        Q_in_cycle_m3h = inflow.Q_in_m3h or 0.0   # worst-case = average for constant
        Q_in_avg_m3h = inflow.Q_in_m3h or 0.0
    else:
        # hourly_24: use worst-case (max) for cycle, average for detention
        Q_in_cycle_m3h = inflow.worst_case_Q_m3h
        Q_in_avg_m3h = inflow.average_Q_m3h

    Q_in_cycle_m3s = Q_in_cycle_m3h / 3600.0
    Q_in_avg_m3s = Q_in_avg_m3h / 3600.0

    # ------------------------------------------------------------------
    # Cycle analysis — one result per pump stage
    # ------------------------------------------------------------------
    cycle_results: list[CycleResult] = []
    for stage in req.pump_stages:
        Q_pump_m3s = stage.Q_pump_m3h / 3600.0
        cr = cycle_analysis(
            Q_pump_m3s=Q_pump_m3s,
            Q_in_m3s=Q_in_cycle_m3s,
            V_op_m3=V_op,
            max_cycles_per_hour=req.max_cycles_per_hour,
        )
        cycle_results.append(
            CycleResult(
                stage=stage.stage,
                label=stage.label or f"Stage {stage.stage}",
                Q_pump_m3h=stage.Q_pump_m3h,
                Q_in_m3h=Q_in_cycle_m3h,
                t_fill_s=cr["t_fill_s"],
                t_drain_s=cr["t_drain_s"],
                t_cycle_s=cr["t_cycle_s"],
                cycles_per_hour=cr["cycles_per_hour"],
                V_req_m3=cr["V_req_m3"],
                cycles_ok=cr["cycles_ok"],
                pump_can_drain=cr["pump_can_drain"],
            )
        )

    # ------------------------------------------------------------------
    # Detention time (use average inflow)
    # ------------------------------------------------------------------
    det = detention_time(
        V_op_m3=V_op,
        Q_in_m3s=Q_in_avg_m3s,
        required_detention_min=req.required_detention_min,
    )

    # ------------------------------------------------------------------
    # Warnings
    # ------------------------------------------------------------------
    raw_cycle_dicts = [
        {
            "Q_pump_m3s": cr.Q_pump_m3h / 3600.0,
            "Q_in_m3s": cr.Q_in_m3h / 3600.0,
            "V_op_m3": V_op,
            "V_req_m3": cr.V_req_m3,
            "cycles_ok": cr.cycles_ok,
            "pump_can_drain": cr.pump_can_drain,
        }
        for cr in cycle_results
    ]
    warns = generate_warnings(
        cycle_results=raw_cycle_dicts,
        detention_result=det,
        geometry=geom.shape,
        diameter_m=geom.diameter_m,
        length_m=geom.length_m,
        width_m=geom.width_m,
        LWL_m=lvl.LWL_m,
        HWL_m=lvl.HWL_m,
    )

    return ClearWellResponse(
        active=True,
        volume_curve=volume_curve,
        operating_volume_m3=round(V_op, 4),
        cycle_results=cycle_results,
        detention_time_min=det["detention_time_min"],
        required_detention_min=req.required_detention_min,
        detention_ok=det["detention_ok"],
        warnings=warns,
    )


# ---------------------------------------------------------------------------
# Pump type catalogue
# ---------------------------------------------------------------------------


def _build_pump_type_info(entry: dict) -> PumpTypeInfo:
    """Convert a raw catalogue dict into a PumpTypeInfo response model."""
    return PumpTypeInfo(
        key=entry["key"],
        display_name=entry["display_name"],
        family=entry["family"],
        potable_tag=entry["potable_tag"],
        description=entry["description"],
        typical_head_range_m=HeadFlowRange(**entry["typical_head_range_m"]),
        typical_flow_range_m3h=HeadFlowRange(**entry["typical_flow_range_m3h"]),
        constraints=entry["constraints"],
        potable_notes=entry["potable_notes"],
        extras_schema=entry.get("extras_schema"),
        type_specific_inputs=[
            TypeSpecificField(**f) for f in entry.get("type_specific_inputs", [])
        ],
    )


@app.get(
    "/compute/pump-types",
    response_model=PumpTypesResponse,
    tags=["compute"],
    summary="Return the full pump type catalogue (16 types)",
    status_code=status.HTTP_200_OK,
)
def get_pump_types() -> PumpTypesResponse:
    """
    Return all 16 pump types with potable-suitability metadata, typical H-Q ranges,
    engineering constraints, and compliance notes.

    Types are sorted by family then display name.
    """
    entries = list_pump_types(sort_by_family=True)
    pump_types = [_build_pump_type_info(e) for e in entries]
    return PumpTypesResponse(pump_types=pump_types, count=len(pump_types))


# ---------------------------------------------------------------------------
# Pump selection
# ---------------------------------------------------------------------------

_EXTRAS_SCHEMA_MAP = {
    "vertical_turbine": VerticalTurbineExtras,
    "submersible": SubmersibleExtras,
    "booster_set": BoosterSetExtras,
    "pd_pump": PDPumpExtras,
    "fire_pump": FirePumpExtras,
}


def _validate_and_parse_extras(
    pump_type_key: str,
    extras_schema: str | None,
    extras: dict | None,
) -> Any:
    """
    Validate type-specific extras against their Pydantic model.

    Returns the parsed extras model (or None if no extras are required).
    Raises HTTPException 422 if extras are required but missing/invalid.
    """
    if extras_schema is None:
        return None

    model_cls = _EXTRAS_SCHEMA_MAP.get(extras_schema)
    if model_cls is None:
        return None

    if extras is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Pump type '{pump_type_key}' requires additional parameters "
                f"(extras_schema='{extras_schema}'). "
                f"Please supply the 'extras' field."
            ),
        )
    try:
        return model_cls.model_validate(extras)
    except ValidationError as exc:
        messages = _fmt_validation_error(exc)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid extras for '{pump_type_key}': {'; '.join(messages)}",
        )


def _generate_selection_warnings(
    entry: dict,
    n_duty: int,
    n_standby: int,
    control_mode: str,
    parsed_extras: Any,
) -> list[str]:
    """Generate advisory warnings for the pump selection configuration."""
    warns: list[str] = []

    if entry["potable_tag"] == "niche":
        warns.append(
            f"'{entry['display_name']}' is niche / unusual for municipal potable water service. "
            "Verify suitability with the project engineer and authority having jurisdiction (AHJ)."
        )

    if n_standby == 0:
        warns.append(
            "No standby pump is configured. AWWA and most utility standards require at least "
            "one standby pump for duty-critical potable water supply — verify with AHJ."
        )

    if control_mode == "constant_speed" and entry["family"] == "positive_displacement":
        warns.append(
            "Constant-speed positive displacement pumps must never dead-head — "
            "a pressure relief valve (PRV) on the discharge is mandatory."
        )

    if control_mode == "cascade" and n_duty < 2:
        warns.append(
            "Cascade staging is most effective with ≥2 duty pumps. "
            "With a single duty pump, cascade behaves identically to constant-speed on/off."
        )

    if (
        entry["extras_schema"] == "submersible"
        and parsed_extras is not None
        and hasattr(parsed_extras, "motor_cooling")
        and parsed_extras.motor_cooling == "none"
    ):
        warns.append(
            "Motor cooling is set to 'none'. Submersible motors require adequate "
            "cooling flow past the motor casing — risk of thermal failure."
        )

    return warns


@app.post(
    "/compute/pump-selection",
    response_model=PumpSelectionResponse,
    tags=["compute"],
    summary="Validate and confirm pump type selection",
    status_code=status.HTTP_200_OK,
)
def compute_pump_selection(req: PumpSelectionRequest) -> PumpSelectionResponse:
    """
    Validate a pump type selection against the 16-type catalogue.

    When ``active=False`` returns an empty response (bypass pattern).

    For types requiring extras (vertical turbine, submersible, booster set,
    PD types, fire pump) the ``extras`` field must be populated — a 422 is
    returned if it is absent or invalid.

    Returns:
    - Full ``type_info`` catalogue record for the selected type
    - ``config_summary`` human-readable string
    - ``potable_notes`` compliance guidance
    - ``warnings`` advisory messages
    """
    if not req.active:
        return PumpSelectionResponse(active=False)

    # Look up catalogue entry — raises 422 on unknown key
    try:
        entry = get_pump_type(req.pump_type_key)  # type: ignore[arg-type]
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    # Validate type-specific extras
    parsed_extras = _validate_and_parse_extras(
        pump_type_key=req.pump_type_key,  # type: ignore[arg-type]
        extras_schema=entry["extras_schema"],
        extras=req.extras,
    )

    # Build type_info response model
    type_info = _build_pump_type_info(entry)

    # Configuration summary
    control_label = (
        "VFD" if req.control_mode == "vfd"
        else "Cascade" if req.control_mode == "cascade"
        else "Constant speed"
    )
    config_summary = (
        f"{req.n_duty}+{req.n_standby} ({req.n_duty} duty, {req.n_standby} standby) "
        f"| {control_label} | {entry['display_name']}"
    )

    # Warnings
    warns = _generate_selection_warnings(
        entry=entry,
        n_duty=req.n_duty,
        n_standby=req.n_standby,
        control_mode=req.control_mode,
        parsed_extras=parsed_extras,
    )

    return PumpSelectionResponse(
        active=True,
        type_info=type_info,
        config_summary=config_summary,
        potable_notes=entry["potable_notes"],
        warnings=warns,
    )


# ---------------------------------------------------------------------------
# Pump curve compute helpers
# ---------------------------------------------------------------------------

_N_CHART_PTS = 40   # number of points for rendered curves


def _build_curve_fns_from_record(record: dict, interp: str, degree: int):
    """
    Build H-Q, η, P, NPSHr functions from a pump library record.
    Returns (hq_fn, eta_fn_or_None, p_fn_or_None, npshr_fn_or_None, q_max).
    """
    q_h, h = extract_curve_arrays(record, "hq_curve", "H_m")
    hq_fn = build_hq_fn(q_h, h, interp, degree)
    q_max = max(q_h)

    eta_fn = None
    if record.get("eta_q_curve"):
        q_e, e = extract_curve_arrays(record, "eta_q_curve", "eta_pct")
        eta_fn = build_eta_fn(q_e, e, interp, degree)

    p_fn = None
    if record.get("p_q_curve"):
        q_p, p = extract_curve_arrays(record, "p_q_curve", "P_kW")
        p_fn = build_p_fn(q_p, p, interp, degree)

    npshr_fn = None
    if record.get("npshr_q_curve"):
        q_n, n = extract_curve_arrays(record, "npshr_q_curve", "NPSHr_m")
        npshr_fn = build_npshr_fn(q_n, n, interp, degree)

    return hq_fn, eta_fn, p_fn, npshr_fn, q_max


def _build_curve_fns_from_data(cd: "PumpCurveData"):
    """
    Build H-Q, η, P, NPSHr functions from PumpCurveData (manual entry).
    Returns (hq_fn, eta_fn_or_None, p_fn_or_None, npshr_fn_or_None, q_max).
    """
    interp = cd.interp_method
    degree = cd.poly_degree

    q_h = [pt.Q_m3h for pt in cd.hq]
    h   = [pt.value  for pt in cd.hq]
    hq_fn = build_hq_fn(q_h, h, interp, degree)
    q_max = max(q_h)

    eta_fn = None
    if cd.eta_q:
        q_e = [pt.Q_m3h for pt in cd.eta_q]
        e   = [pt.value  for pt in cd.eta_q]
        eta_fn = build_eta_fn(q_e, e, interp, degree)

    p_fn = None
    if cd.p_q:
        q_p = [pt.Q_m3h for pt in cd.p_q]
        p   = [pt.value  for pt in cd.p_q]
        p_fn = build_p_fn(q_p, p, interp, degree)

    npshr_fn = None
    if cd.npshr_q:
        q_n = [pt.Q_m3h for pt in cd.npshr_q]
        n   = [pt.value  for pt in cd.npshr_q]
        npshr_fn = build_npshr_fn(q_n, n, interp, degree)

    return hq_fn, eta_fn, p_fn, npshr_fn, q_max


def _compound_hq(hq_fn, arrangement: str, n: int):
    """Apply parallel / series compound to base hq_fn."""
    if arrangement == "parallel":
        return parallel_hq_fn(hq_fn, n)
    if arrangement == "series":
        return series_hq_fn(hq_fn, n)
    return hq_fn  # single


def _pts_to_curve_points(raw: list[dict]) -> list["CurvePoint"]:
    return [CurvePoint(Q_m3h=p["Q_m3h"], value=p["value"]) for p in raw]


def _solve_op(
    pump_hq_fn,
    sys_fn,
    q_max: float,
    eta_fn,
    p_fn,
    npshr_fn,
    npsha_m: float | None,
    n_pumps: int,
    arrangement: str = "single",
) -> "OperatingPoint | None":
    """
    Solve for one operating point and enrich with η, P, NPSHr, NPSH margin.

    Flow-basis rules
    ----------------
    Parallel: each pump carries Q*/n_pumps of flow.
      - η and NPSHr are evaluated at Q*/n_pumps (single-pump duty point).
      - Total shaft power = n_pumps × P_single(Q*/n_pumps).

    Series: all pumps carry the same total flow Q*.
      - η and NPSHr are evaluated at Q*.
      - Total shaft power = n_pumps × P_single(Q*).

    Single / VFD: n_pumps == 1 (or eta_fn / p_fn are already speed-adjusted).
      - Same as series: evaluate at Q*.
    """
    op_raw = find_operating_point(pump_hq_fn, sys_fn, q_min=0.01, q_max=q_max * 0.99)
    if op_raw is None:
        return None

    q_star, h_star = op_raw

    # Per-pump operating flow
    q_per_pump = q_star / n_pumps if arrangement == "parallel" else q_star

    # Efficiency and NPSHr at per-pump duty flow
    eta_val   = round(eta_fn(q_per_pump),   2) if eta_fn   else None
    npshr_val = round(npshr_fn(q_per_pump), 3) if npshr_fn else None

    # Total shaft power = n_pumps × single-pump power at per-pump flow
    p_val = round(n_pumps * p_fn(q_per_pump), 2) if p_fn else None

    op_warns: list[str] = []
    npsh_margin_val: float | None = None

    if npsha_m is not None and npshr_val is not None:
        npsh_margin_val, npsh_warns = npsh_margin(npsha_m, npshr_val)
        op_warns.extend(npsh_warns)

    return OperatingPoint(
        n_pumps=n_pumps,
        Q_m3h=round(q_star, 3),
        H_m=round(h_star, 3),
        eta_pct=eta_val,
        power_kW=p_val,
        npshr_m=npshr_val,
        npsha_m=npsha_m,
        npsh_margin_m=round(npsh_margin_val, 3) if npsh_margin_val is not None else None,
        warnings=op_warns,
    )


# ---------------------------------------------------------------------------
# POST /compute/pump
# ---------------------------------------------------------------------------


@app.post(
    "/compute/pump",
    response_model=PumpComputeResponse,
    tags=["compute"],
    summary="Compute pump curves and operating point",
    status_code=status.HTTP_200_OK,
)
def compute_pump(req: PumpComputeRequest) -> PumpComputeResponse:
    """
    Compute pump H-Q, η, P, NPSHr curves plus the system-pump operating point.

    Accepts either a library pump ID or manually-supplied tabular curve data.
    Supports:
    - Single / parallel / series arrangements
    - Staging analysis (1 … n_pumps duty pumps in parallel)
    - VFD speed-curve fan (affinity laws)
    - NPSH margin check (HI 9.6.1)

    When ``active=False`` returns an empty response immediately.
    """
    if not req.active:
        return PumpComputeResponse(active=False)

    # ------------------------------------------------------------------ #
    # 1. Resolve pump curve functions                                       #
    # ------------------------------------------------------------------ #
    warns: list[str] = []
    non_phys = False
    interp = "linear"
    degree = 2

    if req.pump_id is not None:
        record = get_pump_by_id(req.pump_id)
        if record is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Unknown pump_id '{req.pump_id}'. "
                       f"Check GET /api/v1/pump-library for valid IDs.",
            )
        try:
            base_hq_fn, eta_fn, p_fn, npshr_fn, q_max_single = (
                _build_curve_fns_from_record(record, interp, degree)
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Error loading curves for '{req.pump_id}': {exc}",
            )
    else:
        assert req.curve_data is not None
        interp = req.curve_data.interp_method
        degree = req.curve_data.poly_degree
        try:
            base_hq_fn, eta_fn, p_fn, npshr_fn, q_max_single = (
                _build_curve_fns_from_data(req.curve_data)
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Error building curves from supplied data: {exc}",
            )
        # Check all polynomial fits for non-physical behaviour
        if interp == "poly":
            from backend.engine.pump_curves import fit_polynomial
            _non_phys_labels: list[str] = []
            _curves_to_check: list[tuple[str, list, float | None]] = [
                ("H-Q",   [pt.Q_m3h for pt in req.curve_data.hq],
                          [pt.value  for pt in req.curve_data.hq],  None),
            ]
            if req.curve_data.eta_q:
                _curves_to_check.append(
                    ("η-Q",
                     [pt.Q_m3h for pt in req.curve_data.eta_q],
                     [pt.value  for pt in req.curve_data.eta_q],
                     100.0)  # η must not exceed 100 %
                )
            if req.curve_data.p_q:
                _curves_to_check.append(
                    ("P-Q",
                     [pt.Q_m3h for pt in req.curve_data.p_q],
                     [pt.value  for pt in req.curve_data.p_q],
                     None)
                )
            if req.curve_data.npshr_q:
                _curves_to_check.append(
                    ("NPSHr-Q",
                     [pt.Q_m3h for pt in req.curve_data.npshr_q],
                     [pt.value  for pt in req.curve_data.npshr_q],
                     None)
                )
            for label, q_c, v_c, ub in _curves_to_check:
                try:
                    _, _flag = fit_polynomial(q_c, v_c, degree,
                                             value_upper_bound=ub)
                    if _flag:
                        _non_phys_labels.append(label)
                        non_phys = True
                except ValueError:
                    pass
            if _non_phys_labels:
                warns.append(
                    f"Polynomial fit appears non-physical for: "
                    f"{', '.join(_non_phys_labels)}. "
                    "Rising slope in right-half operating range or η > 100 % detected. "
                    "Consider using 'linear' interpolation instead."
                )

    # ------------------------------------------------------------------ #
    # 2. Build compound curve for the primary arrangement                  #
    # ------------------------------------------------------------------ #
    compound_hq = _compound_hq(base_hq_fn, req.arrangement, req.n_pumps)
    # Effective q_max for the compound arrangement
    if req.arrangement == "parallel":
        q_max_compound = q_max_single * req.n_pumps
    else:
        q_max_compound = q_max_single

    # ------------------------------------------------------------------ #
    # 3. Generate primary curves for charting                              #
    # ------------------------------------------------------------------ #
    hq_raw    = generate_curve_points(compound_hq, 0.0, q_max_compound * 0.98, _N_CHART_PTS)
    eta_raw   = generate_curve_points(eta_fn,   0.0, q_max_single * 0.98, _N_CHART_PTS) if eta_fn   else []
    p_raw     = generate_curve_points(p_fn,     0.0, q_max_single * 0.98, _N_CHART_PTS) if p_fn     else []
    npshr_raw = generate_curve_points(npshr_fn, 0.0, q_max_single * 0.98, _N_CHART_PTS) if npshr_fn else []

    hq_pts    = _pts_to_curve_points(hq_raw)
    eta_pts   = _pts_to_curve_points(eta_raw)
    p_pts     = _pts_to_curve_points(p_raw)
    npshr_pts = _pts_to_curve_points(npshr_raw)

    # ------------------------------------------------------------------ #
    # 4. VFD speed curves                                                  #
    # ------------------------------------------------------------------ #
    speed_curves: list[SpeedCurve] = []
    if req.vfd:
        step = (req.speed_pct_max - req.speed_pct_min) / max(1, req.n_speed_steps - 1)
        speed_ratios = [
            req.speed_pct_min + step * i
            for i in range(req.n_speed_steps)
        ]
        for spd_pct in speed_ratios:
            sr = spd_pct / 100.0
            spd_hq_fn = affinity_hq_fn(compound_hq, sr)
            # At this speed, max flow scales with speed ratio
            q_max_spd = q_max_compound * sr
            spd_raw = generate_curve_points(spd_hq_fn, 0.0, q_max_spd * 0.98, 25)
            speed_curves.append(SpeedCurve(
                speed_pct=round(spd_pct, 1),
                hq_pts=_pts_to_curve_points(spd_raw),
            ))

    # ------------------------------------------------------------------ #
    # 5. Operating-point analysis                                          #
    # ------------------------------------------------------------------ #
    operating_points: list[OperatingPoint] = []

    has_system = len(req.system_curve_pts) >= 2

    if has_system:
        sys_q_pts = [pt.Q_m3h for pt in req.system_curve_pts]
        sys_h_pts = [pt.value  for pt in req.system_curve_pts]
        sys_fn    = build_system_hq_fn(sys_q_pts, sys_h_pts, req.static_head_m)

        if req.staging and req.arrangement == "parallel":
            # Solve for 1, 2, … n_pumps duty pumps; each k-pump group is parallel
            for k in range(1, req.n_pumps + 1):
                k_hq_fn = _compound_hq(base_hq_fn, "parallel", k)
                q_max_k = q_max_single * k
                op = _solve_op(k_hq_fn, sys_fn, q_max_k,
                               eta_fn, p_fn, npshr_fn, req.npsha_m, k,
                               arrangement="parallel")
                if op is not None:
                    operating_points.append(op)
        else:
            # Single operating point (with VFD speed if applicable)
            active_hq  = compound_hq
            active_eta = eta_fn
            active_p   = p_fn

            if req.vfd:
                sr = req.speed_pct / 100.0
                active_hq = affinity_hq_fn(compound_hq, sr)
                q_max_compound = q_max_compound * sr

                # η affinity: η_vfd(Q) ≈ η_base(Q / sr)  [duty point unchanged]
                if eta_fn is not None:
                    active_eta = affinity_eta_fn(eta_fn, sr)

                # P affinity: P_vfd(Q) = sr³ × P_base(Q / sr)
                if p_fn is not None:
                    _sr = sr
                    _base_p = p_fn
                    active_p = lambda q, _sr=_sr, _bp=_base_p: (_sr ** 3) * _bp(q / _sr)

            op = _solve_op(active_hq, sys_fn, q_max_compound,
                           active_eta, active_p, npshr_fn, req.npsha_m,
                           req.n_pumps, arrangement=req.arrangement)
            if op is not None:
                operating_points.append(op)

    return PumpComputeResponse(
        active=True,
        hq_curve=hq_pts,
        eta_curve=eta_pts,
        p_curve=p_pts,
        npshr_curve=npshr_pts,
        speed_curves=speed_curves,
        operating_points=operating_points,
        non_physical_fit=non_phys,
        warnings=warns,
    )


# ---------------------------------------------------------------------------
# POST /compute/pump-curves/import-csv
# ---------------------------------------------------------------------------

_CSV_CURVE_COLS = {
    "hq":      ("Q_m3h", "H_m"),
    "eta_q":   ("Q_m3h", "eta_pct"),
    "p_q":     ("Q_m3h", "P_kW"),
    "npshr_q": ("Q_m3h", "NPSHr_m"),
}

_VALID_CURVE_TYPES = set(_CSV_CURVE_COLS.keys())


@app.post(
    "/compute/pump-curves/import-csv",
    response_model=CsvImportResponse,
    tags=["compute"],
    summary="Parse a multi-column pump-curve CSV file into PumpCurveData",
    status_code=status.HTTP_200_OK,
)
async def import_pump_curve_csv(
    file: UploadFile = File(..., description="CSV file with Q_m3h column and one or more curve columns"),
) -> CsvImportResponse:
    """
    Parse a multi-column CSV file into ``PumpCurveData`` suitable for ``POST /compute/pump``.

    The CSV must have a header row. The ``Q_m3h`` column is required.
    ``H_m`` is required. ``eta_pct``, ``P_kW``, and ``NPSHr_m`` are optional.
    Any additional columns are silently ignored.

    Example CSV::

        Q_m3h,H_m,eta_pct,P_kW,NPSHr_m
        0,42.0,,2.5,1.5
        30,40.8,52.0,6.4,1.7
        60,38.5,70.0,9.0,2.1
        90,35.5,79.0,11.0,2.7
        120,32.0,82.0,12.8,3.5
        150,27.3,79.0,14.2,4.6
        175,22.5,71.0,15.2,5.8

    Non-numeric cells in optional columns are ignored for that column.
    Non-numeric cells in ``Q_m3h`` or ``H_m`` cause the row to be skipped
    with a warning. At least 2 valid rows (with both Q and H) are required.
    """
    import csv
    import io

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")   # handle BOM
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = list(reader.fieldnames or [])

    # Validate required columns
    if "Q_m3h" not in fieldnames:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"CSV is missing required 'Q_m3h' column. "
                f"Found columns: {fieldnames}"
            ),
        )
    if "H_m" not in fieldnames:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"CSV is missing required 'H_m' column. "
                f"Found columns: {fieldnames}. "
                f"At minimum the CSV must have Q_m3h and H_m columns."
            ),
        )

    has_eta   = "eta_pct"  in fieldnames
    has_p     = "P_kW"     in fieldnames
    has_npshr = "NPSHr_m"  in fieldnames

    hq_pts:    list[CurvePoint] = []
    eta_pts:   list[CurvePoint] = []
    p_pts:     list[CurvePoint] = []
    npshr_pts: list[CurvePoint] = []
    parse_warns: list[str] = []

    for row_num, row in enumerate(reader, start=2):
        # Parse required Q and H
        try:
            q = float(row["Q_m3h"])
            h = float(row["H_m"])
        except (ValueError, KeyError):
            parse_warns.append(f"Row {row_num}: Q_m3h or H_m not numeric — row skipped.")
            continue

        hq_pts.append(CurvePoint(Q_m3h=q, value=h))

        # Parse optional columns (missing or non-numeric cells are silently skipped)
        if has_eta:
            try:
                eta_pts.append(CurvePoint(Q_m3h=q, value=float(row.get("eta_pct", ""))))
            except (ValueError, TypeError):
                pass

        if has_p:
            try:
                p_pts.append(CurvePoint(Q_m3h=q, value=float(row.get("P_kW", ""))))
            except (ValueError, TypeError):
                pass

        if has_npshr:
            try:
                npshr_pts.append(CurvePoint(Q_m3h=q, value=float(row.get("NPSHr_m", ""))))
            except (ValueError, TypeError):
                pass

    if len(hq_pts) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"CSV must contain at least 2 valid rows with numeric Q_m3h and H_m; "
                f"found {len(hq_pts)} after skipping invalid rows."
            ),
        )

    curve_data = PumpCurveData(
        hq=hq_pts,
        eta_q=eta_pts   if len(eta_pts)   >= 2 else None,
        p_q=p_pts       if len(p_pts)     >= 2 else None,
        npshr_q=npshr_pts if len(npshr_pts) >= 2 else None,
    )

    return CsvImportResponse(curve_data=curve_data, warnings=parse_warns)


# ---------------------------------------------------------------------------
# Accessories library endpoints
# ---------------------------------------------------------------------------


@app.get(
    "/api/v1/library/accessories",
    response_model=AccessoryLibraryResponse,
    tags=["library"],
    summary="Return the potable-water accessories & instruments library",
)
def get_accessories_library() -> AccessoryLibraryResponse:
    """
    Return all accessories in the potable-water fittings library.

    Each record contains:
    - ``id``: unique slug for use in POST /compute/lossbreakdown
    - ``category``: one of check_valve | isolation_valve | control_valve |
      meter | suction_fitting | discharge_fitting | station_special | pipe_transition
    - ``default_K``, ``K_min``, ``K_max``: minor-loss resistance coefficients
    - ``notes``: engineering source notes (Crane TP-410, AWWA M11, etc.)
    - ``potable_notes``: NSF/ANSI 61 and AHJ compliance guidance

    The response includes both a flat ``accessories`` list (for backward compatibility)
    and a ``categories`` list with the same records grouped by category in canonical order.
    """
    _CATEGORY_ORDER = [
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
    ]
    _CATEGORY_LABELS: dict[str, str] = {
        "check_valve":       "Check Valves",
        "isolation_valve":   "Isolation Valves",
        "control_valve":     "Control Valves",
        "meter":             "Meters & Instruments",
        "strainer":          "Strainers",
        "air_valve":         "Air Valves",
        "suction_fitting":   "Suction Fittings",
        "discharge_fitting": "Discharge Fittings",
        "station_special":   "Station Specials",
        "pipe_transition":   "Pipe Transitions",
    }
    raw = load_accessories_library()
    records = [AccessoryRecord(**r) for r in raw]

    # Build grouped categories in canonical order
    _by_cat: dict[str, list[AccessoryRecord]] = {}
    for rec in records:
        _by_cat.setdefault(rec.category, []).append(rec)

    categories: list[AccessoryCategoryGroup] = []
    for cat in _CATEGORY_ORDER:
        if cat in _by_cat:
            cats_sorted = sorted(_by_cat[cat], key=lambda r: r.name)
            categories.append(
                AccessoryCategoryGroup(
                    category=cat,
                    label=_CATEGORY_LABELS.get(cat, cat),
                    accessories=cats_sorted,
                )
            )
    # Any categories not in canonical order appended at the end
    for cat, recs in sorted(_by_cat.items()):
        if cat not in _CATEGORY_ORDER:
            categories.append(
                AccessoryCategoryGroup(
                    category=cat,
                    label=_CATEGORY_LABELS.get(cat, cat),
                    accessories=sorted(recs, key=lambda r: r.name),
                )
            )

    return AccessoryLibraryResponse(
        accessories=records,
        count=len(records),
        categories=categories,
    )


@app.get(
    "/api/v1/library/accessories/{accessory_id}",
    response_model=AccessoryRecord,
    tags=["library"],
    summary="Return a single accessory record by ID",
)
def get_accessory(accessory_id: str) -> AccessoryRecord:
    """Return the full record for one accessory by its slug ID."""
    raw = get_accessory_by_id(accessory_id)
    if raw is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Accessory '{accessory_id}' not found in library.",
        )
    return AccessoryRecord(**raw)


# ---------------------------------------------------------------------------
# Loss breakdown compute endpoint
# ---------------------------------------------------------------------------


@app.post(
    "/api/v1/compute/lossbreakdown",
    response_model=LossBreakdownResponse,
    tags=["compute"],
    summary="Compute per-accessory minor head-loss breakdown with server-side major losses, segment and category subtotals, and contribution matrix",
)
def compute_lossbreakdown(req: LossBreakdownRequest) -> LossBreakdownResponse:  # noqa: C901
    """
    Compute a full hydraulic loss breakdown for a pump station.

    **Segmented mode** (recommended): supply ``suction`` and/or ``discharge``
    with pipe geometry (L_m, D_mm, material).  The backend computes
    Darcy-Weisbach friction (major) head loss for each segment using the
    Colebrook-White friction factor, then processes the accessories in that
    segment as minor losses.

    **Flat mode** (backward-compatible): supply ``D_mm`` and a flat
    ``accessories[]`` list.  Caller may optionally provide precomputed major
    head losses via ``suction_major_head_m`` / ``discharge_major_head_m``.

    The response includes:
    - Per-item breakdown (all segments combined) sorted by head loss descending
    - Per-segment suction/discharge minor and major subtotals
    - Per-category minor-loss subtotals
    - Grand-total major-vs-minor percentage breakdown
    - ``contribution_rows`` — segment × loss_type × category matrix sorted by h_m

    Raises 422 for unknown accessory IDs or invalid pipe geometry.
    """
    Q_m3s = req.Q_m3h / 3600.0
    us = req.unit_system
    warnings: list[str] = []

    _CATEGORY_LABELS: dict[str, str] = {
        "check_valve":      "Check Valve",
        "isolation_valve":  "Isolation Valve",
        "control_valve":    "Control Valve",
        "meter":            "Meter / Instrument",
        "strainer":         "Strainer",
        "air_valve":        "Air Valve",
        "suction_fitting":  "Suction Fitting",
        "discharge_fitting":"Discharge Fitting",
        "station_special":  "Station Special",
        "pipe_transition":  "Pipe Transition",
    }

    # ── Helper: resolve and validate accessory list; return 422 on unknown ID ─
    def _resolve(acc_list: list[AccessoryItem], seg_tag: str | None) -> list[tuple]:
        """Returns list of (acc_item, raw_record)."""
        out = []
        for ai in acc_list:
            raw = get_accessory_by_id(ai.accessory_id)
            if raw is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=(
                        f"Accessory ID '{ai.accessory_id}' not found in the library. "
                        "Use GET /library/accessories to browse available IDs."
                    ),
                )
            # Inherit segment from structural position if not explicitly tagged
            effective_seg = ai.segment if ai.segment is not None else seg_tag
            out.append((ai, raw, effective_seg))
        return out

    # ── Helper: compute Darcy-Weisbach friction head loss for a segment ──────
    def _major_loss(seg: LossBreakdownSegmentInput) -> float:
        try:
            roughness = get_roughness_m(seg.material)
        except KeyError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Pipe material '{seg.material}' not found in materials library.",
            )
        D_seg_m = seg.D_mm / 1000.0
        try:
            hf = friction_head_loss(Q_m3s, D_seg_m, seg.L_m, roughness)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Friction head loss calculation error: {exc}",
            )
        return hf

    # ── Validate and resolve all accessories ─────────────────────────────────
    # Segmented mode: accessories are inside segment input objects
    suction_resolved = _resolve(req.suction.accessories, "suction") if req.suction else []
    discharge_resolved = _resolve(req.discharge.accessories, "discharge") if req.discharge else []
    # Flat mode: root-level accessories list
    flat_resolved = _resolve(req.accessories, None)

    all_resolved = suction_resolved + discharge_resolved + flat_resolved

    # ── Compute major (friction) losses ──────────────────────────────────────
    suction_major_hm: float
    discharge_major_hm: float

    if req.suction is not None:
        suction_major_hm = round(_major_loss(req.suction), 6)
    else:
        suction_major_hm = round(req.suction_major_head_m, 6)

    if req.discharge is not None:
        discharge_major_hm = round(_major_loss(req.discharge), 6)
    else:
        discharge_major_hm = round(req.discharge_major_head_m, 6)

    # ── Per-segment velocity head lookup ─────────────────────────────────────
    # Each segment uses its own pipe diameter so that K·V²/(2g) is physically
    # correct when suction and discharge pipes differ in size.
    def _vh_for_seg(seg_key: str | None) -> float:
        """Return V²/(2g) [m] using the correct diameter for this segment."""
        if seg_key == "suction" and req.suction is not None:
            D_m = req.suction.D_mm / 1000.0
        elif seg_key == "discharge" and req.discharge is not None:
            D_m = req.discharge.D_mm / 1000.0
        else:
            D_m = req.D_mm / 1000.0
        try:
            V_seg = velocity(Q_m3s, D_m)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Velocity calculation error for segment '{seg_key}': {exc}",
            )
        return V_seg ** 2 / (2.0 * G)

    # Reference velocity / vh for display (discharge preferred, then suction, then flat)
    ref_D_mm = req.D_mm
    if req.discharge is not None:
        ref_D_mm = req.discharge.D_mm
    elif req.suction is not None:
        ref_D_mm = req.suction.D_mm

    ref_D_m = ref_D_mm / 1000.0
    try:
        V = velocity(Q_m3s, ref_D_m)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Velocity calculation error: {exc}",
        )
    vh = V**2 / (2.0 * G)

    # ── Process each accessory into a LossBreakdownItem ──────────────────────
    items: list[LossBreakdownItem] = []
    K_sum_total = 0.0

    for acc_item, raw, seg in all_resolved:
        vh_item = _vh_for_seg(seg)   # use this segment's pipe diameter
        K_each = (
            acc_item.K_override
            if acc_item.K_override is not None
            else raw["default_K"]
        )
        K_total = K_each * acc_item.count
        hm_item = K_total * vh_item
        K_sum_total += K_total

        items.append(
            LossBreakdownItem(
                accessory_id=acc_item.accessory_id,
                name=raw["name"],
                category=raw["category"],
                segment=seg,
                count=acc_item.count,
                K_each=round(K_each, 6),
                K_total=round(K_total, 6),
                hm_m=round(hm_item, 6),
                hm_display=convert(round(hm_item, 6), "head", us),
                pct_of_total_minor=0.0,
                potable_notes=raw.get("potable_notes", []),
            )
        )

    # Total minor loss is the sum of individual item losses (not K_sum × single_vh,
    # which would be wrong when suction and discharge diameters differ)
    total_hm = sum(it.hm_m for it in items)

    # Back-fill % of total minor and sort descending
    filled_items: list[LossBreakdownItem] = []
    for it in items:
        pct = (it.hm_m / total_hm * 100.0) if total_hm > 0 else 0.0
        filled_items.append(
            LossBreakdownItem(
                accessory_id=it.accessory_id,
                name=it.name,
                category=it.category,
                segment=it.segment,
                count=it.count,
                K_each=it.K_each,
                K_total=it.K_total,
                hm_m=it.hm_m,
                hm_display=it.hm_display,
                pct_of_total_minor=round(pct, 2),
                potable_notes=it.potable_notes,
            )
        )
    filled_items.sort(key=lambda x: x.hm_m, reverse=True)

    if total_hm == 0.0 and len(all_resolved) > 0:
        warnings.append("All selected accessories have K = 0 — total minor loss is zero.")

    # ── Per-segment minor subtotals ───────────────────────────────────────────
    suction_minor = round(sum(it.hm_m for it in filled_items if it.segment == "suction"), 6)
    discharge_minor = round(sum(it.hm_m for it in filled_items if it.segment == "discharge"), 6)

    # ── Grand total ───────────────────────────────────────────────────────────
    major_hm = round(suction_major_hm + discharge_major_hm, 6)
    grand_total = round(total_hm + major_hm, 6)
    pct_minor = (total_hm / grand_total * 100.0) if grand_total > 0 else 0.0
    pct_major = (major_hm / grand_total * 100.0) if grand_total > 0 else 0.0

    # ── Per-category subtotals ────────────────────────────────────────────────
    _cat_K: dict[str, float] = {}
    _cat_hm: dict[str, float] = {}
    for it in filled_items:
        _cat_K[it.category] = _cat_K.get(it.category, 0.0) + it.K_total
        _cat_hm[it.category] = _cat_hm.get(it.category, 0.0) + it.hm_m

    category_subtotals: list[CategorySubtotal] = []
    for cat, hm_c in sorted(_cat_hm.items(), key=lambda kv: kv[1], reverse=True):
        pct_c = (hm_c / total_hm * 100.0) if total_hm > 0 else 0.0
        category_subtotals.append(
            CategorySubtotal(
                category=cat,
                label=_CATEGORY_LABELS.get(cat, cat),
                K_sum=round(_cat_K[cat], 6),
                hm_m=round(hm_c, 6),
                hm_display=convert(round(hm_c, 6), "head", us),
                pct_of_total_minor=round(pct_c, 2),
            )
        )

    # ── Contribution matrix (segment × loss_type × category) ─────────────────
    contribution_rows: list[ContributionRow] = []

    def _add_row(seg: str, loss_type: str, cat: str, label: str, hm: float) -> None:
        if hm <= 0.0:
            return
        pct = (hm / grand_total * 100.0) if grand_total > 0 else 0.0
        contribution_rows.append(
            ContributionRow(
                segment=seg,
                loss_type=loss_type,
                category=cat,
                label=label,
                h_m=round(hm, 6),
                h_display=convert(round(hm, 6), "head", us),
                pct_of_grand_total=round(pct, 2),
            )
        )

    # Major loss rows
    _add_row("suction",   "major", "friction", "Suction Pipe Friction",   suction_major_hm)
    _add_row("discharge", "major", "friction", "Discharge Pipe Friction", discharge_major_hm)

    # Minor loss rows — per segment per category
    for seg_key in ("suction", "discharge", None):
        seg_label = seg_key if seg_key else "untagged"
        seg_display = {"suction": "Suction", "discharge": "Discharge"}.get(seg_key or "", "Untagged")  # type: ignore[arg-type]
        for cat, hm_c in _cat_hm.items():
            hm_seg_cat = sum(
                it.hm_m
                for it in filled_items
                if it.category == cat and it.segment == seg_key
            )
            if hm_seg_cat > 0:
                label = f"{seg_display} — {_CATEGORY_LABELS.get(cat, cat)}"
                _add_row(seg_label, "minor", cat, label, hm_seg_cat)

    contribution_rows.sort(key=lambda r: r.h_m, reverse=True)

    return LossBreakdownResponse(
        items=filled_items,
        K_sum=round(K_sum_total, 6),
        total_hm_m=round(total_hm, 6),
        total_hm_display=convert(round(total_hm, 6), "head", us),
        suction_minor_hm_m=suction_minor,
        discharge_minor_hm_m=discharge_minor,
        suction_major_hm_m=suction_major_hm,
        discharge_major_hm_m=discharge_major_hm,
        major_hm_m=major_hm,
        grand_total_hm_m=grand_total,
        pct_minor_of_grand_total=round(pct_minor, 2),
        pct_major_of_grand_total=round(pct_major, 2),
        category_subtotals=category_subtotals,
        contribution_rows=contribution_rows,
        velocity_ms=round(V, 4),
        velocity_head_m=round(vh, 6),
        design_Q_m3h=req.Q_m3h,
        D_mm=ref_D_mm,
        unit_system=us,
        warnings=warnings,
    )


# ---------------------------------------------------------------------------
# Surge / Water Hammer — Mode A Quick Check
# ---------------------------------------------------------------------------


@app.post(
    "/surge/quick",
    response_model=SurgeQuickResponse,
    tags=["surge"],
    summary="Water-hammer quick check (Mode A — Joukowsky + slow-closure reduction)",
    status_code=status.HTTP_200_OK,
)
def surge_quick_check(req: SurgeQuickRequest) -> SurgeQuickResponse:
    """
    Mode A quick-check water-hammer analysis using the Joukowsky equation.

    **ΔH = a·ΔV/g** [m], **ΔP = ρ·a·ΔV** [kPa]

    For slow closures (tc > T = 2L/a) the Allievi/Bergeron linear reduction
    factor **K = T/tc** is applied → **ΔH_eff = K·ΔH_Joukowsky**.

    Returns a preliminary pressure envelope at each pipe end and risk flags
    for sub-atmospheric (vacuum) and cavitation conditions.
    """
    try:
        result = surge_quick(
            pipeline=req.pipeline,
            wave_speed_ms=req.wave_speed_ms,
            V0_ms=req.V0_ms,
            event_type=req.event_type,
            pipe_length_m=req.pipe_length_m,
            closure_time_s=req.closure_time_s,
            rho_kg_m3=req.rho_kg_m3,
            H_operating_m=req.H_operating_m,
            temperature_C=req.temperature_C,
            pressure_rating_kPa=req.pressure_rating_kPa,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    envelope_points = [SurgeEnvelopePoint(**pt) for pt in result.pop("envelope")]
    rating_check_data = result.pop("rating_check", None)
    rating_check = PressureRatingCheck(**rating_check_data) if rating_check_data else None

    return SurgeQuickResponse(
        pipeline=req.pipeline,
        event_type=req.event_type,
        wave_speed_ms=req.wave_speed_ms,
        V0_ms=req.V0_ms,
        pipe_length_m=req.pipe_length_m,
        rho_kg_m3=req.rho_kg_m3,
        H_operating_m=req.H_operating_m,
        closure_time_s=req.closure_time_s,
        unit_system=req.unit_system,
        envelope=envelope_points,
        rating_check=rating_check,
        **result,
    )


@app.post(
    "/surge/wavespeed",
    response_model=WaveSpeedResponse,
    tags=["surge"],
    summary="Acoustic wave speed calculator (Halliwell thin-wall formula)",
    status_code=status.HTTP_200_OK,
)
def surge_wave_speed(req: WaveSpeedRequest) -> WaveSpeedResponse:
    """
    Compute acoustic wave speed *a* in a pressurised pipe using the
    Halliwell/Joukowsky thin-wall formula:

    **a = √(K_f/ρ) / √(1 + K_f·Dᵢ/(Eₚ·e)·C)**

    Supports eight pipe materials (DICL, grey cast iron, steel, PVC/uPVC,
    HDPE PE100, GRP/FRP, asbestos cement, concrete/RCCP) and three pipe
    restraint conditions.  Wall thickness may be specified directly or derived
    from SDR.

    Returns the computed wave speed, all intermediate values, and a
    step-by-step equation trace string suitable for display in design reports.
    """
    try:
        result = compute_wave_speed(
            material=req.material,
            D_o_m=req.D_o_mm / 1000.0,
            e_m=req.wall_thickness_mm / 1000.0 if req.wall_thickness_mm is not None else None,
            sdr=req.sdr,
            restraint=req.restraint,
            K_f_Pa=req.K_f_GPa * 1.0e9,
            rho_kg_m3=req.rho_kg_m3,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return WaveSpeedResponse(**result)


# ---------------------------------------------------------------------------
# Surge Mode B — Method of Characteristics (MOC) transient simulation
# ---------------------------------------------------------------------------


def _build_moc_bc(bc_data) -> BoundaryCondition:
    """Convert a validated Pydantic BC model to the appropriate engine class."""
    if isinstance(bc_data, MOCBCReservoir):
        return ReservoirBC(H_res_m=bc_data.H_m)
    if isinstance(bc_data, MOCBCPumpTrip):
        return PumpTripBC(
            H_pump_0=bc_data.H_pump_m,
            Q_0=bc_data.Q_m3s,
            t_trip=bc_data.t_trip_s,
            H_reservoir_m=bc_data.H_reservoir_m,
        )
    if isinstance(bc_data, MOCBCValveClosure):
        return ValveClosureBC(
            Q_0=bc_data.Q_m3s,
            t_close=bc_data.t_close_s,
            profile=bc_data.profile,
        )
    if isinstance(bc_data, MOCBCSuctionPumpTrip):
        return SuctionPumpTripBC(
            H_sump_m=bc_data.H_sump_m,
            Q_0=bc_data.Q_m3s,
            t_trip=bc_data.t_trip_s,
        )
    raise ValueError(f"Unknown boundary condition type: {bc_data.type}")


@app.post(
    "/surge/moc",
    response_model=MOCResponse,
    tags=["surge"],
    summary="Mode B — full MOC transient simulation",
)
async def moc_transient(req: MOCRequest) -> MOCResponse:
    """
    Run a 1-D Method of Characteristics (MOC) transient simulation on a single
    pipeline.

    The pipeline is described as one or more segments; multi-segment pipelines
    are collapsed to an equivalent uniform grid (flow-weighted mean diameter,
    length-weighted mean roughness).  Courant number = 1 is enforced.

    **Boundary condition types**

    | type | side | description |
    |------|------|-------------|
    | `reservoir` | either | Constant-head (fixed HGL) |
    | `pump_trip` | upstream | Quadratic head decay + check valve |
    | `valve_closure` | downstream | Gate-valve model Q = Q₀·τ(t)² |
    | `suction_pump_trip` | downstream | Pump demand collapse on suction line |

    Returns pressure-envelope arrays, time histories at up to 3 observation
    nodes, grid metadata, and an optional pipe-rating FoS check.
    """
    segs = [
        {
            "L_m":         float(s.L_m),
            "D_m":         float(s.D_m),
            "roughness_m": float(s.roughness_m),
            "elev_start_m": float(s.elev_start_m),
            "elev_end_m":   float(s.elev_end_m),
        }
        for s in req.segments
    ]

    obs_fracs  = [op.frac  for op in req.observation_points] or None
    obs_labels = [op.label or f"{op.frac:.0%}" for op in req.observation_points] or None

    try:
        raw = run_moc(
            segments=segs,
            wave_speed_ms=req.wave_speed_ms,
            Q_0_m3s=req.Q_0_m3s,
            H_0_m=req.H_0_m,
            boundary_A=_build_moc_bc(req.boundary_A),
            boundary_B=_build_moc_bc(req.boundary_B),
            temperature_C=req.temperature_C,
            rho_kg_m3=req.rho_kg_m3,
            pressure_rating_kPa=req.pressure_rating_kPa,
            observation_fracs=obs_fracs,
            observation_labels=obs_labels,
            n_reaches_override=req.n_reaches,
            t_total_override=req.t_total_s,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return MOCResponse(
        pipeline=req.pipeline,
        unit_system=req.unit_system,
        **raw,
    )


# ---------------------------------------------------------------------------
# Surge — Suction transient / NPSHa analysis
# ---------------------------------------------------------------------------


@app.post(
    "/surge/suction",
    response_model=SuctionTransientResponse,
    tags=["surge"],
    summary="Suction-pipeline transient + NPSHa time-series (MOC)",
    status_code=status.HTTP_200_OK,
)
async def suction_transient(req: SuctionTransientRequest) -> SuctionTransientResponse:
    """
    Run a 1-D MOC transient simulation on the **suction pipeline** and compute
    the NPSHa(t) time series at the pump suction node.

    **NPSHa physics**

        NPSHa(t) = H_suction_gauge(t) − h_vap_gauge(T)

    where ``h_vap_gauge`` is the vapour-pressure head expressed as gauge head
    (always negative for T < 100 °C at standard atmospheric pressure).

    **Typical boundary setup**

    | boundary | type | notes |
    |----------|------|-------|
    | A (upstream, node 0) | `reservoir` | wet-well at LWL (worst case) |
    | B (downstream, node N) | `suction_pump_trip` | pump demand collapses |

    **Risk flag** — ``transient_npsh_risk`` is set when NPSHa(t) < NPSHr at any
    point during the simulation.  ``NPSHr_m`` is echoed from the request.
    """
    # Build observation list: pump suction node first, then user extras (≤ 2)
    pump_label = f"Pump suction (x = {req.pump_node_frac * 100:.0f}% L)"
    obs_fracs  = [req.pump_node_frac] + [op.frac  for op in req.observation_points]
    obs_labels = [pump_label]         + [
        op.label or f"{op.frac:.0%} L" for op in req.observation_points
    ]

    segs = [
        {
            "L_m":          float(s.L_m),
            "D_m":          float(s.D_m),
            "roughness_m":  float(s.roughness_m),
            "elev_start_m": float(s.elev_start_m),
            "elev_end_m":   float(s.elev_end_m),
        }
        for s in req.segments
    ]

    try:
        raw = run_moc(
            segments=segs,
            wave_speed_ms=req.wave_speed_ms,
            Q_0_m3s=req.Q_0_m3s,
            H_0_m=req.H_0_m,
            boundary_A=_build_moc_bc(req.boundary_A),
            boundary_B=_build_moc_bc(req.boundary_B),
            temperature_C=req.temperature_C,
            rho_kg_m3=req.rho_kg_m3,
            pressure_rating_kPa=req.pressure_rating_kPa,
            observation_fracs=obs_fracs,
            observation_labels=obs_labels,
            n_reaches_override=req.n_reaches,
            t_total_override=req.t_total_s,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    # Post-process obs[0] (pump suction node) for NPSHa time series
    npsha_data = compute_npsha_transient(
        moc_raw=raw,
        obs_index=0,
        NPSHr_m=req.NPSHr_m,
    )

    npsha_points = [NPSHaPoint(**pt) for pt in npsha_data.pop("npsha_series")]

    # Build MOC sub-objects
    envelope_pts = [MOCEnvelopePoint(**pt) for pt in raw.pop("envelope")]
    rating_raw   = raw.pop("rating_check", None)
    rating_check = PressureRatingCheck(**rating_raw) if rating_raw else None
    obs_results  = [
        MOCObservationResult(
            label=ob["label"],
            frac=ob["frac"],
            node_index=ob["node_index"],
            x_m=ob["x_m"],
            history=[MOCTimePoint(**tp) for tp in ob["history"]],
        )
        for ob in raw.pop("observations")
    ]

    return SuctionTransientResponse(
        pipeline="suction",
        unit_system=req.unit_system,
        atm_pressure_kPa=req.atm_pressure_kPa,
        NPSHr_m=req.NPSHr_m,
        pump_node_frac=req.pump_node_frac,
        npsha_series=npsha_points,
        **npsha_data,
        envelope=envelope_pts,
        observations=obs_results,
        rating_check=rating_check,
        **raw,
    )


# ---------------------------------------------------------------------------
# Surge — What-if surge protection scenario comparison  (Task #56)
# ---------------------------------------------------------------------------


@app.post(
    "/surge/whatif",
    response_model=WhatIfResponse,
    tags=["surge"],
    summary="What-if surge protection scenario comparison (5 device types)",
)
async def surge_whatif(req: WhatIfRequest) -> WhatIfResponse:
    """
    Run a baseline MOC simulation and then evaluate each enabled protection
    device in turn, returning structured comparison metrics and lightweight
    pressure-envelope arrays for chart overlay.

    **Protection device types**

    | type              | model strategy                                          |
    |-------------------|---------------------------------------------------------|
    | `air_vessel`      | Stateful AirVesselBC replaces one pipeline boundary     |
    | `surge_tank`      | Stateful SurgeTankBC replaces one pipeline boundary     |
    | `prv`             | Post-processing: caps max-head envelope at H_set_m      |
    | `vacuum_relief`   | Post-processing: clamps min-head envelope at H_admit_m  |
    | `slow_check_valve`| Re-runs MOC with a longer ValveClosureBC t_close        |

    All sizing formulas are screening-level (±30–50 %).
    """
    # ── 1. Engine segment dicts ─────────────────────────────────────────────
    segs = [
        {
            "L_m":          float(s.L_m),
            "D_m":          float(s.D_m),
            "roughness_m":  float(s.roughness_m),
            "elev_start_m": float(s.elev_start_m),
            "elev_end_m":   float(s.elev_end_m),
        }
        for s in req.segments
    ]

    # ── 2. Grid info — needed before instantiating stateful BCs ────────────
    try:
        grid = build_grid(segs, req.wave_speed_ms, n_reaches_override=req.n_reaches)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    dt_s   = grid["dt_s"]
    A_pipe = grid["A_m2"]
    D_m    = grid["D_m"]
    L_m    = grid["L_total_m"]

    # ── 3. Common run keyword arguments ─────────────────────────────────────
    obs_fracs  = [op.frac  for op in (req.observation_points or [])] or None
    obs_labels = (
        [op.label or f"{op.frac:.0%}" for op in (req.observation_points or [])]
        if req.observation_points else None
    )

    base_kwargs: dict = dict(
        segments=segs,
        wave_speed_ms=req.wave_speed_ms,
        Q_0_m3s=req.Q_0_m3s,
        H_0_m=req.H_0_m,
        temperature_C=req.temperature_C,
        rho_kg_m3=req.rho_kg_m3,
        pressure_rating_kPa=req.pressure_rating_kPa,
        observation_fracs=obs_fracs,
        observation_labels=obs_labels,
        n_reaches_override=req.n_reaches,
        t_total_override=req.t_total_s,
    )

    # ── 4. Baseline run ──────────────────────────────────────────────────────
    try:
        raw_base = run_moc(
            boundary_A=_build_moc_bc(req.boundary_A),
            boundary_B=_build_moc_bc(req.boundary_B),
            **base_kwargs,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    base_max_H = raw_base["global_max_H_m"]
    base_min_H = raw_base["global_min_H_m"]
    T_char_s   = raw_base["T_char_s"]
    t_total_s  = raw_base["t_total_s"]

    # Representative target head for sizing helpers (aim for ~30 % surge reduction)
    H_target = max(base_max_H * 0.70, req.H_0_m * 1.20)

    # ── 5. Build baseline response model ────────────────────────────────────
    base_m  = extract_whatif_metrics(raw_base, "Baseline (no protection)", None, None, req.rho_kg_m3)
    env_b   = [WhatIfEnvelopePoint(**pt) for pt in base_m.pop("envelope")]
    rc_b    = base_m.pop("rating_check", None)
    baseline_resp = WhatIfRunMetrics(
        **base_m,
        envelope=env_b,
        rating_check=PressureRatingCheck(**rc_b) if rc_b else None,
    )

    # ── 6. Device runs ───────────────────────────────────────────────────────
    device_runs: list[WhatIfRunMetrics] = []

    for dev in req.devices:
        if not dev.enabled:
            continue

        try:
            if isinstance(dev, AirVesselDeviceConfig):
                V_gas_0  = dev.V_total_m3 * dev.V_gas_frac
                vessel   = AirVesselBC(
                    dt_s=dt_s, V_total_m3=dev.V_total_m3, V_gas_0_m3=V_gas_0,
                    P0_kPa=dev.P0_kPa, rho_kg_m3=req.rho_kg_m3,
                    polytropic_n=dev.polytropic_n,
                )
                bc_a_d = vessel if dev.boundary_side == "A" else _build_moc_bc(req.boundary_A)
                bc_b_d = vessel if dev.boundary_side == "B" else _build_moc_bc(req.boundary_B)
                raw_d  = run_moc(boundary_A=bc_a_d, boundary_B=bc_b_d, **base_kwargs)
                sizing = size_air_vessel(
                    Q_0_m3s=req.Q_0_m3s, a_ms=req.wave_speed_ms,
                    A_pipe_m2=A_pipe, H_0_m=req.H_0_m, H_max_target_m=H_target,
                )
                label  = f"Air Vessel {dev.V_total_m3:.2g} m³ (side {dev.boundary_side})"

            elif isinstance(dev, SurgeTankDeviceConfig):
                tank  = SurgeTankBC(
                    dt_s=dt_s, A_tank_m2=dev.A_tank_m2,
                    z_initial_m=dev.z_initial_m, z_max_m=dev.z_max_m,
                )
                bc_a_d = tank if dev.boundary_side == "A" else _build_moc_bc(req.boundary_A)
                bc_b_d = tank if dev.boundary_side == "B" else _build_moc_bc(req.boundary_B)
                raw_d  = run_moc(boundary_A=bc_a_d, boundary_B=bc_b_d, **base_kwargs)
                sizing = size_surge_tank(
                    Q_0_m3s=req.Q_0_m3s, a_ms=req.wave_speed_ms,
                    L_m=L_m, D_m=D_m, H_0_m=req.H_0_m, H_max_target_m=H_target,
                )
                label  = f"Surge Tank {dev.A_tank_m2:.2g} m² (side {dev.boundary_side})"

            elif isinstance(dev, PRVDeviceConfig):
                # Dynamic MOC: PRVBC wraps the base BC at selected boundary.
                # When H > H_set_m at that boundary node, PRV opens and fixes
                # H = H_set_m, recomputing Q from the MOC characteristic.
                base_bc_prv = _build_moc_bc(
                    req.boundary_A if dev.boundary_side == "A" else req.boundary_B
                )
                prv    = PRVBC(H_set_m=dev.H_set_m, base_bc=base_bc_prv)
                bc_a_d = prv if dev.boundary_side == "A" else _build_moc_bc(req.boundary_A)
                bc_b_d = prv if dev.boundary_side == "B" else _build_moc_bc(req.boundary_B)
                raw_d  = run_moc(boundary_A=bc_a_d, boundary_B=bc_b_d, **base_kwargs)
                q_rel  = dev.Q_relief_m3s or req.Q_0_m3s
                G_loc  = 9.81
                P_up   = max(
                    base_max_H * req.rho_kg_m3 * G_loc / 1_000.0,
                    dev.H_set_m * req.rho_kg_m3 * G_loc / 1_000.0 + 1.0,
                )
                P_set  = dev.H_set_m * req.rho_kg_m3 * G_loc / 1_000.0
                sizing = size_prv(q_rel, P_up, P_set)
                label  = f"PRV @ {dev.H_set_m:.1f} m (side {dev.boundary_side})"

            elif isinstance(dev, VacuumReliefDeviceConfig):
                # Dynamic MOC: VacuumReliefBC wraps the base BC at selected boundary.
                # When H < H_admit_m at that node, valve opens and fixes H = H_admit_m.
                base_bc_var = _build_moc_bc(
                    req.boundary_A if dev.boundary_side == "A" else req.boundary_B
                )
                var    = VacuumReliefBC(H_admit_m=dev.H_admit_m, base_bc=base_bc_var)
                bc_a_d = var if dev.boundary_side == "A" else _build_moc_bc(req.boundary_A)
                bc_b_d = var if dev.boundary_side == "B" else _build_moc_bc(req.boundary_B)
                raw_d  = run_moc(boundary_A=bc_a_d, boundary_B=bc_b_d, **base_kwargs)
                sizing = size_vacuum_relief(D_m)
                label  = f"Vacuum Relief H_admit={dev.H_admit_m:.1f} m (side {dev.boundary_side})"

            elif isinstance(dev, SlowCheckValveDeviceConfig):
                # Resolve the BC at the selected boundary side
                side_bc_raw = req.boundary_A if dev.boundary_side == "A" else req.boundary_B
                bc_type_str = getattr(side_bc_raw, "type", "")

                # Validate: slow-closing check valve requires a closing event at
                # the selected boundary (valve_closure, pump_trip, suction_pump_trip).
                # A downstream reservoir BC has no closing event — reject it.
                _VALID_SLOW_CHK = {"valve_closure", "pump_trip", "suction_pump_trip"}
                if bc_type_str not in _VALID_SLOW_CHK:
                    raise ValueError(
                        f"Slow-closing check valve at boundary {dev.boundary_side}: "
                        f"the baseline BC is '{bc_type_str}', which does not have a "
                        "valve/check-valve closing event. Use boundary_side='A' when "
                        "boundary A is pump_trip/valve_closure, or supply a "
                        "valve_closure BC at the selected boundary."
                    )

                # Inherit Q_0 from the existing BC when available, else use request Q_0
                existing_Q = getattr(side_bc_raw, "Q_m3s", None) or \
                             getattr(side_bc_raw, "Q_0_m3s", None)
                q0     = dev.Q_0_m3s or existing_Q or req.Q_0_m3s

                # If the existing BC is valve_closure, inherit profile/Q unless overridden
                existing_profile = getattr(side_bc_raw, "profile", None)
                profile = dev.profile or existing_profile or "linear"

                vc     = ValveClosureBC(Q_0=q0, t_close=dev.t_close_s, profile=profile)
                bc_a_d = vc if dev.boundary_side == "A" else _build_moc_bc(req.boundary_A)
                bc_b_d = vc if dev.boundary_side == "B" else _build_moc_bc(req.boundary_B)
                raw_d  = run_moc(boundary_A=bc_a_d, boundary_B=bc_b_d, **base_kwargs)
                sizing = size_slow_check_valve(
                    Q_0_m3s=req.Q_0_m3s, a_ms=req.wave_speed_ms,
                    L_m=L_m, D_m=D_m, H_0_m=req.H_0_m, H_max_target_m=H_target,
                )
                label  = f"Slow Check Valve {dev.t_close_s:.0f} s ({profile})"

            else:
                continue

            m   = extract_whatif_metrics(
                raw_d, label, base_max_H, base_min_H, req.rho_kg_m3,
                baseline_envelope=raw_base.get("envelope"),
            )
            env = [WhatIfEnvelopePoint(**pt) for pt in m.pop("envelope")]
            rc  = m.pop("rating_check", None)
            m.pop("sizing_summary", None)   # supplied by device sizing below
            device_runs.append(WhatIfRunMetrics(
                **m,
                envelope=env,
                rating_check=PressureRatingCheck(**rc) if rc else None,
                sizing_summary=sizing,
            ))

        except (ValueError, ZeroDivisionError) as exc:
            # Do NOT fabricate zero-valued metrics — set run_error so the frontend
            # can identify and exclude this row from numeric comparison tables.
            # Use already-set label if available, else fall back to device class name.
            _err_base = locals().get("label") or type(dev).__name__
            device_runs.append(WhatIfRunMetrics(
                label=f"ERROR — {_err_base}",
                run_error=str(exc)[:200],
                global_max_H_m=0.0, global_min_H_m=0.0,
                global_max_P_kPa=0.0, global_min_P_kPa=0.0,
                cavitation_x_m=[], envelope=[],
            ))

    return WhatIfResponse(
        baseline=baseline_resp,
        device_runs=device_runs,
        assumption_notes=raw_base["assumption_notes"],
        t_total_s=t_total_s,
        T_char_s=T_char_s,
        pipeline=req.pipeline,
    )


# ---------------------------------------------------------------------------
# POST /surge/device-size  — lightweight pre-run sizing preview (no MOC)
# ---------------------------------------------------------------------------

class _DeviceSizeRequest(BaseModel):
    """Inline sizing preview — pipe geometry + one device config.  No MOC run."""
    Q_0_m3s:              float
    wave_speed_ms:        float
    H_0_m:                float
    segments:             list[MOCSegmentInput]
    rho_kg_m3:            float = 1000.0
    pressure_rating_kPa:  float | None = None
    device:               ProtectionDeviceConfig


@app.post("/surge/device-size", tags=["Surge — What-If"])
async def surge_device_size(req: _DeviceSizeRequest) -> dict:
    """
    Return a preliminary device sizing estimate WITHOUT running MOC.

    Useful for inline UI previews while the user is configuring devices.
    All results are screening-level (±30–50 %). Returns a flat dict with
    the same keys as `sizing_summary` in the whatif response.
    """
    from backend.engine.surge_sizing import (
        size_air_vessel, size_surge_tank, size_prv,
        size_vacuum_relief, size_slow_check_valve,
    )

    # ── Derive pipe geometry from first segment ──────────────────────────────
    if not req.segments:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one segment is required for device sizing.",
        )
    import math as _math
    seg0 = req.segments[0]
    D_m  = seg0.D_m or 0.2
    L_m  = sum(s.L_m for s in req.segments) or 500.0
    A_pipe = _math.pi / 4.0 * D_m ** 2

    G_loc     = 9.81
    H_target  = req.H_0_m * 1.30
    dev       = req.device

    try:
        if isinstance(dev, AirVesselDeviceConfig):
            return size_air_vessel(
                Q_0_m3s=req.Q_0_m3s, a_ms=req.wave_speed_ms,
                A_pipe_m2=A_pipe, H_0_m=req.H_0_m, H_max_target_m=H_target,
            )
        elif isinstance(dev, SurgeTankDeviceConfig):
            return size_surge_tank(
                Q_0_m3s=req.Q_0_m3s, a_ms=req.wave_speed_ms,
                L_m=L_m, D_m=D_m, H_0_m=req.H_0_m, H_max_target_m=H_target,
            )
        elif isinstance(dev, PRVDeviceConfig):
            q_rel = dev.Q_relief_m3s or req.Q_0_m3s
            P_up  = max(H_target * req.rho_kg_m3 * G_loc / 1_000.0, 1.0)
            P_set = dev.H_set_m * req.rho_kg_m3 * G_loc / 1_000.0
            return size_prv(q_rel, P_up, P_set)
        elif isinstance(dev, VacuumReliefDeviceConfig):
            return size_vacuum_relief(D_m)
        elif isinstance(dev, SlowCheckValveDeviceConfig):
            return size_slow_check_valve(
                Q_0_m3s=req.Q_0_m3s, a_ms=req.wave_speed_ms,
                L_m=L_m, D_m=D_m, H_0_m=req.H_0_m, H_max_target_m=H_target,
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Unknown device type.",
            )
    except (ValueError, ZeroDivisionError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )


# ---------------------------------------------------------------------------
# Word design report export
# ---------------------------------------------------------------------------

@app.post(
    "/export/word",
    summary="Export project as an engineering Word design report (.docx)",
    response_description="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    tags=["Export"],
)
async def export_word(body: ExcelExportRequest) -> StreamingResponse:
    """
    Accept the full ProjectDraft as a typed Pydantic model and return a .docx report.

    The report contains: title page, executive summary, hydraulic analysis,
    pump analysis, wet well sizing, engineering checks, surge analysis,
    protection device comparison, and appendices. Figures are embedded as PNG.
    """
    draft: dict = body.model_dump()

    try:
        docx_bytes = _doc_to_bytes(build_document(draft))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Word report build failed: {exc}",
        )

    project_name = ""
    meta = draft.get("meta")
    if isinstance(meta, dict):
        project_name = meta.get("name", "") or ""

    safe_name = (
        "".join(c if c.isalnum() or c in "._-" else "_" for c in project_name)
        or "wps_project"
    )
    filename = f"{safe_name}.docx"

    import io as _io
    return StreamingResponse(
        _io.BytesIO(docx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(docx_bytes)),
        },
    )


# ---------------------------------------------------------------------------
# Excel workbook export
# ---------------------------------------------------------------------------

@app.post(
    "/export/excel",
    summary="Export project as a professional Excel workbook",
    response_description="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    tags=["Export"],
)
async def export_excel(body: ExcelExportRequest) -> StreamingResponse:
    """
    Accept the full ProjectDraft as a typed Pydantic model and return a .xlsx workbook.

    ExcelExportRequest uses extra='allow' so any future ProjectDraft fields pass
    through without validation errors.  The workbook contains 11 sheets and 6
    embedded charts covering all computed results.
    """
    draft: dict = body.model_dump()

    try:
        xlsx_bytes = _wb_to_bytes(build_workbook(draft))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Workbook build failed: {exc}",
        )

    project_name = ""
    meta = draft.get("meta")
    if isinstance(meta, dict):
        project_name = meta.get("name", "") or ""

    safe_name = (
        "".join(c if c.isalnum() or c in "._-" else "_" for c in project_name)
        or "wps_project"
    )
    filename = f"{safe_name}.xlsx"

    import io
    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(xlsx_bytes)),
        },
    )
