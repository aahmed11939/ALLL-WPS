"""
ALLL WPS Designer — FastAPI application entry point.

Run with:
    uvicorn backend.api.main:app --reload --port 8000
"""

from __future__ import annotations

import math
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from backend.api.domain_models import ProjectModel, ValidationResult
from backend.api.schemas import (
    CalculationRequest,
    CalculationResponse,
    MaterialOption,
    MaterialOptionsResponse,
    PumpLibraryResponse,
    PumpRecord,
    SystemCurvePoint,
)
from backend.data.loader import (
    get_material_options,
    get_roughness_m,
    load_pump_library,
)
from backend.engine.hydraulics import (
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
    Accept hydraulic design inputs and return:
    - Pipe velocity, Reynolds number, friction factor
    - Static head, friction loss, minor loss, TDH
    - 8-point H-Q system curve from Q=0 to Q=1.5×Q_design
    """
    # Validate material and resolve roughness
    try:
        roughness_m = get_roughness_m(req.material)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    # Convert inputs to SI
    Q_m3s = req.Q_m3h / 3600.0
    D_m = req.pipe_diameter_mm / 1000.0
    K_sum = sum(req.K_values)

    # Hydraulic calculations
    try:
        V = velocity(Q_m3s, D_m)
        Re = reynolds_number(Q_m3s, D_m)
        eps_D = roughness_m / D_m
        f = friction_factor_colebrook(Re, eps_D)
        h_s = static_head(req.elev_ds_m, req.elev_us_m)
        h_f = friction_head_loss(req.Q_m3h / 3600.0, D_m, req.pipe_length_m, roughness_m)
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

    curve_points = [SystemCurvePoint(**pt) for pt in curve_raw]

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

    Use this endpoint to drive client-side form feedback without relying on
    FastAPI's default 422 response shape.
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
    """
    Return the JSON Schema for ``ProjectModel``.

    Useful for client-side form generation, validation libraries, and
    API documentation tooling.
    """
    return ProjectModel.model_json_schema()
