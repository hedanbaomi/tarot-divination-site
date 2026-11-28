"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var recordsApi = require("../js/history-records.js");

function createFakeIndexedDB() {
  var databases = new Map();

  function makeRequest(transaction, operation) {
    var request = {};
    transaction._pending += 1;
    queueMicrotask(function () {
      try {
        request.result = operation();
        if (typeof request.onsuccess === "function") request.onsuccess({ target: request });
      } catch (error) {
        request.error = error;
        transaction.error = error;
        if (typeof request.onerror === "function") request.onerror({ target: request });
        transaction._abort(error);
      } finally {
        transaction._pending -= 1;
        transaction._settle();
      }
    });
    return request;
  }

  function FakeObjectStore(definition, transaction) {
    this._definition = definition;
    this._transaction = transaction;
  }

  FakeObjectStore.prototype.createIndex = function (name, keyPath, options) {
    this._definition.indexes.set(name, {
      name: name,
      keyPath: keyPath,
      unique: Boolean(options && options.unique)
    });
    return this._definition.indexes.get(name);
  };

  FakeObjectStore.prototype.getAll = function () {
    var definition = this._definition;
    return makeRequest(this._transaction, function () {
      return Array.from(definition.records.values()).map(function (value) {
        return structuredClone(value);
      });
    });
  };

  FakeObjectStore.prototype.get = function (key) {
    var definition = this._definition;
    return makeRequest(this._transaction, function () {
      var value = definition.records.get(key);
      return value === undefined ? undefined : structuredClone(value);
    });
  };

  FakeObjectStore.prototype.add = function (value) {
    var definition = this._definition;
    return makeRequest(this._transaction, function () {
      var key = value[definition.keyPath];
      if (definition.records.has(key)) {
        var error = new Error("ConstraintError");
        error.name = "ConstraintError";
        throw error;
      }
      definition.records.set(key, structuredClone(value));
      return key;
    });
  };

  FakeObjectStore.prototype.put = function (value) {
    var definition = this._definition;
    return makeRequest(this._transaction, function () {
      var key = value[definition.keyPath];
      definition.records.set(key, structuredClone(value));
      return key;
    });
  };

  FakeObjectStore.prototype.delete = function (key) {
    var definition = this._definition;
    return makeRequest(this._transaction, function () {
      definition.records.delete(key);
      return undefined;
    });
  };

  FakeObjectStore.prototype.clear = function () {
    var definition = this._definition;
    return makeRequest(this._transaction, function () {
      definition.records.clear();
      return undefined;
    });
  };

  function FakeTransaction(database, storeNames) {
    this._database = database;
    this._storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this._pending = 0;
    this._completionScheduled = false;
    this._aborted = false;
    this.error = null;
  }

  FakeTransaction.prototype.objectStore = function (name) {
    if (this._storeNames.indexOf(name) === -1) throw new Error("Store not in transaction");
    var definition = this._database._stores.get(name);
    if (!definition) throw new Error("Unknown object store " + name);
    return new FakeObjectStore(definition, this);
  };

  FakeTransaction.prototype._abort = function (error) {
    if (this._aborted) return;
    this._aborted = true;
    this.error = error;
    if (typeof this.onerror === "function") this.onerror({ target: this });
    if (typeof this.onabort === "function") this.onabort({ target: this });
  };

  FakeTransaction.prototype.abort = function () {
    this._abort(new Error("AbortError"));
  };

  FakeTransaction.prototype._settle = function () {
    var self = this;
    if (self._aborted || self._pending !== 0 || self._completionScheduled) return;
    self._completionScheduled = true;
    setTimeout(function () {
      self._completionScheduled = false;
      if (!self._aborted && self._pending === 0 && typeof self.oncomplete === "function") {
        self.oncomplete({ target: self });
      }
    }, 0);
  };

  function FakeDatabase(name, version) {
    this.name = name;
    this.version = version;
    this._stores = new Map();
    var self = this;
    this.objectStoreNames = {
      contains: function (storeName) {
        return self._stores.has(storeName);
      }
    };
  }

  FakeDatabase.prototype.createObjectStore = function (name, options) {
    var definition = {
      keyPath: options && options.keyPath,
      records: new Map(),
      indexes: new Map()
    };
    this._stores.set(name, definition);
    return new FakeObjectStore(definition, this._upgradeTransaction);
  };

  FakeDatabase.prototype.transaction = function (storeNames) {
    var transaction = new FakeTransaction(this, storeNames);
    queueMicrotask(function () { transaction._settle(); });
    return transaction;
  };

  FakeDatabase.prototype.close = function () {};

  return {
    open: function (name, version) {
      var request = {};
      queueMicrotask(function () {
        var database = databases.get(name);
        var oldVersion = database ? database.version : 0;
        if (!database) database = new FakeDatabase(name, version);
        if (version < oldVersion) {
          request.error = new Error("VersionError");
          if (typeof request.onerror === "function") request.onerror({ target: request });
          return;
        }
        if (version > oldVersion) {
          database.version = version;
          var upgradeTransaction = new FakeTransaction(database, []);
          database._upgradeTransaction = upgradeTransaction;
          request.result = database;
          request.transaction = upgradeTransaction;
          if (typeof request.onupgradeneeded === "function") {
            request.onupgradeneeded({
              oldVersion: oldVersion,
              newVersion: version,
              target: request
            });
          }
        }
        databases.set(name, database);
        request.result = database;
        if (typeof request.onsuccess === "function") request.onsuccess({ target: request });
      });
      return request;
    },
    _databases: databases
  };
}

