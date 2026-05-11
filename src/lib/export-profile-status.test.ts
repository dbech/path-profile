import { describe, expect, it } from "vitest";
import { exportProfileStatus } from "./export-profile-status";

describe("export profile status", () => {
  it("distinguishes saved exports from canceled exports", () => {
    expect(exportProfileStatus(true)).toBe("CSV exported");
    expect(exportProfileStatus(false)).toBe("Export canceled");
  });
});
