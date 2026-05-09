import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { RasterWorkerClient } from "./raster-worker-client";
import { profilePointsToCsv } from "./raster/csv";
import { parseTileUrl } from "./raster/tile-renderer";
import type { ProfilePoint, ProfileRequest } from "../src/types/path-profile";

const devServerUrl =
  process.env.PATH_PROFILE_DEV_SERVER_URL ?? "http://localhost:3010";
const preloadPath = path.join(__dirname, "preload.cjs");
const rasterWorker = new RasterWorkerClient();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "dsm-tile",
    privileges: {
      bypassCSP: true,
      corsEnabled: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
]);

app.on("window-all-closed", () => {
  rasterWorker.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  rasterWorker.stop();
});

void bootstrap();

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1040,
    minHeight: 720,
    title: "Path Profile",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(devServerUrl)) {
      return { action: "allow" };
    }
    return { action: "deny" };
  });

  await window.loadURL(devServerUrl);
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  protocol.handle("dsm-tile", async (request) => {
    try {
      const tileRequest = parseTileUrl(request.url);
      const tile = await rasterWorker.renderDsmTile(tileRequest);
      const body = new Uint8Array(tile.length);
      body.set(tile);
      return new Response(body.buffer, {
        headers: {
          "cache-control": "no-store",
          "content-type": "image/png",
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  registerIpcHandlers();
  await createWindow();
}

function registerIpcHandlers(): void {
  ipcMain.handle("path-profile:open-dsm-files", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog({
      title: "Open DSM GeoTIFF files",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "GeoTIFF DSM",
          extensions: ["tif", "tiff", "geotiff", "gtif"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });

    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(
    "path-profile:load-dsm-project",
    async (event, paths: unknown) => {
      assertTrustedSender(event);
      if (
        !Array.isArray(paths) ||
        !paths.every((item) => typeof item === "string")
      ) {
        throw new Error("Invalid DSM path list.");
      }
      return rasterWorker.loadDsmProject(paths);
    },
  );

  ipcMain.handle(
    "path-profile:generate-profile",
    async (event, request: ProfileRequest) => {
      assertTrustedSender(event);
      assertProfileRequest(request);
      return rasterWorker.generateProfile(request);
    },
  );

  ipcMain.handle(
    "path-profile:export-profile-csv",
    async (event, points: ProfilePoint[]) => {
      assertTrustedSender(event);
      if (!Array.isArray(points)) {
        throw new Error("Invalid profile points.");
      }

      const result = await dialog.showSaveDialog({
        title: "Export path profile",
        defaultPath: "path-profile.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (result.canceled || !result.filePath) return;
      await fs.writeFile(result.filePath, profilePointsToCsv(points), "utf8");
    },
  );
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url;
  if (!url) {
    throw new Error("Rejected IPC from unknown sender.");
  }
  if (!url.startsWith(devServerUrl)) {
    throw new Error(`Rejected IPC from untrusted sender: ${url}`);
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
