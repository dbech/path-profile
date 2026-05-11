import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type {
  DsmProjectSummary,
  ProfileRequest,
  ProfileResult,
} from "../src/types/path-profile";
import type { DsmTileRequest } from "./raster/tile-renderer";

type WorkerMethod = "loadDsmProject" | "generateProfile" | "renderDsmTile";

type WorkerResponse =
  | { id: number; result: unknown }
  | { id: number; error: string };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type SpawnWorker = typeof spawn;
type WorkerEnvironment = Record<string, string | undefined>;

export type RasterWorkerClientOptions = {
  env?: WorkerEnvironment;
  runtime?: string;
  spawnWorker?: SpawnWorker;
  workerPath?: string;
};

export class RasterWorkerClient {
  private worker: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private readonly env?: WorkerEnvironment;
  private readonly runtime: string;
  private readonly spawnWorker: SpawnWorker;
  private readonly workerPath: string;

  constructor(options: RasterWorkerClientOptions = {}) {
    this.env = options.env;
    this.runtime =
      options.runtime ?? process.env.PATH_PROFILE_NODE_RUNTIME ?? "node";
    this.spawnWorker = options.spawnWorker ?? spawn;
    this.workerPath =
      options.workerPath ??
      path.join(process.cwd(), "dist-electron", "raster-worker.cjs");
  }

  async loadDsmProject(paths: string[]): Promise<DsmProjectSummary> {
    return this.request<DsmProjectSummary>("loadDsmProject", paths);
  }

  async generateProfile(request: ProfileRequest): Promise<ProfileResult> {
    return this.request<ProfileResult>("generateProfile", request);
  }

  async renderDsmTile(request: DsmTileRequest): Promise<Buffer> {
    const result = await this.request<{ base64: string }>(
      "renderDsmTile",
      request,
    );
    return Buffer.from(result.base64, "base64");
  }

  stop(): void {
    if (!this.worker) return;
    this.worker.kill();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Raster worker stopped."));
    }
    this.pending.clear();
  }

  private request<T>(method: WorkerMethod, payload: unknown): Promise<T> {
    let worker: ChildProcess;
    try {
      worker = this.ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }

    const id = this.nextId++;

    return new Promise<T>((resolve, reject) => {
      if (!worker.connected || !worker.send) {
        reject(new Error("Raster worker IPC is unavailable."));
        return;
      }

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });

      worker.send({ id, method, payload }, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private ensureWorker(): ChildProcess {
    if (this.worker && !this.worker.killed && this.worker.connected) {
      return this.worker;
    }

    const worker = this.spawnWorker(this.runtime, [this.workerPath], {
      env: { ...process.env, ...this.env },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });

    worker.stdout?.on("data", (chunk: Buffer) => {
      process.stdout.write(`[raster-worker] ${chunk.toString()}`);
    });
    worker.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`[raster-worker] ${chunk.toString()}`);
    });
    worker.on("message", (message) => this.handleMessage(message));
    worker.on("error", (error) => {
      this.rejectPending(error);
      this.worker = null;
    });
    worker.on("exit", (code, signal) => {
      const error = new Error(
        `Raster worker exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}.`,
      );
      this.rejectPending(error);
      this.worker = null;
    });

    this.worker = worker;
    return worker;
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private handleMessage(message: unknown): void {
    if (!isWorkerResponse(message)) return;

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);

    if ("error" in message) {
      pending.reject(new Error(message.error));
      return;
    }

    pending.resolve(message.result);
  }
}

function isWorkerResponse(message: unknown): message is WorkerResponse {
  if (!message || typeof message !== "object") return false;
  const response = message as WorkerResponse;
  return typeof response.id === "number";
}
