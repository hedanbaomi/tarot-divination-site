"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var bundle = path.join(__dirname, "..", "app", "src", "main", "assets", "www");
var model = require(path.join(bundle, "js", "free-board-model.js"));
var draft = require(path.join(bundle, "js", "free-board-draft.js"));
var records = require(path.join(bundle, "js", "history-records.js"));
var historyUi = require(path.join(bundle, "js", "history-ui.js"));

function read(relativePath) {
  return fs.readFileSync(path.join(bundle, relativePath), "utf8");
}

function storage() {
  var values = Object.create(null);
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem: function (key, value) { values[key] = String(value); },
    removeItem: function (key) { delete values[key]; }
  };
}

test("Android bundle exposes Free Board in the platform-preserving load order", function () {
  var html = read("index.html");
  var app = read("js/app.js");
  var history = read("js/history-ui.js");
  var i18n = read("js/i18n.js");
  var css = read("css/free-board.css");
  var freeBoardUi = read("js/free-board-ui.js");
  var activity = fs.readFileSync(path.join(
    __dirname, "..", "app", "src", "main", "java", "com", "quareia", "divination", "MainActivity.kt"
  ), "utf8");

  assert.match(html, /id="layoutModeSelect"/);
  assert.match(html, /id="freeBoardArea"/);
  assert.doesNotMatch(html, /freeBoardClearBtn|freeBoardSaveBtn/);
  assert.match(html, /id="freeBoardDiscardDraftBtn"[\s\S]*data-i18n="freeBoard\.clearAndDiscard"/);
  assert.match(html, /data-card-control-action="toggle-meaning"/);
  assert.ok(html.indexOf("js/free-board-model.js") < html.indexOf("js/free-board-draft.js"));
  assert.ok(html.indexOf("js/free-board-draft.js") < html.indexOf("js/history-records.js"));
  assert.ok(html.indexOf("js/history-ui.js") < html.indexOf("js/free-board-ui.js"));
  assert.ok(html.indexOf("js/free-board-ui.js") < html.indexOf("js/app.js"));
  assert.match(html, /js\/announcements\.js\?v=1/);
  assert.match(html, /js\/back-handler\.js\?v=20260731-overlay-back/);
  assert.match(app, /function freeBoardCardsForDeck\(type, filter\)/);
  assert.match(app, /cards: shuffle\(freeBoardCardsForDeck\(deckType, filter\)\)/);
  assert.match(app, /getLxxxiBackImage/);
  assert.match(activity, /window\.__qMediaBase[\s\S]*quareia:mediaready/);
  assert.match(freeBoardUi, /quareia:mediaready[\s\S]*refreshMedia/);
  assert.match(freeBoardUi, /card\.revealed && card\.orientation === "reversed"/);
  assert.doesNotMatch(freeBoardUi, /free-board-card-back-label/);
  assert.doesNotMatch(freeBoardUi, /free-board-pile-card-back[\s\S]{0,160}freeBoard\.faceDown/);
  assert.match(app, /platform: "android"/);
  assert.match(app, /getBackImage: deckBackImage/);
  assert.match(app, /if \(type === "mystagogus"\) return MYSTAGOGUS_BACK;\s*return "";/);
  assert.match(app, /androidTelemetry/);
  assert.match(history, /saveRecord: saveRecord/);
  assert.match(history, /handleBack/);
  assert.match(i18n, /function detectSystemLocale\(\)/);
  assert.match(i18n, /tForLocale: tForLocale/);
  assert.match(i18n, /freeBoard\.title/);
  assert.match(css, /\.free-board-viewport[\s\S]*touch-action: none/);
  assert.doesNotMatch(css, /free-board-card-toolbar/);
  assert.match(css, /data-free-board-platform="android"/);
  assert.match(i18n, /freeBoard\.drawOrder/);
});

test("Android Free Board model keeps pile order, orientation, board rotation, and restore strict", function () {
  var board = model.createController({
    deck: { id: "tarot", cardIds: ["one", "two", "three"] },
    settings: {
      deckType: "tarot",
      orientationMode: "mixed",
      filterMode: "mixed",
      overviewMethod: "not-applicable"
    }
  });

  board.draw("two", {
    orientation: "reversed",
    x: 24,
    y: -18,
    boardRotation: 90,
    revealed: true,
    meaningVisible: true
  });
  board.move("two", 40, -12);
  assert.deepEqual(board.getState().remainingPile, ["one", "three"]);
  assert.equal(board.getState().cards[0].orientation, "reversed");
  assert.equal(board.getState().cards[0].boardRotation, 90);

  var restored = model.restoreDraft(board.serializeDraft());
  assert.deepEqual(restored.getState(), board.getState());
  assert.equal(restored.canUndo(), false);
  assert.equal(restored.canRedo(), false);
});

test("Android Free Board keeps current board positions contiguous after remove and legacy restore", function () {
  var board = model.createController({
    deck: { id: "tarot", cardIds: ["one", "two", "three"] },
    settings: { deckType: "tarot", orientationMode: "mixed" }
  });
  board.draw("one");
  board.draw("two");
  board.draw("three");
  board.removeCard("one");
  assert.deepEqual(board.getState().cards.map(function (card) { return card.drawOrder; }), [1, 2]);

  var legacyDraft = JSON.parse(board.serializeDraft());
  legacyDraft.cards[0].drawOrder = 3;
  legacyDraft.cards[1].drawOrder = 7;
  var restored = model.restoreDraft(JSON.stringify(legacyDraft));
  assert.deepEqual(restored.getState().cards.map(function (card) { return card.drawOrder; }), [1, 2]);
});

test("Android draft storage fails closed and can discard a saved draft", async function () {
  var store = storage();
  var board = model.createController({
    deck: { id: "tarot", cardIds: ["one", "two"] },
    settings: { deckType: "tarot", orientationMode: "upright-only" }
  });
  board.draw("one");
  var autosave = draft.createAutosave({ storage: store, modelApi: model, debounceMs: 0 });
  var pending = autosave.schedule(board);
  await autosave.flush();
  assert.equal(await pending, board.serializeDraft());
  assert.deepEqual(draft.readResult(store, { modelApi: model }).invalid, false);
  assert.equal(autosave.discard(), true);
  store.setItem(draft.STORAGE_KEY, "{not-json");
  assert.deepEqual(draft.readResult(store, { modelApi: model }), {
    draft: null,
    invalid: true,
    unavailable: false
  });
});

test("Android history accepts Free Board v2 records while retaining the closed schema", function () {
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
  assert.equal(records.validateRecord(record).layoutMode, "freeform");
  assert.match(records.serializeExport([record]), /"formatVersion":\s*3/);
  assert.throws(function () {
    records.validateRecord(Object.assign({}, record, { unexpected: true }));
  }, /unexpected field/);
});

test("Android history preview keeps extreme Free Board cards readable", function () {
  var layout = historyUi.calculateFreeformPreviewLayout([
    { x: -1000000, y: -1000000 },
    { x: 1000000, y: 1000000 }
  ]);
  assert.equal(layout.cardScale, 0.5);
  assert.ok(layout.cardWidth * layout.cardScale >= 52);
  assert.ok(layout.cardHeight * layout.cardScale >= 79);
});
