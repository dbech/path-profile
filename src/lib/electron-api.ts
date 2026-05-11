import type { PathProfileApi } from "~/types/path-profile";

declare global {
  interface Window {
    pathProfile?: PathProfileApi;
  }
}

export function getPathProfileApi(): PathProfileApi | null {
  if (typeof window === "undefined") return null;
  return window.pathProfile ?? null;
}

export function hasDesktopBridge(): boolean {
  return typeof window !== "undefined" && window.pathProfile !== undefined;
}
