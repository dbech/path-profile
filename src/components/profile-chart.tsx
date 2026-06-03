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
  type Plugin,
  type Scale,
} from "chart.js";
import { Line } from "react-chartjs-2";
import {
  DEFAULT_FRESNEL_FREQUENCY_MHZ,
  FRESNEL_SHELL_NUMBERS,
  buildVisibleFresnelZoneShellSegments,
  buildVisibleLineOfSightSegments,
  type FresnelZoneShellSegments,
  type FresnelZoneUnitScales,
  type LineOfSightChartPoint,
  type LineOfSightAdjustment,
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
  elevationUnit: string | null;
  fresnelUnitScales: FresnelZoneUnitScales | null;
  lineOfSightEndpoints: LineOfSightEndpoints | null;
  lineOfSightDrafts: LineOfSightDrafts;
  points: ProfilePoint[];
  onHoverPoint: (point: ProfilePoint | null) => void;
  onLineOfSightDraftChange: (
    endpointId: LineOfSightEndpointId,
    value: string,
  ) => void;
  onLineOfSightDraftCommit: (endpointId: LineOfSightEndpointId) => void;
  onLineOfSightEndpointChange: (
    endpointId: LineOfSightEndpointId,
    absoluteElevation: number,
  ) => void;
};

type LineOfSightDrafts = Record<LineOfSightEndpointId, string>;

type ChartBounds = {
  controlTop: number;
  left: number;
  right: number;
  width: number;
};

type LineOfSightOverlay = {
  adjustment: LineOfSightAdjustment;
  segments: LineOfSightChartPoint[][];
};

type FresnelShellOverlay = {
  adjustment: LineOfSightAdjustment;
  segments: FresnelZoneShellSegments;
  shellNumber: number;
};

