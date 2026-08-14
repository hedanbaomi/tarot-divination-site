"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Free Board is a synthetic layout option with stable load order and no preset positions", function () {
  var html = read("index.html");
  var app = read("js/app.js");
  var model = read("js/free-board-model.js");
  var ui = read("js/free-board-ui.js");
  var css = read("css/free-board.css");
  assert.match(html, /id="layoutModeSelect"/);
  assert.match(html, /value="freeform"[^>]*data-i18n="layout\.freeform"/);
  assert.ok(html.indexOf("css/free-board.css") < html.indexOf("</head>"));
  assert.ok(html.indexOf("js/free-board-model.js") < html.indexOf("js/free-board-draft.js"));
  assert.ok(html.indexOf("js/free-board-draft.js") < html.indexOf("js/history-records.js"));
  assert.ok(html.indexOf("js/history-ui.js") < html.indexOf("js/free-board-ui.js"));
  assert.ok(html.indexOf("js/free-board-ui.js") < html.indexOf("js/app.js"));
  ["free-board-model.js", "free-board-draft.js", "history-records.js",
    "history-ui.js", "free-board-ui.js"].forEach(function (asset) {
    assert.match(html, new RegExp(asset.replace(".", "\\.") + "\\?v=20260809-free-board-v1"));
  });
  assert.match(html, /app\.js\?v=20260814-empty-spread/);
  assert.match(html, /i18n\.js\?v=20260814-empty-spread/);
  assert.match(app, /var layoutMode = "preset"/);
  assert.match(app, /function freeBoardCardsForDeck\(type, filter\)/);
  assert.match(app, /return majors\.concat\(minors\)/);
  assert.match(app, /return minors\.concat\(majors\)/);
  assert.doesNotMatch(model, /freeBoard|Free Board/);
  assert.doesNotMatch(ui, /<canvas|createElement\(["']canvas/);
  assert.match(ui, /style\.transform = "translate3d\("/);
  assert.match(ui, /boardRotation \+ "deg/);
  assert.match(ui, /data-orientation/);
  assert.match(css, /\.free-board-viewport[\s\S]*touch-action: none/);
  assert.match(css, /\.free-board-viewport[\s\S]*overscroll-behavior: contain/);
  assert.doesNotMatch(css, /body\s*\{[^}]*touch-action/);
});

test("fresh Free Board contexts shuffle actual cards while draft restore keeps saved order", function () {
  var app = read("js/app.js");
  var restoreStart = app.indexOf("var restoredFreeBoard");
  var restoreEnd = app.indexOf("\n    } else {", restoreStart);
  var restoreBranch = app.slice(restoreStart, restoreEnd);

  assert.match(app, /function shuffle\(deck\)[\s\S]*Math\.floor\(Math\.random\(\) \* \(i \+ 1\)\)/);
  assert.match(app, /cards: shuffle\(freeBoardCardsForDeck\(deckType, filter\)\)/);
  assert.match(restoreBranch, /restoreDraftIfAvailable/);
  assert.doesNotMatch(restoreBranch, /freeBoardContext\(\)/);
});

test("draft restore refreshes custom-select labels after state sync without reconfiguring", function () {
  var app = read("js/app.js");
  var restoreStart = app.indexOf("var restoredFreeBoard");
  var restoreEnd = app.indexOf("\n    } else {", restoreStart);
  var restoreBranch = app.slice(restoreStart, restoreEnd);
  var stateIndex = restoreBranch.indexOf("syncStateFromFreeBoard");
  var deckUiIndex = restoreBranch.indexOf("applyDeckUi");
  var layoutUiIndex = restoreBranch.indexOf("applyLayoutUi");
  var customSyncIndex = restoreBranch.indexOf("syncCustomSelectVisuals");

  assert.match(app, /function syncCustomSelectVisuals\(\)[\s\S]*DivinationCustomSelects\.sync\(\)/);
  assert.ok(stateIndex !== -1 && stateIndex < deckUiIndex);
  assert.ok(deckUiIndex < layoutUiIndex && layoutUiIndex < customSyncIndex);
  assert.doesNotMatch(restoreBranch, /dispatchEvent\(new Event\(["']change/);
});

test("Free Board hides the preset spread group and selected controls when hidden", function () {
  var app = read("js/app.js");
  var css = read("css/free-board.css");
  assert.match(app, /el\.spreadSettingGroup = document\.querySelector\("\.setting-group-spread"\)/);
  assert.match(app, /el\.spreadSettingGroup\) el\.spreadSettingGroup\.style\.display = freeform \? "none" : ""/);
  assert.match(css, /\.free-board-selected-controls\[hidden\]\s*\{[\s\S]*display:\s*none\s*!important/);
  assert.doesNotMatch(css, /free-board-card-toolbar/);
});

test("overview method is visible only for the preset Tarot overview spread", function () {
  var html = read("index.html");
  var app = read("js/app.js");
  assert.match(app, /layoutMode === "preset" && deckType === "tarot" && selectedSpreadId === "overview"/);
  assert.match(app, /function setOverviewMethodVisibility\(visible\)/);
  assert.match(app, /themed-select-trigger/);
  assert.match(html, /id="overviewMethodGroup"/);
});

test("Free Board keeps only selected-card controls and saves after reveal all", function () {
  var html = read("index.html");
  var app = read("js/app.js");
  var ui = read("js/free-board-ui.js");
  var css = read("css/free-board.css");
  assert.doesNotMatch(html, /id="freeBoardClearBtn"/);
  assert.doesNotMatch(html, /id="freeBoardSaveBtn"/);
  assert.match(html, /id="freeBoardDiscardDraftBtn"[\s\S]*data-i18n="freeBoard\.clearAndDiscard"/);
  assert.match(html, /data-card-control-action="toggle-meaning"/);
  assert.doesNotMatch(ui, /free-board-card-toolbar/);
  assert.match(ui, /data-draw-order/);
  assert.match(ui, /case "toggle-meaning"/);
  assert.match(ui, /function revealAll\(\)[\s\S]*saveHistory\(\)/);
  assert.match(app, /platform: "web"/);
  assert.match(app, /getBackImage: deckBackImage/);
  assert.match(app, /if \(type === "mystagogus"\) return MYSTAGOGUS_BACK;\s*return "";/);
  assert.match(css, /data-free-board-platform="android"/);
});

test("destructive Free Board transitions use the branded confirmation seam", function () {
  var app = read("js/app.js");
  var ui = read("js/free-board-ui.js");
  assert.match(app, /await confirmIfSpread\(t\("confirm\.layout"\)\)/);
  assert.match(app, /await confirmIfSpread\(t\("confirm\.shuffle"\)\)/);
  assert.match(app, /el\.layoutModeSelect\.value = layoutMode/);
  assert.match(app, /DivinationDialog\.request/);
  assert.match(app, /if \(!isFreeform\(\) && spread\.length === 0 && freeBoardCards === 0\)/);
  assert.doesNotMatch(ui, /requestConfirm\(t\("confirm\.freeBoardClear"\)/);
  assert.match(ui, /requestConfirm\(t\("confirm\.freeBoardDiscard"\)/);
  assert.match(ui, /requestConfirm\(t\("confirm\.freeBoardShuffle"\)/);
  assert.doesNotMatch(ui, /var hasContent = getState\(\)\.cards\.length > 0/);
});

test("freeform history uses the general queued save API and DOM-only detail rendering", function () {
  var history = read("js/history-ui.js");
  var records = require("../js/history-records.js");
  var record = records.buildFreeformRecord({
    deckType: "tarot",
    deckMode: "tarot",
    deckName: "RWS Tarot",
    orientationMode: "mixed",
    filterMode: "major-then-minor",
    overviewMethod: "not-applicable",
    cards: [{
      cardId: "major-0",
      cardNumber: "0",
      cardName: "The Fool",
      arcana: "major",
      suit: "",
      orientation: "reversed",
      revealed: true,
      x: 12,
      y: -8,
      boardRotation: 15,
      z: 1,
      drawOrder: 1
    }]
  });
  assert.equal(record.layoutMode, "freeform");
  assert.match(history, /function saveRecord\(record, saveOptions\)/);
  assert.match(history, /saveRecord: saveRecord/);
  assert.match(history, /record\.layoutMode === "freeform"/);
  assert.match(history, /renderFreeformBoard\(record\)/);
  assert.match(history, /style\.transform = "rotate\("/);
  assert.match(history, /textContent/);
  assert.doesNotMatch(history, /\binnerHTML\b/);
});

test("both locales contain the Free Board surface keys", function () {
  var i18nSource = read("js/i18n.js");
  ["zh-CN", "en"].forEach(function (locale) {
    var start = i18nSource.indexOf('"' + locale + '": {');
    var end = locale === "zh-CN" ? i18nSource.indexOf('"en": {') : i18nSource.indexOf("\n    }\n  }", start);
    var block = i18nSource.slice(start, end);
    [
      "settings.layoutMode",
      "layout.freeform",
      "freeBoard.title",
      "freeBoard.showMeaning",
      "freeBoard.clearAndDiscard",
      "freeBoard.drawOrder",
      "freeBoard.undoAria",
      "freeBoard.cardAria",
      "history.freeBoard",
      "history.freeBoardPreview",
      "confirm.freeBoardDiscard"
    ].forEach(function (key) {
      assert.ok(block.indexOf('"' + key + '"') !== -1, locale + " missing " + key);
    });
  });
});
