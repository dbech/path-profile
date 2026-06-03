import { describe, expect, it } from "vitest";
import type { ProfilePoint } from "~/types/path-profile";
import {
  FRESNEL_SHELL_NUMBERS,
  buildFresnelZoneShell,
  buildVisibleFresnelZoneShellSegments,
  buildVisibleLineOfSightSegments,
  createDefaultLineOfSightEndpoints,
  curvatureAdjustedLineOfSightElevationAt,
  earthCurvatureDropAt,
  fresnelRadiusAt,
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

  it("returns zero earth curvature drop at both endpoints", () => {
    expect(earthCurvatureDropAt(0, 10_000)).toBe(0);
    expect(earthCurvatureDropAt(10_000, 10_000)).toBe(0);
  });

  it("calculates K=4/3 earth curvature drop at the path midpoint", () => {
    expect(earthCurvatureDropAt(5_000, 10_000)).toBeCloseTo(1.47, 2);
  });

  it("converts earth curvature drop units for chart coordinates", () => {
    expect(
      earthCurvatureDropAt(5_000, 10_000, {
        horizontalMetersPerUnit: 0.3048,
        verticalMetersPerUnit: 0.3048,
      }),
    ).toBeCloseTo(0.45, 2);
  });

  it("lowers the curvature-adjusted line of sight away from endpoints", () => {
    const endpoints = { startElevation: 10, endElevation: 10 };

    expect(curvatureAdjustedLineOfSightElevationAt(0, 10_000, endpoints)).toBe(
      10,
    );
    expect(
      curvatureAdjustedLineOfSightElevationAt(10_000, 10_000, endpoints),
    ).toBe(10);
    expect(
      curvatureAdjustedLineOfSightElevationAt(5_000, 10_000, endpoints),
    ).toBeLessThan(10);
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

  it("clips curvature-adjusted line of sight against terrain independently", () => {
    const points = [point(0, 9), point(5_000, 9), point(10_000, 9)];
    const endpoints = { startElevation: 10, endElevation: 10 };

    expect(buildVisibleLineOfSightSegments(points, endpoints)).toEqual([
      { x: 0, y: 10 },
      { x: 5_000, y: 10 },
      { x: 10_000, y: 10 },
    ]);

    const adjusted = buildVisibleLineOfSightSegments(
      points,
      endpoints,
      "curvature-adjusted",
    );

    expect(adjusted[0]).toEqual({ x: 0, y: 10 });
    expect(adjusted).toContain(null);
    expect(adjusted.at(-1)).toEqual({ x: 10_000, y: 10 });
  });

  it("adds interior samples to render sparse curvature-adjusted line of sight as a curve", () => {
    const adjusted = buildVisibleLineOfSightSegments(
      [point(0, 0), point(10_000, 0)],
      { startElevation: 10, endElevation: 10 },
      "curvature-adjusted",
    );
    const midpoint = adjusted.find(
      (sample): sample is { x: number; y: number } =>
        sample !== null && sample.x === 5_000,
    );

    expect(adjusted.length).toBeGreaterThan(2);
    expect(midpoint?.y).toBeCloseTo(
      curvatureAdjustedLineOfSightElevationAt(5_000, 10_000, {
        startElevation: 10,
        endElevation: 10,
      })!,
      5,
    );
  });

  it("returns zero Fresnel radius at both endpoints", () => {
    expect(fresnelRadiusAt(0, 1000, 5800, 1)).toBe(0);
    expect(fresnelRadiusAt(1000, 1000, 5800, 1)).toBe(0);
  });

  it("calculates Fresnel radius at the path midpoint", () => {
    expect(fresnelRadiusAt(500, 1000, 5800, 1)).toBeCloseTo(3.59, 2);
  });

  it("scales Fresnel radius by shell number", () => {
    const shellOneRadius = fresnelRadiusAt(500, 1000, 5800, 1);
    expect(FRESNEL_SHELL_NUMBERS).toEqual([1, 2, 3]);
    expect(shellOneRadius).not.toBeNull();
    expect(fresnelRadiusAt(500, 1000, 5800, 2)).toBeCloseTo(
      shellOneRadius! * Math.sqrt(2),
      5,
    );
    expect(fresnelRadiusAt(500, 1000, 5800, 3)).toBeCloseTo(
      shellOneRadius! * Math.sqrt(3),
      5,
    );
  });

  it("returns null for invalid Fresnel radius inputs", () => {
    expect(fresnelRadiusAt(500, 0, 5800, 1)).toBeNull();
    expect(fresnelRadiusAt(500, 1000, 0, 1)).toBeNull();
    expect(fresnelRadiusAt(500, 1000, 5800, 0)).toBeNull();
    expect(fresnelRadiusAt(1001, 1000, 5800, 1)).toBeNull();
    expect(fresnelRadiusAt(500, 1000, Number.MIN_VALUE, 1)).toBeNull();
  });

  it("builds symmetric Fresnel shell lines around the line of sight", () => {
    const shell = buildFresnelZoneShell(
      [point(0, null), point(500, null), point(1000, null)],
      { startElevation: 10, endElevation: 20 },
      5800,
      1,
    );

    expect(shell?.shellNumber).toBe(1);
    expect(shell?.upper).toHaveLength(3);
    expect(shell?.lower).toHaveLength(3);
    expect(shell?.upper[0]).toEqual({ x: 0, y: 10 });
    expect(shell?.lower[0]).toEqual({ x: 0, y: 10 });
    expect(shell?.upper[2]).toEqual({ x: 1000, y: 20 });
    expect(shell?.lower[2]).toEqual({ x: 1000, y: 20 });
    expect(shell?.upper[1]?.y).toBeCloseTo(18.59, 2);
    expect(shell?.lower[1]?.y).toBeCloseTo(11.41, 2);
  });

  it("applies curvature adjustment to Fresnel shell boundaries", () => {
    const points = [point(0, null), point(5_000, null), point(10_000, null)];
    const endpoints = { startElevation: 100, endElevation: 100 };
    const flatShell = buildFresnelZoneShell(points, endpoints, 5800, 1);
    const adjustedShell = buildFresnelZoneShell(
      points,
      endpoints,
      5800,
      1,
      undefined,
      "curvature-adjusted",
    );
    const drop = earthCurvatureDropAt(5_000, 10_000);

    expect(drop).not.toBeNull();
    expect(adjustedShell?.upper[0]).toEqual(flatShell?.upper[0]);
    expect(adjustedShell?.lower[0]).toEqual(flatShell?.lower[0]);
    expect(adjustedShell?.upper[2]).toEqual(flatShell?.upper[2]);
    expect(adjustedShell?.lower[2]).toEqual(flatShell?.lower[2]);
    expect(adjustedShell?.upper[1]?.y).toBeCloseTo(
      flatShell!.upper[1]!.y - drop!,
      5,
    );
    expect(adjustedShell?.lower[1]?.y).toBeCloseTo(
      flatShell!.lower[1]!.y - drop!,
      5,
    );
  });

  it("converts Fresnel distance and radius units for chart coordinates", () => {
    const shell = buildFresnelZoneShell(
      [point(0, null), point(500, null), point(1000, null)],
      { startElevation: 10, endElevation: 20 },
      5800,
      1,
      { horizontalMetersPerUnit: 0.3048, verticalMetersPerUnit: 0.3048 },
    );

    expect(shell?.upper[1]?.y).toBeCloseTo(21.51, 2);
    expect(shell?.lower[1]?.y).toBeCloseTo(8.49, 2);
  });

  it("returns null when a Fresnel shell cannot be built", () => {
    expect(
      buildFresnelZoneShell([], { startElevation: 0, endElevation: 0 }, 5800),
    ).toBeNull();
    expect(buildFresnelZoneShell([point(0, null)], null, 5800)).toBeNull();
    expect(
      buildFresnelZoneShell(
        [point(0, null), point(1000, null)],
        { startElevation: 0, endElevation: 0 },
        -1,
      ),
    ).toBeNull();
    expect(
      buildFresnelZoneShell(
        [point(0, null), point(1000, null)],
        { startElevation: 0, endElevation: 0 },
        5800,
        1,
        { horizontalMetersPerUnit: 0, verticalMetersPerUnit: 1 },
      ),
    ).toBeNull();
  });

  it("builds Fresnel shell segments from visible boundary stretches", () => {
    const segments = buildVisibleFresnelZoneShellSegments(
      [point(0, 5), point(10, 15), point(20, 5)],
      { startElevation: 10, endElevation: 10 },
      5800,
      1,
    );

    expect(segments.lower).toHaveLength(2);
    expect(segments.upper).toHaveLength(2);
    expect(segments.lower[0]?.[0]).toEqual({ x: 0, y: 10 });
    expect(segments.upper[0]?.[0]).toEqual({ x: 0, y: 10 });
    expect(segments.lower[0]?.at(-1)?.x).toBeGreaterThan(4);
    expect(segments.lower[0]?.at(-1)?.x).toBeLessThan(5);
    expect(segments.upper[0]?.at(-1)?.x).toBeGreaterThan(5);
    expect(segments.upper[0]?.at(-1)?.x).toBeLessThan(6);
    expect(segments.lower[1]?.at(-1)).toEqual({ x: 20, y: 10 });
    expect(segments.upper[1]?.at(-1)).toEqual({ x: 20, y: 10 });
  });

  it("clips curvature-adjusted Fresnel boundaries against terrain independently", () => {
    const points = [point(0, -2), point(5_000, -2), point(10_000, -2)];
    const endpoints = { startElevation: 10, endElevation: 10 };
    const flatSegments = buildVisibleFresnelZoneShellSegments(
      points,
      endpoints,
      5800,
      1,
    );
    const adjustedSegments = buildVisibleFresnelZoneShellSegments(
      points,
      endpoints,
      5800,
      1,
      undefined,
      "curvature-adjusted",
    );

    expect(flatSegments.lower).toHaveLength(1);
    expect(adjustedSegments.lower).toHaveLength(2);
    expect(adjustedSegments.upper).toHaveLength(1);
  });

  it("adds interior samples to render sparse curvature-adjusted Fresnel boundaries as curves", () => {
    const adjustedSegments = buildVisibleFresnelZoneShellSegments(
      [point(0, -10), point(10_000, -10)],
      { startElevation: 10, endElevation: 10 },
      5800,
      1,
      undefined,
      "curvature-adjusted",
    );
    const upperMidpoint = adjustedSegments.upper[0]?.find(
      (sample) => sample.x === 5_000,
    );
    const lowerMidpoint = adjustedSegments.lower[0]?.find(
      (sample) => sample.x === 5_000,
    );

    expect(adjustedSegments.upper[0]?.length).toBeGreaterThan(2);
    expect(adjustedSegments.lower[0]?.length).toBeGreaterThan(2);
    expect(upperMidpoint?.y).toBeCloseTo(
      10 -
        earthCurvatureDropAt(5_000, 10_000)! +
        fresnelRadiusAt(5_000, 10_000, 5800, 1)!,
      5,
    );
    expect(lowerMidpoint?.y).toBeCloseTo(
      10 -
        earthCurvatureDropAt(5_000, 10_000)! -
        fresnelRadiusAt(5_000, 10_000, 5800, 1)!,
      5,
    );
  });

  it("keeps Fresnel shell width on interior points of a visible stretch", () => {
    const segments = buildVisibleFresnelZoneShellSegments(
      [point(0, 0), point(10, 0), point(20, 0), point(30, 0)],
      { startElevation: 10, endElevation: 10 },
      5800,
      1,
    );

    expect(segments.lower).toHaveLength(1);
    expect(segments.upper).toHaveLength(1);
    expect(segments.lower[0]?.[0]?.y).toBe(10);
    expect(segments.upper[0]?.[0]?.y).toBe(10);
    expect(segments.lower[0]?.at(-1)?.y).toBe(10);
    expect(segments.upper[0]?.at(-1)?.y).toBe(10);
    expect(segments.lower[0]?.[1]?.y).toBeLessThan(10);
    expect(segments.upper[0]?.[1]?.y).toBeGreaterThan(10);
  });

  it("segments Fresnel lower and upper boundaries independently", () => {
    const segments = buildVisibleFresnelZoneShellSegments(
      [point(0, 0), point(10, 9.8), point(20, 9.8), point(30, 0)],
      { startElevation: 10, endElevation: 10 },
      5800,
      1,
    );

    expect(segments.upper).toHaveLength(1);
    expect(segments.lower).toHaveLength(2);
  });

  it("returns no Fresnel shell segments when visible LoS stretches cannot form lines", () => {
    expect(
      buildVisibleFresnelZoneShellSegments(
        [point(0, 5), point(10, null), point(20, 5)],
        { startElevation: 10, endElevation: 10 },
        5800,
        1,
      ),
    ).toEqual({ lower: [], upper: [] });
    expect(
      buildVisibleFresnelZoneShellSegments(
        [point(0, 5), point(10, 5), point(20, 5)],
        { startElevation: 10, endElevation: 10 },
        5800,
        1,
        { horizontalMetersPerUnit: 1, verticalMetersPerUnit: Infinity },
      ),
    ).toEqual({ lower: [], upper: [] });
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
