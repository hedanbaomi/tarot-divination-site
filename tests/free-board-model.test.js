"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const FreeBoardModel = require("../js/free-board-model.js");

function tarotDeck(cardIds = ["one", "two", "three", "four"]) {
  return {
    id: "tarot-test-deck",
    name: "Tarot test deck",
    cardIds: cardIds.slice()
  };
}

function controller(options = {}) {
  return FreeBoardModel.createController({
    deck: tarotDeck(),
    settings: { language: "en", showMeanings: true },
    ...options
  });
}

function assertValidation(callback) {
  assert.throws(callback, (error) => {
    assert.equal(error.name, "FreeBoardValidationError");
    return true;
  });
}

function draftObject(board) {
  return JSON.parse(board.serializeDraft());
}

test("draw/add and remove keep the pile and current board positions in defined order", () => {
  const board = controller();

  assert.deepEqual(board.getState().remainingPile, ["one", "two", "three", "four"]);
  board.draw();
  board.addFromPile("three");

  assert.deepEqual(board.getState().cards.map((card) => card.cardId), ["one", "three"]);
  assert.deepEqual(board.getState().cards.map((card) => card.drawOrder), [1, 2]);
  assert.deepEqual(board.getState().remainingPile, ["two", "four"]);

  board.removeCard("one");
  assert.deepEqual(board.getState().cards.map((card) => card.cardId), ["three"]);
  assert.deepEqual(board.getState().cards.map((card) => card.drawOrder), [1]);
  assert.deepEqual(board.getState().remainingPile, ["two", "four", "one"]);
  const removed = board.getState();

  board.undo();
  assert.deepEqual(board.getState().cards.map((card) => card.drawOrder), [1, 2]);
  board.redo();
  assert.deepEqual(board.getState(), removed);

  board.draw("two");
  assert.deepEqual(board.getState().cards.map((card) => card.cardId), ["three", "two"]);
  assert.deepEqual(board.getState().cards.map((card) => card.drawOrder), [1, 2]);
});

test("duplicate, unknown, and incomplete card sets are rejected", () => {
  assertValidation(() => controller({ deck: tarotDeck(["one", "one"]) }));

  const board = controller();
  board.draw("one");
  assertValidation(() => board.draw("one"));
  assertValidation(() => board.draw("missing"));

  const draft = draftObject(board);
  draft.remainingPile = draft.remainingPile.slice(1);
  assertValidation(() => FreeBoardModel.restoreDraft(JSON.stringify(draft)));
});

test("move, rotate, and z ordering are independent and stay unique", () => {
  const board = controller();
  board.draw("one");
  board.draw("two");
  const before = board.getState();

  board.move("one", 12.5, -8.25);
  board.rotate("one", 450);
  const after = board.getState();
  const one = after.cards.find((card) => card.cardId === "one");
  const two = after.cards.find((card) => card.cardId === "two");

  assert.deepEqual({ x: one.x, y: one.y }, { x: 12.5, y: -8.25 });
  assert.equal(one.boardRotation, 90);
  assert.equal(one.drawOrder, before.cards.find((card) => card.cardId === "one").drawOrder);
  assert.notEqual(one.z, two.z);
  assert.equal(new Set(after.cards.map((card) => card.z)).size, after.cards.length);
});

test("bringToFront changes only stacking z, while current board position remains stable", () => {
  const board = controller();
  board.draw("one");
  board.draw("two");
  const original = board.getState();
  const originalDrawOrder = original.cards.find((card) => card.cardId === "one").drawOrder;

  board.bringToFront("one");
  const raised = board.getState();
  const one = raised.cards.find((card) => card.cardId === "one");
  const two = raised.cards.find((card) => card.cardId === "two");

  assert.ok(one.z > two.z);
  assert.equal(one.drawOrder, originalDrawOrder);
  assert.equal(new Set(raised.cards.map((card) => card.z)).size, 2);
});

