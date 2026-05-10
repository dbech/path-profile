"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Feature from "ol/Feature";
import Map from "ol/Map";
import View from "ol/View";
import { defaults as defaultControls } from "ol/control/defaults";
import Draw from "ol/interaction/Draw";
import Modify from "ol/interaction/Modify";
import Snap from "ol/interaction/Snap";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import { Minus, Plus } from "lucide-react";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Projection from "ol/proj/Projection";
import {
  addProjection,
  get as getProjection,
  getTransformFromProjections,
} from "ol/proj";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import Fill from "ol/style/Fill";
import CircleStyle from "ol/style/Circle";
import Stroke from "ol/style/Stroke";
import Style from "ol/style/Style";
import TileGrid from "ol/tilegrid/TileGrid";
import { type BasemapId, getBasemap } from "~/lib/basemaps";
import type {
  ColorSettings,
  ColorPalette,
  Coordinate,
  DsmProjectSummary,
  ProfilePoint,
} from "~/types/path-profile";
import { hasDesktopBridge } from "~/lib/electron-api";
import { dsmTileResolutions } from "~/lib/tile-grid";

type DsmMapProps = {
  project: DsmProjectSummary | null;
  colorSettings: ColorSettings;
  selectedBasemap: BasemapId;
  drawingEnabled: boolean;
  pathEditEnabled: boolean;
  finishDrawingRequest: number;
  clearPathRequest: number;
  restorePathRequest: number;
  pathToRestore: { coordinates: Coordinate[]; projection: string | null };
  activePoint: ProfilePoint | null;
  onDraftPathChange: (
    coordinates: Coordinate[],
    projection: string,
    changeType: "draw" | "modify",
  ) => void;
  onPathContextMenu: (position: { x: number; y: number }) => void;
};

type DsmRenderSettings = {
  palette: ColorPalette;
  reverse: boolean;
};

const lineStyle = new Style({
  stroke: new Stroke({ color: "#f6c445", width: 3 }),
});

const editLineStyle = new Style({
  stroke: new Stroke({ color: "#25c2a0", width: 2 }),
});

const markerStyle = new Style({
  image: new CircleStyle({
    radius: 6,
    fill: new Fill({ color: "#f35b5b" }),
    stroke: new Stroke({ color: "#ffffff", width: 2 }),
  }),
});

const basemapProjectionCode = "EPSG:3857";

