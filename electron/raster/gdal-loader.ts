import path from "node:path";
import { randomUUID } from "node:crypto";
import * as gdal from "gdal-async";
import type { RasterBand, SpatialReference } from "gdal-async";
import type { DsmProjectSummary } from "../../src/types/path-profile";
import {
  assertNorthUpGeoTransform,
  extentFromGeoTransform,
  extentsOverlap,
  mergeExtents,
} from "./geo";
import {
  registerProject,
  type DsmFile,
  type DsmProject,
} from "./project-registry";

type Stats = {
  min: number;
  max: number;
  mean?: number;
  std_dev?: number;
};

type GdalUnitInfo = {
  units?: string;
  value?: number;
};

type SpatialReferenceWithUnits = SpatialReference & {
  getAngularUnits?: () => GdalUnitInfo;
  getLinearUnits?: () => GdalUnitInfo;
};

export async function loadDsmProject(
  paths: string[],
): Promise<DsmProjectSummary> {
  const filePaths = [...new Set(paths)].filter(Boolean);
  if (filePaths.length === 0) {
    throw new Error("Choose at least one GeoTIFF DSM file.");
  }

  const projectId = `dsm-${randomUUID()}`;
  const openedFiles: DsmFile[] = [];

  try {
    const firstDataset = gdal.open(filePaths[0]!, "r");
    const firstBand = firstDataset.bands.get(1);
    const firstSrs = firstDataset.srs;
    const epsg = epsgCode(firstSrs);
    const projection = epsg ?? `DSM:${projectId}`;
    const firstFile = openDsmFile(
      filePaths[0]!,
      firstDataset,
      firstBand,
      firstSrs,
      projectId,
      projection,
    );

    openedFiles.push(firstFile);

    for (const filePath of filePaths.slice(1)) {
      const dataset = gdal.open(filePath, "r");
      const band = dataset.bands.get(1);
      const srs = dataset.srs;
      const file = openDsmFile(
        filePath,
        dataset,
        band,
        srs,
        projectId,
        projection,
      );

      validateCompatibleFile(firstFile, file);
      openedFiles.push(file);
    }

    const warnings = warningsForProject(openedFiles, firstSrs);
    const stats = openedFiles.map((file) => rasterStats(file.band));
    const projectMin = Math.min(...stats.map((stat) => stat.min));
    const projectMax = Math.max(...stats.map((stat) => stat.max));
    const projectExtent = mergeExtents(
      openedFiles.map((file) => file.extent),
      projection,
    );
    const firstNoData = openedFiles[0]!.nodata;
    const distanceUnit = distanceUnitForSrs(firstSrs);
    const elevationUnit = firstFile.band.unitType || "unknown";
    const elevationMetersPerUnit = metersPerElevationUnit(elevationUnit);

    const summary: DsmProjectSummary = {
      id: projectId,
      files: openedFiles.map(
        ({
          path: _path,
          dataset: _dataset,
          band: _band,
          srs: _srs,
          geoTransform: _gt,
          ...summary
        }) => summary,
      ),
      crsWkt: firstSrs?.toWKT() ?? "",
      epsg,
      distance: distanceUnit,
      extent: projectExtent,
      pixelSize: firstFile.pixelSize,
      elevation: {
        unit: elevationUnit,
        metersPerUnit: elevationMetersPerUnit,
        min: projectMin,
        max: projectMax,
        ...(firstNoData === undefined ? {} : { nodata: firstNoData }),
      },
      warnings,
    };

    const project: DsmProject = {
      summary,
      files: openedFiles,
      sourceSrs: firstSrs,
      isGeographic: firstSrs?.isGeographic() ?? false,
    };

    return registerProject(project);
  } catch (error) {
    for (const file of openedFiles) {
      try {
        file.dataset.close();
      } catch {
        // Ignore cleanup errors after load failure.
      }
    }
    throw error;
  }
}

function openDsmFile(
  filePath: string,
  dataset: gdal.Dataset,
  band: RasterBand,
  srs: SpatialReference | null,
  projectId: string,
  projection: string,
): DsmFile {
  if (dataset.bands.count() < 1) {
    throw new Error(
      `${path.basename(filePath)} does not contain a raster band.`,
    );
  }

  const size = dataset.rasterSize;
  const geoTransform = assertNorthUpGeoTransform(
    dataset.geoTransform,
    path.basename(filePath),
  );
  const extent = extentFromGeoTransform(
    geoTransform,
    size.x,
    size.y,
    projection,
  );
  const nodata = band.noDataValue ?? undefined;

  return {
    id: `${projectId}-${path.basename(filePath)}-${openedFileHash(filePath)}`,
    name: path.basename(filePath),
    path: filePath,
    extent,
    size: { width: size.x, height: size.y },
    pixelSize: { x: geoTransform[1], y: Math.abs(geoTransform[5]) },
    dataType: band.dataType ?? "unknown",
    ...(nodata === undefined ? {} : { nodata }),
    geoTransform,
    dataset,
    band,
    srs,
  };
}

