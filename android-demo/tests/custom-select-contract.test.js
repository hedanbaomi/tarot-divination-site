"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var demoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(demoRoot, relativePath), "utf8");
}

test("Android demo replaces every native select surface with the themed picker", function () {
  var html = read("app/src/main/assets/www/index.html");
  var css = read("app/src/main/assets/www/css/styles.css");
  var picker = read("app/src/main/assets/www/js/custom-selects.js");

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
  assert.match(html, /src="js\/custom-selects\.js\?v=20260727-themed-selects"/);
  assert.match(css, /\.custom-select-native\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.themed-select-trigger/);
  assert.match(css, /\.choice-option\.selected/);
  assert.match(picker, /document\.querySelectorAll\("select"\)/);
  assert.match(picker, /select\.dispatchEvent\(new Event\("change"/);
  assert.doesNotMatch(picker, /\b(?:alert|confirm|prompt)\s*\(/);
});

test("themed picker resynchronizes after custom confirmation settles", function () {
  var picker = read("app/src/main/assets/www/js/custom-selects.js");
  var dialogs = read("app/src/main/assets/www/js/dialogs.js");
  assert.match(picker, /quareia:dialogsettled/);
  assert.match(dialogs, /quareia:dialogsettled/);
});
