# ALLL WPS Designer

Engineering-grade hydraulic design tool for municipal drinking-water pump stations.

## Quick Start

### 1. Backend (Python FastAPI)

```bash
pip install fastapi "uvicorn[standard]" pyyaml pydantic pytest httpx
uvicorn backend.api.main:app --reload --port 8000
```

### 2. Frontend (React + TypeScript + Vite)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### 3. Tests

```bash
pytest backend/tests/test_hydraulics.py -v
```

## Features (v0.1 — Vertical Slice)

- Input form: flow Q, elevations, pipe geometry (L, D, material/roughness), multiple fitting K values
- Computed outputs: pipe velocity, Reynolds number, friction factor (Colebrook-White), static head, friction loss, minor loss, TDH
- System H-Q curve: 8 points from Q=0 to 1.5×Q_design (Recharts line chart with reference lines)
- Pump library endpoint with example pumps

## Engineering Method

| Component | Method |
|---|---|
| Friction loss | Darcy-Weisbach |
| Friction factor | Colebrook-White (iterative, convergence 10⁻⁹) |
| Initial f guess | Swamee-Jain explicit approximation |
| Minor losses | ΣK·V²/(2g) |
| Reference | AWWA M11, Hydraulic Institute Standards |

## Future Modules (stubbed)

- `backend/engine/wetwell.py` — Wet-well sizing (AWWA M44 / Ten States Standards)
- `backend/engine/surge.py` — Surge / water-hammer analysis (Joukowsky)
- `backend/export/excel_export.py` — Excel calculation report
- `backend/export/word_export.py` — Word design calculation report

## See Also

[Full technical documentation →](docs/README.md)
