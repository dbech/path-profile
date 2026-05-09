import { rasterWorkerClient } from "~/server/raster-worker";
import type { ProfileRequest } from "~/types/path-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ProfileRequest;
    assertProfileRequest(body);
    const profile = await rasterWorkerClient.generateProfile(body);
    return Response.json(profile);
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500 });
  }
}

function assertProfileRequest(request: ProfileRequest): void {
  if (!request || typeof request !== "object") {
    throw new Error("Invalid profile request.");
  }

  if (typeof request.projectId !== "string") {
    throw new Error("Invalid profile project ID.");
  }

  if (
    !request.path ||
    typeof request.path.projection !== "string" ||
    !Array.isArray(request.path.coordinates)
  ) {
    throw new Error("Invalid profile path.");
  }

  for (const coordinate of request.path.coordinates) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length !== 2 ||
      !Number.isFinite(coordinate[0]) ||
      !Number.isFinite(coordinate[1])
    ) {
      throw new Error("Invalid profile path coordinate.");
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
