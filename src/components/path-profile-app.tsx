"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  Edit3,
  FileWarning,
  Layers,
  Loader2,
  Map as MapIcon,
  PencilLine,
  SunMoon,
  Trash2,
  X,
} from "lucide-react";
import { DsmMap } from "~/components/dsm-map";
import { ProfileChart } from "~/components/profile-chart";
import { ProfileTable } from "~/components/profile-table";
import { getPathProfileApi, hasDesktopBridge } from "~/lib/electron-api";
import type {
  ColorPalette,
  ColorSettings,
  Coordinate,
  DsmProjectSummary,
  ProfilePoint,
} from "~/types/path-profile";

type ThemeMode = "system" | "light" | "dark" | "high-contrast";
type PopoverName = "palette" | "theme" | "opacity" | "path" | null;
type PathSnapshot = { coordinates: Coordinate[]; projection: string } | null;

const initialColorSettings: ColorSettings = {
  palette: "terrain",
  min: 0,
  max: 1,
  autoStretch: true,
  reverse: false,
  opacity: 1,
};

const palettes: { value: ColorPalette; label: string; swatch: string }[] = [
  {
    value: "terrain",
    label: "Terrain",
    swatch: "linear-gradient(135deg,#22553f,#5b894b,#baa863,#976846,#f1f1e8)",
  },
  {
    value: "viridis",
    label: "Viridis",
    swatch: "linear-gradient(135deg,#440154,#3b528b,#21918c,#5ec962,#fde725)",
  },
  {
    value: "plasma",
    label: "Plasma",
    swatch: "linear-gradient(135deg,#0d0887,#7e03a8,#cb4777,#f89540,#f0f921)",
  },
  {
    value: "grayscale",
    label: "Grayscale",
    swatch: "linear-gradient(135deg,#121820,#f6f8fa)",
  },
  {
    value: "high-contrast",
    label: "High contrast",
    swatch: "linear-gradient(135deg,#070c14,#1a74bc,#f4d03f,#ffffff)",
  },
];

const iconButtonClass =
  "flex h-12 w-12 items-center justify-center rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] text-[var(--text-primary)] shadow-sm backdrop-blur hover:bg-[var(--control-bg-hover)] disabled:cursor-not-allowed disabled:bg-[var(--disabled-bg)] disabled:text-[var(--disabled-text)]";

