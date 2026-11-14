# Path Profile

Path Profile is an Electron desktop app for loading DEM GeoTIFF rasters, drawing a path over the DEM, and generating an elevation profile along that path.

The profile chart draws a line of sight between the two path ends and Fresnel zones 1 to 3 around it, each as a flat version and a version adjusted for earth curvature.

## Stack

- Next.js 15 and React 19 for the renderer
- Electron for the desktop shell and native file dialogs
- OpenLayers for DEM map rendering and path drawing
- `gdal-async` for raster access
- Chart.js for elevation profile charts
- Bun for package management and scripts

## Requirements

- Bun
- A development environment that can install and run Electron native dependencies

If `gdal-async` is blocked during install, run:

```bash
bun run rebuild:native
```

## Setup

Install dependencies:

```bash
bun install
```

## Development

Run the desktop app:

```bash
bun run dev:desktop
```

This starts the Next.js renderer on port `3010`, builds the Electron entry points, waits for the renderer, and launches Electron.

## Build

Build the static Next.js renderer:

```bash
bun run build:renderer
```

Build the Electron entry points:

```bash
bun run build:electron
```

Build both desktop targets:

```bash
bun run build:desktop
```

The desktop build also prepares the packaged Node/GDAL runtime and fails if
`gdal-async` or the raster worker cannot start from the prepared release
assets.

## Release

Merging to `main` runs the GitHub Actions release workflow. The workflow reads
`package.json` and creates a GitHub release named `v<version>` when that release
does not already exist, so release PRs should bump the package version before
merge.

Create an unpacked Windows x64 app directory for smoke testing:

```bash
bun run dist:win:dir
```

Create the unsigned Windows x64 installer:

```bash
bun run dist:win
```

Release artifacts are written to `dist/`. Run the generated
`Path-Profile-Setup-<version>-win-x64.exe` to install the app, then launch
`Path Profile` from the desktop or Start menu shortcut. The packaged app loads
the exported renderer from the bundle and does not require a Next.js server or
port `3010`.

To create a portable folder zip instead:

```bash
bun run dist:win:zip
```

Extract the zip and run `Path Profile.exe`.

## Checks

Run type checking and format checks:

```bash
bun run check
```

Run unit tests:

```bash
bun run test:unit
```

Useful individual checks:

```bash
bun run typecheck
bun run format:check
```

## Desktop Usage

1. Start the app with `bun run dev:desktop`.
2. Use `File > Open DEM...` to select one or more DEM GeoTIFF files.
3. Use the floating map controls to choose DEM styling and start the path tool.
4. Use `View > Basemap` to choose the background basemap.
5. Click the map once to place `A`, then click again to place `B` and generate the elevation profile.
6. Hover the profile chart or table to inspect the sampled map location.
7. Use `File > Export Profile CSV` or the CSV button to export profile values.

## Line of Sight and Fresnel Zones

The profile chart overlays a line of sight from `A` to `B` on the terrain.

- Each end starts at the terrain elevation. Drag the `A` and `B` handles, or type into the `A` and `B` boxes above the chart, to set antenna elevations.
- The `F` box sets the radio frequency in MHz. It defaults to 5800.
- Fresnel zones 1, 2 and 3 are drawn around the line of sight. Click a zone to mute it.
- The solid Fresnel lines and the long-dashed line of sight treat the earth as flat.
- The fainter dashed lines are the same overlays adjusted for earth curvature. They use an effective earth radius of 4/3 of 6,371 km, the standard atmosphere figure for radio paths. The adjustment lowers the line of sight by `d1 * d2 / (2 * k * R)` and leaves the terrain as sampled.
- Overlays are hidden wherever the terrain blocks them, so a gap in a line marks an obstruction.
- Fresnel zones and the curvature-adjusted overlays need a projected CRS with a linear unit, so the app can convert distances to metres. A DEM in a geographic CRS (degrees) shows the flat line of sight only.
- If the DEM does not label its elevation unit, the app assumes metres and shows a warning.

## Notes

- DEM tiles are served through Electron's `dsm-tile://` protocol in desktop mode.
- Browser mode and the T3 sample API/database scaffold are not part of this desktop release.
- Free, no-key basemaps are rendered from Web Mercator tile services and
  reprojected by OpenLayers when a transform is available for the DEM CRS.
- Public basemap services are for interactive viewing only; the app does not
  bulk download or package basemap tiles for offline use.
- Some basemaps have provider caveats: OSM/Wikimedia public tiles are fair-use
  services, and Esri layers are public ArcGIS tile services.
- Supported input is GeoTIFF DEM-like raster data.

## Licence

Path Profile's own source code is MIT licensed. See [LICENSE](LICENSE).

Release builds also bundle third-party software under its own licences, including Electron and Chromium, Node.js, and `gdal-async` (Apache-2.0) with the GDAL, PROJ and GEOS libraries built into it. GEOS is LGPL-2.1. The MIT licence does not cover those components.
