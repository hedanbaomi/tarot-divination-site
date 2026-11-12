"use strict";

/*
 * Guard rails for the fan's rubber band at both ends of the deck.
 * The index must never leave [0, max]; the overshoot turns into a damped
 * sideways stretch of the cards near that end (the ones sitting low in the
 * arc), and those cards spring back when the finger lifts. The arc as a whole
 * must not move, otherwise the deck slides under the caption.
 */

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

test("overscroll is turned into a damped pull instead of an out-of-range index", function () {
  var move = between(ring, "function onMove(", "function onUp(");
  assert.match(move, /var clamped = raw < 0 \? 0 : raw > max \? max : raw;/);
  assert.match(move, /var over = raw - clamped;/);
  assert.match(move, /RUBBER_POW/);
  assert.match(move, /PULL_PX/);
  assert.match(move, /slide = clamped;/);
  assert.doesNotMatch(move, /slide = raw;/);
  assert.match(move, /Math\.pow\(Math\.abs\(over\), RUBBER_POW\)/);
});

test("the pull is capped, remembers which end was pulled, and follows the finger", function () {
  var move = between(ring, "function onMove(", "function onUp(");
  assert.match(move, /if \(over > 1\.2\) over = 1\.2;/);
  assert.match(move, /else if \(over < -1\.2\) over = -1\.2;/);
  /* dragging right (negative over) must move the end cards right */
  assert.match(move, /pullSide = over < 0 \? -1 : 1;/);
  assert.match(move, /pull = over === 0 \? 0 : pullSide \* -1 \* Math\.pow/);
  assert.match(ring, /var RUBBER_POW = 0\.55;/);
  assert.match(ring, /var PULL_PX = 78;/);
  assert.match(ring, /var RUBBER_EDGE = 0\.5;/);
  assert.match(ring, /var pull = 0;/);
  assert.match(ring, /var pullSide = 0;/);
});

test("only the cards at the pulled end stretch; the arc itself never translates", function () {
  var layout = between(ring, "function layout()", "function flyToSlot(");
  assert.match(layout, /var edgeDist = pullSide < 0 \? u : 1 - u;/);
  assert.match(layout, /if \(pull && edgeDist < RUBBER_EDGE\)/);
  assert.match(layout, /var k = 1 - edgeDist \/ RUBBER_EDGE;/);
  assert.match(layout, /stretch = pull \* Math\.pow\(k, 1\.5\);/);
  assert.match(layout, /card\.style\.translate = stretch \? stretch\.toFixed\(1\) \+ "px 0px" : "";/);
  assert.doesNotMatch(ring, /ring\.style\.transform = pull/);
  assert.doesNotMatch(layout, /ring\.style\.transform/);
});

test("layout keeps the index inside the deck and only resets the pull at rest", function () {
  assert.match(ring, /if \(!dragging && !springRaf\) pull = 0;/);
  assert.match(ring, /if \(slide < 0\) \{\s*slide = 0;/);
  assert.match(ring, /else if \(slide > max\) \{\s*slide = max;/);
  assert.doesNotMatch(ring, /slide = -0\.9|slide = max \+ 0\.9/);
});

test("release springs the pulled cards back with rAF easing", function () {
  var up = between(ring, "function onUp(", 'stage.addEventListener("pointerdown", onDown)');
  assert.match(up, /springBack\(\);/);
  assert.doesNotMatch(up, /pull = 0;/);

  var spring = between(ring, "function springBack()", "function onUp(");
  assert.match(spring, /if \(!pull\) return;/);
  assert.match(spring, /var from = pull;/);
  assert.match(spring, /\(now - t0\) \/ 380/);
  assert.match(spring, /1 - Math\.pow\(1 - t, 3\)/);
  assert.match(spring, /pull = from \* \(1 - eased\);/);
  assert.match(spring, /springRaf = window\.requestAnimationFrame\(step\);/);
});

test("grabbing the fan again stops a running spring", function () {
  var down = between(ring, "function onDown(", "function onMove(");
  assert.match(down, /if \(springRaf\) \{\s*window\.cancelAnimationFrame\(springRaf\);\s*springRaf = 0;/);
  assert.match(down, /pull = 0;/);
});

test("the author's spread-target guard is still in place", function () {
  assert.match(ring, /function isSpreadTarget\(event\) \{/);
  var down = between(ring, "function onDown(", "function onMove(");
  assert.match(down, /if \(isSpreadTarget\(event\)\) return;/);
});
