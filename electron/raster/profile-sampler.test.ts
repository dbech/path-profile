import { describe, expect, it } from "vitest";
import { bilinearFromValues, profilePointsToCsv } from "./profile-sampler";

describe("profile sampler helpers", () => {
  it("interpolates four surrounding pixel values", () => {
    expect(bilinearFromValues(10, 20, 30, 40, 0.5, 0.5)).toBe(25);
    expect(bilinearFromValues(10, 20, 30, 40, 0.25, 0.75)).toBe(27.5);
  });

  it("formats profile points as CSV", () => {
    const csv = profilePointsToCsv([
      {
        distance: 0,
        x: 10,
        y: 20,
        elevation: 30,
        sourceFile: "tile-a.tif",
      },
      {
        distance: 1,
        x: 11,
        y: 21,
        elevation: null,
        sourceFile: "tile,b.tif",
      },
    ]);

    expect(csv).toBe(
      'distance,x,y,elevation,source_file\n0,10,20,30,tile-a.tif\n1,11,21,,"tile,b.tif"',
    );
  });
});
