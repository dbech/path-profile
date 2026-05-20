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

export function createDefaultLineOfSightEndpoints(
  points: ProfilePoint[],
): LineOfSightEndpoints | null {
  const startElevation = points.find(isFiniteProfileElevation)?.elevation;
  const endElevation = [...points]
    .reverse()
    .find(isFiniteProfileElevation)?.elevation;

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

function appendLineOfSightPoint(
  points: (LineOfSightChartPoint | null)[],
  point: LineOfSightChartPoint | null,
) {
  const last = points.at(-1);
  if (point === null && last === null) return;
  points.push(point);
}

function isFiniteProfileElevation(
  point: ProfilePoint,
): point is ProfilePoint & { elevation: number } {
  return Number.isFinite(point.elevation);
}
