import { describe, expect, it } from "vitest";
import type { ProfilePoint } from "~/types/path-profile";
import {
  buildVisibleLineOfSightSegments,
  createDefaultLineOfSightEndpoints,
  lineOfSightElevationAt,
} from "./line-of-sight";

describe("line of sight helpers", () => {
  it("initializes endpoints from the first and last finite terrain elevations", () => {
    expect(
      createDefaultLineOfSightEndpoints([
        point(0, null),
        point(10, 20),
        point(20, null),
        point(30, 45),
        point(40, null),
      ]),
    ).toEqual({ startElevation: 20, endElevation: 45 });
  });

  it("returns null defaults when no finite profile elevations exist", () => {
    expect(
      createDefaultLineOfSightEndpoints([point(0, null), point(10, null)]),
    ).toBeNull();
  });

  it("interpolates absolute elevation along the straight line", () => {
    const endpoints = { startElevation: 10, endElevation: 30 };

    expect(lineOfSightElevationAt(0, 100, endpoints)).toBe(10);
    expect(lineOfSightElevationAt(50, 100, endpoints)).toBe(20);
    expect(lineOfSightElevationAt(100, 100, endpoints)).toBe(30);
  });

  it("returns visible segments where the line is above the terrain", () => {
    expect(
      buildVisibleLineOfSightSegments(
        [point(0, 5), point(10, 6), point(20, 7)],
        { startElevation: 10, endElevation: 10 },
      ),
    ).toEqual([
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]);
  });

  it("hides segments where the line is on or below the terrain", () => {
    expect(
      buildVisibleLineOfSightSegments(
        [point(0, 10), point(10, 11), point(20, 12)],
        { startElevation: 10, endElevation: 10 },
      ),
    ).toEqual([null]);
  });

  it("inserts crossing points where terrain crosses the line of sight", () => {
    expect(
      buildVisibleLineOfSightSegments(
        [point(0, 5), point(10, 15), point(20, 5)],
        { startElevation: 10, endElevation: 10 },
      ),
    ).toEqual([
      { x: 0, y: 10 },
      { x: 5, y: 10 },
      null,
      { x: 15, y: 10 },
      { x: 20, y: 10 },
    ]);
  });

  it("treats null terrain samples as data gaps instead of obstructions", () => {
    expect(
      buildVisibleLineOfSightSegments(
        [point(0, 5), point(10, null), point(20, 5)],
        { startElevation: 10, endElevation: 10 },
      ),
    ).toEqual([{ x: 0, y: 10 }, null, { x: 20, y: 10 }]);
  });
});

function point(distance: number, elevation: number | null): ProfilePoint {
  return {
    distance,
    elevation,
    x: distance,
    y: 0,
  };
}
