import { loadDsmProject } from "./raster/gdal-loader";
import { generateProfile } from "./raster/profile-sampler";
import { closeAllProjects } from "./raster/project-registry";
import { renderDsmTile, type DsmTileRequest } from "./raster/tile-renderer";
import type {
  DsmProjectSummary,
  ProfileRequest,
  ProfileResult,
} from "../src/types/path-profile";

type WorkerMethod = "loadDsmProject" | "generateProfile" | "renderDsmTile";

type WorkerMessage = {
  id: number;
  method: WorkerMethod;
  payload: unknown;
};

type WorkerResponse =
  | { id: number; result: unknown }
  | { id: number; error: string };

process.on("message", (message: WorkerMessage) => {
  void handleMessage(message);
});

process.on("disconnect", () => {
  closeAllProjects();
});

process.on("beforeExit", () => {
  closeAllProjects();
});

async function handleMessage(message: WorkerMessage): Promise<void> {
  try {
    const result = await dispatch(message.method, message.payload);
    send({ id: message.id, result });
  } catch (error) {
    send({ id: message.id, error: errorMessage(error) });
  }
}

async function dispatch(
  method: WorkerMethod,
  payload: unknown,
): Promise<DsmProjectSummary | ProfileResult | { base64: string }> {
  switch (method) {
    case "loadDsmProject": {
      if (
        !Array.isArray(payload) ||
        !payload.every((item) => typeof item === "string")
      ) {
        throw new Error("Invalid DSM path list.");
      }
      return loadDsmProject(payload);
    }
    case "generateProfile":
      assertProfileRequest(payload);
      return generateProfile(payload);
    case "renderDsmTile": {
      assertTileRequest(payload);
      const tile = await renderDsmTile(payload);
      return { base64: tile.toString("base64") };
    }
  }
}

function assertProfileRequest(
  payload: unknown,
): asserts payload is ProfileRequest {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid profile request.");
  }

  const request = payload as ProfileRequest;
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

function assertTileRequest(
  payload: unknown,
): asserts payload is DsmTileRequest {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid DSM tile request.");
  }
}

function send(response: WorkerResponse): void {
  if (process.send) {
    process.send(response);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
