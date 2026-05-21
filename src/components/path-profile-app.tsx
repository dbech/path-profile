"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Download,
  Edit3,
  FileWarning,
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
import { defaultBasemap, type BasemapId } from "~/lib/basemaps";
import { getPathProfileApi, hasDesktopBridge } from "~/lib/electron-api";
import { exportProfileStatus } from "~/lib/export-profile-status";
import {
  createDefaultLineOfSightEndpoints,
  type LineOfSightEndpointId,
  type LineOfSightEndpoints,
} from "~/lib/line-of-sight";
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
type LineOfSightDrafts = Record<LineOfSightEndpointId, string>;
type ResizeDrag =
  | {
      kind: "profile";
      pointerId: number;
      startHeight: number;
      startY: number;
    }
  | {
      kind: "values";
      pointerId: number;
      startWidth: number;
      startX: number;
    };

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

const emptyLineOfSightDrafts: LineOfSightDrafts = { start: "", end: "" };
const defaultProfilePanelHeight = 260;
const minProfilePanelHeight = 180;
const minMapHeight = 320;
const resizeStep = 24;
const defaultValuesPanelWidth = 420;
const minValuesPanelWidth = 300;
const minMapColumnWidth = 520;

/**
 * Render the Path Profile application UI that manages DEM loading, interactive path drawing and editing, elevation profile sampling, editable line-of-sight endpoints, CSV export, theming, basemap selection, warnings/errors, and resizable profile and values panels.
 *
 * This component orchestrates project lifecycle (open/load), path drafting and undo/restore, guarded asynchronous profile generation, editable numeric drafts for line-of-sight endpoints with commit/parse semantics, exporting sampled profile CSV, persistent theme selection, desktop-bridge event subscriptions, keyboard and pointer-driven panel resizing, and all related UI state.
 *
 * @returns The root React element for the Path Profile application UI
 */
