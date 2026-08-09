"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");

var model = require("../js/free-board-model.js");
var draft = require("../js/free-board-draft.js");
var records = require("../js/history-records.js");
var freeBoard = require("../js/free-board-ui.js");

function ClassList() {
  this.values = Object.create(null);
}
ClassList.prototype.add = function (value) { this.values[value] = true; };
ClassList.prototype.remove = function (value) { delete this.values[value]; };
ClassList.prototype.contains = function (value) { return Boolean(this.values[value]); };
ClassList.prototype.toggle = function (value, force) {
  var next = force == null ? !this.contains(value) : Boolean(force);
  if (next) this.add(value); else this.remove(value);
  return next;
};

function FakeElement(tagName) {
  this.tagName = tagName.toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.attributes = Object.create(null);
  this.style = {
    setProperty: function (key, value) { this[key] = value; }
  };
  this.classList = new ClassList();
  this.listeners = Object.create(null);
  this.textContent = "";
  this.hidden = false;
  this.disabled = false;
}
FakeElement.prototype.appendChild = function (child) {
  child.parentNode = this;
  this.children.push(child);
  return child;
};
FakeElement.prototype.replaceChildren = function () {
  this.children = [];
  for (var i = 0; i < arguments.length; i += 1) this.appendChild(arguments[i]);
};
FakeElement.prototype.setAttribute = function (name, value) { this.attributes[name] = String(value); };
FakeElement.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
};
FakeElement.prototype.removeAttribute = function (name) { delete this.attributes[name]; };
FakeElement.prototype.addEventListener = function (type, listener) {
  (this.listeners[type] || (this.listeners[type] = [])).push(listener);
};
FakeElement.prototype.dispatchEvent = function (event) {
  if (!event.target) event.target = this;
  if (!event.preventDefault) event.preventDefault = function () { event.defaultPrevented = true; };
  if (!event.stopPropagation) event.stopPropagation = function () { event.stopped = true; };
  event.currentTarget = this;
  (this.listeners[event.type] || []).slice().forEach(function (listener) { listener(event); });
  if (!event.stopped && this.parentNode && event.bubbles !== false) this.parentNode.dispatchEvent(event);
  return !event.defaultPrevented;
};
FakeElement.prototype.querySelectorAll = function (selector) {
  var result = [];
  function matches(element) {
    if (selector === "[data-card-control-action]") return element.getAttribute("data-card-control-action") !== null;
    if (selector === "[data-free-board-action]") return element.getAttribute("data-free-board-action") !== null;
    if (selector.charAt(0) === ".") return element.classList.contains(selector.slice(1));
    return false;
  }
  function walk(element) {
    element.children.forEach(function (child) {
      if (matches(child)) result.push(child);
      walk(child);
    });
  }
  walk(this);
  return result;
};
FakeElement.prototype.focus = function () {};
FakeElement.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 400, height: 300 };
};

function FakeDocument() {
  this.body = new FakeElement("body");
}
FakeDocument.prototype.createElement = function (tagName) { return new FakeElement(tagName); };
FakeDocument.prototype.getElementById = function () { return null; };

function event(type, values) {
  return Object.assign({ type: type, bubbles: true, button: 0 }, values || {});
}

function makeStorage() {
  var values = Object.create(null);
  return {
    getItem: function (key) { return values[key] || null; },
    setItem: function (key, value) { values[key] = String(value); },
    removeItem: function (key) { delete values[key]; }
  };
}

