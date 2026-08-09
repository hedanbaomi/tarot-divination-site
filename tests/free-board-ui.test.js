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

function setup() {
  var document = new FakeDocument();
  var area = document.createElement("section");
  var viewport = document.createElement("div");
  var world = document.createElement("div");
  var pile = document.createElement("div");
  var selected = document.createElement("div");
  viewport.appendChild(world);
  area.appendChild(viewport);
  var ids = ["major-0", "major-1", "minor-1"];
  var cards = ids.map(function (id, index) {
    return {
      id: id,
      number: index,
      name: "牌 " + index,
      nameEn: "Card " + index,
      deck: "tarot",
      arcana: index === 2 ? "minor" : "major",
      suit: index === 2 ? "wands" : "",
      image: ""
    };
  });
  var savedRecord = null;
  var ui = freeBoard.createController({
    document: document,
    modelApi: model,
    draftApi: draft,
    recordsApi: records,
    storage: makeStorage(),
    draftDebounceMs: 0,
    allDecks: { tarot: cards },
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
    deckType: "tarot",
    deckName: "RWS Tarot",
    mode: "mixed",
    filterMode: "major-then-minor",
    cards: cards,
    allDecks: { tarot: cards }
  }, { restoreDraft: false });
  return { ui: ui, viewport: viewport, world: world, pile: pile, getSaved: function () { return savedRecord; } };
}

function tap(element) {
  element.dispatchEvent(event("pointerdown", { clientX: 200, clientY: 150, pointerId: 1 }));
  element.dispatchEvent(event("pointerup", { clientX: 200, clientY: 150, pointerId: 1 }));
}

test("pointer drag commits one world move, while tap reveals and toggles meaning", function () {
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
  assert.equal(ui.getState().cards[0].revealed, true);
  tap(setupResult.world.children[0]);
  assert.equal(ui.getState().cards[0].meaningVisible, true);
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

test("card controls commit rotation, z ordering, removal, and explicit freeform save", async function () {
  var setupResult = setup();
  var ui = setupResult.ui;
  setupResult.pile.children[0].dispatchEvent(event("click"));
  setupResult.pile.children[0].dispatchEvent(event("click"));
  var first = setupResult.world.children[0];
  var plus15 = first.querySelectorAll("[data-free-board-action]").filter(function (button) {
    return button.getAttribute("data-free-board-action") === "rotate-plus-15";
  })[0];
  plus15.dispatchEvent(event("click", { target: plus15 }));
  assert.equal(ui.getState().cards[0].boardRotation, 15);

  var firstId = ui.getState().cards[0].cardId;
  var secondId = ui.getState().cards[1].cardId;
  var bring = setupResult.world.children[0].querySelectorAll("[data-free-board-action]").filter(function (button) {
    return button.getAttribute("data-free-board-action") === "bring-front";
  })[0];
  bring.dispatchEvent(event("click", { target: bring }));
  var firstAfterZ = ui.getState().cards.filter(function (card) { return card.cardId === firstId; })[0];
  var secondAfterZ = ui.getState().cards.filter(function (card) { return card.cardId === secondId; })[0];
  assert.ok(firstAfterZ.z > secondAfterZ.z);

  var remove = setupResult.world.children.filter(function (element) {
    return element.getAttribute("data-card-id") === firstId;
  })[0].querySelectorAll("[data-free-board-action]").filter(function (button) {
    return button.getAttribute("data-free-board-action") === "remove";
  })[0];
  remove.dispatchEvent(event("click", { target: remove }));
  assert.equal(ui.getState().cards.some(function (card) { return card.cardId === firstId; }), false);
  assert.equal(ui.getState().remainingPile.indexOf(firstId) !== -1, true);

  var saved = await ui.saveHistory();
  assert.equal(saved.saved, true);
  assert.equal(setupResult.getSaved().layoutMode, "freeform");
  assert.equal(setupResult.getSaved().cards.length, 1);
  ui.exit();
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
