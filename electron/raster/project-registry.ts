import type { Dataset, RasterBand, SpatialReference } from "gdal-async";
import type {
  DsmFileSummary,
  DsmProjectSummary,
} from "../../src/types/path-profile";
import type { GeoTransform } from "./geo";

export type DsmFile = DsmFileSummary & {
  path: string;
  geoTransform: GeoTransform;
  dataset: Dataset;
  band: RasterBand;
  srs: SpatialReference | null;
};

export type DsmProject = {
  summary: DsmProjectSummary;
  files: DsmFile[];
  sourceSrs: SpatialReference | null;
  isGeographic: boolean;
};

const projects = new Map<string, DsmProject>();

export function registerProject(project: DsmProject): DsmProjectSummary {
  closeAllProjects();
  projects.set(project.summary.id, project);
  return project.summary;
}

export function getProject(projectId: string): DsmProject {
  const project = projects.get(projectId);
  if (!project) {
    throw new Error("DSM project is no longer loaded.");
  }
  return project;
}

export function closeAllProjects(): void {
  for (const project of projects.values()) {
    closeProject(project);
  }
  projects.clear();
}

function closeProject(project: DsmProject): void {
  for (const file of project.files) {
    try {
      file.dataset.close();
    } catch {
      // Read-only datasets are safe to leave for process cleanup if close fails.
    }
  }
}
