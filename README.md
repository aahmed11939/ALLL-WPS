# ALLL WPS Designer

Engineering-grade hydraulic design tool for municipal drinking-water pump stations.

## Quick Start

### 1. Backend (Python FastAPI)

```bash
pip install fastapi "uvicorn[standard]" pyyaml pydantic pytest httpx openpyxl python-docx
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
pytest backend/tests/ -v
# 23/23 pass
```

---

## Typical Potable Station Workflow

Work through the 10 wizard steps in order. Each step persists state automatically — you can revisit any step at any time. The sticky **LIVE RESULTS** bar at the bottom of every screen shows live TDH, velocity, duty point, NPSH margin, and surge extremes as you work.

<!-- screenshot: step-1.png -->
### Step 1 — Project Setup
- Enter project name, client, job number, engineer, date, and design notes.
- Select unit system: **SI** (m, kPa) or **US** (ft, psi) with the header toggle. Enable **Both units** to show all values dual-labelled.
- Set the **design flow Q** (m³/h) — this drives all downstream auto-fill.

### Step 2 — System Nodes
- Define upstream (source) and downstream (delivery) node elevations in metres above datum.
- Set fluid properties (water temperature, density). These propagate to surge analysis.
- The static head = downstream elevation − upstream elevation.

### Step 3 — Suction Pipeline
- Add one or more pipe segments (L, D, material/roughness ε, PN class).
- Add fittings as minor losses (select from library or enter K directly).
- The suction pipe feeds directly into Step 9 (Suction MOC) and Step 10 (Engineering Checks).

### Step 4 — Wet Well Sizing
- Enter sump geometry, inflow hydrograph, and pump cycling criteria.
- Computes effective volume, cycles per hour (max 6/hr AWWA standard), LWL/HWL levels.

### Step 5 — Pump Selection & Curves
- Select a pump from the library or enter the H-Q curve manually.
- Enter efficiency (η), power, and NPSHr curves.
- Click **Compute Pump** to find the duty operating point Q*, H* against the system curve.

<!-- screenshot: step-6.png -->
### Step 6 — Discharge Pipeline
- Mirror of Step 3 for the discharge side: segments and fittings.
- Used by hydraulic compute and Mode B MOC (discharge surge).

<!-- screenshot: step-7.png -->
### Step 7 — Hydraulic Results
- Results auto-refresh (300 ms debounce) whenever design-flow or pipeline inputs change.
- Click **Compute Hydraulics** at any time to force a full recalculation.
- Outputs: TDH, velocity, Re, Darcy-f, system H-Q curve, minor-loss breakdown.

<!-- screenshot: step-8.png -->
### Step 8 — System Curve & Operating Point
- System curve (from Step 7) overlaid with the pump H-Q curve (from Step 5).
- Intersection = duty operating point Q*, H*. Hover the chart for engineering cursor readouts.

### Step 9 — Water Hammer & Surge

This step has three sub-tabs:

| Sub-tab | Method | Use when |
|---|---|---|
| **Mode A — Quick** | Joukowsky ΔH = a·ΔV/g | Rapid screening, single pipeline |
| **Mode B — MOC** | Method of Characteristics (PDE) | Full transient, multi-BC |
| **Suction MOC** | MOC + NPSHa(t) | Pump cavitation risk during trip |

**Mode A — Wave Speed Calculator**
1. Select pipe material, enter D and wall thickness e.
2. Read off wave speed a (m/s) — feeds into Modes B and Suction.
3. Joukowsky surge: ΔH = a·V₀/g (rapid closure) or enter t_close for partial credit.

**Mode B — MOC Full Analysis**
1. Choose pipeline (suction or discharge).
2. Set boundary conditions A (upstream) and B (downstream) — pump trip, reservoir, or valve closure.
3. Drag the **Observation Point** sliders to place time-history monitors at key locations.
4. Click **Run Mode B MOC** — computes N-reach finite-difference MOC, Courant = 1.
5. Results: pressure envelope (H_max, H_min vs x), time histories at obs points, pipe rating check (FoS = PN/P_max).
6. Vapour-pressure reference line (amber dashed) and 0 m atmospheric line (grey dashed) mark cavitation and vacuum thresholds.
7. Collapsible **Solver assumption notes** banner appears after each run with per-run advisories.
8. Use **What-If Surge Protection** to compare air vessel, surge tank, PRV, or vacuum relief against baseline.

