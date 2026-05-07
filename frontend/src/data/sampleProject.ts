import type { ProjectDraft } from "../types/project";

export const SAMPLE_PROJECT: ProjectDraft = {
  meta: {
    name: "Municipal WPS — DN150 Sample",
    client: "Anytown Water Authority",
    job_number: "WPS-2024-001",
    date: "2024-05-01",
    engineer: "J. Smith, P.Eng.",
    notes:
      "Sample: 2 duty + 1 standby VFD centrifugal pumps. DN150 PVC suction 200 m + DN150 PVC discharge 400 m. Static head 30 m.",
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
