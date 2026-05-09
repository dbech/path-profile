import type { ColorPalette } from "../../src/types/path-profile";

export type Rgba = [number, number, number, number];

const ramps: Record<ColorPalette, Rgba[]> = {
  grayscale: [
    [18, 24, 32, 255],
    [246, 248, 250, 255],
  ],
  terrain: [
    [34, 85, 63, 255],
    [91, 137, 75, 255],
    [186, 168, 99, 255],
    [151, 104, 70, 255],
    [241, 241, 232, 255],
  ],
  viridis: [
    [68, 1, 84, 255],
    [59, 82, 139, 255],
    [33, 145, 140, 255],
    [94, 201, 98, 255],
    [253, 231, 37, 255],
  ],
  plasma: [
    [13, 8, 135, 255],
    [126, 3, 168, 255],
    [203, 71, 119, 255],
    [248, 149, 64, 255],
    [240, 249, 33, 255],
  ],
  "high-contrast": [
    [7, 12, 20, 255],
    [26, 116, 188, 255],
    [244, 208, 63, 255],
    [255, 255, 255, 255],
  ],
};

export function colorForElevation(
  value: number,
  min: number,
  max: number,
  palette: ColorPalette,
  reverse: boolean,
): Rgba {
  const ramp = ramps[palette] ?? ramps.terrain;
  const range = max - min;
  const rawT = range > 0 ? (value - min) / range : 0.5;
  const t = clamp(reverse ? 1 - rawT : rawT, 0, 1);
  const scaled = t * (ramp.length - 1);
  const lowerIndex = Math.floor(scaled);
  const upperIndex = Math.min(ramp.length - 1, lowerIndex + 1);
  const localT = scaled - lowerIndex;
  const lower = ramp[lowerIndex]!;
  const upper = ramp[upperIndex]!;

  return [
    Math.round(lerp(lower[0], upper[0], localT)),
    Math.round(lerp(lower[1], upper[1], localT)),
    Math.round(lerp(lower[2], upper[2], localT)),
    Math.round(lerp(lower[3], upper[3], localT)),
  ];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
