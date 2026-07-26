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
