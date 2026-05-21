import { app, BrowserWindow, dialog, ipcMain, Menu, protocol } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { RasterWorkerClient } from "./raster-worker-client";
import { profilePointsToCsv } from "./raster/csv";
import { parseTileUrl } from "./raster/tile-renderer";
import { basemaps, defaultBasemap, type BasemapId } from "../src/lib/basemaps";
import type { ProfilePoint, ProfileRequest } from "../src/types/path-profile";

const devServerUrl =
  process.env.PATH_PROFILE_DEV_SERVER_URL ?? "http://localhost:3010";
const preloadPath = path.join(__dirname, "preload.cjs");
const rasterWorker = new RasterWorkerClient({
  env: app.isPackaged ? { NODE_PATH: packagedNodeModulesPath() } : undefined,
  runtime: app.isPackaged
    ? packagedNodeRuntimePath()
    : (process.env.PATH_PROFILE_NODE_RUNTIME ?? "node"),
  workerPath: app.isPackaged
    ? packagedRasterWorkerPath()
    : path.join(__dirname, "raster-worker.cjs"),
});
let selectedBasemap: BasemapId = defaultBasemap;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "path-profile",
    privileges: {
      bypassCSP: true,
      secure: true,
      standard: true,
      supportFetchAPI: true,
    },
  },
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
    show: false,
    title: "Path Profile",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      sandbox: false,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedRendererUrl(url)) {
      return { action: "allow" };
    }
    return { action: "deny" };
  });

  await loadRenderer(window);
  if (!window.isDestroyed()) {
    window.show();
  }
}

async function loadRenderer(window: BrowserWindow): Promise<void> {
  if (app.isPackaged) {
    try {
      await window.loadURL(packagedRendererUrl());
    } catch (error) {
      await dialog.showMessageBox(window, {
        type: "error",
        title: "Renderer unavailable",
        message: "Path Profile could not load its packaged renderer.",
        detail: errorMessage(error),
        buttons: ["Close"],
      });
      window.close();
    }
    return;
  }

  while (!window.isDestroyed()) {
    try {
      await waitForRenderer(devServerUrl);
      await window.loadURL(devServerUrl);
      return;
    } catch (error) {
      const detail = errorMessage(error);
      const result = await dialog.showMessageBox(window, {
        type: "error",
        title: "Renderer unavailable",
        message: "Path Profile could not connect to the renderer.",
        detail: `${detail}\n\nStart the app with bun run dev:desktop, or make sure the Next.js renderer is running on ${devServerUrl}.`,
        buttons: ["Retry", "Close"],
        defaultId: 0,
        cancelId: 1,
      });

      if (result.response !== 0) {
        window.close();
        return;
      }
    }
  }
}

function packagedRendererUrl(): string {
  return "path-profile://renderer/index.html";
}

function packagedRendererRoot(): string {
  return path.join(app.getAppPath(), "out");
}

function packagedNodeRuntimePath(): string {
  return path.join(process.resourcesPath, "node", "node.exe");
}

function packagedNodeModulesPath(): string {
  return path.join(process.resourcesPath, "node_modules");
}

function packagedRasterWorkerPath(): string {
  return path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "dist-electron",
    "raster-worker.cjs",
  );
}

async function waitForRenderer(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }

    await delay(500);
  }

  throw new Error(`${url} did not become available. ${lastError}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  createApplicationMenu();

  if (app.isPackaged) {
    protocol.handle("path-profile", servePackagedRendererAsset);
  }

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

function createApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Open DEM...",
          accelerator: "CommandOrControl+O",
          click: () => sendFocusedWindow("path-profile:menu-open-dsm"),
        },
        {
          label: "Export Profile CSV",
          accelerator: "CommandOrControl+S",
          click: () => sendFocusedWindow("path-profile:menu-export-profile"),
        },
        { type: "separator" },
        { role: process.platform === "darwin" ? "close" : "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Basemap",
          submenu: basemaps.map((basemap) => ({
            label: basemap.label,
            type: "radio",
            checked: basemap.id === selectedBasemap,
            click: () => selectBasemap(basemap.id),
          })),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About Path Profile",
          click: async () => {
            await dialog.showMessageBox({
              type: "info",
              title: "About Path Profile",
              message: "Path Profile",
              detail: "Desktop DEM path profile analysis.",
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendFocusedWindow(channel: string, ...args: unknown[]): void {
  const window = BrowserWindow.getFocusedWindow();
  window?.webContents.send(channel, ...args);
}

function selectBasemap(basemapId: BasemapId): void {
  selectedBasemap = basemapId;
  sendFocusedWindow("path-profile:menu-select-basemap", basemapId);
}

function registerIpcHandlers(): void {
  ipcMain.handle("path-profile:get-selected-basemap", (event) => {
    assertTrustedSender(event);
    return selectedBasemap;
  });

  ipcMain.handle("path-profile:open-dsm-files", async (event) => {
    assertTrustedSender(event);
    const result = await dialog.showOpenDialog({
      title: "Open DEM GeoTIFF files",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "GeoTIFF DEM",
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
        throw new Error("Invalid DEM path list.");
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

      if (result.canceled || !result.filePath) return false;
      await fs.writeFile(result.filePath, profilePointsToCsv(points), "utf8");
      return true;
    },
  );
}

async function servePackagedRendererAsset(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const root = packagedRendererRoot();
  const requestPath = decodeURIComponent(
    url.pathname === "/" ? "/index.html" : url.pathname,
  );
  const relativePath = requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(root, relativePath);

  if (!isPathInside(root, filePath)) {
    return new Response(null, { status: 403 });
  }

  try {
    const file = await fs.readFile(filePath);
    const body = new Uint8Array(file.length);
    body.set(file);
    return new Response(body.buffer, {
      headers: {
        "cache-control": "no-store",
        "content-type": contentTypeForPath(filePath),
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate);
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url;
  if (!url) {
    throw new Error("Rejected IPC from unknown sender.");
  }
  if (!isTrustedRendererUrl(url)) {
    throw new Error(`Rejected IPC from untrusted sender: ${url}`);
  }
}

function isTrustedRendererUrl(url: string): boolean {
  if (app.isPackaged) {
    return url.startsWith("path-profile://renderer/");
  }

  return url.startsWith(devServerUrl);
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
