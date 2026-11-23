const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const android = "android-demo/app/src/main/assets/www";
const read = file => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("one Android save picker routes success, failure and cancellation back to its requester", () => {
  const writes = [];
  const window = { androidHistoryExport: { save(content, file) { writes.push([content, file]); } } };
  vm.runInNewContext(read("js/native-file-export.js"), window);
  const picker = window.DivinationNativeFileExport;
  const notes = [], history = [];
  assert.equal(picker.save("notes", "card-notes.json", r => notes.push(r)), true);
  assert.equal(picker.save("readings", "tarot-history.json", r => history.push(r)), false);
  window.__quareiaHistoryExportResult({ ok: true, fileName: "renamed.json" });
  assert.deepEqual(notes, [{ ok: true, fileName: "renamed.json" }]);
  assert.equal(picker.save("md", "reading.md", r => history.push(r)), true);
  window.__quareiaHistoryExportResult({ cancelled: true });
  assert.deepEqual(history, [{ cancelled: true }]);
  assert.deepEqual(writes, [["notes", "card-notes.json"], ["md", "reading.md"]]);
  window.androidHistoryExport.save = () => { throw new Error("Storage unavailable"); };
  assert.throws(() => picker.save("notes", "notes.json", r => notes.push(r)));
  window.androidHistoryExport.save = () => window.__quareiaHistoryExportResult({ ok: false });
  assert.equal(picker.save("backup", "history.json", r => history.push(r)), true);
  assert.deepEqual(history.at(-1), { ok: false });
  assert.equal(notes.length, 1);
});

test("personal notes use local text controls and isolated data paths on all four pages", () => {
  for (const tree of ["", android]) {
    for (const filename of ["js/card-notes.js", "js/card-notes-store.js"]) {
      const source = read(path.join(tree, filename));
      assert.doesNotMatch(source, /\b(?:innerHTML|outerHTML|insertAdjacentHTML|fetch|XMLHttpRequest|sendBeacon|WebSocket|androidTelemetry|DivinationWebTelemetry|DivinationAiUi)\b/);
      assert.doesNotMatch(source, /\b(?:alert|confirm|prompt)\s*\(/);
      assert.equal(source, read(filename));
    }
    for (const page of ["index.html", "classic.html"]) {
      const html = read(path.join(tree, page));
      assert.match(html, /<textarea id="cardNotesText"[^>]*><\/textarea>/);
      assert.doesNotMatch(html.match(/<textarea id="cardNotesText"[^>]*>/)[0], /maxlength/);
      for (const file of ["card-notes-store", "native-file-export", "card-notes"]) {
        assert.ok(html.indexOf("js/" + file + ".js") > 0);
        assert.ok(html.indexOf("js/" + file + ".js") < html.indexOf("js/history-ui.js"));
      }
    }
  }
});

test("back during a conflict reload waits for one read and never enables edits that could be overwritten", async () => {
  const ids = new Map();
  function element() {
    const events = new Map();
    return {
      dataset: {}, classList: { toggle() {}, contains() { return false; } },
      value: "", addEventListener(type, listener) { events.set(type, listener); },
      click() { events.get("click")({ stopPropagation() {} }); },
      setAttribute() {}, focus() {}, showModal() { this.open = true; }, close() { this.open = false; }
    };
  }
  const document = {
    getElementById(id) {
      if (!ids.has(id)) ids.set(id, element());
      return ids.get(id);
    },
    createElement: element, querySelectorAll: () => [], addEventListener() {}
  };
  let resolveReload;
  let reads = 0;
  const store = {
    keys: async () => [],
    get() {
      if (++reads === 1) return Promise.resolve({ text: "original" });
      return new Promise(resolve => { resolveReload = resolve; });
    },
    save() { return Promise.reject(Object.assign(new Error("conflict"), { code: "conflict" })); }
  };
  const context = { document, setTimeout, clearTimeout, addEventListener() {},
    tarotDeckFull: [{ id: "major-00", name: "The Fool" }], lxxxiDeckFull: [], mystagogusDeckFull: [],
    DivinationCardNotesStore: { createStore: () => store },
    DivinationI18n: { t: id => id, field: (value, id) => value[id] } };
  vm.runInNewContext(read("js/card-notes.js"), context);
  const api = context.DivinationCardNotes;
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const input = document.getElementById("cardNotesText");
  api.createButton("tarot", "major-00").click();
  await settle();
  input.value = "my unsaved draft";
  assert.equal(api.handleBack(), true);
  await settle();
  assert.equal(api.isOpen(), true);
  assert.equal(input.value, "my unsaved draft");

  const retry = document.getElementById("cardNotesRetry");
  retry.click();
  retry.click();
  assert.equal(reads, 2);
  assert.equal(api.handleBack(), true);
  await settle();
  assert.equal(input.readOnly, true);
  assert.equal(input.value, "my unsaved draft");
  resolveReload({ text: "another tab's saved text" });
  await settle();
  assert.equal(api.isOpen(), false);
});
