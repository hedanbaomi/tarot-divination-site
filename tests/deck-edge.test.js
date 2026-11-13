"use strict";

/*
 * The fan stops dead at both ends of the deck. There is no rubber band any
 * more: the index never leaves [0, max], and "you are at the end" is told by
 * the hint line under the arc (temporarily replaced with one sentence, then
 * restored) plus the already-disabled chevron on that side.
 */

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var ring = fs.readFileSync(path.join(root, "js/deck-ring.js"), "utf8");
var css = fs.readFileSync(path.join(root, "css/redesign.css"), "utf8");
var i18n = fs.readFileSync(path.join(root, "js/i18n.js"), "utf8");

function between(source, from, to) {
  var start = source.indexOf(from);
  assert.notEqual(start, -1, "missing anchor: " + from);
  var end = source.indexOf(to, start);
  assert.notEqual(end, -1, "missing anchor: " + to);
  return source.slice(start, end);
}

test("the rubber band is gone: no pull state, no spring, no per-card stretch", function () {
  assert.doesNotMatch(ring, /RUBBER_POW|RUBBER_EDGE|PULL_PX/);
  assert.doesNotMatch(ring, /var pull = 0;|var pullSide = 0;|var springRaf = 0;/);
  assert.doesNotMatch(ring, /function springBack\(/);
  assert.doesNotMatch(ring, /card\.style\.translate/);
  assert.doesNotMatch(ring, /ring\.style\.transform = pull/);
});

test("dragging past an end only clamps the index and flashes the end hint", function () {
  var move = between(ring, "function onMove(", "function onUp(");
  assert.match(move, /var clamped = raw < 0 \? 0 : raw > max \? max : raw;/);
  assert.match(move, /if \(clamped !== raw\) flashEdge\(raw < 0 \? -1 : 1\);/);
  assert.match(move, /else edgeSide = 0;/);
  assert.match(move, /slide = clamped;/);
  assert.doesNotMatch(move, /slide = raw;/);
});

test("flashEdge swaps the hint line for one sentence and puts it back", function () {
  var fn = between(ring, "function flashEdge(", "function pageFan(");
  assert.match(fn, /if \(edgeSide === dir\) return;/);
  assert.match(fn, /document\.querySelector\("\.table-hint"\)/);
  assert.match(fn, /var key = dir < 0 \? "table\.edgeStart" : "table\.edgeEnd";/);
  assert.match(fn, /el\.textContent = text;/);
  assert.match(fn, /el\.classList\.add\("is-edge"\);/);
  assert.match(fn, /el\.classList\.remove\("is-edge"\);/);
  assert.match(fn, /\}, 1300\);/);
  /* restoring reads the original key, so a language switch still lands right */
  assert.match(fn, /hintKey = el\.getAttribute\("data-i18n"\) \|\| "table\.dragHint";/);
  assert.match(fn, /var back = api && api\.t \? api\.t\(hintKey\) : "";/);
});

test("pressing the paging button at an end says the same thing", function () {
  var fan = between(ring, "function pageFan(", "function drawCenteredCard(");
  assert.match(fan, /flashEdge\(direction < 0 \? -1 : 1\);/);
  assert.match(fan, /slide = from;\s*layout\(\);\s*syncFanNav\(\);/);
});

test("both locales carry the two sentences and the hint has a visible state", function () {
  ["table.edgeStart", "table.edgeEnd"].forEach(function (key) {
    var count = i18n.split('"' + key + '"').length - 1;
    assert.equal(count, 2, key + " must exist in both locales");
  });
  assert.match(css, /html\.ui2 \.table-hint\.is-edge \{/);
  assert.match(css, /html\.ui2 \.table-hint\.is-edge \{[^}]*color: var\(--accent-light\);/);
});
