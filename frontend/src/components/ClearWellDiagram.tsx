import { useMemo } from "react";
import { FT_PER_M } from "../utils/units";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PumpStage {
  stage: number;
  Q_pump_m3h: number;
  label: string;
}

interface ClearWellDiagramProps {
  shape: "cylindrical" | "rectangular";
  diameter_m?: number;
  length_m?: number;
  width_m?: number;
  LLL_m: number;
  LWL_m: number;
  HWL_m: number;
  HHL_m: number;
  pump_stages: PumpStage[];
  max_cycles_per_hour: number;
  isUS?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function crossSectionArea(
  shape: "cylindrical" | "rectangular",
  diameter_m?: number,
  length_m?: number,
  width_m?: number
): number | null {
  if (shape === "cylindrical") {
    if (!diameter_m || diameter_m <= 0) return null;
    return (Math.PI / 4) * diameter_m * diameter_m;
  }
  if (shape === "rectangular") {
    if (!length_m || length_m <= 0 || !width_m || width_m <= 0) return null;
    return length_m * width_m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// SVG constants
// ---------------------------------------------------------------------------

const SVG_W = 280;
const SVG_H = 340;
const TANK_X = 68;       // left wall x
const TANK_W = 130;      // tank inner width in SVG px
const TANK_TOP = 28;     // top of tank in SVG px
const TANK_BOT = 300;    // bottom of tank in SVG px
const TANK_H = TANK_BOT - TANK_TOP;

const LABEL_LEFT = TANK_X - 6;   // right-align labels to the left
const BADGE_RIGHT = TANK_X + TANK_W + 6; // left edge of right badges

// Level colours
const BAND_COLORS = {
  dead:      { fill: "#fef3c7", stroke: "#f59e0b" }, // amber — dead zone below LWL
  operating: { fill: "#ccfbf1", stroke: "#0d9488" }, // teal  — LWL→HWL
  alarm:     { fill: "#fee2e2", stroke: "#ef4444" }, // red   — HWL→HHL
  empty:     { fill: "#f8fafc", stroke: "none" },    // above HHL or below LLL
};

const LEVEL_COLORS: Record<string, { line: string; text: string }> = {
  LLL: { line: "#f59e0b", text: "#92400e" },
  LWL: { line: "#0d9488", text: "#115e59" },
  HWL: { line: "#0d9488", text: "#115e59" },
  HHL: { line: "#ef4444", text: "#7f1d1d" },
};

// Pump stage V_req band colours (cycle through a palette)
const V_REQ_COLORS = [
  { fill: "rgba(13,148,136,0.25)", stroke: "#0d9488" },
  { fill: "rgba(59,130,246,0.25)", stroke: "#3b82f6" },
  { fill: "rgba(168,85,247,0.25)", stroke: "#a855f7" },
  { fill: "rgba(249,115,22,0.25)", stroke: "#f97316" },
];

const FT3_PER_M3 = FT_PER_M * FT_PER_M * FT_PER_M; // 35.3147 ft³/m³

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClearWellDiagram({
  shape,
  diameter_m,
  length_m,
  width_m,
  LLL_m,
  LWL_m,
  HWL_m,
  HHL_m,
  pump_stages,
  max_cycles_per_hour,
  isUS = false,
}: ClearWellDiagramProps) {
  const area = crossSectionArea(shape, diameter_m, length_m, width_m);

  // Validate level ordering — render a placeholder if invalid
  const levelsValid =
    Number.isFinite(LLL_m) &&
    Number.isFinite(LWL_m) &&
    Number.isFinite(HWL_m) &&
    Number.isFinite(HHL_m) &&
    LLL_m < LWL_m &&
    LWL_m < HWL_m &&
    HWL_m < HHL_m;

  // Map a real-world level (m) to SVG y coordinate
  const toY = useMemo(() => {
    if (!levelsValid) return (_: number) => TANK_BOT;
    const totalM = HHL_m - LLL_m;
    return (level_m: number) => {
      const frac = (level_m - LLL_m) / totalM;
      return TANK_BOT - frac * TANK_H;
    };
  }, [levelsValid, LLL_m, HHL_m]);

  // V_req bands per pump stage
  const vReqBands = useMemo(() => {
    if (!levelsValid || area === null || area <= 0) return [];
    return pump_stages
      .filter((s) => s.Q_pump_m3h > 0 && max_cycles_per_hour >= 1)
      .map((s, i) => {
        const V_req = (s.Q_pump_m3h / 3600) * 900 / max_cycles_per_hour; // m³
        const h_req = V_req / area; // m
        const topLevel = Math.min(LWL_m + h_req, HWL_m);
        return {
          key: `${s.stage}-${i}`,
          label: s.label || `Stage ${s.stage}`,
          Q_pump_m3h: s.Q_pump_m3h,
          V_req: V_req,
          h_req: h_req,
          yTop: toY(topLevel),
          yBot: toY(LWL_m),
          color: V_REQ_COLORS[i % V_REQ_COLORS.length],
          exceedsOp: LWL_m + h_req > HWL_m,
        };
      });
  }, [levelsValid, area, pump_stages, max_cycles_per_hour, LWL_m, HWL_m, HHL_m, toY]);

  if (!levelsValid) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 h-64 text-xs text-slate-400 text-center px-4">
        <svg
          width="48"
          height="48"
          viewBox="0 0 48 48"
          fill="none"
          className="mb-2 opacity-30"
        >
          <rect x="8" y="4" width="32" height="40" rx="2" stroke="#94a3b8" strokeWidth="2" />
          <line x1="8" y1="36" x2="40" y2="36" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="8" y1="24" x2="40" y2="24" stroke="#94a3b8" strokeWidth="1.5" />
          <line x1="8" y1="16" x2="40" y2="16" stroke="#94a3b8" strokeWidth="1.5" />
        </svg>
        <p className="font-medium text-slate-500">Level diagram</p>
        <p className="mt-0.5">Enter valid levels with LLL &lt; LWL &lt; HWL &lt; HHL</p>
      </div>
    );
  }

  const yLLL = toY(LLL_m);
  const yLWL = toY(LWL_m);
  const yHWL = toY(HWL_m);
  const yHHL = toY(HHL_m);

  const wallLeft  = TANK_X;
  const wallRight = TANK_X + TANK_W;

  const lenUnit  = isUS ? "ft" : "m";
  const areaUnit = isUS ? "ft²" : "m²";

  // Geometry label for subtitle
  let geomLabel = "";
  if (shape === "cylindrical" && diameter_m) {
    const dDisp = isUS ? (diameter_m * FT_PER_M).toFixed(2) : diameter_m.toFixed(1);
    geomLabel = `Ø ${dDisp} ${lenUnit} cylindrical`;
    if (area !== null) {
      const aDisp = isUS ? (area * FT_PER_M * FT_PER_M).toFixed(2) : area.toFixed(2);
      geomLabel += ` · A = ${aDisp} ${areaUnit}`;
    }
  } else if (shape === "rectangular" && length_m && width_m) {
    const lDisp = isUS ? (length_m * FT_PER_M).toFixed(2) : length_m.toFixed(1);
    const wDisp = isUS ? (width_m * FT_PER_M).toFixed(2) : width_m.toFixed(1);
    geomLabel = `${lDisp} × ${wDisp} ${lenUnit} rectangular`;
    if (area !== null) {
      const aDisp = isUS ? (area * FT_PER_M * FT_PER_M).toFixed(2) : area.toFixed(2);
      geomLabel += ` · A = ${aDisp} ${areaUnit}`;
    }
  }

  const fmtLevel = (m: number) =>
    isUS ? `${(m * FT_PER_M).toFixed(2)} ft` : `${m.toFixed(2)} m`;

  const fmtVol = (m3: number) =>
    isUS ? `${(m3 * FT3_PER_M3).toFixed(1)} ft³` : `${m3.toFixed(1)} m³`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 px-4 pt-3 pb-0.5">
        Tank Level Diagram
      </p>
      {geomLabel && (
        <p className="text-xs text-slate-400 font-mono px-4 pb-2">{geomLabel}</p>
      )}
      <div className="flex justify-center pb-3">
        <svg
          width={SVG_W}
          height={SVG_H}
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          aria-label="Clear well tank cross-section diagram"
        >
          {/* ---- Background fill zones ---- */}

          {/* Dead zone: LLL → LWL (amber) */}
          <rect
            x={wallLeft + 1}
            y={yLWL}
            width={TANK_W - 2}
            height={yLLL - yLWL}
            fill={BAND_COLORS.dead.fill}
          />

          {/* Operating zone: LWL → HWL (teal) */}
          <rect
            x={wallLeft + 1}
            y={yHWL}
            width={TANK_W - 2}
            height={yLWL - yHWL}
            fill={BAND_COLORS.operating.fill}
          />

          {/* Alarm zone: HWL → HHL (red) */}
          <rect
            x={wallLeft + 1}
            y={yHHL}
            width={TANK_W - 2}
            height={yHWL - yHHL}
            fill={BAND_COLORS.alarm.fill}
          />

          {/* ---- V_req bands (overlaid in operating zone) ---- */}
          {vReqBands.map((b) => (
            <g key={b.key}>
              <rect
                x={wallLeft + 1}
                y={b.yTop}
                width={TANK_W - 2}
                height={b.yBot - b.yTop}
                fill={b.color.fill}
                stroke={b.color.stroke}
                strokeWidth={1}
                strokeDasharray="3 2"
              />
            </g>
          ))}

          {/* ---- Tank walls ---- */}
          {/* Left wall */}
          <rect x={wallLeft - 5} y={TANK_TOP} width={6} height={TANK_BOT - TANK_TOP + 5} fill="#cbd5e1" rx={2} />
          {/* Right wall */}
          <rect x={wallRight} y={TANK_TOP} width={6} height={TANK_BOT - TANK_TOP + 5} fill="#cbd5e1" rx={2} />
          {/* Floor */}
          <rect x={wallLeft - 5} y={TANK_BOT} width={TANK_W + 11} height={6} fill="#cbd5e1" rx={2} />

          {/* ---- Level lines + labels ---- */}
          {(
            [
              { key: "LLL", y: yLLL, level: LLL_m, label: "LLL", desc: "Low-Low" },
              { key: "LWL", y: yLWL, level: LWL_m, label: "LWL", desc: "Pump start" },
              { key: "HWL", y: yHWL, level: HWL_m, label: "HWL", desc: "Pump stop" },
              { key: "HHL", y: yHHL, level: HHL_m, label: "HHL", desc: "Overflow" },
            ] as const
          ).map(({ key, y, level, label, desc }) => {
            const col = LEVEL_COLORS[key];
            return (
              <g key={key}>
                {/* Dashed level line */}
                <line
                  x1={wallLeft - 5}
                  y1={y}
                  x2={wallRight + 6}
                  y2={y}
                  stroke={col.line}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
                {/* Left-side label group */}
                <text
                  x={LABEL_LEFT}
                  y={y - 2}
                  textAnchor="end"
                  fontSize={9}
                  fontWeight="700"
                  fontFamily="ui-monospace, monospace"
                  fill={col.text}
                >
                  {label}
                </text>
                <text
                  x={LABEL_LEFT}
                  y={y + 8}
                  textAnchor="end"
                  fontSize={8}
                  fontFamily="ui-monospace, monospace"
                  fill={col.text}
                  opacity={0.75}
                >
                  {fmtLevel(level)}
                </text>
                {/* Right-side description badge */}
                <text
                  x={BADGE_RIGHT}
                  y={y + 3}
                  textAnchor="start"
                  fontSize={8}
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                  fill={col.text}
                  opacity={0.8}
                >
                  {desc}
                </text>
              </g>
            );
          })}

          {/* ---- Operating zone centre label ---- */}
          {yLWL - yHWL > 24 && (
            <text
              x={wallLeft + TANK_W / 2}
              y={(yLWL + yHWL) / 2 + 4}
              textAnchor="middle"
              fontSize={9}
              fontWeight="600"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fill="#115e59"
              opacity={0.9}
            >
              Operating band
            </text>
          )}

          {/* ---- Dead zone centre label ---- */}
          {yLLL - yLWL > 20 && (
            <text
              x={wallLeft + TANK_W / 2}
              y={(yLLL + yLWL) / 2 + 4}
              textAnchor="middle"
              fontSize={8}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fill="#92400e"
              opacity={0.8}
            >
              Dead zone
            </text>
          )}

          {/* ---- Alarm zone centre label ---- */}
          {yHWL - yHHL > 18 && (
            <text
              x={wallLeft + TANK_W / 2}
              y={(yHWL + yHHL) / 2 + 4}
              textAnchor="middle"
              fontSize={8}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fill="#7f1d1d"
              opacity={0.8}
            >
              Alarm zone
            </text>
          )}

          {/* ---- V_req band labels (inside operating zone, right side) ---- */}
          {vReqBands.map((b) => {
            const bandH = b.yBot - b.yTop;
            if (bandH < 10) return null;
            const textY = b.yTop + Math.min(bandH / 2, 12);
            return (
              <text
                key={b.key}
                x={wallLeft + TANK_W - 4}
                y={textY}
                textAnchor="end"
                fontSize={7.5}
                fontFamily="ui-monospace, monospace"
                fill={b.color.stroke}
                opacity={0.9}
              >
                {`${b.label} V_req=${fmtVol(b.V_req)}`}
              </text>
            );
          })}

          {/* ---- Top of tank cap (open) ---- */}
          <line
            x1={wallLeft - 5}
            y1={TANK_TOP}
            x2={wallLeft - 5}
            y2={TANK_TOP - 8}
            stroke="#cbd5e1"
            strokeWidth={3}
            strokeLinecap="round"
          />
          <line
            x1={wallRight + 6}
            y1={TANK_TOP}
            x2={wallRight + 6}
            y2={TANK_TOP - 8}
            stroke="#cbd5e1"
            strokeWidth={3}
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* ---- Legend ---- */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: BAND_COLORS.dead.fill, border: `1px solid ${BAND_COLORS.dead.stroke}` }} />
          Dead zone
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: BAND_COLORS.operating.fill, border: `1px solid ${BAND_COLORS.operating.stroke}` }} />
          Operating band
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ background: BAND_COLORS.alarm.fill, border: `1px solid ${BAND_COLORS.alarm.stroke}` }} />
          Alarm zone
        </span>
        {vReqBands.map((b) => (
          <span key={b.key} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ background: b.color.fill, border: `1px dashed ${b.color.stroke}` }}
            />
            {b.label} V_req
          </span>
        ))}
      </div>

      {/* ---- Warnings for V_req exceeding operating band ---- */}
      {vReqBands.some((b) => b.exceedsOp) && (
        <div className="mx-4 mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-0.5">
          {vReqBands
            .filter((b) => b.exceedsOp)
            .map((b) => (
              <p key={b.key}>
                <span className="font-semibold">{b.label}:</span> V_req{" "}
                {fmtVol(b.V_req)} exceeds the operating band — operating
                volume is insufficient for the motor start limit.
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
