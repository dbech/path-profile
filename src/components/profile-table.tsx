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
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <thead className="sticky top-0 bg-[#151d26] text-[#b6c4d2]">
          <tr>
            <th className="w-[25%] border-b border-[#25313d] px-3 py-2 font-medium">
              Distance
            </th>
            <th className="w-[25%] border-b border-[#25313d] px-3 py-2 font-medium">
              Elevation
            </th>
            <th className="w-[25%] border-b border-[#25313d] px-3 py-2 font-medium">
              X
            </th>
            <th className="w-[25%] border-b border-[#25313d] px-3 py-2 font-medium">
              Y
            </th>
          </tr>
        </thead>
        <tbody>
          {visiblePoints.map((point, index) => (
            <tr
              key={`${point.distance}-${index}`}
              className="cursor-default border-b border-[#1e2933] text-[#d8e1ea] hover:bg-[#1a2733]"
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