export function PathProfileApp() {
  const [project, setProject] = useState<DsmProjectSummary | null>(null);
  const [colorSettings, setColorSettings] = useState(initialColorSettings);
  const [profilePoints, setProfilePoints] = useState<ProfilePoint[]>([]);
  const [activePoint, setActivePoint] = useState<ProfilePoint | null>(null);
  const [draftPath, setDraftPath] = useState<Coordinate[]>([]);
  const [draftProjection, setDraftProjection] = useState<string | null>(null);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [pathEditEnabled, setPathEditEnabled] = useState(false);
  const [finishDrawingRequest, setFinishDrawingRequest] = useState(0);
  const [clearPathRequest, setClearPathRequest] = useState(0);
  const [restorePathRequest, setRestorePathRequest] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Idle");
  const [busy, setBusy] = useState(false);
  const [showBasemap, setShowBasemap] = useState(false);
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [pathContextPosition, setPathContextPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const pathHistoryRef = useRef<PathSnapshot[]>([]);
  const pendingGenerateAfterFinishRef = useRef(false);
  const profileRequestIdRef = useRef(0);

  const pathToRestore = useMemo(
    () => ({ coordinates: draftPath, projection: draftProjection }),
    [draftPath, draftProjection],
  );

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

  const currentPathSnapshot = useCallback((): PathSnapshot => {
    if (!draftProjection || draftPath.length < 2) return null;
    return {
      coordinates: draftPath.map((coordinate) => [...coordinate] as Coordinate),
      projection: draftProjection,
    };
  }, [draftPath, draftProjection]);

  const restorePathSnapshot = useCallback((snapshot: PathSnapshot) => {
    setDraftPath(snapshot?.coordinates ?? []);
    setDraftProjection(snapshot?.projection ?? null);
    setProfilePoints([]);
    setActivePoint(null);
    setDrawingEnabled(false);
    setPathEditEnabled(false);
    setRestorePathRequest((request) => request + 1);
    setStatus(snapshot ? "Path restored" : "Path cleared");
  }, []);

  const generateProfileForPath = useCallback(
    async (coordinates: Coordinate[], projection: string) => {
      const api = getPathProfileApi();
      if (!api || !project || coordinates.length < 2) return;

      const requestId = profileRequestIdRef.current + 1;
      profileRequestIdRef.current = requestId;
      setBusy(true);
      setError(null);
      setStatus("Sampling profile");

      try {
        const result = await api.generateProfile({
          projectId: project.id,
          path: { projection, coordinates },
        });
        if (profileRequestIdRef.current !== requestId) return;
        setProfilePoints(result.points);
        setWarnings(result.warnings);
        setActivePoint(null);
        setStatus(`${result.points.length.toLocaleString()} samples`);
      } catch (profileError) {
        if (profileRequestIdRef.current !== requestId) return;
        setError(errorMessage(profileError));
        setStatus("Profile failed");
      } finally {
        if (profileRequestIdRef.current === requestId) {
          setBusy(false);
        }
      }
    },
    [project],
  );

  const handleOpen = useCallback(async () => {
    const api = getPathProfileApi();
    if (!api || !hasDesktopBridge()) {
      setError(
        "DEM API unavailable. Restart the app with bun run dev:desktop.",
      );
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Opening DEM");

    try {
      const paths = await api.openDsmFiles();
      if (paths.length === 0) {
        setStatus("Idle");
        return;
      }

      setStatus("Loading DEM");
      const summary = await api.loadDsmProject(paths);
      profileRequestIdRef.current += 1;
      setProject(summary);
      setWarnings(summary.warnings);
      setProfilePoints([]);
      setActivePoint(null);
      setDraftPath([]);
      setDraftProjection(null);
      setDrawingEnabled(false);
      setPathEditEnabled(false);
      setClearPathRequest((request) => request + 1);
      setShowBasemap(false);
      pathHistoryRef.current = [];
      setOpenPopover(null);
      setColorSettings({
        ...initialColorSettings,
        min: summary.elevation.min,
        max: summary.elevation.max,
      });
      setStatus(
        `${summary.files.length} DEM file${summary.files.length === 1 ? "" : "s"}`,
      );
    } catch (loadError) {
      setError(errorMessage(loadError));
      setStatus("Load failed");
    } finally {
      setBusy(false);
    }
  }, []);

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

  const handleDraftPathChange = useCallback(
    (
      coordinates: Coordinate[],
      projection: string,
      changeType: "draw" | "modify",
    ) => {
      if (changeType === "modify") {
        const previousSnapshot = currentPathSnapshot();
        if (previousSnapshot) {
          pathHistoryRef.current = [
            ...pathHistoryRef.current,
            previousSnapshot,
          ];
        }
      }

      setDraftPath(coordinates);
      setDraftProjection(projection);
      setDrawingEnabled(false);
      setStatus(`${coordinates.length.toLocaleString()} path vertices`);

      const shouldGenerateProfile =
        changeType === "draw" ||
        changeType === "modify" ||
        pendingGenerateAfterFinishRef.current;

      if (shouldGenerateProfile) {
        pendingGenerateAfterFinishRef.current = false;
        void generateProfileForPath(coordinates, projection);
      }
    },
    [currentPathSnapshot, generateProfileForPath],
  );

  const handleStartPath = useCallback(() => {
    setDraftPath([]);
    setDraftProjection(null);
    setProfilePoints([]);
    setActivePoint(null);
    profileRequestIdRef.current += 1;
    setDrawingEnabled(true);
    setPathEditEnabled(false);
    setClearPathRequest((request) => request + 1);
    pathHistoryRef.current = [];
    setOpenPopover(null);
    setStatus("Drawing path");
  }, []);

  const handleSavePathAndGenerateProfile = useCallback(() => {
    if (busy) return;

    if (drawingEnabled) {
      pendingGenerateAfterFinishRef.current = true;
      setFinishDrawingRequest((request) => request + 1);
      setStatus("Saving path");
      return;
    }

    if (draftProjection && draftPath.length >= 2) {
      void generateProfileForPath(draftPath, draftProjection);
    }
  }, [
    busy,
    draftPath,
    draftProjection,
    drawingEnabled,
    generateProfileForPath,
  ]);

  const handleCancelPath = useCallback(() => {
    const previousSnapshot = currentPathSnapshot();
    if (previousSnapshot) {
      pathHistoryRef.current = [...pathHistoryRef.current, previousSnapshot];
    }

    pendingGenerateAfterFinishRef.current = false;
    setDraftPath([]);
    setDraftProjection(null);
    setProfilePoints([]);
    setActivePoint(null);
    profileRequestIdRef.current += 1;
    setDrawingEnabled(false);
    setPathEditEnabled(false);
    setClearPathRequest((request) => request + 1);
    setOpenPopover(null);
    setStatus(project ? "Path cleared" : "Idle");
  }, [currentPathSnapshot, project]);

  const handleUndoPath = useCallback(() => {
    const snapshot = pathHistoryRef.current.pop();
    if (snapshot !== undefined) {
      restorePathSnapshot(snapshot);
      if (snapshot) {
        void generateProfileForPath(snapshot.coordinates, snapshot.projection);
      }
    }
  }, [generateProfileForPath, restorePathSnapshot]);

  const handlePathContextMenu = useCallback(
    (position: { x: number; y: number }) => {
      if (draftPath.length < 2) return;
      setPathContextPosition(position);
      setOpenPopover("path");
    },
    [draftPath.length],
  );

  useEffect(() => {
    const api = getPathProfileApi();
    if (!api || !hasDesktopBridge()) return;

    const unsubscribeOpen = api.onOpenDsmRequested(() => {
      void handleOpen();
    });
    const unsubscribeExport = api.onExportProfileRequested(() => {
      void handleExport();
    });

    return () => {
      unsubscribeOpen();
      unsubscribeExport();
    };
  }, [handleExport, handleOpen]);

  useEffect(() => {
    const savedTheme = localStorage.getItem("path-profile-theme");
    if (
      savedTheme === "system" ||
      savedTheme === "light" ||
      savedTheme === "dark" ||
      savedTheme === "high-contrast"
    ) {
      setThemeMode(savedTheme);
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem("path-profile-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const commandOrControl = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") {
        event.preventDefault();
        if (openPopover) {
          setOpenPopover(null);
          return;
        }
        if (drawingEnabled) {
          handleCancelPath();
          return;
        }
        if (pathEditEnabled) {
          setPathEditEnabled(false);
          setStatus("Path edit off");
        }
      }

      if (commandOrControl && event.key.toLowerCase() === "z") {
        event.preventDefault();
        handleUndoPath();
      }

      if (event.key === "Enter" && drawingEnabled) {
        event.preventDefault();
        handleSavePathAndGenerateProfile();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    drawingEnabled,
    handleCancelPath,
    handleSavePathAndGenerateProfile,
    handleUndoPath,
    openPopover,
    pathEditEnabled,
  ]);

  const activePalette = palettes.find(
    (palette) => palette.value === colorSettings.palette,
  );

  return (
    <main className="grid h-screen grid-cols-[minmax(520px,1fr)_420px] grid-rows-[minmax(0,1fr)_260px] bg-[var(--app-bg)] text-[var(--text-primary)]">
      <section className="relative col-start-1 row-start-1 min-w-0 overflow-hidden">
        <DsmMap
          activePoint={activePoint}
          clearPathRequest={clearPathRequest}
          colorSettings={colorSettings}
          drawingEnabled={drawingEnabled}
          finishDrawingRequest={finishDrawingRequest}
          pathEditEnabled={pathEditEnabled}
          pathToRestore={pathToRestore}
          project={project}
          restorePathRequest={restorePathRequest}
          showBasemap={showBasemap}
          onDraftPathChange={handleDraftPathChange}
          onPathContextMenu={handlePathContextMenu}
        />

        {!project ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--map-empty-bg)]">
            <div className="border border-[var(--overlay-border)] bg-[var(--overlay-bg)] px-5 py-4 text-sm text-[var(--text-secondary)] shadow-sm backdrop-blur">
              Open a DEM from File &gt; Open DEM...
            </div>
          </div>
        ) : null}

        <div className="absolute top-4 right-4 left-4 flex items-start gap-2">
          <div className="flex h-12 max-w-[420px] items-center gap-2 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] px-3 text-xs text-[var(--text-secondary)] shadow-sm backdrop-blur">
            {busy ? (
              <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
            ) : (
              <MapIcon
                aria-hidden="true"
                className="h-4 w-4 text-[var(--accent)]"
              />
            )}
            <div className="min-w-0">
              <div className="truncate font-medium text-[var(--text-primary)]">
                {project
                  ? `${project.files.length} DEM file${project.files.length === 1 ? "" : "s"}`
                  : "Path Profile"}
              </div>
              <div className="truncate">{status}</div>
            </div>
          </div>

          <div className="relative">
            <button
              aria-label={drawingEnabled ? "Path drawing active" : "Draw path"}
              aria-pressed={drawingEnabled}
              className={`${iconButtonClass} ${drawingEnabled ? "border-[var(--accent)] text-[var(--accent)]" : ""}`}
              disabled={!project || busy}
              title="Draw path"
              type="button"
              onClick={handleStartPath}
            >
              <PencilLine aria-hidden="true" className="h-5 w-5" />
            </button>
            {drawingEnabled ? (
              <div className="absolute top-full left-0 mt-1 grid w-12 justify-items-center gap-3 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] py-3 shadow-sm backdrop-blur">
                <button
                  aria-label="Save path and generate profile"
                  className="flex h-6 w-6 items-center justify-center text-[var(--accent)] hover:text-[var(--accent-hover)]"
                  disabled={busy}
                  title="Save path and generate profile"
                  type="button"
                  onClick={handleSavePathAndGenerateProfile}
                >
                  <Check aria-hidden="true" className="h-5 w-5" />
                </button>
                <button
                  aria-label="Cancel path"
                  className="flex h-6 w-6 items-center justify-center text-[var(--danger)] hover:text-[var(--text-primary)]"
                  disabled={busy}
                  title="Cancel path"
                  type="button"
                  onClick={handleCancelPath}
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              aria-label="DEM color"
              aria-expanded={openPopover === "palette"}
              className={iconButtonClass}
              disabled={!project}
              title="DEM color"
              type="button"
              onClick={() =>
                setOpenPopover(openPopover === "palette" ? null : "palette")
              }
            >
              <span
                aria-hidden="true"
                className="h-6 w-6 rounded-full border border-[var(--overlay-border)]"
                style={{ background: activePalette?.swatch }}
              />
            </button>
            {openPopover === "palette" ? (
              <div className="absolute top-full left-0 mt-1 grid w-12 justify-items-center gap-3 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] py-3 shadow-sm backdrop-blur">
                {palettes.map((palette) => (
                  <button
                    key={palette.value}
                    aria-label={`Use ${palette.label} DEM style`}
                    aria-pressed={colorSettings.palette === palette.value}
                    className={`h-6 w-6 rounded-full border-2 shadow-sm ${
                      colorSettings.palette === palette.value
                        ? "border-[var(--accent)]"
                        : "border-[var(--overlay-border)]"
                    }`}
                    disabled={!project || busy}
                    style={{ background: palette.swatch }}
                    title={palette.label}
                    type="button"
                    onClick={() =>
                      setColorSettings({
                        ...colorSettings,
                        palette: palette.value,
                        autoStretch: true,
                        reverse: false,
                      })
                    }
                  />
                ))}
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              aria-label="Theme"
              aria-expanded={openPopover === "theme"}
              className={iconButtonClass}
              title="Theme"
              type="button"
              onClick={() =>
                setOpenPopover(openPopover === "theme" ? null : "theme")
              }
            >
              <SunMoon aria-hidden="true" className="h-5 w-5" />
            </button>
            {openPopover === "theme" ? (
              <div className="absolute top-full left-0 mt-1 grid w-12 justify-items-center gap-1 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] p-1 text-xs shadow-sm backdrop-blur">
                {(
                  ["system", "light", "dark", "high-contrast"] as ThemeMode[]
                ).map((theme) => (
                  <button
                    key={theme}
                    className={`flex h-10 w-10 items-center justify-center rounded text-center hover:bg-[var(--control-bg-hover)] ${
                      themeMode === theme ? "text-[var(--accent)]" : ""
                    }`}
                    title={theme.replace("-", " ")}
                    type="button"
                    onClick={() => {
                      setThemeMode(theme);
                      setOpenPopover(null);
                    }}
                  >
                    {themeLabel(theme)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button
              aria-label="DEM opacity"
              aria-expanded={openPopover === "opacity"}
              className={iconButtonClass}
              disabled={!project}
              title="DEM opacity"
              type="button"
              onClick={() =>
                setOpenPopover(openPopover === "opacity" ? null : "opacity")
              }
            >
              <span className="text-xs font-semibold">
                {Math.round(colorSettings.opacity * 100)}
              </span>
            </button>
            {openPopover === "opacity" ? (
              <div className="absolute top-full left-0 mt-1 grid w-12 justify-items-center gap-3 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] py-3 text-xs text-[var(--text-secondary)] shadow-sm backdrop-blur">
                <label
                  className="grid justify-items-center gap-1"
                  title={`Opacity ${Math.round(colorSettings.opacity * 100)}%`}
                >
                  <input
                    className="h-32 w-8 accent-[var(--accent)] [writing-mode:vertical-lr]"
                    max={1}
                    min={0}
                    step={0.05}
                    type="range"
                    value={colorSettings.opacity}
                    onChange={(event) =>
                      setColorSettings({
                        ...colorSettings,
                        autoStretch: true,
                        opacity: Number(event.target.value),
                        reverse: false,
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
        </div>

        <div className="absolute bottom-4 left-4 grid w-40 gap-2 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] px-3 py-3 text-xs text-[var(--text-secondary)] shadow-sm backdrop-blur">
          <div className="flex items-center gap-2 font-medium text-[var(--text-primary)]">
            <Layers
              aria-hidden="true"
              className="h-4 w-4 text-[var(--accent)]"
            />
            Layers
          </div>
          <label className="grid grid-cols-[1fr_auto] items-center gap-2">
            <span>DEM</span>
            <input
              checked
              className="h-4 w-4 accent-[var(--accent)]"
              disabled
              type="checkbox"
            />
          </label>
          <label
            className="grid grid-cols-[1fr_auto] items-center gap-2"
            title={
              project?.epsg === "EPSG:3857"
                ? "CARTO"
                : "CARTO requires EPSG:3857"
            }
          >
            <span>CARTO</span>
            <input
              checked={showBasemap}
              className="h-4 w-4 accent-[var(--accent)]"
              disabled={project?.epsg !== "EPSG:3857"}
              type="checkbox"
              onChange={(event) => setShowBasemap(event.target.checked)}
            />
          </label>
        </div>

        {project || draftPath.length >= 2 || profileStats ? (
          <div className="absolute right-4 bottom-4 grid max-w-sm gap-1 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-sm backdrop-blur">
            {project ? (
              <>
                <div>
                  CRS{" "}
                  <span className="text-[var(--text-primary)]">
                    {project.epsg ?? project.extent.projection}
                  </span>
                </div>
                <div>
                  Range{" "}
                  <span className="text-[var(--text-primary)]">
                    {formatNumber(project.elevation.min)} to{" "}
                    {formatNumber(project.elevation.max)}
                  </span>
                </div>
              </>
            ) : null}
            {draftPath.length >= 2 ? (
              <div>
                Path{" "}
                <span className="text-[var(--text-primary)]">
                  {draftPath.length.toLocaleString()} vertices
                </span>
              </div>
            ) : null}
            {profileStats ? (
              <div>
                Profile{" "}
                <span className="text-[var(--text-primary)]">
                  {profileStats.samples.toLocaleString()} samples,{" "}
                  {formatNumber(profileStats.min)} to{" "}
                  {formatNumber(profileStats.max)}
                </span>
              </div>
            ) : null}
          </div>
        ) : null}

        {warnings.length > 0 || error ? (
          <div className="absolute bottom-4 left-1/2 grid w-max max-w-[calc(100%-2rem)] -translate-x-1/2 gap-2 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-sm backdrop-blur">
            {error ? (
              <div className="flex items-start gap-2 text-[var(--danger)]">
                <FileWarning
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <p>{error}</p>
              </div>
            ) : null}
            {warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-2">
                <FileWarning
                  aria-hidden="true"
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]"
                />
                <p>{warning}</p>
              </div>
            ))}
          </div>
        ) : null}

        {openPopover === "path" && draftPath.length >= 2 ? (
          <div
            className="absolute z-10 grid w-44 gap-1 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] p-2 text-sm shadow-sm backdrop-blur"
            style={{
              left: pathContextPosition ? pathContextPosition.x : 64,
              top: pathContextPosition ? pathContextPosition.y : 176,
            }}
          >
            <button
              className="flex items-center gap-2 rounded px-3 py-2 text-left hover:bg-[var(--control-bg-hover)]"
              type="button"
              onClick={() => {
                setPathEditEnabled(true);
                setOpenPopover(null);
                setPathContextPosition(null);
                setStatus("Editing path");
              }}
            >
              <Edit3 aria-hidden="true" className="h-4 w-4" />
              Edit path
            </button>
            <button
              className="flex items-center gap-2 rounded px-3 py-2 text-left text-[var(--danger)] hover:bg-[var(--control-bg-hover)]"
              type="button"
              onClick={() => {
                setOpenPopover(null);
                setPathContextPosition(null);
                handleCancelPath();
              }}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Clear path
            </button>
          </div>
        ) : null}
      </section>

      <section className="col-start-1 row-start-2 flex min-h-0 flex-col border-t border-[var(--panel-border)] bg-[var(--panel-bg)]">
        <div className="flex items-center justify-between gap-4 border-b border-[var(--panel-border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Profile</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {profileStats
                ? `${profileStats.samples.toLocaleString()} samples`
                : "No profile"}
            </p>
          </div>
          {profileStats ? (
            <div className="flex items-center gap-5 text-xs">
              <div>
                <span className="text-[var(--text-muted)]">Min </span>
                <span className="font-medium text-[var(--text-primary)]">
                  {formatNumber(profileStats.min)}
                </span>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Max </span>
                <span className="font-medium text-[var(--text-primary)]">
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

      <aside className="col-start-2 row-span-2 flex min-h-0 flex-col border-l border-[var(--panel-border)] bg-[var(--panel-bg)]">
        <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-4 py-3">
          <div>
            <h2 className="text-base font-semibold">Profile Values</h2>
            <p className="text-xs text-[var(--text-muted)]">
              {profileStats
                ? `${profileStats.samples.toLocaleString()} samples`
                : "No profile"}
            </p>
          </div>
          <button
            className="flex h-9 items-center gap-2 rounded border border-[var(--panel-border)] px-3 text-sm text-[var(--text-primary)] hover:bg-[var(--control-bg-hover)] disabled:cursor-not-allowed disabled:text-[var(--disabled-text)]"
            disabled={busy || profilePoints.length === 0}
            type="button"
            onClick={handleExport}
          >
            <Download aria-hidden="true" className="h-4 w-4" />
            CSV
          </button>
        </div>

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

function themeLabel(theme: ThemeMode): string {
  switch (theme) {
    case "system":
      return "S";
    case "light":
      return "L";
    case "dark":
      return "D";
    case "high-contrast":
      return "H";
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "select" ||
    tagName === "textarea" ||
    target.isContentEditable
  );
}
