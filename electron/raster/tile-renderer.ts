import { PNG } from "pngjs";
import type { ColorPalette } from "../../src/types/path-profile";
import { colorForElevation } from "./color-ramp";
import { tileExtent, tileResolutions, worldToPixelCorner } from "./geo";
import { getProject, type DsmFile } from "./project-registry";

const tileSize = 256;

export type DsmTileRequest = {
  projectId: string;
  z: number;
  x: number;
  y: number;
  palette: ColorPalette;
  min: number;
  max: number;
  reverse: boolean;
};

export async function renderDsmTile(request: DsmTileRequest): Promise<Buffer> {
  const project = getProject(request.projectId);
  const resolutions = tileResolutions(
    project.summary.extent,
    project.summary.pixelSize,
    tileSize,
  );
  const resolution = resolutions[request.z];

  if (resolution === undefined) {
    return emptyPng();
  }

  const extent = tileExtent(
    project.summary.extent,
    resolution,
    request.x,
    request.y,
    tileSize,
  );
  const png = new PNG({ width: tileSize, height: tileSize });
  const reversedFiles = [...project.files].reverse();

  for (let row = 0; row < tileSize; row++) {
    const worldY = extent.maxY - (row + 0.5) * resolution;

    for (let col = 0; col < tileSize; col++) {
      const worldX = extent.minX + (col + 0.5) * resolution;
      const sample = sampleNearestForTile(reversedFiles, worldX, worldY);
      const offset = (row * tileSize + col) * 4;

      if (sample === null) {
        png.data[offset] = 0;
        png.data[offset + 1] = 0;
        png.data[offset + 2] = 0;
        png.data[offset + 3] = 0;
        continue;
      }

      const [red, green, blue, alpha] = colorForElevation(
        sample,
        request.min,
        request.max,
        request.palette,
        request.reverse,
      );
      png.data[offset] = red;
      png.data[offset + 1] = green;
      png.data[offset + 2] = blue;
      png.data[offset + 3] = alpha;
    }
  }

  return PNG.sync.write(png);
}

export function parseTileUrl(url: string): DsmTileRequest {
  const parsed = new URL(url);
  const [projectId, z, x, yWithExtension] = parsed.pathname
    .split("/")
    .filter(Boolean);

  if (!projectId || !z || !x || !yWithExtension) {
    throw new Error("Invalid DSM tile URL.");
  }

  const y = yWithExtension.replace(/\.png$/i, "");
  const palette = parsed.searchParams.get("palette") ?? "terrain";
  const min = Number(parsed.searchParams.get("min"));
  const max = Number(parsed.searchParams.get("max"));

  return {
    projectId,
    z: parseInteger(z, "z"),
    x: parseInteger(x, "x"),
    y: parseInteger(y, "y"),
    palette: isColorPalette(palette) ? palette : "terrain",
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 1,
    reverse: parsed.searchParams.get("reverse") === "true",
  };
}

export function sampleNearestForTile(
  files: DsmFile[],
  x: number,
  y: number,
): number | null {
  for (const file of files) {
    if (
      x < file.extent.minX ||
      x >= file.extent.maxX ||
      y <= file.extent.minY ||
      y > file.extent.maxY
    ) {
      continue;
    }

    const [pixelX, pixelY] = worldToPixelCorner(file.geoTransform, x, y);
    const nearestX = Math.floor(pixelX);
    const nearestY = Math.floor(pixelY);

    if (
      nearestX < 0 ||
      nearestY < 0 ||
      nearestX >= file.size.width ||
      nearestY >= file.size.height
    ) {
      continue;
    }

    const value = file.band.pixels.get(nearestX, nearestY);
    if (!Number.isFinite(value) || isNoData(value, file.nodata)) {
      continue;
    }

    return value;
  }

  return null;
}

function isNoData(value: number, nodata: number | undefined): boolean {
  if (nodata === undefined) return false;
  if (Number.isNaN(nodata)) return Number.isNaN(value);
  return value === nodata;
}

function emptyPng(): Buffer {
  return PNG.sync.write(new PNG({ width: tileSize, height: tileSize }));
}

function parseInteger(value: string, label: string): number {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid DSM tile ${label} coordinate.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Invalid DSM tile ${label} coordinate.`);
  }
  return parsed;
}

function isColorPalette(value: string): value is ColorPalette {
  return (
    value === "grayscale" ||
    value === "terrain" ||
    value === "viridis" ||
    value === "plasma" ||
    value === "high-contrast"
  );
}
