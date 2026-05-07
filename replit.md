# ALLL WPS Designer

Municipal drinking-water pump station hydraulic design tool — computes TDH and system H-Q curves using Darcy-Weisbach with Colebrook-White friction factor iteration.

## Run & Operate

**Backend (FastAPI):**
- `uvicorn backend.api.main:app --reload --port 8000` — run API server

**Frontend (Vite + React):**
- `cd frontend && npm run dev` — dev server at port 5173

**Tests:**
- `pytest backend/tests/test_hydraulics.py -v` — 31 unit tests

**No database required.** No environment variables required for local dev.

## Stack

- Backend: Python 3.11, FastAPI, Uvicorn, Pydantic v2, PyYAML
- Frontend: React 18, TypeScript, Vite, Tailwind CSS v4, Recharts, react-hook-form + zod, axios
- Tests: pytest (31 tests, all passing)

## Where things live

- `backend/engine/hydraulics.py` — core hydraulic functions (source of truth for calculation logic)
- `backend/api/schemas.py` — Pydantic v2 request/response models
- `backend/api/main.py` — FastAPI routes (`/api/v1/calculate`, `/api/v1/materials`, `/api/v1/pump-library`)
- `backend/data/pipe_materials.yaml` — roughness ε values per material
- `backend/data/pump_library.yaml` — example pump catalogue
- `frontend/src/pages/DesignPage.tsx` — main layout (under `src/` per Vite scaffold convention)
- `frontend/src/components/` — CalculationForm, ResultsPanel, SystemCurveChart
- `frontend/src/utils/api.ts` — typed axios client
- `sample_data/example_request.json` — realistic design scenario (DN150 / 36 m³/h)
- `sample_data/example_response.json` — expected API response for above request
- `sample_data/pump_library.yaml` — illustrative pump catalogue (mirrors `backend/data/pump_library.yaml`)
- `docs/README.md` — full technical documentation

## Architecture decisions

- Darcy-Weisbach chosen over Hazen-Williams: dimensional, applicable to all fluids and all regimes, required for municipal water standards (AWWA M11).
- Colebrook-White solved by fixed-point iteration on x = 1/√f (convergence 10⁻⁹, max 50 iterations); Swamee-Jain provides initial guess — never Newton-Raphson (avoids derivative complexity).
- Backend is a standalone Python FastAPI service, not the existing Node.js api-server; both can coexist in the monorepo.
- Vite proxy forwards `/api` → `http://localhost:8000` so the frontend never needs hardcoded backend URLs.
- All reference data (pipe roughness, pump library) loaded from YAML at startup with `@lru_cache`; no database needed for the design tool's read-only catalogue.

## Product

- Engineering input form: flow Q, upstream/downstream elevations, pipe L/D/material, multiple fitting K values (add/remove dynamically).
- Computed outputs: velocity, Reynolds number, Darcy friction factor, static head, friction loss, minor loss, TDH.
- System H-Q curve chart (8 points, 0 → 1.5×Q_design) with reference lines at design point.
- Pump library endpoint (3 example pumps with curve coefficients).
- Future modules stubbed: wet-well sizing, surge analysis, Excel/Word export.

## Gotchas

- Run backend BEFORE frontend — Vite proxy to port 8000 must have a live target on startup.
- Vite requires `server.allowedHosts: true` for Replit's reverse-proxy iframe.
- Roughness YAML keys (e.g. `ductile_iron`) must match exactly in API requests.
- The existing `artifacts/api-server` (Node.js/Express) is unrelated to the WPS Designer backend.

## Pointers

- `docs/README.md` — full API reference, equations, references
- See the `pnpm-workspace` skill for existing monorepo structure
