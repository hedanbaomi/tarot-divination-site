import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const androidWebRoot = path.join(repoRoot, "android-demo", "app", "src", "main", "assets", "www");

// This is the complete shared-file allow-list. Platform-owned HTML and i18n
// remain separate because the Android menu/native chrome is not web-owned.
export const SHARED_FILES = Object.freeze([
  { source: "js/announcements.js", target: "js/announcements.js" }
]);

// These paths are a hard exclusion, not a best-effort filter. The script never
// enumerates or copies an Android card/data/native implementation directory.
export const EXCLUDED_PATH_PREFIXES = Object.freeze([
  "android-demo/app/src/main/assets/qv",
  "android-demo/app/src/main/assets/www/js/lxxxi-data.js",
  "android-demo/app/src/main/assets/www/assets/cards/LXXXI_SOURCE.md",
  "android-demo/app/src/main/java/com/quareia/divination/LxxxiVault.kt",
  ".private",
  ".local-backups",
  "占卜小程序"
]);

function normalized(relativePath) {
  return relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isExcluded(relativePath) {
  const value = normalized(relativePath);
  return EXCLUDED_PATH_PREFIXES.some((prefix) => value === prefix || value.startsWith(prefix + "/"));
}

function assertManifestSafe() {
  for (const entry of SHARED_FILES) {
    const source = normalized(entry.source);
    const target = normalized(path.posix.join("android-demo/app/src/main/assets/www", entry.target));
    if (isExcluded(source) || isExcluded(target)) {
      throw new Error(`shared announcement manifest enters an excluded path: ${source} -> ${target}`);
    }
  }
}

function sourcePath(entry) {
  return path.join(repoRoot, entry.source);
}

function targetPath(entry) {
  return path.join(androidWebRoot, entry.target);
}

function equalBytes(left, right) {
  return Buffer.compare(readFileSync(left), readFileSync(right)) === 0;
}

export function checkSync() {
  assertManifestSafe();
  const drift = [];
  for (const entry of SHARED_FILES) {
    const source = sourcePath(entry);
    const target = targetPath(entry);
    if (!existsSync(source)) throw new Error(`missing source: ${entry.source}`);
    if (!existsSync(target) || !equalBytes(source, target)) drift.push(entry);
  }
  return drift;
}

export function syncFiles() {
  assertManifestSafe();
  for (const entry of SHARED_FILES) {
    const source = sourcePath(entry);
    const target = targetPath(entry);
    if (!existsSync(source)) throw new Error(`missing source: ${entry.source}`);
    mkdirSync(path.dirname(target), { recursive: true });
    if (!existsSync(target) || !equalBytes(source, target)) copyFileSync(source, target);
  }
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    const drift = checkSync();
    if (drift.length) {
      console.error("Public announcement asset drift:");
      drift.forEach((entry) => console.error(`- ${entry.source} -> android-demo/app/src/main/assets/www/${entry.target}`));
      process.exitCode = 1;
    } else {
      console.log("Public announcement assets are in sync.");
    }
  } else {
    syncFiles();
    console.log("Synchronized the audited public announcement assets.");
  }
}
