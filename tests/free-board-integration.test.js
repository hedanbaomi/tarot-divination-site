"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("Free Board is a layout option whose resources load before the app", function () {
  var html = read("index.html");
  var app = read("js/app.js");
  var model = read("js/free-board-model.js");
  var ui = read("js/free-board-ui.js");
  var css = read("css/redesign.css");
  assert.match(html, /id="layoutModeSelect"/);
  assert.match(html, /value="freeform"[^>]*data-i18n="layout\.freeform"/);
  assert.ok(html.indexOf("js/free-board-model.js") < html.indexOf("js/free-board-draft.js"));
  assert.ok(html.indexOf("js/free-board-draft.js") < html.indexOf("js/history-records.js"));
  assert.ok(html.indexOf("js/history-ui.js") < html.indexOf("js/app.js"));
  assert.doesNotMatch(model, /freeBoard|Free Board/);
  assert.doesNotMatch(ui, /<canvas|createElement\(["']canvas/);
  assert.match(app, /var layoutMode = "preset"/);
  assert.match(app, /function freeBoardCardsForDeck\(type, filter\)/);
  assert.match(app, /return majors\.concat\(minors\)/);
  assert.match(app, /return minors\.concat\(majors\)/);
  assert.match(css, /\.free-table-card \{/);
});

test("the free board builds its own full pool and keeps a restored draft in order", function () {
  var app = read("js/app.js");
  assert.match(app, /function freeformDeckCards\(\)/);
  assert.match(app, /if \(isFreeform\(\)\) \{/);
  assert.match(app, /pile = shuffle\(freeformDeckCards\(\)\)/);
  assert.match(app, /function shuffle\(deck\)[\s\S]*Math\.floor\(Math\.random\(\) \* \(i \+ 1\)\)/);
  assert.match(app, /function restoreFreeformDraft\(\)/);
  assert.match(app, /removeAllDrawnCardsFromPile|remainingPile/);
});

test("a restored draft syncs the deck and select labels without dispatching change", function () {
  var app = read("js/app.js");
  var start = app.indexOf("var restoredCards = restoreFreeformDraft()");
  var end = app.indexOf("} else {", start);
  var branch = app.slice(start, end);
  assert.match(app, /function syncSelectControls\(\)/);
  assert.match(app, /function syncCustomSelectVisuals\(\)[\s\S]*DivinationCustomSelects\.sync\(\)/);
  assert.match(app, /DivinationSegmented\.sync/);
  assert.ok(branch.indexOf("applyDeckUi") !== -1);
  assert.ok(branch.indexOf("applyDeckUi") < branch.indexOf("applyLayoutUi"));
  assert.ok(branch.indexOf("applyLayoutUi") < branch.indexOf("syncSelectControls"));
  assert.doesNotMatch(branch, /dispatchEvent\(new Event\(["']change/);
});

test("the spread settings stay usable in the free board", function () {
  var app = read("js/app.js");
  var settings = read("js/spread-settings.js");
  assert.match(app, /el\.spreadSettingGroup\) el\.spreadSettingGroup\.style\.display = ""/);
  assert.doesNotMatch(app, /el\.spreadSettingGroup\.style\.display = freeform \? "none"/);
  assert.match(settings, /function openFreeBoard\(\)/);
  assert.match(settings, /freeBoardOpenBtn/);
});

test("free board reveal all saves a freeform history record", function () {
  var app = read("js/app.js");
  var history = read("js/history-ui.js");
  assert.match(app, /function revealAll\(\)/);
  assert.match(app, /saveFreeformDraftNow\(\)/);
  assert.match(app, /function saveFreeformHistory\(\)/);
  assert.match(app, /historyUiController\.saveFreeformReading/);
  assert.match(history, /function saveFreeformReading\(/);
  assert.match(history, /buildFreeformLayoutRecord/);
  assert.match(app, /isShuffleRunning\(\)/);
});

test("destructive free board transitions use the branded confirmation seam", function () {
  var app = read("js/app.js");
  assert.match(app, /await confirmIfSpread\(t\("confirm\.layout"\)\)/);
  assert.match(app, /confirmIfSpread\(t\("confirm\.shuffle"\), t\("confirm\.keep"\)\)/);
  assert.match(app, /el\.layoutModeSelect\.value = layoutMode/);
  assert.match(app, /DivinationDialog\.request/);
  assert.match(app, /clearFreeformDraft\(\)/);
});
test("overview method is visible only for the preset Tarot overview spread", function () {
  var html = read("index.html");
  var app = read("js/app.js");
  assert.match(app, /layoutMode === "preset" && deckType === "tarot" && selectedSpreadId === "overview"/);
  assert.match(app, /function setOverviewMethodVisibility\(visible\)/);
  assert.match(app, /themed-select-trigger/);
  assert.match(html, /id="overviewMethodGroup"/);
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