export function DsmMap({
  project,
  colorSettings,
  selectedBasemap,
  drawingEnabled,
  pathEditEnabled,
  finishDrawingRequest,
  clearPathRequest,
  restorePathRequest,
  pathToRestore,
  activePoint,
  onDraftPathChange,
  onPathContextMenu,
}: DsmMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const dsmLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const basemapLayerRef = useRef<TileLayer<XYZ> | null>(null);
  const colorSettingsRef = useRef(colorSettings);
  const pathSourceRef = useRef(new VectorSource());
  const markerSourceRef = useRef(new VectorSource());
  const drawRef = useRef<Draw | null>(null);
  const modifyRef = useRef<Modify | null>(null);
  const snapRef = useRef<Snap | null>(null);
  const onDraftPathChangeRef = useRef(onDraftPathChange);
  const onPathContextMenuRef = useRef(onPathContextMenu);
  const lastRestorePathRequestRef = useRef(0);

  const projectionCode = useMemo(() => {
    if (!project) return "EPSG:3857";
    return project.extent.projection;
  }, [project]);

  const zoomBy = useCallback((delta: number) => {
    const view = mapRef.current?.getView();
    if (!view) return;
    const zoom = view.getZoom();
    if (zoom === undefined) return;
    view.animate({
      duration: 160,
      zoom: zoom + delta,
    });
  }, []);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const pathLayer = new VectorLayer({
      source: pathSourceRef.current,
      style: (feature) =>
        feature.get("editing") === true ? editLineStyle : lineStyle,
      zIndex: 20,
    });
    const markerLayer = new VectorLayer({
      source: markerSourceRef.current,
      style: markerStyle,
      zIndex: 30,
    });
    const map = new Map({
      target: mapElementRef.current,
      controls: defaultControls({
        attribution: false,
        rotate: false,
        zoom: false,
      }),
      layers: [pathLayer, markerLayer],
      view: new View({
        projection: basemapProjectionCode,
        center: [0, 0],
        zoom: 2,
      }),
    });

    mapRef.current = map;

    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    colorSettingsRef.current = colorSettings;
  }, [colorSettings]);

  useEffect(() => {
    onDraftPathChangeRef.current = onDraftPathChange;
  }, [onDraftPathChange]);

  useEffect(() => {
    onPathContextMenuRef.current = onPathContextMenu;
  }, [onPathContextMenu]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !project) return;

    registerProjectProjection(project);
    pathSourceRef.current.clear();
    markerSourceRef.current.clear();

    if (drawRef.current) map.removeInteraction(drawRef.current);
    if (modifyRef.current) map.removeInteraction(modifyRef.current);
    if (snapRef.current) map.removeInteraction(snapRef.current);

    const dsmLayer = createDsmLayer(project, colorSettingsRef.current);
    if (dsmLayerRef.current) {
      map.removeLayer(dsmLayerRef.current);
    }
    dsmLayerRef.current = dsmLayer;
    map.getLayers().insertAt(0, dsmLayer);

    if (basemapLayerRef.current) {
      map.removeLayer(basemapLayerRef.current);
      basemapLayerRef.current = null;
    }

    const dsmResolutions = dsmTileResolutions(
      project.extent,
      project.pixelSize,
    );
    const resolutions = zoomOutResolutions(dsmResolutions);
    const projection = getProjection(projectionCode) ?? projectionCode;
    const view = new View({
      projection,
      resolutions,
      center: [
        (project.extent.minX + project.extent.maxX) / 2,
        (project.extent.minY + project.extent.maxY) / 2,
      ],
      zoom: resolutions.length > dsmResolutions.length ? 2 : 0,
      extent: [
        project.extent.minX,
        project.extent.minY,
        project.extent.maxX,
        project.extent.maxY,
      ],
      showFullExtent: true,
    });
    map.setView(view);
    view.fit(
      [
        project.extent.minX,
        project.extent.minY,
        project.extent.maxX,
        project.extent.maxY,
      ],
      { padding: [40, 40, 40, 40], nearest: true },
    );

    const draw = new Draw({
      source: pathSourceRef.current,
      type: "LineString",
      style: editLineStyle,
    });
    draw.on("drawstart", () => {
      pathSourceRef.current.clear();
      markerSourceRef.current.clear();
    });
    draw.on("drawend", (event) => {
      const geometry = event.feature.getGeometry();
      if (geometry instanceof LineString) {
        event.feature.set("path", true);
        onDraftPathChangeRef.current(
          geometry.getCoordinates() as Coordinate[],
          projectionCode,
          "draw",
        );
      }
    });
    draw.setActive(false);

    const modify = new Modify({ source: pathSourceRef.current });
    modify.on("modifyend", () => {
      const feature = pathSourceRef.current.getFeatures()[0];
      const geometry = feature?.getGeometry();
      if (geometry instanceof LineString) {
        onDraftPathChangeRef.current(
          geometry.getCoordinates() as Coordinate[],
          projectionCode,
          "modify",
        );
      }
    });
    modify.setActive(false);

    const snap = new Snap({ source: pathSourceRef.current });
    snap.setActive(false);
    drawRef.current = draw;
    modifyRef.current = modify;
    snapRef.current = snap;
    map.addInteraction(modify);
    map.addInteraction(draw);
    map.addInteraction(snap);
    setTimeout(() => map.updateSize(), 0);
  }, [project, projectionCode]);

  useEffect(() => {
    drawRef.current?.setActive(drawingEnabled);
    snapRef.current?.setActive(drawingEnabled || pathEditEnabled);
    modifyRef.current?.setActive(pathEditEnabled && !drawingEnabled);
  }, [drawingEnabled, pathEditEnabled]);

  useEffect(() => {
    if (finishDrawingRequest === 0) return;
    const draw = drawRef.current;
    if (!draw?.getActive()) return;

    try {
      draw.finishDrawing();
    } catch {
      // OpenLayers throws if there are not enough points to finish the sketch.
    }
  }, [finishDrawingRequest]);

  useEffect(() => {
    if (clearPathRequest === 0) return;
    pathSourceRef.current.clear();
    markerSourceRef.current.clear();
  }, [clearPathRequest]);

  useEffect(() => {
    if (restorePathRequest === 0) return;
    if (lastRestorePathRequestRef.current === restorePathRequest) return;
    lastRestorePathRequestRef.current = restorePathRequest;
    pathSourceRef.current.clear();
    markerSourceRef.current.clear();
    if (pathToRestore.coordinates.length < 2) return;
    pathSourceRef.current.addFeature(
      createPathFeature(pathToRestore.coordinates),
    );
  }, [pathToRestore, restorePathRequest]);

  useEffect(() => {
    const map = mapRef.current;
    const element = map?.getViewport();
    if (!map || !element) return;

    const handleContextMenu = (event: MouseEvent) => {
      const pixel = map.getEventPixel(event);
      let pathHit = false;
      map.forEachFeatureAtPixel(pixel, (feature) => {
        if (feature.get("path") === true) {
          pathHit = true;
          return true;
        }
        return undefined;
      });

      if (!pathHit) return;
      event.preventDefault();
      onPathContextMenuRef.current({ x: event.clientX, y: event.clientY });
    };

    element.addEventListener("contextmenu", handleContextMenu);
    return () => element.removeEventListener("contextmenu", handleContextMenu);
  }, [project]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !project || !dsmLayerRef.current) return;

    const nextLayer = createDsmLayer(project, {
      palette: colorSettings.palette,
      reverse: colorSettings.reverse,
    });
    const layers = map.getLayers();
    const currentIndex = layers.getArray().indexOf(dsmLayerRef.current);
    layers.setAt(Math.max(0, currentIndex), nextLayer);
    dsmLayerRef.current = nextLayer;
    nextLayer.setOpacity(colorSettingsRef.current.opacity);
  }, [project, colorSettings.palette, colorSettings.reverse]);

  useEffect(() => {
    dsmLayerRef.current?.setOpacity(colorSettings.opacity);
  }, [colorSettings.opacity]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (basemapLayerRef.current) {
      map.removeLayer(basemapLayerRef.current);
      basemapLayerRef.current = null;
    }

    if (
      selectedBasemap === "none" ||
      !hasBasemapTransform(project?.extent.projection)
    ) {
      return;
    }

    const basemapLayer = createBasemapLayer(selectedBasemap);
    basemapLayerRef.current = basemapLayer;
    map.getLayers().insertAt(0, basemapLayer);
  }, [project, selectedBasemap]);

  useEffect(() => {
    markerSourceRef.current.clear();
    if (!activePoint) return;

    markerSourceRef.current.addFeature(
      new Feature({
        geometry: new Point([activePoint.x, activePoint.y]),
      }),
    );
  }, [activePoint]);

  return (
    <>
      <div ref={mapElementRef} className="h-full w-full" />
      <div className="absolute top-4 right-4 z-10 flex overflow-hidden rounded border border-[var(--overlay-border)] bg-[var(--overlay-bg)] text-[var(--text-primary)] shadow-sm backdrop-blur">
        <button
          aria-label="Zoom in"
          className="flex h-12 w-12 items-center justify-center border-r border-[var(--overlay-border)] text-xl leading-none hover:bg-[var(--control-bg-hover)]"
          title="Zoom in"
          type="button"
          onClick={() => zoomBy(1)}
        >
          <Plus aria-hidden="true" className="h-5 w-5" />
        </button>
        <button
          aria-label="Zoom out"
          className="flex h-12 w-12 items-center justify-center text-xl leading-none hover:bg-[var(--control-bg-hover)]"
          title="Zoom out"
          type="button"
          onClick={() => zoomBy(-1)}
        >
          <Minus aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
    </>
  );
}