function makeRecord(id, createdAt, cardName) {
  return {
    schemaVersion: recordsApi.SCHEMA_VERSION,
    id: id,
    createdAt: createdAt,
    deckType: "tarot",
    deckMode: "tarot",
    deckName: "Tarot",
    spreadId: "single",
    spreadName: "Single",
    positionCount: 1,
    orientationMode: "mixed",
    filterMode: "mixed",
    overviewMethod: "not-applicable",
    cards: [{
      cardId: "tarot-" + cardName,
      cardNumber: "0",
      cardName: cardName,
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "Focus",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  };
}

test("store fails cleanly when IndexedDB is unavailable", async function () {
  var storeApi = require("../js/history-store.js");
  var store = storeApi.createStore({ indexedDB: null, recordsApi: recordsApi });
  await assert.rejects(store.open(), /IndexedDB.*unavailable/i);
});

test("version changes close the stale connection and allow a fresh open", async function () {
  var storeApi = require("../js/history-store.js");
  var fakeIndexedDB = createFakeIndexedDB();
  var store = storeApi.createStore({
    indexedDB: fakeIndexedDB,
    recordsApi: recordsApi,
    dbName: "history-versionchange"
  });
  var firstOpen = store.open();
  var database = await firstOpen;

  database.onversionchange();
  var secondOpen = store.open();

  assert.notEqual(secondOpen, firstOpen);
  assert.equal(await secondOpen, database);
});

test("migrates schema and supports CRUD with newest-first deck filtering", async function () {
  var storeApi = require("../js/history-store.js");
  var fake = createFakeIndexedDB();
  var store = storeApi.createStore({
    indexedDB: fake,
    recordsApi: recordsApi,
    dbName: "crud-test"
  });

  await store.open();
  var database = fake._databases.get("crud-test");
  assert.equal(database.objectStoreNames.contains("readings"), true);
  assert.equal(database.objectStoreNames.contains("meta"), true);
  assert.equal(database._stores.get("readings").indexes.has("createdAt"), true);
  assert.equal(database._stores.get("readings").indexes.has("deckType"), true);

  var older = makeRecord("older", "2026-07-20T00:00:00.000Z", "Old");
  var newer = makeRecord("newer", "2026-07-21T00:00:00.000Z", "New");
  var lxxxi = structuredClone(newer);
  lxxxi.id = "lxxxi";
  lxxxi.createdAt = "2026-07-22T00:00:00.000Z";
  lxxxi.deckType = "lxxxi";
  lxxxi.deckMode = "lxxxi";
  lxxxi.deckName = "LXXXI";
  lxxxi.orientationMode = "upright-only";
  lxxxi.filterMode = "not-applicable";
  lxxxi.cards[0].cardId = "lxxxi-1";
  lxxxi.cards[0].arcana = "lxxxi";

  assert.equal((await store.saveRecord(older)).saved, true);
  assert.equal((await store.saveRecord(newer)).saved, true);
  assert.equal((await store.saveRecord(lxxxi)).saved, true);
  assert.deepEqual((await store.listRecords()).map(function (item) { return item.id; }), [
    "lxxxi",
    "newer",
    "older"
  ]);
  assert.deepEqual((await store.listRecords("tarot")).map(function (item) { return item.id; }), [
    "newer",
    "older"
  ]);
  assert.equal((await store.getRecord("older")).cards[0].cardName, "Old");
  assert.equal(await store.getRecord("missing"), null);
  assert.equal(await store.deleteRecord("older"), true);
  assert.equal(await store.deleteRecord("missing"), false);
  assert.deepEqual((await store.listRecords()).map(function (item) { return item.id; }), ["lxxxi", "newer"]);
  await store.clearRecords();
  assert.deepEqual(await store.listRecords(), []);
});

test("saveRecord rejects invalid data and suppresses a recent identical snapshot", async function () {
  var storeApi = require("../js/history-store.js");
  var store = storeApi.createStore({
    indexedDB: createFakeIndexedDB(),
    recordsApi: recordsApi,
    dbName: "dedupe-test",
    duplicateWindowMs: 10000
  });
  var first = makeRecord("first", "2026-07-21T00:00:00.000Z", "Same");
  var duplicate = structuredClone(first);
  duplicate.id = "second";
  duplicate.createdAt = "2026-07-21T00:00:05.000Z";

  assert.equal((await store.saveRecord(first)).saved, true);
  assert.deepEqual(await store.saveRecord(duplicate), {
    saved: false,
    duplicate: true,
    record: first
  });
  assert.equal((await store.listRecords()).length, 1);

  var invalid = structuredClone(first);
  invalid.notes = "<img src=x onerror=alert(1)>";
  await assert.rejects(store.saveRecord(invalid), /unexpected field notes/);
});

test("importRecords validates atomically and remaps duplicate IDs", async function () {
  var storeApi = require("../js/history-store.js");
  var generatedIds = ["generated-1", "generated-2"];
  var store = storeApi.createStore({
    indexedDB: createFakeIndexedDB(),
    recordsApi: recordsApi,
    dbName: "import-test",
    idGenerator: function () { return generatedIds.shift(); }
  });
  var existing = makeRecord("same-id", "2026-07-20T00:00:00.000Z", "Existing");
  await store.saveRecord(existing);

  var importedOne = makeRecord("same-id", "2026-07-21T00:00:00.000Z", "Imported 1");
  var importedTwo = makeRecord("same-id", "2026-07-22T00:00:00.000Z", "Imported 2");
  var result = await store.importRecords([importedOne, importedTwo]);
  assert.equal(result.importedCount, 2);
  assert.equal(result.remappedCount, 2);
  assert.deepEqual(result.records.map(function (item) { return item.id; }), [
    "generated-1",
    "generated-2"
  ]);
  assert.equal((await store.listRecords()).length, 3);
  assert.equal((await store.getRecord("same-id")).cards[0].cardName, "Existing");

  var invalid = structuredClone(importedOne);
  invalid.cards[0].orientation = "sideways";
  await assert.rejects(store.importRecords([makeRecord("valid", "2026-07-23T00:00:00.000Z", "Valid"), invalid]));
  assert.equal((await store.listRecords()).length, 3);
});

test("question updates preserve the record and distinct questions are not duplicates", async function () {
  var store = require("../js/history-store.js").createStore({
    indexedDB: createFakeIndexedDB(),
    dbName: "questions"
  });
  var first = makeRecord("one", "2026-07-21T00:00:00.000Z", "Same");
  await store.saveRecord(first);
  var updated = await store.updateQuestion("one", "  第一行\r\n第二行  ");
  assert.deepEqual(updated, Object.assign({}, first, { question: "第一行\n第二行" }));
  assert.deepEqual(await store.getRecord("one"), updated);

  var candidate = structuredClone(first);
  candidate.id = "two";
  candidate.createdAt = "2026-07-21T00:00:05.000Z";
  candidate.question = "另一个问题";
  assert.equal((await store.saveRecord(candidate)).saved, true);
  var duplicate = structuredClone(candidate);
  duplicate.id = "three";
  assert.equal((await store.saveRecord(duplicate)).duplicate, true);

  await assert.rejects(store.updateQuestion("one", "x".repeat(2001)), /2000/);
  await assert.rejects(store.updateQuestion("one", 123), /string/);
  assert.deepEqual(await store.getRecord("one"), updated);
  assert.equal(await store.updateQuestion("missing", "question"), null);
  await assert.rejects(store.updateQuestion("", "question"), /id/);
  var cleared = await store.updateQuestion("one", " \r\n ");
  assert.deepEqual(cleared, first);
  assert.deepEqual(await store.getRecord("one"), first);
});

test("reflection updates preserve the reading, validate before writing and handle failed writes", async function () {
  var fake = createFakeIndexedDB();
  var store = require("../js/history-store.js").createStore({ indexedDB: fake, dbName: "reflections" });
  var first = makeRecord("one", "2026-07-21T00:00:00.000Z", "Same");
  first.question = "Existing question";
  await store.saveRecord(first);
  var updated = await store.updateReflection("one", "  第一行\r\n第二行\r第三行  ");
  assert.deepEqual(updated, Object.assign({}, first, { reflection: "第一行\n第二行\n第三行" }));
  assert.deepEqual(await store.getRecord("one"), updated);
  await assert.rejects(store.updateReflection("one", "x".repeat(4001)), /4000/);
  await assert.rejects(store.updateReflection("one", 123), /string/);
  await assert.rejects(store.updateReflection("", "value"), /id/);
  assert.equal(await store.updateReflection("missing", "value"), null);
  assert.deepEqual(await store.getRecord("one"), updated);

  var records = fake._databases.get("reflections")._stores.get("readings").records;
  var originalSet = records.set;
  records.set = function () { throw new Error("simulated write failure"); };
  await assert.rejects(store.updateReflection("one", "changed"));
  records.set = originalSet;
  assert.deepEqual(await store.getRecord("one"), updated);

  var candidate = structuredClone(first);
  candidate.id = "two";
  candidate.createdAt = "2026-07-21T00:00:05.000Z";
  candidate.reflection = "different reflection";
  assert.equal((await store.saveRecord(candidate)).saved, true);
  var duplicate = structuredClone(candidate);
  duplicate.id = "three";
  assert.equal((await store.saveRecord(duplicate)).duplicate, true);
  var imported = structuredClone(candidate);
  imported.id = "imported";
  assert.deepEqual((await store.importRecords([imported])).records, [imported]);
  assert.deepEqual(await store.getRecord("imported"), imported);
  assert.deepEqual(await store.updateReflection("one", " \r\n "), first);
  assert.deepEqual(await store.getRecord("one"), first);
});

test("sha256Hex matches Node crypto and history-store matches Android byte-for-byte", function () {
  var crypto = require("node:crypto");
  var fs = require("node:fs");
  var path = require("node:path");
  var storeApi = require("../js/history-store.js");
  var samples = ["", "abc", "Quareia 占卜历史", "🜁 Tarot \0 2026-11-28T00:00:00.000Z", "a".repeat(200)];
  samples.forEach(function (sample) {
    var expected = crypto.createHash("sha256").update(sample, "utf8").digest("hex");
    assert.equal(storeApi.sha256Hex(sample), expected, "SHA-256 mismatch for sample length " + sample.length);
  });

  var root = path.resolve(__dirname, "..");
  var webBuf = fs.readFileSync(path.join(root, "js/history-store.js"));
  var androidBuf = fs.readFileSync(path.join(root, "android-demo/app/src/main/assets/www/js/history-store.js"));
  assert.equal(Buffer.compare(webBuf, androidBuf), 0, "Web and Android js/history-store.js must be byte-identical");
});

test("mergeBackupRecords executes atomically in one serialized readwrite transaction without duplicating concurrent restores or collapsing independent IDs", async function () {
  var storeApi = require("../js/history-store.js");

  // Serialized fake IndexedDB faithfully modeling per-database transaction queuing across tabs.
  function createSerializedFakeIndexedDB() {
    var databases = new Map();
    function createDb(name, version) {
      var stores = new Map();
      var txQueue = [];
      var activeTx = null;
      var db = {
        name: name,
        version: version,
        _stores: stores,
        objectStoreNames: { contains: function (s) { return stores.has(s); } },
        createObjectStore: function (s, opts) {
          var def = { keyPath: opts && opts.keyPath, records: new Map(), indexes: new Map() };
          stores.set(s, def);
          return {
            createIndex: function (idx, kp, o) { def.indexes.set(idx, { name: idx, keyPath: kp, unique: Boolean(o && o.unique) }); },
            put: function (val) { def.records.set(val[def.keyPath], structuredClone(val)); return {}; }
          };
        },
        transaction: function (storeNames) {
          var names = Array.isArray(storeNames) ? storeNames : [storeNames];
          var tx = {
            _names: names,
            _ops: [],
            _aborted: false,
            _finished: false,
            _snapshots: new Map(),
            error: null,
            abort: function () {
              if (this._aborted || this._finished) return;
              this._aborted = true;
              this.error = this.error || new Error("AbortError");
              this._snapshots.forEach(function (snap, sName) {
                var d = stores.get(sName);
                if (d) d.records = new Map(snap);
              });
              if (typeof this.onabort === "function") this.onabort({ target: this });
              finishTx(this);
            },
            objectStore: function (sName) {
              var def = stores.get(sName);
              function req(fn) {
                var r = {};
                tx._ops.push({ r: r, fn: fn });
                return r;
              }
              return {
                getAll: function () {
                  return req(function () {
                    return Array.from(def.records.values(), function (v) { return structuredClone(v); });
                  });
                },
                add: function (v) {
                  return req(function () {
                    var k = v[def.keyPath];
                    if (def.records.has(k)) throw new Error("ConstraintError");
                    def.records.set(k, structuredClone(v));
                    return k;
                  });
                },
                put: function (v) {
                  return req(function () {
                    var k = v[def.keyPath];
                    def.records.set(k, structuredClone(v));
                    return k;
                  });
                }
              };
            }
          };
          txQueue.push(tx);
          if (!activeTx) runNext();
          return tx;
        },
        close: function () {}
      };
      function finishTx(tx) {
        if (activeTx === tx) {
          activeTx = null;
          setImmediate(runNext);
        }
      }
      function runNext() {
        if (activeTx || txQueue.length === 0) return;
        var tx = txQueue.shift();
        activeTx = tx;
        tx._names.forEach(function (sName) {
          var d = stores.get(sName);
          if (d) tx._snapshots.set(sName, new Map(d.records));
        });
        function step() {
          if (tx._aborted) return;
          var item = tx._ops.shift();
          if (!item) {
            setTimeout(function () {
              if (tx._aborted || tx._finished) return;
              if (tx._ops.length > 0) { step(); return; }
              tx._finished = true;
              if (typeof tx.oncomplete === "function") tx.oncomplete({ target: tx });
              finishTx(tx);
            }, 0);
            return;
          }
          try {
            item.r.result = item.fn();
            if (typeof item.r.onsuccess === "function") item.r.onsuccess({ target: item.r });
          } catch (err) {
            item.r.error = err;
            tx.error = err;
            if (typeof item.r.onerror === "function") item.r.onerror({ target: item.r });
            tx.abort();
            return;
          }
          setImmediate(step);
        }
        setImmediate(step);
      }
      return db;
    }
    return {
      open: function (name, version) {
        var req = {};
        setImmediate(function () {
          var db = databases.get(name);
          var oldVersion = db ? db.version : 0;
          if (!db) { db = createDb(name, version); databases.set(name, db); }
          req.result = db;
          if (version > oldVersion) {
            db.version = version;
            req.transaction = { abort: function () {} };
            if (typeof req.onupgradeneeded === "function") {
              req.onupgradeneeded({ oldVersion: oldVersion, newVersion: version, target: req });
            }
          }
          if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
        });
        return req;
      }
    };
  }

  var sharedIdb = createSerializedFakeIndexedDB();
  var tab1Store = storeApi.createStore({ indexedDB: sharedIdb, recordsApi: recordsApi, dbName: "merge-race" });
  var tab2Store = storeApi.createStore({ indexedDB: sharedIdb, recordsApi: recordsApi, dbName: "merge-race" });

  // Local has "shared" (Card A) and "r1" (same content as incoming "r2").
  await tab1Store.saveRecord(makeRecord("shared", "2026-07-20T00:00:00.000Z", "LocalCard"));
  var r1 = makeRecord("r1", "2026-07-21T00:00:00.000Z", "TwinCard");
  var r2 = makeRecord("r2", "2026-07-21T00:00:00.000Z", "TwinCard");
  await tab1Store.saveRecord(r1);

  var collidingBackup = makeRecord("shared", "2026-07-22T00:00:00.000Z", "BackupCard");

  // Both tabs merge concurrently: must serialize cleanly with ZERO duplicate remapped copies and preserve r2!
  var results = await Promise.all([
    tab1Store.mergeBackupRecords([collidingBackup, r1, r2]),
    tab2Store.mergeBackupRecords([collidingBackup, r1, r2])
  ]);

  var all = await tab1Store.listRecords();
  assert.equal(all.length, 4, "Must hold exact 4 records: local shared, remapped backup shared, r1, and independent r2");
  assert.equal(results[0].importedCount + results[1].importedCount, 2, "Across both tabs, only 2 new records inserted (remapped shared + r2)");
  assert.equal(results[0].remappedCount + results[1].remappedCount, 1, "Only 1 remap write performed across concurrent tabs");
  assert.equal(results[0].skippedCount + results[1].skippedCount, 4, "Second tab skips all 3 records; first tab skips r1");
  assert.deepEqual(results[0].idMap, results[1].idMap, "Both concurrent tabs agree on exact deterministic idMap");
  assert.match(results[0].idMap.shared, /^reading-remap-[0-9a-f]{32}$/);
  assert.equal(results[0].idMap.r2, undefined, "Non-colliding r2 keeps its own ID");
  assert.ok(all.some(function (rec) { return rec.id === "r2"; }), "r2 preserved independently from r1");

  // Cap check: adding 1 new record when at MAX_RECORDS fails atomically with zero writes,
  // while skipping an already-present record at MAX_RECORDS still succeeds.
  var capRecordsApi = Object.assign({}, recordsApi, { MAX_RECORDS: 4 });
  var capStore = storeApi.createStore({ indexedDB: sharedIdb, recordsApi: capRecordsApi, dbName: "merge-race" });
  var okAtCap = await capStore.mergeBackupRecords([collidingBackup]);
  assert.equal(okAtCap.importedCount, 0);
  assert.equal(okAtCap.skippedCount, 1);
  await assert.rejects(
    capStore.mergeBackupRecords([makeRecord("brand-new", "2026-07-25T00:00:00.000Z", "OverCap")]),
    /record limit/i
  );
  assert.equal((await tab1Store.listRecords()).length, 4);
});

test("mergeBackupRecords reuses existing remapped copy without duplicating when original colliding local ID was later deleted", async function () {
  var storeApi = require("../js/history-store.js");
  var fakeIdb = createFakeIndexedDB();
  var store = storeApi.createStore({ indexedDB: fakeIdb, recordsApi: recordsApi, dbName: "remap-after-delete" });

  // Local has "shared" (LocalCard).
  await store.saveRecord(makeRecord("shared", "2026-08-01T00:00:00.000Z", "LocalCard"));

  // Restore #1: backup "shared" (BackupCard) collides and remaps to reading-remap-<hex32>.
  var backupShared = makeRecord("shared", "2026-08-02T00:00:00.000Z", "BackupCard");
  var first = await store.mergeBackupRecords([backupShared]);
  assert.equal(first.importedCount, 1);
  assert.equal(first.remappedCount, 1);
  assert.equal(first.skippedCount, 0);
  var remappedId = first.idMap.shared;
  assert.match(remappedId, /^reading-remap-[0-9a-f]{32}$/);
  assert.equal((await store.listRecords()).length, 2);

  // User deletes original local "shared"; only the remapped copy remains.
  await store.deleteRecord("shared");
  var afterDelete = await store.listRecords();
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].id, remappedId);

  // Restore #2: re-importing the same backup must recognize remappedId, skip insertion, and still emit idMap.
  var second = await store.mergeBackupRecords([backupShared]);
  assert.equal(second.importedCount, 0);
  assert.equal(second.remappedCount, 0);
  assert.equal(second.skippedCount, 1);
  assert.deepEqual(second.idMap, { shared: remappedId });

  var afterSecond = await store.listRecords();
  assert.equal(afterSecond.length, 1, "Must NOT re-insert a duplicate copy under 'shared'");
  assert.equal(afterSecond[0].id, remappedId);

  // An independent twin record "r2" with identical createdAt + content still imports under "r2" (not collapsed into remappedId).
  var independentTwin = makeRecord("r2", "2026-08-02T00:00:00.000Z", "BackupCard");
  var third = await store.mergeBackupRecords([backupShared, independentTwin]);
  assert.equal(third.importedCount, 1);
  assert.equal(third.remappedCount, 0);
  assert.equal(third.skippedCount, 1);
  assert.deepEqual(third.idMap, { shared: remappedId });
  var afterThird = await store.listRecords();
  assert.equal(afterThird.length, 2);
  assert.ok(afterThird.some(function (rec) { return rec.id === remappedId; }));
  assert.ok(afterThird.some(function (rec) { return rec.id === "r2"; }));
});
