import * as gdal from "gdal-async";
import type {
  Coordinate,
  ProfilePoint,
  ProfileRequest,
  ProfileResult,
} from "../../src/types/path-profile";
import {
  densifyPath,
  distance,
  worldToPixelCenter,
  worldToPixelCorner,
} from "./geo";
import { profilePointsToCsv } from "./csv";
import { getProject, type DsmFile } from "./project-registry";

export { profilePointsToCsv };

export async function generateProfile(
  request: ProfileRequest,
): Promise<ProfileResult> {
  const project = getProject(request.projectId);
  const warnings = [...project.summary.warnings];
  const coordinates = transformPathCoordinates(
    request.path.coordinates,
    request.path.projection,
  );

  if (coordinates.length < 2) {
    throw new Error("Draw a path with at least two points.");
  }

  const preferredStep =
    (project.summary.pixelSize.x + project.summary.pixelSize.y) / 2;
  const densified = densifyPath(coordinates, preferredStep);

  if (densified.limited) {
    warnings.push(
      `The path is long for this DSM resolution, so sample spacing was increased to ${formatNumber(densified.effectiveStep)} map units.`,
    );
  }

  let cumulativeDistance = 0;
  const points: ProfilePoint[] = [];

  for (let i = 0; i < densified.coordinates.length; i++) {
    const coordinate = densified.coordinates[i]!;
    if (i > 0) {
      cumulativeDistance += distance(densified.coordinates[i - 1]!, coordinate);
    }

    const sample = sampleBilinear(project.files, coordinate[0], coordinate[1]);
    points.push({
      distance: cumulativeDistance,
      x: coordinate[0],
      y: coordinate[1],
      elevation: sample?.elevation ?? null,
      ...(sample?.sourceFile ? { sourceFile: sample.sourceFile } : {}),
    });
  }

  return { points, warnings: [...new Set(warnings)] };

  function transformPathCoordinates(
    path: Coordinate[],
    sourceProjection: string,
  ): Coordinate[] {
    if (
      sourceProjection === project.summary.extent.projection ||
      sourceProjection === project.summary.epsg
    ) {
      return path;
    }

    if (!project.sourceSrs) {
      throw new Error(
        "Cannot transform path coordinates because the DSM has no CRS.",
      );
    }

    try {
      const sourceSrs = gdal.SpatialReference.fromUserInput(sourceProjection);
      const transform = new gdal.CoordinateTransformation(
        sourceSrs,
        project.sourceSrs,
      );
      return path.map(([x, y]) => {
        const point = transform.transformPoint(x, y);
        return [point.x, point.y];
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not transform path coordinates: ${detail}`);
    }
  }
}

function sampleBilinear(
  files: DsmFile[],
  x: number,
  y: number,
): { elevation: number; sourceFile: string } | null {
  for (const file of [...files].reverse()) {
    if (
      x < file.extent.minX ||
      x > file.extent.maxX ||
      y < file.extent.minY ||
      y > file.extent.maxY
    ) {
      continue;
    }

    const elevation = sampleFileBilinear(file, x, y);
    if (elevation !== null) {
      return { elevation, sourceFile: file.name };
    }
  }

  return null;
}

function sampleFileBilinear(
  file: DsmFile,
  x: number,
  y: number,
): number | null {
  const [pixelX, pixelY] = worldToPixelCenter(file.geoTransform, x, y);
  const x0 = Math.floor(pixelX);
  const y0 = Math.floor(pixelY);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  if (x0 < 0 || y0 < 0 || x1 >= file.size.width || y1 >= file.size.height) {
    return sampleFileNearest(file, x, y);
  }

  const q11 = pixelValue(file, x0, y0);
  const q21 = pixelValue(file, x1, y0);
  const q12 = pixelValue(file, x0, y1);
  const q22 = pixelValue(file, x1, y1);

  if (q11 === null || q21 === null || q12 === null || q22 === null) {
    return null;
  }

  return bilinearFromValues(q11, q21, q12, q22, pixelX - x0, pixelY - y0);
}

export function bilinearFromValues(
  q11: number,
  q21: number,
  q12: number,
  q22: number,
  xFraction: number,
  yFraction: number,
): number {
  const top = q11 * (1 - xFraction) + q21 * xFraction;
  const bottom = q12 * (1 - xFraction) + q22 * xFraction;
  return top * (1 - yFraction) + bottom * yFraction;
}

function sampleFileNearest(file: DsmFile, x: number, y: number): number | null {
  const [pixelX, pixelY] = worldToPixelCorner(file.geoTransform, x, y);
  return pixelValue(file, Math.floor(pixelX), Math.floor(pixelY));
}

function pixelValue(file: DsmFile, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= file.size.width || y >= file.size.height) {
    return null;
  }

  const value = file.band.pixels.get(x, y);
  if (!Number.isFinite(value) || isNoData(value, file.nodata)) {
    return null;
  }

  return value;
}

function isNoData(value: number, nodata: number | undefined): boolean {
  if (nodata === undefined) return false;
  if (Number.isNaN(nodata)) return Number.isNaN(value);
  return value === nodata;
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
