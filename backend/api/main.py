"""
ALLL WPS Designer — FastAPI application entry point.

Run with:
    uvicorn backend.api.main:app --reload --port 8000
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from backend.api.domain_models import ProjectModel, ValidationResult
from backend.api.schemas import (
    AssemblyInput,
    CalculationRequest,
    CalculationResponse,
    ComputeSystemCurvePoint,
    DisplayValues,
    HydraulicComputeRequest,
    HydraulicComputeResponse,
    MaterialOption,
    MaterialOptionsResponse,
    PipeSegment,
    PumpLibraryResponse,
    PumpRecord,
    SegmentResult,
    SystemCurvePoint,
)
from backend.data.loader import (
    get_material_options,
    get_roughness_m,
    load_pump_library,
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
    seg: "PipeSegment",
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
    velocities: list[float] = []

    try:
        idx = 0
        for seg in req.suction.segments:
            res, hf, hm = _compute_segment(Q_m3s, seg, req.suction.name or "suction", idx)
            segment_results.append(res)
            total_hf += hf
            total_hm += hm
            velocities.append(res.velocity_ms)
            idx += 1

        for seg in req.discharge.segments:
            res, hf, hm = _compute_segment(Q_m3s, seg, req.discharge.name or "discharge", idx)
            segment_results.append(res)
            total_hf += hf
            total_hm += hm
            velocities.append(res.velocity_ms)
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

    # Velocity head change: last segment outlet vs. first segment inlet
    if velocities:
        v_in = velocities[0]
        v_out = velocities[-1]
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
