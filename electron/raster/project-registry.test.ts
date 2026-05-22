import { describe, expect, it, vi } from "vitest";
import {
  closeAllProjects,
  getProject,
  registerProject,
  type DsmProject,
} from "./project-registry";

describe("project registry", () => {
  it("closes the previously loaded project when registering a replacement", () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();

    registerProject(testProject("first", closeFirst));
    registerProject(testProject("second", closeSecond));

    expect(closeFirst).toHaveBeenCalledOnce();
    expect(() => getProject("first")).toThrow(
      "DSM project is no longer loaded.",
    );
    expect(getProject("second").summary.id).toBe("second");

    closeAllProjects();
    expect(closeSecond).toHaveBeenCalledOnce();
  });
});

function testProject(id: string, close: () => void): DsmProject {
  return {
    files: [
      {
        dataset: { close },
      },
    ],
    isGeographic: false,
    sourceSrs: null,
    summary: {
      crsWkt: "",
      distance: { metersPerUnit: null, unit: "unknown" },
      elevation: { metersPerUnit: null, min: 0, max: 1, unit: "unknown" },
      extent: {
        minX: 0,
        minY: 0,
        maxX: 1,
        maxY: 1,
        projection: "LOCAL",
      },
      files: [],
      id,
      pixelSize: { x: 1, y: 1 },
      warnings: [],
    },
  } as unknown as DsmProject;
}
