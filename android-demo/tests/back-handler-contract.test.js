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

test("notes opened from history or a card overlay consume the first system back", () => {
  for (const underlying of ["DivinationHistoryUi", "DivinationCardOverlays", "DivinationMenu"]) {
    const calls = [];
    let noteOpen = true;
    const context = {
      DivinationCardNotes: { handleBack() {
        calls.push("notes");
        if (!noteOpen) return false;
        noteOpen = false;
        return true;
      }},
      [underlying]: { handleBack() { calls.push(underlying); return true; } }
    };
    vm.runInNewContext(source, context);
    assert.equal(context.DivinationUiBack.handleBack(), true);
    assert.deepEqual(calls, ["notes"]);
    assert.equal(context.DivinationUiBack.handleBack(), true);
    assert.deepEqual(calls, ["notes", "notes", underlying]);
  }
});

test("an image preview opened from a history entry closes before the history panel", () => {
  const calls = [];
  let previewOpen = true;
  const context = {
    DivinationReadingImageUi: { handleBack() {
      calls.push("image");
      if (!previewOpen) return false;
      previewOpen = false;
      return true;
    }},
    DivinationHistoryUi: { handleBack() { calls.push("history"); return true; } }
  };
  vm.runInNewContext(source, context);
  assert.equal(context.DivinationUiBack.handleBack(), true);
  assert.deepEqual(calls, ["image"]);
  assert.equal(context.DivinationUiBack.handleBack(), true);
  assert.deepEqual(calls, ["image", "image", "history"]);
});
