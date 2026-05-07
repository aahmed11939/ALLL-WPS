import type { UnitSystem } from "../utils/units";
import type { AccessoryItem, CalculationResponse, PumpComputeResponse } from "../utils/api";

export interface ProjectMeta {
  name: string;
  client: string;
  job_number: string;
  date: string;
  engineer: string;
  notes: string;
}

export interface PipelineSegment {
  material: string;
  diameter_mm: number;
  length_m: number;
}

export interface PipelineDraft {
  segments: PipelineSegment[];
  accessories: AccessoryItem[];
  accessories_K_sum: number;
}

export interface NodeDraft {
  elevation_m: number;
  pressure_kPa: number;
}

export interface ProjectDraft {
  meta: ProjectMeta;
  unitSystem: UnitSystem;
  showBoth: boolean;
  designFlow_m3h: number;
  upstreamNode: NodeDraft;
  downstreamNode: NodeDraft;
  suction: PipelineDraft;
  discharge: PipelineDraft;
  hydraulicsResult: CalculationResponse | null;
  hydraulicsError: string | null;
  pumpResult: PumpComputeResponse | null;
}

export const DEFAULT_PIPELINE: PipelineDraft = {
  segments: [{ material: "pvc", diameter_mm: 150, length_m: 200 }],
  accessories: [],
  accessories_K_sum: 0,
};

export const DEFAULT_DRAFT: ProjectDraft = {
  meta: {
    name: "Untitled Project",
    client: "",
    job_number: "",
    date: new Date().toISOString().slice(0, 10),
    engineer: "",
    notes: "",
  },
  unitSystem: "SI",
  showBoth: false,
  designFlow_m3h: 36,
  upstreamNode: { elevation_m: 5.0, pressure_kPa: 0 },
  downstreamNode: { elevation_m: 35.0, pressure_kPa: 0 },
  suction: {
    segments: [{ material: "pvc", diameter_mm: 150, length_m: 200 }],
    accessories: [],
    accessories_K_sum: 0,
  },
  discharge: {
    segments: [{ material: "pvc", diameter_mm: 150, length_m: 400 }],
    accessories: [],
    accessories_K_sum: 0,
  },
  hydraulicsResult: null,
  hydraulicsError: null,
  pumpResult: null,
};
