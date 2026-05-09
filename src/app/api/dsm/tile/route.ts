import type { ColorPalette } from "~/types/path-profile";
import { rasterWorkerClient } from "~/server/raster-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const tile = await rasterWorkerClient.renderDsmTile({
      projectId: requiredParam(url, "projectId"),
      z: integerParam(url, "z"),
      x: integerParam(url, "x"),
      y: integerParam(url, "y"),
      palette: colorPaletteParam(url),
      min: numberParam(url, "min", 0),
      max: numberParam(url, "max", 1),
      reverse: url.searchParams.get("reverse") === "true",
    });

    const body = new Uint8Array(tile.length);
    body.set(tile);
    return new Response(body.buffer, {
      headers: {
        "cache-control": "no-store",
        "content-type": "image/png",
      },
    });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

function requiredParam(url: URL, key: string): string {
  const value = url.searchParams.get(key);
  if (!value) throw new Error(`Missing ${key}.`);
  return value;
}

function integerParam(url: URL, key: string): number {
  const value = Number.parseInt(requiredParam(url, key), 10);
  if (!Number.isInteger(value)) throw new Error(`Invalid ${key}.`);
  return value;
}

function numberParam(url: URL, key: string, fallback: number): number {
  const value = Number(url.searchParams.get(key));
  return Number.isFinite(value) ? value : fallback;
}

function colorPaletteParam(url: URL): ColorPalette {
  const value = url.searchParams.get("palette");
  if (
    value === "grayscale" ||
    value === "terrain" ||
    value === "viridis" ||
    value === "plasma" ||
    value === "high-contrast"
  ) {
    return value;
  }
  return "terrain";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