function registerProjectProjection(project: DsmProjectSummary): void {
  if (getProjection(project.extent.projection)) return;

  addProjection(
    new Projection({
      code: project.extent.projection,
      extent: [
        project.extent.minX,
        project.extent.minY,
        project.extent.maxX,
        project.extent.maxY,
      ],
      global: false,
      units: project.epsg === "EPSG:4326" ? "degrees" : "m",
    }),
  );
}

function hasBasemapTransform(viewProjectionCode: string | undefined): boolean {
  if (!viewProjectionCode) return true;

  const basemapProjection = getProjection(basemapProjectionCode);
  const viewProjection = getProjection(viewProjectionCode);
  if (!basemapProjection || !viewProjection) return false;

  return (
    getTransformFromProjections(basemapProjection, viewProjection) !== null
  );
}

function createDsmLayer(
  project: DsmProjectSummary,
  colorSettings: DsmRenderSettings,
): TileLayer<XYZ> {
  const resolutions = dsmTileResolutions(project.extent, project.pixelSize);
  const tileGrid = new TileGrid({
    extent: [
      project.extent.minX,
      project.extent.minY,
      project.extent.maxX,
      project.extent.maxY,
    ],
    origin: [project.extent.minX, project.extent.maxY],
    resolutions,
    tileSize: 256,
  });
  const min = project.elevation.min;
  const max = project.elevation.max;
  const source = new XYZ({
    crossOrigin: "anonymous",
    projection: project.extent.projection,
    tileGrid,
    tileUrlFunction: (tileCoord) => {
      if (!tileCoord) return "";
      const [z, x, y] = tileCoord;
      const search = new URLSearchParams({
        projectId: project.id,
        palette: colorSettings.palette,
        min: String(min),
        max: String(max),
        reverse: String(colorSettings.reverse),
      });
      if (hasDesktopBridge()) {
        search.delete("projectId");
        return `dsm-tile://tile/${project.id}/${z}/${x}/${y}.png?${search.toString()}`;
      }

      search.set("z", String(z));
      search.set("x", String(x));
      search.set("y", String(y));
      return `/api/dsm/tile?${search.toString()}`;
    },
  });

  return new TileLayer({
    source,
    zIndex: 10,
  });
}

