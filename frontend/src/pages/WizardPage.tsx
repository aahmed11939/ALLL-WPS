import { useState, useRef, useEffect, type MutableRefObject } from "react";
import { useUser } from "@clerk/react";
import wpsLogo from "../assets/WPS_Logo_1778184724504.png";
import { useProject } from "../contexts/ProjectContext";
import { useUnitSystem } from "../contexts/UnitSystemContext";
import ResultsStrip from "../components/ResultsStrip";
import { hadStoredSession } from "../contexts/ProjectContext";
import { SAMPLE_PROJECT } from "../data/sampleProject";
import { SAMPLE_PROJECT_VT } from "../data/sampleProjectVT";
import { SAMPLE_PROJECT_BOOSTER } from "../data/sampleProjectBooster";
import type { ProjectDraft } from "../types/project";
import { DEFAULT_DRAFT } from "../types/project";
import { calculate, saveProject, updateProject, type ProjectLoadResponse } from "../utils/api";

import StepMeta        from "../components/wizard/StepMeta";
import StepNodes       from "../components/wizard/StepNodes";
import StepPipeline    from "../components/wizard/StepPipeline";
import StepWetWell     from "../components/wizard/StepWetWell";
import StepPump        from "../components/wizard/StepPump";
import StepHydraulics  from "../components/wizard/StepHydraulics";
import StepCurves      from "../components/wizard/StepCurves";
import StepWaterHammer from "../components/wizard/StepWaterHammer";
import StepChecks      from "../components/wizard/StepChecks";
import StepExports     from "../components/wizard/StepExports";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

interface StepDef {
  label: string;
  shortLabel: string;
  badge?: string;
}

const BASE_STEPS: StepDef[] = [
  { label: "Project Setup",              shortLabel: "Setup",      badge: "Meta"  },
  { label: "System Nodes",               shortLabel: "Nodes",      badge: "Elev"  },
  { label: "Suction Pipeline",           shortLabel: "Suction",    badge: "Pipe"  },
  { label: "Clear Well Sizing",           shortLabel: "Clear Well", badge: "CW"    },
  { label: "Pump Selection & Curves",    shortLabel: "Pump",       badge: "H-Q"   },
  { label: "Discharge Pipeline",         shortLabel: "Discharge",  badge: "Pipe"  },
  { label: "Hydraulic Results",          shortLabel: "Hydraulics", badge: "TDH"   },
  { label: "System Curve & Op. Point",   shortLabel: "Sys Curve",  badge: "Q*H*"  },
  { label: "Water Hammer",               shortLabel: "WH Surge",   badge: "Surge" },
  { label: "Engineering Checks",         shortLabel: "Checks",     badge: "✓ Eng" },
  { label: "Summary & Export",           shortLabel: "Export",     badge: "Report"},
];

function buildSteps(includeSurge: boolean): StepDef[] {
  return includeSurge ? BASE_STEPS : BASE_STEPS.filter((s) => s.badge !== "Surge");
}

// ---------------------------------------------------------------------------
// Per-step validation
// ---------------------------------------------------------------------------

