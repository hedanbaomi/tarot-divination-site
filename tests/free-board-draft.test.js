"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");

var model = require("../js/free-board-model.js");
var draft = require("../js/free-board-draft.js");

function storage() {
  var values = Object.create(null);
  return {
    getItem: function (key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
    setItem: function (key, value) { values[key] = String(value); },
    removeItem: function (key) { delete values[key]; },
    has: function (key) { return Object.prototype.hasOwnProperty.call(values, key); }
  };
}

function makeController() {
  return model.createController({
    deck: {
      id: "tarot",
      deckName: "RWS Tarot",
      cardIds: ["major-0", "major-1", "minor-wands-1"],
      cards: [
        { id: "major-0", cardType: "tarot" },
        { id: "major-1", cardType: "tarot" },
        { id: "minor-wands-1", cardType: "tarot" }
      ]
    },
    settings: {
      deckType: "tarot",
      orientationMode: "mixed",
      filterMode: "major-then-minor",
      overviewMethod: "not-applicable"
    }
  });
}

test("draft save and restore preserve board, pile, settings, orientation and viewport", function () {
  var store = storage();
  var controller = makeController();
  controller.draw("major-1", {
    orientation: "reversed",
    x: 24,
    y: -18,
    boardRotation: 90,
    revealed: true,
    meaningVisible: true
  });
  controller.setViewport({ panX: 17, panY: -9, zoom: 1.75 });

  var serialized = draft.save(store, controller, { modelApi: model });
  assert.equal(typeof serialized, "string");
  var read = draft.readResult(store, { modelApi: model });
  assert.equal(read.invalid, false);
  assert.equal(read.draft, serialized);

  var restored = model.restoreDraft(read.draft);
  assert.deepEqual(restored.getState(), controller.getState());
});

test("autosave writes only model-valid drafts and explicit discard removes the stable key", async function () {
  var store = storage();
  var controller = makeController();
  var autosave = draft.createAutosave({
    storage: store,
    modelApi: model,
    debounceMs: 1000
  });
  var pending = autosave.schedule(controller);
  await autosave.flush();
  assert.equal(await pending, controller.serializeDraft());
  assert.equal(store.has(draft.STORAGE_KEY), true);
  assert.equal(autosave.discard(), true);
  assert.equal(store.has(draft.STORAGE_KEY), false);
});

test("invalid persisted drafts fail closed without being returned or thrown", function () {
  var store = storage();
  store.setItem(draft.STORAGE_KEY, "{not-json");
  var result = draft.readResult(store, { modelApi: model });
  assert.deepEqual(result, { draft: null, invalid: true, unavailable: false });
  assert.equal(store.has(draft.STORAGE_KEY), false);
});

test("autosave callbacks can schedule a new draft without settling the new waiter early", async function () {
  var store = storage();
  var first = makeController();
  var second = makeController();
  second.draw("major-1", { x: 12, y: -8, orientation: "upright" });
  var secondPending = null;
  var savedCount = 0;
  var autosave;
  autosave = draft.createAutosave({
    storage: store,
    modelApi: model,
    debounceMs: 0,
    onSaved: function () {
      savedCount += 1;
      if (savedCount === 1) secondPending = autosave.schedule(second);
    }
  });

  assert.equal(await autosave.schedule(first), first.serializeDraft());
  assert.ok(secondPending);
  assert.equal(await secondPending, second.serializeDraft());
  assert.equal(store.getItem(draft.STORAGE_KEY), second.serializeDraft());
  assert.equal(savedCount, 2);
});

test("a throwing observer cannot turn a persisted autosave into a failed save", async function () {
  var store = storage();
  var controller = makeController();
  var observedError = null;
  var autosave = draft.createAutosave({
    storage: store,
    modelApi: model,
    debounceMs: 0,
    onSaved: function () { throw new Error("observer failed"); },
    onError: function (error) { observedError = error; }
  });

  assert.equal(await autosave.schedule(controller), controller.serializeDraft());
  assert.equal(store.getItem(draft.STORAGE_KEY), controller.serializeDraft());
  assert.match(observedError.message, /observer failed/);
});
