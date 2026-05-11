import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { RasterWorkerClient } from "./raster-worker-client";

describe("RasterWorkerClient", () => {
  it("spawns with configured runtime, worker path, and environment", async () => {
    const worker = fakeWorker();
    const spawnWorker = vi.fn(() => worker);
    const client = new RasterWorkerClient({
      env: { ELECTRON_RUN_AS_NODE: "1" },
      runtime: "electron.exe",
      spawnWorker: spawnWorker as never,
      workerPath: "worker.cjs",
    });

    const request = client.loadDsmProject(["dem.tif"]);

    expect(spawnWorker).toHaveBeenCalledWith(
      "electron.exe",
      ["worker.cjs"],
      expect.objectContaining({
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: "1" }),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      }) as SpawnOptions,
    );

    worker.emit("message", { id: 1, result: { id: "project" } });
    await expect(request).resolves.toEqual({ id: "project" });
  });

  it("rejects pending requests when the worker exits", async () => {
    const worker = fakeWorker();
    const client = new RasterWorkerClient({
      spawnWorker: vi.fn(() => worker) as never,
      workerPath: "worker.cjs",
    });

    const request = client.loadDsmProject(["dem.tif"]);
    worker.emit("exit", 1, null);

    await expect(request).rejects.toThrow("Raster worker exited with code 1.");
  });

  it("rejects immediately when worker IPC is unavailable", async () => {
    const worker = fakeWorker({ connected: false });
    const client = new RasterWorkerClient({
      spawnWorker: vi.fn(() => worker) as never,
      workerPath: "worker.cjs",
    });

    await expect(client.loadDsmProject(["dem.tif"])).rejects.toThrow(
      "Raster worker IPC is unavailable.",
    );
  });
});

function fakeWorker(options: { connected?: boolean } = {}): ChildProcess {
  const worker = new EventEmitter() as ChildProcess;
  Object.defineProperty(worker, "connected", {
    configurable: true,
    value: options.connected ?? true,
  });
  Object.defineProperty(worker, "killed", {
    configurable: true,
    value: false,
  });
  worker.kill = vi.fn(() => true) as never;
  worker.send = vi.fn(
    (_message: unknown, callback?: (error?: Error) => void) => {
      callback?.();
      return true;
    },
  ) as never;
  return worker;
}
