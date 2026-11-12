"use strict";

/*
 * Guard rails for the fan's rubber band at both ends of the deck.
 * The index must never leave [0, max]; the overshoot turns into a whole-arc
 * translation that springs back through CSS, so no card is ever dropped.
 */

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var ring = fs.readFileSync(path.join(root, "js/deck-ring.js"), "utf8");
var css = fs.readFileSync(path.join(root, "css/redesign.css"), "utf8");

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
  assert.match(move, /pull = /);
  assert.match(move, /RUBBER_POW/);
  assert.match(move, /PULL_PX/);
  assert.match(move, /slide = clamped;/);
  assert.doesNotMatch(move, /slide = raw;/);
  assert.match(move, /Math\.pow\(Math\.abs\(over\), RUBBER_POW\)/);
});

test("the pull is capped and follows the finger", function () {
  var move = between(ring, "function onMove(", "function onUp(");
  assert.match(move, /if \(over > 1\.2\) over = 1\.2;/);
  assert.match(move, /else if \(over < -1\.2\) over = -1\.2;/);
  /* dragging right (negative over) must move the arc right, i.e. positive translate */
  assert.match(move, /\(over < 0 \? 1 : -1\)/);
  assert.match(ring, /var RUBBER_POW = 0\.55;/);
  assert.match(ring, /var PULL_PX = 92;/);
  assert.match(ring, /var pull = 0;/);
});

test("layout keeps the index inside the deck and resets the pull at rest", function () {
  assert.match(ring, /if \(!dragging\) pull = 0;/);
  assert.match(ring, /if \(slide < 0\) \{\s*slide = 0;/);
  assert.match(ring, /else if \(slide > max\) \{\s*slide = max;/);
  assert.match(ring, /ring\.style\.transform = pull \? "translateX\(" \+ pull\.toFixed\(1\) \+ "px\)" : "";/);
  assert.doesNotMatch(ring, /slide = -0\.9|slide = max \+ 0\.9/);
});

test("release clears the pull and the arc springs back through CSS", function () {
  var up = between(ring, "function onUp(", "stage.addEventListener(\"pointerdown\", onDown)");
  assert.match(up, /pull = 0;/);
  assert.match(css, /html\.ui2 \.deck-ring \{\s*transition: transform 430ms cubic-bezier\(\.22, \.9, \.28, 1\);/);
  assert.match(css, /html\.ui2 \.table-stage\.is-dragging \.deck-ring \{\s*transition: none;/);
});
