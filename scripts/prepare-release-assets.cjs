const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, ".release-assets");
const gdalSource = path.join(repoRoot, "node_modules", "gdal-async");
const nodeModulesOutput = path.join(outputDir, "node_modules");
const gdalOutput = path.join(nodeModulesOutput, "gdal-async");
const nodeOutput = path.join(outputDir, "node");
const nodeName = process.platform === "win32" ? "node.exe" : "node";
const nodeRuntimePath = path.join(nodeOutput, nodeName);
const sourceNodeModules = path.join(repoRoot, "node_modules");
const copiedPackageDestinations = new Map();

fs.rmSync(outputDir, { force: true, recursive: true });
fs.mkdirSync(nodeOutput, { recursive: true });
fs.copyFileSync(process.execPath, nodeRuntimePath);

copyRuntimePackage("gdal-async", gdalSource, shouldCopyGdalRuntimeFile);
copyPackageDependencyClosure("gdal-async", gdalSource);
validatePreparedRuntime();

/**
 * @param {string} packageName
 * @param {string} packageRoot
 */
function copyPackageDependencyClosure(packageName, packageRoot) {
  const packageJson = readPackageJson(packageRoot);
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.optionalDependencies ?? {}),
  };

  for (const dependencyName of Object.keys(dependencies).sort()) {
    const dependencyRoot = resolvePackageRoot(dependencyName, packageRoot);
    if (copyRuntimePackage(dependencyName, dependencyRoot)) {
      copyPackageDependencyClosure(dependencyName, dependencyRoot);
    }
  }
}

/**
 * @param {string} packageName
 * @param {string} packageRoot
 * @param {(relativePath: string) => boolean} [fileFilter]
 * @returns {boolean} true when this package output path was copied for the first time
 */
function copyRuntimePackage(packageName, packageRoot, fileFilter) {
  const packageJson = readPackageJson(packageRoot);
  const destination = destinationForPackageRoot(packageName, packageRoot);
  const previous = copiedPackageDestinations.get(destination);

  if (previous) {
    if (
      previous.packageName !== packageName ||
      previous.sourceRoot !== packageRoot ||
      previous.version !== packageJson.version
    ) {
      throw new Error(
        `${destination} resolved to multiple packages: ${previous.packageName}@${previous.version} at ${previous.sourceRoot} and ${packageName}@${packageJson.version} at ${packageRoot}.`,
      );
    }
    return false;
  }

  copiedPackageDestinations.set(destination, {
    packageName,
    sourceRoot: packageRoot,
    version: packageJson.version,
  });

  copyDirectory(packageRoot, destination, {
    enterDirectory: (relativePath) =>
      fileFilter
        ? shouldEnterGdalRuntimeDirectory(relativePath)
        : shouldEnterRuntimeDirectory(relativePath),
    copyFile: fileFilter ?? shouldCopyRuntimeFile,
  });

  return true;
}

/**
 * @param {string} source
 * @param {string} destination
 * @param {{
 *   enterDirectory: (relativePath: string) => boolean;
 *   copyFile: (relativePath: string) => boolean;
 * }} options
 */
function copyDirectory(source, destination, options, rootSource = source) {
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const relativePath = path.relative(rootSource, sourcePath);

    if (entry.isDirectory()) {
      if (options.enterDirectory(relativePath)) {
        copyDirectory(sourcePath, destinationPath, options, rootSource);
      }
      continue;
    }

    if (!entry.isFile() || !options.copyFile(relativePath)) continue;
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
function shouldEnterRuntimeDirectory(relativePath) {
  const normalized = normalizePath(relativePath);
  if (!normalized || normalized === ".") return true;

  const directoryName = path.posix.basename(normalized);
  return directoryName !== ".bin" && directoryName !== ".cache";
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
 * @param {string} relativePath
 */
function shouldCopyRuntimeFile(relativePath) {
  const normalized = normalizePath(relativePath);
  return !normalized.split("/").some((part) => part === ".cache");
}

/**
 * @param {string} packageRoot
 */
function readPackageJson(packageRoot) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

/**
 * @param {string} packageName
 * @param {string} packageRoot
 */
function destinationForPackageRoot(packageName, packageRoot) {
  const relativePackageRoot = path.relative(sourceNodeModules, packageRoot);
  if (
    relativePackageRoot &&
    !relativePackageRoot.startsWith("..") &&
    !path.isAbsolute(relativePackageRoot)
  ) {
    return path.join(nodeModulesOutput, relativePackageRoot);
  }

  return path.join(nodeModulesOutput, packageName);
}

/**
 * @param {string} packageName
 * @param {string} packageRoot
 */
function resolvePackageRoot(packageName, packageRoot) {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [packageRoot, repoRoot],
    });
    return path.dirname(packageJsonPath);
  } catch (error) {
    if (
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
      )
    ) {
      throw error;
    }
  }

  const packageJsonPath = findPackageJson(packageName, [packageRoot, repoRoot]);
  if (!packageJsonPath) {
    throw new Error(`Could not resolve ${packageName} from ${packageRoot}.`);
  }
  return path.dirname(packageJsonPath);
}

/**
 * @param {string} packageName
 * @param {string[]} startRoots
 */
function findPackageJson(packageName, startRoots) {
  const checked = new Set();

  for (const startRoot of startRoots) {
    let current = path.resolve(startRoot);

    while (true) {
      const candidate = path.join(
        current,
        "node_modules",
        packageName,
        "package.json",
      );
      if (!checked.has(candidate)) {
        checked.add(candidate);
        if (fs.existsSync(candidate)) return candidate;
      }

      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  return undefined;
}

function validatePreparedRuntime() {
  runPreparedRuntimeCheck(["-e", "require('gdal-async')"], "load gdal-async");

  const workerPath = path.join(repoRoot, "dist-electron", "raster-worker.cjs");
  if (fs.existsSync(workerPath)) {
    runPreparedRuntimeCheck([workerPath], "start raster worker");
  }
}

/**
 * @param {string[]} args
 * @param {string} description
 */
function runPreparedRuntimeCheck(args, description) {
  const result = spawnSync(nodeRuntimePath, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_PATH: nodeModulesOutput,
    },
    timeout: 10_000,
  });

  if (result.error) {
    throw new Error(
      `Failed to ${description} with prepared runtime: ${result.error.message}`,
    );
  }

  if (result.status !== 0 || result.signal) {
    throw new Error(
      [
        `Failed to ${description} with prepared runtime.`,
        `Exit status: ${result.status ?? "none"}`,
        `Signal: ${result.signal ?? "none"}`,
        `stdout:\n${result.stdout || ""}`,
        `stderr:\n${result.stderr || ""}`,
      ].join("\n"),
    );
  }
}

/**
 * @param {string} filePath
 */
function normalizePath(filePath) {
  return filePath.split(path.sep).join("/");
}
