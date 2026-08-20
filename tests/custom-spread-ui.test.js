"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

var webHtml = read("index.html");
var androidHtml = read("android-demo/app/src/main/assets/www/index.html");
var webApp = read("js/app.js");
var androidApp = read("android-demo/app/src/main/assets/www/js/app.js");

test("website and Android expose the same custom-spread designer and import workflow", function () {
  [webHtml, androidHtml].forEach(function (html) {
    assert.match(html, /id="customSpreadOpenBtn"/);
    assert.match(html, /id="customSpreadDialog"/);
    assert.match(html, /id="customSpreadLibrary"/);
    assert.match(html, /id="customSpreadDesigner"/);
    assert.match(html, /id="customSpreadImportCode"/);
    assert.match(html, /id="customSpreadPreview"/);
    assert.match(html, /id="customSpreadShareCode"/);
    assert.match(html, /js\/custom-spreads\.js/);
    assert.match(html, /js\/custom-spread-ui\.js/);
    assert.match(html, /css\/custom-spreads\.css/);
    assert.equal((html.match(/role="tab"/g) || []).length, 3);
    assert.equal((html.match(/role="tabpanel"/g) || []).length, 3);
    assert.match(html, /id="customSpreadLibraryTab"[\s\S]*aria-controls="customSpreadLibraryPanel"/);
    assert.match(html, /id="customSpreadDesignerTab"[\s\S]*aria-controls="customSpreadDesigner"/);
    assert.match(html, /id="customSpreadImportTab"[\s\S]*aria-controls="customSpreadImportPanel"/);
  });
});

test("custom spread scripts load before app startup on both surfaces", function () {
  [webHtml, androidHtml].forEach(function (html) {
    var coreIndex = html.indexOf("js/custom-spreads.js");
    var uiIndex = html.indexOf("js/custom-spread-ui.js");
    var appIndex = html.indexOf("js/app.js");
    assert.ok(coreIndex !== -1 && coreIndex < uiIndex);
    assert.ok(uiIndex < appIndex);
  });
});

