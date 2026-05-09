import path from "node:path";
import { rasterWorkerClient } from "~/server/raster-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testDsmToken = "__PUBLIC_TEST_DSM__";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { paths?: unknown };
    if (
      !Array.isArray(body.paths) ||
      !body.paths.every((item) => typeof item === "string")
    ) {
      return errorResponse("Invalid DSM path list.", 400);
    }

    const paths = body.paths.map(resolveAllowedPath);
    const project = await rasterWorkerClient.loadDsmProject(paths);
    return Response.json(project);
  } catch (error) {
    return errorResponse(errorMessage(error), 500);
  }
}

function resolveAllowedPath(filePath: string): string {
  if (filePath === testDsmToken) {
    return path.resolve(process.cwd(), "public/test/dsm.tif");
  }

  const resolvedPath = path.resolve(filePath);
  const testRoot = path.resolve(process.cwd(), "public/test");
  if (!resolvedPath.startsWith(testRoot + path.sep)) {
    throw new Error(
      "Browser mode can only load ignored files from public/test.",
    );
  }
  return resolvedPath;
}

function errorResponse(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
