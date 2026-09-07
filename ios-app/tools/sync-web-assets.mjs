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
    apply('        role="group" aria-label="所选卡牌控制" data-i18n-aria-label="freeBoard.selectedControlsAria">', '        role="group" aria-label="所选卡牌控制" data-i18n-aria-label="freeBoard.selectedControlsAria">\n        <span id="freeBoardSelectionStatus" role="status" aria-live="polite" aria-atomic="true"></span>', 'announce committed selected card position and rotation');
    apply('        <button class="btn btn-secondary" id="freeBoardResetViewBtn"', '        <button class="btn btn-secondary" id="freeBoardZoomOutBtn" type="button" data-i18n="freeBoard.zoomOut" data-i18n-aria-label="freeBoard.zoomOutAria">缩小</button>\n        <span id="freeBoardZoomStatus" role="status" aria-live="polite" aria-atomic="true">100%</span>\n        <button class="btn btn-secondary" id="freeBoardZoomInBtn" type="button" data-i18n="freeBoard.zoomIn" data-i18n-aria-label="freeBoard.zoomInAria">放大</button>\n        <button class="btn btn-secondary" id="freeBoardResetViewBtn"', 'add accessible iOS board zoom controls');
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
    apply('      ,"freeBoard.resetView": "重置视图"', '      ,"freeBoard.selectionPosition": "卡牌位置：X {x}，Y {y}。旋转角度：{rotation} 度。"\n      ,"freeBoard.resetView": "重置视图"', 'localize selected card position in Chinese');
    apply('      "freeBoard.resetView": "Reset view",', '      "freeBoard.selectionPosition": "Card position: X {x}, Y {y}. Rotation: {rotation} degrees.",\n      "freeBoard.resetView": "Reset view",', 'localize selected card position in English');
    apply('      ,"freeBoard.resetView": "重置视图"', '      ,"freeBoard.zoomLevel": "画板缩放：{percent}%"\n      ,"freeBoard.zoomIn": "放大"\n      ,"freeBoard.zoomOut": "缩小"\n      ,"freeBoard.zoomInAria": "放大自由画板"\n      ,"freeBoard.zoomOutAria": "缩小自由画板"\n      ,"freeBoard.resetView": "重置视图"', 'localize iOS board zoom in Chinese');
    apply('      "freeBoard.resetView": "Reset view",', '      "freeBoard.zoomLevel": "Board zoom: {percent}%",\n      "freeBoard.zoomIn": "Zoom in",\n      "freeBoard.zoomOut": "Zoom out",\n      "freeBoard.zoomInAria": "Zoom in on the Free Board",\n      "freeBoard.zoomOutAria": "Zoom out on the Free Board",\n      "freeBoard.resetView": "Reset view",', 'localize iOS board zoom in English');
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
    apply('      selected: options.selected || byId(document, "freeBoardSelectedControls"),', '      selectionStatus: options.selectionStatus || byId(document, "freeBoardSelectionStatus"),\n      selected: options.selected || byId(document, "freeBoardSelectedControls"),', 'resolve selected card live status');
    apply('      elements.selected.hidden = !selected;', '      if (elements.selectionStatus) {\n        var positionText = selected ? t("freeBoard.selectionPosition", {\n          x: Math.round(selected.x), y: Math.round(selected.y), rotation: Math.round(selected.boardRotation)\n        }) : "";\n        if (elements.selectionStatus.textContent !== positionText) elements.selectionStatus.textContent = positionText;\n      }\n      elements.selected.hidden = !selected;', 'announce committed coordinates without card identity or preview movement');
    apply('    function exit() {', '    function exit() {\n      if (elements.selectionStatus) elements.selectionStatus.textContent = "";', 'clear selected card position when leaving board');
    const diagnosticSource = `

    if (root && root.__quareiaBoardOnDemandDiagnostics === true) {
      root.__quareiaCaptureBoardDiagnostic = function () {
        var boardDiagnostic = { native: false, counts: { down:0, move:0, up:0, cancel:0, lost:0, dragStart:0, dragEnd:0, undoClick:0, redoClick:0, zoomClick:0, errors:0 }, pointerX:0, pointerY:0, pointerType:"none", errorKind:"none", surface:"other", mutation:"snapshot" };
        var state = getState();
        var first = state && state.cards[0];
        var view = state && state.viewport;
        var renderedCard = !boardDiagnostic.native && elements.world && elements.world.firstElementChild;
        var cardRect = renderedCard ? renderedCard.getBoundingClientRect() : null;
        var undoRect = elements.undo ? elements.undo.getBoundingClientRect() : null;
        var redoRect = elements.redo ? elements.redo.getBoundingClientRect() : null;
        function numeric(value) {
          return Number.isFinite(value) ? Math.round(Math.max(-1000000, Math.min(1000000, value)) * 1000) / 1000 : 0;
        }
        var capture = Object.keys(pointers).some(function (id) {
          try { return !!(elements.viewport && elements.viewport.hasPointerCapture && elements.viewport.hasPointerCapture(Number(id))); }
          catch (_error) { return false; }
        });
        var snapshot = Object.assign({}, boardDiagnostic.counts, {
          pointerType: boardDiagnostic.pointerType,
          lastPointerX: numeric(boardDiagnostic.pointerX), lastPointerY: numeric(boardDiagnostic.pointerY),
          errorKind: boardDiagnostic.errorKind,
          domX: numeric(cardRect && cardRect.x), domY: numeric(cardRect && cardRect.y),
          domWidth: numeric(cardRect && cardRect.width), domHeight: numeric(cardRect && cardRect.height),
          undoDomX: numeric(undoRect && undoRect.x), undoDomY: numeric(undoRect && undoRect.y),
          undoDomWidth: numeric(undoRect && undoRect.width), undoDomHeight: numeric(undoRect && undoRect.height),
          redoDomX: numeric(redoRect && redoRect.x), redoDomY: numeric(redoRect && redoRect.y),
          redoDomWidth: numeric(redoRect && redoRect.width), redoDomHeight: numeric(redoRect && redoRect.height),
          undoDisabled: !elements.undo || elements.undo.disabled ? 1 : 0,
          redoDisabled: !elements.redo || elements.redo.disabled ? 1 : 0,
          surface: boardDiagnostic.surface,
          mutation: boardDiagnostic.mutation,
          active: Math.min(9999, Object.keys(pointers).length),
          gesture: gesture && ["card", "pan", "pinch"].indexOf(gesture.kind) >= 0 ? gesture.kind : "none",
          visual: Math.min(9999, Object.keys(visualCards).length),
          cards: Math.min(9999, state ? state.cards.length : 0),
          x: numeric(first && first.x), y: numeric(first && first.y),
          zoom: numeric(view && view.zoom), panX: numeric(view && view.panX), panY: numeric(view && view.panY),
          undo: stateController && stateController.canUndo() ? 1 : 0,
          redo: stateController && stateController.canRedo() ? 1 : 0,
          rendered: numeric(elements.world ? elements.world.childElementCount : 0),
          capture: capture ? 1 : 0
        });
        return snapshot;
      };
    }
    var boardDiagnostic = null;
    var boardDiagnosticPending = false;
    function scheduleBoardDiagnostic() {
      if (!boardDiagnostic || boardDiagnosticPending) return;
      boardDiagnosticPending = true;
      root.setTimeout(function () {
        boardDiagnosticPending = false;
        var state = getState();
        var first = state && state.cards[0];
        var view = state && state.viewport;
        var renderedCard = !boardDiagnostic.native && elements.world && elements.world.firstElementChild;
        var cardRect = renderedCard ? renderedCard.getBoundingClientRect() : null;
        function numeric(value) {
          return Number.isFinite(value) ? Math.round(Math.max(-1000000, Math.min(1000000, value)) * 1000) / 1000 : 0;
        }
        var capture = Object.keys(pointers).some(function (id) {
          try { return !!(elements.viewport && elements.viewport.hasPointerCapture && elements.viewport.hasPointerCapture(Number(id))); }
          catch (_error) { return false; }
        });
        var snapshot = Object.assign({}, boardDiagnostic.counts, {
          pointerType: boardDiagnostic.pointerType,
          lastPointerX: numeric(boardDiagnostic.pointerX), lastPointerY: numeric(boardDiagnostic.pointerY),
          errorKind: boardDiagnostic.errorKind,
          domX: numeric(cardRect && cardRect.x), domY: numeric(cardRect && cardRect.y),
          domWidth: numeric(cardRect && cardRect.width), domHeight: numeric(cardRect && cardRect.height),
          surface: boardDiagnostic.surface,
          mutation: boardDiagnostic.mutation,
          active: Math.min(9999, Object.keys(pointers).length),
          gesture: gesture && ["card", "pan", "pinch"].indexOf(gesture.kind) >= 0 ? gesture.kind : "none",
          visual: Math.min(9999, Object.keys(visualCards).length),
          cards: Math.min(9999, state ? state.cards.length : 0),
          x: numeric(first && first.x), y: numeric(first && first.y),
          zoom: numeric(view && view.zoom), panX: numeric(view && view.panX), panY: numeric(view && view.panY),
          undo: stateController && stateController.canUndo() ? 1 : 0,
          redo: stateController && stateController.canRedo() ? 1 : 0,
          rendered: numeric(elements.world ? elements.world.childElementCount : 0),
          capture: capture ? 1 : 0
        });
        var text = JSON.stringify(snapshot);
        if (boardDiagnostic.lastText === text) return;
        boardDiagnostic.lastText = text;
        if (boardDiagnostic.native) {
          var handler = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.boardDiagnostics;
          if (handler && typeof handler.postMessage === "function") handler.postMessage(snapshot);
        } else {
          boardDiagnostic.output.textContent = "Board diagnostic " + text;
        }
      }, 0);
    }
    function bindBoardDiagnostic() {
      if (boardDiagnostic || !root || root.__quareiaBoardDiagnostics !== true || !document.body) return;
      var native = root.__quareiaBoardDiagnosticsNative === true;
      var output = null;
      if (!native) {
        output = document.createElement("span");
        output.id = "boardEventDiagnostics";
        output.setAttribute("role", "status");
        output.setAttribute("aria-live", "polite");
        output.setAttribute("aria-atomic", "true");
        output.style.cssText = "position:fixed;left:2px;bottom:2px;width:260px;max-height:32px;overflow:hidden;font-size:4px;line-height:5px;pointer-events:none;z-index:2147483647";
        document.body.appendChild(output);
      }
      boardDiagnostic = { output: output, native: native, lastText: null, counts: { down:0, move:0, up:0, cancel:0, lost:0, dragStart:0, dragEnd:0, undoClick:0, redoClick:0, zoomClick:0, errors:0 }, pointerX:0, pointerY:0, pointerType:"none", errorKind:"none", surface:"other", mutation:"none" };
      function count(key) {
        boardDiagnostic.counts[key] = Math.min(9999, boardDiagnostic.counts[key] + 1);
        scheduleBoardDiagnostic();
      }
      function surface(target) {
        if (elements.viewport && elements.viewport.contains(target)) return "viewport";
        if (elements.undo && elements.undo.contains(target)) return "undo";
        if (elements.redo && elements.redo.contains(target)) return "redo";
        if ((elements.zoomIn && elements.zoomIn.contains(target)) || (elements.zoomOut && elements.zoomOut.contains(target))) return "zoom";
        return "other";
      }
      [["pointerdown","down"],["pointermove","move"],["pointerup","up"],["pointercancel","cancel"],["lostpointercapture","lost"],["dragstart","dragStart"],["dragend","dragEnd"]].forEach(function (pair) {
        document.addEventListener(pair[0], function (event) {
          boardDiagnostic.pointerType = ["touch","mouse","pen"].indexOf(event.pointerType) >= 0 ? event.pointerType : "none";
          boardDiagnostic.surface = surface(event.target);
          if (Number.isFinite(event.clientX)) boardDiagnostic.pointerX = event.clientX;
          if (Number.isFinite(event.clientY)) boardDiagnostic.pointerY = event.clientY;
          count(pair[1]);
        }, true);
      });
      [[elements.undo,"undoClick"],[elements.redo,"redoClick"],[elements.zoomIn,"zoomClick"],[elements.zoomOut,"zoomClick"]].forEach(function (pair) {
        if (pair[0]) pair[0].addEventListener("click", function () { count(pair[1]); }, true);
      });
      function countError(error) {
        var name = error && typeof error === "object" ? error.name : null;
        boardDiagnostic.errorKind = ["TypeError", "ReferenceError", "RangeError", "Error", "SyntaxError"].indexOf(name) >= 0 ? name : "other";
        count("errors");
      }
      root.addEventListener("error", function (event) { countError(event.error); }, true);
      root.addEventListener("unhandledrejection", function (event) { countError(event.reason); });
      scheduleBoardDiagnostic();
    }
`;
    apply('    var invalidDraft = false;', '    var invalidDraft = false;\n' + diagnosticSource, 'add opt-in finite public board diagnostics');
    apply('      bound = true;', '      bound = true;\n      bindBoardDiagnostic();', 'bind non-mutating board diagnostic observers');
    apply('    function render() {', '    function render() {\n      scheduleBoardDiagnostic();', 'refresh finite diagnostics after board render');
    apply('    function notifyChange(reason) {', '    function notifyChange(reason) {\n      if (boardDiagnostic) {\n        boardDiagnostic.mutation = ["move", "undo", "redo", "button-zoom", "viewport", "wheel-zoom", "draw", "reset-view"].indexOf(reason) >= 0 ? reason : "other";\n        scheduleBoardDiagnostic();\n      }', 'observe allowlisted mutation reason without content');
    const pointerStart = output.indexOf('    function handlePointerDown(event) {');
    const pointerEnd = output.indexOf('    function handleWheel(event) {', pointerStart);
    if (pointerStart < 0 || pointerEnd < 0) throw Error('Missing pointer event boundaries');
    const pointerSource = output.slice(pointerStart, pointerEnd);
    const touchSafePointerSource = replaceExact(pointerSource,
      'if (event.preventDefault) event.preventDefault();',
      'if (!(platform === "ios" && event.pointerType === "touch") && event.preventDefault) event.preventDefault();',
      'iOS touch-action handles gestures without cancelling later native clicks', 6);
    apply(pointerSource, touchSafePointerSource, 'preserve iOS touch compatibility click delivery');
    const finishStart = output.indexOf('    function finishPointer(event) {');
    const finishEnd = output.indexOf('    function handleWheel(event) {', finishStart);
    const oldFinish = output.slice(finishStart, finishEnd);
    const newFinish = `    function finishPointer(event) {
      var id = pointerId(event);
      var target = event.currentTarget || elements.viewport;
      var finishedGesture = gesture;
      if (pointers[id]) delete pointers[id];
      releasePointerCapture(target, id);
      if (finishedGesture && finishedGesture.kind === "pinch") {
        if (pointerCount() === 0) {
          gesture = null;
          commitVisualViewport();
        }
        return;
      }
      if (!finishedGesture || !stateController) return;
      var finishedCards = visualCards;
      gesture = null;
      visualCards = Object.create(null);
      if (finishedGesture.kind === "card" && finishedGesture.pointerId === id) {
        if (finishedGesture.moved) {
          var moved = finishedCards[finishedGesture.cardId];
          if (moved) mutate("move", [finishedGesture.cardId, moved.x, moved.y], "move");
        } else if (cardState(finishedGesture.cardId)) {
          selectedCardId = finishedGesture.cardId;
          renderSelectedControls(getState());
        }
      } else if (finishedGesture.kind === "pan" && finishedGesture.pointerId === id) {
        if (finishedGesture.moved) commitVisualViewport();
      }
      if (!(platform === "ios" && event.pointerType === "touch") && event.preventDefault) event.preventDefault();
    }

`;
    apply(oldFinish, newFinish, 'clear completed pointer state before replacing rendered card nodes');
    apply('      resetView: options.resetView || byId(document, "freeBoardResetViewBtn"),', '      zoomStatus: options.zoomStatus || byId(document, "freeBoardZoomStatus"),\n      zoomIn: options.zoomIn || byId(document, "freeBoardZoomInBtn"),\n      zoomOut: options.zoomOut || byId(document, "freeBoardZoomOutBtn"),\n      resetView: options.resetView || byId(document, "freeBoardResetViewBtn"),', 'resolve iOS board zoom buttons');
    apply('      if (elements.undo) elements.undo.disabled = !stateController.canUndo();', '      if (elements.zoomStatus) {\n        var percent = Math.round(state.viewport.zoom * 100);\n        elements.zoomStatus.textContent = t("freeBoard.zoomLevel", { percent: percent });\n      }\n      if (elements.zoomIn) elements.zoomIn.disabled = state.viewport.zoom >= clampZoom(Number.MAX_VALUE, modelApi);\n      if (elements.zoomOut) elements.zoomOut.disabled = state.viewport.zoom <= clampZoom(0, modelApi);\n      if (elements.undo) elements.undo.disabled = !stateController.canUndo();', 'reflect bounded board zoom availability');
    apply('    function resetView() {', '    function zoomBoard(factor) {\n      var state = getState();\n      if (!state || (root.DivinationBackup && root.DivinationBackup.isMutating())) return null;\n      var rect = viewportRect(elements.viewport && elements.viewport.getBoundingClientRect());\n      var next = zoomAroundPoint(state.viewport, rect, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, state.viewport.zoom * factor, modelApi);\n      visualViewport = null;\n      return mutate("setViewport", [next], "button-zoom");\n    }\n\n    function resetView() {', 'zoom board around its center through the normal draft mutation path');
    apply('      if (elements.resetView) elements.resetView.addEventListener("click", resetView);', '      if (elements.zoomIn) elements.zoomIn.addEventListener("click", function () { zoomBoard(1.25); });\n      if (elements.zoomOut) elements.zoomOut.addEventListener("click", function () { zoomBoard(0.8); });\n      if (elements.resetView) elements.resetView.addEventListener("click", resetView);', 'bind accessible iOS zoom controls');
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
