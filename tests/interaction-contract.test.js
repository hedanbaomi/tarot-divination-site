"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.resolve(__dirname, "..");
var surface = {
  app: "js/app.js",
  css: "css/styles.css",
  html: "index.html",
  i18n: "js/i18n.js",
  dialogs: "js/dialogs.js",
  history: "js/history-ui.js"
};

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("website uses the branded dialog for spread and history confirmations", function () {
  var app = read(surface.app);
  var history = read(surface.history);
  var dialogs = read(surface.dialogs);
  var html = read(surface.html);
  assert.doesNotMatch(app + history + dialogs, /\b(?:alert|confirm|prompt)\s*\(/);
  assert.match(app, /DivinationDialog\.request/);
  [
    "mode",
    "arcana",
    "overview",
    "spread",
    "deck",
    "shuffle"
  ].forEach(function (action) {
    assert.match(app, new RegExp('await confirmIfSpread\\(t\\("confirm\\.' + action + '"\\)\\)'));
  });
  assert.match(history, /await requestDeletion\(t\("history\.deleteConfirm"\)\)/);
  assert.match(history, /await requestDeletion\(t\("history\.clearConfirm"\)\)/);
  assert.match(dialogs, /root\.DivinationDialog = \{ request: request \}/);
  assert.match(html, /<dialog class="confirm-overlay" id="confirmDialog"/);
  assert.match(html, /id="confirmCancelBtn"/);
  assert.match(html, /id="confirmProceedBtn"/);
  assert.match(html, /src="js\/dialogs\.js\?v=20260727-card-picker"/);
  assert.match(html, /src="js\/spreads\.js\?v=20260727-spread-labels"/);
  assert.match(html, /src="js\/app\.js\?v=20260809-free-board-v1"/);
});

test("root page pins the web-announcement resource cache versions", function () {
  var html = read(surface.html);
  assert.match(html, /src="js\/i18n\.js\?v=20260813-themes"/);
  assert.match(html, /href="css\/styles\.css\?v=20260813-parchment-chrome"/);
  assert.match(html, /src="js\/announcements\.js\?v=1"/);
});

test("footer limits the non-commercial boundary to protected materials", function () {
  var html = read(surface.html);
  var i18n = read(surface.i18n);
  var css = read(surface.css);
  assert.match(html, /class="attribution"/);
  assert.match(html, /href="https:\/\/www\.quareia\.com"/);
  assert.match(
    html,
    /safer, a lot more accurate and far more powerful/
  );
  assert.match(i18n, /2026-08-05/);
  assert.match(i18n, /paywall/);
  assert.match(i18n, /paid unlock/);
  assert.match(i18n, /commercial use requires separate permission/);
  assert.match(i18n, /not a general commercial-use ban/);
  assert.match(html, /设置付费墙或付费解锁/);
  assert.match(html, /商业利用须另行取得授权/);
  assert.doesNotMatch(i18n, /strictly non-commercial tool/);
  ["attribution.status", "attribution.mystagogusRights", "attribution.lxxxiRights",
    "attribution.quareiaLink", "attribution.quoteCite"].forEach(function (key) {
    assert.ok(i18n.indexOf('"' + key + '"') !== -1, "missing i18n key " + key);
  });
  ["zh-CN", "en"].forEach(function (locale) {
    var block = i18n.match(new RegExp('"' + locale + '": \\{[\\s\\S]*?\\n    \\}'))[0];
    assert.ok(block.indexOf('"attribution.status"') !== -1, locale + " missing attribution.status");
    assert.ok(block.indexOf('"attribution.mystagogusRights"') !== -1, locale + " missing mystagogus rights");
    assert.ok(block.indexOf('"attribution.lxxxiRights"') !== -1, locale + " missing lxxxi rights");
  });
  assert.match(css, /\.attribution\b/);
  assert.match(css, /\.attribution-quote\b/);
});

test("revealed cards can flip between artwork and an in-place meaning panel", function () {
  var app = read(surface.app);
  var css = read(surface.css);
  var i18n = read(surface.i18n);
  assert.match(app, /entry\.meaningVisible = !entry\.meaningVisible/);
  assert.match(app, /classList\.toggle\("meaning-visible", Boolean\(entry\.meaningVisible\)\)/);
  assert.match(app, /spread-card-meaning-text/);
  assert.match(app, /getEntryInterpretation/);
  assert.match(css, /\.spread-card\.revealed\.meaning-visible \.spread-card-inner/);
  assert.match(css, /rotateY\(360deg\)/);
  assert.match(i18n, /"app\.meaningAria"/);
  assert.match(i18n, /"app\.meaningHint"/);
});

test("Free Board gestures keep viewport transforms, orientation, and board rotation separate", function () {
  var app = read(surface.app);
  var ui = read("js/free-board-ui.js");
  var draft = read("js/free-board-draft.js");
  var css = read("css/free-board.css");
  assert.match(app, /var layoutMode = "preset"/);
  assert.match(app, /function freeBoardCardsForDeck\(type, filter\)/);
  assert.match(app, /majors\.concat\(minors\)/);
  assert.match(app, /minors\.concat\(majors\)/);
  assert.match(ui, /function handlePointerDown\(event\)/);
  assert.match(ui, /setPointerCapture/);
  assert.match(ui, /function pinchViewport/);
  assert.match(ui, /function handleWheel\(event\)/);
  assert.match(ui, /mutate\("move", \[gesture\.cardId, moved\.x, moved\.y\]/);
  assert.match(ui, /style\.transform = "translate3d\("/);
  assert.match(ui, /value\.boardRotation \+ "deg/);
  assert.match(ui, /className = "free-board-card-inner"/);
  assert.match(draft, /quareia-divination-free-board-draft-v1/);
  assert.match(css, /\.free-board-viewport\s*\{[\s\S]*touch-action: none/);
  assert.match(css, /\.free-board-viewport\s*\{[\s\S]*overscroll-behavior: contain/);
  assert.doesNotMatch(css, /body\s*\{[^}]*touch-action/);
});

test("Free Board taps select only, while external meaning and automatic history controls remain", function () {
  var html = read("index.html");
  var app = read("js/app.js");
  var ui = read("js/free-board-ui.js");
  var css = read("css/free-board.css");
  var finishPointer = ui.match(/function finishPointer\(event\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    function handleWheel/)[0];

  assert.doesNotMatch(html, /freeBoardClearBtn|freeBoardSaveBtn/);
  assert.match(html, /freeBoardDiscardDraftBtn/);
  assert.match(html, /data-card-control-action="toggle-meaning"/);
  assert.doesNotMatch(ui, /free-board-card-toolbar/);
  assert.doesNotMatch(finishPointer, /mutate\("reveal"|toggleMeaning/);
  assert.match(ui, /case "toggle-meaning"/);
  assert.match(ui, /selected\.revealed/);
  assert.match(ui, /function revealAll\(\)[\s\S]*saveHistory\(\)/);
  assert.match(ui, /freeBoard\.drawOrder/);
  assert.match(css, /data-free-board-platform="android"/);
  assert.match(app, /layoutMode === "preset" && deckType === "tarot" && selectedSpreadId === "overview"/);
});
