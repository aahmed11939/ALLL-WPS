import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type {
  ProjectDraft,
  ProjectMeta,
  PipelineDraft,
  NodeDraft,
  ClearwellFormConfig,
  PumpSelectionConfig,
  PumpCurveConfig,
} from "../types/project";
import { DEFAULT_DRAFT } from "../types/project";
import type { UnitSystem } from "../utils/units";
import type { CalculationResponse, PumpComputeResponse } from "../utils/api";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: "SET_META";                  meta: ProjectMeta }
  | { type: "SET_UNIT_SYSTEM";           unitSystem: UnitSystem }
  | { type: "SET_SHOW_BOTH";             showBoth: boolean }
  | { type: "SET_DESIGN_FLOW";           flow: number }
  | { type: "SET_UPSTREAM_NODE";         node: NodeDraft }
  | { type: "SET_DOWNSTREAM_NODE";       node: NodeDraft }
  | { type: "SET_SUCTION";               suction: PipelineDraft }
  | { type: "SET_DISCHARGE";             discharge: PipelineDraft }
  | { type: "SET_CLEARWELL_CONFIG";      config: ClearwellFormConfig | null }
  | { type: "SET_PUMP_SELECTION_CONFIG"; config: PumpSelectionConfig | null }
  | { type: "SET_PUMP_CURVE_CONFIG";     config: PumpCurveConfig | null }
  | { type: "SET_HYDRAULICS";            result: CalculationResponse | null; error: string | null }
  | { type: "SET_PUMP_RESULT";           result: PumpComputeResponse | null }
  | { type: "LOAD";                      draft: ProjectDraft };

function reducer(state: ProjectDraft, action: Action): ProjectDraft {
  switch (action.type) {
    case "SET_META":                  return { ...state, meta: action.meta };
    case "SET_UNIT_SYSTEM":           return { ...state, unitSystem: action.unitSystem };
    case "SET_SHOW_BOTH":             return { ...state, showBoth: action.showBoth };
    case "SET_DESIGN_FLOW":           return { ...state, designFlow_m3h: action.flow };
    case "SET_UPSTREAM_NODE":         return { ...state, upstreamNode: action.node };
    case "SET_DOWNSTREAM_NODE":       return { ...state, downstreamNode: action.node };
    case "SET_SUCTION":               return { ...state, suction: action.suction };
    case "SET_DISCHARGE":             return { ...state, discharge: action.discharge };
    case "SET_CLEARWELL_CONFIG":      return { ...state, clearwellConfig: action.config };
    case "SET_PUMP_SELECTION_CONFIG": return { ...state, pumpSelectionConfig: action.config };
    case "SET_PUMP_CURVE_CONFIG":     return { ...state, pumpCurveConfig: action.config };
    case "SET_HYDRAULICS":
      return { ...state, hydraulicsResult: action.result, hydraulicsError: action.error };
    case "SET_PUMP_RESULT":           return { ...state, pumpResult: action.result };
    case "LOAD":                      return { ...action.draft };
    default:                          return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true if localStorage contained a saved project (restore banner). */
export function hadStoredSession(): boolean {
  try { return !!localStorage.getItem("wps-project-draft"); } catch { return false; }
}

function parseDraft(raw: string): ProjectDraft {
  const parsed = JSON.parse(raw) as Partial<ProjectDraft>;
  return {
    ...DEFAULT_DRAFT,
    ...parsed,
    suction:        { ...DEFAULT_DRAFT.suction,        ...(parsed.suction        ?? {}) },
    discharge:      { ...DEFAULT_DRAFT.discharge,       ...(parsed.discharge      ?? {}) },
    meta:           { ...DEFAULT_DRAFT.meta,            ...(parsed.meta           ?? {}) },
    upstreamNode:   { ...DEFAULT_DRAFT.upstreamNode,   ...(parsed.upstreamNode   ?? {}) },
    downstreamNode: { ...DEFAULT_DRAFT.downstreamNode, ...(parsed.downstreamNode ?? {}) },
    clearwellConfig:      parsed.clearwellConfig      ?? null,
    pumpSelectionConfig:  parsed.pumpSelectionConfig  ?? null,
    pumpCurveConfig:      parsed.pumpCurveConfig      ?? null,
    hydraulicsResult:     parsed.hydraulicsResult     ?? null,
    hydraulicsError:      parsed.hydraulicsError      ?? null,
    pumpResult:           parsed.pumpResult           ?? null,
  };
}

function loadFromStorage(): ProjectDraft {
  try {
    const raw = localStorage.getItem("wps-project-draft");
    if (raw) return parseDraft(raw);
  } catch { /* ignore */ }
  return DEFAULT_DRAFT;
}

function deepSet<T extends object>(obj: T, path: string, value: unknown): T {
  const keys = path.split(".");
  const clone = { ...obj } as Record<string, unknown>;
  let cursor = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    cursor[k] = { ...(cursor[k] as Record<string, unknown>) };
    cursor = cursor[k] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
  return clone as T;
}

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

interface ProjectContextType {
  draft: ProjectDraft;
  dispatch: React.Dispatch<Action>;
  /** Dot-path deep-set: update("meta.name", "New") */
  update: (path: string, value: unknown) => void;
  /** Reset draft to factory defaults and clear localStorage. */
  reset: () => void;
  /** Parse a full JSON string and load it as the active draft. */
  loadJSON: (json: string) => { ok: boolean; error?: string };
}

const ProjectContext = createContext<ProjectContextType>({
  draft:    DEFAULT_DRAFT,
  dispatch: () => {},
  update:   () => {},
  reset:    () => {},
  loadJSON: () => ({ ok: false, error: "Context not mounted" }),
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [draft, dispatch] = useReducer(reducer, undefined, loadFromStorage);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced auto-save — persists full state including step configs + compute results
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try { localStorage.setItem("wps-project-draft", JSON.stringify(draft)); } catch { /* ignore */ }
    }, 800);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [draft]);

  const update = useCallback((path: string, value: unknown) => {
    dispatch({ type: "LOAD", draft: deepSet(draft, path, value) });
  }, [draft]);

  const reset = useCallback(() => {
    const blank: ProjectDraft = {
      ...DEFAULT_DRAFT,
      meta: { ...DEFAULT_DRAFT.meta, date: new Date().toISOString().slice(0, 10) },
    };
    try { localStorage.removeItem("wps-project-draft"); } catch { /* ignore */ }
    dispatch({ type: "LOAD", draft: blank });
  }, []);

  const loadJSON = useCallback((json: string): { ok: boolean; error?: string } => {
    try {
      const loaded = parseDraft(json);
      dispatch({ type: "LOAD", draft: loaded });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? "Parse error" };
    }
  }, []);

  return (
    <ProjectContext.Provider value={{ draft, dispatch, update, reset, loadJSON }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
