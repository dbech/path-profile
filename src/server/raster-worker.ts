import { RasterWorkerClient } from "../../electron/raster-worker-client";

const globalForRasterWorker = globalThis as typeof globalThis & {
  rasterWorkerClient?: RasterWorkerClient;
};

export const rasterWorkerClient =
  globalForRasterWorker.rasterWorkerClient ?? new RasterWorkerClient();

globalForRasterWorker.rasterWorkerClient = rasterWorkerClient;
