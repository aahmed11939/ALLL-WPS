import { useCallback, useMemo, useRef } from "react";
import { useProject } from "../contexts/ProjectContext";
import { useUnitSystem } from "../contexts/UnitSystemContext";
import { FT_PER_M, IN_PER_MM } from "../utils/units";
import type { AccessoryItem } from "../utils/api";

// ---------------------------------------------------------------------------
// SVG layout constants
// ---------------------------------------------------------------------------

const SVG_W = 880;
const SVG_H = 500;

// Horizontal zones
const CW_LEFT   = 58;   // clearwell left wall x
const CW_RIGHT  = 180;  // clearwell right wall x
const CW_W      = CW_RIGHT - CW_LEFT;

const SUCTION_X1 = CW_RIGHT;
const SUCTION_X2 = 325;

const PUMP_CX    = 385;
const PUMP_R     = 28;

const DISC_X1    = PUMP_CX + PUMP_R;
const DISC_X2    = 640;

const DS_CX      = 700;
const DS_R       = 20;

// Elevation scale
const DATUM_Y       = 430; // datum rail y
const ELEV_ZONE_TOP = 90;  // y for highest element
const AVAIL_H       = DATUM_Y - ELEV_ZONE_TOP;

// Pipe visual
const PIPE_HALF = 6;

// Minimum clearwell height in SVG pixels (so it is always legible)
const MIN_CW_H = 60;

// Colours
const TEAL       = "#0f766e";
const TEAL_LIGHT = "#ccfbf1";
const SLATE      = "#cbd5e1";
const SLATE_DK   = "#64748b";
const RED        = "#ef4444";
const AMBER      = "#f59e0b";
const INDIGO     = "#6366f1";
const GRAY_PIPE  = "#e2e8f0";
const PIPE_STR   = "#94a3b8";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtLen(m: number, isUS: boolean) {
  return isUS ? `${(m * FT_PER_M).toFixed(1)} ft` : `${m.toFixed(1)} m`;
}
function fmtDiam(mm: number, isUS: boolean) {
  return isUS ? `${(mm * IN_PER_MM).toFixed(2)}"` : `DN${Math.round(mm)}`;
}
function fmtElev(m: number, isUS: boolean) {
  return isUS ? `${(m * FT_PER_M).toFixed(2)} ft` : `${m.toFixed(2)} m`;
}
function fmtPressure(kPa: number, isUS: boolean) {
  return isUS ? `${(kPa * 0.14503774).toFixed(1)} psi` : `${kPa.toFixed(0)} kPa`;
}

/** Infer P&ID symbol type from the accessory_id string. */
function accessorySymbolType(id: string): "gate" | "check" | "circle" {
  const lower = id.toLowerCase();
  if (lower.includes("isolation") || lower.includes("gate") || lower.includes("butterfly") || lower.includes("ball"))
    return "gate";
  if (lower.includes("check") || lower.includes("non_return") || lower.includes("non-return"))
    return "check";
  return "circle";
}

// ---------------------------------------------------------------------------
// P&ID symbols
// ---------------------------------------------------------------------------

function GateValveSymbol({ cx, cy, r = 7 }: { cx: number; cy: number; r?: number }) {
  return (
    <g>
      <rect x={cx - r * 0.5} y={cy - r} width={r} height={r * 2} fill="#1e40af" stroke="#1d4ed8" strokeWidth={1} rx={1} />
      <line x1={cx} y1={cy - r} x2={cx} y2={cy - r - 5} stroke="#1d4ed8" strokeWidth={1.5} />
      <rect x={cx - 4} y={cy - r - 7} width={8} height={3} fill="#1d4ed8" rx={1} />
    </g>
  );
}

function CheckValveSymbol({ cx, cy, r = 7 }: { cx: number; cy: number; r?: number }) {
  const pts = `${cx - r},${cy - r} ${cx - r},${cy + r} ${cx + r * 0.4},${cy}`;
  return (
    <g>
      <polygon points={pts} fill="#047857" stroke="#065f46" strokeWidth={1} />
      <line x1={cx + r * 0.4} y1={cy - r} x2={cx + r * 0.4} y2={cy + r} stroke="#065f46" strokeWidth={1.5} />
    </g>
  );
}

function GenericFittingSymbol({ cx, cy, r = 6, label }: { cx: number; cy: number; r?: number; label: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="#f1f5f9" stroke={SLATE_DK} strokeWidth={1.2} />
      <text x={cx} y={cy + 3} textAnchor="middle" fontSize={6} fontFamily="ui-monospace,monospace" fill={SLATE_DK}>
        {label.slice(0, 2).toUpperCase()}
      </text>
    </g>
  );
}