function setup(config) {
  config = config || {};
  var document = new FakeDocument();
  var area = document.createElement("section");
  var viewport = document.createElement("div");
  var world = document.createElement("div");
  var pile = document.createElement("div");
  var selected = document.createElement("div");
  [
    "rotate-minus-15",
    "rotate-plus-15",
    "rotate-minus-90",
    "rotate-plus-90",
    "bring-front",
    "toggle-meaning",
    "remove"
  ].forEach(function (action) {
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("data-card-control-action", action);
    selected.appendChild(button);
  });
  viewport.appendChild(world);
  area.appendChild(viewport);
  var deckType = config.deckType || "tarot";
  var ids = deckType === "tarot"
    ? ["major-0", "major-1", "minor-1"]
    : [deckType + "-0", deckType + "-1", deckType + "-2"];
  var cards = ids.map(function (id, index) {
    return {
      id: id,
      number: index,
      name: "牌 " + index,
      nameEn: "Card " + index,
      deck: deckType,
      arcana: deckType === "tarot" ? (index === 2 ? "minor" : "major") : deckType,
      suit: deckType === "tarot" && index === 2 ? "wands" : "",
      image: ""
    };
  });
  var allDecks = {};
  allDecks[deckType] = cards;
  var savedRecord = null;
  var ui = freeBoard.createController({
    document: document,
    modelApi: model,
    draftApi: draft,
    recordsApi: records,
    storage: makeStorage(),
    draftDebounceMs: 0,
    allDecks: allDecks,
    platform: config.platform,
    getBackImage: config.getBackImage,
    area: area,
    viewport: viewport,
    world: world,
    pile: pile,
    selected: selected,
    count: document.createElement("span"),
    status: document.createElement("p"),
    hint: document.createElement("p"),
    pileRemaining: document.createElement("span"),
    saveStatus: document.createElement("p"),
    undo: document.createElement("button"),
    redo: document.createElement("button"),
    revealAll: document.createElement("button"),
    resetView: document.createElement("button"),
    clear: document.createElement("button"),
    shuffle: document.createElement("button"),
    discard: document.createElement("button"),
    save: document.createElement("button"),
    getHistoryController: function () {
      return {
        saveRecord: function (record) {
          savedRecord = record;
          return Promise.resolve({ saved: true, duplicate: false, record: record });
        }
      };
    }
  });
  ui.enter({
    deckType: deckType,
    deckName: deckType === "tarot" ? "RWS Tarot" : deckType,
    mode: deckType === "tarot" ? "mixed" : "upright-only",
    filterMode: deckType === "tarot" ? "major-then-minor" : "not-applicable",
    cards: cards,
    allDecks: allDecks
  }, { restoreDraft: false });
  return {
    ui: ui,
    viewport: viewport,
    world: world,
    pile: pile,
    selected: selected,
    getSaved: function () { return savedRecord; }
  };
}

function tap(element) {
  element.dispatchEvent(event("pointerdown", { clientX: 200, clientY: 150, pointerId: 1 }));
  element.dispatchEvent(event("pointerup", { clientX: 200, clientY: 150, pointerId: 1 }));
}

test("pointer drag commits one world move, while tap only selects without revealing", function () {
  var setupResult = setup();
  var ui = setupResult.ui;
  var card = setupResult.pile.children[0];
  card.dispatchEvent(event("click", { target: card }));
  var cardElement = setupResult.world.children[0];
  var before = ui.getState().cards[0];
  cardElement.dispatchEvent(event("pointerdown", { clientX: 200, clientY: 150, pointerId: 1 }));
  cardElement.dispatchEvent(event("pointermove", { clientX: 240, clientY: 180, pointerId: 1 }));
  cardElement.dispatchEvent(event("pointerup", { clientX: 240, clientY: 180, pointerId: 1 }));
  var moved = ui.getState().cards[0];
  assert.equal(moved.x, before.x + 40);
  assert.equal(moved.y, before.y + 30);
  assert.equal(ui.getState().cards.length, 1);

  tap(setupResult.world.children[0]);
  assert.equal(ui.getState().cards[0].revealed, false);
  assert.equal(setupResult.selected.hidden, false);
  assert.equal(setupResult.selected.children[5].disabled, true);
  ui.exit();
});