test("orientation is separate from boardRotation", () => {
  const board = controller();
  board.draw("one");

  board.setOrientation("one", "reversed");
  board.rotate("one", 37);
  let card = board.getState().cards[0];
  assert.equal(card.orientation, "reversed");
  assert.equal(card.boardRotation, 37);

  board.rotateBy("one", -90);
  card = board.getState().cards[0];
  assert.equal(card.orientation, "reversed");
  assert.equal(card.boardRotation, 307);
});

test("reveal, hide, meaning toggle, revealAll, and immutable snapshots work", () => {
  const board = controller();
  board.draw("one");
  board.draw("two");

  board.reveal("one");
  board.toggleMeaning("one");
  assert.deepEqual(
    board.getState().cards.find((card) => card.cardId === "one"),
    {
      cardId: "one",
      orientation: "upright",
      x: 0,
      y: 0,
      boardRotation: 0,
      z: 1,
      revealed: true,
      meaningVisible: true,
      drawOrder: 1
    }
  );

  board.hide("one");
  assert.equal(board.getState().cards.find((card) => card.cardId === "one").meaningVisible, false);
  board.revealAll();
  assert.ok(board.getState().cards.every((card) => card.revealed));

  const snapshot = board.getState();
  assert.throws(() => { snapshot.cards[0].x = 999; }, TypeError);
  assert.throws(() => { snapshot.remainingPile.push("unexpected"); }, TypeError);
  assert.equal(board.getState().cards[0].x, 0);
  assert.deepEqual(board.getState().remainingPile, ["three", "four"]);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.cards));
});

test("viewport pan, zoom, and reset are explicit state operations", () => {
  const board = controller();

  board.panViewport(24, -12);
  board.zoomViewport(1.5);
  assert.deepEqual(board.getState().viewport, { panX: 24, panY: -12, zoom: 1.5 });

  board.resetViewport();
  assert.deepEqual(board.getState().viewport, { panX: 0, panY: 0, zoom: 1 });
});

test("undo and redo restore complete public states, including z changes", () => {
  const board = controller();
  board.draw("one");
  board.draw("two");
  const initial = board.getState();

  board.bringToFront("one");
  const raised = board.getState();
  assert.ok(raised.cards.find((card) => card.cardId === "one").z > 2);

  board.undo();
  assert.deepEqual(board.getState(), initial);
  assert.equal(board.canUndo(), true);
  assert.equal(board.canRedo(), true);

  board.redo();
  assert.deepEqual(board.getState(), raised);
});

test("draft serialization restores all board, pile, viewport, deck, and settings data", () => {
  const deck = {
    id: "tarot-test-deck",
    name: "Tarot test deck",
    cardIds: ["one", "two", "three", "four"],
    edition: { year: 2026 }
  };
  const settings = { language: "zh-Hant", showMeanings: false, spacing: 18 };
  const board = FreeBoardModel.createController({ deck, settings });
  board.draw("two", {
    orientation: "reversed",
    x: 16,
    y: -9,
    boardRotation: 22,
    revealed: true,
    meaningVisible: true
  });
  board.draw("one");
  board.setOrientation("one", "reversed");
  board.move("one", 44, 55);
  board.rotate("one", 181);
  board.bringToFront("two");
  board.panViewport(100, -50);
  board.zoomViewport(0.75);

  const draft = board.serializeDraft();
  const restored = FreeBoardModel.restoreDraft(draft);

  assert.deepEqual(restored.getState(), board.getState());
  assert.equal(restored.canUndo(), false);
  assert.equal(restored.canRedo(), false);
});

