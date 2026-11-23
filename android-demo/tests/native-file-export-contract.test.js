"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../app/src/main/assets/www/js/native-file-export.js"), "utf8");

test("the PNG and text bridges share a picker without sharing receivers", () => {
  const calls = [];
  const results = [];
  const context = {
    androidHistoryExport: {
      save(content, name) { calls.push(["text", content, name]); },
      savePng(content, name) { calls.push(["png", content, name]); }
    }
  };
  vm.runInNewContext(source, context, { filename: "native-file-export.js" });
  const { save, savePng } = context.DivinationNativeFileExport;
  const text = (result) => results.push(["text", result]);
  const image = (result) => results.push(["png", result]);

  assert.equal(save("{}", "backup.json", text), true);
  assert.equal(savePng("iVBORw0KGgo=", "reading.png", image), false);
  context.__quareiaHistoryExportResult({ ok: true, fileName: "provider-name.png" });
  assert.equal(savePng("iVBORw0KGgo=", "reading.png", image), true);
  assert.equal(save("# Reading", "reading.md", text), false);
  context.__quareiaHistoryExportResult({ ok: false, cancelled: true });
  assert.deepEqual(calls, [
    ["text", "{}", "backup.json"],
    ["png", "iVBORw0KGgo=", "reading.png"]
  ]);
  assert.deepEqual(results, [
    ["text", { ok: true, fileName: "provider-name.png" }],
    ["png", { ok: false, cancelled: true }]
  ]);
});

test("a native busy return or exception releases the JavaScript reservation", () => {
  const context = {
    androidHistoryExport: {
      save() { return true; },
      savePng() { return false; }
    }
  };
  vm.runInNewContext(source, context, { filename: "native-file-export.js" });
  const { save, savePng } = context.DivinationNativeFileExport;
  let received;

  assert.equal(savePng("iVBORw0KGgo=", "reading.png", assert.fail), false);
  context.androidHistoryExport.savePng = () => { throw new Error("bridge unavailable"); };
  assert.throws(() => savePng("iVBORw0KGgo=", "reading.png", assert.fail), /bridge unavailable/);
  assert.equal(save("# Reading", "reading.md", (result) => { received = result; }), true);
  const saved = { ok: true };
  context.__quareiaHistoryExportResult(saved);
  assert.equal(received, saved);
});

test("pagehide discards the old document receiver for a back navigation", () => {
  let pagehide;
  const context = {
    addEventListener(event, callback) {
      if (event === "pagehide") pagehide = callback;
    },
    androidHistoryExport: {
      save() { return true; },
      savePng() { return true; }
    }
  };
  vm.runInNewContext(source, context, { filename: "native-file-export.js" });
  const { save, savePng } = context.DivinationNativeFileExport;
  let received;

  assert.equal(savePng("iVBORw0KGgo=", "reading.png", assert.fail), true);
  pagehide();
  assert.equal(save("{}", "backup.json", (result) => { received = result; }), true);
  const saved = { ok: true };
  context.__quareiaHistoryExportResult(saved);
  assert.equal(received, saved);
});
