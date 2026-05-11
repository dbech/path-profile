import { describe, expect, it } from "vitest";
import { parseTileUrl, sampleNearestForTile } from "./tile-renderer";
import type { DsmFile } from "./project-registry";

describe("tile renderer helpers", () => {
  it("rejects non-integer tile coordinates", () => {
    expect(() => parseTileUrl("dsm-tile://tile/project/1abc/2/3.png")).toThrow(
      "Invalid DSM tile z coordinate.",
    );
    expect(() => parseTileUrl("dsm-tile://tile/project/1/2/3abc.png")).toThrow(
      "Invalid DSM tile y coordinate.",
    );
  });

  it("falls through overlapping NoData pixels to lower-priority rasters", () => {
    const top = testFile(-9999, -9999);
    const lower = testFile(42);

    expect(sampleNearestForTile([top, lower], 0.5, 0.5)).toBe(42);
  });
});

function testFile(value: number, nodata?: number): DsmFile {
  return {
    band: {
      pixels: {
        get: () => value,
      },
    },
    extent: {
      minX: 0,
      minY: 0,
      maxX: 1,
      maxY: 1,
      projection: "LOCAL",
    },
    geoTransform: [0, 1, 0, 1, 0, -1],
    nodata,
    size: { width: 1, height: 1 },
  } as unknown as DsmFile;
}
