"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var ring = fs.readFileSync(path.join(root, "js/deck-ring.js"), "utf8");
var sources = {
  app: fs.readFileSync(path.join(root, "js/app.js"), "utf8"),
  i18n: fs.readFileSync(path.join(root, "js/i18n.js"), "utf8"),
  html: fs.readFileSync(path.join(root, "index.html"), "utf8"),
  css: fs.readFileSync(path.join(root, "css/redesign.css"), "utf8")
};

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
  var shuffle = fs.readFileSync(path.join(root, "js/deck-shuffle.js"), "utf8");
  assert.match(ring, /window\.DivinationDeckArc = ARC_SPREAD;/);
  assert.match(shuffle, /var ARC_SPREAD = window\.DivinationDeckArc \|\| 0\.82;/);
  /* the arc helper must not reach for a variable it cannot see */
  assert.match(shuffle, /var a = \(u \* 180 - 90\) \* ARC_SPREAD;/);
});

test("hold-to-shuffle is announced in both languages and hinted in place", function () {
  assert.match(sources.html, /id="shuffleBtn"[^>]*data-i18n-title="deck\.shuffleHold"/);
  assert.match(sources.html, /<span class="shuffle-hold-hint" id="shuffleHint" data-i18n="deck\.shuffleRelease"/);
  /* the hint must be labelled by the language switch, not left as a hardcoded string */
  assert.match(sources.i18n, /"deck\.shuffleHold": "按住不放/);
  assert.match(sources.i18n, /"deck\.shuffleRelease": "松手收牌"/);
  assert.match(sources.i18n, /"deck\.shuffleHold": "Hold to keep shuffling/);
  assert.match(sources.i18n, /"deck\.shuffleRelease": "Release to collect"/);
  assert.match(sources.i18n, /\[data-i18n-title\]/);

  /* press feedback and the hint both hang off the button without shifting the row */
  assert.match(sources.css, /html\.ui2 #shuffleBtn \{[\s\S]*?touch-action: none;/);
  assert.match(sources.css, /html\.ui2 #shuffleBtn\.is-holding \{/);
  assert.match(sources.css, /html\.ui2 #shuffleBtn\.is-holding \+ \.shuffle-hold-hint \{/);
  assert.match(sources.css, /html\.ui2 \.shuffle-hold-hint \{[\s\S]*?position: absolute;/);
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

test("portrait fan geometry preserves constant top gap and accounts for wrapped header height", function () {
  var androidRing = fs.readFileSync(
    path.join(root, "android-demo/app/src/main/assets/www/js/deck-ring.js"),
    "utf8"
  );
  [ring, androidRing].forEach(function (source) {
    var geo = between(source, "function geometry()", "function layout()");
    assert.doesNotMatch(geo, /ch \* 1\.08|w < 620 \? 1\.08/);
    assert.match(geo, /var spreadSpan = count === 0 \? 0 : \(w < 620 \? ch : ch \* 0\.86\);/);
    assert.match(geo, /plane\.style\.minHeight = h \+ "px";/);
    assert.match(geo, /var chromeH = /);
  });
});
