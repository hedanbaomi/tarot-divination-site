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
  ["i18n.js", "free-board-model.js", "free-board-draft.js", "history-records.js",
    "history-ui.js", "free-board-ui.js", "app.js"].forEach(function (asset) {
    assert.match(html, new RegExp(asset.replace(".", "\\.") + "\\?v=20260809-free-board-v1"));
  });
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
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.free-board-card-toolbar\s*\{[\s\S]*display:\s*none/);
});

test("destructive Free Board transitions use the branded confirmation seam", function () {
  var app = read("js/app.js");
  var ui = read("js/free-board-ui.js");
  assert.match(app, /await confirmIfSpread\(t\("confirm\.layout"\)\)/);
  assert.match(app, /await confirmIfSpread\(t\("confirm\.shuffle"\)\)/);
  assert.match(app, /el\.layoutModeSelect\.value = layoutMode/);
  assert.match(app, /DivinationDialog\.request/);
  assert.match(app, /if \(!isFreeform\(\) && spread\.length === 0 && freeBoardCards === 0\)/);
  assert.match(ui, /requestConfirm\(t\("confirm\.freeBoardClear"\)/);
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
      "freeBoard.save",
      "freeBoard.undoAria",
      "freeBoard.cardAria",
      "history.freeBoard",
      "history.freeBoardPreview",
      "confirm.freeBoardClear"
    ].forEach(function (key) {
      assert.ok(block.indexOf('"' + key + '"') !== -1, locale + " missing " + key);
    });
  });
});
