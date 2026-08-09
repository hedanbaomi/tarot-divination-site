"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var historyUi = fs.readFileSync(path.join(root, "js", "history-ui.js"), "utf8");
var app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
var androidHistoryUi = fs.readFileSync(
  path.join(root, "android-demo/app/src/main/assets/www/js/history-ui.js"),
  "utf8"
);
var historyRecords = fs.readFileSync(path.join(root, "js", "history-records.js"), "utf8");
var androidHistoryRecords = fs.readFileSync(
  path.join(root, "android-demo/app/src/main/assets/www/js/history-records.js"),
  "utf8"
);
var androidMainActivity = fs.readFileSync(
  path.join(root, "android-demo/app/src/main/java/com/quareia/divination/MainActivity.kt"),
  "utf8"
);
var historyUiApi = require("../js/history-ui.js");

test("history UI never renders imported data through innerHTML", function () {
  assert.equal(/\binnerHTML\b/.test(historyUi), false);
  assert.match(historyUi, /textContent/);
  assert.match(historyUi, /replaceChildren/);
});

test("history center has no notes, questions, titles or free-text editing controls", function () {
  assert.equal(/<textarea\b/i.test(html), false);
  assert.equal(/\bcontenteditable\b/i.test(html), false);
  var inputs = html.match(/<input\b[^>]*>/gi) || [];
  assert.deepEqual(inputs.map(function (input) {
    return (input.match(/\btype="([^"]+)"/i) || [null, "text"])[1].toLowerCase();
  }), ["file"]);
});

test("history modules load before the application module", function () {
  var recordsIndex = html.indexOf("js/history-records.js");
  var storeIndex = html.indexOf("js/history-store.js");
  var uiIndex = html.indexOf("js/history-ui.js");
  var appIndex = html.indexOf("js/app.js");
  assert.ok(recordsIndex > 0);
  assert.ok(recordsIndex < storeIndex);
  assert.ok(storeIndex < uiIndex);
  assert.ok(uiIndex < appIndex);
});

