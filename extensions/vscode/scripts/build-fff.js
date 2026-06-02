#!/usr/bin/env node
/**
 * Builds the fff-c shared library for the current platform and copies it
 * to the extension's bin/ directory.
 *
 * Usage: node scripts/build-fff.js [--release]
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const EXT_DIR = path.resolve(__dirname, "..");
const release = process.argv.includes("--release");
const profile = release ? "release" : "release"; // always release for performance

function platformKey() {
  const p = os.platform();
  const a = os.arch();
  if (p === "darwin" && a === "arm64") return "darwin-arm64";
  if (p === "darwin" && a === "x64") return "darwin-x64";
  if (p === "linux" && a === "x64") return "linux-x64";
  if (p === "win32" && a === "x64") return "win32-x64";
  throw new Error(`Unsupported platform: ${p}-${a}`);
}

function libName() {
  if (os.platform() === "win32") return "fff_c.dll";
  if (os.platform() === "darwin") return "libfff_c.dylib";
  return "libfff_c.so";
}

function main() {
  const key = platformKey();
  const lib = libName();

  console.log(`Building fff-c (${profile}) for ${key}...`);

  execSync(`cargo build --profile ${profile} -p fff-c`, {
    cwd: ROOT,
    stdio: "inherit",
  });

  const srcPath = path.join(ROOT, "target", profile, lib);
  const destDir = path.join(EXT_DIR, "bin", key);
  const destPath = path.join(destDir, lib);

  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(srcPath, destPath);

  // Make executable on non-Windows
  if (os.platform() !== "win32") {
    fs.chmodSync(destPath, 0o755);
  }

  console.log(`Copied ${lib} → bin/${key}/${lib}`);
  console.log("Done.");
}

main();
