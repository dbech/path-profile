import { contextBridge, ipcRenderer } from "electron";
import type { BasemapId } from "../src/lib/basemaps";
import type {
  DsmProjectSummary,
  PathProfileApi,
  ProfilePoint,
  ProfileRequest,
  ProfileResult,
} from "../src/types/path-profile";

const api: PathProfileApi = {
  getSelectedBasemap: () =>
    ipcRenderer.invoke(
      "path-profile:get-selected-basemap",
    ) as Promise<BasemapId>,
  openDsmFiles: () =>
    ipcRenderer.invoke("path-profile:open-dsm-files") as Promise<string[]>,
  loadDsmProject: (paths: string[]) =>
    ipcRenderer.invoke(
      "path-profile:load-dsm-project",
      paths,
    ) as Promise<DsmProjectSummary>,
  generateProfile: (request: ProfileRequest) =>
    ipcRenderer.invoke(
      "path-profile:generate-profile",
      request,
    ) as Promise<ProfileResult>,
  exportProfileCsv: (points: ProfilePoint[]) =>
    ipcRenderer.invoke(
      "path-profile:export-profile-csv",
      points,
    ) as Promise<boolean>,
  onOpenDsmRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("path-profile:menu-open-dsm", listener);
    return () => ipcRenderer.off("path-profile:menu-open-dsm", listener);
  },
  onExportProfileRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("path-profile:menu-export-profile", listener);
    return () => ipcRenderer.off("path-profile:menu-export-profile", listener);
  },
  onBasemapSelected: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      basemapId: BasemapId,
    ) => callback(basemapId);
    ipcRenderer.on("path-profile:menu-select-basemap", listener);
    return () => ipcRenderer.off("path-profile:menu-select-basemap", listener);
  },
};

contextBridge.exposeInMainWorld("pathProfile", api);
