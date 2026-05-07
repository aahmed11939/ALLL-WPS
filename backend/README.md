# ALLL WPS Designer — Backend

Python FastAPI hydraulic calculation service.

## Structure

```
backend/
  engine/
    hydraulics.py     Core calculations (Darcy-Weisbach, Colebrook-White, system curve)
    wetwell.py        Wet-well sizing (stub — future)
    surge.py          Surge / water-hammer (stub — future)
  api/
    main.py           FastAPI app, CORS middleware, route handlers
    schemas.py        Pydantic v2 request/response models
  data/
    pipe_materials.yaml  Absolute roughness ε [mm] for 9 materials
    pump_library.yaml    3 example pumps with quadratic curve coefficients
    loader.py            YAML loaders (LRU-cached at startup)
  export/
    excel_export.py   Excel report generator (stub — future)
    word_export.py    Word/DOCX report generator (stub — future)
  tests/
    test_hydraulics.py  31 pytest unit tests (all passing)
```

## Quick Start

```bash
# Install dependencies (from repo root)
pip install fastapi "uvicorn[standard]" pyyaml pydantic pytest httpx

# Start with hot-reload
uvicorn backend.api.main:app --reload --port 8000

# Run tests
pytest backend/tests/test_hydraulics.py -v
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/health | Service health check |
| GET | /api/v1/materials | List pipe materials (for UI dropdown) |
| GET | /api/v1/pump-library | Example pump catalogue |
| POST | /api/v1/calculate | Compute TDH and system curve |
| GET | /api/v1/docs | Swagger UI (auto-generated) |
| GET | /api/v1/redoc | ReDoc (auto-generated) |

## Calculation Method

All losses use SI units internally. The `CalculationRequest` accepts Q in m³/h and
diameter in mm; the engine converts to m³/s and m before computing.

**Darcy-Weisbach:**
```
h_f = f · (L/D) · V²/(2g)
```

**Colebrook-White (iterative, x = 1/√f):**
```
x_{n+1} = -2 log₁₀(ε/(3.7D) + 2.51·x_n / Re)   [convergence < 10⁻⁹]
```

**Minor losses:**
```
h_m = ΣK · V²/(2g)
```

**TDH:**
```
TDH = h_s + h_f + h_m   where h_s = z_downstream − z_upstream
```

## See Also

Full engineering references and API examples: [`docs/README.md`](../docs/README.md)
