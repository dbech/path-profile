import type { Coordinate, Extent } from "../../src/types/path-profile";

export type GeoTransform = [number, number, number, number, number, number];

export function assertNorthUpGeoTransform(
  geoTransform: number[] | null,
  fileName: string,
): GeoTransform {
  if (!geoTransform || geoTransform.length < 6) {
    throw new Error(`${fileName} is missing a GDAL geotransform.`);
  }

  const originX = geoTransform[0]!;
  const pixelWidth = geoTransform[1]!;
  const rotateX = geoTransform[2]!;
  const originY = geoTransform[3]!;
  const rotateY = geoTransform[4]!;
  const pixelHeight = geoTransform[5]!;

  if (
    !Number.isFinite(originX) ||
    !Number.isFinite(pixelWidth) ||
    !Number.isFinite(rotateX) ||
    !Number.isFinite(originY) ||
    !Number.isFinite(rotateY) ||
    !Number.isFinite(pixelHeight)
  ) {
    throw new Error(`${fileName} has an invalid geotransform.`);
  }

  if (Math.abs(rotateX) > 1e-12 || Math.abs(rotateY) > 1e-12) {
    throw new Error(
      `${fileName} is rotated or skewed. Only north-up rasters are supported in this version.`,
    );
  }

  if (pixelWidth <= 0 || pixelHeight >= 0) {
    throw new Error(
      `${fileName} is not a north-up raster with positive x and negative y pixel size.`,
    );
  }

  return [originX, pixelWidth, rotateX, originY, rotateY, pixelHeight];
}

export function extentFromGeoTransform(
  geoTransform: GeoTransform,
  width: number,
  height: number,
  projection: string,
): Extent {
  const minX = geoTransform[0];
  const maxX = geoTransform[0] + width * geoTransform[1];
  const maxY = geoTransform[3];
  const minY = geoTransform[3] + height * geoTransform[5];

  return { minX, minY, maxX, maxY, projection };
}

export function mergeExtents(extents: Extent[], projection: string): Extent {
  return {
    minX: Math.min(...extents.map((extent) => extent.minX)),
    minY: Math.min(...extents.map((extent) => extent.minY)),
    maxX: Math.max(...extents.map((extent) => extent.maxX)),
    maxY: Math.max(...extents.map((extent) => extent.maxY)),
    projection,
  };
}

export function extentsOverlap(a: Extent, b: Extent): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
  );
}

export function worldToPixelCorner(
  geoTransform: GeoTransform,
  x: number,
  y: number,
): Coordinate {
  return [
    (x - geoTransform[0]) / geoTransform[1],
    (y - geoTransform[3]) / geoTransform[5],
  ];
}

export function worldToPixelCenter(
  geoTransform: GeoTransform,
  x: number,
  y: number,
): Coordinate {
  const [pixelX, pixelY] = worldToPixelCorner(geoTransform, x, y);
  return [pixelX - 0.5, pixelY - 0.5];
}

export function distance(a: Coordinate, b: Coordinate): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

export function densifyPath(
  coordinates: Coordinate[],
  preferredStep: number,
  maxPoints = 20_000,
): { coordinates: Coordinate[]; effectiveStep: number; limited: boolean } {
  if (coordinates.length < 2) {
    return {
      coordinates: [...coordinates],
      effectiveStep: preferredStep,
      limited: false,
    };
  }

  const totalLength = pathLength(coordinates);
  const minStep = totalLength / Math.max(1, maxPoints - 1);
  const effectiveStep = Math.max(preferredStep, minStep);
  const densified: Coordinate[] = [coordinates[0]!];

  for (let i = 1; i < coordinates.length; i++) {
    const start = coordinates[i - 1]!;
    const end = coordinates[i]!;
    const segmentLength = distance(start, end);
    const steps = Math.max(1, Math.ceil(segmentLength / effectiveStep));

    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      densified.push([
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
      ]);
    }
  }

  return {
    coordinates: densified.slice(0, maxPoints),
    effectiveStep,
    limited: effectiveStep > preferredStep,
  };
}

export function pathLength(coordinates: Coordinate[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += distance(coordinates[i - 1]!, coordinates[i]!);
  }
  return total;
}

export function tileResolutions(
  extent: Extent,
  pixelSize: { x: number; y: number },
  tileSize = 256,
): number[] {
  const width = extent.maxX - extent.minX;
  const height = extent.maxY - extent.minY;
  const baseResolution = Math.max(width, height) / tileSize;
  const minResolution = Math.min(pixelSize.x, pixelSize.y) / 2;
  const resolutions: number[] = [];

  let resolution = baseResolution;
  while (resolution >= minResolution && resolutions.length < 18) {
    resolutions.push(resolution);
    resolution /= 2;
  }

  return resolutions.length > 0 ? resolutions : [baseResolution || 1];
}

export function tileExtent(
  projectExtent: Extent,
  resolution: number,
  x: number,
  y: number,
  tileSize = 256,
): Extent {
  const minX = projectExtent.minX + x * tileSize * resolution;
  const maxY = projectExtent.maxY - y * tileSize * resolution;
  return {
    minX,
    maxX: minX + tileSize * resolution,
    maxY,
    minY: maxY - tileSize * resolution,
    projection: projectExtent.projection,
  };
}