function CountBadge({ cx, cy, count }: { cx: number; cy: number; count: number }) {
  if (count <= 1) return null;
  return (
    <g>
      <circle cx={cx + 8} cy={cy - 8} r={6} fill={AMBER} />
      <text x={cx + 8} y={cy - 5} textAnchor="middle" fontSize={7} fontWeight="700" fontFamily="ui-sans-serif,sans-serif" fill="white">
        {count}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Accessory strip — placed along a pipe, with a yAt function for sloped pipes
// ---------------------------------------------------------------------------

interface AccessoryStripProps {
  accessories: AccessoryItem[];
  x1: number;
  x2: number;
  yAt: (x: number) => number;
}

function AccessoryStrip({ accessories, x1, x2, yAt }: AccessoryStripProps) {
  const items = accessories.filter((a) => (a.count ?? 0) > 0);
  if (items.length === 0) return null;
  const spacing = (x2 - x1) / (items.length + 1);
  return (
    <g>
      {items.map((item, idx) => {
        const cx = x1 + spacing * (idx + 1);
        const cy = yAt(cx);
        const sym = accessorySymbolType(item.accessory_id);
        return (
          <g key={item.accessory_id}>
            {sym === "gate"   && <GateValveSymbol   cx={cx} cy={cy} />}
            {sym === "check"  && <CheckValveSymbol  cx={cx} cy={cy} />}
            {sym === "circle" && <GenericFittingSymbol cx={cx} cy={cy} label={item.accessory_id} />}
            <CountBadge cx={cx} cy={cy} count={item.count} />
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Multi-segment pipe run (supports sloped pipes: y1 ≠ y2)
// ---------------------------------------------------------------------------

interface PipeRunProps {
  x1: number;
  x2: number;
  y1: number;  // pipe centreline y at x1
  y2: number;  // pipe centreline y at x2
  segments: Array<{ diameter_mm: number; material: string; length_m: number }>;
  isUS: boolean;
  labelAbove?: boolean;
}

function PipeRun({ x1, x2, y1, y2, segments, isUS, labelAbove = true }: PipeRunProps) {
  if (segments.length === 0) return null;
  const totalLen = segments.reduce((s, seg) => s + seg.length_m, 0);
  const dx = x2 - x1 || 1;

  const yAt = (x: number) => y1 + ((x - x1) / dx) * (y2 - y1);

  // Compute each segment's x boundaries proportionally by length
  let xCursor = x1;
  const segBounds = segments.map((seg) => {
    const segW = totalLen > 0 ? (seg.length_m / totalLen) * (x2 - x1) : (x2 - x1) / segments.length;
    const sx1 = xCursor;
    xCursor += segW;
    return { seg, sx1, sx2: xCursor };
  });

  // Total length callout — shown above/below the full run, at the run midpoint
  const runMidX = (x1 + x2) / 2;
  const runMidY = yAt(runMidX);
  const totalCalloutGap = segments.length > 1 ? 48 : 26;
  const totalCalloutY = labelAbove
    ? runMidY - PIPE_HALF - totalCalloutGap
    : runMidY + PIPE_HALF + totalCalloutGap;

  return (
    <g>
      {/* Total length label for multi-segment runs */}
      {segments.length > 1 && (
        <g>
          {/* Bracket lines spanning the full run */}
          <line x1={x1} y1={labelAbove ? yAt(x1) - PIPE_HALF - 18 : yAt(x1) + PIPE_HALF + 18}
            x2={x2} y2={labelAbove ? yAt(x2) - PIPE_HALF - 18 : yAt(x2) + PIPE_HALF + 18}
            stroke={TEAL} strokeWidth={0.75} strokeDasharray="3 2" />
          <line x1={x1} y1={labelAbove ? yAt(x1) - PIPE_HALF - 15 : yAt(x1) + PIPE_HALF + 15}
            x2={x1} y2={labelAbove ? yAt(x1) - PIPE_HALF - 21 : yAt(x1) + PIPE_HALF + 21}
            stroke={TEAL} strokeWidth={0.75} />
          <line x1={x2} y1={labelAbove ? yAt(x2) - PIPE_HALF - 15 : yAt(x2) + PIPE_HALF + 15}
            x2={x2} y2={labelAbove ? yAt(x2) - PIPE_HALF - 21 : yAt(x2) + PIPE_HALF + 21}
            stroke={TEAL} strokeWidth={0.75} />
          <text x={runMidX} y={totalCalloutY} textAnchor="middle"
            fontSize={8} fontWeight="600" fontFamily="ui-monospace,monospace" fill={TEAL}>
            Total L = {fmtLen(totalLen, isUS)}
          </text>
        </g>
      )}

      {segBounds.map(({ seg, sx1, sx2 }, i) => {
        const sy1 = yAt(sx1);
        const sy2 = yAt(sx2);
        const midX = (sx1 + sx2) / 2;
        const midY = yAt(midX);
        const pts = `${sx1},${sy1 - PIPE_HALF} ${sx2},${sy2 - PIPE_HALF} ${sx2},${sy2 + PIPE_HALF} ${sx1},${sy1 + PIPE_HALF}`;
        const calloutGap = 26;
        const calloutY = labelAbove ? midY - PIPE_HALF - calloutGap : midY + PIPE_HALF + calloutGap;
        const lineEndY  = labelAbove ? midY - PIPE_HALF - 4          : midY + PIPE_HALF + 4;
        const segLabel  = segments.length > 1 ? `S${i + 1}: ${fmtDiam(seg.diameter_mm, isUS)}` : fmtDiam(seg.diameter_mm, isUS);
        const matLabel  = `${seg.material.replace(/_/g, " ").toUpperCase()} · L=${fmtLen(seg.length_m, isUS)}`;

        return (
          <g key={i}>
            {/* Segment divider */}
            {i > 0 && (
              <line x1={sx1} y1={sy1 - PIPE_HALF - 3} x2={sx1} y2={sy1 + PIPE_HALF + 3}
                stroke={PIPE_STR} strokeWidth={1.5} />
            )}
            {/* Pipe body */}
            <polygon points={pts} fill={GRAY_PIPE} stroke={PIPE_STR} strokeWidth={1} />
            {/* Centreline */}
            <line x1={sx1} y1={sy1} x2={sx2} y2={sy2}
              stroke={PIPE_STR} strokeWidth={0.75} strokeDasharray="5 3" />
            {/* Callout leader */}
            <line x1={midX} y1={lineEndY} x2={midX}
              y2={labelAbove ? calloutY + 8 : calloutY - 2}
              stroke={SLATE_DK} strokeWidth={0.75} strokeDasharray="3 2" />
            <text x={midX} y={calloutY} textAnchor="middle"
              fontSize={8.5} fontWeight="600" fontFamily="ui-monospace,monospace" fill={SLATE_DK}>
              {segLabel}
            </text>
            <text x={midX} y={calloutY + 10} textAnchor="middle"
              fontSize={7.5} fontFamily="ui-monospace,monospace" fill="#94a3b8">
              {matLabel}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ---------------------------------------------------------------------------
// Clearwell cross-section — uses the elevation-scaled coordinate space
// ---------------------------------------------------------------------------

interface ClearwellSectionProps {
  cx1: number;            // left wall x
  cx2: number;            // right wall x
  floorY: number;         // SVG y for the clearwell base (upstreamNode elevation)
  topY: number;           // SVG y for clearwell top (must be < floorY)
  LLL_m: number;
  LWL_m: number;
  HWL_m: number;
  HHL_m: number;
  baseElevM: number;      // absolute elevation of the clearwell floor (= upstreamNode.elevation_m)
  shape: string;
  diameter_m?: number;
  length_m?: number;
  width_m?: number;
  isUS: boolean;
}

function ClearwellSection({
  cx1, cx2, floorY, topY,
  LLL_m, LWL_m, HWL_m, HHL_m,
  baseElevM,
  shape, diameter_m, length_m, width_m,
  isUS,
}: ClearwellSectionProps) {
  const innerX1 = cx1 + 5;
  const innerX2 = cx2 - 5;
  const innerW  = innerX2 - innerX1;
  const pixH    = floorY - topY; // positive

  // Map a level (relative height from base, 0 = floor, HHL_m = top) to SVG y
  const levelToY = (h: number) => {
    const frac = Math.min(Math.max(h / HHL_m, 0), 1);
    return floorY - frac * pixH;
  };

  const yLLL = levelToY(LLL_m);
  const yLWL = levelToY(LWL_m);
  const yHWL = levelToY(HWL_m);
  const yHHL = levelToY(HHL_m);

  const geomLabel =
    shape === "cylindrical" && diameter_m
      ? `Ø ${isUS ? `${(diameter_m * FT_PER_M).toFixed(1)} ft` : `${diameter_m.toFixed(1)} m`}`
      : shape === "rectangular" && length_m && width_m
        ? `${isUS ? (length_m * FT_PER_M).toFixed(1) : length_m.toFixed(1)} × ${isUS ? (width_m * FT_PER_M).toFixed(1) : width_m.toFixed(1)} ${isUS ? "ft" : "m"}`
        : null;

  // Labels show absolute elevation; secondary text shows relative depth above floor
  const fmtAbsElev = (h: number) => fmtElev(baseElevM + h, isUS);
  const fmtRelDep  = (h: number) => `+${fmtElev(h, isUS)}`;

  return (
    <g>
      {/* Colour bands */}
      <rect x={innerX1} y={yLWL}  width={innerW} height={yLLL - yLWL}  fill="#fef3c7" />
      <rect x={innerX1} y={yHWL}  width={innerW} height={yLWL - yHWL}  fill={TEAL_LIGHT} />
      <rect x={innerX1} y={yHHL}  width={innerW} height={yHWL - yHHL}  fill="#fee2e2" />
      {/* Tank walls & floor */}
      <rect x={cx1}     y={topY}  width={5}       height={floorY - topY + 5} fill={SLATE} rx={2} />
      <rect x={cx2 - 5} y={topY}  width={5}       height={floorY - topY + 5} fill={SLATE} rx={2} />
      <rect x={cx1}     y={floorY} width={cx2 - cx1} height={5}             fill={SLATE} rx={2} />
      {/* Cap tabs */}
      <line x1={cx1} y1={topY} x2={cx1} y2={topY - 8} stroke={SLATE} strokeWidth={3} strokeLinecap="round" />
      <line x1={cx2} y1={topY} x2={cx2} y2={topY - 8} stroke={SLATE} strokeWidth={3} strokeLinecap="round" />

      {/* Level lines + labels */}
      {([
        { key: "HHL", y: yHHL, h: HHL_m, color: RED,   side: "above" as const },
        { key: "HWL", y: yHWL, h: HWL_m, color: TEAL,  side: "below" as const },
        { key: "LWL", y: yLWL, h: LWL_m, color: TEAL,  side: "above" as const },
        { key: "LLL", y: yLLL, h: LLL_m, color: AMBER, side: "below" as const },
      ]).map(({ key, y, h, color, side }) => {
        const yName = side === "above" ? y - 3  : y + 9;
        const yAbs  = side === "above" ? y + 5  : y + 17;
        const yRel  = side === "above" ? y + 13 : y + 25;
        return (
          <g key={key}>
            <line x1={cx1 - 2} y1={y} x2={cx2 + 2} y2={y}
              stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={cx1 - 5} y={yName}
              textAnchor="end" fontSize={7.5} fontWeight="700"
              fontFamily="ui-monospace,monospace" fill={color}>
              {key}
            </text>
            {/* Absolute elevation (primary value engineers reference) */}
            <text x={cx1 - 5} y={yAbs}
              textAnchor="end" fontSize={6.5}
              fontFamily="ui-monospace,monospace" fill={color} opacity={0.9}>
              {fmtAbsElev(h)}
            </text>
            {/* Relative depth above clearwell floor (secondary) */}
            <text x={cx1 - 5} y={yRel}
              textAnchor="end" fontSize={6}
              fontFamily="ui-monospace,monospace" fill={color} opacity={0.55}>
              {fmtRelDep(h)}
            </text>
          </g>
        );
      })}

      {/* Geometry label */}
      {geomLabel && (
        <text x={(cx1 + cx2) / 2} y={topY - 13} textAnchor="middle"
          fontSize={8} fontFamily="ui-monospace,monospace" fill={SLATE_DK}>
          {geomLabel}
        </text>
      )}
      <text x={(cx1 + cx2) / 2} y={topY - (geomLabel ? 24 : 14)} textAnchor="middle"
        fontSize={9} fontWeight="700" fontFamily="ui-sans-serif,sans-serif" fill="#334155">
        Clearwell
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Pump symbol — centrifugal (circle + triangle)
// ---------------------------------------------------------------------------

function PumpSymbol({ cx, cy, r, label, standby = false, hasOperatingPoint = false }: {
  cx: number; cy: number; r: number; label: string; standby?: boolean; hasOperatingPoint?: boolean;
}) {
  const fill   = standby ? "#f1f5f9" : TEAL_LIGHT;
  const stroke = standby ? "#94a3b8" : TEAL;
  const textFill = standby ? "#94a3b8" : TEAL;
  const triSize = r * 0.55;
  const triPts  = `${cx + triSize},${cy} ${cx - triSize * 0.5},${cy - triSize * 0.9} ${cx - triSize * 0.5},${cy + triSize * 0.9}`;
  return (
    <g opacity={standby ? 0.55 : 1}>
      {/* Glowing ring when operating point is active on duty pump */}
      {hasOperatingPoint && !standby && (
        <circle cx={cx} cy={cy} r={r + 5} fill="none" stroke={TEAL} strokeWidth={1.5}
          strokeDasharray="4 3" opacity={0.5} />
      )}
      <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={2} />
      <polygon points={triPts} fill={stroke} opacity={0.7} />
      <text x={cx} y={cy + r + 12} textAnchor="middle"
        fontSize={8} fontWeight="600" fontFamily="ui-sans-serif,sans-serif" fill={textFill}>
        {label}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Operating point callout — shown on the pump block when pumpResult is set
// ---------------------------------------------------------------------------

const OP_COLOR = "#7c3aed"; // violet

function OperatingPointCallout({ cx, cy, r, Q_m3h, H_m, eta_pct, isUS }: {
  cx: number; cy: number; r: number;
  Q_m3h: number; H_m: number; eta_pct: number | null; isUS: boolean;
}) {
  const boxW = 108;
  const boxH = eta_pct != null ? 40 : 30;
  const boxX = cx - boxW / 2;
  const boxY = cy + r + 18;
  const leaderY = cy + r + 2;

  const qLabel = isUS
    ? `Q = ${(Q_m3h * 4.40287).toFixed(1)} gpm`
    : `Q = ${Q_m3h.toFixed(2)} m³/h`;
  const hLabel = isUS
    ? `H = ${(H_m * 3.28084).toFixed(1)} ft`
    : `H = ${H_m.toFixed(2)} m`;
  const etaLabel = eta_pct != null ? `η = ${eta_pct.toFixed(1)}%` : null;

  return (
    <g>
      {/* Leader line from pump bottom to callout box */}
      <line x1={cx} y1={leaderY} x2={cx} y2={boxY}
        stroke={OP_COLOR} strokeWidth={1} strokeDasharray="3 2" />
      {/* Callout box */}
      <rect x={boxX} y={boxY} width={boxW} height={boxH} rx={4}
        fill="#faf5ff" stroke={OP_COLOR} strokeWidth={1.2} />
      {/* Badge label */}
      <rect x={boxX} y={boxY} width={boxW} height={11} rx={4} fill={OP_COLOR} />
      <rect x={boxX} y={boxY + 7} width={boxW} height={4} fill={OP_COLOR} />
      <text x={cx} y={boxY + 8.5} textAnchor="middle"
        fontSize={6.5} fontWeight="700" fontFamily="ui-sans-serif,sans-serif" fill="white"
        letterSpacing="0.5">
        OPERATING POINT
      </text>
      {/* Q and H values */}
      <text x={cx} y={boxY + 20} textAnchor="middle"
        fontSize={7.5} fontWeight="600" fontFamily="ui-monospace,monospace" fill={OP_COLOR}>
        {qLabel}  ·  {hLabel}
      </text>
      {/* Efficiency badge */}
      {etaLabel && (
        <text x={cx} y={boxY + 32} textAnchor="middle"
          fontSize={7.5} fontWeight="600" fontFamily="ui-monospace,monospace" fill="#6d28d9">
          {etaLabel}
        </text>
      )}
      {/* Small diamond marker at pump connection point */}
      <polygon
        points={`${cx},${leaderY - 4} ${cx + 4},${leaderY} ${cx},${leaderY + 4} ${cx - 4},${leaderY}`}
        fill={OP_COLOR}
      />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Datum tick
// ---------------------------------------------------------------------------

function DatumTick({ x, datumY, topLabel, elev, color, isUS }: {
  x: number; datumY: number; topLabel: string; elev: number; color: string; isUS: boolean;
}) {
  return (
    <g>
      <line x1={x} y1={datumY - 5} x2={x} y2={datumY + 5} stroke={color} strokeWidth={2} />
      <text x={x} y={datumY - 8} textAnchor="middle"
        fontSize={7} fontWeight="700" fontFamily="ui-sans-serif,sans-serif" fill={color}>
        {topLabel}
      </text>
      <text x={x} y={datumY + 16} textAnchor="middle"
        fontSize={6.5} fontFamily="ui-monospace,monospace" fill={color} opacity={0.85}>
        {fmtElev(elev, isUS)}
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PumpStationSchematic() {
  const { draft } = useProject();
  const { unitSystem } = useUnitSystem();
  const isUS = unitSystem === "US";
  const svgRef = useRef<SVGSVGElement>(null);

  const handleExportPng = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const scale = 2;
    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width  = SVG_W * scale;
      canvas.height = SVG_H * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      const link = document.createElement("a");
      const safeName = (draft.meta.name || "project")
        .replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      const ts = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15).replace("T", "_");
      link.download = `${safeName}_schematic_${ts}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      URL.revokeObjectURL(url);
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, [draft.meta.name]);

  const { clearwellConfig, pumpSelectionConfig, pumpResult, suction, discharge, upstreamNode, downstreamNode } = draft;

  // Pick the primary operating point: prefer the one matching nDuty pumps, else first
  const primaryOp = useMemo(() => {
    if (!pumpResult?.operating_points?.length) return null;
    const nDutyPumps = pumpSelectionConfig?.nDuty ?? 1;
    return (
      pumpResult.operating_points.find((op) => op.n_pumps === nDutyPumps) ??
      pumpResult.operating_points[0]
    );
  }, [pumpResult, pumpSelectionConfig?.nDuty]);

  const hasClearwell = !!(
    clearwellConfig &&
    clearwellConfig.LLL_m < clearwellConfig.LWL_m &&
    clearwellConfig.LWL_m < clearwellConfig.HWL_m &&
    clearwellConfig.HWL_m < clearwellConfig.HHL_m
  );
  const hasSuction   = suction.segments.length > 0;
  const hasDischarge = discharge.segments.length > 0;
  const hasAnyData   = hasSuction || hasDischarge || pumpSelectionConfig !== null || hasClearwell;

  // Placeholder when no data at all
  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 h-64 text-xs text-slate-400 text-center px-4">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none" className="mb-2 opacity-30">
          <rect x="4" y="10" width="12" height="28" rx="1" stroke="#94a3b8" strokeWidth="2" />
          <line x1="16" y1="24" x2="28" y2="24" stroke="#94a3b8" strokeWidth="2" />
          <circle cx="34" cy="24" r="6" stroke="#94a3b8" strokeWidth="2" />
          <line x1="40" y1="24" x2="44" y2="24" stroke="#94a3b8" strokeWidth="2" />
        </svg>
        <p className="font-medium text-slate-500">Station Schematic</p>
        <p className="mt-0.5">Complete the pipeline and pump steps to generate the schematic</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Elevation scale
  // ---------------------------------------------------------------------------

  const upElev = upstreamNode.elevation_m;
  const dsElev = downstreamNode.elevation_m;

  // Highest element: downstream node OR clearwell top, whichever is greater
  const cwTopElev = hasClearwell ? upElev + clearwellConfig!.HHL_m : upElev;
  const maxElev   = Math.max(upElev, dsElev, cwTopElev);
  const minElev   = Math.min(upElev, dsElev);
  const elevSpan  = Math.max(maxElev - minElev, 5); // at least 5 m span

  /** Map elevation (m) to SVG y coordinate. */
  const toSvgY = (e: number): number => DATUM_Y - ((e - minElev) / elevSpan) * AVAIL_H;

  const upY  = toSvgY(upElev);  // clearwell base y, pump CL y
  const dsY  = toSvgY(dsElev);  // downstream node y

  // Clearwell top y (at least MIN_CW_H pixels above floor)
  const cwTopYRaw = hasClearwell ? toSvgY(upElev + clearwellConfig!.HHL_m) : upY - MIN_CW_H;
  const cwTopY    = Math.min(cwTopYRaw, upY - MIN_CW_H);

  // ---------------------------------------------------------------------------
  // Pump symbols
  // ---------------------------------------------------------------------------

  const nDuty    = pumpSelectionConfig?.nDuty    ?? 1;
  const nStandby = pumpSelectionConfig?.nStandby ?? 0;

  const pumpLabel = useMemo(() => {
    if (!pumpSelectionConfig?.selectedTypeKey) return "Pump";
    return pumpSelectionConfig.selectedTypeKey
      .replace(/_/g, " ")
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }, [pumpSelectionConfig]);

  const pumpSymbols = useMemo(() => {
    const total   = nDuty + nStandby;
    const spacing = Math.min(30, 60 / Math.max(total, 1));
    const offset  = -((total - 1) * spacing) / 2;
    return Array.from({ length: total }, (_, i) => ({
      cx:      PUMP_CX + offset + i * spacing,
      cy:      upY,
      standby: i >= nDuty,
      label:   i >= nDuty ? "Stby" : `D${i + 1}`,
    }));
  }, [nDuty, nStandby, upY]);

  // Pipe connection points (left-most duty pump inlet, right-most pump outlet)
  const pumpInletX  = (pumpSymbols[0]?.cx ?? PUMP_CX) - PUMP_R;
  const pumpOutletX = (pumpSymbols[pumpSymbols.length - 1]?.cx ?? PUMP_CX) + PUMP_R;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const dsPressure = downstreamNode.pressure_kPa;
  const upPressure = upstreamNode.pressure_kPa;
  const staticHead = dsElev - upElev;

  // Suction pipe y function (horizontal at upY)
  const suctionYAt = (_x: number) => upY;
  // Discharge pipe y function (sloped from upY to dsY)
  const discDx = DISC_X2 - DISC_X1 || 1;
  const discYAt = (x: number) => upY + ((x - DISC_X1) / discDx) * (dsY - upY);

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-0.5">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Pump Station Schematic — Elevation View
        </p>
        <button
          type="button"
          onClick={handleExportPng}
          className="flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-400 transition-colors"
          title="Download schematic as PNG"
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export PNG
        </button>
      </div>
      <p className="text-[10px] text-slate-400 font-mono px-4 pb-2">
        {isUS ? "US customary" : "SI"} units ·{" "}
        {nDuty}D + {nStandby}S ·{" "}
        {pumpLabel} ·{" "}
        Q = {isUS
          ? `${(draft.designFlow_m3h * 4.40287).toFixed(1)} gpm`
          : `${draft.designFlow_m3h.toFixed(2)} m³/h`}
      </p>

      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          width={SVG_W}
          height={SVG_H}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          aria-label="Pump station elevation schematic"
          style={{ minWidth: SVG_W }}
        >
          {/* ---- Defs ---- */}
          <defs>
            <marker id="arrowTeal" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={TEAL} />
            </marker>
            <marker id="arrowIndigo" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={INDIGO} />
            </marker>
          </defs>

          {/* ---- Clearwell ---- */}
          {hasClearwell ? (
            <ClearwellSection
              cx1={CW_LEFT} cx2={CW_RIGHT}
              floorY={upY} topY={cwTopY}
              LLL_m={clearwellConfig!.LLL_m}
              LWL_m={clearwellConfig!.LWL_m}
              HWL_m={clearwellConfig!.HWL_m}
              HHL_m={clearwellConfig!.HHL_m}
              baseElevM={upElev}
              shape={clearwellConfig!.shape}
              diameter_m={clearwellConfig!.diameter_m}
              length_m={clearwellConfig!.length_m}
              width_m={clearwellConfig!.width_m}
              isUS={isUS}
            />
          ) : (
            <g>
              <rect
                x={CW_LEFT} y={upY - MIN_CW_H}
                width={CW_W} height={MIN_CW_H}
                fill="#f8fafc" stroke={SLATE} strokeWidth={1.5}
                strokeDasharray="4 3" rx={2}
              />
              <text x={(CW_LEFT + CW_RIGHT) / 2} y={upY - MIN_CW_H / 2 - 5}
                textAnchor="middle" fontSize={8} fill="#94a3b8" fontFamily="ui-sans-serif,sans-serif">
                Clearwell
              </text>
              <text x={(CW_LEFT + CW_RIGHT) / 2} y={upY - MIN_CW_H / 2 + 8}
                textAnchor="middle" fontSize={6.5} fill="#94a3b8" fontFamily="ui-sans-serif,sans-serif">
                (configure in Step 4)
              </text>
              <text x={(CW_LEFT + CW_RIGHT) / 2} y={upY - MIN_CW_H - 10}
                textAnchor="middle" fontSize={9} fontWeight="700"
                fontFamily="ui-sans-serif,sans-serif" fill="#334155">
                Clearwell
              </text>
            </g>
          )}

          {/* ---- Upstream node elevation label (left of clearwell floor) ---- */}
          <line
            x1={CW_LEFT - 28} y1={upY} x2={CW_LEFT - 5} y2={upY}
            stroke={TEAL} strokeWidth={1} strokeDasharray="3 2"
          />
          <text x={CW_LEFT - 30} y={upY - 3}
            textAnchor="end" fontSize={7} fontFamily="ui-monospace,monospace" fill={TEAL}>
            {fmtElev(upElev, isUS)}
          </text>
          <text x={CW_LEFT - 30} y={upY + 7}
            textAnchor="end" fontSize={6} fontFamily="ui-sans-serif,sans-serif" fill="#94a3b8">
            {upPressure > 0 ? fmtPressure(upPressure, isUS) : "open"}
          </text>

          {/* ---- Suction pipe ---- */}
          {hasSuction ? (
            <>
              <PipeRun
                x1={SUCTION_X1} x2={pumpInletX}
                y1={upY} y2={upY}
                segments={suction.segments}
                isUS={isUS}
                labelAbove={true}
              />
              <AccessoryStrip
                accessories={suction.accessories}
                x1={SUCTION_X1 + 12} x2={pumpInletX - 12}
                yAt={suctionYAt}
              />
            </>
          ) : (
            <line x1={SUCTION_X1} y1={upY} x2={pumpInletX} y2={upY}
              stroke={PIPE_STR} strokeWidth={2} strokeDasharray="6 4" />
          )}

          {/* ---- Pump assembly ---- */}
          <text x={PUMP_CX} y={upY - PUMP_R - 28}
            textAnchor="middle" fontSize={9} fontWeight="700"
            fontFamily="ui-sans-serif,sans-serif" fill="#334155">
            Pump Assembly
          </text>
          <text x={PUMP_CX} y={upY - PUMP_R - 16}
            textAnchor="middle" fontSize={7.5}
            fontFamily="ui-monospace,monospace" fill={SLATE_DK}>
            {nDuty}× duty{nStandby > 0 ? ` + ${nStandby}× standby` : ""} · {pumpLabel}
          </text>

          {pumpSymbols.map((ps, i) => (
            <PumpSymbol key={i} cx={ps.cx} cy={ps.cy} r={PUMP_R} label={ps.label} standby={ps.standby}
              hasOperatingPoint={!!primaryOp && !ps.standby} />
          ))}

          {/* ---- Operating point callout on pump assembly ---- */}
          {primaryOp && (
            <OperatingPointCallout
              cx={PUMP_CX}
              cy={upY}
              r={PUMP_R}
              Q_m3h={primaryOp.Q_m3h}
              H_m={primaryOp.H_m}
              eta_pct={primaryOp.eta_pct}
              isUS={isUS}
            />
          )}

          {/* Pipe stubs into/out of pump */}
          <line x1={SUCTION_X2} y1={upY} x2={pumpInletX} y2={upY} stroke={PIPE_STR} strokeWidth={1.5} />
          <line x1={pumpOutletX} y1={upY} x2={DISC_X1}   y2={upY} stroke={PIPE_STR} strokeWidth={1.5} />

          {/* Flow arrow on suction */}
          <line
            x1={(SUCTION_X1 + pumpInletX) / 2 - 6}
            y1={upY - PIPE_HALF - 3}
            x2={(SUCTION_X1 + pumpInletX) / 2 + 6}
            y2={upY - PIPE_HALF - 3}
            stroke={TEAL} strokeWidth={1} markerEnd="url(#arrowTeal)"
          />

          {/* ---- Discharge pipe ---- */}
          {hasDischarge ? (
            <>
              <PipeRun
                x1={DISC_X1} x2={DISC_X2}
                y1={upY} y2={dsY}
                segments={discharge.segments}
                isUS={isUS}
                labelAbove={false}
              />
              <AccessoryStrip
                accessories={discharge.accessories}
                x1={DISC_X1 + 12} x2={DISC_X2 - 12}
                yAt={discYAt}
              />
            </>
          ) : (
            <line x1={DISC_X1} y1={upY} x2={DISC_X2} y2={dsY}
              stroke={PIPE_STR} strokeWidth={2} strokeDasharray="6 4" />
          )}

          {/* Flow arrow on discharge */}
          {hasDischarge && (
            <line
              x1={(DISC_X1 + DISC_X2) / 2 - 6}
              y1={discYAt((DISC_X1 + DISC_X2) / 2) + PIPE_HALF + 3}
              x2={(DISC_X1 + DISC_X2) / 2 + 6}
              y2={discYAt((DISC_X1 + DISC_X2) / 2) + PIPE_HALF + 3}
              stroke={TEAL} strokeWidth={1} markerEnd="url(#arrowTeal)"
            />
          )}

          {/* ---- Downstream node ---- */}
          {/* Pipe stub from disc end to node */}
          <line x1={DISC_X2} y1={dsY} x2={DS_CX - DS_R} y2={dsY}
            stroke={PIPE_STR} strokeWidth={2} />
          {/* Node circle */}
          <circle cx={DS_CX} cy={dsY} r={DS_R} fill="#eef2ff" stroke={INDIGO} strokeWidth={2} />
          <text x={DS_CX} y={dsY + 4}
            textAnchor="middle" fontSize={8} fontWeight="700"
            fontFamily="ui-sans-serif,sans-serif" fill={INDIGO}>
            DS
          </text>
          {/* Delivery label */}
          <text x={DS_CX} y={dsY - DS_R - 26}
            textAnchor="middle" fontSize={9} fontWeight="700"
            fontFamily="ui-sans-serif,sans-serif" fill="#334155">
            Delivery Node
          </text>
          <text x={DS_CX} y={dsY - DS_R - 14}
            textAnchor="middle" fontSize={7.5}
            fontFamily="ui-monospace,monospace" fill={INDIGO}>
            {fmtElev(dsElev, isUS)}
          </text>
          <text x={DS_CX} y={dsY - DS_R - 4}
            textAnchor="middle" fontSize={7}
            fontFamily="ui-monospace,monospace" fill={INDIGO} opacity={0.85}>
            {dsPressure > 0 ? fmtPressure(dsPressure, isUS) : "(atmospheric)"}
          </text>

          {/* Static-head annotation arrow (right of DS node) */}
          {Math.abs(staticHead) > 0.05 && (
            <g>
              {/* Vertical arrow from pump CL y to DS y */}
              <line
                x1={DS_CX + DS_R + 16} y1={upY}
                x2={DS_CX + DS_R + 16} y2={dsY}
                stroke={INDIGO} strokeWidth={1}
                strokeDasharray="3 2"
                markerEnd={dsY < upY ? "url(#arrowIndigo)" : undefined}
                markerStart={dsY > upY ? "url(#arrowIndigo)" : undefined}
              />
              {/* Horizontal tick at pump CL */}
              <line x1={DS_CX + DS_R + 11} y1={upY} x2={DS_CX + DS_R + 21} y2={upY}
                stroke={INDIGO} strokeWidth={1} />
              {/* Label */}
              <text
                x={DS_CX + DS_R + 24}
                y={(upY + dsY) / 2 + 4}
                fontSize={7} fontFamily="ui-monospace,monospace" fill={INDIGO}>
                Δh={fmtLen(Math.abs(staticHead), isUS)}
              </text>
            </g>
          )}

          {/* ---- Elevation datum rail ---- */}
          <line
            x1={CW_LEFT} y1={DATUM_Y}
            x2={DS_CX + DS_R + 50} y2={DATUM_Y}
            stroke={SLATE_DK} strokeWidth={1} strokeDasharray="6 3"
          />
          <text x={CW_LEFT} y={DATUM_Y + 12}
            fontSize={7} fontFamily="ui-monospace,monospace" fill={SLATE_DK}>
            DATUM ({fmtElev(minElev, isUS)})
          </text>

          {/* Datum ticks for key elements */}
          <DatumTick
            x={(CW_LEFT + CW_RIGHT) / 2}
            datumY={DATUM_Y} topLabel="CW Base"
            elev={upElev} color={TEAL} isUS={isUS}
          />
          <DatumTick
            x={PUMP_CX}
            datumY={DATUM_Y} topLabel="Pump CL"
            elev={upElev} color={TEAL} isUS={isUS}
          />
          <DatumTick
            x={DS_CX}
            datumY={DATUM_Y} topLabel="Delivery"
            elev={dsElev} color={INDIGO} isUS={isUS}
          />

          {/* Vertical projection lines from elements to datum */}
          <line x1={(CW_LEFT + CW_RIGHT) / 2} y1={upY}   x2={(CW_LEFT + CW_RIGHT) / 2} y2={DATUM_Y}
            stroke={TEAL}   strokeWidth={0.5} strokeDasharray="2 3" opacity={0.5} />
          <line x1={PUMP_CX}                  y1={upY}   x2={PUMP_CX}                  y2={DATUM_Y}
            stroke={TEAL}   strokeWidth={0.5} strokeDasharray="2 3" opacity={0.5} />
          <line x1={DS_CX}                    y1={dsY}   x2={DS_CX}                    y2={DATUM_Y}
            stroke={INDIGO} strokeWidth={0.5} strokeDasharray="2 3" opacity={0.5} />

          {/* ---- Legend ---- */}
          <g transform={`translate(${SVG_W - 218}, ${SVG_H - 100})`}>
            <rect width={208} height={92} rx={4} fill="#f8fafc" stroke={SLATE} strokeWidth={1} />
            <text x={8} y={14} fontSize={7.5} fontWeight="700"
              fontFamily="ui-sans-serif,sans-serif" fill={SLATE_DK}>
              Legend
            </text>
            <GateValveSymbol cx={18} cy={28} r={6} />
            <text x={30} y={31} fontSize={7} fontFamily="ui-sans-serif,sans-serif" fill={SLATE_DK}>Gate / Isolation valve</text>
            <CheckValveSymbol cx={18} cy={46} r={6} />
            <text x={30} y={49} fontSize={7} fontFamily="ui-sans-serif,sans-serif" fill={SLATE_DK}>Check valve</text>
            <GenericFittingSymbol cx={18} cy={63} r={5} label="XX" />
            <text x={30} y={66} fontSize={7} fontFamily="ui-sans-serif,sans-serif" fill={SLATE_DK}>Other fitting</text>
            <circle cx={110} cy={28} r={7} fill={TEAL_LIGHT} stroke={TEAL} strokeWidth={1.5} />
            <text x={122} y={31} fontSize={7} fontFamily="ui-sans-serif,sans-serif" fill={SLATE_DK}>Duty pump</text>
            <circle cx={110} cy={46} r={7} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={1.5} opacity={0.6} />
            <text x={122} y={49} fontSize={7} fontFamily="ui-sans-serif,sans-serif" fill={SLATE_DK}>Standby pump</text>
            <rect x={104} y={57} width={12} height={8} fill={TEAL_LIGHT} stroke={TEAL} strokeWidth={1} rx={1} />
            <text x={122} y={64} fontSize={7} fontFamily="ui-sans-serif,sans-serif" fill={SLATE_DK}>Operating zone</text>
          </g>
        </svg>
      </div>

      {/* ---- Text summary ---- */}
      <div className="px-4 pb-3 pt-1 grid grid-cols-3 gap-x-6 gap-y-1 text-[10px] font-mono text-slate-500 border-t border-slate-100">
        <div>
          <span className="font-semibold text-slate-600">Upstream:</span>{" "}
          {fmtElev(upElev, isUS)}{upPressure > 0 ? ` · ${fmtPressure(upPressure, isUS)}` : ""}
        </div>
        <div>
          <span className="font-semibold text-slate-600">Downstream:</span>{" "}
          {fmtElev(dsElev, isUS)}{dsPressure > 0 ? ` · ${fmtPressure(dsPressure, isUS)}` : ""}
        </div>
        <div>
          <span className="font-semibold text-slate-600">Static head:</span>{" "}
          {fmtLen(staticHead, isUS)}
        </div>
        <div className="col-span-2">
          <span className="font-semibold text-slate-600">Suction:</span>{" "}
          {suction.segments.length > 0
            ? suction.segments.map((s, i) => `${i > 0 ? "→ " : ""}${fmtDiam(s.diameter_mm, isUS)} ${fmtLen(s.length_m, isUS)}`).join(" ")
            : "—"}
        </div>
        <div>
          <span className="font-semibold text-slate-600">Suction acc.:</span>{" "}
          {suction.accessories.filter(a => a.count > 0).length || "none"}
        </div>
        <div className="col-span-2">
          <span className="font-semibold text-slate-600">Discharge:</span>{" "}
          {discharge.segments.length > 0
            ? discharge.segments.map((s, i) => `${i > 0 ? "→ " : ""}${fmtDiam(s.diameter_mm, isUS)} ${fmtLen(s.length_m, isUS)}`).join(" ")
            : "—"}
        </div>
        <div>
          <span className="font-semibold text-slate-600">Discharge acc.:</span>{" "}
          {discharge.accessories.filter(a => a.count > 0).length || "none"}
        </div>
      </div>
    </div>
  );
}
