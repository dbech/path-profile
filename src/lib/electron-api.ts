import { defaultBasemap } from "~/lib/basemaps";
import type { PathProfileApi } from "~/types/path-profile";

const testDsmToken = "__PUBLIC_TEST_DSM__";

declare global {
  interface Window {
    pathProfile?: PathProfileApi;
  }
}

export function getPathProfileApi(): PathProfileApi | null {
  if (typeof window === "undefined") return null;
  return window.pathProfile ?? browserTestApi;
}

export function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && window.pathProfile !== undefined;
}

const browserTestApi: PathProfileApi = {
  getSelectedBasemap: async () => defaultBasemap,
  openDsmFiles: async () => [testDsmToken],
  loadDsmProject: async (paths) => {
    const response = await fetch("/api/dsm/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths }),
    });
    return parseJsonResponse(response);
  },
  generateProfile: async (request) => {
    const response = await fetch("/api/dsm/profile", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    return parseJsonResponse(response);
  },
  exportProfileCsv: async (points) => {
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
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "path-profile.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  },
  onOpenDsmRequested: () => () => undefined,
  onExportProfileRequested: () => () => undefined,
  onBasemapSelected: () => () => undefined,
};

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(
      isErrorPayload(data) && data.error ? data.error : "DSM request failed.",
    );
  }
  return data as T;
}

function isErrorPayload(data: unknown): data is { error?: string } {
  return data !== null && typeof data === "object" && "error" in data;
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}
