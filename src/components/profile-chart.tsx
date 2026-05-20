"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import {
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartEvent,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  buildVisibleLineOfSightSegments,
  type LineOfSightEndpointId,
  type LineOfSightEndpoints,
} from "~/lib/line-of-sight";
import type { ProfilePoint } from "~/types/path-profile";

ChartJS.register(
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
);

type ProfileChartProps = {
  lineOfSightEndpoints: LineOfSightEndpoints | null;
  points: ProfilePoint[];
  onHoverPoint: (point: ProfilePoint | null) => void;
  onLineOfSightEndpointChange: (
    endpointId: LineOfSightEndpointId,
    absoluteElevation: number,
  ) => void;
};

const endpointHitRadius = 12;

/**
 * Render an elevation vs. distance line chart with optional interactive line-of-sight endpoints.
 *
 * When `lineOfSightEndpoints` is provided the component overlays dashed LOS segments and two draggable
 * endpoint handles (start at distance 0, end at the last sample distance). Hovering over profile points
 * invokes `onHoverPoint`. Dragging a LOS handle calls `onLineOfSightEndpointChange` with the moved
 * endpoint id and the new absolute elevation derived from the chart Y scale.
 *
 * @param lineOfSightEndpoints - Optional start/end elevations used to draw LOS segments and endpoint handles; when `null` no LOS is shown.
 * @param points - Ordered profile samples where each item provides `distance` (x) and `elevation` (y).
 * @param onHoverPoint - Called with the hovered profile point (from the main elevation dataset) or `null` when no point is hovered.
 * @param onLineOfSightEndpointChange - Called with `(endpointId, absoluteElevation)` when a LOS endpoint is moved by the user.
 * @returns A JSX element that renders the chart and handles pointer interactions for hovering and dragging endpoints.
 */
