import type { BasemapId } from "~/lib/basemaps";

export type Coordinate = [number, number];

export type Extent = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  projection: string;
};

export type DsmFileSummary = {
  id: string;
  name: string;
  extent: Extent;
  size: { width: number; height: number };
  pixelSize: { x: number; y: number };
  dataType: string;
  nodata?: number;
};

export type DsmProjectSummary = {
  id: string;
  files: DsmFileSummary[];
  crsWkt: string;
  epsg?: string;
  extent: Extent;
  pixelSize: { x: number; y: number };
  elevation: {
    unit: string;
    min: number;
    max: number;
    nodata?: number;
  };
  warnings: string[];
};

export type ProfileRequest = {
  projectId: string;
  path: {
    projection: string;
    coordinates: Coordinate[];
  };
};

export type ProfilePoint = {
  distance: number;
  x: number;
  y: number;
  elevation: number | null;
  sourceFile?: string;
};

export type ProfileResult = {
  points: ProfilePoint[];
  warnings: string[];
};

export type ColorPalette =
  | "grayscale"
  | "terrain"
  | "viridis"
  | "plasma"
  | "high-contrast";

export type ColorSettings = {
  palette: ColorPalette;
  min: number;
  max: number;
  autoStretch: boolean;
  reverse: boolean;
  opacity: number;
};

export type Unsubscribe = () => void;

export type PathProfileApi = {
  openDsmFiles: () => Promise<string[]>;
  loadDsmProject: (paths: string[]) => Promise<DsmProjectSummary>;
  generateProfile: (request: ProfileRequest) => Promise<ProfileResult>;
  exportProfileCsv: (points: ProfilePoint[]) => Promise<void>;
  onOpenDsmRequested: (callback: () => void) => Unsubscribe;
  onExportProfileRequested: (callback: () => void) => Unsubscribe;
  onBasemapSelected: (callback: (basemapId: BasemapId) => void) => Unsubscribe;
};
