"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");

function element() {
  const classes = new Set();
  const el = new EventTarget();
  return Object.assign(el, {
    style: { getPropertyValue: () => "" },
    classList: { add: c => classes.add(c), contains: c => classes.has(c), remove: c => classes.delete(c) },
    children: [], clientWidth: 420, clientHeight: 220, offsetWidth: 50, offsetHeight: 80,
    inert: false,
    appendChild(child) { this.children.push(child); child.parentNode = this; },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; },
    cloneNode: element, setAttribute() {}, removeAttribute() {}, animate() {}
  });
}

function emit(target, type, fields) {
  return target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), fields));
}

function setup({ reduced = false, empty = false } = {}) {
  let now = 0, next = 0, animations = 0, requests = 0, decide;
  const timers = new Map();
  const window = new EventTarget();
  const document = new EventTarget();
  const plane = element(), deck = element(), source = element(), button = element();
  deck.parentElement = plane;
  deck.classList.add("deck-ring");
  deck.querySelector = () => empty ? null : source;
  deck.querySelectorAll = () => empty ? [] : [source];
  source.cloneNode = () => Object.assign(element(), { animate() { animations++; } });
  Object.assign(document, {
    getElementById: id => id === "deckSpread" ? deck : null,
    querySelector: () => null, createElement: element
  });
  Object.assign(window, {
    window, document,
    matchMedia: () => ({ matches: reduced }),
    getComputedStyle: () => ({}),
    setTimeout(fn, delay) { timers.set(++next, { at: now + delay, fn }); return next; },
    clearTimeout(id) { timers.delete(id); }
  });
  const context = vm.createContext(window);
  for (const file of ["deck-shuffle", "shuffle-gesture"]) {
    vm.runInContext(fs.readFileSync(path.join(root, "js", file + ".js"), "utf8"), context);
  }
  const visual = window.DivinationShuffle;
  const single = window.DivinationShuffleGesture.bind(button, () => visual, () => {
    requests++;
    return new Promise(resolve => { decide = resolve; });
  });
  button.setPointerCapture = id => { button.capture = id; };
  button.releasePointerCapture = id => {
    assert.equal(id, button.capture);
    button.capture = null;
    emit(button, "lostpointercapture", { pointerId: id });
  };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      const first = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!first || first[1].at > end) break;
      now = first[1].at;
      timers.delete(first[0]);
      first[1].fn();
    }
    now = end;
  }
  return {
    window, document, button, deck, plane, visual, advance, single,
    animations: () => animations, requests: () => requests,
    down: (id = 5) => emit(button, "pointerdown", { pointerId: id, button: 0 }),
    up: (id = 5) => emit(window, "pointerup", { pointerId: id }),
    answer: async accepted => { decide(accepted); await new Promise(resolve => setImmediate(resolve)); }
  };
}

test("a long hold keeps interleaving, release parks until confirmation, and idle begin restarts", async () => {
  const h = setup();
  h.down();
  assert.equal(h.button.capture, 5);
  h.advance(30000);
  const atThirty = h.animations();
  h.advance(5000);
  assert.ok(h.animations() > atThirty);
  assert.equal(h.visual.isHolding(), true);
  h.up();
  assert.equal(h.button.capture, null);
  assert.equal(h.visual.isHolding(), false);
  h.advance(2000);
  const parked = h.animations();
  h.advance(30000);
  assert.equal(h.animations(), parked);
  assert.equal(h.visual.isRunning(), true);
  h.down(8);
  assert.equal(h.button.capture, null);
  await h.answer(false);
  assert.equal(h.plane.children.length, 0);
  assert.equal(h.deck.inert, false);

  assert.equal(h.visual.begin(), true);
  h.visual.release();
  h.advance(2000);
  const beforeRestart = h.animations();
  assert.equal(h.visual.begin(), true);
  h.advance(1500);
  assert.ok(h.animations() > beforeRestart);
  h.visual.cancel();
  assert.equal(h.requests(), 1);
});

test("tap finishes one riffle, rejects a press during fan-out, and preserves keyboard and clear activation", async () => {
  const h = setup();
  h.down(); h.up();
  emit(h.button, "click", { detail: 1 });
  assert.equal(h.requests(), 1);
  // Touch Chrome may target the newly opened modal with the compatibility click.
  assert.equal(emit(h.window, "click", { detail: 1, pointerId: 5 }), false);
  emit(h.window, "pointerdown", { pointerId: 6 });
  assert.equal(emit(h.window, "click", { detail: 1, pointerId: 6 }), true);
  await h.answer(true);
  h.advance(1100);
  h.down();
  assert.equal(h.button.capture, null);
  assert.equal(h.button.classList.contains("is-holding"), false);
  h.advance(2000);
  h.up();
  emit(h.button, "click", { detail: 1 });
  assert.equal(h.requests(), 1);
  emit(h.button, "click", { detail: 0 });
  assert.equal(h.requests(), 2);
  await h.answer(false);
  h.single();
  assert.equal(h.requests(), 3);
  await h.answer(false);

  const empty = setup({ empty: true });
  empty.down(); empty.up();
  assert.equal(empty.button.capture, undefined);
  assert.equal(empty.visual.isRunning(), false);
  assert.equal(empty.requests(), 0);
});

test("external shuffle events play one full round and reduced motion never starts a moving animation", () => {
  for (const reduced of [false, true]) {
    const h = setup({ reduced });
    emit(h.window, "quareia:shuffled");
    assert.equal(h.visual.isRunning(), true);
    h.advance(3000);
    assert.equal(h.visual.isRunning(), false);
    assert.equal(h.plane.children.length, 0);
    assert.equal(h.animations() > 0, !reduced);
    if (reduced) {
      h.down(); h.advance(40000);
      assert.equal(h.visual.isHolding(), true);
      assert.equal(h.animations(), 0);
    }
  }
});

test("interruption cancels only the active pointer and immediately permits a fresh hold", () => {
  for (const type of ["lostpointercapture", "pointercancel", "pagehide", "blur", "visibilitychange"]) {
    const h = setup();
    h.down();
    emit(h.button, "pointercancel", { pointerId: 404 });
    assert.equal(h.button.capture, 5);
    assert.equal(emit(h.button, "contextmenu"), false);
    if (type === "visibilitychange") {
      h.document.hidden = true;
      emit(h.document, type);
    } else if (type === "pagehide" || type === "blur") {
      emit(h.window, type);
    } else {
      emit(h.button, type, { pointerId: 5 });
    }
    h.up(); emit(h.button, "click", { detail: 1 });
    assert.equal(h.requests(), 0, type);
    assert.equal(h.visual.isRunning(), false, type);
    assert.equal(h.button.classList.contains("is-holding"), false, type);
    h.down(9);
    assert.equal(h.button.capture, 9, type);
  }
});

test("Web and Android use the same pointer and animation state machines", () => {
  for (const file of ["js/shuffle-gesture.js", "js/deck-shuffle.js", "css/classic-shuffle.css"]) {
    const read = prefix => fs.readFileSync(path.join(root, prefix, file), "utf8").replace(/\r\n/g, "\n");
    assert.equal(read("android-demo/app/src/main/assets/www"), read("."));
  }
});
