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
  assert.match(html, /src="js\/i18n\.js\?v=20260729-attribution"/);
  assert.match(html, /src="js\/app\.js\?v=20260729-attribution"/);
  assert.match(html, /href="css\/styles\.css\?v=20260729-attribution"/);
});

test("footer carries the non-commercial attribution, creators, Quareia link, and Josephine quote", function () {
  var html = read(surface.html);
  var i18n = read(surface.i18n);
  var css = read(surface.css);
  assert.match(html, /class="attribution"/);
  assert.match(html, /href="https:\/\/www\.quareia\.com"/);
  assert.match(
    html,
    /safer, a lot more accurate and far more powerful/
  );
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