const endpointHitRadius = 12;
const endpointColors: Record<LineOfSightEndpointId, string> = {
  start: "#157b68",
  end: "#c93d4b",
};
const endpointLabels: Record<LineOfSightEndpointId, "A" | "B"> = {
  start: "A",
  end: "B",
};
const endpointBadgeSize = 18;
const endpointInputLabelWidth = 20;
const endpointInputLabelHalfWidth = endpointInputLabelWidth / 2;
const endpointInputFieldWidth = 56;
const lineOfSightControlTop = 11;
const lineOfSightEndpointDatasetLabel = "LOS endpoints";
const fresnelShellHitRadius = 7;
const fresnelFrequencyInputFieldWidth = 72;
const adjustedLineAlpha = 0.48;
const adjustedMutedLineAlpha = 0.32;
// Chart.js draws higher ordered datasets earlier, so these overlays sit below the elevation profile.
const elevationDatasetOrder = 0;
const endpointDatasetOrder = -10;
const belowProfileOverlayDatasetOrder = 20;
const adjustedBelowProfileOverlayDatasetOrder = 19;
const fresnelShellDatasetOrder = 30;
const adjustedFresnelShellDatasetOrder = 29;

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
  elevationUnit,
  fresnelUnitScales,
  lineOfSightEndpoints,
  lineOfSightDrafts,
  points,
  onHoverPoint,
  onLineOfSightDraftChange,
  onLineOfSightDraftCommit,
  onLineOfSightEndpointChange,
}: ProfileChartProps) {
  const chartRef = useRef<ChartJS<"line"> | null>(null);
  const [chartBounds, setChartBounds] = useState<ChartBounds | null>(null);
  const [draggingEndpoint, setDraggingEndpoint] =
    useState<LineOfSightEndpointId | null>(null);
  const [hoveredEndpoint, setHoveredEndpoint] =
    useState<LineOfSightEndpointId | null>(null);
  const [fresnelFrequencyDraft, setFresnelFrequencyDraft] = useState(
    formatFrequencyInput(DEFAULT_FRESNEL_FREQUENCY_MHZ),
  );
  const [fresnelFrequencyMhz, setFresnelFrequencyMhz] = useState(
    DEFAULT_FRESNEL_FREQUENCY_MHZ,
  );
  const [mutedFresnelShells, setMutedFresnelShells] = useState<Set<number>>(
    () => new Set(),
  );
  const [hoveredFresnelShell, setHoveredFresnelShell] = useState<number | null>(
    null,
  );
  const theme = getThemeColors();

  const lastDistance = points.at(-1)?.distance ?? 0;
  const lineOfSightOverlays = useMemo<LineOfSightOverlay[]>(() => {
    if (!lineOfSightEndpoints) return [];

    const overlays: LineOfSightOverlay[] = [
      {
        adjustment: "flat",
        segments: splitVisibleLineOfSightSegments(
          buildVisibleLineOfSightSegments(points, lineOfSightEndpoints),
        ),
      },
    ];

    if (fresnelUnitScales) {
      overlays.push({
        adjustment: "curvature-adjusted",
        segments: splitVisibleLineOfSightSegments(
          buildVisibleLineOfSightSegments(
            points,
            lineOfSightEndpoints,
            "curvature-adjusted",
            fresnelUnitScales,
          ),
        ),
      });
    }

    return overlays;
  }, [fresnelUnitScales, lineOfSightEndpoints, points]);
  const fresnelShellOverlays = useMemo<FresnelShellOverlay[]>(() => {
    if (!fresnelUnitScales || !lineOfSightEndpoints) return [];

    return FRESNEL_SHELL_NUMBERS.flatMap((shellNumber) => [
      {
        adjustment: "flat" as const,
        segments: buildVisibleFresnelZoneShellSegments(
          points,
          lineOfSightEndpoints,
          fresnelFrequencyMhz,
          shellNumber,
          fresnelUnitScales,
        ),
        shellNumber,
      },
      {
        adjustment: "curvature-adjusted" as const,
        segments: buildVisibleFresnelZoneShellSegments(
          points,
          lineOfSightEndpoints,
          fresnelFrequencyMhz,
          shellNumber,
          fresnelUnitScales,
          "curvature-adjusted",
        ),
        shellNumber,
      },
    ]);
  }, [fresnelFrequencyMhz, fresnelUnitScales, lineOfSightEndpoints, points]);
  const fresnelYBounds = useMemo(
    () =>
      chartPointYBounds(
        ...lineOfSightOverlays.flatMap((overlay) => overlay.segments),
        ...fresnelShellOverlays.flatMap((overlay) => [
          ...overlay.segments.lower,
          ...overlay.segments.upper,
        ]),
      ),
    [fresnelShellOverlays, lineOfSightOverlays],
  );
  const showFresnelFrequencyInput = fresnelShellOverlays.length > 0;
  const controlPositionPlugin = useMemo<Plugin<"line">>(
    () => ({
      id: "lineOfSightControlPositions",
      afterLayout: (chart) => {
        const nextBounds = {
          controlTop: lineOfSightControlTop,
          left: Math.round(chart.chartArea.left),
          right: Math.round(chart.chartArea.right),
          width: Math.round(chart.width),
        };

        if (
          nextBounds.width <= 0 ||
          !Number.isFinite(nextBounds.left) ||
          !Number.isFinite(nextBounds.right)
        ) {
          return;
        }

        setChartBounds((current) => {
          if (
            current?.controlTop === nextBounds.controlTop &&
            current.left === nextBounds.left &&
            current.right === nextBounds.right &&
            current.width === nextBounds.width
          ) {
            return current;
          }

          return nextBounds;
        });
      },
    }),
    [],
  );
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
        order: elevationDatasetOrder,
        spanGaps: false,
        tension: 0.12,
      },
    ];

    for (const overlay of fresnelShellOverlays) {
      const isMuted = mutedFresnelShells.has(overlay.shellNumber);
      const isAdjusted = overlay.adjustment === "curvature-adjusted";
      const baseColor = isMuted ? theme.fresnelShellMuted : theme.fresnelShell;
      const borderColor = isAdjusted
        ? colorWithAlpha(
            baseColor,
            isMuted ? adjustedMutedLineAlpha : adjustedLineAlpha,
          )
        : baseColor;
      const borderWidth = isMuted ? 0.85 : isAdjusted ? 1.1 : 1.5;
      const borderDash = isAdjusted ? [3, 5] : undefined;
      const labelPrefix =
        overlay.adjustment === "curvature-adjusted"
          ? `Fresnel zone ${overlay.shellNumber} adjusted`
          : `Fresnel zone ${overlay.shellNumber}`;

      for (const segment of overlay.segments.upper) {
        datasets.push({
          label: `${labelPrefix} upper`,
          data: segment,
          borderColor,
          backgroundColor: "transparent",
          borderDash,
          borderWidth,
          fill: false,
          order: isAdjusted
            ? adjustedFresnelShellDatasetOrder
            : fresnelShellDatasetOrder,
          pointRadius: 0,
          pointHitRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          tension: 0,
        });
      }

      for (const segment of overlay.segments.lower) {
        datasets.push({
          label: `${labelPrefix} lower`,
          data: segment,
          borderColor,
          backgroundColor: "transparent",
          borderDash,
          borderWidth,
          fill: false,
          order: isAdjusted
            ? adjustedFresnelShellDatasetOrder
            : fresnelShellDatasetOrder,
          pointRadius: 0,
          pointHitRadius: 0,
          pointHoverRadius: 0,
          spanGaps: false,
          tension: 0,
        });
      }
    }

    if (lineOfSightEndpoints) {
      datasets.push(
        ...lineOfSightOverlays.flatMap((overlay) => {
          const isAdjusted = overlay.adjustment === "curvature-adjusted";

          return overlay.segments.map((segment) => ({
            label: isAdjusted
              ? "Curvature-adjusted line of sight"
              : "Line of sight",
            data: segment,
            borderColor: isAdjusted
              ? colorWithAlpha(theme.lineOfSight, adjustedLineAlpha)
              : theme.lineOfSight,
            backgroundColor: "transparent",
            borderDash: isAdjusted ? [2, 4] : [7, 5],
            borderWidth: isAdjusted ? 1.35 : 2,
            fill: false,
            order: isAdjusted
              ? adjustedBelowProfileOverlayDatasetOrder
              : belowProfileOverlayDatasetOrder,
            pointRadius: 0,
            pointHitRadius: 0,
            pointHoverRadius: 0,
            spanGaps: false,
            tension: 0,
          }));
        }),
        {
          label: lineOfSightEndpointDatasetLabel,
          data: [
            { x: 0, y: lineOfSightEndpoints.startElevation },
            { x: lastDistance, y: lineOfSightEndpoints.endElevation },
          ],
          borderColor: "#ffffff",
          backgroundColor: [endpointColors.start, endpointColors.end],
          borderWidth: 2,
          fill: false,
          order: endpointDatasetOrder,
          pointRadius: 0,
          pointHitRadius: endpointHitRadius,
          pointHoverRadius: 0,
          showLine: false,
        },
      );
    }

    return { datasets };
  }, [
    fresnelShellOverlays,
    lastDistance,
    lineOfSightOverlays,
    lineOfSightEndpoints,
    mutedFresnelShells,
    points,
    theme,
  ]);

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

  const getFresnelShellAtEvent = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const chart = chartRef.current;
      if (!chart || fresnelShellOverlays.length === 0) return null;

      const xScale = chart.scales.x;
      const yScale = chart.scales.y;
      if (!xScale || !yScale) return null;

      const pointer = getPointerPosition(event, chart);
      let nearestShell: number | null = null;
      let nearestDistance = Infinity;

      for (const overlay of fresnelShellOverlays) {
        const distance = Math.min(
          ...overlay.segments.upper.map((segment) =>
            distanceToChartLine(pointer, segment, xScale, yScale),
          ),
          ...overlay.segments.lower.map((segment) =>
            distanceToChartLine(pointer, segment, xScale, yScale),
          ),
        );

        if (distance <= fresnelShellHitRadius && distance < nearestDistance) {
          nearestDistance = distance;
          nearestShell = overlay.shellNumber;
        }
      }

      return nearestShell;
    },
    [fresnelShellOverlays],
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

  const toggleFresnelShell = useCallback((shellNumber: number) => {
    setMutedFresnelShells((current) => {
      const next = new Set(current);

      if (next.has(shellNumber)) {
        next.delete(shellNumber);
      } else {
        next.add(shellNumber);
      }

      return next;
    });
  }, []);

  const handleFresnelFrequencyDraftChange = useCallback((value: string) => {
    setFresnelFrequencyDraft(value);

    const frequencyMhz = parseFresnelFrequencyDraft(value);
    if (frequencyMhz !== null) {
      setFresnelFrequencyMhz(frequencyMhz);
    }
  }, []);

  const handleFresnelFrequencyDraftCommit = useCallback(() => {
    const frequencyMhz = parseFresnelFrequencyDraft(fresnelFrequencyDraft);

    if (frequencyMhz !== null) {
      setFresnelFrequencyMhz(frequencyMhz);
      setFresnelFrequencyDraft(formatFrequencyInput(frequencyMhz));
      return;
    }

    setFresnelFrequencyDraft(formatFrequencyInput(fresnelFrequencyMhz));
  }, [fresnelFrequencyDraft, fresnelFrequencyMhz]);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const endpoint = getEndpointAtEvent(event);
      if (endpoint) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDraggingEndpoint(endpoint);
        setHoveredEndpoint(endpoint);
        setHoveredFresnelShell(null);
        updateEndpointFromPointer(event, endpoint);
        return;
      }

      const fresnelShellNumber = getFresnelShellAtEvent(event);
      if (fresnelShellNumber === null) return;

      event.preventDefault();
      setHoveredFresnelShell(fresnelShellNumber);
      toggleFresnelShell(fresnelShellNumber);
    },
    [
      getEndpointAtEvent,
      getFresnelShellAtEvent,
      toggleFresnelShell,
      updateEndpointFromPointer,
    ],
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (draggingEndpoint) {
        event.preventDefault();
        updateEndpointFromPointer(event, draggingEndpoint);
        return;
      }

      const endpoint = getEndpointAtEvent(event);
      setHoveredEndpoint(endpoint);
      setHoveredFresnelShell(
        endpoint === null ? getFresnelShellAtEvent(event) : null,
      );
    },
    [
      draggingEndpoint,
      getEndpointAtEvent,
      getFresnelShellAtEvent,
      updateEndpointFromPointer,
    ],
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

            if (
              label === "Line of sight" ||
              label === "Curvature-adjusted line of sight"
            ) {
              return `${label} ${elevation}`;
            }

            if (label === lineOfSightEndpointDatasetLabel) {
              return `${context.dataIndex === 0 ? "A" : "B"} ${elevation}`;
            }

            if (label?.startsWith("Fresnel zone")) {
              return `${label} ${elevation}`;
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
        ticks: {
          callback: (value) => formatNumber(Number(value)),
          color: theme.textSecondary,
          maxTicksLimit: 6,
        },
        title: {
          color: theme.textSecondary,
          display: true,
          text: "Distance",
        },
      },
      y: {
        type: "linear",
        grid: { color: theme.grid },
        suggestedMax: fresnelYBounds?.max,
        suggestedMin: fresnelYBounds?.min,
        ticks: {
          callback: (value) => formatNumber(Number(value)),
          color: theme.textSecondary,
          maxTicksLimit: 6,
        },
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
      className="relative h-full min-h-0 pt-8 pb-3"
      style={{
        cursor: draggingEndpoint
          ? "grabbing"
          : hoveredEndpoint
            ? "grab"
            : hoveredFresnelShell !== null
              ? "pointer"
              : "",
      }}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerLeave={() => {
        if (!draggingEndpoint) {
          setHoveredEndpoint(null);
          setHoveredFresnelShell(null);
        }
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
    >
      {lineOfSightEndpoints && chartBounds ? (
        <div
          className="pointer-events-none absolute right-0 left-0 z-20 h-5"
          style={{ top: chartBounds.controlTop }}
        >
          <div
            className="pointer-events-auto absolute"
            style={{
              left:
                chartBounds.left -
                endpointInputLabelWidth +
                endpointInputLabelHalfWidth,
            }}
          >
            <LineOfSightEndpointInput
              elevationUnit={elevationUnit}
              endpointId="start"
              label={endpointLabels.start}
              value={lineOfSightDrafts.start}
              onDraftChange={onLineOfSightDraftChange}
              onDraftCommit={onLineOfSightDraftCommit}
            />
          </div>
          {showFresnelFrequencyInput ? (
            <div
              className="pointer-events-auto absolute"
              style={{
                left:
                  chartBounds.left + (chartBounds.right - chartBounds.left) / 2,
                transform: "translateX(-50%)",
              }}
            >
              <FresnelFrequencyInput
                value={fresnelFrequencyDraft}
                onDraftChange={handleFresnelFrequencyDraftChange}
                onDraftCommit={handleFresnelFrequencyDraftCommit}
              />
            </div>
          ) : null}
          <div
            className="pointer-events-auto absolute"
            style={{
              left:
                chartBounds.right -
                endpointInputFieldWidth -
                endpointInputLabelHalfWidth,
            }}
          >
            <LineOfSightEndpointInput
              elevationUnit={elevationUnit}
              endpointId="end"
              label={endpointLabels.end}
              value={lineOfSightDrafts.end}
              onDraftChange={onLineOfSightDraftChange}
              onDraftCommit={onLineOfSightDraftCommit}
            />
          </div>
        </div>
      ) : null}
      <Line
        ref={chartRef}
        data={data}
        options={options}
        plugins={[controlPositionPlugin, lineOfSightEndpointLabelPlugin]}
      />
    </div>
  );
}

type LineOfSightEndpointInputProps = {
  elevationUnit: string | null;
  endpointId: LineOfSightEndpointId;
  label: "A" | "B";
  value: string;
  onDraftChange: (endpointId: LineOfSightEndpointId, value: string) => void;
  onDraftCommit: (endpointId: LineOfSightEndpointId) => void;
};

function LineOfSightEndpointInput({
  elevationUnit,
  endpointId,
  label,
  value,
  onDraftChange,
  onDraftCommit,
}: LineOfSightEndpointInputProps) {
  return (
    <label
      className={`flex h-5 overflow-hidden rounded-sm border border-[var(--panel-border)] bg-[var(--panel-bg)] text-xs ${endpointId === "end" ? "flex-row-reverse" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span
        className="flex h-full w-5 items-center justify-center text-[9px] font-semibold text-white"
        style={{ backgroundColor: endpointColors[endpointId] }}
      >
        {label}
      </span>
      <span className="relative flex h-full">
        <input
          aria-label={`${label} line-of-sight elevation`}
          className={`h-full w-14 border-0 bg-transparent text-xs text-[var(--text-secondary)] outline-none focus:bg-[var(--control-bg-hover)] focus:text-[var(--text-primary)] ${
            endpointId === "start" ? "text-left" : "text-right"
          } ${elevationUnit ? "pr-4 pl-0.5" : "px-0.5"}`}
          inputMode="decimal"
          type="text"
          value={value}
          onBlur={() => onDraftCommit(endpointId)}
          onChange={(event) => onDraftChange(endpointId, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        {elevationUnit ? (
          <span className="pointer-events-none absolute top-0 right-0.5 flex h-full items-center text-[9px] text-[var(--text-muted)]">
            {elevationUnit}
          </span>
        ) : null}
      </span>
    </label>
  );
}

type FresnelFrequencyInputProps = {
  value: string;
  onDraftChange: (value: string) => void;
  onDraftCommit: () => void;
};

function FresnelFrequencyInput({
  value,
  onDraftChange,
  onDraftCommit,
}: FresnelFrequencyInputProps) {
  return (
    <label
      className="flex h-5 overflow-hidden rounded-sm border border-[var(--panel-border)] bg-[var(--panel-bg)] text-xs"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="flex h-full w-5 items-center justify-center bg-[var(--fresnel-shell)] text-[9px] font-semibold text-white">
        F
      </span>
      <span className="relative flex h-full">
        <input
          aria-label="Fresnel frequency"
          className="h-full border-0 bg-transparent pr-7 pl-1 text-center text-xs text-[var(--text-secondary)] outline-none focus:bg-[var(--control-bg-hover)] focus:text-[var(--text-primary)]"
          inputMode="decimal"
          style={{ width: fresnelFrequencyInputFieldWidth }}
          type="text"
          value={value}
          onBlur={onDraftCommit}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
        <span className="pointer-events-none absolute top-0 right-1 flex h-full items-center text-[9px] text-[var(--text-muted)]">
          MHz
        </span>
      </span>
    </label>
  );
}

const lineOfSightEndpointLabelPlugin: Plugin<"line"> = {
  id: "lineOfSightEndpointLabels",
  afterDraw: (chart) => {
    const datasetIndex = chart.data.datasets.findIndex(
      (dataset) => dataset.label === lineOfSightEndpointDatasetLabel,
    );
    if (datasetIndex < 0) return;

    const meta = chart.getDatasetMeta(datasetIndex);
    const labels: ("A" | "B")[] = [endpointLabels.start, endpointLabels.end];
    const ctx = chart.ctx;

    ctx.save();
    meta.data.forEach((element, index) => {
      const label = labels[index];
      if (!label) return;
      const { x, y } = element.tooltipPosition(true);
      if (x === null || y === null) return;

      const fill =
        label === endpointLabels.start
          ? endpointColors.start
          : endpointColors.end;
      const badgeX = x - endpointBadgeSize / 2;
      const badgeY = y - endpointBadgeSize / 2;
      drawRoundedRect(
        ctx,
        badgeX,
        badgeY,
        endpointBadgeSize,
        endpointBadgeSize,
        2,
      );
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y + 0.5);
    });

    ctx.restore();
  },
};

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
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

function chartPointYBounds(
  ...pointSets: (LineOfSightChartPoint[] | undefined)[]
): { max: number; min: number } | undefined {
  let min = Infinity;
  let max = -Infinity;

  for (const points of pointSets) {
    for (const point of points ?? []) {
      if (!Number.isFinite(point.y)) continue;
      min = Math.min(min, point.y);
      max = Math.max(max, point.y);
    }
  }

  return min === Infinity || max === -Infinity ? undefined : { max, min };
}

function distanceToChartLine(
  pointer: { x: number; y: number },
  points: LineOfSightChartPoint[],
  xScale: Scale,
  yScale: Scale,
): number {
  if (points.length < 2) return Infinity;

  let nearestDistance = Infinity;

  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;

    const start = chartPointToPixel(previous, xScale, yScale);
    const end = chartPointToPixel(current, xScale, yScale);

    nearestDistance = Math.min(
      nearestDistance,
      distanceToSegment(pointer, start, end),
    );
  }

  return nearestDistance;
}

function chartPointToPixel(
  point: LineOfSightChartPoint,
  xScale: Scale,
  yScale: Scale,
): { x: number; y: number } {
  return {
    x: xScale.getPixelForValue(point.x),
    y: yScale.getPixelForValue(point.y),
  };
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const rawRatio =
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const ratio = Math.max(0, Math.min(1, rawRatio));
  const projectedX = start.x + ratio * dx;
  const projectedY = start.y + ratio * dy;

  return Math.hypot(point.x - projectedX, point.y - projectedY);
}

function colorWithAlpha(color: string, alpha: number): string {
  const boundedAlpha = Math.max(0, Math.min(1, alpha));
  const trimmedColor = color.trim();
  const hexPattern =
    /^#(?<red>[0-9a-f]{2})(?<green>[0-9a-f]{2})(?<blue>[0-9a-f]{2})$/i;
  const hexMatch = hexPattern.exec(trimmedColor);

  if (hexMatch?.groups) {
    const red = Number.parseInt(hexMatch.groups.red!, 16);
    const green = Number.parseInt(hexMatch.groups.green!, 16);
    const blue = Number.parseInt(hexMatch.groups.blue!, 16);

    return `rgba(${red}, ${green}, ${blue}, ${boundedAlpha})`;
  }

  const rgbPattern =
    /^rgba?\(\s*(?<red>\d+)\s*,\s*(?<green>\d+)\s*,\s*(?<blue>\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i;
  const rgbMatch = rgbPattern.exec(trimmedColor);

  if (rgbMatch?.groups) {
    return `rgba(${rgbMatch.groups.red}, ${rgbMatch.groups.green}, ${rgbMatch.groups.blue}, ${boundedAlpha})`;
  }

  return color;
}

function parseFresnelFrequencyDraft(value: string): number | null {
  if (value.trim() === "") return null;
  const frequencyMhz = Number(value);
  const frequencyHz = frequencyMhz * 1_000_000;

  return Number.isFinite(frequencyMhz) &&
    frequencyMhz > 0 &&
    Number.isFinite(frequencyHz) &&
    frequencyHz > 0
    ? frequencyMhz
    : null;
}

function formatFrequencyInput(value: number): string {
  if (Number.isInteger(value)) return value.toFixed(0);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Formats a number using the runtime locale with exactly two digits after the decimal point.
 *
 * @param value - The number to format
 * @returns The locale-aware string representation of `value` with exactly two fractional digits
 */
function formatNumber(value: number): string {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/**
 * Provide chart-related theme color values sourced from CSS custom properties or a fixed fallback during server-side rendering.
 *
 * @returns An object with the following CSS color string properties:
 * - `chartLine`: primary line color for the profile chart
 * - `chartFill`: fill color for the profile area beneath the line
 * - `fresnelShell`: line color for active Fresnel shell boundaries
 * - `fresnelShellMuted`: line color for muted Fresnel shell boundaries
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
      fresnelShell: "#4a90e2",
      fresnelShellMuted: "#8fa1b3",
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
    fresnelShell: styles.getPropertyValue("--fresnel-shell").trim(),
    fresnelShellMuted: styles.getPropertyValue("--fresnel-shell-muted").trim(),
    grid: "rgba(143, 161, 179, 0.18)",
    lineOfSight: styles.getPropertyValue("--warning").trim(),
    lineOfSightHandleBorder: styles.getPropertyValue("--panel-bg").trim(),
    textSecondary: styles.getPropertyValue("--text-secondary").trim(),
  };
}
