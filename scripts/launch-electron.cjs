const { spawn } = require("node:child_process");
/** @type {unknown} */
const electronModule = require("electron");
/** @type {string | undefined} */
const electron =
  typeof electronModule === "string"
    ? electronModule
    : electronModule &&
        typeof electronModule === "object" &&
        "default" in electronModule &&
        typeof electronModule.default === "string"
      ? electronModule.default
      : undefined;

if (typeof electron !== "string") {
  throw new Error("Could not resolve the Electron executable path.");
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

/** @type {import("node:child_process").ChildProcess} */
const child = spawn(electron, process.argv.slice(2), {
  env,
  stdio: "inherit",
  windowsHide: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
