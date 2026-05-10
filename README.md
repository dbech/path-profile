# Path Profile

Path Profile is an Electron desktop app for loading DEM GeoTIFF rasters, drawing a path over the DEM, and generating an elevation profile along that path.

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

Create a local environment file:

```bash
cp .env.example .env
```

Set `DATABASE_URL` in `.env` to a valid URL. For local development, this is enough:

```bash
DATABASE_URL="file:./db.sqlite"
```

## Development

Run the desktop app:

```bash
bun run dev:desktop
```

This starts the Next.js renderer on port `3010`, builds the Electron entry points, waits for the renderer, and launches Electron.

## Build

Build the Next.js renderer:

```bash
bun run build
```

Build the Electron entry points:

```bash
bun run build:electron
```

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
5. Draw a path over the DEM.
6. Save the path to generate the elevation profile.
7. Hover the profile chart or table to inspect the sampled map location.
8. Use `File > Export Profile CSV` or the CSV button to export profile values.

## Notes

- DEM tiles are served through Electron's `dsm-tile://` protocol in desktop mode.
- Free, no-key basemaps are rendered from Web Mercator tile services and
  reprojected by OpenLayers when a transform is available for the DEM CRS.
- Public basemap services are for interactive viewing only; the app does not
  bulk download or package basemap tiles for offline use.
- Some basemaps have provider caveats: OSM/Wikimedia public tiles are fair-use
  services, and Esri layers are public ArcGIS tile services.
- Supported input is GeoTIFF DEM-like raster data.
