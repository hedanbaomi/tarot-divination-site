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
  var at = ring.indexOf("function playShuffle()");
  var shuffle = ring.slice(at - 900, at);
  assert.match(ring, /window\.DivinationDeckArc = ARC_SPREAD;/);
  assert.match(shuffle, /var ARC_SPREAD = window\.DivinationDeckArc \|\| 0\.82;/);
  /* the arc helper must not reach for a variable it cannot see */
  assert.match(ring, /var a = \(u \* 180 - 90\) \* ARC_SPREAD;/);
});

test("hold-to-shuffle keeps riffing until the finger lifts, then fans out once", function () {
  var api = between(ring, "globalThis.DivinationShuffle = {", "globalThis.addEventListener(\"quareia:shuffled\"");
  [
    "begin: begin",
    "release: release",
    "finish: finish",
    "cancel: cancel",
    "isRunning: function () { return running; }",
    "isHolding: function () { return holding; }"
  ].forEach(function (line) {
    assert.ok(api.indexOf(line) !== -1, "missing API member: " + line);
  });

  /* releasing only drops the flag: the running riffle finishes, the cards stay piled */
  var release = between(ring, "function release() {", "/* 收牌摊开");
  assert.match(release, /holding = false;/);
  assert.doesNotMatch(release, /cleanup\(|fanOut\(/);

  /* finishing waits for the pile instead of cutting the riffle in half */
  var finish = between(ring, "function finish() {", "/* 放弃这次洗牌");
  assert.match(finish, /finishPending = true;/);
  assert.match(finish, /if \(session && session\.idle\) fanOut\(session\);/);

  /* a second press while the fan is still spreading must not start a new overlay */
  assert.match(ring, /session && session\.fanning\) \{\s*return false;/);

  /* cancelling must not be undone by the riffle that is still in flight */
  var cancel = between(ring, "function cancel() {", "globalThis.DivinationShuffle = {");
  assert.match(cancel, /s\.cancelled = true;/);
  assert.match(ring, /if \(!running \|\| s\.fanning \|\| s\.cancelled\) return;/);

  /* every exit path is rescued: an idle pile after release, a stuck finger after 30s */
  assert.match(ring, /if \(!holding && idleFor > 8000\) finish\(\);/);
  assert.match(ring, /else if \(holding && idleFor > 30000\) finish\(\);/);

  /* keyboard and the clear button still get the single wash-and-spread */
  var single = between(ring, "function playShuffle() {", "/* 摊开的牌收成两摞");
  assert.match(single, /if \(running\) return;/);
  assert.match(single, /if \(begin\(\)\) finish\(\);/);
});

test("the shuffle button starts on press and settles on release", function () {
  /* press starts the ritual immediately, capture keeps it alive outside the button */
  var begin = between(sources.app, "function beginShuffleHold(event) {", "function endShuffleHold(event) {");
  assert.match(begin, /if \(shuffleHold\.pointerId !== null\) return;/);
  assert.match(begin, /el\.shuffleBtn\.classList\.add\("is-holding"\);/);
  assert.match(begin, /el\.shuffleBtn\.setPointerCapture\(event\.pointerId\);/);
  assert.match(begin, /visual\.begin\(\)/);

  var end = between(sources.app, "function endShuffleHold(event) {", "function handleShuffleClick(event) {");
  assert.match(end, /shuffleHold\.pointerId = null;/);
  assert.match(end, /shuffleHold\.suppressClickUntil = Date\.now\(\) \+ 700;/);
  assert.match(end, /el\.shuffleBtn\.classList\.remove\("is-holding"\);/);
  assert.match(end, /visual\.release\(\)/);
  assert.match(end, /settleShuffleHold\(\)/);

  /* the synthetic click that follows a long press must not shuffle a second time */
  var click = between(sources.app, "function handleShuffleClick(event) {", "function leaveFreeform(");
  assert.match(click, /if \(event\.detail !== 0 && Date\.now\(\) < shuffleHold\.suppressClickUntil\) return;/);

  /* while the gesture owns the button, the plain click path stays out of the way */
  var handle = between(sources.app, "async function handleShuffle() {", "/* 松手：手已经把牌洗好了");
  assert.match(handle, /if \(shuffleHold\.pointerId !== null\) return;/);

  assert.match(sources.app, /confirmShuffleIfNeeded\(\)\.then\(function \(allowed\) \{/);
  assert.match(sources.app, /if \(visual\.cancel\) visual\.cancel\(\);/);
  assert.match(sources.app, /if \(visual\.finish\) visual\.finish\(\);/);
});

test("only the shuffle button holds; the clear button keeps the plain wash", function () {
  assert.match(sources.app, /el\.shuffleBtn\.addEventListener\("pointerdown", beginShuffleHold\);/);
  assert.match(sources.app, /el\.shuffleBtn\.addEventListener\("pointerup", endShuffleHold\);/);
  assert.match(sources.app, /el\.shuffleBtn\.addEventListener\("pointercancel", endShuffleHold\);/);
  assert.match(sources.app, /el\.shuffleBtn\.addEventListener\("click", handleShuffleClick\);/);
  assert.match(sources.app, /if \(el\.clearBtn\) el\.clearBtn\.addEventListener\("click", handleShuffle\);/);
  /* the touch long-press menu would eat the gesture mid-shuffle */
  assert.match(sources.app, /if \(shuffleHold\.pointerId !== null\) event\.preventDefault\(\);/);
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