function validateStep(step: number, draft: ProjectDraft): string | null {
  switch (step) {
    case 0:
      if (!draft.meta.name.trim())
        return "Please enter a project name before continuing.";
      return null;
    case 1:
      if (isNaN(draft.upstreamNode.elevation_m) || isNaN(draft.downstreamNode.elevation_m))
        return "Please enter valid elevations for both nodes.";
      return null;
    case 2:
      if (draft.suction.segments.length === 0)
        return "Please add at least one suction pipeline segment.";
      if (draft.suction.segments.some((s) => s.diameter_mm <= 0 || s.length_m <= 0))
        return "All suction segments must have a positive diameter and length.";
      return null;
    case 5:
      if (draft.discharge.segments.length === 0)
        return "Please add at least one discharge pipeline segment.";
      if (draft.discharge.segments.some((s) => s.diameter_mm <= 0 || s.length_m <= 0))
        return "All discharge segments must have a positive diameter and length.";
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Step content — ordered to match BASE_STEPS, surge entry conditionally included
// ---------------------------------------------------------------------------

const ALL_STEP_CONTENTS = [
  <StepMeta />,
  <StepNodes />,
  <StepPipeline label="suction" />,
  <StepWetWell />,
  <StepPump />,
  <StepPipeline label="discharge" />,
  <StepHydraulics />,
  <StepCurves />,
  <StepWaterHammer />,   // index 8 — conditionally removed when !includeSurge
  <StepChecks />,
  <StepExports />,
];
const SURGE_STEP_INDEX = 8;

function StepContent({ index, includeSurge }: { index: number; includeSurge: boolean }) {
  const contents = includeSurge
    ? ALL_STEP_CONTENTS
    : ALL_STEP_CONTENTS.filter((_, i) => i !== SURGE_STEP_INDEX);
  return contents[index] ?? null;
}

// ---------------------------------------------------------------------------
// Sidebar step item
// ---------------------------------------------------------------------------

function SidebarStep({
  index,
  step,
  active,
  visited,
  hasError,
  onClick,
}: {
  index: number;
  step: StepDef;
  active: boolean;
  visited: boolean;
  hasError: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-lg transition-all group ${
        active
          ? "bg-teal-700 text-white"
          : "hover:bg-slate-100 text-slate-600"
      }`}
    >
      <span
        className={`shrink-0 h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
          hasError
            ? "bg-rose-100 text-rose-600"
            : active
            ? "bg-white text-teal-700"
            : visited
            ? "bg-teal-100 text-teal-700"
            : "bg-slate-200 text-slate-500 group-hover:bg-slate-300"
        }`}
      >
        {hasError ? "!" : visited && !active ? "✓" : index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold leading-tight truncate ${active ? "text-white" : ""}`}>
          {step.shortLabel}
        </p>
        {step.badge && (
          <p className={`text-[10px] font-mono leading-none mt-0.5 ${active ? "text-teal-200" : "text-slate-400"}`}>
            {step.badge}
          </p>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Restore banner
// ---------------------------------------------------------------------------

function RestoreBanner({ projectName, onDismiss }: { projectName: string; onDismiss: () => void }) {
  return (
    <div className="border-b border-teal-200 bg-teal-50 px-4 py-2 flex items-center gap-3">
      <svg className="h-4 w-4 text-teal-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      <p className="text-xs text-teal-800 flex-1">
        <strong>Session restored</strong> — previous project{" "}
        <em>&ldquo;{projectName}&rdquo;</em> loaded from your last session.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="text-teal-500 hover:text-teal-700 text-sm leading-none px-1"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main WizardPage
// ---------------------------------------------------------------------------

type WizardMode = "resume" | "new" | "open" | "import";

interface WizardPageProps {
  /** A project loaded from the server that should be injected on mount. */
  pendingProject?: ProjectLoadResponse | null;
  /**
   * Controls how the wizard initialises on mount:
   * - "resume"  — restore whatever is in context/localStorage (default)
   * - "new"     — reset to a blank DEFAULT_DRAFT immediately
   * - "open"    — load pendingProject from the server
   * - "import"  — open the file picker immediately (handled by importTriggerRef timing)
   */
  wizardMode?: WizardMode;
  /** Navigate back to the projects landing page. */
  onGoToLanding?: () => void;
  /** A ref whose `.current` is wired to the hidden file input's click handler. */
  importTriggerRef?: MutableRefObject<(() => void) | null>;
}

export default function WizardPage({
  pendingProject,
  wizardMode = "resume",
  onGoToLanding,
  importTriggerRef,
}: WizardPageProps = {}) {
  const { user } = useUser();
  const ownerEmail = user?.primaryEmailAddress?.emailAddress ?? "";
  const { draft, dispatch, loadJSON } = useProject();
  const { setUnitSystem, setShowBoth } = useUnitSystem();

  const STEPS = buildSteps(draft.includeSurge ?? true);

  const [currentStep, setCurrentStep] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0]));
  const [stepErrors, setStepErrors] = useState<Record<number, string>>({});
  const [navError, setNavError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showRestoreBanner, setShowRestoreBanner] = useState(
    () => !pendingProject && hadStoredSession()
  );
  /**
   * Incremented on every Load / New / Sample action. Passed as part of each
   * step wrapper's React key so all step components remount — ensuring they
   * rehydrate from the freshly-loaded ProjectDraft (initialConfig props).
   */
  const [projectVersion, setProjectVersion] = useState(0);
  const [showSampleMenu, setShowSampleMenu] = useState(false);

  // Server save state
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFileRef  = useRef<HTMLInputElement>(null);
  const contentRef   = useRef<HTMLDivElement>(null);
  const sampleBtnRef = useRef<HTMLDivElement>(null);

  // Wire the import trigger ref so App.tsx can programmatically open the file picker
  useEffect(() => {
    if (importTriggerRef) {
      importTriggerRef.current = () => loadFileRef.current?.click();
    }
    return () => {
      if (importTriggerRef) importTriggerRef.current = null;
    };
  }, [importTriggerRef]);

  // Mount-time initialisation — runs exactly once, driven by wizardMode
  useEffect(() => {
    if (wizardMode === "open" && pendingProject) {
      // Load a project fetched from the server
      const result = loadJSON(JSON.stringify(pendingProject.data));
      if (result.ok && result.loaded) {
        setUnitSystem(result.loaded.unitSystem);
        setShowBoth(result.loaded.showBoth);
        setCurrentSlug(pendingProject.slug);
        setVisitedSteps(new Set([0]));
        setCurrentStep(0);
        setStepErrors({});
        setNavError(null);
        setShowRestoreBanner(false);
        setProjectVersion((v) => v + 1);
      }
    } else if (wizardMode === "new") {
      // Explicitly blank the draft so prior in-memory state is cleared
      const blank: ProjectDraft = {
        ...DEFAULT_DRAFT,
        meta: { ...DEFAULT_DRAFT.meta, date: new Date().toISOString().slice(0, 10) },
      };
      dispatch({ type: "LOAD", draft: blank });
      setUnitSystem(blank.unitSystem);
      setShowBoth(blank.showBoth);
      setCurrentSlug(null);
      setVisitedSteps(new Set([0]));
      setCurrentStep(0);
      setStepErrors({});
      setNavError(null);
      setShowRestoreBanner(false);
      setProjectVersion((v) => v + 1);
    } else {
      // "resume" or "import" — use whatever is already in the context
      setUnitSystem(draft.unitSystem);
      setShowBoth(draft.showBoth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToStep = (idx: number) => {
    setNavError(null);
    setVisitedSteps((prev) => new Set([...prev, idx]));
    setCurrentStep(idx);
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNext = () => {
    const err = validateStep(currentStep, draft);
    if (err) {
      setNavError(err);
      setStepErrors((prev) => ({ ...prev, [currentStep]: err }));
      return;
    }
    // Clear any prior error for this step
    setStepErrors((prev) => {
      const next = { ...prev };
      delete next[currentStep];
      return next;
    });
    setNavError(null);
    if (currentStep < STEPS.length - 1) goToStep(currentStep + 1);
  };

  const handleBack = () => {
    setNavError(null);
    if (currentStep > 0) goToStep(currentStep - 1);
  };

  // ---------- Save to server ----------
  const handleSaveToServer = async () => {
    if (saving) return;
    setSaving(true);
    setSaveStatus("idle");
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    try {
      const data = draft as unknown as Record<string, unknown>;
      let row;
      if (currentSlug) {
        row = await updateProject(currentSlug, data, ownerEmail || undefined);
      } else {
        row = await saveProject(data, ownerEmail || undefined);
        setCurrentSlug(row.slug);
      }
      setSaveStatus("saved");
    } catch (err) {
      console.error("[Save] project save failed:", err);
      setSaveStatus("error");
    } finally {
      setSaving(false);
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus("idle"), 3000);
    }
  };

  // ---------- Load JSON ----------
  const handleLoadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLoadError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const json = ev.target?.result as string;
      const result = loadJSON(json);
      if (!result.ok || !result.loaded) {
        setLoadError(`Invalid project file — ${result.error ?? "could not parse JSON."}`);
      } else {
        setUnitSystem(result.loaded.unitSystem);
        setShowBoth(result.loaded.showBoth);
        setCurrentSlug(null);
        setVisitedSteps(new Set([0]));
        setCurrentStep(0);
        setStepErrors({});
        setNavError(null);
        setShowRestoreBanner(false);
        setProjectVersion((v) => v + 1);
        setSaveStatus("idle");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ---------- Load sample ----------
  const SAMPLES: { label: string; desc: string; draft: ProjectDraft }[] = [
    {
      label: "Split-case VFD",
      desc:  "DN150 PVC · 2 duty + 1 standby · 36 m³/h",
      draft: SAMPLE_PROJECT,
    },
    {
      label: "Vertical turbine",
      desc:  "DN200 · deep clearwell · 50 m³/h",
      draft: SAMPLE_PROJECT_VT,
    },
    {
      label: "Pressure booster set",
      desc:  "DN100 inline · lead-lag · 550 kPa setpoint",
      draft: SAMPLE_PROJECT_BOOSTER,
    },
  ];

  const loadSample = async (sample: ProjectDraft) => {
    dispatch({ type: "LOAD", draft: sample });
    setUnitSystem(sample.unitSystem);
    setShowBoth(sample.showBoth);
    setVisitedSteps(new Set([0]));
    setCurrentStep(0);
    setStepErrors({});
    setNavError(null);
    setShowRestoreBanner(false);
    setProjectVersion((v) => v + 1);
    setShowSampleMenu(false);

    // Auto-compute hydraulics so results appear immediately on load
    const suctionSegs   = sample.suction.segments;
    const dischargeSegs = sample.discharge.segments;
    const primarySeg    = dischargeSegs[0] ?? suctionSegs[0];
    if (!primarySeg) return;
    const totalLength = [...suctionSegs, ...dischargeSegs].reduce((a, s) => a + s.length_m, 0);
    try {
      const result = await calculate({
        Q_m3h:            sample.designFlow_m3h,
        elev_us_m:        sample.upstreamNode.elevation_m,
        elev_ds_m:        sample.downstreamNode.elevation_m,
        pipe_length_m:    totalLength,
        pipe_diameter_mm: primarySeg.diameter_mm,
        material:         primarySeg.material,
        K_values:         [],
        unit_system:      sample.unitSystem,
      });
      dispatch({ type: "SET_HYDRAULICS", result, error: null });
    } catch {
      // Silent — user can manually compute if auto-compute fails
    }
  };

  // ---------- New project ----------
  const handleNew = () => {
    const blank: ProjectDraft = {
      ...DEFAULT_DRAFT,
      meta: { ...DEFAULT_DRAFT.meta, date: new Date().toISOString().slice(0, 10) },
    };
    dispatch({ type: "LOAD", draft: blank });
    setUnitSystem(blank.unitSystem);
    setShowBoth(blank.showBoth);
    setCurrentSlug(null);
    setVisitedSteps(new Set([0]));
    setCurrentStep(0);
    setStepErrors({});
    setNavError(null);
    setShowRestoreBanner(false);
    setProjectVersion((v) => v + 1);
    setSaveStatus("idle");
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-slate-50">

      {/* ===== TOP TOOLBAR ===== */}
      <header className="shrink-0 border-b border-slate-200 bg-white shadow-sm z-10">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <img
            src={wpsLogo}
            alt="WPS logo"
            className="h-9 w-auto shrink-0"
          />
          <div className="hidden sm:block">
            <p className="text-sm font-bold text-slate-900 leading-tight">ALLL WPS Designer</p>
            <p className="text-[10px] text-slate-400 font-mono leading-none">
              Municipal Drinking-Water Pump Station
            </p>
          </div>

          <div className="ml-3 flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 min-w-0">
            <span className="text-[10px] text-slate-400 font-mono shrink-0">PROJECT</span>
            <span className="text-xs font-semibold text-slate-700 truncate max-w-[200px]">
              {draft.meta.name || "Untitled"}
            </span>
          </div>

          {/* Interactive unit-system toggle */}
          <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 overflow-hidden shrink-0">
            {(["SI", "US"] as const).map((sys) => (
              <button
                key={sys}
                type="button"
                onClick={() => {
                  setUnitSystem(sys);
                  dispatch({ type: "SET_UNIT_SYSTEM", unitSystem: sys });
                }}
                className={`px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  draft.unitSystem === sys
                    ? "bg-teal-700 text-white"
                    : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {sys}
              </button>
            ))}
          </div>

          {/* Show both units checkbox */}
          <label className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={draft.showBoth}
              onChange={e => {
                setShowBoth(e.target.checked);
                dispatch({ type: "SET_SHOW_BOTH", showBoth: e.target.checked });
              }}
              className="accent-teal-700"
            />
            <span className="hidden sm:inline">Both units</span>
          </label>

          <div className="ml-auto flex items-center gap-2">
            {loadError && (
              <span className="text-xs text-rose-600 font-medium">{loadError}</span>
            )}

            {/* Open Project (back to landing page) */}
            {onGoToLanding && (
              <button
                type="button"
                onClick={onGoToLanding}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50 transition-colors flex items-center gap-1.5"
                title="Browse saved projects"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                Open Project
              </button>
            )}

            <button
              type="button"
              onClick={handleNew}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:border-slate-400 hover:bg-slate-50 transition-colors"
            >
              New
            </button>

            {/* Save to server */}
            <button
              type="button"
              onClick={handleSaveToServer}
              disabled={saving}
              className={`rounded border px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                saveStatus === "saved"
                  ? "border-teal-400 bg-teal-50 text-teal-700"
                  : saveStatus === "error"
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-teal-500 bg-teal-600 text-white hover:bg-teal-500"
              } disabled:opacity-60 disabled:cursor-not-allowed`}
              title={currentSlug ? "Update saved project" : "Save project to server"}
            >
              {saving ? (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : saveStatus === "saved" ? (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
              )}
              {saveStatus === "saved" ? "Saved!" : saveStatus === "error" ? "Error" : "Save"}
            </button>

            <div ref={sampleBtnRef} className="relative">
              <button
                type="button"
                onClick={() => setShowSampleMenu((v) => !v)}
                className="rounded border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100 transition-colors flex items-center gap-1"
              >
                Load Sample
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showSampleMenu && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setShowSampleMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-30 w-64 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                      Choose a sample project
                    </p>
                    {SAMPLES.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => loadSample(s.draft)}
                        className="w-full text-left px-3 py-2 hover:bg-teal-50 transition-colors"
                      >
                        <p className="text-xs font-semibold text-slate-800">{s.label}</p>
                        <p className="text-[10px] text-slate-400 font-mono mt-0.5">{s.desc}</p>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Restore banner */}
        {showRestoreBanner && (
          <RestoreBanner
            projectName={draft.meta.name || "Untitled"}
            onDismiss={() => setShowRestoreBanner(false)}
          />
        )}
      </header>

      {/* ===== BODY: sidebar + content ===== */}
      <div className="flex flex-1 overflow-hidden">

        {/* ----- LEFT SIDEBAR ----- */}
        <aside className="w-44 shrink-0 flex flex-col border-r border-slate-200 bg-white overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {STEPS.map((step, idx) => (
              <SidebarStep
                key={idx}
                index={idx}
                step={step}
                active={currentStep === idx}
                visited={visitedSteps.has(idx) && currentStep !== idx}
                hasError={!!stepErrors[idx] && currentStep !== idx}
                onClick={() => goToStep(idx)}
              />
            ))}
          </div>
          <div className="mt-auto border-t border-slate-100 p-3">
            <p className="text-[10px] text-slate-400 font-mono leading-relaxed">
              Darcy-Weisbach<br />
              Colebrook-White<br />
              AWWA M11
            </p>
          </div>
        </aside>

        {/* ----- CONTENT AREA ----- */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Step header */}
          <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-3 flex items-center gap-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-700 text-white text-xs font-bold">
              {currentStep + 1}
            </span>
            <div>
              <p className="text-sm font-bold text-slate-800">{STEPS[currentStep].label}</p>
              <p className="text-[10px] font-mono text-slate-400">
                Step {currentStep + 1} of {STEPS.length}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <div className="w-32 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                <div
                  className="h-full bg-teal-600 rounded-full transition-all duration-300"
                  style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                {Math.round(((currentStep + 1) / STEPS.length) * 100)}%
              </span>
            </div>
          </div>

          {/* Scrollable step content — all steps stay mounted to preserve internal
              state of ClearWellStep / PumpSelectionStep / PumpCurveStep when
              navigating between wizard steps. Only the active step is visible. */}
          <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-6 pb-14">
            {STEPS.map((_, idx) => (
              <div key={`${idx}-${projectVersion}`} className={currentStep === idx ? "block" : "hidden"}>
                <StepContent index={idx} includeSurge={draft.includeSurge ?? true} />
              </div>
            ))}
          </div>

          {/* Sticky live-results strip */}
          <ResultsStrip />

          {/* Hidden file input for JSON import (triggered via importTriggerRef) */}
          <input
            ref={loadFileRef}
            type="file"
            accept=".json,application/json"
            onChange={handleLoadFile}
            className="hidden"
            aria-hidden="true"
          />

          {/* Navigation footer */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-3 space-y-2">
            {/* Validation error */}
            {navError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 font-medium">
                {navError}
              </div>
            )}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 0}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Back
              </button>

              <div className="flex items-center gap-1">
                {STEPS.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => goToStep(idx)}
                    className={`h-2 rounded-full transition-all ${
                      idx === currentStep
                        ? "w-5 bg-teal-600"
                        : stepErrors[idx]
                        ? "w-2 bg-rose-400"
                        : visitedSteps.has(idx)
                        ? "w-2 bg-teal-300"
                        : "w-2 bg-slate-200"
                    }`}
                    title={STEPS[idx].label}
                  />
                ))}
              </div>

              {currentStep < STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-600 transition-colors"
                >
                  Next →
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSaveToServer}
                  className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-600 transition-colors"
                >
                  Save Project
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