function validateCompatibleFile(reference: DsmFile, candidate: DsmFile): void {
  const fileName = candidate.name;

  if (reference.srs && candidate.srs && !candidate.srs.isSame(reference.srs)) {
    throw new Error(
      `${fileName} uses a different CRS. Mixed CRS DSM mosaics are not supported yet.`,
    );
  }

  if (!reference.srs && candidate.srs) {
    throw new Error(`${fileName} has a CRS but the first DSM file does not.`);
  }

  if (reference.srs && !candidate.srs) {
    throw new Error(`${fileName} does not have a CRS.`);
  }

  if (!nearlyEqual(reference.pixelSize.x, candidate.pixelSize.x)) {
    throw new Error(`${fileName} has a different x pixel size.`);
  }

  if (!nearlyEqual(reference.pixelSize.y, candidate.pixelSize.y)) {
    throw new Error(`${fileName} has a different y pixel size.`);
  }

  if (reference.dataType !== candidate.dataType) {
    throw new Error(`${fileName} has a different raster band data type.`);
  }

  const referenceUnit = reference.band.unitType || "unknown";
  const candidateUnit = candidate.band.unitType || "unknown";
  if (referenceUnit !== candidateUnit) {
    throw new Error(
      `${fileName} has elevation unit ${candidateUnit}; expected ${referenceUnit}.`,
    );
  }
}

function warningsForProject(
  files: DsmFile[],
  sourceSrs: SpatialReference | null,
): string[] {
  const warnings: string[] = [];
  const horizontalUnit = distanceUnitForSrs(sourceSrs);
  const elevationUnit = files[0]?.band.unitType || "unknown";

  if (!sourceSrs) {
    warnings.push(
      "The DSM has no CRS. Distances are reported in raw raster coordinates.",
    );
  } else if (sourceSrs.isGeographic()) {
    warnings.push(
      "The DSM CRS is geographic. Profile distances are reported in degrees, not metres.",
    );
  }

  if (horizontalUnit.metersPerUnit === null) {
    warnings.push(
      "Fresnel zones are hidden because the DSM horizontal unit cannot be converted to metres.",
    );
  }

  if (metersPerElevationUnit(elevationUnit) === null) {
    warnings.push(
      "Fresnel zones are hidden because the DSM elevation unit cannot be converted to metres.",
    );
  }

  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      if (extentsOverlap(files[i]!.extent, files[j]!.extent)) {
        warnings.push(
          `${files[i]!.name} overlaps ${files[j]!.name}; later-selected files take precedence.`,
        );
      }
    }
  }

  const referenceNoData = files[0]?.nodata;
  if (files.some((file) => file.nodata !== referenceNoData)) {
    warnings.push(
      "DSM files use different NoData values; each file's own value is respected.",
    );
  }

  return warnings;
}

function distanceUnitForSrs(sourceSrs: SpatialReference | null): {
  unit: string;
  metersPerUnit: number | null;
} {
  if (!sourceSrs) return { unit: "unknown", metersPerUnit: null };

  const srsWithUnits = sourceSrs as SpatialReferenceWithUnits;
  const unitInfo = sourceSrs.isGeographic()
    ? srsWithUnits.getAngularUnits?.()
    : srsWithUnits.getLinearUnits?.();
  const unit = unitInfo?.units || "unknown";
  const metersPerUnit = sourceSrs.isGeographic()
    ? null
    : finitePositiveOrNull(unitInfo?.value);

  return { unit, metersPerUnit };
}

function metersPerElevationUnit(unit: string): number | null {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "" || normalized === "unknown") return null;

  if (["m", "meter", "meters", "metre", "metres"].includes(normalized)) {
    return 1;
  }

  if (
    [
      "ft",
      "foot",
      "feet",
      "international foot",
      "international feet",
      "us survey foot",
      "us survey feet",
      "survey foot",
      "survey feet",
    ].includes(normalized)
  ) {
    return 0.3048;
  }

  return null;
}

function finitePositiveOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function rasterStats(band: RasterBand): Stats {
  try {
    const stats = band.computeStatistics(true) as Stats;
    if (Number.isFinite(stats.min) && Number.isFinite(stats.max)) {
      return stats;
    }
  } catch {
    // Fall back below.
  }

  const minimum = band.minimum;
  const maximum = band.maximum;
  if (minimum !== null && maximum !== null) {
    return { min: minimum, max: maximum };
  }

  return sampleStats(band);
}

function sampleStats(band: RasterBand): Stats {
  const width = Math.min(512, band.size.x);
  const height = Math.min(512, band.size.y);
  const data = band.pixels.read(
    0,
    0,
    band.size.x,
    band.size.y,
    new Float32Array(width * height),
    {
      buffer_width: width,
      buffer_height: height,
      data_type: "Float32",
      resampling: "nearest",
    },
  );
  const nodata = band.noDataValue;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const value of data) {
    if (!Number.isFinite(value) || isNoDataValue(value, nodata)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  return { min, max };
}

function epsgCode(srs: SpatialReference | null): string | undefined {
  if (!srs) return undefined;

  try {
    const clone = srs.clone();
    clone.autoIdentifyEPSG();
    const authorityName = clone.getAuthorityName(null);
    const authorityCode = clone.getAuthorityCode(null);
    if (authorityName === "EPSG" && authorityCode) {
      return `EPSG:${authorityCode}`;
    }

    const projectedCode = clone.getAuthorityCode("PROJCS");
    if (projectedCode) return `EPSG:${projectedCode}`;

    const geographicCode = clone.getAuthorityCode("GEOGCS");
    if (geographicCode) return `EPSG:${geographicCode}`;
  } catch {
    return undefined;
  }

  return undefined;
}

function isNoDataValue(value: number, nodata: number | null): boolean {
  if (nodata === null) return false;
  if (Number.isNaN(nodata)) return Number.isNaN(value);
  return value === nodata;
}

function nearlyEqual(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 1e-9;
}

function openedFileHash(filePath: string): string {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    hash = (hash * 31 + filePath.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}