**Suction MOC — NPSHa Transient**
1. Set wave speed, boundary conditions (wet well → pump trip).
2. Place obs points along the suction pipe using the sliders.
3. Click **Run Suction MOC** — solves NPSHa(t) = H_suction(t) − h_vap(T).
4. Results: NPSHa time history, min NPSHa, margin vs NPSHr, cavitation risk duration.

<!-- screenshot: step-10.png -->
### Step 10 — Engineering Checks & Export
- Automated compliance checklist (AWWA M11, HI 9.6.1, Ten States Standards, ISO 9906).
- Severity: Critical (must resolve) / Warning (review) / Info.
- Export options:
  - **JSON** (.wps.json) — full project state, reloadable
  - **Text** (.txt) — engineering checks report, plain text
  - **Excel** (.xlsx) — 11-sheet calculation workbook (animated progress indicator)
  - **Word** (.docx) — stamped engineering design memorandum (animated progress indicator)

---

## Engineering Methods

| Component | Method | Reference |
|---|---|---|
| Friction loss | Darcy-Weisbach | AWWA M11 |
| Friction factor | Colebrook-White iterative (ε 10⁻⁹) | Moody (1944) |
| Minor losses | ΣK·V²/(2g) | Idelchik (2008) |
| Surge — quick | Joukowsky ΔH = a·ΔV/g | Joukowsky (1900) |
| Surge — full | Method of Characteristics (MOC), Courant = 1 | Wylie & Streeter (1993) |
| NPSHa transient | MOC + h_vap(T) from Antoine equation | HI 9.6.1-2012 |
| Wet well cycling | AWWA M44 / Ten States Standards | — |
| Wave speed | Halliwell formula (thin-wall / thick-wall) | Chaudhry (2014) |

## Glossary of Key Terms

| Term | Definition |
|---|---|
| **TDH** | Total Dynamic Head — sum of static + friction + minor head losses |
| **NPSHa** | Net Positive Suction Head available: H_abs − h_vap |
| **NPSHr** | Net Positive Suction Head required (from pump curve, 3% head-drop criterion) |
| **ε** | Absolute pipe roughness (m) — physical height of wall irregularities |
| **K** | Minor-loss coefficient — h_m = K·V²/(2g) |
| **a** | Wave-propagation celerity (m/s) — speed of pressure wave in pipe |
| **T_char** | Characteristic time = 2L/a — time for wave to travel pipe and return |
| **h_vap** | Vapour pressure head = P_vap(T)/(ρg) — cavitation / column-separation threshold |
| **FoS** | Factor of Safety = PN / P_max_transient (≥ 1.25 required) |

## Project Structure

```
backend/
  api/main.py           FastAPI app + all route registrations
  engine/
    hydraulics.py       Darcy-Weisbach + Colebrook-White
    surge.py            Joukowsky quick analysis
    moc.py              Full MOC solver (multi-segment, multi-BC)
    suction_moc.py      Suction transient + NPSHa(t)
    wetwell.py          Clear-well cycling analysis
    pump.py             Pump curve interpolation + operating point
  export/
    excel_export.py     11-sheet openpyxl workbook
    word_export.py      python-docx design memorandum
  tests/
    test_hydraulics.py  23 pytest tests (all passing)

frontend/src/
  pages/WizardPage.tsx         Main wizard shell + routing
  components/wizard/           One component per step
    StepWaterHammer.tsx        Mode A + wave speed calculator
    StepWaterHammerModeB.tsx   Full MOC (Mode B)
    StepSuctionSurgeMOC.tsx    Suction NPSHa transient
    StepExports.tsx            Summary + export buttons
  components/
    ResultsStrip.tsx           Sticky live-results bottom bar
    TermTip.tsx                Engineering glossary tooltips
    ChartErrorBoundary.tsx     Chart fault isolation
  contexts/
    ProjectContext.tsx         Global project state (useReducer)
    UnitSystemContext.tsx      SI ↔ US unit toggle (persisted)
  hooks/
    useDebounce.ts             300 ms debounce hook
  utils/
    api.ts                     Axios API client + all TypeScript types
    units.ts                   Unit conversion utilities
    engineeringChecks.ts       Client-side compliance rules
```
# ALLL-WPS
