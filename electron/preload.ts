import { contextBridge, ipcRenderer } from "electron";
import type {
  DsmProjectSummary,
  PathProfileApi,
  ProfilePoint,
  ProfileRequest,
  ProfileResult,
} from "../src/types/path-profile";

const api: PathProfileApi = {
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
    ) as Promise<void>,
};

contextBridge.exposeInMainWorld("pathProfile", api);
