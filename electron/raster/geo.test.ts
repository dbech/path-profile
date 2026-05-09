import { describe, expect, it } from "vitest";
import {
  densifyPath,
  extentFromGeoTransform,
  tileExtent,
  tileResolutions,
  worldToPixelCenter,
  worldToPixelCorner,
  type GeoTransform,
} from "./geo";

describe("geo helpers", () => {
  const transform: GeoTransform = [100, 2, 0, 200, 0, -2];

  it("converts world coordinates to pixel corner and center coordinates", () => {
    expect(worldToPixelCorner(transform, 101, 199)).toEqual([0.5, 0.5]);
    expect(worldToPixelCenter(transform, 101, 199)).toEqual([0, 0]);
  });

  it("computes north-up raster extent", () => {
    expect(extentFromGeoTransform(transform, 10, 20, "EPSG:3857")).toEqual({
      minX: 100,
      minY: 160,
      maxX: 120,
      maxY: 200,
      projection: "EPSG:3857",
    });
  });

  it("densifies paths without exceeding the sample cap", () => {
    const result = densifyPath(
      [
        [0, 0],
        [100, 0],
      ],
      1,
      11,
    );

    expect(result.limited).toBe(true);
    expect(result.coordinates).toHaveLength(11);
    expect(result.coordinates.at(-1)).toEqual([100, 0]);
  });

  it("uses matching tile resolution and tile extent calculations", () => {
    const extent = {
      minX: 0,
      minY: 0,
      maxX: 512,
      maxY: 512,
      projection: "LOCAL",
    };
    const resolutions = tileResolutions(extent, { x: 1, y: 1 });

    expect(resolutions[0]).toBe(2);
    expect(tileExtent(extent, resolutions[1]!, 1, 1)).toEqual({
      minX: 256,
      minY: 0,
      maxX: 512,
      maxY: 256,
      projection: "LOCAL",
    });
  });
});
