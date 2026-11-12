"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const webSource = fs.readFileSync(path.join(__dirname, "../js/app.js"), "utf8");

function extract(source, start, end) {
  const a = source.indexOf("  function " + start + "(");
  const b = source.indexOf("  function " + end + "(", a);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
function harness(platform = "web") {
  const source = platform === "web" ? webSource : fs.readFileSync(path.join(__dirname,
    "../android-demo/app/src/main/assets/www/js/app.js"), "utf8");
  const calls = [];
  const context = {
    spread: [], deckType: "tarot", readingReported: false, freeBoardReadingReported: false,
    uidCounter: 3, lastSavedPresetUid: -1,
    freeDrawn: [], freeRedo: [], scheduleFreeformDraft() {}, renderFreeformFan() {},
    clearFreeformDraft() {}, renderFreeDraw() {},
    historyUiController: null, isReadingComplete: () => context.spread.length === context.target,
    isFreeform: () => false, setTimeout: (fn) => fn(), getSpreadEl: () => null,
    target: 3, buildPile() {}, renderSpreadCards() {}, renderDeckSpread() {}, renderSpreadMeta() {}, renderResults() {},
    DivinationWebTelemetry: { isEnabled: () => true, logReadingCompleted: (...args) => calls.push(args) }
  };
  context.androidTelemetry = context.DivinationWebTelemetry;
  vm.createContext(context);
  vm.runInContext(extract(source, "resetDeck", "getOrientationLabel") +
    extract(source, "revealEntry", "removeEntry") +
    extract(source, "revealAll", "renderSpreadMeta"), context);
  return { context, calls };
}
test("preset completion reports once, rejects incomplete spreads and resets for a new reading", () => {
  const { context: c, calls } = harness();
  c.spread = [{ revealed: false }];
  c.revealAll();
  assert.equal(calls.length, 0);
  c.spread = [{}, {}, {}];
  c.revealAll();
  c.revealAll();
  assert.deepEqual(calls, [["tarot", 3]]);
  c.resetDeck();
  c.spread = [{}, {}, {}];
  c.deckType = "mystagogus";
  c.revealAll();
  assert.deepEqual(calls.at(-1), ["mystagogus", 3]);
});
test("Android uses the same manual-flip and Free Board completion boundaries", () => {
  const { context: c, calls } = harness("android");
  c.spread = [{}, {}, {}];
  c.spread.forEach((entry) => c.revealEntry(entry));
  c.revealAll();
  assert.deepEqual(calls, [["tarot", 3]]);
  const state = { cards: [{}, {}], settings: { deckType: "mystagogus" } };
  c.notifyFreeBoardReadingCompleted(state, "reveal-all");
  c.notifyFreeBoardReadingCompleted(state, "reveal-all");
  assert.deepEqual(calls.at(-1), ["mystagogus", 2]);
  assert.equal(calls.length, 2);
});
test("the final manual flip also completes a reading without another Reveal All click", () => {
  const { context: c, calls } = harness();
  c.spread = [{}, {}, {}];
  c.revealEntry(c.spread[0]);
  c.revealEntry(c.spread[1]);
  assert.equal(calls.length, 0);
  c.revealEntry(c.spread[2]);
  c.revealAll();
  assert.deepEqual(calls, [["tarot", 3]]);
});
test("a complete preset saves once for manual, bulk, and mixed flips", () => {
  for (const path of ["manual", "bulk", "mixed"]) {
    const { context: c } = harness();
    let saves = 0;
    c.historyUiController = { saveCompletedReading() { saves++; } };
    c.spread = [{}, {}, {}];
    if (path !== "bulk") c.revealEntry(c.spread[0]);
    assert.equal(saves, 0);
    if (path === "manual") c.spread.forEach(entry => c.revealEntry(entry));
    else c.revealAll();
    c.revealAll();
    assert.equal(saves, 1);
    c.spread[1] = {};
    c.uidCounter++;
    c.revealEntry(c.spread[1]);
    assert.equal(saves, 2);
  }
});
test("free board Reveal All counts once until cleared; moves and history restore do not count", () => {
  const { context: c, calls } = harness();
  const state = { cards: [{}, {}], settings: { deckType: "lxxxi" } };
  c.notifyFreeBoardReadingCompleted(state, "move");
  c.notifyFreeBoardReadingCompleted(state, "restore");
  assert.equal(calls.length, 0);
  c.notifyFreeBoardReadingCompleted(state, "reveal-all");
  c.notifyFreeBoardReadingCompleted(state, "reveal-all");
  assert.deepEqual(calls, [["lxxxi", 2]]);
  c.notifyFreeBoardReadingCompleted({ cards: [] }, "clear");
  c.notifyFreeBoardReadingCompleted(state, "reveal-all");
  assert.equal(calls.length, 2);
});
test("optional or failed telemetry never interrupts Reveal All", () => {
  const { context: c } = harness();
  c.spread = [{}, {}, {}];
  c.DivinationWebTelemetry = undefined;
  assert.doesNotThrow(() => c.revealAll());
  c.readingReported = false;
  c.DivinationWebTelemetry = { isEnabled() { throw Error("blocked"); } };
  assert.doesNotThrow(() => c.revealAll());
});
