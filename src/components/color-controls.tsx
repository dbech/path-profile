"use client";

import type { ColorPalette, ColorSettings } from "~/types/path-profile";

type ColorControlsProps = {
  settings: ColorSettings;
  dataRange: { min: number; max: number } | null;
  onChange: (settings: ColorSettings) => void;
};

const palettes: { value: ColorPalette; label: string; swatch: string }[] = [
  {
    value: "terrain",
    label: "Terrain",
    swatch: "linear-gradient(90deg,#22553f,#5b894b,#baa863,#976846,#f1f1e8)",
  },
  {
    value: "viridis",
    label: "Viridis",
    swatch: "linear-gradient(90deg,#440154,#3b528b,#21918c,#5ec962,#fde725)",
  },
  {
    value: "plasma",
    label: "Plasma",
    swatch: "linear-gradient(90deg,#0d0887,#7e03a8,#cb4777,#f89540,#f0f921)",
  },
  {
    value: "grayscale",
    label: "Grayscale",
    swatch: "linear-gradient(90deg,#121820,#f6f8fa)",
  },
  {
    value: "high-contrast",
    label: "High contrast",
    swatch: "linear-gradient(90deg,#070c14,#1a74bc,#f4d03f,#ffffff)",
  },
];

export function ColorControls({
  settings,
  dataRange,
  onChange,
}: ColorControlsProps) {
  const min = settings.autoStretch
    ? (dataRange?.min ?? settings.min)
    : settings.min;
  const max = settings.autoStretch
    ? (dataRange?.max ?? settings.max)
    : settings.max;

  return (
    <section className="grid gap-3 border-t border-[#25313d] pt-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[#f4f7fb]">DSM Style</h2>
        <label className="flex items-center gap-2 text-xs text-[#b6c4d2]">
          <input
            checked={settings.autoStretch}
            className="h-4 w-4 accent-[#25c2a0]"
            type="checkbox"
            onChange={(event) =>
              onChange({ ...settings, autoStretch: event.target.checked })
            }
          />
          Auto
        </label>
      </div>

      <label className="grid gap-1 text-xs text-[#b6c4d2]">
        Palette
        <select
          className="h-9 rounded border border-[#334454] bg-[#121922] px-2 text-sm text-[#f4f7fb]"
          value={settings.palette}
          onChange={(event) =>
            onChange({
              ...settings,
              palette: event.target.value as ColorPalette,
            })
          }
        >
          {palettes.map((palette) => (
            <option key={palette.value} value={palette.value}>
              {palette.label}
            </option>
          ))}
        </select>
      </label>

      <div
        aria-hidden="true"
        className="h-3 rounded-sm border border-[#334454]"
        style={{
          background: palettes.find(
            (palette) => palette.value === settings.palette,
          )?.swatch,
          transform: settings.reverse ? "scaleX(-1)" : undefined,
        }}
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-xs text-[#b6c4d2]">
          Min
          <input
            className="h-9 rounded border border-[#334454] bg-[#121922] px-2 text-sm text-[#f4f7fb] disabled:text-[#788896]"
            disabled={settings.autoStretch}
            type="number"
            value={Number.isFinite(min) ? min : 0}
            onChange={(event) =>
              onChange({ ...settings, min: Number(event.target.value) })
            }
          />
        </label>
        <label className="grid gap-1 text-xs text-[#b6c4d2]">
          Max
          <input
            className="h-9 rounded border border-[#334454] bg-[#121922] px-2 text-sm text-[#f4f7fb] disabled:text-[#788896]"
            disabled={settings.autoStretch}
            type="number"
            value={Number.isFinite(max) ? max : 1}
            onChange={(event) =>
              onChange({ ...settings, max: Number(event.target.value) })
            }
          />
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs text-[#b6c4d2]">
        <input
          checked={settings.reverse}
          className="h-4 w-4 accent-[#25c2a0]"
          type="checkbox"
          onChange={(event) =>
            onChange({ ...settings, reverse: event.target.checked })
          }
        />
        Reverse ramp
      </label>

      <label className="grid gap-1 text-xs text-[#b6c4d2]">
        Opacity {Math.round(settings.opacity * 100)}%
        <input
          className="accent-[#25c2a0]"
          max={1}
          min={0.1}
          step={0.05}
          type="range"
          value={settings.opacity}
          onChange={(event) =>
            onChange({ ...settings, opacity: Number(event.target.value) })
          }
        />
      </label>
    </section>
  );
}
