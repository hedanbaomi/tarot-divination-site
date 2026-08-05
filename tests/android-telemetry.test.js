"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appPath = path.join(
  __dirname,
  "..",
  "android-demo",
  "app",
  "src",
  "main",
  "assets",
  "www",
  "js",
  "app.js"
);
const appSource = fs.readFileSync(appPath, "utf8");

function extractFunction(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return appSource.slice(start, end);
}

const resetDeck = extractFunction(
  "  function resetDeck()",
  "  function getOrientationLabel"
);
const notifyReadingCompleted = extractFunction(
  "  function notifyReadingCompleted()",
  "  function renderSpreadMeta"
);

function createHarness(bridge) {
  const context = {
    deckType: "tarot",
    spread: [],
    readingReported: false,
    currentPhase: "major",
    androidTelemetry: bridge,
    buildPile() {},
    renderSpreadCards() {},
    renderDeckSpread() {},
    renderSpreadMeta() {},
    renderResults() {}
  };
  vm.createContext(context);
  vm.runInContext(`
    ${resetDeck}
    ${notifyReadingCompleted}
    this.telemetryHarness = {
      notifyReadingCompleted: notifyReadingCompleted,
      resetDeck: resetDeck,
      setReading: function (type, count) {
        deckType = type;
        spread = Array.from({ length: count }, function () { return {}; });
      }
    };
  `, context);
  return context.telemetryHarness;
}

test("one complete reading reports reading_completed only once", () => {
  const calls = [];
  const harness = createHarness({
    isEnabled: () => true,
    logReadingCompleted: (...args) => calls.push(args)
  });

  harness.setReading("tarot", 3);
  harness.notifyReadingCompleted();
  harness.notifyReadingCompleted();

  assert.deepEqual(calls, [["tarot", 3]]);
});

test("reset allows the next complete reading to be reported", () => {
  const calls = [];
  const harness = createHarness({
    isEnabled: () => true,
    logReadingCompleted: (...args) => calls.push(args)
  });

  harness.setReading("mystagogus", 5);
  harness.notifyReadingCompleted();
  harness.resetDeck();
  harness.setReading("lxxxi", 8);
  harness.notifyReadingCompleted();

  assert.deepEqual(calls, [["mystagogus", 5], ["lxxxi", 8]]);
});

test("missing bridge is a no-op", () => {
  const harness = createHarness(undefined);

  assert.doesNotThrow(() => {
    harness.setReading("tarot", 1);
    harness.notifyReadingCompleted();
  });
});

test("disabled telemetry does not report", () => {
  const calls = [];
  const harness = createHarness({
    isEnabled: () => false,
    logReadingCompleted: (...args) => calls.push(args)
  });

  harness.setReading("tarot", 3);
  harness.notifyReadingCompleted();

  assert.deepEqual(calls, []);
});

test("the bridge receives only deck_type and card_count", () => {
  const calls = [];
  const harness = createHarness({
    isEnabled: () => true,
    logReadingCompleted: (...args) => calls.push(args)
  });

  harness.setReading("lxxxi", 81);
  harness.notifyReadingCompleted();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 2);
  assert.deepEqual(calls[0], ["lxxxi", 81]);
});