test("legacy drafts with draw-order gaps restore as contiguous current board positions", () => {
  const board = controller();
  board.draw("one");
  board.draw("two");
  const legacyDraft = draftObject(board);
  legacyDraft.cards[0].drawOrder = 2;
  legacyDraft.cards[1].drawOrder = 5;

  const restored = FreeBoardModel.restoreDraft(JSON.stringify(legacyDraft));
  const expectedPositions = [
    { cardId: "one", drawOrder: 1 },
    { cardId: "two", drawOrder: 2 }
  ];
  assert.deepEqual(restored.getState().cards.map((card) => ({
    cardId: card.cardId,
    drawOrder: card.drawOrder
  })), expectedPositions);

  const restoredInitialState = controller({
    initialState: {
      layoutMode: legacyDraft.layoutMode,
      cards: legacyDraft.cards,
      remainingPile: legacyDraft.remainingPile,
      viewport: legacyDraft.viewport,
      deck: legacyDraft.deck,
      settings: legacyDraft.settings
    }
  });
  assert.deepEqual(restoredInitialState.getState().cards.map((card) => ({
    cardId: card.cardId,
    drawOrder: card.drawOrder
  })), expectedPositions);
});

test("controller draft restore requires the supplied deck and settings snapshot", () => {
  const source = controller();
  source.draw("one");
  const draft = source.serializeDraft();

  const restored = controller({ draft });
  assert.deepEqual(restored.getState(), source.getState());
  assertValidation(() => controller({
    deck: tarotDeck(["one", "two", "three", "different"]),
    draft
  }));
});

test("coordinates, zoom, orientation, and strict draft schema are validated", () => {
  const board = controller();
  board.draw("one");

  assertValidation(() => board.move("one", Infinity, 0));
  assertValidation(() => board.move("one", FreeBoardModel.LIMITS.coordinateBound + 1, 0));
  assertValidation(() => board.zoomViewport(NaN));
  assertValidation(() => board.setOrientation("one", "sideways"));

  const badCoordinateDraft = draftObject(board);
  badCoordinateDraft.cards[0].x = FreeBoardModel.LIMITS.coordinateBound + 1;
  assertValidation(() => FreeBoardModel.restoreDraft(JSON.stringify(badCoordinateDraft)));

  const badZoomDraft = draftObject(board);
  badZoomDraft.viewport.zoom = FreeBoardModel.LIMITS.maxZoom + 1;
  assertValidation(() => FreeBoardModel.restoreDraft(JSON.stringify(badZoomDraft)));

  const extraKeyDraft = draftObject(board);
  extraKeyDraft.unexpected = true;
  assertValidation(() => FreeBoardModel.restoreDraft(JSON.stringify(extraKeyDraft)));
});

test("the supplied actual deck, rather than a global cap, determines the maximum", () => {
  const board = controller({ deck: tarotDeck(["a", "b", "c", "d", "e", "f"]) });
  ["a", "b", "c", "d", "e", "f"].forEach((cardId) => board.draw(cardId));

  assert.equal(board.getState().cards.length, 6);
  assert.deepEqual(board.getState().remainingPile, []);
  assertValidation(() => board.draw());
});

test("Mystagogus/LXXXI non-Tarot cards must remain upright", () => {
  const deck = {
    id: "mystagogus-lxxxi",
    name: "Mystagogus / LXXXI",
    cards: [
      { cardId: "tarot-card", isTarot: true },
      { cardId: "non-tarot-card", isTarot: false }
    ]
  };
  const board = FreeBoardModel.createController({
    deck,
    settings: { deckCode: "LXXXI" }
  });

  board.draw("non-tarot-card");
  assertValidation(() => board.setOrientation("non-tarot-card", "reversed"));
  assertValidation(() => board.draw("tarot-card", { orientation: "reversed" }) && board.setOrientation("non-tarot-card", "reversed"));

  const draft = draftObject(board);
  draft.cards[0].orientation = "reversed";
  assertValidation(() => FreeBoardModel.restoreDraft(JSON.stringify(draft)));
});

test("the UMD browser entry point loads without a DOM", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "js", "free-board-model.js"), "utf8");
  const sandbox = {};
  vm.runInNewContext(source, sandbox, { filename: "free-board-model.js" });

  assert.equal(typeof sandbox.FreeBoardModel.createController, "function");
  const board = sandbox.FreeBoardModel.createController({
    cardIds: ["browser-card"]
  });
  board.draw();
  assert.equal(board.getState().cards[0].cardId, "browser-card");
});
