"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var ring = fs.readFileSync(path.join(root, "js/deck-ring.js"), "utf8");

function between(source, from, to) {
  var start = source.indexOf(from);
  assert.notEqual(start, -1, "missing anchor: " + from);
  var end = source.indexOf(to, start);
  assert.notEqual(end, -1, "missing anchor: " + to);
  return source.slice(start, end);
}

test("pointer moves merge into one layout per frame and reuse drag geometry", function () {
  var move = between(ring, "function onMove(", "function onUp(");
  /* the sync layout() call is gone; a single rAF is scheduled per frame */
  assert.doesNotMatch(move, /slide = clamped;\s*layout\(\);/);
  assert.match(move, /if \(moveRaf\) return;/);
  assert.match(move, /moveRaf = window\.requestAnimationFrame\(function \(\) \{/);
  var up = between(ring, "function onUp(", "stage.addEventListener(\"pointerdown\"");
  assert.match(up, /window\.cancelAnimationFrame\(moveRaf\);/);
  /* geometry writes its cache during a drag and invalidates it afterwards */
  var geo = between(ring, "function geometry()", "function layout()");
  assert.match(geo, /if \(dragging\) geomCache = g;/);
  assert.match(geo, /else if \(geomCache\) \{\s*geomCache = null;/);
  var down = between(ring, "function onDown(", "function onMove(");
  assert.match(down, /geomCache = null;\s*dragging = true;/);
});

test("card width follows the breakpoint so the visible count matches a fresh load", function () {
  var lay = between(ring, "function layout()", "function flyToSlot(");
  /* never keep the first measured width: 64px desktop vs 50px mobile */
  assert.doesNotMatch(lay, /ringCardW \|\| \(ringCardW = cards\[0\]\.offsetWidth/);
  assert.match(lay, /var cw = cards\[0\]\.offsetWidth \|\| 78;/);
  assert.match(lay, /if \(cw !== ringCardW\) ringCardW = cw;/);
});

test("Enter draws only when the table itself is focused; buttons keep their own Enter", function () {
  var key = between(ring, "stage.addEventListener(\"keydown\"", "if (window.MutationObserver) {");
  assert.match(key, /else if \(event\.key === "Enter"\) \{/);
  assert.match(key, /if \(event\.target !== stage\) return;/);
  assert.doesNotMatch(key, /var isCard = focused/);
  /* keyboard-synthesized clicks (detail 0) must not pick a nearby card */
  assert.match(ring, /if \(event\.detail === 0\) return;/);
});

test("the shuffle IIFE reads the same arc span as the fan", function () {
  var at = ring.indexOf("function playShuffle()");
  var shuffle = ring.slice(at - 900, at);
  assert.match(ring, /window\.DivinationDeckArc = ARC_SPREAD;/);
  assert.match(shuffle, /var ARC_SPREAD = window\.DivinationDeckArc \|\| 0\.82;/);
  /* the arc helper must not reach for a variable it cannot see */
  assert.match(ring, /var a = \(u \* 180 - 90\) \* ARC_SPREAD;/);
});

test("paging: Home and End stop a glide that is still running", function () {
  /* Arrow paging animates for 320 ms. If the user hits End during that glide,
     the old tween finished later and wrote its own target back, so the fan
     stopped short of the end and the chevron stayed enabled. */
  assert.match(ring, /function stopGlide\(\) \{/);
  assert.match(ring, /else if \(event\.key === "Home"\) \{ stopGlide\(\);/);
  assert.match(ring, /else if \(event\.key === "End"\) \{ stopGlide\(\);/);
  var fan = between(ring, "function pageFan(direction) {", "var start = 0;");
  assert.match(fan, /stopGlide\(\);/);
});
