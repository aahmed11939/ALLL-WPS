import puppeteer from "puppeteer-core";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const logoDataUrl = "data:image/png;base64," +
  readFileSync(join(__dirname, "WPS_Logo_1778892831735.png")).toString("base64");

/**
 * Resolve the Chromium/Chrome executable path.
 * Priority order:
 *   1. CHROMIUM_PATH env var  (set by CI or developer)
 *   2. `which` shell lookup   (works on Linux, macOS, Nix-based environments)
 *   3. Well-known fixed paths (fallback for non-PATH CI environments)
 */
function findChromium() {
  // 1. Explicit override via environment variable
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  // 2. Ask the shell — works on Linux, macOS, and Nix-based environments
  const shellNames = ["chromium-browser", "chromium", "google-chrome", "google-chrome-stable"];
  for (const name of shellNames) {
    try {
      const p = execSync(`which ${name}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      if (p && existsSync(p)) return p;
    } catch (_) {}
  }

  // 3. Well-known fixed paths (fallback for CI / non-PATH environments)
  const candidates = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/local/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    "Chromium not found. Set the CHROMIUM_PATH environment variable to the " +
    "full path of your Chromium or Chrome executable and re-run this script.\n" +
    "Example: CHROMIUM_PATH=/usr/bin/google-chrome node scripts/generate-user-guide.mjs"
  );
}

const CHROMIUM_PATH = findChromium();
console.log(`Using Chromium at: ${CHROMIUM_PATH}`);

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>ALLL WPS Designer – User Guide</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

  :root {
    --teal:   #0f766e;
    --teal-l: #ccfbf1;
    --teal-m: #5eead4;
    --slate:  #0f172a;
    --muted:  #64748b;
    --border: #e2e8f0;
    --bg:     #f8fafc;
    --white:  #ffffff;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.6;
    color: var(--slate);
    background: var(--white);
  }

  /* ── Cover page ── */
  .cover {
    height: 100vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    background: linear-gradient(135deg, #0f172a 0%, #134e4a 100%);
    color: white;
    text-align: center;
    padding: 60px;
    page-break-after: always;
  }
  .cover-logo-area {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 40px;
  }
  .cover-logo-circle {
    width: 64px;
    height: 64px;
    background: var(--teal-m);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 700;
    color: #0f172a;
  }
  .cover-brand { font-size: 22pt; font-weight: 700; letter-spacing: -0.5px; }
  .cover-sub   { font-size: 10pt; color: var(--teal-m); font-family: 'JetBrains Mono', monospace; margin-top: 2px; }
  .cover h1    { font-size: 34pt; font-weight: 700; letter-spacing: -1px; margin-bottom: 16px; }
  .cover p     { font-size: 13pt; color: #94a3b8; max-width: 500px; line-height: 1.7; }
  .cover-meta  {
    margin-top: 60px;
    padding: 20px 40px;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 12px;
    background: rgba(255,255,255,0.05);
    font-size: 9pt;
    color: #94a3b8;
    font-family: 'JetBrains Mono', monospace;
  }
  .cover-meta span { color: var(--teal-m); font-weight: 600; }

  /* ── TOC page ── */
  .toc {
    padding: 50px 70px;
    page-break-after: always;
  }
  .toc h2 {
    font-size: 22pt;
    font-weight: 700;
    color: var(--slate);
    margin-bottom: 30px;
    padding-bottom: 12px;
    border-bottom: 2px solid var(--teal);
  }
  .toc-item {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 0;
    border-bottom: 1px dotted var(--border);
  }
  .toc-badge {
    font-size: 7pt;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    background: var(--teal);
    color: white;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    min-width: 50px;
    text-align: center;
  }
  .toc-label { font-size: 10.5pt; font-weight: 600; color: var(--slate); flex: 1; }
  .toc-dots  { flex: 1; border-bottom: 1px dotted #cbd5e1; margin: 0 8px; }

  /* ── General page layout ── */
  .page {
    padding: 44px 60px;
    page-break-after: always;
    position: relative;
  }
  .page:last-child { page-break-after: avoid; }

  /* Page header strip */
  .page-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 28px;
    padding-bottom: 14px;
    border-bottom: 2px solid var(--border);
  }
  .step-badge {
    background: var(--teal);
    color: white;
    font-size: 9pt;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    padding: 4px 10px;
    border-radius: 6px;
    white-space: nowrap;
  }
  .page-title {
    font-size: 17pt;
    font-weight: 700;
    color: var(--slate);
  }

  /* Section headings */
  h3 {
    font-size: 11pt;
    font-weight: 700;
    color: var(--teal);
    margin: 22px 0 8px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  h4 {
    font-size: 10pt;
    font-weight: 700;
    color: var(--slate);
    margin: 14px 0 6px;
  }

  p { margin-bottom: 8px; }
  ul, ol { padding-left: 20px; margin-bottom: 8px; }
  li { margin-bottom: 4px; }

  /* Equation box */
  .eq-box {
    background: #f0fdf4;
    border: 1px solid #86efac;
    border-left: 4px solid var(--teal);
    border-radius: 8px;
    padding: 14px 18px;
    margin: 12px 0;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5pt;
  }
  .eq-box .eq-label {
    font-size: 8pt;
    font-weight: 600;
    color: var(--teal);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    font-family: 'Inter', Arial, sans-serif;
  }
  .eq-main {
    font-size: 12pt;
    font-weight: 500;
    color: #064e3b;
    margin-bottom: 8px;
  }
  .eq-vars {
    font-size: 8.5pt;
    color: var(--muted);
    font-family: 'Inter', Arial, sans-serif;
    line-height: 1.7;
  }

  /* Info card */
  .card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
    margin: 10px 0;
  }
  .card p { margin-bottom: 4px; }

  /* Reference tag */
  .ref {
    display: inline-block;
    background: #eff6ff;
    border: 1px solid #bfdbfe;
    color: #1d4ed8;
    font-size: 7.5pt;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', monospace;
    margin: 2px 2px;
  }

  /* Note / warning boxes */
  .note {
    background: #fefce8;
    border: 1px solid #fde047;
    border-left: 4px solid #ca8a04;
    border-radius: 6px;
    padding: 10px 14px;
    margin: 10px 0;
    font-size: 9pt;
  }
  .note strong { color: #92400e; }
  .tip {
    background: #f0f9ff;
    border: 1px solid #bae6fd;
    border-left: 4px solid #0284c7;
    border-radius: 6px;
    padding: 10px 14px;
    margin: 10px 0;
    font-size: 9pt;
  }

  /* Field table */
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0;
    font-size: 9pt;
  }
  th {
    background: var(--teal);
    color: white;
    font-weight: 600;
    padding: 8px 10px;
    text-align: left;
    font-size: 8.5pt;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  td {
    padding: 7px 10px;
    border-bottom: 1px solid var(--border);
    vertical-align: top;
  }
  tr:nth-child(even) td { background: var(--bg); }

  /* Two-column grid */
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin: 10px 0;
  }

  code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 8.5pt;
    background: #f1f5f9;
    padding: 1px 5px;
    border-radius: 3px;
    color: #0f766e;
  }

  /* Running footer */
  @page {
    size: A4;
    margin: 16mm 0 16mm 0;
    @bottom-center {
      content: "ALLL WPS Designer — User Guide | Page " counter(page);
      font-size: 8pt;
      color: #94a3b8;
      font-family: 'Inter', Arial, sans-serif;
    }
  }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════════════
     COVER PAGE
═══════════════════════════════════════════════════════ -->
<div class="cover">
  <div class="cover-logo-area">
    <img src="${logoDataUrl}" style="height:160px;width:auto;" alt="ALLL WPS Designer"/>
  </div>
  <h1>User Guide</h1>
  <p>A complete engineering reference for all 11 wizard steps — calculations, equations, standards, and best practice for drinking-water pump station design.</p>
  <div class="cover-meta">
    Document version <span>1.0</span> &nbsp;·&nbsp; May 2026 &nbsp;·&nbsp; For use with ALLL WPS Designer
  </div>
</div>

<!-- ═══════════════════════════════════════════════════════
     TABLE OF CONTENTS
═══════════════════════════════════════════════════════ -->
<div class="toc">
  <h2>Table of Contents</h2>

  <div class="toc-item">
    <span class="toc-badge">Step 1</span>
    <span class="toc-label">Project Setup</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 2</span>
    <span class="toc-label">System Nodes — Static Head & Boundary Pressures</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 3</span>
    <span class="toc-label">Suction Pipeline — Friction &amp; Minor Losses</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 4</span>
    <span class="toc-label">Clear Well Sizing</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 5</span>
    <span class="toc-label">Pump Selection &amp; Curves</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 6</span>
    <span class="toc-label">Discharge Pipeline — Friction &amp; Minor Losses</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 7</span>
    <span class="toc-label">Hydraulic Results — TDH, Velocity &amp; NPSH</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 8</span>
    <span class="toc-label">System Curve &amp; Operating Point</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 9</span>
    <span class="toc-label">Water Hammer &amp; Surge Analysis</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 10</span>
    <span class="toc-label">Engineering Checks</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item">
    <span class="toc-badge">Step 11</span>
    <span class="toc-label">Summary &amp; Export</span>
    <span class="toc-dots"></span>
  </div>
  <div class="toc-item" style="margin-top:16px; border-top: 1px solid var(--border); padding-top:10px;">
    <span class="toc-badge" style="background:#475569;">App.</span>
    <span class="toc-label">Quick-Reference: Equations &amp; Standards</span>
    <span class="toc-dots"></span>
  </div>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 1 — PROJECT SETUP
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 1</span>
    <span class="page-title">Project Setup</span>
  </div>

  <h3>Purpose</h3>
  <p>Step 1 captures the administrative and configuration information that applies to the entire design. All subsequent calculations and exported reports use this data for traceability. Selecting the correct unit system here ensures consistent presentation throughout every step.</p>

  <h3>Input Fields</h3>
  <table>
    <tr><th>Field</th><th>Required</th><th>Description</th></tr>
    <tr><td><strong>Project Name</strong></td><td>Yes</td><td>A unique, descriptive title used in all exports and the project dashboard (e.g., "Riverside PS Upgrade"). Maximum 120 characters.</td></tr>
    <tr><td><strong>Client</strong></td><td>No</td><td>Name of the water authority, municipality, or owner for which the design is prepared.</td></tr>
    <tr><td><strong>Job Number</strong></td><td>No</td><td>Internal reference number (e.g., WPS-2024-001).</td></tr>
    <tr><td><strong>Date</strong></td><td>No</td><td>Design date; defaults to today. Appears on all exported reports.</td></tr>
    <tr><td><strong>Engineer</strong></td><td>No</td><td>Engineer of record name, credential (e.g., "J. Smith, P.E.").</td></tr>
    <tr><td><strong>Notes</strong></td><td>No</td><td>Free-text area for design intent, applicable standards, or scope limitations.</td></tr>
  </table>

  <h3>Unit System</h3>
  <div class="grid2">
    <div class="card">
      <h4>SI (metric) — default</h4>
      <p>Flow: m³/h · Head: m · Diameter: mm · Pressure: kPa</p>
      <p style="font-size:8.5pt; color:var(--muted);">Recommended for international projects and new designs.</p>
    </div>
    <div class="card">
      <h4>US Customary</h4>
      <p>Flow: gpm · Head: ft · Diameter: in · Pressure: psi</p>
      <p style="font-size:8.5pt; color:var(--muted);">Use when the project specification is US-standard.</p>
    </div>
  </div>
  <p>Enable <strong>Show both units</strong> to display SI and US values side-by-side in all result panels — useful for multi-disciplinary teams.</p>

  <h3>Optional Modules</h3>
  <p><strong>Include Surge Analysis</strong> — When enabled, a dedicated Water Hammer step (Step 9) is added to the wizard. Surge analysis uses the Joukowsky equation for rapid transient checks (Mode A) and a Method of Characteristics (MOC) numerical solver for detailed wave propagation (Mode B). Uncheck this if the design includes only gravity mains or if surge mitigation has been addressed by a specialist separately.</p>

  <h3>Design Flow Rate (Q design)</h3>
  <p>The single design-point flow rate <code>Q</code> used throughout all hydraulic calculations. Enter this value in the unit system selected above; the application converts internally and always stores SI values (m³/h) for calculations.</p>

  <div class="tip">
    <strong>Tip:</strong> The design flow is the maximum continuous duty flow, not the instantaneous peak. For potable water stations, this is typically the maximum day demand (MDD) or the peak hour demand (PHD) as specified in the hydraulic brief.
  </div>

  <h3>Validation</h3>
  <ul>
    <li>Project Name must not be empty before advancing to Step 2.</li>
    <li>Design flow must be a positive number greater than zero.</li>
  </ul>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 2 — SYSTEM NODES
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 2</span>
    <span class="page-title">System Nodes</span>
  </div>

  <h3>Purpose</h3>
  <p>System nodes define the hydraulic boundary conditions at the suction source (upstream) and the delivery point (downstream). The elevation difference drives the static head component of Total Dynamic Head (TDH), while the boundary pressures represent residual pressure requirements that must be maintained.</p>

  <h3>Governing Equation — Bernoulli Energy Equation</h3>
  <div class="eq-box">
    <div class="eq-label">Bernoulli Energy Equation (simplified, pump station form)</div>
    <div class="eq-main">TDH = (z₂ − z₁) + (p₂ − p₁)/(ρg) + h_f,total + h_m,total</div>
    <div class="eq-vars">
      z₁ = upstream (suction) elevation [m]<br/>
      z₂ = downstream (delivery) elevation [m]<br/>
      p₁ = upstream boundary pressure [Pa]<br/>
      p₂ = downstream residual pressure [Pa]<br/>
      ρ  = water density ≈ 998.2 kg/m³ at 20 °C<br/>
      g  = gravitational acceleration = 9.81 m/s²<br/>
      h_f = pipe friction head loss [m]<br/>
      h_m = minor head loss [m]
    </div>
  </div>

  <p>The static component is calculated immediately as you type:</p>
  <div class="eq-box">
    <div class="eq-label">Static Head</div>
    <div class="eq-main">H_static = z₂ − z₁  [m]</div>
    <div class="eq-vars">Positive value means pumping uphill (normal). Negative means pumping downhill (gravity-assisted).</div>
  </div>

  <h3>Input Fields</h3>
  <table>
    <tr><th>Node</th><th>Field</th><th>Description</th></tr>
    <tr><td>Upstream (US)</td><td>Elevation</td><td>Hydraulic datum elevation at the wet well, reservoir, or suction source (m or ft above datum). Use the same datum throughout the project.</td></tr>
    <tr><td>Upstream (US)</td><td>Pressure</td><td>Residual pressure at the upstream boundary. For a free-surface reservoir or wet well open to atmosphere, enter 0 kPa (0 psi).</td></tr>
    <tr><td>Downstream (DS)</td><td>Elevation</td><td>Elevation at the delivery point — typically the top of the receiving reservoir, overhead tank, or zone entry point.</td></tr>
    <tr><td>Downstream (DS)</td><td>Pressure</td><td>Minimum residual pressure required at the delivery point (e.g., 140 kPa / 20 psi for a distribution zone entry).</td></tr>
  </table>

  <h3>Validation</h3>
  <ul>
    <li>Both elevation fields must contain valid numbers before advancing.</li>
    <li>Negative static head is permitted (pumping downhill to pressurised zone).</li>
    <li>Boundary pressures default to 0 and are optional.</li>
  </ul>

  <div class="note">
    <strong>Note:</strong> Use a consistent elevation datum (e.g., AHD, MSL, or local) across all nodes and pipeline profiles. Mixing datums is a common source of error that this tool cannot detect automatically.
  </div>

  <p>
    <span class="ref">Ref: Bernoulli (1738)</span>
    <span class="ref">Ref: AWWA M11 §2</span>
    <span class="ref">Ref: Pump Handbook, Karassik et al., Ch. 8</span>
  </p>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 3 — SUCTION PIPELINE
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 3</span>
    <span class="page-title">Suction Pipeline</span>
  </div>

  <h3>Purpose</h3>
  <p>Define the pipe geometry, material, and fittings on the suction (inlet) side of the pump. The application calculates Darcy-Weisbach friction head loss and K-coefficient minor losses for each segment and aggregates them into the suction head loss used in TDH assembly.</p>

  <h3>Darcy-Weisbach Friction Loss</h3>
  <div class="eq-box">
    <div class="eq-label">Darcy-Weisbach Equation</div>
    <div class="eq-main">h_f = f · (L/D) · V²/(2g)</div>
    <div class="eq-vars">
      h_f = head loss due to friction [m]<br/>
      f   = Darcy-Weisbach friction factor (dimensionless) — computed by Colebrook-White iteration<br/>
      L   = pipe length [m]<br/>
      D   = internal pipe diameter [m]<br/>
      V   = mean flow velocity = Q / (π D² / 4)  [m/s]<br/>
      g   = 9.81 m/s²
    </div>
  </div>

  <h3>Colebrook-White Friction Factor</h3>
  <div class="eq-box">
    <div class="eq-label">Colebrook-White Equation (implicit, solved iteratively)</div>
    <div class="eq-main">1/√f = −2.0 log₁₀(ε/(3.7D) + 2.51/(Re·√f))</div>
    <div class="eq-vars">
      ε   = pipe roughness [m] — material-dependent (see table below)<br/>
      D   = diameter [m]<br/>
      Re  = Reynolds number = ρ·V·D/μ = V·D/ν<br/>
      ν   = kinematic viscosity ≈ 1.004 × 10⁻⁶ m²/s at 20 °C<br/>
      The Swamee-Jain approximation is used as the initial estimate; Colebrook is iterated to convergence (&lt; 1 × 10⁻⁶ tolerance).
    </div>
  </div>

  <h4>Default Roughness Values (ε)</h4>
  <table>
    <tr><th>Material</th><th>ε (mm)</th><th>Notes</th></tr>
    <tr><td>PVC / uPVC</td><td>0.0015</td><td>New; smooth interior</td></tr>
    <tr><td>HDPE PE100</td><td>0.007</td><td>New; flexible, fused joints</td></tr>
    <tr><td>Ductile Iron (DICL)</td><td>0.12</td><td>New, cement-lined</td></tr>
    <tr><td>Cast Iron (unlined)</td><td>0.26</td><td>Old; may increase with age</td></tr>
    <tr><td>Steel (welded)</td><td>0.046</td><td>New; commercial finish</td></tr>
    <tr><td>Galvanised Iron</td><td>0.15</td><td></td></tr>
    <tr><td>Fiberglass / GRP</td><td>0.003</td><td>Smooth interior</td></tr>
    <tr><td>Concrete / RCCP</td><td>0.30–3.0</td><td>Varies with finish; designer to confirm</td></tr>
    <tr><td>Asbestos Cement</td><td>0.03</td><td>Old stock may increase</td></tr>
    <tr><td>Copper</td><td>0.0015</td><td>Drawn, new</td></tr>
  </table>

  <h3>Minor Losses (K-Coefficient Method)</h3>
  <div class="eq-box">
    <div class="eq-label">Minor Head Loss — K-Coefficient</div>
    <div class="eq-main">h_m = ΣK · V²/(2g)</div>
    <div class="eq-vars">
      K   = fitting loss coefficient (dimensionless) — select from the built-in fittings library<br/>
      V   = velocity at the fitting location [m/s]<br/>
      ΣK  = sum of all fitting K values in the segment
    </div>
  </div>

  <p>Common K-values (representative; actual values depend on manufacturer and installation):</p>
  <div class="grid2">
    <div class="card" style="font-size:9pt;">
      <strong>Gate valve (fully open)</strong>: K ≈ 0.1<br/>
      <strong>Globe valve (fully open)</strong>: K ≈ 10<br/>
      <strong>Ball valve (fully open)</strong>: K ≈ 0.05<br/>
      <strong>Butterfly valve</strong>: K ≈ 0.3–1.5<br/>
      <strong>Check valve (swing)</strong>: K ≈ 2.0<br/>
    </div>
    <div class="card" style="font-size:9pt;">
      <strong>90° elbow (std)</strong>: K ≈ 0.9<br/>
      <strong>45° elbow (std)</strong>: K ≈ 0.4<br/>
      <strong>Tee (branch flow)</strong>: K ≈ 1.8<br/>
      <strong>Tee (run flow)</strong>: K ≈ 0.4<br/>
      <strong>Reducer (gradual)</strong>: K ≈ 0.05–0.1<br/>
    </div>
  </div>

  <h3>Segment Management</h3>
  <ul>
    <li>Add multiple segments to model pipes of different diameters or materials in series.</li>
    <li>Each segment requires: material, nominal diameter, and length.</li>
    <li>Use the <strong>Accessories Picker</strong> within each segment to add valves, elbows, and other fittings.</li>
    <li>Segments can be reordered using the up/down arrows.</li>
  </ul>

  <h3>Validation</h3>
  <ul>
    <li>At least one segment with diameter &gt; 0 and length &gt; 0 is required.</li>
    <li>Velocity in each segment is computed automatically and flagged if it exceeds AWWA M11 guidance (3.0 m/s for suction).</li>
  </ul>

  <p>
    <span class="ref">Ref: Darcy (1857) / Weisbach (1845)</span>
    <span class="ref">Ref: Colebrook (1939)</span>
    <span class="ref">Ref: Moody (1944)</span>
    <span class="ref">Ref: AWWA M11 §4</span>
  </p>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 4 — CLEAR WELL SIZING
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 4</span>
    <span class="page-title">Clear Well Sizing</span>
  </div>

  <h3>Purpose</h3>
  <p>The clear well (storage tank) provides the usable storage volume between the low water level (LWL) and the high water level (HWL). It must be large enough to satisfy minimum detention time requirements for disinfectant contact, limit pump starts per hour (cycling rate), and meet fire reserve and emergency storage obligations.</p>

  <h3>Governing Calculations</h3>

  <h4>Useful Storage Volume</h4>
  <div class="eq-box">
    <div class="eq-label">Cylindrical Tank</div>
    <div class="eq-main">V_useful = π · (D/2)² · (HWL − LWL)</div>
    <div class="eq-vars">
      D   = internal diameter [m]<br/>
      HWL = high water level elevation [m]<br/>
      LWL = low water level elevation [m]
    </div>
  </div>
  <div class="eq-box">
    <div class="eq-label">Rectangular Tank</div>
    <div class="eq-main">V_useful = L · W · (HWL − LWL)</div>
    <div class="eq-vars">
      L = internal length [m], W = internal width [m]
    </div>
  </div>

  <h4>Pump Cycling (Maximum Starts per Hour)</h4>
  <div class="eq-box">
    <div class="eq-label">Pump Cycling — Maximum Starts per Hour</div>
    <div class="eq-main">N_starts = Q_pump / (4 · V_useful)  [cycles/h]</div>
    <div class="eq-vars">
      Q_pump   = pump duty flow [m³/h]<br/>
      V_useful = useful volume [m³]<br/>
      This formula gives the theoretical maximum starts per hour at the worst-case flow ratio.<br/>
      AWWA M32 and Ten States Standards recommend ≤ 6 starts/hour for most centrifugal pumps.
    </div>
  </div>

  <h4>Detention Time</h4>
  <div class="eq-box">
    <div class="eq-label">Hydraulic Detention Time (HRT)</div>
    <div class="eq-main">t_det = V_total / Q_design  [h]</div>
    <div class="eq-vars">
      V_total  = total tank volume (including dead storage) [m³]<br/>
      Q_design = design throughput flow rate [m³/h]<br/>
      Minimum HRT for CT compliance: typically ≥ 0.5 h (30 min) per chlorine contact time requirements — verify with the applicable disinfection standard.
    </div>
  </div>

  <h3>Input Fields</h3>
  <table>
    <tr><th>Field</th><th>Description</th></tr>
    <tr><td>Tank geometry</td><td>Cylindrical or rectangular; affects volume formula used.</td></tr>
    <tr><td>Internal dimensions</td><td>Diameter (cylindrical) or Length × Width (rectangular), plus total depth.</td></tr>
    <tr><td>LWL / HWL</td><td>Low and High Water Levels as elevations or depths from base. HWL − LWL is the useful (operating) depth.</td></tr>
    <tr><td>Pump duty flow</td><td>Flow pumped into or out of the tank. Used to calculate cycling rate.</td></tr>
    <tr><td>Fill / draw flow</td><td>The net inflow during filling and outflow during drawdown cycles.</td></tr>
  </table>

  <h3>What the Tool Reports</h3>
  <ul>
    <li><strong>Useful volume</strong> [m³] — storage between LWL and HWL.</li>
    <li><strong>Total volume</strong> [m³] — full capacity (base to top).</li>
    <li><strong>Starts per hour</strong> — cycling rate; flagged if &gt; 6/h.</li>
    <li><strong>Detention time</strong> — flagged if &lt; 30 minutes.</li>
    <li><strong>Volume-elevation table</strong> — tabulated volume vs. water level for operational reference.</li>
  </ul>

  <p>
    <span class="ref">Ref: AWWA M11 — Steel Pipe Design</span>
    <span class="ref">Ref: AWWA M32 — Distribution System Requirements for Fire Protection</span>
    <span class="ref">Ref: Ten States Standards (Recommended Standards for Water Works), §§ 5.3, 5.4</span>
  </p>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 5 — PUMP SELECTION & CURVES
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 5</span>
    <span class="page-title">Pump Selection &amp; Curves</span>
  </div>

  <h3>Purpose</h3>
  <p>Select the pump type, staging configuration, and variable-frequency drive (VFD) option. Enter the manufacturer's H-Q (head-flow), efficiency, and power curves so the tool can locate the operating point where the system curve intersects the pump curve.</p>

  <h3>Part A — Pump Type &amp; Configuration</h3>
  <table>
    <tr><th>Field</th><th>Description</th></tr>
    <tr><td>Pump type</td><td>Centrifugal (end-suction, split-case, vertical turbine, submersible) or positive displacement. Most drinking-water stations use centrifugal.</td></tr>
    <tr><td>Number of duty pumps</td><td>Pumps operating simultaneously in parallel at design flow.</td></tr>
    <tr><td>Number of standby pumps</td><td>Redundant units on hot standby. AWWA and Ten States Standards typically require N+1 redundancy for critical supply.</td></tr>
    <tr><td>VFD enabled</td><td>When checked, affinity-law scaling controls are shown. VFD allows speed reduction to match reduced demand flows.</td></tr>
  </table>

  <h3>Part B — H-Q Curve Entry</h3>
  <p>Enter the pump manufacturer's head-flow data as a table of (Q, H) pairs — minimum three points are required for reliable interpolation. Include at least the shut-off point (Q = 0) and the runout (maximum flow) point.</p>

  <div class="note">
    <strong>Important:</strong> H-Q curves are for a single pump at rated speed. If multiple duty pumps are specified, the application automatically constructs the parallel-pump composite curve (flow adds at equal head).
  </div>

  <h3>Affinity Laws (VFD Operation)</h3>
  <p>When a Variable Frequency Drive is in use, the pump operating point moves along the affinity law parabola as speed changes:</p>
  <div class="eq-box">
    <div class="eq-label">Affinity Laws — Centrifugal Pumps</div>
    <div class="eq-main">Q₂/Q₁ = n₂/n₁</div>
    <div class="eq-main">H₂/H₁ = (n₂/n₁)²</div>
    <div class="eq-main">P₂/P₁ = (n₂/n₁)³</div>
    <div class="eq-vars">
      n₁ = rated speed [rpm], n₂ = reduced speed [rpm]<br/>
      Q = flow rate [m³/h], H = head [m], P = shaft power [kW]<br/>
      These laws apply exactly for geometrically similar conditions; actual pump efficiency varies.
    </div>
  </div>

  <h3>Efficiency &amp; Power</h3>
  <div class="eq-box">
    <div class="eq-label">Hydraulic Power &amp; Efficiency</div>
    <div class="eq-main">P_hydraulic = ρ · g · Q · H  [W]</div>
    <div class="eq-main">P_shaft = P_hydraulic / η_pump  [W]</div>
    <div class="eq-main">P_input = P_shaft / η_motor  [kW]</div>
    <div class="eq-vars">
      ρ = 998.2 kg/m³, g = 9.81 m/s², Q in m³/s<br/>
      η_pump = pump hydraulic efficiency (from manufacturer curve, 0–1)<br/>
      η_motor = motor efficiency (typically 0.92–0.96)
    </div>
  </div>

  <p>
    <span class="ref">Ref: HI 9.6.3 — Rotodynamic Pumps for Design and Application</span>
    <span class="ref">Ref: Pump Handbook, Karassik et al., 4th ed.</span>
    <span class="ref">Ref: AWWA M49 — Butterfly Valves (for selection guidance)</span>
  </p>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 6 — DISCHARGE PIPELINE
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 6</span>
    <span class="page-title">Discharge Pipeline</span>
  </div>

  <h3>Purpose</h3>
  <p>Define the pipe network on the discharge (outlet) side of the pump — from the pump discharge flange to the delivery node. The same friction and minor-loss equations used in Step 3 apply here. Discharge pipeline losses typically dominate the system head for longer rising mains.</p>

  <h3>Governing Equations</h3>
  <p>The Darcy-Weisbach and Colebrook-White equations documented in Step 3 apply identically to discharge segments. Refer to Step 3 for equation details, roughness values, and K-coefficient guidance.</p>

  <div class="eq-box">
    <div class="eq-label">Recap — Discharge Head Loss</div>
    <div class="eq-main">h_f,discharge = Σ [ f_i · (L_i/D_i) · V_i²/(2g) ]  +  ΣK_i · V_i²/(2g)</div>
    <div class="eq-vars">Summation is over all discharge segments i.</div>
  </div>

  <h3>Velocity Guidance</h3>
  <table>
    <tr><th>Pipe Location</th><th>Recommended Range</th><th>Maximum (AWWA M11)</th></tr>
    <tr><td>Suction main</td><td>0.6 – 1.5 m/s</td><td>3.0 m/s</td></tr>
    <tr><td>Discharge main</td><td>0.9 – 2.5 m/s</td><td>3.5 m/s</td></tr>
    <tr><td>Distribution mains</td><td>0.3 – 2.0 m/s</td><td>3.0 m/s</td></tr>
  </table>

  <div class="tip">
    <strong>Design tip:</strong> High velocities increase friction losses and surge pressures; low velocities may cause sediment deposition and stagnation in potable water mains. Target 1.0–2.0 m/s in the discharge main for most drinking-water applications.
  </div>

  <h3>Discharge-Side Fittings</h3>
  <p>The discharge side typically includes: non-return (check) valve, isolating gate/butterfly valve, pressure gauge connections, air release valves at high points (not modelled as a fitting loss, but important for system design), and the delivery connection. Use the Accessories Picker to account for each fitting's K-value.</p>

  <h3>Validation</h3>
  <ul>
    <li>At least one discharge segment with positive diameter and length is required before advancing to Step 7.</li>
    <li>Computed velocities are shown per segment; red highlighting appears if AWWA limits are exceeded.</li>
  </ul>

  <p>
    <span class="ref">Ref: Darcy-Weisbach (as Step 3)</span>
    <span class="ref">Ref: AWWA M11 §4 — Velocity Limits</span>
  </p>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 7 — HYDRAULIC RESULTS
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 7</span>
    <span class="page-title">Hydraulic Results</span>
  </div>

  <h3>Purpose</h3>
  <p>Step 7 assembles all the head components from Steps 2–6 into the Total Dynamic Head (TDH), computes the pump duty point, checks velocity compliance, and evaluates Net Positive Suction Head available (NPSHa) against the pump's required NPSHr.</p>

  <h3>Total Dynamic Head (TDH) Assembly</h3>
  <div class="eq-box">
    <div class="eq-label">TDH — Full Expression</div>
    <div class="eq-main">TDH = H_static + H_pressure + h_f,suction + h_m,suction + h_f,discharge + h_m,discharge</div>
    <div class="eq-vars">
      H_static     = z₂ − z₁  [m]<br/>
      H_pressure   = (p₂ − p₁) / (ρg)  [m]  — converted from kPa<br/>
      h_f,suction  = friction head loss, suction pipeline [m]<br/>
      h_m,suction  = minor head loss, suction fittings [m]<br/>
      h_f,discharge = friction head loss, discharge pipeline [m]<br/>
      h_m,discharge = minor head loss, discharge fittings [m]
    </div>
  </div>

  <p>The <strong>Results Strip</strong> at the top of the screen always shows the current TDH and flow rate regardless of which step is active.</p>

  <h3>Net Positive Suction Head Available (NPSHa)</h3>
  <p>Cavitation occurs when the suction-side absolute pressure drops below the liquid's vapour pressure. The available NPSH must exceed the pump manufacturer's required NPSH with an adequate safety margin.</p>
  <div class="eq-box">
    <div class="eq-label">NPSHa — Available Net Positive Suction Head</div>
    <div class="eq-main">NPSHa = (p_atm − p_vapour)/(ρg) + z_s − h_f,s − h_m,s</div>
    <div class="eq-vars">
      p_atm    = atmospheric pressure [Pa] (standard: 101 325 Pa at sea level)<br/>
      p_vapour = vapour pressure of water at operating temperature [Pa]<br/>
               = 2338 Pa at 20 °C; increases significantly with temperature<br/>
      z_s      = vertical distance from suction water level to pump centreline [m]<br/>
               negative if pump is above water surface<br/>
      h_f,s   = suction friction head loss [m]<br/>
      h_m,s   = suction minor head loss [m]
    </div>
  </div>

  <div class="eq-box">
    <div class="eq-label">HI 9.6.3 — Minimum NPSH Margin</div>
    <div class="eq-main">NPSHa ≥ 1.1 × NPSHr  (minimum 10 % margin)</div>
    <div class="eq-vars">
      NPSHr = pump manufacturer's required NPSH at duty flow [m]<br/>
      A margin of 1.3–1.5× is recommended for pump longevity and reduced cavitation erosion.
    </div>
  </div>

  <h3>Velocity Checks</h3>
  <p>All segment velocities computed in Steps 3 and 6 are summarised here with pass/fail status against AWWA M11 limits. Segments exceeding limits are highlighted in amber or red.</p>

  <h3>Power Estimate</h3>
  <div class="eq-box">
    <div class="eq-label">Pump Duty Power</div>
    <div class="eq-main">P_duty = ρ · g · Q · TDH / η_pump / η_motor / 1000  [kW]</div>
    <div class="eq-vars">Uses efficiency values from the pump curve data entered in Step 5 at the duty flow Q_design.</div>
  </div>

  <p>
    <span class="ref">Ref: HI 9.6.3 — NPSH Margin</span>
    <span class="ref">Ref: AWWA M11 §4</span>
    <span class="ref">Ref: Pump Handbook, Karassik et al.</span>
  </p>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 8 — SYSTEM CURVE & OPERATING POINT
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 8</span>
    <span class="page-title">System Curve &amp; Operating Point</span>
  </div>

  <h3>Purpose</h3>
  <p>The system curve describes how system head varies with flow across the operating range. Overlaying it on the pump H-Q curve graphically reveals the <strong>operating point</strong> — the flow and head at which the pump will actually run.</p>

  <h3>System Curve Generation</h3>
  <div class="eq-box">
    <div class="eq-label">System Curve — Head at Arbitrary Flow Q_i</div>
    <div class="eq-main">H_sys(Q_i) = H_static + H_pressure + (h_f + h_m)|_Q=Q_i</div>
    <div class="eq-vars">
      The static + pressure terms are constant; the friction and minor loss terms scale as Q².<br/>
      The tool evaluates this at 8–10 evenly spaced flow points from Q = 0 to Q = 1.5 × Q_design to produce the curve.
    </div>
  </div>

  <h3>Scaling Property</h3>
  <div class="eq-box">
    <div class="eq-label">Quadratic Scaling of Head Losses</div>
    <div class="eq-main">h_f(Q_i) = h_f(Q_design) × (Q_i / Q_design)²</div>
    <div class="eq-vars">
      Because h_f ∝ V² ∝ Q², friction and minor losses scale with the square of the flow ratio.<br/>
      This gives the system curve its characteristic upward parabolic shape above the static head.
    </div>
  </div>

  <h3>Locating the Operating Point</h3>
  <p>The operating point is found at the intersection of the pump H-Q curve and the system curve. The tool numerically solves for the flow Q* at which <code>H_pump(Q*) = H_sys(Q*)</code> using interpolation on the tabulated curve data.</p>

  <div class="card">
    <h4>Interpreting the Chart</h4>
    <ul>
      <li><strong>Operating point to the right of design flow</strong> — pump runs faster than intended; may cause overloading. Check motor power rating.</li>
      <li><strong>Operating point to the left of design flow</strong> — pump may be oversized or system head underestimated.</li>
      <li><strong>Multiple intersections</strong> — can occur with a flat or humped pump curve; the rightmost stable intersection is the operating point.</li>
      <li><strong>No intersection</strong> — system head exceeds pump shut-off head; the pump cannot deliver flow. Increase pump size or reduce system head.</li>
    </ul>
  </div>

  <div class="tip">
    <strong>VFD Tip:</strong> When VFD is enabled, affinity-law speed curves are plotted in light grey, showing how the operating point tracks along the system curve as speed reduces. This allows verification of minimum speed at minimum demand flow.
  </div>

  <p>
    <span class="ref">Ref: HI 9.6.3 §3.6 — System Curve Analysis</span>
    <span class="ref">Ref: Pump Handbook, Karassik et al., Ch. 12</span>
  </p>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 9 — WATER HAMMER & SURGE ANALYSIS
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 9</span>
    <span class="page-title">Water Hammer &amp; Surge Analysis</span>
  </div>

  <h3>Purpose</h3>
  <p>Water hammer (surge) is the pressure wave generated when flow velocity changes rapidly — most commonly on sudden pump trip or valve closure. Uncontrolled surge can cause pipe bursts, joint failures, or column separation (negative pressure vacuum). Step 9 provides two levels of analysis:</p>
  <ul>
    <li><strong>Mode A — Joukowsky Quick Check</strong>: Instant Joukowsky pressure rise, with Allievi slow-closure reduction for controlled valve operation. Suitable for initial feasibility and screening.</li>
    <li><strong>Mode B — Method of Characteristics (MOC)</strong>: Full numerical transient simulation. Produces pressure envelopes, time histories, and wave-by-wave propagation. Suitable for detailed design and protection device sizing.</li>
  </ul>

  <h3>Wave Speed (Halliwell Formula)</h3>
  <div class="eq-box">
    <div class="eq-label">Pressure Wave Speed — Halliwell Thin-Wall Formula</div>
    <div class="eq-main">a = √( K/ρ / (1 + K·D/(E_p·e) · C) )</div>
    <div class="eq-vars">
      a   = wave speed [m/s]<br/>
      K   = bulk modulus of water ≈ 2.07 × 10⁹ Pa<br/>
      ρ   = water density ≈ 998.2 kg/m³<br/>
      D   = internal pipe diameter [m]<br/>
      E_p = pipe wall Young's modulus [Pa] — material dependent (see table)<br/>
      e   = pipe wall thickness [m]<br/>
      C   = pipe restraint factor:<br/>
            1.0 for free (expansion joints throughout)<br/>
            1 − ν/2 for anchored at upstream end<br/>
            1 − ν² for fully restrained (buried)<br/>
      ν   = Poisson's ratio ≈ 0.3 for steel, 0.46 for HDPE
    </div>
  </div>

  <h4>Typical Wave Speeds by Material</h4>
  <table>
    <tr><th>Material</th><th>E_p (MPa)</th><th>Typical a (m/s)</th></tr>
    <tr><td>HDPE PE100</td><td>900</td><td>300–400</td></tr>
    <tr><td>PVC / uPVC</td><td>3 000</td><td>350–450</td></tr>
    <tr><td>GRP / FRP</td><td>25 000</td><td>450–600</td></tr>
    <tr><td>Ductile Iron (DICL)</td><td>168 000</td><td>900–1 100</td></tr>
    <tr><td>Steel (welded)</td><td>206 000</td><td>1 000–1 300</td></tr>
    <tr><td>Grey Cast Iron</td><td>96 500</td><td>800–1 000</td></tr>
    <tr><td>Asbestos Cement</td><td>24 000</td><td>900–1 100</td></tr>
    <tr><td>Concrete / RCCP</td><td>30 000</td><td>900–1 100</td></tr>
  </table>

  <h3>Mode A — Joukowsky Equation</h3>
  <div class="eq-box">
    <div class="eq-label">Joukowsky Instantaneous Pressure Rise</div>
    <div class="eq-main">ΔH = a · ΔV / g</div>
    <div class="eq-vars">
      ΔH  = surge head rise [m] — add to steady-state pressure<br/>
      a   = wave speed [m/s]<br/>
      ΔV  = change in flow velocity [m/s] (= V_steady for full pump trip)<br/>
      g   = 9.81 m/s²<br/>
      This is the maximum surge for instantaneous stoppage (t_stop &lt; 2L/a, the wave return period).
    </div>
  </div>

  <h3>Allievi Slow-Closure Reduction</h3>
  <div class="eq-box">
    <div class="eq-label">Allievi Slow-Closure Factor</div>
    <div class="eq-main">ΔH_slow = ΔH_Joukowsky × (2L/a) / t_close</div>
    <div class="eq-vars">
      L       = pipeline length [m]<br/>
      a       = wave speed [m/s]<br/>
      2L/a    = wave reflection period [s] — time for the pressure wave to travel to the reservoir and return<br/>
      t_close = valve closure time [s]<br/>
      When t_close &gt; 2L/a, the surge is reduced; when t_close ≤ 2L/a it equals the Joukowsky value.
    </div>
  </div>

  <h3>Mode B — Method of Characteristics (MOC)</h3>
  <p>MOC discretises the pipeline into space-time grid nodes and propagates pressure waves forward in time using the characteristic equations:</p>
  <div class="eq-box">
    <div class="eq-label">MOC Characteristic Equations</div>
    <div class="eq-main">C⁺: H_P = H_A + (a/gA)·(Q_A − Q_P) − R·Q_A·|Q_A|</div>
    <div class="eq-main">C⁻: H_P = H_B − (a/gA)·(Q_B − Q_P) + R·Q_B·|Q_B|</div>
    <div class="eq-vars">
      H_P, Q_P = head and flow at the new time level at point P<br/>
      H_A, Q_A = known conditions one timestep back at the upstream adjacent node<br/>
      H_B, Q_B = known conditions one timestep back at the downstream adjacent node<br/>
      A = pipe cross-sectional area [m²]<br/>
      R = friction resistance term = f·Δx/(2g·D·A²)<br/>
      Δx = spatial reach length = a·Δt
    </div>
  </div>
  <p>MOC produces <strong>pressure envelopes</strong> (maximum and minimum head at every node), time histories at user-selected points, and checks all computed pressures against the pipe PN (pressure rating).</p>

  <h3>Protection Devices</h3>
  <p>The tool allows specification of surge protection measures, which modify boundary conditions in the MOC solver:</p>
  <ul>
    <li><strong>Air vessel (surge tank)</strong> — reduces upsurge by absorbing water volume</li>
    <li><strong>Slow-closing check valve</strong> — limits reverse flow velocity on pump trip</li>
    <li><strong>Pressure relief valve</strong> — vents excess pressure at the pump</li>
    <li><strong>Flywheel (pump inertia)</strong> — slows pump rundown, reducing ΔV/Δt</li>
  </ul>

  <p>
    <span class="ref">Ref: Joukowsky (1900)</span>
    <span class="ref">Ref: Allievi (1902)</span>
    <span class="ref">Ref: Wylie &amp; Streeter, Fluid Transients in Systems (1993)</span>
    <span class="ref">Ref: Halliwell, A.R., Proc. ICE, 1963</span>
    <span class="ref">Ref: AWWA M11 §10 — Surge Pressure Design</span>
  </p>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 10 — ENGINEERING CHECKS
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 10</span>
    <span class="page-title">Engineering Checks</span>
  </div>

  <h3>Purpose</h3>
  <p>Step 10 runs an automated code-compliance and best-practice review, comparing all computed values against industry-standard pass/fail criteria. No additional input is required — checks are derived from data entered in earlier steps and computed results.</p>

  <h3>Reference Standards Applied</h3>
  <div class="card">
    <ul>
      <li><strong>AWWA M11</strong> — Steel Pipe: A Guide for Design and Installation. Pipe velocity limits.</li>
      <li><strong>AWWA M32</strong> — Distribution System Requirements for Fire Protection. Storage, redundancy, pressure requirements.</li>
      <li><strong>HI 9.6.3</strong> — Rotodynamic Pumps for Design and Application. NPSH margin, duty point location, operating range.</li>
      <li><strong>Ten States Standards</strong> (Recommended Standards for Water Works). Pump redundancy, clear well sizing, disinfectant contact time.</li>
    </ul>
  </div>

  <h3>Check Categories</h3>
  <table>
    <tr><th>Category</th><th>Check</th><th>Criterion</th></tr>
    <tr><td>Velocity</td><td>Suction pipe velocity</td><td>≤ 3.0 m/s (AWWA M11)</td></tr>
    <tr><td>Velocity</td><td>Discharge pipe velocity</td><td>≤ 3.5 m/s (AWWA M11)</td></tr>
    <tr><td>Velocity</td><td>Minimum velocity (stagnation risk)</td><td>≥ 0.3 m/s at design flow</td></tr>
    <tr><td>NPSH</td><td>NPSHa margin over NPSHr</td><td>≥ 1.1 × NPSHr (HI 9.6.3)</td></tr>
    <tr><td>NPSH</td><td>Recommended margin</td><td>≥ 1.3 × NPSHr (best practice)</td></tr>
    <tr><td>Clear Well</td><td>Pump starts per hour</td><td>≤ 6 starts/h (AWWA M32)</td></tr>
    <tr><td>Clear Well</td><td>Minimum detention time</td><td>≥ 30 minutes</td></tr>
    <tr><td>Pump Duty</td><td>Duty flow vs. pump BEP</td><td>Duty point within 70–120 % of BEP flow (HI 9.6.3)</td></tr>
    <tr><td>Redundancy</td><td>Standby pump provision</td><td>N+1 minimum (Ten States §5.2)</td></tr>
    <tr><td>Surge</td><td>Max surge pressure vs. pipe PN</td><td>Surge head + static ≤ 90 % of PN rating</td></tr>
    <tr><td>Surge</td><td>Minimum pressure (vacuum / column sep.)</td><td>Minimum transient head ≥ −10 m (vapour pressure limit)</td></tr>
  </table>

  <h3>Severity Levels</h3>
  <table>
    <tr><th>Severity</th><th>Colour</th><th>Meaning</th></tr>
    <tr><td><strong>Critical</strong></td><td>Red</td><td>Design does not meet minimum standard. Must be resolved before the design is finalised.</td></tr>
    <tr><td><strong>Warning</strong></td><td>Amber</td><td>Design is marginal or does not meet best-practice recommendation. Review and document justification.</td></tr>
    <tr><td><strong>Pass</strong></td><td>Green</td><td>Criterion satisfied.</td></tr>
    <tr><td><strong>Skipped</strong></td><td>Grey</td><td>Check not applicable (e.g., surge checks when surge analysis is disabled).</td></tr>
  </table>

  <div class="note">
    <strong>Disclaimer:</strong> Engineering Checks are automated guides based on common industry standards and are not a substitute for professional engineering judgement. Results must be reviewed and verified by a qualified engineer. Local standards and project-specific requirements may impose stricter criteria.
  </div>
</div>


<!-- ═══════════════════════════════════════════════════════
     STEP 11 — SUMMARY & EXPORT
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge">STEP 11</span>
    <span class="page-title">Summary &amp; Export</span>
  </div>

  <h3>Purpose</h3>
  <p>Step 11 provides a complete summary of the design and allows the engineer to export the calculation report in various formats for documentation, peer review, client submission, or design-file archiving.</p>

  <h3>Design Summary Panel</h3>
  <p>The summary panel collects the key outputs from all earlier steps into a single read-only view:</p>
  <ul>
    <li>Project metadata (name, client, job number, date, engineer)</li>
    <li>Design flow rate (m³/h and gpm)</li>
    <li>TDH breakdown: static head, friction losses, minor losses, pressure differential</li>
    <li>Operating point: flow and head at pump curve intersection</li>
    <li>Pump power consumption (duty kW and annual kWh at rated hours)</li>
    <li>Clear well useful volume, cycling rate, and detention time</li>
    <li>Surge summary: maximum and minimum pressures, wave speed</li>
    <li>Engineering checks summary: total pass / warning / critical counts</li>
  </ul>

  <h3>Export Options</h3>
  <table>
    <tr><th>Format</th><th>Contents</th><th>Typical Use</th></tr>
    <tr>
      <td><strong>PDF Report</strong></td>
      <td>Formatted calculation report with all inputs, equations, results, charts, and engineering check table.</td>
      <td>Client submission, design filing, peer review.</td>
    </tr>
    <tr>
      <td><strong>Excel / CSV</strong></td>
      <td>Tabulated inputs and results in structured spreadsheet format for further analysis or QA checking.</td>
      <td>Independent checking, asset management systems.</td>
    </tr>
    <tr>
      <td><strong>JSON (Save)</strong></td>
      <td>Machine-readable project file containing all input data. Can be loaded back into WPS Designer to resume or modify the design.</td>
      <td>Project archiving, version control, reuse.</td>
    </tr>
  </table>

  <h3>Saving Your Project</h3>
  <p>Use the <strong>Save</strong> button in the top toolbar to synchronise your project to the server. Saved projects appear in the Projects dashboard and can be loaded from any device. The application also retains the last project in browser local storage as a session backup.</p>

  <h3>Loading Sample Projects</h3>
  <p>The <strong>Load Sample</strong> dropdown in the top toolbar provides three pre-built reference designs:</p>
  <ul>
    <li><strong>Basic Rising Main</strong> — a standard single-stage pump station with a simple suction and discharge rising main.</li>
    <li><strong>Variable-Speed Transfer</strong> — a VFD-controlled pump set with affinity-law speed variation.</li>
    <li><strong>Booster Station</strong> — a mid-system booster with elevated suction pressure and short discharge to a high-pressure zone.</li>
  </ul>
  <p>Loading a sample overwrites the current design — save your work first if needed.</p>

  <div class="tip">
    <strong>Best practice for reports:</strong> Before generating the final report, return to Step 10 (Engineering Checks) to confirm all critical checks pass. Amend the design as required, then export from Step 11. Include the engineering checks table in all client submissions.
  </div>
</div>


<!-- ═══════════════════════════════════════════════════════
     APPENDIX — QUICK REFERENCE
═══════════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-header">
    <span class="step-badge" style="background:#475569;">App.</span>
    <span class="page-title">Quick-Reference: Equations &amp; Standards</span>
  </div>

  <h3>Core Hydraulic Equations</h3>

  <div class="eq-box">
    <div class="eq-label">Darcy-Weisbach (friction head loss)</div>
    <div class="eq-main">h_f = f · (L/D) · V²/(2g)</div>
  </div>
  <div class="eq-box">
    <div class="eq-label">Colebrook-White (friction factor)</div>
    <div class="eq-main">1/√f = −2.0 log₁₀(ε/(3.7D) + 2.51/(Re·√f))</div>
  </div>
  <div class="eq-box">
    <div class="eq-label">Minor losses (K-coefficient)</div>
    <div class="eq-main">h_m = ΣK · V²/(2g)</div>
  </div>
  <div class="eq-box">
    <div class="eq-label">TDH assembly</div>
    <div class="eq-main">TDH = H_static + H_pressure + h_f,suction + h_m,suction + h_f,discharge + h_m,discharge</div>
  </div>
  <div class="eq-box">
    <div class="eq-label">NPSHa</div>
    <div class="eq-main">NPSHa = (p_atm − p_vapour)/(ρg) + z_s − h_f,s − h_m,s</div>
  </div>
  <div class="eq-box">
    <div class="eq-label">Joukowsky water hammer</div>
    <div class="eq-main">ΔH = a · ΔV / g</div>
  </div>
  <div class="eq-box">
    <div class="eq-label">Wave speed (Halliwell)</div>
    <div class="eq-main">a = √( K/ρ / (1 + K·D·C/(E_p·e)) )</div>
  </div>
  <div class="eq-box">
    <div class="eq-label">Affinity laws (VFD)</div>
    <div class="eq-main">Q₂/Q₁ = n₂/n₁ &nbsp;·&nbsp; H₂/H₁ = (n₂/n₁)² &nbsp;·&nbsp; P₂/P₁ = (n₂/n₁)³</div>
  </div>

  <h3>Key Standards Referenced</h3>
  <table>
    <tr><th>Standard</th><th>Topic</th></tr>
    <tr><td>AWWA M11</td><td>Steel Pipe — Design and Installation; velocity limits, surge design</td></tr>
    <tr><td>AWWA M32</td><td>Distribution System Requirements for Fire Protection; storage, redundancy</td></tr>
    <tr><td>AWWA M49</td><td>Butterfly Valves; selection and application</td></tr>
    <tr><td>HI 9.6.3</td><td>Rotodynamic Pumps — Design and Application; NPSH, operating point</td></tr>
    <tr><td>Ten States Standards</td><td>Recommended Standards for Water Works; N+1 redundancy, clear well sizing</td></tr>
    <tr><td>Moody (1944)</td><td>Friction Factor Chart; reference for Darcy-Weisbach regime mapping</td></tr>
    <tr><td>Colebrook (1939)</td><td>Turbulent Flow in Pipes — implicit friction factor equation</td></tr>
    <tr><td>Joukowsky (1900)</td><td>Über den hydraulischen Stoss — water hammer pressure formula</td></tr>
    <tr><td>Allievi (1902)</td><td>Teoria del colpo d'ariete — slow-closure surge reduction</td></tr>
    <tr><td>Halliwell (1963)</td><td>Proc. ICE — wave speed in thin-walled pipes</td></tr>
    <tr><td>Wylie &amp; Streeter (1993)</td><td>Fluid Transients in Systems — MOC numerical method</td></tr>
    <tr><td>Karassik et al.</td><td>Pump Handbook, 4th ed. — centrifugal pump theory and selection</td></tr>
  </table>

  <h3>Physical Constants Used in Calculations</h3>
  <table>
    <tr><th>Constant</th><th>Value</th><th>Units</th></tr>
    <tr><td>Gravitational acceleration (g)</td><td>9.81</td><td>m/s²</td></tr>
    <tr><td>Water density (ρ) at 20 °C</td><td>998.2</td><td>kg/m³</td></tr>
    <tr><td>Kinematic viscosity (ν) at 20 °C</td><td>1.004 × 10⁻⁶</td><td>m²/s</td></tr>
    <tr><td>Dynamic viscosity (μ) at 20 °C</td><td>1.002 × 10⁻³</td><td>Pa·s</td></tr>
    <tr><td>Bulk modulus of water (K) at 20 °C</td><td>2.07 × 10⁹</td><td>Pa</td></tr>
    <tr><td>Vapour pressure (p_v) at 20 °C</td><td>2 338</td><td>Pa</td></tr>
    <tr><td>Atmospheric pressure (p_atm) sea level</td><td>101 325</td><td>Pa</td></tr>
  </table>

  <p style="margin-top: 30px; font-size: 8pt; color: var(--muted); border-top: 1px solid var(--border); padding-top: 14px;">
    ALLL WPS Designer User Guide — Version 1.0, May 2026.<br/>
    This document is provided for guidance only. All designs must be reviewed and certified by a registered Professional Engineer.<br/>
    Applicable standards may have been updated; verify current editions before use in production designs.
  </p>
</div>

</body>
</html>`;

// Write the HTML to a temp file for debugging purposes
const htmlPath = join(__dirname, "user-guide.html");
writeFileSync(htmlPath, html, "utf-8");

console.log("Launching Chromium...");
const browser = await puppeteer.launch({
  executablePath: CHROMIUM_PATH,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--font-render-hinting=none",
  ],
});

const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0", timeout: 60000 });

// Give fonts a moment to load
await new Promise((r) => setTimeout(r, 1500));

const outputPath = join(__dirname, "..", "frontend", "public", "user-guide.pdf");

await page.pdf({
  path: outputPath,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: false,
  margin: { top: "0", right: "0", bottom: "0", left: "0" },
});

await browser.close();

console.log(`PDF written to: ${outputPath}`);
