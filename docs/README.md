# ALLL WPS Designer — Technical Documentation

## Overview

ALLL WPS Designer is an engineering-grade hydraulic calculation tool for
municipal drinking-water pump station design. It computes the system Total
Dynamic Head (TDH) using the Darcy-Weisbach friction loss equation with the
Colebrook-White iterative friction factor, and generates a full H-Q system
curve for pump selection.

---

## Architecture

```
/backend                  Python FastAPI service
  /engine
    hydraulics.py         Core hydraulic calculations (Darcy-Weisbach,
                          Colebrook-White, system curve)
    wetwell.py            Wet-well sizing module (stub — future work)
    surge.py              Surge/water-hammer module (stub — future work)
  /api
    main.py               FastAPI application, CORS, route handlers
    schemas.py            Pydantic v2 request/response models
  /data
    pipe_materials.yaml   Absolute roughness ε values by material
    pump_library.yaml     Example pump catalogue
    loader.py             YAML loaders with LRU caching
  /export
    excel_export.py       Excel report generator (stub — future work)
    word_export.py        Word/DOCX report generator (stub — future work)
  /tests
    test_hydraulics.py    Pytest unit tests (31 tests)

/frontend                 Vite + React + TypeScript SPA
  /src
    /components
      CalculationForm.tsx Input form (react-hook-form + zod validation)
      ResultsPanel.tsx    Results card grid with skeleton loader
      SystemCurveChart.tsx Recharts H-Q system curve plot + data table
    /pages
      DesignPage.tsx      Main two-column layout page
    /utils
      api.ts              Axios API client, TypeScript interfaces

/docs                     This documentation directory
/sample_data              Example request/response JSON payloads
```

---

## Backend Module Details

### `backend/engine/hydraulics.py`

Core calculation functions (all SI units):

| Function | Description |
|---|---|
| `velocity(Q_m3s, D_m)` | Mean pipe velocity [m/s] |
| `reynolds_number(Q_m3s, D_m)` | Reynolds number Re [-] |
| `friction_factor_colebrook(Re, eps_D)` | Darcy-Weisbach f via Colebrook-White iteration |
| `friction_head_loss(Q_m3s, D_m, L_m, roughness_m)` | h_f [m] |
| `minor_head_loss(Q_m3s, D_m, K_values)` | h_m = ΣK·V²/2g [m] |
| `static_head(elev_ds_m, elev_us_m)` | h_s = z_ds − z_us [m] |
| `tdh(h_s, h_f, h_m)` | Total Dynamic Head [m] |
| `system_curve(...)` | 8-point H-Q curve (Q=0 to 1.5×Q_design) |

**Friction factor method:** The Colebrook-White equation is solved iteratively
(fixed-point iteration on x = 1/√f, convergence < 10⁻⁹, max 50 iterations).
The Swamee-Jain explicit formula provides the initial guess. Laminar flow
(Re < 2300) uses the exact relation f = 64/Re.

### `backend/api/schemas.py`

Pydantic v2 models for request validation and response serialisation.

**`CalculationRequest` fields:**

| Field | Type | Description |
|---|---|---|
| `Q_m3h` | float > 0 | Design flow [m³/h] |
| `elev_us_m` | float | Upstream elevation [m above datum] |
| `elev_ds_m` | float | Downstream elevation [m above datum] |
| `pipe_length_m` | float > 0 | Pipe length [m] |
| `pipe_diameter_mm` | float > 0 | Internal diameter [mm] |
| `material` | string | Material key from `pipe_materials.yaml` |
| `K_values` | list[float] | Minor-loss K coefficients [-] |

### `backend/data/pipe_materials.yaml`

Roughness values (absolute ε in mm):

