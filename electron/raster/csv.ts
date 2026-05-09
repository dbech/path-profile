import type { ProfilePoint } from "../../src/types/path-profile";

export function profilePointsToCsv(points: ProfilePoint[]): string {
  const rows = [
    ["distance", "x", "y", "elevation", "source_file"],
    ...points.map((point) => [
      point.distance.toString(),
      point.x.toString(),
      point.y.toString(),
      point.elevation === null ? "" : point.elevation.toString(),
      point.sourceFile ?? "",
    ]),
  ];

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
