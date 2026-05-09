"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Download,
  FileWarning,
  FolderOpen,
  Layers,
  Loader2,
  Map as MapIcon,
  PencilLine,
  X,
} from "lucide-react";
import { ColorControls } from "~/components/color-controls";
import { DsmMap } from "~/components/dsm-map";
import { ProfileChart } from "~/components/profile-chart";
import { ProfileTable } from "~/components/profile-table";
import { getPathProfileApi, hasDesktopBridge } from "~/lib/electron-api";
import type {
  ColorSettings,
  Coordinate,
  DsmProjectSummary,
  ProfilePoint,
} from "~/types/path-profile";

const initialColorSettings: ColorSettings = {
  palette: "terrain",
  min: 0,
  max: 1,
  autoStretch: true,
  reverse: false,
  opacity: 0.88,
};

export function PathProfileApp() {
  const [runtimeMode, setRuntimeMode] = useState<
    "pending" | "desktop" | "browser"
  >("pending");
  const [project, setProject] = useState<DsmProjectSummary | null>(null);
  const [colorSettings, setColorSettings] = useState(initialColorSettings);
  const [profilePoints, setProfilePoints] = useState<ProfilePoint[]>([]);
  const [activePoint, setActivePoint] = useState<ProfilePoint | null>(null);
  const [draftPath, setDraftPath] = useState<Coordinate[]>([]);
  const [draftProjection, setDraftProjection] = useState<string | null>(null);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [finishDrawingRequest, setFinishDrawingRequest] = useState(0);
  const [clearPathRequest, setClearPathRequest] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Idle");
  const [busy, setBusy] = useState(false);
  const [showBasemap, setShowBasemap] = useState(false);

  useEffect(() => {
    setRuntimeMode(hasDesktopBridge() ? "desktop" : "browser");
  }, []);

  const apiAvailable = runtimeMode !== "pending";

  const profileStats = useMemo(() => {
    const elevations = profilePoints
      .map((point) => point.elevation)
      .filter((value): value is number => value !== null);
    if (elevations.length === 0) return null;
    return {
      min: Math.min(...elevations),
      max: Math.max(...elevations),
      samples: profilePoints.length,
    };
  }, [profilePoints]);

  const handleOpen = useCallback(async () => {
    const api = getPathProfileApi();
    if (!api) {
      setError(
        "DSM API unavailable. Restart the app with bun run dev:desktop.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Opening DSM");

    try {
      const paths = await api.openDsmFiles();
      if (paths.length === 0) {
        setStatus("Idle");
        return;
      }

      setStatus("Loading DSM");
      const summary = await api.loadDsmProject(paths);
      setProject(summary);
      setWarnings(summary.warnings);
      setProfilePoints([]);
      setActivePoint(null);
      setDraftPath([]);
      setDraftProjection(null);
      setDrawingEnabled(false);
      setClearPathRequest((request) => request + 1);
      setShowBasemap(false);
      setColorSettings({
        ...initialColorSettings,
        min: summary.elevation.min,
        max: summary.elevation.max,
      });
      setStatus(
        `${summary.files.length} DSM file${summary.files.length === 1 ? "" : "s"}`,
      );
    } catch (loadError) {
      setError(errorMessage(loadError));
      setStatus("Load failed");
    } finally {
      setBusy(false);
    }
  }, []);

  const handleDraftPathChange = useCallback(
    (coordinates: Coordinate[], projection: string) => {
      setDraftPath(coordinates);
      setDraftProjection(projection);
      setDrawingEnabled(false);
      setStatus(`${coordinates.length.toLocaleString()} path vertices`);
    },
    [],
  );

  const handleGenerateProfile = useCallback(async () => {
    const api = getPathProfileApi();
    if (!api || !project || !draftProjection || draftPath.length < 2) return;

    setBusy(true);
    setError(null);
    setStatus("Sampling profile");

    try {
      const result = await api.generateProfile({
        projectId: project.id,
        path: { projection: draftProjection, coordinates: draftPath },
      });
      setProfilePoints(result.points);
      setWarnings(result.warnings);
      setActivePoint(null);
      setStatus(`${result.points.length.toLocaleString()} samples`);
    } catch (profileError) {
      setError(errorMessage(profileError));
      setStatus("Profile failed");
    } finally {
      setBusy(false);
    }
  }, [draftPath, draftProjection, project]);

  const handleStartPath = useCallback(() => {
    setDraftPath([]);
    setDraftProjection(null);
    setProfilePoints([]);
    setActivePoint(null);
    setDrawingEnabled(true);
    setClearPathRequest((request) => request + 1);
    setStatus("Drawing path");
  }, []);

  const handleFinishDrawing = useCallback(() => {
    setFinishDrawingRequest((request) => request + 1);
  }, []);

  const handleCancelPath = useCallback(() => {
    setDraftPath([]);
    setDraftProjection(null);
    setDrawingEnabled(false);
    setClearPathRequest((request) => request + 1);
    setStatus(project ? "Path cancelled" : "Idle");
  }, [project]);

  const handleExport = useCallback(async () => {
    const api = getPathProfileApi();
    if (!api || profilePoints.length === 0) return;

    setBusy(true);
    setError(null);
    setStatus("Exporting CSV");

    try {
      await api.exportProfileCsv(profilePoints);
      setStatus("CSV exported");
    } catch (exportError) {
      setError(errorMessage(exportError));
      setStatus("Export failed");
    } finally {
      setBusy(false);
    }
  }, [profilePoints]);

  return (
    <main className="grid h-screen grid-cols-[360px_minmax(420px,1fr)_420px] grid-rows-[minmax(0,1fr)_260px] bg-[#101418] text-[#e6edf3]">
      <aside className="row-span-2 flex min-h-0 flex-col border-r border-[#25313d] bg-[#151d26]">
        <div className="flex items-center gap-2 border-b border-[#25313d] px-4 py-3">
          <MapIcon aria-hidden="true" className="h-5 w-5 text-[#25c2a0]" />
          <h1 className="text-base font-semibold">Path Profile</h1>
        </div>

        <div className="grid gap-4 overflow-x-hidden overflow-y-auto p-4">
          <button
            className="flex h-10 items-center justify-center gap-2 rounded bg-[#237c6a] px-3 text-sm font-medium text-white hover:bg-[#2a927d] disabled:cursor-not-allowed disabled:bg-[#334454]"
            disabled={busy || !apiAvailable}
            type="button"
            onClick={handleOpen}
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen aria-hidden="true" className="h-4 w-4" />
            )}
            {runtimeMode === "browser" ? "Load Test DSM" : "Open DSM"}
          </button>

          <div className="grid gap-2 text-xs text-[#b6c4d2]">
            <div className="flex items-center justify-between">
              <span>Status</span>
              <span className="text-right text-[#f4f7fb]">{status}</span>
            </div>
            {project ? (
              <>
                <div className="flex items-center justify-between">
                  <span>CRS</span>
                  <span className="text-right text-[#f4f7fb]">
                    {project.epsg ?? project.extent.projection}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Range</span>
                  <span className="text-right text-[#f4f7fb]">
                    {formatNumber(project.elevation.min)} to{" "}
                    {formatNumber(project.elevation.max)}
                  </span>
                </div>
              </>
            ) : null}
          </div>

          <section className="grid gap-2 border-t border-[#25313d] pt-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[#f4f7fb]">
                Path Tool
              </h2>
              {draftPath.length >= 2 ? (
                <span className="text-xs text-[#8fa1b3]">
                  {draftPath.length.toLocaleString()} vertices
                </span>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                className="flex h-9 items-center justify-center gap-2 rounded border border-[#334454] px-2 text-sm text-[#f4f7fb] hover:bg-[#1b2632] disabled:cursor-not-allowed disabled:text-[#788896]"
                disabled={!project || busy || drawingEnabled}
                type="button"
                onClick={handleStartPath}
              >
                <PencilLine aria-hidden="true" className="h-4 w-4" />
                Start
              </button>
              <button
                className="flex h-9 items-center justify-center gap-2 rounded border border-[#334454] px-2 text-sm text-[#f4f7fb] hover:bg-[#1b2632] disabled:cursor-not-allowed disabled:text-[#788896]"
                disabled={!drawingEnabled || busy}
                type="button"
                onClick={handleFinishDrawing}
              >
                <Check aria-hidden="true" className="h-4 w-4" />
                Finish
              </button>
              <button
                className="flex h-9 items-center justify-center gap-2 rounded border border-[#334454] px-2 text-sm text-[#f4f7fb] hover:bg-[#1b2632] disabled:cursor-not-allowed disabled:text-[#788896]"
                disabled={(!drawingEnabled && draftPath.length === 0) || busy}
                type="button"
                onClick={handleCancelPath}
              >
                <X aria-hidden="true" className="h-4 w-4" />
                Cancel
              </button>
              <button
                className="flex h-9 items-center justify-center gap-2 rounded bg-[#237c6a] px-2 text-sm font-medium text-white hover:bg-[#2a927d] disabled:cursor-not-allowed disabled:bg-[#334454]"
                disabled={draftPath.length < 2 || drawingEnabled || busy}
                type="button"
                onClick={handleGenerateProfile}
              >
                <Check aria-hidden="true" className="h-4 w-4" />
                Profile
              </button>
            </div>
            <p className="text-xs leading-5 text-[#8fa1b3]">
              {drawingEnabled
                ? "Click along the DSM to add vertices, then press Finish."
                : draftPath.length >= 2
                  ? "Review or edit the path, then press Profile."
                  : "Press Start to draw a path."}
            </p>
          </section>

          {project ? (
            <section className="grid gap-2">
              <h2 className="text-sm font-semibold text-[#f4f7fb]">
                DSM Files
              </h2>
              <div className="grid gap-1">
                {project.files.map((file) => (
                  <div
                    key={file.id}
                    className="rounded border border-[#25313d] bg-[#101820] px-3 py-2 text-xs text-[#d8e1ea]"
                  >
                    <div className="truncate font-medium">{file.name}</div>
                    <div className="mt-1 text-[#8fa1b3]">
                      {file.size.width.toLocaleString()} x{" "}
                      {file.size.height.toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="flex items-center justify-between border-t border-[#25313d] pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Layers aria-hidden="true" className="h-4 w-4 text-[#25c2a0]" />
              Layers
            </div>
            <label className="flex items-center gap-2 text-xs text-[#b6c4d2]">
              <input
                checked={showBasemap}
                className="h-4 w-4 accent-[#25c2a0]"
                disabled={project?.epsg !== "EPSG:3857"}
                type="checkbox"
                onChange={(event) => setShowBasemap(event.target.checked)}
              />
              CARTO
            </label>
          </div>

          <ColorControls
            dataRange={project?.elevation ?? null}
            settings={colorSettings}
            onChange={setColorSettings}
          />

          {warnings.length > 0 ? (
            <section className="grid gap-2 border-t border-[#25313d] pt-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#f4f7fb]">
                <FileWarning
                  aria-hidden="true"
                  className="h-4 w-4 text-[#f6c445]"
                />
                Warnings
              </div>
              <div className="grid gap-2 text-xs text-[#d8e1ea]">
                {warnings.map((warning) => (
                  <p
                    key={warning}
                    className="rounded border border-[#5f4d24] bg-[#211d12] px-3 py-2"
                  >
                    {warning}
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {error ? (
            <p className="rounded border border-[#633039] bg-[#29151a] px-3 py-2 text-xs text-[#ffd6dc]">
              {error}
            </p>
          ) : null}
        </div>
      </aside>

      <section className="relative col-start-2 row-start-1 min-w-0">
        <DsmMap
          activePoint={activePoint}
          clearPathRequest={clearPathRequest}
          colorSettings={colorSettings}
          drawingEnabled={drawingEnabled}
          finishDrawingRequest={finishDrawingRequest}
          project={project}
          showBasemap={showBasemap}
          onDraftPathChange={handleDraftPathChange}
        />
        {!project ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#101418]">
            <div className="border border-[#25313d] bg-[#151d26] px-5 py-4 text-sm text-[#b6c4d2]">
              No DSM loaded
            </div>
          </div>
        ) : null}
      </section>

      <section className="col-start-2 row-start-2 flex min-h-0 flex-col border-t border-[#25313d] bg-[#151d26]">
        <div className="flex items-center justify-between gap-4 border-b border-[#25313d] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Profile</h2>
            <p className="text-xs text-[#8fa1b3]">
              {profileStats
                ? `${profileStats.samples.toLocaleString()} samples`
                : "No profile"}
            </p>
          </div>
          {profileStats ? (
            <div className="flex items-center gap-5 text-xs">
              <div>
                <span className="text-[#8fa1b3]">Min </span>
                <span className="font-medium text-[#f4f7fb]">
                  {formatNumber(profileStats.min)}
                </span>
              </div>
              <div>
                <span className="text-[#8fa1b3]">Max </span>
                <span className="font-medium text-[#f4f7fb]">
                  {formatNumber(profileStats.max)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 px-4">
          <ProfileChart points={profilePoints} onHoverPoint={setActivePoint} />
        </div>
      </section>

      <aside className="col-start-3 row-span-2 flex min-h-0 flex-col border-l border-[#25313d] bg-[#151d26]">
        <div className="flex items-center justify-between border-b border-[#25313d] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Profile Values</h2>
            <p className="text-xs text-[#8fa1b3]">
              {profileStats
                ? `${profileStats.samples.toLocaleString()} samples`
                : "No profile"}
            </p>
          </div>
          <button
            className="flex h-9 items-center gap-2 rounded border border-[#334454] px-3 text-sm text-[#f4f7fb] hover:bg-[#1b2632] disabled:cursor-not-allowed disabled:text-[#788896]"
            disabled={busy || profilePoints.length === 0}
            type="button"
            onClick={handleExport}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            CSV
          </button>
        </div>

        {profileStats ? (
          <div className="grid grid-cols-2 gap-3 px-4 py-3 text-xs">
            <div>
              <div className="text-[#8fa1b3]">Min</div>
              <div className="text-sm font-medium text-[#f4f7fb]">
                {formatNumber(profileStats.min)}
              </div>
            </div>
            <div>
              <div className="text-[#8fa1b3]">Max</div>
              <div className="text-sm font-medium text-[#f4f7fb]">
                {formatNumber(profileStats.max)}
              </div>
            </div>
          </div>
        ) : null}

        <ProfileTable points={profilePoints} onHoverPoint={setActivePoint} />
      </aside>
    </main>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
