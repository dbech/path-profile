"use client";

import {
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ActiveElement,
  type ChartEvent,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
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
  points: ProfilePoint[];
  onHoverPoint: (point: ProfilePoint | null) => void;
};

export function ProfileChart({ points, onHoverPoint }: ProfileChartProps) {
  const theme = getThemeColors();

  if (points.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center text-sm text-[var(--text-muted)]">
        No profile
      </div>
    );
  }

  const lastDistance = points.at(-1)?.distance ?? 0;
  const data = {
    datasets: [
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
    ],
  };

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
          label: (context) =>
            `Elevation ${formatNumber(Number(context.parsed.y))}`,
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
    onHover: (_event: ChartEvent, elements: ActiveElement[]) => {
      const element = elements[0];
      if (!element) {
        onHoverPoint(null);
        return;
      }
      const point = points[element.index] ?? null;
      onHoverPoint(point?.elevation === null ? null : point);
    },
  };

  return (
    <div className="h-full min-h-0 py-3">
      <Line data={data} options={options} />
    </div>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function getThemeColors() {
  if (typeof window === "undefined") {
    return {
      chartLine: "#25c2a0",
      chartFill: "rgba(37, 194, 160, 0.16)",
      grid: "rgba(143, 161, 179, 0.18)",
      textSecondary: "#b6c4d2",
    };
  }

  const styles = getComputedStyle(document.documentElement);
  return {
    chartLine: styles.getPropertyValue("--chart-line").trim(),
    chartFill: styles.getPropertyValue("--chart-fill").trim(),
    grid: "rgba(143, 161, 179, 0.18)",
    textSecondary: styles.getPropertyValue("--text-secondary").trim(),
  };
}
