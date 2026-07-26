"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var historyUi = fs.readFileSync(path.join(root, "js", "history-ui.js"), "utf8");

test("history UI never renders imported data through innerHTML", function () {
  assert.equal(/\binnerHTML\b/.test(historyUi), false);
  assert.match(historyUi, /textContent/);
  assert.match(historyUi, /replaceChildren/);
});

test("history center has no notes, questions, titles or free-text editing controls", function () {
  assert.equal(/<textarea\b/i.test(html), false);
  assert.equal(/\bcontenteditable\b/i.test(html), false);
  var inputs = html.match(/<input\b[^>]*>/gi) || [];
  assert.deepEqual(inputs.map(function (input) {
    return (input.match(/\btype="([^"]+)"/i) || [null, "text"])[1].toLowerCase();
  }), ["file"]);
});

test("history modules load before the application module", function () {
  var recordsIndex = html.indexOf("js/history-records.js");
  var storeIndex = html.indexOf("js/history-store.js");
  var uiIndex = html.indexOf("js/history-ui.js");
  var appIndex = html.indexOf("js/app.js");
  assert.ok(recordsIndex > 0);
  assert.ok(recordsIndex < storeIndex);
  assert.ok(storeIndex < uiIndex);
  assert.ok(uiIndex < appIndex);
});
