"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Feature, { type FeatureLike } from "ol/Feature";
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
import Icon from "ol/style/Icon";
import Stroke from "ol/style/Stroke";
import Style, { type StyleFunction } from "ol/style/Style";
import TileGrid from "ol/tilegrid/TileGrid";
import { type BasemapId, getBasemap } from "~/lib/basemaps";
import type {
  ColorSettings,
  ColorPalette,
  Coordinate,
  DsmProjectSummary,
  ProfilePoint,
} from "~/types/path-profile";
import { dsmTileResolutions } from "~/lib/tile-grid";

type DsmMapProps = {
  project: DsmProjectSummary | null;
  colorSettings: ColorSettings;
  selectedBasemap: BasemapId;
  drawingEnabled: boolean;
  pathEditEnabled: boolean;
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

const endpointColors: Record<"A" | "B", string> = {
  A: "#157b68",
  B: "#c93d4b",
};
const endpointBadgeSize = 18;

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

const pathEndpointStyles = [
  createEndpointLabelStyle("A", endpointColors.A, "start"),
  createEndpointLabelStyle("B", endpointColors.B, "end"),
];

const normalPathStyles = [lineStyle, ...pathEndpointStyles];
const editingPathStyles = [editLineStyle, ...pathEndpointStyles];

const endpointLabelStyles: Record<"A" | "B", Style> = {
  A: createEndpointLabelStyle("A", endpointColors.A),
  B: createEndpointLabelStyle("B", endpointColors.B),
};

const hiddenModifyStyle: StyleFunction = () => undefined;
const basemapProjectionCode = "EPSG:3857";

export function DsmMap({
  project,
  colorSettings,
  selectedBasemap,
  drawingEnabled,
  pathEditEnabled,
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
  const sketchEndpointSourceRef = useRef(new VectorSource());
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
      style: pathFeatureStyle,
      zIndex: 20,
    });
    const markerLayer = new VectorLayer({
      source: markerSourceRef.current,
      style: markerStyle,
      zIndex: 40,
    });
    const sketchEndpointLayer = new VectorLayer({
      source: sketchEndpointSourceRef.current,
      style: endpointLabelStyle,
      zIndex: 30,
    });
    const map = new Map({
      target: mapElementRef.current,
      controls: defaultControls({
        attribution: false,
        rotate: false,
        zoom: false,
      }),
      layers: [pathLayer, sketchEndpointLayer, markerLayer],
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
    sketchEndpointSourceRef.current.clear();
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
      minPoints: 2,
      maxPoints: 2,
      style: editingPathStyles,
    });
    draw.on("drawstart", (event) => {
      pathSourceRef.current.clear();
      sketchEndpointSourceRef.current.clear();
      markerSourceRef.current.clear();

      const geometry = event.feature.getGeometry();
      if (geometry instanceof LineString) {
        const start = geometry.getCoordinates()[0] as Coordinate | undefined;
        if (start) {
          updateEndpointLabels(sketchEndpointSourceRef.current, [start]);
        }
      }
    });
    draw.on("drawend", (event) => {
      const geometry = event.feature.getGeometry();
      if (geometry instanceof LineString) {
        const coordinates = straightPathEndpoints(
          geometry.getCoordinates() as Coordinate[],
        );
        if (coordinates.length < 2) return;

        geometry.setCoordinates(coordinates);
        event.feature.set("path", true);
        sketchEndpointSourceRef.current.clear();
        onDraftPathChangeRef.current(coordinates, projectionCode, "draw");
      }
    });
    draw.setActive(false);

    const modify = new Modify({
      source: pathSourceRef.current,
      insertVertexCondition: () => false,
      deleteCondition: () => false,
      pixelTolerance: 16,
      style: hiddenModifyStyle,
    });
    modify.on("modifyend", () => {
      const feature = pathSourceRef.current.getFeatures()[0];
      const geometry = feature?.getGeometry();
      if (geometry instanceof LineString) {
        const coordinates = straightPathEndpoints(
          geometry.getCoordinates() as Coordinate[],
        );
        if (coordinates.length < 2) return;

        geometry.setCoordinates(coordinates);
        onDraftPathChangeRef.current(coordinates, projectionCode, "modify");
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
    for (const feature of pathSourceRef.current.getFeatures()) {
      feature.set("editing", pathEditEnabled);
    }
  }, [pathEditEnabled]);

  useEffect(() => {
    if (clearPathRequest === 0) return;
    pathSourceRef.current.clear();
    sketchEndpointSourceRef.current.clear();
    markerSourceRef.current.clear();
  }, [clearPathRequest]);

  useEffect(() => {
    if (restorePathRequest === 0) return;
    if (lastRestorePathRequestRef.current === restorePathRequest) return;
    lastRestorePathRequestRef.current = restorePathRequest;
    pathSourceRef.current.clear();
    sketchEndpointSourceRef.current.clear();
    markerSourceRef.current.clear();
    if (pathToRestore.coordinates.length < 2) return;
    const coordinates = straightPathEndpoints(pathToRestore.coordinates);
    if (coordinates.length < 2) return;
    pathSourceRef.current.addFeature(createPathFeature(coordinates));
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
        palette: colorSettings.palette,
        min: String(min),
        max: String(max),
        reverse: String(colorSettings.reverse),
      });
      return `dsm-tile://tile/${project.id}/${z}/${x}/${y}.png?${search.toString()}`;
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

function pathFeatureStyle(feature: FeatureLike): Style[] {
  return feature.get("editing") === true ? editingPathStyles : normalPathStyles;
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

function updateEndpointLabels(
  source: VectorSource,
  coordinates: Coordinate[],
): void {
  source.clear();

  const first = coordinates[0];
  if (first) {
    source.addFeature(createEndpointFeature("A", first));
  }

  const last = coordinates.at(-1);
  if (last && coordinates.length >= 2) {
    source.addFeature(createEndpointFeature("B", last));
  }
}

function createEndpointFeature(label: "A" | "B", coordinate: Coordinate) {
  const feature = new Feature({
    geometry: new Point(coordinate),
  });
  feature.set("endpointLabel", label);
  return feature;
}

function endpointLabelStyle(feature: FeatureLike): Style {
  const label = feature.get("endpointLabel") === "B" ? "B" : "A";
  return endpointLabelStyles[label];
}

function createEndpointLabelStyle(
  label: "A" | "B",
  color: string,
  endpoint?: "start" | "end",
): Style {
  return new Style({
    geometry: endpoint ? endpointGeometry(endpoint) : undefined,
    image: new Icon({
      src: createEndpointBadgeDataUrl(label, color),
    }),
  });
}

function createEndpointBadgeDataUrl(label: "A" | "B", color: string): string {
  const center = endpointBadgeSize / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${endpointBadgeSize}" height="${endpointBadgeSize}" viewBox="0 0 ${endpointBadgeSize} ${endpointBadgeSize}"><rect width="${endpointBadgeSize}" height="${endpointBadgeSize}" rx="2" fill="${color}"/><text x="${center}" y="${center + 3}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="600" fill="#ffffff">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function endpointGeometry(endpoint: "start" | "end") {
  return (feature: FeatureLike) => {
    const geometry = feature.getGeometry();
    if (!(geometry instanceof LineString)) return undefined;

    const coordinates = geometry.getCoordinates();
    const coordinate =
      endpoint === "start" ? coordinates[0] : coordinates.at(-1);
    return coordinate ? new Point(coordinate) : undefined;
  };
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
