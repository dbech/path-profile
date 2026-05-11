export type BasemapId =
  | "none"
  | "osm-standard"
  | "wikimedia-osm"
  | "esri-world-imagery"
  | "esri-world-topographic";

export type BasemapDefinition = {
  id: BasemapId;
  label: string;
  group: string;
  source: "none" | "xyz" | "arcgis";
  url: string;
  attribution: string;
  maxZoom?: number;
  caveat?: string;
};

export const defaultBasemap: BasemapId = "osm-standard";

export const basemaps: BasemapDefinition[] = [
  {
    id: "none",
    label: "None",
    group: "None",
    source: "none",
    url: "",
    attribution: "",
  },
  {
    id: "osm-standard",
    label: "OSM Standard",
    group: "OpenStreetMap",
    source: "xyz",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19,
    caveat: "Public fair-use tile service.",
  },
  {
    id: "wikimedia-osm",
    label: "Wikimedia",
    group: "Wikimedia",
    source: "xyz",
    url: "https://maps.wikimedia.org/osm-intl/{z}/{x}/{y}.png?lang=en",
    attribution: "&copy; Wikimedia maps, &copy; OpenStreetMap contributors",
    maxZoom: 19,
    caveat: "Public service with limited usage.",
  },
  {
    id: "esri-world-imagery",
    label: "ESRI World Imagery",
    group: "ESRI",
    source: "arcgis",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
  },
  {
    id: "esri-world-topographic",
    label: "ESRI World Topographic",
    group: "ESRI",
    source: "arcgis",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer",
    attribution: "Tiles &copy; Esri",
    maxZoom: 19,
  },
];

export function getBasemap(id: BasemapId): BasemapDefinition {
  return basemaps.find((basemap) => basemap.id === id) ?? basemaps[0]!;
}