test("studio supports desktop placement and fullscreen without clipping its tabs", function () {
  var ui = read("js/custom-spread-ui.js");
  var androidUi = read("android-demo/app/src/main/assets/www/js/custom-spread-ui.js");
  var css = read("css/custom-spreads.css");
  var androidCss = read("android-demo/app/src/main/assets/www/css/custom-spreads.css");

  [webHtml, androidHtml].forEach(function (html) {
    assert.match(html, /id="customSpreadWindowControls"/);
    assert.match(html, /data-studio-window-mode="left"/);
    assert.match(html, /data-studio-window-mode="center"/);
    assert.match(html, /data-studio-window-mode="right"/);
    assert.match(html, /id="customSpreadFullscreenBtn"/);
    assert.match(html, /class="custom-spread-dialog"[^>]*data-window-mode="center"/);
  });
  [ui, androidUi].forEach(function (source) {
    assert.match(source, /function setWindowMode/);
    assert.match(source, /data\.windowMode|dataset\.windowMode/);
    assert.match(source, /addEventListener\("pointerdown"/);
    assert.match(source, /elements\.content\.scrollTop\s*=\s*0/);
    assert.match(source, /function clampCustomWindow\(\)\s*\{[\s\S]*?if \(!elements\.dialog\.open\) return;/);
  });
  [css, androidCss].forEach(function (source) {
    assert.match(source, /\.custom-spread-dialog\s*\{[^}]*margin:\s*auto/);
    assert.match(source, /\.custom-spread-tabs\s*\{[^}]*flex-shrink:\s*0/);
    assert.match(source, /\.custom-spread-tabs\s*\{[^}]*overflow-y:\s*hidden/);
    assert.match(source, /\.custom-spread-dialog\[data-window-mode="fullscreen"\]/);
    assert.match(source, /\.custom-spread-dialog\[data-window-mode="custom"\]/);
    assert.match(source, /@media\s*\(min-width:\s*601px\)\s*\{[\s\S]*?data-platform="web"[\s\S]*?touch-action:\s*none/);
  });
});

test("app resolves custom spreads into the preset drawing pipeline", function () {
  [webApp, androidApp].forEach(function (app) {
    assert.match(app, /function selectedSpread\(\)[\s\S]*customSpreadsUi\.getById/);
    assert.match(app, /customSpreadsUi\.list\(\)/);
    assert.match(app, /custom-spreads/);
    assert.match(app, /activateCustomSpread/);
    assert.match(app, /DivinationCustomSpreadUi\.init/);
  });
});

test("custom activation protects completion when Major Arcana only is too small", function () {
  [webApp, androidApp].forEach(function (app) {
    assert.match(app, /requestedFilter !== "major-only"/);
    assert.match(app, /spreadDefinition\.positions\.length <= majorCount/);
    assert.match(app, /customSpread\.capacityMessage/);
    assert.match(app, /return "mixed"/);
    assert.match(app, /function handleArcanaChange\(\)[\s\S]*resolveCustomSpreadFilter\(selectedSpread\(\), deckType, newFilter\)/);
    assert.match(app, /function handleSpreadChange\(\)[\s\S]*resolveCustomSpreadFilter\(nextCustomSpread, deckType, arcanaFilter\)/);
    assert.match(app, /function activateCustomSpread\(spreadDefinition\)[\s\S]*resolveCustomSpreadFilter\(spreadDefinition, targetDeckType, arcanaFilter\)/);
    assert.match(app, /function handleDeckChange\(\)[\s\S]*?resolveCustomSpreadFilter\([\s\S]*?newDeck,\s*arcanaFilter\s*\)/);
  });
});

test("web and Android use explicit non-cloud platform boundaries", function () {
  assert.match(webApp, /platform:\s*"web"/);
  assert.match(androidApp, /platform:\s*"android"/);

  var ui = read("js/custom-spread-ui.js");
  assert.doesNotMatch(ui, /Account|Cloud|fetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(ui, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(ui, /\binnerHTML\b/);
  assert.match(ui, /elements\.importCode\.value\.trim\(\)/);
  assert.match(ui, /CUSTOM_SPREAD_STORAGE/);
  assert.match(ui, /event\.key === "ArrowRight"/);
  assert.match(ui, /event\.key === "Home"/);
  assert.doesNotMatch(androidApp, /storage:\s*globalThis\.localStorage/);
});

test("catalogue selection changes only after activation succeeds", function () {
  var ui = read("js/custom-spread-ui.js");
  var importStart = ui.indexOf("async function importAndUse()");
  var importEnd = ui.indexOf("async function requestRemoval", importStart);
  var importFlow = ui.slice(importStart, importEnd);
  assert.ok(importFlow.indexOf("await activateSpread(imported)") < importFlow.indexOf("onCatalogueChange(imported.id)"));

  var saveStart = ui.indexOf("async function saveAndUse()");
  var saveEnd = ui.indexOf("async function useSpread", saveStart);
  var saveFlow = ui.slice(saveStart, saveEnd);
  assert.ok(saveFlow.indexOf("await activateSpread(saved)") < saveFlow.indexOf("onCatalogueChange(saved.id"));
});

test("web and Android mirror the shared custom-spread UI assets byte-for-byte", function () {
  assert.equal(
    read("js/custom-spread-ui.js"),
    read("android-demo/app/src/main/assets/www/js/custom-spread-ui.js")
  );
  assert.equal(
    read("css/custom-spreads.css"),
    read("android-demo/app/src/main/assets/www/css/custom-spreads.css")
  );
});

test("localized copy states Android persistence and website session-only behavior", function () {
  var i18n = read("js/i18n.js");
  ["zh-CN", "en"].forEach(function (locale) {
    var marker = '"' + locale + '": {';
    var start = i18n.indexOf(marker);
    assert.notEqual(start, -1);
    var next = i18n.indexOf('\n    }', start);
    var block = i18n.slice(start, next);
    assert.match(block, /"customSpread\.webPrivacy"/);
    assert.match(block, /"customSpread\.androidPrivacy"/);
    assert.match(block, /"customSpread\.importAndUse"/);
    assert.match(block, /"customSpread\.downloadCode"/);
    assert.match(block, /"customSpread\.storageFailed"/);
    assert.match(block, /"customSpread\.capacityMessage"/);
  });
});

test("v2 designer exposes deck, Tarot mode, stacking, and per-position rule controls", function () {
  [webHtml, androidHtml].forEach(function (html) {
    assert.match(html, /id="customSpreadDeckScope"/);
    assert.match(html, /id="customSpreadTarotMode"/);
    assert.match(html, /id="customSpreadStackingMode"/);
    assert.match(html, /label for="customSpreadDeckScope"/);
    assert.match(html, /label for="customSpreadTarotMode"/);
    assert.match(html, /label for="customSpreadStackingMode"/);
    assert.match(html, /id="customSpreadColumns"[^>]*max="10"/);
    assert.match(html, /id="customSpreadPreviewEffectBtn"/);
    assert.match(html, /id="customSpreadEffectPreview"/);
  });
  var ui = read("js/custom-spread-ui.js");
  assert.match(ui, /deckScope/);
  assert.match(ui, /tarotMode/);
  assert.match(ui, /stackingMode/);
  assert.match(ui, /drawRule/);
  assert.match(ui, /stackOn/);
  assert.match(ui, /customSpread\.drawRuleFollowing/);
  assert.match(ui, /customSpread\.stackOnNone/);
  assert.match(ui, /core\.normalizeDefinition/);
  assert.match(ui, /toRuntimeSpread/);
  assert.match(ui, /customSpreadEffectPreview/);
  assert.match(ui, /pointerdown/);
  assert.match(ui, /setPointerCapture/);
  assert.match(ui, /pointercancel/);
  assert.doesNotMatch(ui, /Math\.min\(7/);
  assert.match(ui, /var maxColumns = 10;/);
  assert.match(ui, /elements\.columns\.addEventListener\("change"/);
  assert.match(ui, /elements\.rows\.addEventListener\("change"/);
  assert.doesNotMatch(ui, /elements\.(?:columns|rows)\.addEventListener\("input"/);
  assert.match(ui, /draft\.tarotMode === "major-only"/);
  assert.match(ui, /draft\.tarotMode === "minor-only"/);
  assert.match(ui, /draft\.stackingMode === "major-minor"/);
});

test("v2 designer protects stack references, uses the ten-column grid, and keeps preview DOM-safe", function () {
  var ui = read("js/custom-spread-ui.js");
  var css = read("css/custom-spreads.css");
  assert.match(ui, /remapStackReferences/);
  assert.match(ui, /function syncStackedCoordinates\(\)/);
  assert.match(ui, /function applyDraggedCell\([\s\S]*sanitizeStackReferences\(draft\.positions\);[\s\S]*syncStackedCoordinates\(\)/);
  assert.match(ui, /stackOn.*index/);
  assert.match(ui, /major-minor/);
  assert.match(ui, /non-tarot-only/);
  assert.match(ui, /textContent/);
  assert.doesNotMatch(ui, /\binnerHTML\b/);
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /custom-spread-position-item\.is-dragging/);
  assert.match(css, /custom-spread-effect-preview/);
  assert.match(css, /@media\s*\(max-width:\s*375px\)/);
  assert.match(ui, /numberOr\(runtimePosition\.offsetX, 0\)/);
  assert.match(ui, /layerName === "major" \? -8 : 8/);
  assert.match(ui, /layerName === "major" \? -10 : 12/);
  assert.match(css, /transform:\s*translate\(var\(--effect-offset-x/);
  assert.match(ui, /data-preview-card-state", "face-down"/);
  assert.match(ui, /spread-card-face spread-card-back/);
  assert.match(ui, /spread-card-back-art/);
  assert.match(ui, /className = "pos-num"/);
  assert.match(css, /aspect-ratio:\s*0\.62/);
});

test("designer compresses all ten columns onto one page, themes dynamic selectors, and rotates by 45 degrees", function () {
  var ui = read("js/custom-spread-ui.js");
  var css = read("css/custom-spreads.css");
  var runtimeCss = read("css/styles.css");
  var app = read("js/app.js");
  var androidUi = read("android-demo/app/src/main/assets/www/js/custom-spread-ui.js");
  var androidCss = read("android-demo/app/src/main/assets/www/css/custom-spreads.css");
  var androidRuntimeCss = read("android-demo/app/src/main/assets/www/css/styles.css");
  var androidApp = read("android-demo/app/src/main/assets/www/js/app.js");

  [webHtml, androidHtml].forEach(function (html) {
    assert.doesNotMatch(html, /customSpreadPreview(?:Left|Right)Btn/);
  });
  [ui, androidUi].forEach(function (source) {
    assert.match(source, /DivinationCustomSelects\.refresh\(elements\.positions\)/);
    assert.match(source, /customSpreadPosition.*DrawRule/);
    assert.match(source, /customSpreadPosition.*StackOn/);
    assert.match(source, /function rotatePosition/);
    assert.match(source, /ROTATION_STEP\s*=\s*45/);
    assert.match(source, /rotation/);
    assert.match(source, /--position-rotation/);
  });
  [css, androidCss].forEach(function (source) {
    assert.match(source, /\.custom-spread-preview-scroll\s*\{[^}]*overflow-x:\s*hidden/);
    assert.match(source, /grid-template-columns:\s*repeat\(var\(--custom-columns\),\s*minmax\(0,\s*1fr\)\)/);
    assert.match(source, /\.custom-spread-preview\s*\{[^}]*min-width:\s*0/);
    assert.match(source, /rotate\(var\(--position-rotation/);
  });
  [app, androidApp].forEach(function (source) {
    assert.match(source, /--position-rotation/);
    assert.match(source, /classList\.toggle\("custom-spread-layout",\s*Boolean\(spreadDefinition\.isCustom\)\)/);
  });
  [runtimeCss, androidRuntimeCss].forEach(function (source) {
    assert.match(source, /\.spread-grid\.custom-spread-layout\s*\{[^}]*min-width:\s*0/);
    assert.match(source, /\.spread-grid\.custom-spread-layout\s*\{[^}]*width:\s*100%/);
    assert.match(source, /grid-template-columns:\s*repeat\(var\(--spread-columns,\s*3\),\s*minmax\(0,\s*1fr\)\)/);
    assert.match(source, /\.custom-spread-layout\s+\.spread-(?:card|slot)/);
  });
});

test("v2 designer localization covers both locales", function () {
  var i18n = read("js/i18n.js");
  var androidI18n = read("android-demo/app/src/main/assets/www/js/i18n.js");
  [i18n, androidI18n].forEach(function (source) {
    ["zh-CN", "en"].forEach(function (locale) {
      var marker = '"' + locale + '": {';
      var start = source.indexOf(marker);
      assert.notEqual(start, -1);
      var next = source.indexOf('\n    }', start);
      var block = source.slice(start, next);
    [
      "customSpread.deckScope",
      "customSpread.tarotMode",
      "customSpread.stackingMode",
      "customSpread.deckScopeAny",
      "customSpread.deckScopeTarotOnly",
      "customSpread.deckScopeNonTarotOnly",
      "customSpread.tarotModeMixed",
      "customSpread.tarotModeMajorOnly",
      "customSpread.tarotModeMinorOnly",
      "customSpread.stackingModeSingle",
      "customSpread.stackingModeMajorMinor",
      "customSpread.drawRuleFollowing",
      "customSpread.drawRuleMajor",
      "customSpread.drawRuleMinor",
      "customSpread.drawRuleWands",
      "customSpread.drawRuleCups",
      "customSpread.drawRuleSwords",
      "customSpread.drawRulePentacles",
      "customSpread.stackOnNone",
      "customSpread.stackOnPrevious",
      "customSpread.dragHint",
      "customSpread.previewEffect",
      "customSpread.previewEffectClose",
      "customSpread.rotation",
      "customSpread.rotateLeft",
      "customSpread.rotateRight",
      "customSpread.windowControls",
      "customSpread.windowLeft",
      "customSpread.windowCenter",
      "customSpread.windowRight",
      "customSpread.windowLeftLabel",
      "customSpread.windowCenterLabel",
      "customSpread.windowRightLabel",
      "customSpread.enterFullscreen",
      "customSpread.exitFullscreen",
      "customSpread.dragWindow"
      ].forEach(function (key) {
        assert.ok(block.indexOf('"' + key + '"') !== -1, locale + " missing " + key);
      });
    });
  });
});
