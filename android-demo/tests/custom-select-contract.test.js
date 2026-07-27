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
  assert.match(html, /src="js\/custom-selects\.js\?v=20260727-card-picker"/);
  assert.match(css, /\.custom-select-native\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.themed-select-trigger/);
  assert.match(css, /\.choice-option\.selected/);
  assert.match(picker, /document\.querySelectorAll\("select"\)/);
  assert.match(picker, /select\.dispatchEvent\(new Event\("change"/);
  assert.doesNotMatch(html, /星图选择|CELESTIAL PICKER/);
  assert.doesNotMatch(picker, /\b(?:alert|confirm|prompt)\s*\(/);
});

test("themed picker resynchronizes after custom confirmation settles", function () {
  var picker = read("app/src/main/assets/www/js/custom-selects.js");
  var dialogs = read("app/src/main/assets/www/js/dialogs.js");
  assert.match(picker, /quareia:dialogsettled/);
  assert.match(dialogs, /quareia:dialogsettled/);
});

test("Android settings collapse to one bounded column on narrow screens", function () {
  var css = read("app/src/main/assets/www/css/styles.css");
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.setting-group\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.themed-select-trigger\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*480px\)[\s\S]*?\.settings-body\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );
});