export function ProfileChart({
  lineOfSightEndpoints,
  points,
  onHoverPoint,
  onLineOfSightEndpointChange,
}: ProfileChartProps) {
  const chartRef = useRef<ChartJS<"line"> | null>(null);
  const [draggingEndpoint, setDraggingEndpoint] =
    useState<LineOfSightEndpointId | null>(null);
  const [hoveredEndpoint, setHoveredEndpoint] =
    useState<LineOfSightEndpointId | null>(null);
  const theme = getThemeColors();

  const lastDistance = points.at(-1)?.distance ?? 0;

  const data: ChartData<"line"> = useMemo(() => {
    const datasets: ChartData<"line">["datasets"] = [
      {
        label: "Elevation",
        data: points.map((point) => ({
          x: point.distance,
          y: point.elevation,
        })),
        borderColor: theme.chartLine,
        backgroundColor: theme.chartFill,
        borderWidth: 2,
        pointRadius: points.length > 300 ? 0 : 1.8,
        pointHoverRadius: 4,
        fill: true,
        spanGaps: false,
        tension: 0.12,
      },
    ];

    if (lineOfSightEndpoints) {
      const lineOfSightSegments = splitVisibleLineOfSightSegments(
        buildVisibleLineOfSightSegments(points, lineOfSightEndpoints),
      );

      datasets.push(
        ...lineOfSightSegments.map((segment) => ({
          label: "Line of sight",
          data: segment,
          borderColor: theme.lineOfSight,
          backgroundColor: "transparent",
          borderDash: [7, 5],
          borderWidth: 2,
          fill: false,
          pointRadius: 0,
          pointHitRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          tension: 0,
        })),
        {
          label: "LOS endpoints",
          data: [
            { x: 0, y: lineOfSightEndpoints.startElevation },
            { x: lastDistance, y: lineOfSightEndpoints.endElevation },
          ],
          borderColor: theme.lineOfSightHandleBorder,
          backgroundColor: theme.lineOfSight,
          borderWidth: 2,
          fill: false,
          pointRadius: 5,
          pointHitRadius: endpointHitRadius,
          pointHoverRadius: 7,
          showLine: false,
        },
      );
    }

    return { datasets };
  }, [lastDistance, lineOfSightEndpoints, points, theme]);

  const getEndpointAtEvent = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const chart = chartRef.current;
      if (!chart || !lineOfSightEndpoints) return null;

      const pointer = getPointerPosition(event, chart);
      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return null;

      const endpoints: {
        id: LineOfSightEndpointId;
        x: number;
        y: number;
      }[] = [
        {
          id: "start",
          x: xScale.getPixelForValue(0),
          y: yScale.getPixelForValue(lineOfSightEndpoints.startElevation),
        },
        {
          id: "end",
          x: xScale.getPixelForValue(lastDistance),
          y: yScale.getPixelForValue(lineOfSightEndpoints.endElevation),
        },
      ];

      const hit = endpoints.find(
        (endpoint) =>
          Math.hypot(pointer.x - endpoint.x, pointer.y - endpoint.y) <=
          endpointHitRadius,
      );

      return hit?.id ?? null;
    },
    [lastDistance, lineOfSightEndpoints],
  );

  const updateEndpointFromPointer = useCallback(
    (
      event: PointerEvent<HTMLDivElement>,
      endpointId: LineOfSightEndpointId,
    ) => {
      const chart = chartRef.current;
      if (!chart) return;

      const pointer = getPointerPosition(event, chart);
      const yScale = chart.scales.y;
      if (!yScale) return;

      const elevation = yScale.getValueForPixel(pointer.y);

      if (typeof elevation === "number" && Number.isFinite(elevation)) {
        onLineOfSightEndpointChange(endpointId, elevation);
      }
    },
    [onLineOfSightEndpointChange],
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const endpoint = getEndpointAtEvent(event);
      if (!endpoint) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraggingEndpoint(endpoint);
      setHoveredEndpoint(endpoint);
      updateEndpointFromPointer(event, endpoint);
    },
    [getEndpointAtEvent, updateEndpointFromPointer],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (draggingEndpoint) {
        event.preventDefault();
        updateEndpointFromPointer(event, draggingEndpoint);
        return;
      }

      setHoveredEndpoint(getEndpointAtEvent(event));
    },
    [draggingEndpoint, getEndpointAtEvent, updateEndpointFromPointer],
  );

  const handlePointerEnd = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setDraggingEndpoint(null);
    },
    [],
  );

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-[var(--text-muted)]">
        No profile
      </div>
    );
  }

  const options: ChartOptions<"line"> = {
    animation: false,
    maintainAspectRatio: false,
    parsing: false,
    normalized: true,
    interaction: {
      intersect: false,
      mode: "nearest",
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => {
            const label = context.dataset.label;
            const elevation = formatNumber(Number(context.parsed.y));

            if (label === "Line of sight") {
              return `Line of sight ${elevation}`;
            }

            if (label === "LOS endpoints") {
              return `${context.dataIndex === 0 ? "Start" : "End"} ${elevation}`;
            }

            return `Elevation ${elevation}`;
          },
          title: (items) =>
            `Distance ${formatNumber(Number(items[0]?.parsed.x ?? 0))}`,
        },
      },
    },
    scales: {
      x: {
        type: "linear",
        min: 0,
        max: lastDistance,
        grid: { color: theme.grid },
        ticks: { color: theme.textSecondary, maxTicksLimit: 6 },
        title: {
          color: theme.textSecondary,
          display: true,
          text: "Distance",
        },
      },
      y: {
        type: "linear",
        grid: { color: theme.grid },
        ticks: { color: theme.textSecondary, maxTicksLimit: 6 },
        title: {
          color: theme.textSecondary,
          display: true,
          text: "Elevation",
        },
      },
    },
    onHover: (event: ChartEvent) => {
      const chart = chartRef.current;
      const xScale = chart?.scales.x;

      if (
        !chart ||
        !xScale ||
        typeof event.x !== "number" ||
        typeof event.y !== "number" ||
        event.x < chart.chartArea.left ||
        event.x > chart.chartArea.right ||
        event.y < chart.chartArea.top ||
        event.y > chart.chartArea.bottom
      ) {
        onHoverPoint(null);
        return;
      }

      const distance = xScale.getValueForPixel(event.x);
      const point =
        typeof distance === "number" && Number.isFinite(distance)
          ? getNearestProfilePointAtDistance(points, distance)
          : null;

      onHoverPoint(point?.elevation === null ? null : point);
    },
  };

  return (
    <div
      className="h-full min-h-0 py-3"
      style={{
        cursor: draggingEndpoint ? "grabbing" : hoveredEndpoint ? "grab" : "",
      }}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerLeave={() => {
        if (!draggingEndpoint) setHoveredEndpoint(null);
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
    >
      <Line ref={chartRef} data={data} options={options} />
    </div>
  );
}

/**
 * Compute pointer coordinates relative to the chart's canvas.
 *
 * @param event - The pointer event from the chart container
 * @param chart - The Chart.js line chart whose canvas bounds are used
 * @returns The `{ x, y }` position in pixels measured from the chart canvas's top-left corner
 */
function getPointerPosition(
  event: PointerEvent<HTMLDivElement>,
  chart: ChartJS<"line">,
): { x: number; y: number } {
  const rect = chart.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getNearestProfilePointAtDistance(
  points: ProfilePoint[],
  distance: number,
): ProfilePoint | null {
  if (points.length === 0) return null;

  let low = 0;
  let high = points.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const middlePoint = points[middle];

    if (middlePoint && middlePoint.distance < distance) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const candidate = points[low] ?? null;
  const previous = low > 0 ? (points[low - 1] ?? null) : null;

  if (!candidate) return previous;
  if (!previous) return candidate;

  return Math.abs(previous.distance - distance) <=
    Math.abs(candidate.distance - distance)
    ? previous
    : candidate;
}

/**
 * Split an iterable of profile points (with `null` used as a gap marker) into continuous visible segments.
 *
 * @param points - Iterable produced by `buildVisibleLineOfSightSegments` where `null` separates segments.
 * @returns An array of segments; each segment is an array of `{ x, y }` points and is included only if it contains more than one point.
 */
function splitVisibleLineOfSightSegments(
  points: ReturnType<typeof buildVisibleLineOfSightSegments>,
) {
  const segments: { x: number; y: number }[][] = [];
  let currentSegment: { x: number; y: number }[] = [];

  for (const point of points) {
    if (point === null) {
      if (currentSegment.length > 1) {
        segments.push(currentSegment);
      }
      currentSegment = [];
      continue;
    }

    currentSegment.push(point);
  }

  if (currentSegment.length > 1) {
    segments.push(currentSegment);
  }

  return segments;
}

/**
 * Formats a number using the runtime locale with up to three digits after the decimal point.
 *
 * @param value - The number to format
 * @returns The locale-aware string representation of `value` with at most three fractional digits
 */
function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

/**
 * Provide chart-related theme color values sourced from CSS custom properties or a fixed fallback during server-side rendering.
 *
 * @returns An object with the following CSS color string properties:
 * - `chartLine`: primary line color for the profile chart
 * - `chartFill`: fill color for the profile area beneath the line
 * - `grid`: grid line color
 * - `lineOfSight`: color used for line-of-sight segments
 * - `lineOfSightHandleBorder`: border color for line-of-sight endpoint handles
 * - `textSecondary`: secondary text color used for chart labels and tooltips
 *
 * When `window` is unavailable (SSR), returns fixed fallback values; when running in a browser, reads values from CSS custom properties on `:root`.
 */
function getThemeColors() {
  if (typeof window === "undefined") {
    return {
      chartLine: "#25c2a0",
      chartFill: "rgba(37, 194, 160, 0.16)",
      grid: "rgba(143, 161, 179, 0.18)",
      lineOfSight: "#f6c445",
      lineOfSightHandleBorder: "#151d26",
      textSecondary: "#b6c4d2",
    };
  }

  const styles = getComputedStyle(document.documentElement);
  return {
    chartLine: styles.getPropertyValue("--chart-line").trim(),
    chartFill: styles.getPropertyValue("--chart-fill").trim(),
    grid: "rgba(143, 161, 179, 0.18)",
    lineOfSight: styles.getPropertyValue("--warning").trim(),
    lineOfSightHandleBorder: styles.getPropertyValue("--panel-bg").trim(),
    textSecondary: styles.getPropertyValue("--text-secondary").trim(),
  };
}
