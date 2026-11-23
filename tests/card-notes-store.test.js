"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var api = require("../js/card-notes-store.js");

// Models IndexedDB's ordered transactions, asynchronous requests and rollback.
function fakeIndexedDB() {
  var records = new Map();
  var queue = [];
  var running = false;
  var created = false;
  var control = { failAdd: null, getAllCalls: 0 };
  function key(value) { return JSON.stringify(value); }
  function pump() {
    if (running || !queue.length) return;
    running = true;
    var tx = queue.shift();
    var snapshot = new Map(records);
    function next() {
      if (tx.aborted) {
        records = snapshot;
        if (tx.onabort) tx.onabort();
        running = false;
        pump();
        return;
      }
      var item = tx.requests.shift();
      if (!item) {
        if (tx.oncomplete) tx.oncomplete();
        running = false;
        pump();
        return;
      }
      try {
        item.request.result = item.fn();
        if (item.request.onsuccess) item.request.onsuccess();
      } catch (error) {
        item.request.error = error;
        tx.error = error;
        if (item.request.onerror) item.request.onerror();
        tx.aborted = true;
      }
      setImmediate(next);
    }
    setImmediate(next);
  }
  var db = {
    createObjectStore: function (_name, options) { assert.deepEqual(options.keyPath, ["deckType", "cardId"]); },
    close: function () {},
    transaction: function () {
      var tx = { requests: [], aborted: false, abort: function () { this.aborted = true; } };
      function request(fn) { var r = {}; tx.requests.push({ request: r, fn: fn }); return r; }
      tx.objectStore = function () { return {
        get: function (k) { return request(function () { var v = records.get(key(k)); return v === undefined ? undefined : structuredClone(v); }); },
        getAll: function () { control.getAllCalls += 1; return request(function () { return Array.from(records.values(), function (v) { return structuredClone(v); }); }); },
        getAllKeys: function () { return request(function () { return Array.from(records.keys(), JSON.parse); }); },
        put: function (row) { return request(function () { records.set(key([row.deckType, row.cardId]), structuredClone(row)); }); },
        delete: function (k) { return request(function () { records.delete(key(k)); }); },
        add: function (row) { return request(function () {
          if (row.cardId === control.failAdd) throw new Error("Injected write failure");
          var k = key([row.deckType, row.cardId]);
          if (records.has(k)) throw new Error("ConstraintError");
          records.set(k, structuredClone(row));
        }); }
      }; };
      queue.push(tx);
      setImmediate(pump);
      return tx;
    }
  };
  control.open = function () {
    var request = {};
    setImmediate(function () {
      request.result = db;
      if (!created) { created = true; if (request.onupgradeneeded) request.onupgradeneeded(); }
      if (request.onsuccess) request.onsuccess();
    });
    return request;
  };
  return control;
}
function create(idb) {
  return api.createStore({ indexedDB: idb, isKnownCard: function (deck, card) {
    return (deck === "tarot" || deck === "m") && ["a", "b", "c"].includes(card);
  } });
}
function backup(notes) { return JSON.stringify({ format: api.BACKUP_FORMAT, version: 1, notes: notes }); }
function row(deckType, cardId, text) { return { deckType: deckType, cardId: cardId, text: text }; }

test("preserves exact long text, compound keys and whitespace deletion", async function () {
  var idb = fakeIndexedDB(), store = create(idb);
  var text = "  第一段\r\n\r\n第二段\n" + "🜁 ".repeat(30000) + "  ";
  assert.equal(await store.get("tarot", "a"), null);
  assert.deepEqual(await store.save("tarot", "a", text, null), row("tarot", "a", text));
  await store.save("m", "a", "different deck", "");
  assert.deepEqual(await store.keys(), [["tarot", "a"], ["m", "a"]]);
  assert.equal(idb.getAllCalls, 0, "keys must not load note bodies");
  assert.equal((await store.get("tarot", "a")).text, text);
  assert.equal(await store.save("tarot", "a", " \r\n\t", text), null);
  assert.equal(await store.get("tarot", "a"), null);
  assert.equal((await store.get("m", "a")).text, "different deck");
});

test("serializes concurrent changes, signals conflict, allows identical result", async function () {
  var idb = fakeIndexedDB(), one = create(idb), two = create(idb);
  await one.save("tarot", "a", "original", null);
  var results = await Promise.allSettled([
    one.save("tarot", "a", "first", "original"),
    two.save("tarot", "a", "second", "original")
  ]);
  assert.equal(results.filter(function (r) { return r.status === "fulfilled"; }).length, 1);
  assert.equal(results.filter(function (r) { return r.status === "rejected"; })[0].reason.code, "conflict");
  var current = (await one.get("tarot", "a")).text;
  assert.equal((await two.save("tarot", "a", current, "original")).text, current);
  await assert.rejects(two.save("tarot", "a", "", "original"), function (e) { return e.code === "conflict"; });
});

test("backup roundtrip merges without overwriting and preserves exact text", async function () {
  var source = create(fakeIndexedDB()), target = create(fakeIndexedDB());
  await source.save("tarot", "a", "  line\r\n\r\n尾  ", null);
  await source.save("m", "b", "new", null);
  var raw = await source.exportBackup();
  await target.save("tarot", "a", "keep", null);
  assert.deepEqual(await target.importBackup(raw), { imported: 1, skipped: 1 });
  assert.equal((await target.get("tarot", "a")).text, "keep");
  assert.equal((await target.get("m", "b")).text, "new");
  var copy = create(fakeIndexedDB());
  assert.deepEqual(await copy.importBackup(raw), { imported: 2, skipped: 0 });
  assert.deepEqual(await copy.list(), await source.list());
});

test("rejects malformed, unknown and duplicate entries before writing", async function () {
  var store = create(fakeIndexedDB());
  var valid = row("tarot", "a", "a");
  var bad = ["invalid", "{}", JSON.stringify({ format: api.BACKUP_FORMAT, version: 2, notes: [] }),
    backup([valid, valid]), backup([valid, row("tarot", "unknown", "x")]),
    backup([valid, row("m", "a", " \n")]), backup([valid, { deckType: "m", cardId: "a", text: "x", extra: 1 }]),
    JSON.stringify({ format: api.BACKUP_FORMAT, version: 1, notes: [], extra: 1 })];
  for (var raw of bad) await assert.rejects(store.importBackup(raw));
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.save("tarot", "unknown", "x", null));
});

test("write error aborts the whole import", async function () {
  var idb = fakeIndexedDB(), store = create(idb);
  await store.save("m", "c", "existing", null);
  idb.failAdd = "b";
  await assert.rejects(store.importBackup(backup([row("tarot", "a", "a"), row("tarot", "b", "b")])), /Injected/);
  assert.deepEqual(await store.list(), [row("m", "c", "existing")]);
});

test("reports unavailable IndexedDB on repeated attempts", async function () {
  var store = create(null);
  await assert.rejects(store.list(), /unavailable/);
  await assert.rejects(store.list(), /unavailable/);
});
