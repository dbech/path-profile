import type { Extent } from "~/types/path-profile";

export function dsmTileResolutions(
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