test("Free Board resources load after their model and before the application", function () {
  var freeBoardModelIndex = html.indexOf("js/free-board-model.js");
  var freeBoardDraftIndex = html.indexOf("js/free-board-draft.js");
  var recordsIndex = html.indexOf("js/history-records.js");
  var historyUiIndex = html.indexOf("js/history-ui.js");
  var freeBoardUiIndex = html.indexOf("js/free-board-ui.js");
  var appIndex = html.indexOf("js/app.js");
  var freeBoardUi = fs.readFileSync(path.join(root, "js", "free-board-ui.js"), "utf8");
  var freeBoardCss = fs.readFileSync(path.join(root, "css", "free-board.css"), "utf8");

  assert.match(html, /href="css\/free-board\.css\?v=20260809-free-board-v1"/);
  assert.ok(freeBoardModelIndex < freeBoardDraftIndex);
  assert.ok(freeBoardDraftIndex < recordsIndex);
  assert.ok(recordsIndex < historyUiIndex);
  assert.ok(historyUiIndex < freeBoardUiIndex);
  assert.ok(freeBoardUiIndex < appIndex);
  assert.match(html, /id="layoutModeSelect"/);
  assert.match(html, /value="freeform"[^>]*data-i18n="layout\.freeform"/);
  assert.match(html, /id="freeBoardViewport"/);
  assert.doesNotMatch(freeBoardUi, /<canvas|createElement\(["']canvas/);
  assert.match(freeBoardUi, /boardRotation/);
  assert.match(freeBoardUi, /data-orientation/);
  assert.match(freeBoardCss, /\.free-board-viewport[\s\S]*touch-action: none/);
  assert.match(freeBoardCss, /\.free-board-viewport[\s\S]*overscroll-behavior: contain/);
});

test("opening a completed reading saves automatically without a manual save control", function () {
  assert.equal(/id="saveHistoryBtn"/.test(html), false);
  assert.equal(/getElementById\("saveHistoryBtn"\)/.test(historyUi), false);
  assert.match(app, /historyUiController\.saveCompletedReading\(\)/);
  assert.match(historyUi, /saveCompletedReading:\s*saveCurrentReading/);
});

test("automatic saves are queued without dropping a different reading", async function () {
  var enqueue = historyUiApi.createSerialTaskQueue();
  var events = [];
  var releaseFirst;
  var firstGate = new Promise(function (resolve) { releaseFirst = resolve; });
  var first = enqueue(async function () {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  var second = enqueue(async function () {
    events.push("second:start");
    events.push("second:end");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("extreme Free Board history coordinates keep cards readable", function () {
  var layout = historyUiApi.calculateFreeformPreviewLayout([
    { x: -1000000, y: -1000000 },
    { x: 1000000, y: 1000000 }
  ]);

  assert.equal(layout.cardScale, 0.5);
  assert.ok(layout.cardWidth * layout.cardScale >= 52);
  assert.ok(layout.cardHeight * layout.cardScale >= 79);
  assert.ok(layout.stageWidth <= 596);
  assert.ok(layout.stageHeight <= 376);
});

test("Free Board history details show order only and keep spatial rendering dormant", function () {
  var freeformCardRenderer = historyUi.slice(
    historyUi.indexOf("function renderFreeformCard"),
    historyUi.indexOf("function renderFreeformBoard")
  );
  var androidFreeformCardRenderer = androidHistoryUi.slice(
    androidHistoryUi.indexOf("function renderFreeformCard"),
    androidHistoryUi.indexOf("function renderFreeformBoard")
  );
  var detailRenderer = historyUi.slice(
    historyUi.indexOf("function showDetail"),
    historyUi.indexOf("async function refreshList")
  );
  var androidDetailRenderer = androidHistoryUi.slice(
    androidHistoryUi.indexOf("function showDetail"),
    androidHistoryUi.indexOf("async function refreshList")
  );

  assert.ok(freeformCardRenderer.length > 0);
  assert.doesNotMatch(freeformCardRenderer, /\b(?:x|y|boardRotation|z)\b/);
  assert.match(freeformCardRenderer, /t\("freeBoard\.drawOrder", \{ order: positionNumber \}\)/);
  assert.match(androidFreeformCardRenderer, /t\("freeBoard\.drawOrder", \{ order: positionNumber \}\)/);
  assert.doesNotMatch(detailRenderer, /renderFreeformBoard\(record\)/);
  assert.doesNotMatch(detailRenderer, /\.sort\(function \(a, b\) \{ return a\.z/);
  assert.match(detailRenderer, /forEach\(function \(card, index\)/);
  assert.match(detailRenderer, /renderFreeformCard\(record, card, index \+ 1\)/);
  assert.doesNotMatch(androidDetailRenderer, /renderFreeformBoard\(record\)/);
  assert.match(androidDetailRenderer, /renderFreeformCard\(record, card, index \+ 1\)/);
  assert.match(detailRenderer, /drawOrder/);
  assert.match(androidDetailRenderer, /drawOrder/);
  assert.equal(historyRecords, androidHistoryRecords);
});

test("Android history export uses the system save picker and reports completion", function () {
  assert.match(androidHistoryUi, /androidHistoryExport/);
  assert.match(androidHistoryUi, /nativeBridge\.save\(json, fileName\)/);
  assert.match(androidHistoryUi, /__quareiaHistoryExportResult/);
  assert.match(androidHistoryUi, /history\.exportChoosing/);
  assert.match(androidHistoryUi, /history\.exportedTo/);
  assert.match(androidMainActivity, /ActivityResultContracts\.CreateDocument\("application\/json"\)/);
  assert.match(androidMainActivity, /contentResolver\.openOutputStream\(uri, "w"\)/);
  assert.match(androidMainActivity, /OpenableColumns\.DISPLAY_NAME/);
});
