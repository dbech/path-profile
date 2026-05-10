"use client";

import type { ProfilePoint } from "~/types/path-profile";

type ProfileTableProps = {
  points: ProfilePoint[];
  onHoverPoint: (point: ProfilePoint | null) => void;
};

export function ProfileTable({ points, onHoverPoint }: ProfileTableProps) {
  if (points.length === 0) {
    return null;
  }

  const visiblePoints = points.length > 600 ? downsample(points, 600) : points;

  return (
    <div className="themed-scrollbar min-h-0 flex-1 overflow-auto">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-[var(--panel-bg)] text-[var(--text-secondary)]">
          <tr>
            <th className="w-[25%] border-b border-[var(--panel-border)] px-3 py-2 font-medium">
              Distance
            </th>
            <th className="w-[25%] border-b border-[var(--panel-border)] px-3 py-2 font-medium">
              Elevation
            </th>
            <th className="w-[25%] border-b border-[var(--panel-border)] px-3 py-2 font-medium">
              X
            </th>
            <th className="w-[25%] border-b border-[var(--panel-border)] px-3 py-2 font-medium">
              Y
            </th>
          </tr>
        </thead>
        <tbody>
          {visiblePoints.map((point, index) => (
            <tr
              key={`${point.distance}-${index}`}
              className="cursor-default border-b border-[var(--panel-border)] text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)]"
              onMouseEnter={() => onHoverPoint(point)}
              onMouseLeave={() => onHoverPoint(null)}
            >
              <td className="truncate px-3 py-2">
                {formatNumber(point.distance)}
              </td>
              <td className="truncate px-3 py-2">
                {point.elevation === null
                  ? "NoData"
                  : formatNumber(point.elevation)}
              </td>
              <td className="truncate px-3 py-2">{formatNumber(point.x)}</td>
              <td className="truncate px-3 py-2">{formatNumber(point.y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function downsample(points: ProfilePoint[], maxRows: number): ProfilePoint[] {
  const step = Math.ceil(points.length / maxRows);
  return points.filter((_, index) => index % step === 0);
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}
