// SPDX-License-Identifier: MPL-2.0
// Explicit Git objects plus an allowlisted iOS overlay: no recursive working tree copy or private inputs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'ios-app/web-assets.json')));
const dest = path.join(root, 'ios-app/Quareia/Resources/www');
const check = process.argv.includes('--check');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

if (manifest.schema !== 3) throw Error('Unsupported web asset manifest schema');
if (!/^[a-f0-9]{40}$/.test(manifest.sourceCommit)) throw Error('Invalid source commit');
const buildSourceCommit = git(['rev-parse', 'HEAD']);
if (!/^[a-f0-9]{40}$/.test(buildSourceCommit)) throw Error('Invalid build source commit');

function replaceExact(input, search, replacement, label, expectedCount = 1) {
  const count = input.split(search).length - 1;
  if (count !== expectedCount) throw Error(`Transform assertion failed (${label}): expected ${expectedCount}, got ${count}`);
  return input.split(search).join(replacement);
}

function replacePattern(input, pattern, replacement, label, expectedCount) {
  const matches = input.match(pattern) || [];
  if (matches.length !== expectedCount) throw Error(`Transform assertion failed (${label}): expected ${expectedCount}, got ${matches.length}`);
  return input.replace(pattern, replacement);
}

function transformSource(assetPath, sourceText) {
  let output = sourceText.replace(/\r\n/g, '\n');
  const transformations = ['LF normalization'];
  const apply = (search, replacement, label, expectedCount = 1) => {
    output = replaceExact(output, search, replacement, label, expectedCount);
    transformations.push(label);
  };

  if (assetPath === 'index.html') {
    apply('  <script src="js/announcements.js?v=1"></script>\n', '', 'omit Android announcements bootstrap');
    apply('  <script src="js/telemetry-notice.js?v=20260731-system-locale"></script>\n', '', 'omit Android telemetry notice');
    apply('<head>', '<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; connect-src \'none\'; frame-src \'none\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">', 'offline CSP');
    output = replacePattern(output, /\?v=[^"\s]+/g, '', 'remove HTML cache queries', 20);
    transformations.push('remove HTML cache queries');
    apply('  <script src="js/theme.js"></script>', '  <script src="js/ios-native-adapter.js"></script>\n  <script src="js/theme.js"></script>', 'load iOS native adapter before theme');
    apply('  <script src="js/history-ui.js"></script>', '  <script src="js/ios-backup.js"></script>\n  <script src="js/history-ui.js"></script>', 'load validated backup recovery before history UI');
  }

  if (assetPath === 'js/theme.js') {
    apply(
      '      if (global.androidThemeChrome && typeof global.androidThemeChrome.set === "function") {\n        global.androidThemeChrome.set(color, id === "parchment" ? "1" : "0");\n      }',
      '      if (global.QuareiaIOS && typeof global.QuareiaIOS.setTheme === "function") {\n        global.QuareiaIOS.setTheme(id);\n      }',
      'route theme chrome through QuareiaNative'
    );
    apply('  function setTheme(nextTheme) {\n    if (THEMES.indexOf(nextTheme) === -1 || nextTheme === theme) return false;', '  function setTheme(nextTheme) {\n    if (global.DivinationBackup && global.DivinationBackup.isMutating()) return false;\n    if (THEMES.indexOf(nextTheme) === -1 || nextTheme === theme) return false;', 'block theme writes during backup transaction');
  }

  if (assetPath === 'js/i18n.js') {
    apply('  function syncNativeLocale() {\n    if (!hasStoredLocale()) return;', '  function syncNativeLocale() {', 'sync first-launch system locale to iOS native surfaces');
    apply(
      '    if (global.androidAbout && typeof global.androidAbout.setLocale === "function") {\n      global.androidAbout.setLocale(locale);\n    }',
      '    if (global.QuareiaIOS && typeof global.QuareiaIOS.setLocale === "function") {\n      global.QuareiaIOS.setLocale(locale);\n    }',
      'route locale through QuareiaNative'
    );
    apply('  function setLocale(nextLocale) {\n    if (supported.indexOf(nextLocale) === -1 || nextLocale === locale) return false;', '  function setLocale(nextLocale) {\n    if (global.DivinationBackup && global.DivinationBackup.isMutating()) return false;\n    if (supported.indexOf(nextLocale) === -1 || nextLocale === locale) return false;', 'block locale writes during backup transaction');
  }

  if (assetPath === 'js/menu.js') {
    apply(
      '    if (global.androidAbout && typeof global.androidAbout.open === "function") {\n      global.androidAbout.open();\n    }',
      '    if (global.QuareiaIOS && typeof global.QuareiaIOS.presentAbout === "function") {\n      global.QuareiaIOS.presentAbout();\n    }',
      'route About through QuareiaNative'
    );
  }

  if (assetPath === 'js/app.js') {
    apply('        platform: "android",', '        platform: "ios",', 'select iOS custom spread and board behavior', 2);
    apply(
      '    var bridge = globalThis.androidTelemetry;\n    if (!bridge || typeof bridge.isEnabled !== "function" || !bridge.isEnabled()) return;\n    try {\n      bridge.logReadingCompleted(deckType, spread.length);\n    } catch (_error) {\n      // Telemetry must never affect the reading; swallow any failure.\n    }',
      '    var bridge = globalThis.QuareiaIOS;\n    if (!bridge || typeof bridge.readingCompleted !== "function") return;\n    try {\n      Promise.resolve(bridge.readingCompleted(deckType, spread.length)).catch(function () {});\n    } catch (_error) {\n      // Telemetry must never affect the reading; swallow any failure.\n    }',
      'route bounded completion metadata through QuareiaNative'
    );
    apply(
      '  if (document.readyState === "loading") {\n    document.addEventListener("DOMContentLoaded", init);\n  } else {\n    init();\n  }',
      '  function showHostInitializationFailure() {\n    var alert = document.getElementById("iosHostInitializationAlert");\n    if (!alert) {\n      alert = document.createElement("div");\n      alert.id = "iosHostInitializationAlert";\n      alert.setAttribute("role", "alert");\n      alert.setAttribute("aria-live", "assertive");\n      alert.style.cssText = "position:fixed;z-index:2147483647;inset:1rem;margin:auto;padding:1rem;max-width:42rem;height:fit-content;background:#fff4d6;color:#341f00;border:2px solid #9a5b00;border-radius:.75rem;box-shadow:0 1rem 3rem rgba(0,0,0,.45);font:600 1rem/1.5 system-ui,sans-serif";\n      document.body.prepend(alert);\n    }\n    alert.hidden = false;\n    alert.textContent = "无法初始化 iOS 宿主服务。为保护本机资源，本页面已停止启动。请完全退出并重新打开应用。 / iOS host initialization failed. This page did not start, to protect local resources. Fully quit and reopen the app.";\n  }\n\n  function startAfterHostAndBackupRecovery() {\n    var nativeAdapter = globalThis.QuareiaIOS;\n    var backup = globalThis.QuareiaIOSBackup;\n    if (!nativeAdapter || !nativeAdapter.ready || typeof nativeAdapter.ready.then !== "function") {\n      showHostInitializationFailure();\n      return;\n    }\n    if (!backup || !backup.ready || typeof backup.ready.then !== "function") {\n      showHostInitializationFailure();\n      return;\n    }\n    Promise.all([nativeAdapter.ready, backup.ready]).then(function (results) {\n      var backupResult = results[1];\n      if (backupResult && backupResult.recovered && globalThis.location && typeof globalThis.location.reload === "function") {\n        globalThis.location.reload();\n        return;\n      }\n      init();\n    }).catch(function () {\n      if (backup && typeof backup.isRecoveryRequired === "function" && backup.isRecoveryRequired()) {\n        if (typeof backup.showRecoveryNotice === "function") backup.showRecoveryNotice();\n        return;\n      }\n      showHostInitializationFailure();\n    });\n  }\n\n  if (document.readyState === "loading") {\n    document.addEventListener("DOMContentLoaded", startAfterHostAndBackupRecovery);\n  } else {\n    startAfterHostAndBackupRecovery();\n  }',
      'gate app initialization on native host handshake and backup journal recovery'
    );
  }

  if (assetPath === 'js/custom-spreads.js') {
    apply(
      '    if (platform !== "web" && platform !== "android") fail("platform must be web or android");\n    var storage = platform === "android" ? (options.storage || defaultStorage()) : null;\n    var loaded = platform === "android"\n      ? loadRecords(storage)\n      : { records: [], writeBlocked: false, needsMigration: false };',
      '    if (platform !== "web" && platform !== "android" && platform !== "ios") fail("platform must be web, android, or ios");\n    var isPersistentApp = platform === "android" || platform === "ios";\n    var storage = isPersistentApp ? (options.storage || defaultStorage()) : null;\n    var loaded = isPersistentApp\n      ? loadRecords(storage)\n      : { records: [], writeBlocked: false, needsMigration: false };',
      'add explicit persistent iOS library platform'
    );
    apply('    var maxLibrarySize = platform === "android" ? MAX_ANDROID_LIBRARY_SIZE : MAX_LIBRARY_SIZE;', '    var maxLibrarySize = isPersistentApp ? MAX_ANDROID_LIBRARY_SIZE : MAX_LIBRARY_SIZE;', 'apply mobile template capacity on iOS');
    apply('      if (platform !== "android") return;', '      if (!isPersistentApp) return;', 'persist iOS templates');
    apply('    function persist(nextRecords) {\n      if (!isPersistentApp) return;', '    function persist(nextRecords) {\n      if (!isPersistentApp) return;\n      if (root && root.DivinationBackup && root.DivinationBackup.isMutating()) {\n        throw storageFailure("backup transaction is in progress");\n      }', 'block template writes during backup transaction');
    apply('          if (platform === "android") throw libraryFullFailure(maxLibrarySize);', '          if (isPersistentApp) throw libraryFullFailure(maxLibrarySize);', 'use mobile capacity error on iOS');
    apply('      if (platform === "android" && writeBlocked) {', '      if (isPersistentApp && writeBlocked) {', 'protect invalid iOS template storage');
  }

  if (assetPath === 'js/custom-spread-ui.js') {
    apply('    var platform = options.platform === "android" ? "android" : "web";', '    var platform = options.platform === "android" || options.platform === "ios" ? options.platform : "web";', 'recognize iOS custom spread UI');
    apply('elements.saveUse.textContent = platform === "android"', 'elements.saveUse.textContent = platform !== "web"', 'use persistent-app save label on iOS', 2);
    apply('elements.privacy.textContent = platform === "android"', 'elements.privacy.textContent = platform !== "web"', 'use persistent-app privacy label on iOS', 2);
    apply('setStatus(platform === "android" ? "customSpread.savedAndroid" : "customSpread.savedWeb"', 'setStatus(platform !== "web" ? "customSpread.savedAndroid" : "customSpread.savedWeb"', 'use persistent-app saved status on iOS');
    apply('setStatus(platform === "android" ? "customSpread.importedAndroid" : "customSpread.importedWeb"', 'setStatus(platform !== "web" ? "customSpread.importedAndroid" : "customSpread.importedWeb"', 'use persistent-app import status on iOS');
    apply(
      '    function downloadCode() {\n      var code = currentCode || generateCode();\n      if (!code || !global.Blob || !global.URL || !global.URL.createObjectURL) {',
      '    async function downloadCode() {\n      var code = currentCode || generateCode();\n      if (code && global.QuareiaIOS && typeof global.QuareiaIOS.exportText === "function") {\n        try {\n          var nativeResult = await global.QuareiaIOS.exportText("qsp", "quareia-spread-code.txt", code + "\\n", "save");\n          setStatus(nativeResult.outcome === "success" ? "customSpread.downloaded" : "customSpread.downloadFailed", null, nativeResult.outcome === "success" ? "success" : "error");\n        } catch (_nativeError) {\n          setStatus("customSpread.downloadFailed", null, "error");\n        }\n        return;\n      }\n      if (!code || !global.Blob || !global.URL || !global.URL.createObjectURL) {',
      'route QSP export through iOS Files adapter'
    );
  }

  if (assetPath === 'js/free-board-ui.js') {
    apply('    if (platform === "android") {', '    if (platform === "android" || platform === "ios") {', 'use mobile board placement on iOS');
    apply('    var platform = options.platform === "android" ? "android" : "web";', '    var platform = options.platform === "android" || options.platform === "ios" ? options.platform : "web";', 'recognize iOS Free Board UI');
  }

  if (assetPath === 'js/free-board-draft.js') {
    apply('  function save(storage, candidate, options) {\n    options = options || {};', '  function save(storage, candidate, options) {\n    if (root && root.DivinationBackup && root.DivinationBackup.isMutating()) {\n      throw new Error("backup transaction is in progress");\n    }\n    options = options || {};', 'block draft writes during backup transaction');
    apply('  function discard(storage, options) {\n    options = options || {};', '  function discard(storage, options) {\n    if (root && root.DivinationBackup && root.DivinationBackup.isMutating()) return false;\n    options = options || {};', 'block draft deletion during backup transaction');
  }

  if (assetPath === 'js/history-store.js') {
    apply('    function runTransaction(mode, operation) {\n      return open().then(function (database) {', '    function runTransaction(mode, operation) {\n      if (mode === "readwrite" && root && root.DivinationBackup && root.DivinationBackup.isMutating()) {\n        return Promise.reject(new Error("backup transaction is in progress"));\n      }\n      return open().then(function (database) {', 'block history writes during backup transaction');
  }

  if (assetPath === 'css/custom-spreads.css') {
    apply('.custom-spread-dialog[data-platform="android"] .custom-spread-window-controls', '.custom-spread-dialog:is([data-platform="android"], [data-platform="ios"]) .custom-spread-window-controls', 'apply mobile studio chrome on iOS');
    apply('.custom-spread-code { min-height: 110px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 0.75rem; }', '.custom-spread-code { min-height: 110px; resize: vertical; font-family: ui-monospace, Consolas, monospace; font-size: 0.75rem; }\n\n/* Keep editable text legible without iOS focus zoom shifting the modal. */\n.custom-spread-dialog[data-platform="ios"] input,\n.custom-spread-dialog[data-platform="ios"] textarea,\n.custom-spread-dialog[data-platform="ios"] select { font-size: max(16px, 1rem); }', 'prevent iOS studio input focus auto-zoom while preserving user zoom');
  }

  if (assetPath === 'css/free-board.css') {
    apply('#freeBoardArea[data-free-board-platform="android"] .free-board-card', '#freeBoardArea:is([data-free-board-platform="android"], [data-free-board-platform="ios"]) .free-board-card', 'apply mobile board cards on iOS');
    apply('#freeBoardArea[data-free-board-platform="android"] .free-board-viewport', '#freeBoardArea:is([data-free-board-platform="android"], [data-free-board-platform="ios"]) .free-board-viewport', 'apply mobile board viewport on iOS');
  }

  if (assetPath === 'js/history-ui.js') {
    apply(
      '        var nativeBridge = globalThis.androidHistoryExport;\n        if (nativeBridge && typeof nativeBridge.save === "function") {\n          nativeBridge.save(json, fileName);\n          setTranslatedStatus(elements.actionStatus, "history.exportChoosing", {\n            fileName: fileName\n          }, false);\n          return;\n        }',
      '        var nativeBridge = globalThis.QuareiaIOS;\n        if (nativeBridge && typeof nativeBridge.exportText === "function") {\n          setTranslatedStatus(elements.actionStatus, "history.exportChoosing", { fileName: fileName }, false);\n          var nativeResult = await nativeBridge.exportText("history", fileName, json, "save");\n          globalThis.__quareiaHistoryExportResult({\n            ok: nativeResult.outcome === "success",\n            cancelled: nativeResult.outcome === "cancelled",\n            fileName: nativeResult.name || fileName\n          });\n          return;\n        }',
      'route history export through chunked iOS Files adapter'
    );
    apply(
      '    async function importFile(event) {\n      var file = event.target.files && event.target.files[0];\n      event.target.value = "";\n      if (!available || !file) return;\n      try {\n        if (file.size > recordsApi.MAX_IMPORT_BYTES) throw new Error("too large");\n        var envelope = recordsApi.parseImportJson(await file.text());',
      '    async function importText(text) {\n      if (!available) return;\n      try {\n        var envelope = recordsApi.parseImportJson(text);',
      'extract validated history text import'
    );
    apply(
      '      } catch (_error) {\n        setTranslatedStatus(elements.actionStatus, "history.importFailed", null, true);\n      }\n    }\n\n    function updateSaveAvailability(complete) {',
      '      } catch (_error) {\n        setTranslatedStatus(elements.actionStatus, "history.importFailed", null, true);\n      }\n    }\n\n    async function importFile(event) {\n      var file = event.target.files && event.target.files[0];\n      event.target.value = "";\n      if (!available || !file) return;\n      if (file.size > recordsApi.MAX_IMPORT_BYTES) {\n        setTranslatedStatus(elements.actionStatus, "history.importFailed", null, true);\n        return;\n      }\n      await importText(await file.text());\n    }\n\n    async function importNative(event) {\n      if (event) event.preventDefault();\n      if (!available || !globalThis.QuareiaIOS || typeof globalThis.QuareiaIOS.importText !== "function") return;\n      try {\n        var nativeResult = await globalThis.QuareiaIOS.importText("history");\n        if (nativeResult.outcome === "cancelled") return;\n        await importText(nativeResult.text);\n      } catch (_error) {\n        setTranslatedStatus(elements.actionStatus, "history.importFailed", null, true);\n      }\n    }\n\n    function updateSaveAvailability(complete) {',
      'add iOS Files history import'
    );
    apply(
      '    elements.importInput.addEventListener("change", importFile);\n    elements.importLabel.addEventListener("keydown", function (event) {\n      if (!available || (event.key !== "Enter" && event.key !== " ")) return;\n      event.preventDefault();\n      elements.importInput.click();\n    });',
      '    elements.importInput.addEventListener("change", importFile);\n    if (globalThis.QuareiaIOS && typeof globalThis.QuareiaIOS.importText === "function") {\n      elements.importLabel.addEventListener("click", importNative);\n    }\n    elements.importLabel.addEventListener("keydown", function (event) {\n      if (!available || (event.key !== "Enter" && event.key !== " ")) return;\n      event.preventDefault();\n      if (globalThis.QuareiaIOS && typeof globalThis.QuareiaIOS.importText === "function") importNative();\n      else elements.importInput.click();\n    });',
      'bind iOS history import affordance'
    );
  }

  return { output, transformations };
}

const expected = new Map();
const provenanceFiles = [];
const provenanceTransformations = [];
for (const entry of manifest.files) {
  if (!/^(LICENSE\.md|index\.html|(?:js|css)\/[a-z0-9-]+\.(?:js|css))$/.test(entry.path)) throw Error('Non-public path');
  if (expected.has(entry.path)) throw Error(`Duplicate output path: ${entry.path}`);
  const source = `android-demo/app/src/main/assets/www/${entry.path}`;
  const bytes = execFileSync('git', ['show', `${manifest.sourceCommit}:${source}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  if (sha(bytes) !== entry.sha256) throw Error(`Source hash mismatch: ${entry.path}`);
  const transformed = transformSource(entry.path, bytes.toString('utf8'));
  const result = Buffer.from(transformed.output);
  expected.set(entry.path, result);
  provenanceFiles.push({ path: entry.path, source, sourceSha256: entry.sha256, outputSha256: sha(result) });
  provenanceTransformations.push({ path: entry.path, steps: transformed.transformations });
}

const PUBLIC_BINARY_PATH = /^(?:assets\/cards\/(?:major-(?:0[0-9]|1[0-9]|2[01])|minor-(?:cups|pentacles|swords|wands)-(?:ace|two|three|four|five|six|seven|eight|nine|ten|page|knight|queen|king)|m\/m-(?:back|0[1-9]|[1-6][0-9]|7[0-8]))\.jpeg|assets\/icons\/(?:parchment-sun(?:-blank)?|sky-face-(?:celestial|ember|grove))\.png)$/;
if (!Array.isArray(manifest.binaryFiles) || manifest.binaryFiles.length !== 162) {
  throw Error('Public binary manifest must contain the exact 157-card and 5-theme-icon set');
}
for (const entry of manifest.binaryFiles) {
  if (!entry || Object.keys(entry).sort().join(',') !== 'path,sha256' || !PUBLIC_BINARY_PATH.test(entry.path)) {
    throw Error('Non-public binary path');
  }
  if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Invalid public binary hash');
  if (expected.has(entry.path)) throw Error(`Duplicate output path: ${entry.path}`);
  const source = `android-demo/app/src/main/assets/www/${entry.path}`;
  const bytes = execFileSync('git', ['show', `${manifest.sourceCommit}:${source}`], {
    cwd: root,
    maxBuffer: 8 * 1024 * 1024
  });
  if (sha(bytes) !== entry.sha256) throw Error(`Source hash mismatch: ${entry.path}`);
  expected.set(entry.path, bytes);
  provenanceFiles.push({
    path: entry.path,
    source,
    sourceSha256: entry.sha256,
    outputSha256: entry.sha256
  });
  provenanceTransformations.push({ path: entry.path, steps: ['exact binary copy'] });
}

for (const entry of manifest.overlays) {
  if (!/^(?:js|css)\/[a-z0-9-]+\.(?:js|css)$/.test(entry.path)) throw Error('Non-public overlay path');
  if (!/^ios-app\/web\/[a-z0-9-]+\.(?:js|css)$/.test(entry.source)) throw Error('Invalid overlay source');
  if (expected.has(entry.path)) throw Error(`Duplicate output path: ${entry.path}`);
  const sourcePath = path.join(root, entry.source);
  const bytes = fs.readFileSync(sourcePath);
  if (sha(bytes) !== entry.sha256) throw Error(`Overlay hash mismatch: ${entry.source}`);
  const result = Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'));
  expected.set(entry.path, result);
  provenanceFiles.push({ path: entry.path, source: entry.source, sourceSha256: entry.sha256, outputSha256: sha(result) });
  provenanceTransformations.push({ path: entry.path, steps: ['LF normalization'] });
}

expected.set('public-resources.json', Buffer.from(JSON.stringify([...expected.keys()], null, 2) + '\n'));
expected.set('provenance.json', Buffer.from(JSON.stringify({
  schema: 2,
  mode: 'public-ios-port',
  sourceCommit: manifest.sourceCommit,
  buildSourceCommit,
  transformations: provenanceTransformations,
  files: provenanceFiles
}, null, 2) + '\n'));

function files(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink()) throw Error('Symlink in generated bundle');
    return entry.isDirectory() ? files(path.join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name];
  });
}

for (const name of files(dest)) if (!expected.has(name)) throw Error(`Unexpected generated resource: ${name}`);
for (const [name, bytes] of expected) {
  const target = path.join(dest, name);
  if (check) {
    if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) throw Error(`Stale/missing resource: ${name}`);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
}
console.log(`iOS public bundle ${check ? 'CHECK' : 'GENERATED'}: ${expected.size} files; Android source ${manifest.sourceCommit}; build source ${buildSourceCommit}; 157 public card JPEGs and 5 public theme PNGs exact-copied; no LXXXI/private inputs`);
