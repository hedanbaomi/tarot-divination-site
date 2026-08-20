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
    assert.match(app, /function activateCustomSpread\(spreadDefinition\)[\s\S]*resolveCustomSpreadFilter\(spreadDefinition, deckType, arcanaFilter\)/);
    assert.match(app, /function handleDeckChange\(\)[\s\S]*resolveCustomSpreadFilter\(currentCustomSpread, newDeck, arcanaFilter\)/);
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