test("pinch and wheel zoom use bounded viewport math", function () {
  var setupResult = setup();
  var viewport = setupResult.viewport;
  viewport.dispatchEvent(event("pointerdown", { clientX: 100, clientY: 150, pointerId: 1 }));
  viewport.dispatchEvent(event("pointerdown", { clientX: 300, clientY: 150, pointerId: 2 }));
  viewport.dispatchEvent(event("pointermove", { clientX: 380, clientY: 150, pointerId: 2 }));
  viewport.dispatchEvent(event("pointerup", { clientX: 380, clientY: 150, pointerId: 2 }));
  viewport.dispatchEvent(event("pointerup", { clientX: 100, clientY: 150, pointerId: 1 }));
  assert.ok(setupResult.ui.getState().viewport.zoom > 1);
  assert.ok(setupResult.ui.getState().viewport.zoom <= 4);

  viewport.dispatchEvent(event("wheel", { deltaY: -100000, clientX: 200, clientY: 150 }));
  assert.equal(setupResult.ui.getState().viewport.zoom, 4);
  viewport.dispatchEvent(event("wheel", { deltaY: 100000, clientX: 200, clientY: 150 }));
  assert.equal(setupResult.ui.getState().viewport.zoom, 0.1);
  setupResult.ui.exit();
});

test("selected controls commit rotation, z ordering, removal, and reveal-all auto-save", async function () {
  var setupResult = setup();
  var ui = setupResult.ui;
  setupResult.pile.children[0].dispatchEvent(event("click"));
  setupResult.pile.children[0].dispatchEvent(event("click"));
  var first = setupResult.world.children[0];
  assert.equal(first.querySelectorAll("[data-free-board-action]").length, 0);
  tap(first);
  var selectedControls = setupResult.selected.querySelectorAll("[data-card-control-action]");
  var plus15 = selectedControls.filter(function (button) {
    return button.getAttribute("data-card-control-action") === "rotate-plus-15";
  })[0];
  plus15.dispatchEvent(event("click", { target: plus15 }));
  assert.equal(ui.getState().cards[0].boardRotation, 15);

  var firstId = ui.getState().cards[0].cardId;
  var secondId = ui.getState().cards[1].cardId;
  var bring = setupResult.selected.querySelectorAll("[data-card-control-action]").filter(function (button) {
    return button.getAttribute("data-card-control-action") === "bring-front";
  })[0];
  bring.dispatchEvent(event("click", { target: bring }));
  var firstAfterZ = ui.getState().cards.filter(function (card) { return card.cardId === firstId; })[0];
  var secondAfterZ = ui.getState().cards.filter(function (card) { return card.cardId === secondId; })[0];
  assert.ok(firstAfterZ.z > secondAfterZ.z);

  var remove = setupResult.selected.querySelectorAll("[data-card-control-action]").filter(function (button) {
    return button.getAttribute("data-card-control-action") === "remove";
  })[0];
  remove.dispatchEvent(event("click", { target: remove }));
  assert.equal(ui.getState().cards.some(function (card) { return card.cardId === firstId; }), false);
  assert.equal(ui.getState().remainingPile.indexOf(firstId) !== -1, true);

  var saved = await ui.revealAll();
  assert.equal(saved.saved, true);
  assert.equal(setupResult.getSaved().layoutMode, "freeform");
  assert.equal(setupResult.getSaved().cards.length, 1);
  assert.equal(setupResult.getSaved().cards[0].revealed, true);
  tap(setupResult.world.children[0]);
  var meaning = setupResult.selected.querySelectorAll("[data-card-control-action]").filter(function (button) {
    return button.getAttribute("data-card-control-action") === "toggle-meaning";
  })[0];
  assert.equal(meaning.disabled, false);
  meaning.dispatchEvent(event("click", { target: meaning }));
  assert.equal(ui.getState().cards[0].meaningVisible, true);
  ui.exit();
});

test("draw order is rendered on both card face states", function () {
  var setupResult = setup();
  setupResult.pile.children[0].dispatchEvent(event("click"));
  var card = setupResult.world.children[0];
  var order = card.children.filter(function (child) {
    return child.getAttribute("data-draw-order") !== null;
  })[0];
  assert.ok(order);
  assert.match(order.textContent, /freeBoard\.drawOrder/);
  assert.equal(order.getAttribute("data-draw-order"), "1");
  assert.match(card.children[0].children[0].className, /is-face-down/);
  setupResult.ui.revealAll();
  var revealed = setupResult.world.children[0];
  assert.ok(revealed.children.filter(function (child) {
    return child.getAttribute("data-draw-order") !== null;
  })[0]);
  assert.match(revealed.children[0].children[0].className, /is-revealed/);
  setupResult.ui.exit();
});