export function PathProfileApp() {
  const [project, setProject] = useState<DsmProjectSummary | null>(null);
  const [colorSettings, setColorSettings] = useState(initialColorSettings);
  const [profilePoints, setProfilePoints] = useState<ProfilePoint[]>([]);
  const [lineOfSightEndpoints, setLineOfSightEndpoints] =
    useState<LineOfSightEndpoints | null>(null);
  const [lineOfSightDrafts, setLineOfSightDrafts] = useState<LineOfSightDrafts>(
    emptyLineOfSightDrafts,
  );
  const [activePoint, setActivePoint] = useState<ProfilePoint | null>(null);
  const [draftPath, setDraftPath] = useState<Coordinate[]>([]);
  const [draftProjection, setDraftProjection] = useState<string | null>(null);
  const [drawingEnabled, setDrawingEnabled] = useState(false);
  const [pathEditEnabled, setPathEditEnabled] = useState(false);
  const [clearPathRequest, setClearPathRequest] = useState(0);
  const [restorePathRequest, setRestorePathRequest] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Idle");
  const [busy, setBusy] = useState(false);
  const [selectedBasemap, setSelectedBasemap] =
    useState<BasemapId>(defaultBasemap);
  const [openPopover, setOpenPopover] = useState<PopoverName>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [profilePanelHeight, setProfilePanelHeight] = useState(
    defaultProfilePanelHeight,
  );
  const [valuesPanelWidth, setValuesPanelWidth] = useState(
    defaultValuesPanelWidth,
  );
  const [activeResize, setActiveResize] = useState<ResizeDrag["kind"] | null>(
    null,
  );
  const [pathContextPosition, setPathContextPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const pathHistoryRef = useRef<PathSnapshot[]>([]);
  const profileRequestIdRef = useRef(0);
  const profileRequestBusyRef = useRef(false);
  const resizeDragRef = useRef<ResizeDrag | null>(null);

  const pathToRestore = useMemo(
    () => ({ coordinates: draftPath, projection: draftProjection }),
    [draftPath, draftProjection],
  );

  const syncLineOfSightEndpoints = useCallback(
    (endpoints: LineOfSightEndpoints | null) => {
      setLineOfSightEndpoints(endpoints);
      setLineOfSightDrafts(formatLineOfSightDrafts(endpoints));
    },
    [],
  );

  const invalidateProfileRequest = useCallback((clearBusy = true) => {
    profileRequestIdRef.current += 1;
    if (profileRequestBusyRef.current) {
      profileRequestBusyRef.current = false;
      if (clearBusy) {
        setBusy(false);
      }
    }
  }, []);

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

  const elevationUnit =
    project?.elevation.unit && project.elevation.unit !== "unknown"
      ? project.elevation.unit
      : null;

  const noticeMessages = useMemo(
    () => (project ? warnings : ["Open a DEM from File > Open DEM..."]),
    [project, warnings],
  );

  const currentPathSnapshot = useCallback((): PathSnapshot => {
    const coordinates = straightPathEndpoints(draftPath);
    if (!draftProjection || coordinates.length < 2) return null;
    return {
      coordinates,
      projection: draftProjection,
    };
  }, [draftPath, draftProjection]);

  const restorePathSnapshot = useCallback(
    (snapshot: PathSnapshot) => {
      setDraftPath(snapshot?.coordinates ?? []);
      setDraftProjection(snapshot?.projection ?? null);
      setProfilePoints([]);
      syncLineOfSightEndpoints(null);
      setActivePoint(null);
      setDrawingEnabled(false);
      setPathEditEnabled(false);
      setRestorePathRequest((request) => request + 1);
      setStatus(snapshot ? "Path restored" : "Path cleared");
    },
    [syncLineOfSightEndpoints],
  );

  const generateProfileForPath = useCallback(
    async (coordinates: Coordinate[], projection: string) => {
      const api = getPathProfileApi();
      if (!api || !project || coordinates.length < 2) return;

      const requestId = profileRequestIdRef.current + 1;
      profileRequestIdRef.current = requestId;
      profileRequestBusyRef.current = true;
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
        syncLineOfSightEndpoints(
          createDefaultLineOfSightEndpoints(result.points),
        );
        setWarnings(result.warnings);
        setActivePoint(null);
        setStatus(`${result.points.length.toLocaleString()} samples`);
      } catch (profileError) {
        if (profileRequestIdRef.current !== requestId) return;
        setError(errorMessage(profileError));
        setStatus("Profile failed");
      } finally {
        if (profileRequestIdRef.current === requestId) {
          profileRequestBusyRef.current = false;
          setBusy(false);
        }
      }
    },
    [project, syncLineOfSightEndpoints],
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
      invalidateProfileRequest(false);
      setProject(summary);
      setWarnings(summary.warnings);
      setProfilePoints([]);
      syncLineOfSightEndpoints(null);
      setActivePoint(null);
      setDraftPath([]);
      setDraftProjection(null);
      setDrawingEnabled(false);
      setPathEditEnabled(false);
      setClearPathRequest((request) => request + 1);
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
  }, [invalidateProfileRequest, syncLineOfSightEndpoints]);

  const handleExport = useCallback(async () => {
    const api = getPathProfileApi();
    if (!api || profilePoints.length === 0) return;

    setBusy(true);
    setError(null);
    setStatus("Exporting CSV");

    try {
      const exported = await api.exportProfileCsv(profilePoints);
      setStatus(exportProfileStatus(exported));
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

      const straightPath = straightPathEndpoints(coordinates);
      if (straightPath.length < 2) {
        setStatus("Place A, then B");
        return;
      }

      if (sameCoordinate(straightPath[0]!, straightPath[1]!)) {
        setDraftPath([]);
        setDraftProjection(null);
        setProfilePoints([]);
        syncLineOfSightEndpoints(null);
        setActivePoint(null);
        invalidateProfileRequest();
        setDrawingEnabled(false);
        setPathEditEnabled(false);
        setClearPathRequest((request) => request + 1);
        setOpenPopover(null);
        setStatus("Place B away from A");
        return;
      }

      setDraftPath(straightPath);
      setDraftProjection(projection);
      setDrawingEnabled(false);
      setStatus("A to B path");
      void generateProfileForPath(straightPath, projection);
    },
    [
      currentPathSnapshot,
      generateProfileForPath,
      invalidateProfileRequest,
      syncLineOfSightEndpoints,
    ],
  );

  const handleStartPath = useCallback(() => {
    setDraftPath([]);
    setDraftProjection(null);
    setProfilePoints([]);
    syncLineOfSightEndpoints(null);
    setActivePoint(null);
    profileRequestIdRef.current += 1;
    setDrawingEnabled(true);
    setPathEditEnabled(false);
    setClearPathRequest((request) => request + 1);
    pathHistoryRef.current = [];
    setOpenPopover(null);
    setStatus("Place A, then B");
  }, [invalidateProfileRequest, syncLineOfSightEndpoints]);

  const handleEndPathEdit = useCallback(() => {
    setPathEditEnabled(false);
    setOpenPopover(null);
    setPathContextPosition(null);
    setStatus(draftPath.length >= 2 ? "A to B path" : "Path edit off");
  }, [draftPath.length]);

  const handleCancelPath = useCallback(() => {
    const previousSnapshot = currentPathSnapshot();
    if (previousSnapshot) {
      pathHistoryRef.current = [...pathHistoryRef.current, previousSnapshot];
    }

    setDraftPath([]);
    setDraftProjection(null);
    setProfilePoints([]);
    syncLineOfSightEndpoints(null);
    setActivePoint(null);
    invalidateProfileRequest();
    setDrawingEnabled(false);
    setPathEditEnabled(false);
    setClearPathRequest((request) => request + 1);
    setOpenPopover(null);
    setStatus(project ? "Path cleared" : "Idle");
  }, [
    currentPathSnapshot,
    invalidateProfileRequest,
    project,
    syncLineOfSightEndpoints,
  ]);

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

  const handleLineOfSightEndpointChange = useCallback(
    (endpointId: LineOfSightEndpointId, elevation: number) => {
      if (!Number.isFinite(elevation)) return;

      setLineOfSightEndpoints((current) =>
        current
          ? withLineOfSightEndpoint(current, endpointId, elevation)
          : null,
      );
      setLineOfSightDrafts((current) => ({
        ...current,
        [endpointId]: formatElevationInput(elevation),
      }));
    },
    [],
  );

  const handleLineOfSightDraftChange = useCallback(
    (endpointId: LineOfSightEndpointId, value: string) => {
      setLineOfSightDrafts((current) => ({ ...current, [endpointId]: value }));

      const elevation = parseElevationDraft(value);
      if (elevation === null) return;

      setLineOfSightEndpoints((current) =>
        current
          ? withLineOfSightEndpoint(current, endpointId, elevation)
          : null,
      );
    },
    [],
  );

  const handleLineOfSightDraftCommit = useCallback(
    (endpointId: LineOfSightEndpointId) => {
      const elevation = parseElevationDraft(lineOfSightDrafts[endpointId]);

      if (elevation !== null) {
        handleLineOfSightEndpointChange(endpointId, elevation);
        return;
      }

      setLineOfSightDrafts(formatLineOfSightDrafts(lineOfSightEndpoints));
    },
    [handleLineOfSightEndpointChange, lineOfSightDrafts, lineOfSightEndpoints],
  );

  const handleResizePointerDown = useCallback(
    (kind: ResizeDrag["kind"], event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setActiveResize(kind);

      resizeDragRef.current =
        kind === "profile"
          ? {
              kind,
              pointerId: event.pointerId,
              startHeight: profilePanelHeight,
              startY: event.clientY,
            }
          : {
              kind,
              pointerId: event.pointerId,
              startWidth: valuesPanelWidth,
              startX: event.clientX,
            };
    },
    [profilePanelHeight, valuesPanelWidth],
  );

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = resizeDragRef.current;
      if (drag?.pointerId !== event.pointerId) return;

      event.preventDefault();

      if (drag.kind === "profile") {
        setProfilePanelHeight(
          clampProfilePanelHeight(
            drag.startHeight + drag.startY - event.clientY,
          ),
        );
        return;
      }

      setValuesPanelWidth(
        clampValuesPanelWidth(drag.startWidth + drag.startX - event.clientX),
      );
    },
    [],
  );

  const handleResizePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = resizeDragRef.current;
      if (drag?.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      resizeDragRef.current = null;
      setActiveResize(null);
    },
    [],
  );

  const handleResizeKeyDown = useCallback(
    (kind: ResizeDrag["kind"], event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (kind === "profile") {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setProfilePanelHeight((height) =>
            clampProfilePanelHeight(height + resizeStep),
          );
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setProfilePanelHeight((height) =>
            clampProfilePanelHeight(height - resizeStep),
          );
        }
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setValuesPanelWidth((width) =>
          clampValuesPanelWidth(width + resizeStep),
        );
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setValuesPanelWidth((width) =>
          clampValuesPanelWidth(width - resizeStep),
        );
      }
    },
    [],
  );

  useEffect(() => {
    const api = getPathProfileApi();
    if (!api || !hasDesktopBridge()) return;

    void api.getSelectedBasemap().then(setSelectedBasemap);

    const unsubscribeOpen = api.onOpenDsmRequested(() => {
      void handleOpen();
    });
    const unsubscribeExport = api.onExportProfileRequested(() => {
      void handleExport();
    });
    const unsubscribeBasemap = api.onBasemapSelected((basemapId) => {
      setSelectedBasemap(basemapId);
    });

    return () => {
      unsubscribeOpen();
      unsubscribeExport();
      unsubscribeBasemap();
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
    const handleWindowResize = () => {
      setProfilePanelHeight(clampProfilePanelHeight);
      setValuesPanelWidth(clampValuesPanelWidth);
    };

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, []);

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
          handleEndPathEdit();
        }
      }

      if (commandOrControl && event.key.toLowerCase() === "z") {
        event.preventDefault();
        handleUndoPath();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    drawingEnabled,
    handleCancelPath,
    handleEndPathEdit,
    handleUndoPath,
    openPopover,
    pathEditEnabled,
  ]);

  const activePalette = palettes.find(
    (palette) => palette.value === colorSettings.palette,
  );
  return (
    <main
      className={`grid h-screen bg-[var(--app-bg)] text-[var(--text-primary)] ${activeResize ? "select-none" : ""}`}
      style={{
        gridTemplateColumns: `minmax(${minMapColumnWidth}px, 1fr) ${valuesPanelWidth}px`,
        gridTemplateRows: `minmax(0, 1fr) ${profilePanelHeight}px`,
      }}
    >
      <section className="relative col-start-1 row-start-1 min-w-0 overflow-hidden">
        <DsmMap
          activePoint={activePoint}
          clearPathRequest={clearPathRequest}
          colorSettings={colorSettings}
          drawingEnabled={drawingEnabled}
          pathEditEnabled={pathEditEnabled}
          pathToRestore={pathToRestore}
          project={project}
          restorePathRequest={restorePathRequest}
          selectedBasemap={selectedBasemap}
          onDraftPathChange={handleDraftPathChange}
          onPathContextMenu={handlePathContextMenu}
        />

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
              aria-label={
                pathEditEnabled
                  ? "Path editing active"
                  : drawingEnabled
                    ? "Path drawing active"
                    : "Draw path"
              }
              aria-pressed={drawingEnabled || pathEditEnabled}
              className={`${iconButtonClass} ${drawingEnabled || pathEditEnabled ? "border-[var(--accent)] text-[var(--accent)]" : ""}`}
              disabled={!project || busy}
              title={pathEditEnabled ? "Finish editing path" : "Draw path"}
              type="button"
              onClick={pathEditEnabled ? handleEndPathEdit : handleStartPath}
            >
              {pathEditEnabled ? (
                <Edit3 aria-hidden="true" className="h-5 w-5" />
              ) : (
                <PencilLine aria-hidden="true" className="h-5 w-5" />
              )}
            </button>
            {drawingEnabled || pathEditEnabled ? (
              <div className="absolute top-full left-0 mt-1 grid w-12 justify-items-center gap-3 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] py-3 shadow-sm backdrop-blur">
                <button
                  aria-label={
                    pathEditEnabled ? "Finish editing path" : "Cancel path"
                  }
                  className="flex h-6 w-6 items-center justify-center text-[var(--danger)] hover:text-[var(--text-primary)]"
                  disabled={busy}
                  title={
                    pathEditEnabled ? "Finish editing path" : "Cancel path"
                  }
                  type="button"
                  onClick={
                    pathEditEnabled ? handleEndPathEdit : handleCancelPath
                  }
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
                        opacity: Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
            ) : null}
          </div>
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
                Path <span className="text-[var(--text-primary)]">A to B</span>
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

        {noticeMessages.length > 0 || error ? (
          <div className="absolute bottom-4 left-1/2 grid w-max max-w-[calc(100%-2rem)] -translate-x-1/2 gap-2 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-sm backdrop-blur">
            {error ? (
              <div className="flex items-center gap-2 text-[var(--danger)]">
                <FileWarning aria-hidden="true" className="h-4 w-4 shrink-0" />
                <p>{error}</p>
              </div>
            ) : null}
            {noticeMessages.map((message) => (
              <div key={message} className="flex items-center gap-2">
                <FileWarning
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-[var(--warning)]"
                />
                <p>{message}</p>
              </div>
            ))}
          </div>
        ) : null}

        {openPopover === "path" && draftPath.length >= 2 ? (
          <>
            <div
              aria-hidden="true"
              className="absolute inset-0 z-10"
              onContextMenu={(event) => {
                event.preventDefault();
                setOpenPopover(null);
                setPathContextPosition(null);
              }}
              onPointerDown={() => {
                setOpenPopover(null);
                setPathContextPosition(null);
              }}
            />
            <div
              className="absolute z-20 grid w-44 gap-1 rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] p-2 text-sm shadow-sm backdrop-blur"
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
          </>
        ) : null}
      </section>

      <section className="relative col-start-1 row-start-2 flex min-h-0 flex-col border-t border-[var(--panel-border)] bg-[var(--panel-bg)]">
        <div
          aria-label="Resize profile panel"
          aria-orientation="horizontal"
          className="absolute -top-1 right-0 left-0 z-20 h-2 cursor-row-resize touch-none bg-transparent hover:bg-[var(--accent)]/30"
          role="separator"
          tabIndex={0}
          title="Resize profile panel"
          onKeyDown={(event) => handleResizeKeyDown("profile", event)}
          onPointerCancel={handleResizePointerEnd}
          onPointerDown={(event) => handleResizePointerDown("profile", event)}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
        />
        <div className="min-h-0 flex-1 px-4">
          <ProfileChart
            elevationUnit={elevationUnit}
            lineOfSightEndpoints={lineOfSightEndpoints}
            lineOfSightDrafts={lineOfSightDrafts}
            points={profilePoints}
            onHoverPoint={setActivePoint}
            onLineOfSightDraftChange={handleLineOfSightDraftChange}
            onLineOfSightDraftCommit={handleLineOfSightDraftCommit}
            onLineOfSightEndpointChange={handleLineOfSightEndpointChange}
          />
        </div>
      </section>

      <aside className="relative col-start-2 row-span-2 flex min-h-0 flex-col border-l border-[var(--panel-border)] bg-[var(--panel-bg)]">
        <div
          aria-label="Resize profile values panel"
          aria-orientation="vertical"
          className="absolute top-0 bottom-0 -left-1 z-20 w-2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--accent)]/30"
          role="separator"
          tabIndex={0}
          title="Resize profile values panel"
          onKeyDown={(event) => handleResizeKeyDown("values", event)}
          onPointerCancel={handleResizePointerEnd}
          onPointerDown={(event) => handleResizePointerDown("values", event)}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
        />
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

/**
 * Format a numeric value using the host locale, limiting to at most three decimal places.
 *
 * @param value - The number to format
 * @returns The localized string representation of `value` with up to three fractional digits
 */
function formatNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function straightPathEndpoints(coordinates: Coordinate[]): Coordinate[] {
  const first = coordinates[0];
  const last = coordinates.at(-1);
  if (!first || !last || coordinates.length < 2) return [];

  return [
    [first[0], first[1]],
    [last[0], last[1]],
  ];
}

function sameCoordinate(a: Coordinate, b: Coordinate): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Format an elevation value to two decimal places for compact chart controls.
 *
 * @param value - Elevation in numeric form
 * @returns The numeric value rounded to two decimal places and returned as a string
 */
function formatElevationInput(value: number): string {
  return value.toFixed(2);
}

/**
 * Create string drafts for line-of-sight endpoint elevations.
 *
 * Converts numeric `startElevation` and `endElevation` to formatted string values suitable
 * for editable inputs; when `endpoints` is `null` returns an empty draft map.
 *
 * @param endpoints - The line-of-sight endpoint elevations or `null` to produce empty drafts
 * @returns Draft string values for `start` and `end` elevations, or empty drafts when `endpoints` is `null`
 */
function formatLineOfSightDrafts(
  endpoints: LineOfSightEndpoints | null,
): LineOfSightDrafts {
  if (!endpoints) return { ...emptyLineOfSightDrafts };
  return {
    start: formatElevationInput(endpoints.startElevation),
    end: formatElevationInput(endpoints.endElevation),
  };
}

/**
 * Parses a user-entered elevation string into a numeric elevation when valid.
 *
 * @param value - The input string from an elevation field; empty or whitespace-only strings are treated as missing.
 * @returns The parsed numeric elevation, or `null` if the input is empty, whitespace, or not a finite number.
 */
function parseElevationDraft(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Create a new LineOfSightEndpoints object with the specified endpoint's elevation updated.
 *
 * @param endpoints - The original endpoints object to copy
 * @param endpointId - Which endpoint to update: `"start"` or `"end"`
 * @param elevation - The elevation value to assign to the chosen endpoint
 * @returns A new `LineOfSightEndpoints` with the chosen endpoint's elevation set to `elevation`
 */
function withLineOfSightEndpoint(
  endpoints: LineOfSightEndpoints,
  endpointId: LineOfSightEndpointId,
  elevation: number,
): LineOfSightEndpoints {
  return endpointId === "start"
    ? { ...endpoints, startElevation: elevation }
    : { ...endpoints, endElevation: elevation };
}

/**
 * Constrains a requested profile panel height to valid bounds based on the current window size.
 *
 * @param height - Desired profile panel height in pixels.
 * @returns The height clamped to be at least `minProfilePanelHeight` and at most `max(minProfilePanelHeight, window.innerHeight - minMapHeight)`.
 */
function clampProfilePanelHeight(height: number): number {
  if (typeof window === "undefined") return height;
  const maxHeight = Math.max(
    minProfilePanelHeight,
    window.innerHeight - minMapHeight,
  );
  return clamp(height, minProfilePanelHeight, maxHeight);
}

/**
 * Clamp a proposed values-panel width to the allowed minimum and a window-dependent maximum.
 *
 * If `window` is unavailable (e.g., server-side), returns the input `width` unchanged.
 *
 * @param width - Desired panel width in pixels
 * @returns The input width constrained to be at least `minValuesPanelWidth` and at most `max(window.innerWidth - minMapColumnWidth, minValuesPanelWidth)`
 */
function clampValuesPanelWidth(width: number): number {
  if (typeof window === "undefined") return width;
  const maxWidth = Math.max(
    minValuesPanelWidth,
    window.innerWidth - minMapColumnWidth,
  );
  return clamp(width, minValuesPanelWidth, maxWidth);
}

/**
 * Constrains a number to lie within the inclusive range defined by `min` and `max`.
 *
 * @param value - The number to constrain
 * @param min - The lower bound (inclusive)
 * @param max - The upper bound (inclusive)
 * @returns The input constrained to be between `min` and `max`, inclusive
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Convert an arbitrary thrown value or error-like object into a human-readable message.
 *
 * @param error - The thrown value or error to convert; may be an `Error` or any other value
 * @returns The error message if `error` is an `Error`, otherwise `String(error)`
 */
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
