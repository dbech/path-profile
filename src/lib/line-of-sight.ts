import type { ProfilePoint } from "~/types/path-profile";

export type LineOfSightEndpointId = "start" | "end";

export type LineOfSightEndpoints = {
  startElevation: number;
  endElevation: number;
};

export type LineOfSightChartPoint = {
  x: number;
  y: number;
};

/**
 * Derives line-of-sight endpoint elevations from the first and last finite elevations in a profile.
 *
 * @param points - Array of profile points to scan for finite elevation values
 * @returns `LineOfSightEndpoints` containing `startElevation` and `endElevation` when both are finite, `null` if either endpoint cannot be determined or is not a finite number
 */
export function createDefaultLineOfSightEndpoints(
  points: ProfilePoint[],
): LineOfSightEndpoints | null {
  const startElevation = points.find(isFiniteProfileElevation)?.elevation;
  const endElevation = findLastFiniteElevation(points);

  if (
    startElevation === undefined ||
    endElevation === undefined ||
    !Number.isFinite(startElevation) ||
    !Number.isFinite(endElevation)
  ) {
    return null;
  }

  return { startElevation, endElevation };
}

/**
 * Compute the line-of-sight elevation at a specified distance by linearly interpolating between the start and end endpoint elevations.
 *
 * @param distance - Distance from the start point along the profile at which to evaluate the line elevation
 * @param lastDistance - Reference distance corresponding to the end endpoint; if `lastDistance <= 0`, the function returns `endpoints.startElevation`
 * @param endpoints - Object containing `startElevation` and `endElevation` to interpolate between
 * @returns The interpolated line-of-sight elevation at `distance`
 */
export function lineOfSightElevationAt(
  distance: number,
  lastDistance: number,
  endpoints: LineOfSightEndpoints,
): number {
  if (lastDistance <= 0) return endpoints.startElevation;
  const ratio = distance / lastDistance;
  return (
    endpoints.startElevation +
    (endpoints.endElevation - endpoints.startElevation) * ratio
  );
}

/**
 * Builds an ordered sequence of line-of-sight chart points and explicit `null` separators that represent visible and hidden stretches along a terrain profile.
 *
 * The function classifies each profile point against the straight line defined by `endpoints`, inserts interpolated crossing points where visibility flips, emits `null` when terrain data is missing or the sight line is occluded by terrain, and avoids consecutive `null` entries.
 *
 * @param points - Array of profile points (each with `distance` and `elevation`) describing the terrain.
 * @param endpoints - Endpoint elevations for the sight line; when `null` the function returns an empty array.
 * @returns An array where visible positions are expressed as `LineOfSightChartPoint` objects and missing-data or terrain-occluded separators are represented by `null`.
 */
export function buildVisibleLineOfSightSegments(
  points: ProfilePoint[],
  endpoints: LineOfSightEndpoints | null,
): (LineOfSightChartPoint | null)[] {
  if (!endpoints || points.length === 0) return [];

  const lastDistance = points.at(-1)?.distance ?? 0;
  const output: (LineOfSightChartPoint | null)[] = [];
  const first = classifyPoint(points[0]!, lastDistance, endpoints);

  appendLineOfSightPoint(output, first.visible ? first.linePoint : null);

  for (let index = 1; index < points.length; index++) {
    const previous = classifyPoint(points[index - 1]!, lastDistance, endpoints);
    const current = classifyPoint(points[index]!, lastDistance, endpoints);

    if (previous.kind === "gap" || current.kind === "gap") {
      appendLineOfSightPoint(output, null);
      appendLineOfSightPoint(
        output,
        current.visible ? current.linePoint : null,
      );
      continue;
    }

    if (previous.visible !== current.visible) {
      appendLineOfSightPoint(
        output,
        crossingPoint(previous, current, lastDistance, endpoints),
      );
    }

    appendLineOfSightPoint(output, current.visible ? current.linePoint : null);
  }

  return output;
}

type ClassifiedPoint = {
  distance: number;
  delta: number | null;
  kind: "finite" | "gap";
  linePoint: LineOfSightChartPoint;
  visible: boolean;
};

/**
 * Classifies a profile point relative to the line of sight at the point's distance.
 *
 * @param point - Profile point containing `distance` and `elevation`
 * @param lastDistance - Reference distance used to compute the line elevation interpolation
 * @param endpoints - Line-of-sight endpoint elevations (`startElevation` and `endElevation`)
 * @returns An object with:
 *  - `distance`: the input point distance,
 *  - `delta`: `lineElevation - terrainElevation` or `null` when terrain elevation is missing,
 *  - `kind`: `"finite"` when terrain elevation is present or `"gap"` otherwise,
 *  - `linePoint`: `{ x, y }` coordinates on the line of sight at the point distance,
 *  - `visible`: `true` when terrain is below the line (`delta > 0`), `false` otherwise
 */
function classifyPoint(
  point: ProfilePoint,
  lastDistance: number,
  endpoints: LineOfSightEndpoints,
): ClassifiedPoint {
  const lineElevation = lineOfSightElevationAt(
    point.distance,
    lastDistance,
    endpoints,
  );
  const hasTerrain = Number.isFinite(point.elevation);
  const delta = hasTerrain ? lineElevation - point.elevation! : null;

  return {
    distance: point.distance,
    delta,
    kind: hasTerrain ? "finite" : "gap",
    linePoint: { x: point.distance, y: lineElevation },
    visible: delta === null ? false : delta > 0,
  };
}

/**
 * Computes the interpolated chart point along the segment where visibility changes between two classified points.
 *
 * @param start - The classified point at the start of the segment
 * @param end - The classified point at the end of the segment
 * @param lastDistance - The last distance in the profile (used to compute line elevation)
 * @param endpoints - The start and end elevations that define the line of sight
 * @returns A chart point (`{ x, y }`) on the line of sight at the estimated crossing distance where visibility flips between `start` and `end`
 */
function crossingPoint(
  start: ClassifiedPoint,
  end: ClassifiedPoint,
  lastDistance: number,
  endpoints: LineOfSightEndpoints,
): LineOfSightChartPoint {
  const startDelta = start.delta ?? 0;
  const endDelta = end.delta ?? 0;
  const denominator = startDelta - endDelta;
  const rawRatio = denominator === 0 ? 0 : startDelta / denominator;
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const distance = start.distance + (end.distance - start.distance) * ratio;

  return {
    x: distance,
    y: lineOfSightElevationAt(distance, lastDistance, endpoints),
  };
}

/**
 * Appends a line-of-sight chart point to the array, avoiding consecutive `null` separators.
 *
 * If `point` is `null` and the last element of `points` is also `null`, the array is not modified.
 *
 * @param points - The array to append into; elements are chart points or `null` gap separators
 * @param point - The chart point to append, or `null` to represent a gap
 */
function appendLineOfSightPoint(
  points: (LineOfSightChartPoint | null)[],
  point: LineOfSightChartPoint | null,
) {
  const last = points.at(-1);
  if (point === null && last === null) return;
  points.push(point);
}

function findLastFiniteElevation(points: ProfilePoint[]): number | undefined {
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index];
    if (point && isFiniteProfileElevation(point)) return point.elevation;
  }

  return undefined;
}

/**
 * Determines whether a profile point has a finite numeric elevation.
 *
 * @returns `true` if `point.elevation` is a finite number, `false` otherwise.
 */
function isFiniteProfileElevation(
  point: ProfilePoint,
): point is ProfilePoint & { elevation: number } {
  return Number.isFinite(point.elevation);
}