| Key | ε [mm] | Description |
|---|---|---|
| `cast_iron` | 0.26 | Cast Iron (unlined) |
| `cast_iron_cement_lined` | 0.12 | Cast Iron (cement-lined) |
| `ductile_iron` | 0.12 | Ductile Iron (cement-mortar lined) |
| `steel` | 0.046 | Steel (welded) |
| `steel_cement_lined` | 0.012 | Steel (cement-mortar lined) |
| `pvc` | 0.0015 | PVC (UPVC) |
| `hdpe` | 0.007 | HDPE (PE100) |
| `concrete` | 0.60 | Concrete (precast/prestressed) |
| `grp` | 0.03 | GRP / FRP |

---

## Prerequisites

- **Python** 3.11 or later
- **pip** (bundled with Python)
- **Node.js** 18 or later
- **npm** 9 or later (or **pnpm** 8+)

---

## Installation & Run

### Backend (FastAPI)

```bash
# From the repository root
pip install fastapi "uvicorn[standard]" pyyaml pydantic pytest httpx

# Start the development server (hot-reload)
uvicorn backend.api.main:app --reload --port 8000
```

The API is then available at:
- http://localhost:8000/api/v1/calculate  (POST)
- http://localhost:8000/api/v1/pump-library  (GET)
- http://localhost:8000/api/v1/materials  (GET)
- http://localhost:8000/api/v1/docs  (Swagger UI)
- http://localhost:8000/api/v1/redoc  (ReDoc)

### Frontend (Vite + React)

```bash
cd frontend
npm install
npm run dev
```

The app is at http://localhost:5173. The Vite dev proxy forwards `/api` →
`http://localhost:8000`, so the backend must be running first.

---

## Running Tests

```bash
# All 31 unit tests
pytest backend/tests/test_hydraulics.py -v

# With coverage
pip install pytest-cov
pytest backend/tests/test_hydraulics.py --cov=backend/engine --cov-report=term-missing
```

**Test coverage includes:**
- `velocity()` — dimensional check and edge cases
- `reynolds_number()` — laminar and turbulent regimes
- `friction_factor_colebrook()` — laminar exact (64/Re), Moody turbulent rough, smooth pipe, fully rough
- `friction_head_loss()` — hand-calculated reference case (DN150 DI, 100 m, Q=0.02 m³/s)
- `minor_head_loss()` — single and additive K values
- `static_head()` — positive, negative, zero
- `tdh()` — summation correctness
- `system_curve()` — 8 points, Q[0]=0, Q[-1]=1.5×Q_design, monotone increasing

---

## API Quick Reference

### POST /api/v1/calculate

```json
// Request
{
  "Q_m3h": 36.0,
  "elev_us_m": 5.0,
  "elev_ds_m": 28.5,
  "pipe_length_m": 200.0,
  "pipe_diameter_mm": 150.0,
  "material": "ductile_iron",
  "K_values": [0.5, 0.3, 1.0]
}

// Response
{
  "velocity_ms": 0.5659,
  "reynolds_number": 84647.6,
  "friction_factor": 0.021289,
  "static_head_m": 23.5,
  "friction_head_m": 0.8907,
  "minor_head_m": 0.0269,
  "tdh_m": 24.4176,
  "system_curve": [
    {"Q_m3h": 0.0, "H_m": 23.5},
    "..."
  ],
  "design_Q_m3h": 36.0,
  "K_sum": 1.8
}
```

---

## References

- Colebrook, C.F. (1939). "Turbulent flow in pipes." *Journal of the ICE*, 11(4): 133–156.
- Darcy, H. (1857). *Recherches expérimentales relatives au mouvement de l'eau dans les tuyaux*.
- Moody, L.F. (1944). "Friction factors for pipe flow." *Trans. ASME*, 66: 671–684.
- Swamee, P.K. & Jain, A.K. (1976). "Explicit equations for pipe-flow problems." *ASCE J. Hydraulics Div.*, 102(5): 657–664.
- AWWA Manual M11 — Steel Pipe: A Guide for Design and Installation (5th ed., 2017).
- AWWA Manual M44 — Distribution System Requirements for Fire Protection (2005).
- Hydraulic Institute, *Standards for Centrifugal, Rotary & Reciprocating Pumps* (2020).
