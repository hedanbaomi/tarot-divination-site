"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var source = fs.readFileSync(
  path.join(__dirname, "../app/src/main/assets/www/js/back-handler.js"),
  "utf8"
);

test("unified back contract consumes only the first open overlay", function () {
  var calls = [];
  var context = {
    DivinationDialog: { handleBack: function () { calls.push("confirm"); return false; } },
    DivinationCustomSelects: { handleBack: function () { calls.push("choice"); return false; } },
    DivinationTelemetryNotice: { handleBack: function () { calls.push("privacy"); return false; } },
    DivinationCustomSpreadUi: { handleBack: function () { calls.push("custom-spread"); return false; } },
    DivinationHistoryUi: { handleBack: function () { calls.push("history"); return true; } },
    DivinationMenu: { handleBack: function () { calls.push("menu"); return true; } },
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "back-handler.js" });

  assert.equal(context.DivinationUiBack.handleBack(), true);
  assert.deepEqual(calls, ["confirm", "choice", "privacy", "custom-spread", "history"]);
  calls.length = 0;
  context.DivinationHistoryUi.handleBack = function () { calls.push("history"); return false; };
  assert.equal(context.DivinationUiBack.handleBack(), true);
  assert.deepEqual(calls, ["confirm", "choice", "privacy", "custom-spread", "history", "menu"]);
});

test("unified back contract returns false when no overlay is open", function () {
  var context = {
    DivinationDialog: { handleBack: function () { return false; } },
    DivinationCustomSelects: { handleBack: function () { return false; } },
    DivinationTelemetryNotice: { handleBack: function () { return false; } },
    DivinationCustomSpreadUi: { handleBack: function () { return false; } },
    DivinationHistoryUi: { handleBack: function () { return false; } },
    DivinationMenu: { handleBack: function () { return false; } },
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "back-handler.js" });
  assert.equal(context.DivinationUiBack.handleBack(), false);
});
