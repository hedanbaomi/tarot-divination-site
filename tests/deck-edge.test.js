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
  /* no same-side early return any more: after the 1.3 s restore, the next
     end hit must flash again (each independent action gives its own hint) */
  assert.doesNotMatch(fn, /if \(edgeSide === dir\) return;/);
  assert.match(fn, /document\.querySelector\("\.table-hint"\)/);
  assert.match(fn, /var key = dir < 0 \? "table\.edgeStart" : "table\.edgeEnd";/);
  assert.match(fn, /el\.textContent = text;/);
  assert.match(fn, /el\.classList\.add\("is-edge"\);/);
  assert.match(fn, /el\.classList\.remove\("is-edge"\);/);
  /* the restore must clear edgeSide so a later hit can flash again */
  assert.match(fn, /el\.classList\.remove\("is-edge"\);\s*edgeSide = 0;/);
  assert.match(fn, /\}, 1300\);/);
  /* restoring reads the original key, so a language switch still lands right */
  assert.match(fn, /hintKey = el\.getAttribute\("data-i18n"\) \|\| "table\.dragHint";/);
  assert.match(fn, /var back = api && api\.t \? api\.t\(hintKey\) : "";/);
});

test("the end chevron looks disabled but still answers clicks with the hint", function () {
  var fn = between(ring, "function syncFanNav()", "function pageFan(");
  /* no disabled attribute: it would swallow the click and the keyboard
     activation, and the reviewer's "click the grey arrow" would stay silent */
  assert.doesNotMatch(fn, /\.disabled = /);
  assert.match(fn, /setAttribute\("aria-disabled", pEnd \? "true" : "false"\);/);
  assert.match(fn, /classList\.toggle\("is-at-end", pEnd\);/);
  assert.match(fn, /setAttribute\("aria-disabled", nEnd \? "true" : "false"\);/);
  assert.match(fn, /classList\.toggle\("is-at-end", nEnd\);/);
  assert.match(css, /html\.ui2 \.fan-nav-btn:disabled,\r?\nhtml\.ui2 \.fan-nav-btn\.is-at-end \{/);
  assert.match(css, /html\.ui2 \.fan-nav-btn\.is-at-end:hover svg \{ transform: none; \}/);
});

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
