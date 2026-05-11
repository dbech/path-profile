const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, ".release-assets");
const gdalSource = path.join(repoRoot, "node_modules", "gdal-async");
const gdalOutput = path.join(outputDir, "node_modules", "gdal-async");
const nodeOutput = path.join(outputDir, "node");
const nodeName = process.platform === "win32" ? "node.exe" : "node";

fs.rmSync(outputDir, { force: true, recursive: true });
fs.mkdirSync(nodeOutput, { recursive: true });
fs.copyFileSync(process.execPath, path.join(nodeOutput, nodeName));

copyDirectory(gdalSource, gdalOutput, shouldCopyGdalRuntimeFile);

/**
 * @param {string} source
 * @param {string} destination
 * @param {(relativePath: string) => boolean} filter
 */
function copyDirectory(source, destination, filter) {
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const relativePath = path.relative(gdalSource, sourcePath);

    if (entry.isDirectory()) {
      if (shouldEnterGdalRuntimeDirectory(relativePath)) {
        copyDirectory(sourcePath, destinationPath, filter);
      }
      continue;
    }

    if (!entry.isFile() || !filter(relativePath)) continue;
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

/**
 * @param {string} relativePath
 */
function shouldEnterGdalRuntimeDirectory(relativePath) {
  const normalized = normalizePath(relativePath);
  if (!normalized || normalized === ".") return true;

  return (
    normalized === "deps" ||
    normalized.startsWith("deps/libcurl") ||
    normalized.startsWith("deps/libgdal") ||
    normalized.startsWith("deps/libproj") ||
    normalized === "lib" ||
    normalized.startsWith("lib/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/")
  );
}

/**
 * @param {string} relativePath
 */
function shouldCopyGdalRuntimeFile(relativePath) {
  const normalized = normalizePath(relativePath);

  if (normalized === "package.json") return true;
  if (normalized.startsWith("lib/")) return true;
  if (normalized.startsWith("node_modules/")) return true;

  return (
    normalized === "deps/libcurl/cacert.pem" ||
    normalized.startsWith("deps/libgdal/gdal/data/") ||
    normalized.startsWith("deps/libgdal/gdal/frmts/grib/data/") ||
    normalized.startsWith("deps/libproj/proj/data/")
  );
}

/**
 * @param {string} filePath
 */
function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}
