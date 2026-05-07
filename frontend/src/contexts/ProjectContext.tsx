import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import type { ProjectDraft, ProjectMeta, PipelineDraft, NodeDraft } from "../types/project";
import { DEFAULT_DRAFT } from "../types/project";
import type { UnitSystem } from "../utils/units";
import type { CalculationResponse, PumpComputeResponse } from "../utils/api";

type Action =
  | { type: "SET_META"; meta: ProjectMeta }
  | { type: "SET_UNIT_SYSTEM"; unitSystem: UnitSystem }
  | { type: "SET_SHOW_BOTH"; showBoth: boolean }
  | { type: "SET_DESIGN_FLOW"; flow: number }
  | { type: "SET_UPSTREAM_NODE"; node: NodeDraft }
  | { type: "SET_DOWNSTREAM_NODE"; node: NodeDraft }
  | { type: "SET_SUCTION"; suction: PipelineDraft }
  | { type: "SET_DISCHARGE"; discharge: PipelineDraft }
  | { type: "SET_HYDRAULICS"; result: CalculationResponse | null; error: string | null }
  | { type: "SET_PUMP_RESULT"; result: PumpComputeResponse | null }
  | { type: "LOAD"; draft: ProjectDraft };

function reducer(state: ProjectDraft, action: Action): ProjectDraft {
  switch (action.type) {
    case "SET_META":           return { ...state, meta: action.meta };
    case "SET_UNIT_SYSTEM":    return { ...state, unitSystem: action.unitSystem };
    case "SET_SHOW_BOTH":      return { ...state, showBoth: action.showBoth };
    case "SET_DESIGN_FLOW":    return { ...state, designFlow_m3h: action.flow };
    case "SET_UPSTREAM_NODE":  return { ...state, upstreamNode: action.node };
    case "SET_DOWNSTREAM_NODE":return { ...state, downstreamNode: action.node };
    case "SET_SUCTION":        return { ...state, suction: action.suction };
    case "SET_DISCHARGE":      return { ...state, discharge: action.discharge };
    case "SET_HYDRAULICS":     return { ...state, hydraulicsResult: action.result, hydraulicsError: action.error };
    case "SET_PUMP_RESULT":    return { ...state, pumpResult: action.result };
    case "LOAD":               return { ...action.draft, hydraulicsResult: null, hydraulicsError: null, pumpResult: null };
    default:                   return state;
  }
}

function loadFromStorage(): ProjectDraft {
  try {
    const raw = localStorage.getItem("wps-project-draft");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProjectDraft>;
      return {
        ...DEFAULT_DRAFT,
        ...parsed,
        suction:   { ...DEFAULT_DRAFT.suction,   ...(parsed.suction ?? {}) },
        discharge: { ...DEFAULT_DRAFT.discharge,  ...(parsed.discharge ?? {}) },
        meta:      { ...DEFAULT_DRAFT.meta,       ...(parsed.meta ?? {}) },
        upstreamNode:   { ...DEFAULT_DRAFT.upstreamNode,   ...(parsed.upstreamNode ?? {}) },
        downstreamNode: { ...DEFAULT_DRAFT.downstreamNode, ...(parsed.downstreamNode ?? {}) },
        hydraulicsResult: null,
        hydraulicsError:  null,
        pumpResult:       null,
      };
    }
  } catch { /* ignore */ }
  return DEFAULT_DRAFT;
}

interface ProjectContextType {
  draft: ProjectDraft;
  dispatch: React.Dispatch<Action>;
}

const ProjectContext = createContext<ProjectContextType>({
  draft: DEFAULT_DRAFT,
  dispatch: () => {},
});

export function ProjectProvider({ children }: { children: ReactNode }) {
  const [draft, dispatch] = useReducer(reducer, undefined, loadFromStorage);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      try {
        const toSave: ProjectDraft = {
          ...draft,
          hydraulicsResult: null,
          hydraulicsError:  null,
          pumpResult:       null,
        };
        localStorage.setItem("wps-project-draft", JSON.stringify(toSave));
      } catch { /* ignore */ }
    }, 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [draft]);

  return (
    <ProjectContext.Provider value={{ draft, dispatch }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
