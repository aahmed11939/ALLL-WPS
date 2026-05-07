# ALLL WPS Designer

Municipal drinking-water pump station hydraulic design tool — computes TDH and system H-Q curves using Darcy-Weisbach with Colebrook-White friction factor iteration, with full US Customary ↔ SI unit support.

## Run & Operate

**Backend (FastAPI):**
- `uvicorn backend.api.main:app --reload --port 8000` — run API server

**Frontend (Vite + React):**
- `cd frontend && npm run dev` — dev server at port 5173

**Tests:**
- `pytest backend/tests/ -v` — 160 unit tests (hydraulics + domain models + unit conversions)

**No database required.** No environment variables required for local dev.

## Stack

- Backend: Python 3.11, FastAPI, Uvicorn, Pydantic v2, PyYAML
- Frontend: React 18, TypeScript, Vite, Tailwind CSS v4, Recharts, react-hook-form + zod, axios
- Tests: pytest (160 tests, all passing)

## Where things live

- `backend/engine/hydraulics.py` — core hydraulic functions (source of truth for calculation logic)
- `backend/engine/units.py` — NIST-exact unit conversion constants, `convert()`, `UnitValue`
- `backend/api/schemas.py` — Pydantic v2 request/response models (includes `DisplayValues`, `unit_system`)
- `backend/api/main.py` — FastAPI routes (`/api/v1/calculate`, `/api/v1/materials`, `/api/v1/pump-library`)
- `backend/data/pipe_materials.yaml` — roughness ε values per material
- `frontend/src/contexts/UnitSystemContext.tsx` — React context: `unitSystem`, `showBoth`, localStorage persistence
- `frontend/src/utils/units.ts` — frontend mirror of conversion constants + `displayValue()` helpers
- `frontend/src/pages/DesignPage.tsx` — main layout with SI/US toggle in header
- `frontend/src/components/` — CalculationForm (unit-aware), ResultsPanel (display units), SystemCurveChart (unit-aware axes)
- `frontend/src/utils/api.ts` — typed axios client (`UnitValue`, `DisplayValues`, `SystemCurvePoint`)
- `sample_data/example_request.json` — realistic design scenario (DN150 / 36 m³/h)

## Architecture decisions

- Darcy-Weisbach chosen over Hazen-Williams: dimensional, applicable to all fluids/regimes, required for AWWA M11.
- Colebrook-White solved by fixed-point iteration on x = 1/√f (convergence 10⁻⁹, max 50 iterations); Swamee-Jain initial guess.
- **Backend always receives and computes in SI.** The `unit_system` field in `CalculationRequest` only controls the `display` block in the response. Frontend converts form inputs to SI before posting.
- Conversion constants: 1 gpm = 0.22712470704 m³/h; 1 ft = 0.3048 m; 1 in = 25.4 mm; 1 psi = 6.894757 kPa; 1 hp = 0.74569987 kW.
- Vite proxy forwards `/api` → `http://localhost:8000`; all reference data loaded from YAML at startup with `@lru_cache`.

## Product

- Engineering input form: flow Q, upstream/downstream elevations, pipe L/D/material, multiple fitting K values — all fields adapt to the active unit system (SI or US Customary).
- SI ↔ US toggle in the page header; "Show SI too" checkbox for dual-unit display.
- Computed outputs: velocity, Reynolds number, Darcy friction factor, static head, friction loss, minor loss, TDH — all shown in the selected unit.
- System H-Q curve chart (8 points, 0 → 1.5×Q_design) with unit-aware axes, tooltip, and reference lines.
- Pump library endpoint (3 example pumps); wet-well sizing, surge analysis, Excel/Word export stubbed for future modules.

## Gotchas

- Run backend BEFORE frontend — Vite proxy to port 8000 must have a live target on startup.
- Vite requires `server.allowedHosts: true` for Replit's reverse-proxy iframe.
- Roughness YAML keys (e.g. `ductile_iron`) must match exactly in API requests.
- The existing `artifacts/api-server` (Node.js/Express) is unrelated to the WPS Designer backend.

## Pointers

- `docs/README.md` — full API reference, equations, references
- `backend/tests/test_units.py` — 45 unit conversion tests covering all NIST constants and round-trips
