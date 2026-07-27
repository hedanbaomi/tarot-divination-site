"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("website replaces every native select surface with the themed card picker", function () {
  var html = read("index.html");
  var css = read("css/styles.css");
  var picker = read("js/custom-selects.js");
  var i18n = read("js/i18n.js");

  [
    "deckSelect",
    "modeSelect",
    "arcanaFilter",
    "overviewMethod",
    "spreadSelect",
    "historyDeckFilter"
  ].forEach(function (id) {
    assert.match(html, new RegExp('<select[^>]*id="' + id + '"'));
  });

  assert.match(html, /id="choiceDialog"/);
  assert.match(html, /src="js\/custom-selects\.js\?v=20260727-card-picker"/);
  assert.match(css, /\.custom-select-native\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.themed-select-trigger/);
  assert.match(css, /\.choice-option\.selected/);
  assert.match(picker, /document\.querySelectorAll\("select"\)/);
  assert.match(picker, /select\.dispatchEvent\(new Event\("change"/);
  assert.match(i18n, /"choice\.kicker": "纸牌选择"/);
  assert.match(i18n, /"choice\.kicker": "CARD PICKER"/);
  assert.doesNotMatch(html + i18n, /星图选择|CELESTIAL PICKER/);
  assert.doesNotMatch(picker, /\b(?:alert|confirm|prompt)\s*\(/);
});

test("website picker resynchronizes after custom confirmation settles", function () {
  var picker = read("js/custom-selects.js");
  var dialogs = read("js/dialogs.js");
  assert.match(picker, /quareia:dialogsettled/);
  assert.match(dialogs, /quareia:dialogsettled/);
});