function zoomOutResolutions(resolutions: number[]): number[] {
  const baseResolution = resolutions[0];
  if (!baseResolution) return resolutions;
  return [
    baseResolution * 32,
    baseResolution * 16,
    baseResolution * 8,
    baseResolution * 4,
    baseResolution * 2,
    ...resolutions,
  ];
}

function createPathFeature(coordinates: Coordinate[]): Feature<LineString> {
  return new Feature({
    geometry: new LineString(coordinates),
    path: true,
  });
}

function createBasemapLayer(basemapId: BasemapId): TileLayer<XYZ> {
  const basemap = getBasemap(basemapId);
  const source = new XYZ({
    attributions: basemap.attribution,
    crossOrigin: "anonymous",
    maxZoom: basemap.maxZoom,
    projection: basemapProjectionCode,
    tileUrlFunction: (tileCoord) => {
      if (!tileCoord || basemap.source === "none") return "";

      const [z, x, y] = tileCoord;
      if (basemap.source === "arcgis") {
        return `${basemap.url}/tile/${z}/${y}/${x}`;
      }

      return basemap.url
        .replace("{z}", String(z))
        .replace("{x}", String(x))
        .replace("{y}", String(y));
    },
  });

  return new TileLayer({
    source,
    zIndex: 0,
  });
}