test("a reversed Tarot card keeps a neutral back until reveal-all", function () {
  var originalRandom = Math.random;
  var setupResult;
  Math.random = function () { return 1; };
  try {
    setupResult = setup();
    setupResult.pile.children[0].dispatchEvent(event("click"));
    assert.equal(setupResult.ui.getState().cards[0].orientation, "reversed");
    assert.doesNotMatch(setupResult.world.children[0].children[0].className, /\bis-reversed\b/);

    setupResult.ui.revealAll();
    assert.match(setupResult.world.children[0].children[0].className, /\bis-reversed\b/);
  } finally {
    if (setupResult) setupResult.ui.exit();
    Math.random = originalRandom;
  }
});

test("pile and board backs omit the face-down text label", function () {
  var setupResult = setup();
  var pileBack = setupResult.pile.children[0].children[0];
  assert.equal(pileBack.textContent, "");

  setupResult.pile.children[0].dispatchEvent(event("click"));
  var boardBack = setupResult.world.children[0].children[0].children[0];
  assert.equal(boardBack.children.length, 0);
  setupResult.ui.exit();
});

test("Free Board renders resolved Mystagogus and LXXXI backs while Tarot keeps its CSS back", function () {
  [
    { deckType: "mystagogus", back: "assets/cards/m/m-back.jpeg" },
    { deckType: "lxxxi", back: "qmedia://lxxxi-back" }
  ].forEach(function (entry) {
    var result = setup({
      deckType: entry.deckType,
      getBackImage: function (type) { return type === entry.deckType ? entry.back : ""; }
    });
    var pileBack = result.pile.children[0].children[0].children[0];
    assert.ok(pileBack);
    assert.equal(pileBack.className, "free-board-card-back-image");
    assert.equal(pileBack.src, entry.back);
    result.pile.children[0].dispatchEvent(event("click", { target: result.pile.children[0] }));
    var boardBack = result.world.children[0].children[0].children[0].children[0];
    assert.ok(boardBack);
    assert.equal(boardBack.className, "free-board-card-back-image");
    assert.equal(boardBack.src, entry.back);
    result.ui.exit();
  });

  var liveBack = "lxxxi-back";
  var restored = setup({
    deckType: "lxxxi",
    getBackImage: function () { return liveBack; }
  });
  restored.pile.children[0].dispatchEvent(event("click", { target: restored.pile.children[0] }));
  assert.equal(restored.world.children[0].children[0].children[0].children[0].src, "lxxxi-back");
  liveBack = "https://appassets.androidplatform.net/_m/token/lxxxi-back";
  restored.ui.refreshMedia();
  assert.equal(restored.world.children[0].children[0].children[0].children[0].src, liveBack);
  restored.ui.exit();

  var tarot = setup({ getBackImage: function () { return ""; } });
  assert.equal(tarot.pile.children[0].children[0].children.length, 0);
  tarot.ui.exit();
});

test("pure pinch and zoom helpers preserve the anchor and enforce bounds", function () {
  var viewport = { panX: 0, panY: 0, zoom: 1 };
  var rect = { left: 0, top: 0, width: 400, height: 300 };
  var zoomed = freeBoard.zoomAroundPoint(viewport, rect, { x: 200, y: 150 }, 20, model);
  assert.equal(zoomed.zoom, 4);
  assert.equal(zoomed.panX, 0);
  assert.equal(zoomed.panY, 0);
  var pinched = freeBoard.pinchViewport(viewport, rect, { x: 100, y: 150 }, { x: 120, y: 150 }, 100, 200, model);
  assert.equal(pinched.zoom, 2);
  assert.equal(pinched.panX, 120);
});
