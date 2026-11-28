"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var fullBackup = require("../js/full-backup.js");
var historyRecords = require("../js/history-records.js");
var historyStoreApi = require("../js/history-store.js");
var cardNotesStoreApi = require("../js/card-notes-store.js");
var customSpreadsApi = require("../js/custom-spreads.js");
var aiChatStoreApi = require("../js/ai-chat-store.js");
var mystagogusData = require("../js/mystagogus-data.js");
var lxxxiData = require("../js/lxxxi-data.js");

var ROOT = path.resolve(__dirname, "..");

function loadTarotDeckFull() {
  var source = fs.readFileSync(path.join(ROOT, "js/tarot-data.js"), "utf8");
  var sandbox = {};
  vm.runInNewContext(source + "\nthis.__tarotDeckFull = tarotDeckFull;", sandbox);
  return sandbox.__tarotDeckFull;
}

// Unified fake IndexedDB that supports history-store, card-notes-store (compound keyPath),
// and ai-chat-store (indexes, objectStoreNames, rollback on abort).
function createUnifiedFakeIndexedDB() {
  var databases = new Map();

  function keyOf(keyPath, value) {
    if (Array.isArray(keyPath)) {
      return JSON.stringify(keyPath.map(function (k) { return value[k]; }));
    }
    return JSON.stringify(value[keyPath]);
  }

  function rawKeyOf(key) {
    return JSON.stringify(key);
  }

  function FakeObjectStore(def, tx) {
    this._def = def;
    this._tx = tx;
    this.indexNames = {
      contains: function (name) { return def.indexes.has(name); }
    };
  }

  FakeObjectStore.prototype.createIndex = function (name, keyPath, options) {
    this._def.indexes.set(name, {
      name: name,
      keyPath: keyPath,
      unique: Boolean(options && options.unique)
    });
    return this._def.indexes.get(name);
  };

  function enqueue(tx, op) {
    var req = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null
    };
    tx._queue.push({ req: req, op: op });
    tx._schedulePump();
    return req;
  }

  FakeObjectStore.prototype.get = function (key) {
    var def = this._def;
    return enqueue(this._tx, function () {
      var val = def.records.get(rawKeyOf(key));
      return val === undefined ? undefined : structuredClone(val);
    });
  };

  FakeObjectStore.prototype.getAll = function () {
    var def = this._def;
    return enqueue(this._tx, function () {
      return Array.from(def.records.values(), function (v) { return structuredClone(v); });
    });
  };

  FakeObjectStore.prototype.getAllKeys = function () {
    var def = this._def;
    return enqueue(this._tx, function () {
      return Array.from(def.records.keys(), function (k) { return JSON.parse(k); });
    });
  };

  FakeObjectStore.prototype.add = function (value) {
    var def = this._def;
    return enqueue(this._tx, function () {
      var k = keyOf(def.keyPath, value);
      if (def.records.has(k)) {
        var err = new Error("ConstraintError");
        err.name = "ConstraintError";
        throw err;
      }
      def.records.set(k, structuredClone(value));
      return JSON.parse(k);
    });
  };

  FakeObjectStore.prototype.put = function (value) {
    var def = this._def;
    return enqueue(this._tx, function () {
      var k = keyOf(def.keyPath, value);
      def.records.set(k, structuredClone(value));
      return JSON.parse(k);
    });
  };

  FakeObjectStore.prototype.delete = function (key) {
    var def = this._def;
    return enqueue(this._tx, function () {
      def.records.delete(rawKeyOf(key));
      return undefined;
    });
  };

  FakeObjectStore.prototype.clear = function () {
    var def = this._def;
    return enqueue(this._tx, function () {
      def.records.clear();
      return undefined;
    });
  };

  function FakeTransaction(db, storeNames) {
    this._db = db;
    this._storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this._queue = [];
    this._pumping = false;
    this._started = false;
    this._aborted = false;
    this._completed = false;
    this._snapshots = new Map();
    this.error = null;
  }

  FakeTransaction.prototype._begin = function () {
    if (this._started || this._aborted || this._completed) return;
    this._started = true;
    var self = this;
    this._storeNames.forEach(function (name) {
      var def = self._db._stores.get(name);
      if (def) self._snapshots.set(name, new Map(def.records));
    });
    this._schedulePump();
  };

  FakeTransaction.prototype._finish = function () {
    if (this._db && typeof this._db._onTxFinish === "function") {
      this._db._onTxFinish(this);
    }
  };

  FakeTransaction.prototype.objectStore = function (name) {
    if (this._storeNames.indexOf(name) === -1) throw new Error("Store not in transaction: " + name);
    var def = this._db._stores.get(name);
    if (!def) throw new Error("Unknown object store: " + name);
    return new FakeObjectStore(def, this);
  };

  FakeTransaction.prototype.abort = function () {
    if (this._aborted || this._completed) return;
    this._aborted = true;
    this.error = this.error || new Error("AbortError");
    var self = this;
    this._snapshots.forEach(function (snap, name) {
      var def = self._db._stores.get(name);
      if (def) def.records = new Map(snap);
    });
    if (typeof this.onabort === "function") this.onabort({ target: this });
    this._finish();
  };

  FakeTransaction.prototype._schedulePump = function () {
    var self = this;
    if (!self._started || self._pumping || self._aborted || self._completed) return;
    self._pumping = true;
    setImmediate(function step() {
      if (self._aborted) {
        self._pumping = false;
        return;
      }
      var item = self._queue.shift();
      if (!item) {
        self._pumping = false;
        // Allow microtasks from request.onsuccess handlers to enqueue follow-up requests
        setTimeout(function () {
          if (self._aborted || self._completed) return;
          if (self._queue.length > 0) {
            self._schedulePump();
            return;
          }
          self._completed = true;
          if (typeof self.oncomplete === "function") self.oncomplete({ target: self });
          self._finish();
        }, 0);
        return;
      }
      try {
        item.req.result = item.op();
        if (typeof item.req.onsuccess === "function") {
          item.req.onsuccess({ target: item.req });
        }
      } catch (error) {
        item.req.error = error;
        self.error = error;
        if (typeof item.req.onerror === "function") {
          item.req.onerror({ target: item.req });
        }
        self.abort();
        self._pumping = false;
        return;
      }
      setImmediate(step);
    });
  };

  function FakeDatabase(name, version) {
    this.name = name;
    this.version = version;
    this._stores = new Map();
    this._txQueue = [];
    this._activeTx = null;
    var self = this;
    this.objectStoreNames = {
      contains: function (storeName) { return self._stores.has(storeName); }
    };
  }

  FakeDatabase.prototype._onTxFinish = function (tx) {
    if (this._activeTx === tx) {
      this._activeTx = null;
      this._drainTxQueue();
    }
  };

  FakeDatabase.prototype._drainTxQueue = function () {
    if (this._activeTx || this._txQueue.length === 0) return;
    var next = this._txQueue.shift();
    this._activeTx = next;
    setImmediate(function () { next._begin(); });
  };

  FakeDatabase.prototype.createObjectStore = function (name, options) {
    var def = {
      keyPath: options && options.keyPath,
      records: new Map(),
      indexes: new Map()
    };
    this._stores.set(name, def);
    return new FakeObjectStore(def, this._upgradeTx);
  };

  FakeDatabase.prototype.transaction = function (storeNames) {
    var tx = new FakeTransaction(this, storeNames);
    this._txQueue.push(tx);
    this._drainTxQueue();
    return tx;
  };

  FakeDatabase.prototype.close = function () {};

  return {
    open: function (name, version) {
      var req = {};
      setImmediate(function () {
        var db = databases.get(name);
        var oldVersion = db ? db.version : 0;
        if (!db) db = new FakeDatabase(name, version);
        if (version > oldVersion) {
          db.version = version;
          var upgradeTx = new FakeTransaction(db, []);
          db._upgradeTx = upgradeTx;
          req.result = db;
          req.transaction = upgradeTx;
          if (typeof req.onupgradeneeded === "function") {
            req.onupgradeneeded({ oldVersion: oldVersion, newVersion: version, target: req });
          }
          if (upgradeTx._aborted) {
            req.error = upgradeTx.error || new Error("Upgrade aborted");
            if (typeof req.onerror === "function") req.onerror({ target: req });
            return;
          }
        }
        databases.set(name, db);
        req.result = db;
        if (typeof req.onsuccess === "function") req.onsuccess({ target: req });
      });
      return req;
    }
  };
}

function createMemoryStorage() {
  var map = new Map();
  return {
    getItem: function (k) { return map.has(k) ? map.get(k) : null; },
    setItem: function (k, v) { map.set(k, String(v)); },
    removeItem: function (k) { map.delete(k); },
    _map: map
  };
}

function createFakeThemeApi(initialTheme, allowedThemes) {
  var current = initialTheme || "celestial";
  var allowed = allowedThemes || fullBackup.VALID_THEMES.slice();
  return {
    STORAGE_KEY: "quareia-divination-theme",
    THEMES: allowed.slice(),
    calls: [],
    getTheme: function () { return current; },
    setTheme: function (next) {
      this.calls.push(next);
      if (allowed.indexOf(next) === -1 || next === current) return false;
      current = next;
      return true;
    }
  };
}

function createFakeI18nApi(initialLocale) {
  var current = initialLocale || "zh-CN";
  return {
    STORAGE_KEY: "quareia-divination-locale",
    calls: [],
    getLocale: function () { return current; },
    setLocale: function (next) {
      this.calls.push(next);
      if (fullBackup.VALID_LOCALES.indexOf(next) === -1 || next === current) return false;
      current = next;
      return true;
    }
  };
}

function createDeckCatalogChecker() {
  var tarot = loadTarotDeckFull();
  var set = new Set();
  tarot.forEach(function (c) { set.add("tarot/" + c.id); });
  mystagogusData.mystagogusDeckFull.forEach(function (c) { set.add("mystagogus/" + c.id); });
  lxxxiData.lxxxiDeckFull.forEach(function (c) { set.add("lxxxi/" + c.id); });
  return function (deckType, cardId) {
    return set.has(deckType + "/" + cardId);
  };
}

function createTestEnvironment(options) {
  options = options || {};
  var idb = options.indexedDB || createUnifiedFakeIndexedDB();
  var storage = options.storage || createMemoryStorage();
  var isKnownCard = createDeckCatalogChecker();
  var platform = options.platform || "android";

  return {
    idb: idb,
    storage: storage,
    adapters: {
      historyRecords: historyRecords,
      historyStoreApi: historyStoreApi,
      historyStore: historyStoreApi.createStore({ indexedDB: idb, recordsApi: options.recordsApi || historyRecords }),
      cardNotesStore: cardNotesStoreApi.createStore({ indexedDB: idb, isKnownCard: isKnownCard }),
      customSpreads: customSpreadsApi,
      customSpreadsLibrary: customSpreadsApi.createLibrary({ platform: platform, storage: storage }),
      aiChatStoreApi: aiChatStoreApi,
      aiChatStore: aiChatStoreApi.createStore({ indexedDB: idb }),
      themeApi: createFakeThemeApi(options.theme || "celestial", options.allowedThemes),
      i18nApi: createFakeI18nApi(options.locale || "zh-CN"),
      storage: storage,
      isKnownCard: isKnownCard
    }
  };
}

function makePresetRecord(id, createdAt, overrides) {
  return Object.assign({
    schemaVersion: historyRecords.SCHEMA_V2_VERSION,
    layoutMode: "preset",
    id: id,
    createdAt: createdAt,
    deckType: "tarot",
    deckMode: "tarot",
    deckName: "RWS 塔罗",
    spreadId: "three-card-horizontal",
    spreadName: "三张牌",
    positionCount: 1,
    orientationMode: "mixed",
    filterMode: "mixed",
    overviewMethod: "not-applicable",
    cards: [{
      cardId: "major-00",
      cardNumber: "0",
      cardName: "愚者",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "当下 · Present",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  }, overrides || {});
}

function makeV1Record(id, createdAt, overrides) {
  return Object.assign({
    schemaVersion: historyRecords.SCHEMA_VERSION,
    id: id,
    createdAt: createdAt,
    deckType: "mystagogus",
    deckMode: "mystagogus",
    deckName: "Mystagogus",
    spreadId: "single",
    spreadName: "单牌",
    positionCount: 1,
    orientationMode: "upright-only",
    filterMode: "not-applicable",
    overviewMethod: "not-applicable",
    cards: [{
      cardId: "m-01",
      cardNumber: "1",
      cardName: "始源者",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "核心 · Core",
      layer: null,
      arcana: "mystagogus",
      suit: ""
    }]
  }, overrides || {});
}

function makeV3FreeformRecord(id, createdAt, overrides) {
  return Object.assign({
    schemaVersion: historyRecords.SCHEMA_V3_VERSION,
    layoutMode: "freeform",
    id: id,
    createdAt: createdAt,
    deckType: "lxxxi",
    deckMode: "lxxxi",
    deckName: "LXXXI",
    orientationMode: "upright-only",
    filterMode: "not-applicable",
    overviewMethod: "not-applicable",
    cards: [{
      cardId: "lxxxi-01",
      cardNumber: "1",
      cardName: "星辰之父 I",
      arcana: "lxxxi",
      suit: "",
      orientation: "upright",
      revealed: true,
      drawOrder: 1
    }]
  }, overrides || {});
}

function makeCustomSpreadDef(name, description) {
  return {
    name: name,
    description: description || "",
    columns: 3,
    rows: 1,
    deckScope: "any",
    tarotMode: "mixed",
    stackingMode: "single",
    positions: [
      { name: "因", meaning: "背景与起因", column: 1, row: 1 },
      { name: "果", meaning: "当前显化", column: 3, row: 1 }
    ]
  };
}

test("exports exact UMD contract constants and matches Android byte-for-byte", function () {
  assert.equal(fullBackup.BACKUP_FORMAT, "quareia-full-backup");
  assert.equal(fullBackup.BACKUP_VERSION, 1);
  assert.equal(fullBackup.MAX_BACKUP_BYTES, 16 * 1024 * 1024);
  assert.deepEqual(Array.from(fullBackup.SECTION_KEYS), [
    "history",
    "cardNotes",
    "customSpreads",
    "aiChats",
    "preferences"
  ]);
  assert.equal(typeof fullBackup.inspectLocalCounts, "function");
  assert.equal(typeof fullBackup.collectBackup, "function");
  assert.equal(typeof fullBackup.parseBackup, "function");
  assert.equal(typeof fullBackup.restoreBackup, "function");

  var webBuf = fs.readFileSync(path.join(ROOT, "js/full-backup.js"));
  var androidBuf = fs.readFileSync(path.join(ROOT, "android-demo/app/src/main/assets/www/js/full-backup.js"));
  assert.equal(Buffer.compare(webBuf, androidBuf), 0, "Web and Android js/full-backup.js must be byte-identical");

  // Security static audit: zero innerHTML, zero network calls, zero AI config key references.
  var source = webBuf.toString("utf8");
  assert.doesNotMatch(source, /\binnerHTML\b/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(source, /\bsendBeacon\b/);
  assert.doesNotMatch(source, /quareia-ai-config/i);
  assert.doesNotMatch(source, /androidAiConfig/);
});

test("built-in 3-deck known card catalog matches all 237 cards from tarot, mystagogus, and lxxxi", function () {
  var tarot = loadTarotDeckFull();
  var allPairs = [];
  tarot.forEach(function (c) { allPairs.push(["tarot", c.id]); });
  mystagogusData.mystagogusDeckFull.forEach(function (c) { allPairs.push(["mystagogus", c.id]); });
  lxxxiData.lxxxiDeckFull.forEach(function (c) { allPairs.push(["lxxxi", c.id]); });
  assert.equal(allPairs.length, 237);

  // Verify default parseBackup (without custom validators.isKnownCard) accepts all 237 real cards
  var rawValid = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T06:00:00.000Z",
    sections: {
      cardNotes: {
        format: "divination-card-notes",
        version: 1,
        notes: allPairs.map(function (pair, idx) {
          return { deckType: pair[0], cardId: pair[1], text: "Note " + idx };
        })
      }
    }
  });
  var parsed = fullBackup.parseBackup(rawValid);
  assert.equal(parsed.counts.cardNotes, 237);

  // Rejects unknown card IDs and unknown decks with default validator
  var badCards = [
    { deckType: "tarot", cardId: "major-22", text: "nope" },
    { deckType: "tarot", cardId: "minor-wands-11", text: "nope" },
    { deckType: "mystagogus", cardId: "m-00", text: "nope" },
    { deckType: "mystagogus", cardId: "m-79", text: "nope" },
    { deckType: "lxxxi", cardId: "lxxxi-82", text: "nope" },
    { deckType: "oracle", cardId: "major-00", text: "nope" }
  ];
  badCards.forEach(function (badRow) {
    var rawBad = JSON.stringify({
      format: fullBackup.BACKUP_FORMAT,
      version: 1,
      exportedAt: "2026-11-28T06:00:00.000Z",
      sections: {
        cardNotes: { format: "divination-card-notes", version: 1, notes: [badRow] }
      }
    });
    assert.throws(function () { fullBackup.parseBackup(rawBad); }, /unknown card key/i);
  });
});

test("full round-trip across all 5 sections preserves v1/v2/v3 history with question/reflection, notes, spreads, chats, and preferences", async function () {
  var sourceEnv = createTestEnvironment({ theme: "parchment", locale: "en", platform: "web" });
  var s = sourceEnv.adapters;

  // Populate history with v1, v2 preset (with question + reflection), and v3 freeform
  await s.historyStore.saveRecord(makeV1Record("rec-v1", "2026-11-01T10:00:00.000Z", {
    question: "What grounds this month?"
  }));
  await s.historyStore.saveRecord(makePresetRecord("rec-v2", "2026-11-02T10:00:00.000Z", {
    question: "Should I switch roles?",
    reflection: "Looking back, the Fool pointed to missing prerequisites."
  }));
  await s.historyStore.saveRecord(makeV3FreeformRecord("rec-v3", "2026-11-03T10:00:00.000Z", {
    reflection: "Order-only freeform note preserved."
  }));

  // Populate card notes across all 3 decks (preserving CRLF/whitespace)
  await s.cardNotesStore.save("tarot", "major-00", "  Fool study note\r\nLine 2  ", null);
  await s.cardNotesStore.save("mystagogus", "m-01", "Progenitor before dawn", null);
  await s.cardNotesStore.save("lxxxi", "lxxxi-01", "Star Father spark", null);

  // Populate custom spreads
  s.customSpreadsLibrary.upsert(makeCustomSpreadDef("Two Pillars", "Cause and effect"));
  s.customSpreadsLibrary.upsert(makeCustomSpreadDef("Seasonal Gate", "Quarterly check"));

  // Populate AI chats (active + archived, pinned, snapshot, usage, summary)
  await s.aiChatStore.createConversation({
    id: "chat-active",
    title: "Career reading chat",
    createdAt: 1700000001000,
    updatedAt: 1700000005000,
    pinned: true,
    archived: false,
    profileId: "prof_local_1",
    skillMode: "auto",
    readingIds: ["rec-v2"],
    readingSnapshots: [{
      id: "rec-v2",
      layoutMode: "preset",
      deckType: "tarot",
      spreadId: "three-card-horizontal",
      spreadName: "三张牌",
      positionCount: 1,
      createdAt: 1700000000000,
      question: "Should I switch roles?",
      cards: [{
        slotIndex: 0,
        positionNumber: 1,
        positionName: "当下 · Present",
        cardId: "major-00",
        cardName: "愚者",
        orientation: "upright",
        arcana: "major"
      }]
    }],
    messages: [
      { id: "m1", role: "user", content: "Interpret my spread", createdAt: 1700000002000 },
      { id: "m2", role: "assistant", content: "Look closely at the unexamined assumptions.", model: "gpt-4o-mini", createdAt: 1700000003000, interpretedReadingIds: ["rec-v2"] }
    ],
    contextSummary: { text: "Discussed Fool in Present", coveredUntilId: "m2", compressedCount: 2, updatedAt: 1700000004000 },
    lastUsage: { inputTokens: 120, outputTokens: 80, totalTokens: 200, updatedAt: 1700000004500 }
  });
  await s.aiChatStore.createConversation({
    id: "chat-archived",
    title: "Archived chat",
    createdAt: 1700000000100,
    updatedAt: 1700000000200,
    archived: true,
    messages: [{ id: "m3", role: "user", content: "Old question", createdAt: 1700000000150 }]
  });

  // Also ensure AI API keys stored in localStorage are NEVER touched or exported!
  sourceEnv.storage.setItem("quareia-ai-config-v1", JSON.stringify({
    version: 1,
    activeProfileId: "prof_local_1",
    profiles: [{
      id: "prof_local_1",
      format: "openai-chat",
      baseUrl: "https://secret-proxy.example/v1",
      apiKey: "sk-super-secret-do-not-export-99999",
      model: "gpt-4o-mini"
    }]
  }));

  // 1. Inspect local counts
  var localCounts = await fullBackup.inspectLocalCounts(s);
  assert.deepEqual(localCounts, {
    history: 3,
    cardNotes: 3,
    customSpreads: 2,
    aiChats: 2,
    preferences: 2,
    unavailable: []
  });

  // 2. Collect full backup
  var fixedIso = "2026-11-28T06:30:00.000Z";
  var collected = await fullBackup.collectBackup(s, { exportedAt: fixedIso });
  assert.equal(collected.exportedAt, fixedIso);
  assert.deepEqual(collected.unavailable, []);
  assert.deepEqual(collected.counts, {
    history: 3,
    cardNotes: 3,
    customSpreads: 2,
    aiChats: 2,
    preferences: 2
  });
  assert.equal(collected.envelope.format, "quareia-full-backup");
  assert.equal(collected.envelope.version, 1);
  assert.equal(collected.envelope.sections.history.formatVersion, 3);
  assert.equal(collected.envelope.sections.customSpreads.format, "quareia-custom-spreads");
  assert.deepEqual(collected.envelope.sections.preferences, { theme: "parchment", locale: "en" });

  // Zero API key or endpoint leakage in exported JSON
  assert.equal(collected.json.includes("sk-super-secret-do-not-export-99999"), false);
  assert.equal(collected.json.includes("secret-proxy.example"), false);
  assert.equal(collected.json.includes("apiKey"), false);

  // 3. Parse backup strictly
  var parsed = fullBackup.parseBackup(collected.json, s);
  assert.equal(parsed.format, "quareia-full-backup");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.exportedAt, fixedIso);
  assert.deepEqual(parsed.availableSections, ["history", "cardNotes", "customSpreads", "aiChats", "preferences"]);
  assert.deepEqual(parsed.counts, collected.counts);

  // 4. Restore into a fresh target environment
  var targetEnv = createTestEnvironment({ theme: "celestial", locale: "zh-CN", platform: "web" });
  var t = targetEnv.adapters;
  var result = await fullBackup.restoreBackup(parsed, parsed.availableSections, t);

  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.appliedPreferences, { theme: "parchment", locale: "en" });
  assert.deepEqual(result.restored.history, { imported: 3, remapped: 0, skipped: 0 });
  assert.deepEqual(result.restored.cardNotes, { imported: 3, skipped: 0 });
  assert.deepEqual(result.restored.customSpreads, { imported: 2, skipped: 0 });
  assert.deepEqual(result.restored.aiChats, { imported: 2, updated: 0, skipped: 0 });
  assert.deepEqual(result.restored.preferences, { theme: "parchment", locale: "en", applied: 2 });

  // Verify restored contents across all 5 stores
  var restoredHistory = await t.historyStore.listRecords();
  assert.equal(restoredHistory.length, 3);
  var restoredV2 = await t.historyStore.getRecord("rec-v2");
  assert.equal(restoredV2.question, "Should I switch roles?");
  assert.equal(restoredV2.reflection, "Looking back, the Fool pointed to missing prerequisites.");
  var restoredV3 = await t.historyStore.getRecord("rec-v3");
  assert.equal(restoredV3.schemaVersion, 3);
  assert.equal(restoredV3.reflection, "Order-only freeform note preserved.");

  assert.equal((await t.cardNotesStore.get("tarot", "major-00")).text, "  Fool study note\r\nLine 2  ");
  assert.equal((await t.cardNotesStore.get("mystagogus", "m-01")).text, "Progenitor before dawn");
  assert.equal((await t.cardNotesStore.get("lxxxi", "lxxxi-01")).text, "Star Father spark");

  assert.equal(t.customSpreadsLibrary.list().length, 2);

  var restoredActiveChat = await t.aiChatStore.getConversation("chat-active");
  assert.equal(restoredActiveChat.pinned, true);
  assert.equal(restoredActiveChat.messages.length, 2);
  assert.equal(restoredActiveChat.contextSummary.coveredUntilId, "m2");
  assert.equal(restoredActiveChat.lastUsage.totalTokens, 200);
  var restoredArchivedChat = await t.aiChatStore.getConversation("chat-archived");
  assert.equal(restoredArchivedChat.archived, true);

  assert.equal(t.themeApi.getTheme(), "parchment");
  assert.equal(t.i18nApi.getLocale(), "en");

  // 5. Idempotent re-restore of exact same backup creates zero duplicates
  var secondResult = await fullBackup.restoreBackup(collected.json, parsed.availableSections, t);
  assert.deepEqual(secondResult.warnings, []);
  assert.deepEqual(secondResult.restored.history, { imported: 0, remapped: 0, skipped: 3 });
  assert.deepEqual(secondResult.restored.cardNotes, { imported: 0, skipped: 3 });
  assert.deepEqual(secondResult.restored.customSpreads, { imported: 0, skipped: 2 });
  assert.deepEqual(secondResult.restored.aiChats, { imported: 0, updated: 0, skipped: 2 });
  assert.equal((await t.historyStore.listRecords()).length, 3);
  assert.equal((await t.cardNotesStore.list()).length, 3);
  assert.equal(t.customSpreadsLibrary.list().length, 2);
  assert.equal((await t.aiChatStore.listConversations({ archived: "all" })).length, 2);
});

test("non-destructive merge preserves local newer/distinct data across all stores and respects selectedSections", async function () {
  var env = createTestEnvironment({ theme: "ember", locale: "zh-CN", platform: "android" });
  var a = env.adapters;

  // Local existing data
  await a.historyStore.saveRecord(makePresetRecord("collision-id", "2026-11-01T10:00:00.000Z", {
    question: "Local reading on same ID"
  }));
  await a.cardNotesStore.save("tarot", "major-00", "Local Fool note (keep)", null);
  a.customSpreadsLibrary.upsert(makeCustomSpreadDef("Local Spread", "Keep me"));
  await a.aiChatStore.createConversation({
    id: "chat-local-newer",
    title: "Local newer chat",
    createdAt: 1000,
    updatedAt: 9000,
    messages: [{ id: "lm1", role: "user", content: "Newer local message", createdAt: 9000 }]
  });
  await a.aiChatStore.createConversation({
    id: "chat-local-older",
    title: "Local older chat",
    createdAt: 1000,
    updatedAt: 2000,
    messages: [{ id: "lo1", role: "user", content: "Older local message", createdAt: 2000 }]
  });

  // Incoming backup has:
  // - history record with SAME id ("collision-id") but DIFFERENT content -> must remap, not overwrite!
  // - card note for major-00 (existing -> skip) and major-01 (new -> import)
  // - 5 custom spreads (1 identical to Local Spread, 4 new -> total 5 hits Android limit; plus 1 extra -> capacity warning!)
  // - AI chats: local-newer (older in backup -> skip), local-older (newer in backup -> update), brand-new (import)
  // - preferences: jade / en — NOT selected -> must NOT change ember / zh-CN!
  var extraSpreads = [
    customSpreadsApi.encode(makeCustomSpreadDef("Local Spread", "Keep me")),
    customSpreadsApi.encode(makeCustomSpreadDef("Imported 1")),
    customSpreadsApi.encode(makeCustomSpreadDef("Imported 2")),
    customSpreadsApi.encode(makeCustomSpreadDef("Imported 3")),
    customSpreadsApi.encode(makeCustomSpreadDef("Imported 4")),
    customSpreadsApi.encode(makeCustomSpreadDef("Overflow 5"))
  ];
  var backupJson = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T07:00:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([
        makePresetRecord("collision-id", "2026-11-05T10:00:00.000Z", {
          question: "Incoming different reading on colliding ID"
        })
      ], "2026-11-28T07:00:00.000Z"),
      cardNotes: {
        format: "divination-card-notes",
        version: 1,
        notes: [
          { deckType: "tarot", cardId: "major-00", text: "Backup Fool note (should skip)" },
          { deckType: "tarot", cardId: "major-01", text: "Backup Magician note (should import)" }
        ]
      },
      customSpreads: {
        format: "quareia-custom-spreads",
        version: 1,
        codes: extraSpreads
      },
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000010000,
        conversations: [
          {
            id: "chat-local-newer",
            title: "Stale backup version",
            createdAt: 1000,
            updatedAt: 3000,
            messages: [{ id: "lm1", role: "user", content: "Old backup content", createdAt: 3000 }]
          },
          {
            id: "chat-local-older",
            title: "Updated backup version",
            createdAt: 1000,
            updatedAt: 5000,
            messages: [
              { id: "lo1", role: "user", content: "Older local message", createdAt: 2000 },
              { id: "lo2", role: "assistant", content: "Updated reply", createdAt: 5000 }
            ]
          },
          {
            id: "chat-brand-new",
            title: "Brand new chat",
            createdAt: 4000,
            updatedAt: 4500,
            messages: [{ id: "bn1", role: "user", content: "Hello", createdAt: 4500 }]
          }
        ]
      },
      preferences: { theme: "jade", locale: "en" }
    }
  });

  // Restore everything EXCEPT preferences
  var res = await fullBackup.restoreBackup(backupJson, ["history", "cardNotes", "customSpreads", "aiChats"], a);

  assert.deepEqual(res.restored.history, { imported: 1, remapped: 1, skipped: 0 });
  assert.equal((await a.historyStore.listRecords()).length, 2);
  assert.equal((await a.historyStore.getRecord("collision-id")).question, "Local reading on same ID");

  assert.deepEqual(res.restored.cardNotes, { imported: 1, skipped: 1 });
  assert.equal((await a.cardNotesStore.get("tarot", "major-00")).text, "Local Fool note (keep)");
  assert.equal((await a.cardNotesStore.get("tarot", "major-01")).text, "Backup Magician note (should import)");

  // Android limit is 5: 1 existing + 4 imported = 5; 1 duplicate + 1 overflow = 2 skipped, with capacity warning
  assert.deepEqual(res.restored.customSpreads, { imported: 4, skipped: 2 });
  assert.equal(a.customSpreadsLibrary.list().length, 5);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /capacity limit/i);

  assert.deepEqual(res.restored.aiChats, { imported: 1, updated: 1, skipped: 1 });
  assert.equal((await a.aiChatStore.getConversation("chat-local-newer")).title, "Local newer chat");
  assert.equal((await a.aiChatStore.getConversation("chat-local-older")).title, "Updated backup version");
  assert.equal((await a.aiChatStore.getConversation("chat-brand-new")).title, "Brand new chat");

  // Preferences were NOT selected, so theme/locale must stay untouched
  assert.deepEqual(res.appliedPreferences, { theme: null, locale: null });
  assert.equal(res.restored.preferences, undefined);
  assert.equal(a.themeApi.getTheme(), "ember");
  assert.equal(a.i18nApi.getLocale(), "zh-CN");
  assert.deepEqual(a.themeApi.calls, []);
  assert.deepEqual(a.i18nApi.calls, []);
});

test("rejects API keys, forbidden keys, extra keys, prototype pollution, and >16 MiB payloads fail-closed with zero writes", async function () {
  var env = createTestEnvironment({ theme: "celestial", locale: "zh-CN" });
  var a = env.adapters;

  var validSectionHistory = historyRecords.createExportEnvelope([
    makePresetRecord("should-not-write", "2026-11-01T00:00:00.000Z")
  ], "2026-11-28T06:00:00.000Z");

  // 1. Forbidden security / prototype pollution keys at various nesting levels
  var forbiddenPayloads = [
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"preferences":{"theme":"parchment"}},"__proto__":{"polluted":true}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"__proto__":{"polluted":true}}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"preferences":{"constructor":{"prototype":{"polluted":true}}}}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"preferences":{"prototype":{}}}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","apiKey":"sk-123","sections":{}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"apiKeys":["sk-123"]}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"providers":[]}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"profiles":[]}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"aiChats":{"format":"quareia-ai-chats-backup","version":1,"exportedAt":1000,"conversations":[{"id":"c1","endpoint":"https://evil.example","messages":[]}]}}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"aiChats":{"format":"quareia-ai-chats-backup","version":1,"exportedAt":1000,"conversations":[{"id":"c1","messages":[{"id":"m1","role":"user","content":"hi","token":"secret-tok"}]}]}}}',
    '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T06:00:00.000Z","sections":{"preferences":{"secret":"xyz"}}}'
  ];

  for (var i = 0; i < forbiddenPayloads.length; i += 1) {
    assert.throws(function () {
      fullBackup.parseBackup(forbiddenPayloads[i], a);
    }, /forbidden|unexpected/i);
    await assert.rejects(fullBackup.restoreBackup(forbiddenPayloads[i], ["history", "preferences"], a));
  }
  assert.equal(({}).polluted, undefined, "Object.prototype must never be polluted");

  // 2. Malformed JSON, wrong format/version, extra fields, invalid preferences
  var invalidPayloads = [
    "",
    "not json",
    "{}",
    JSON.stringify({ format: "wrong", version: 1, exportedAt: "2026-11-28T06:00:00.000Z", sections: {} }),
    JSON.stringify({ format: fullBackup.BACKUP_FORMAT, version: 2, exportedAt: "2026-11-28T06:00:00.000Z", sections: {} }),
    JSON.stringify({ format: fullBackup.BACKUP_FORMAT, version: 1, exportedAt: "not-iso", sections: {} }),
    JSON.stringify({ format: fullBackup.BACKUP_FORMAT, version: 1, exportedAt: "2026-11-28T06:00:00.000Z", sections: {}, extraField: 1 }),
    JSON.stringify({ format: fullBackup.BACKUP_FORMAT, version: 1, exportedAt: "2026-11-28T06:00:00.000Z", sections: { unknownSection: {} } }),
    JSON.stringify({ format: fullBackup.BACKUP_FORMAT, version: 1, exportedAt: "2026-11-28T06:00:00.000Z", sections: { preferences: { theme: "neon-xss" } } }),
    JSON.stringify({ format: fullBackup.BACKUP_FORMAT, version: 1, exportedAt: "2026-11-28T06:00:00.000Z", sections: { preferences: { locale: "fr-FR" } } }),
    JSON.stringify({ format: fullBackup.BACKUP_FORMAT, version: 1, exportedAt: "2026-11-28T06:00:00.000Z", sections: { preferences: { theme: "parchment", extra: true } } }),
    JSON.stringify({ format: fullBackup.BACKUP_FORMAT, version: 1, exportedAt: "2026-11-28T06:00:00.000Z", sections: { customSpreads: { format: "quareia-custom-spreads", version: 1, codes: ["QSP2.corrupted.00000000"] } } })
  ];
  for (var j = 0; j < invalidPayloads.length; j += 1) {
    assert.throws(function () { fullBackup.parseBackup(invalidPayloads[j], a); });
  }

  // 3. Fail-closed across sections: valid history + invalid cardNotes must NOT write history!
  var mixedInvalid = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T06:00:00.000Z",
    sections: {
      history: validSectionHistory,
      cardNotes: {
        format: "divination-card-notes",
        version: 1,
        notes: [{ deckType: "tarot", cardId: "fake-card-999", text: "invalid" }]
      },
      preferences: { theme: "parchment", locale: "en" }
    }
  });
  await assert.rejects(fullBackup.restoreBackup(mixedInvalid, ["history", "cardNotes", "preferences"], a), /unknown card key/i);
  assert.equal((await a.historyStore.listRecords()).length, 0, "History must remain untouched when another section is invalid");
  assert.equal((await a.cardNotesStore.list()).length, 0);
  assert.equal(a.themeApi.getTheme(), "celestial");
  assert.equal(a.i18nApi.getLocale(), "zh-CN");

  // 4. UTF-8 byte limit (>16 MiB) enforced BEFORE JSON.parse (ASCII and multi-byte UTF-8)
  var oversizedAscii = " ".repeat(fullBackup.MAX_BACKUP_BYTES + 1);
  assert.throws(function () { fullBackup.parseBackup(oversizedAscii); }, function (err) {
    return err.code === "backup_too_large";
  });
  var oversizedUtf8 = "汉".repeat(Math.floor(fullBackup.MAX_BACKUP_BYTES / 3) + 1);
  assert.ok(oversizedUtf8.length < fullBackup.MAX_BACKUP_BYTES, "UTF-16 length is below 16M while UTF-8 exceeds 16 MiB");
  assert.throws(function () { fullBackup.parseBackup(oversizedUtf8); }, function (err) {
    return err.code === "backup_too_large";
  });
  await assert.rejects(fullBackup.restoreBackup(oversizedUtf8, ["history"], a), { code: "backup_too_large" });

  // 5. Rejects unknown section name in selectedSections fail-closed before any write
  var validRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T06:00:00.000Z",
    sections: { history: validSectionHistory }
  });
  await assert.rejects(fullBackup.restoreBackup(validRaw, ["history", "apiKeys"], a), /unknown backup section/i);
  assert.equal((await a.historyStore.listRecords()).length, 0);
});

test("handles partial backups and unavailable stores gracefully without throwing", async function () {
  var brokenIdb = {
    open: function () { throw new Error("IndexedDB disabled in private mode"); }
  };
  var isKnownCard = createDeckCatalogChecker();
  var themeApi = createFakeThemeApi("grove-light");
  var i18nApi = createFakeI18nApi("zh-CN");

  var partialAdapters = {
    historyRecords: historyRecords,
    historyStore: historyStoreApi.createStore({ indexedDB: brokenIdb, recordsApi: historyRecords }),
    cardNotesStore: cardNotesStoreApi.createStore({ indexedDB: brokenIdb, isKnownCard: isKnownCard }),
    customSpreads: customSpreadsApi,
    customSpreadsLibrary: null,
    aiChatStoreApi: aiChatStoreApi,
    aiChatStore: aiChatStoreApi.createStore({ indexedDB: brokenIdb, memoryFallback: false }),
    themeApi: themeApi,
    i18nApi: i18nApi,
    isKnownCard: isKnownCard
  };

  // inspectLocalCounts must not throw; reports unavailable stores cleanly
  var counts = await fullBackup.inspectLocalCounts(partialAdapters);
  assert.deepEqual(counts, {
    history: 0,
    cardNotes: 0,
    customSpreads: 0,
    aiChats: 0,
    preferences: 2,
    unavailable: ["history", "cardNotes", "customSpreads", "aiChats"]
  });

  // collectBackup only includes readable sections
  var collected = await fullBackup.collectBackup(partialAdapters, { exportedAt: "2026-11-28T08:00:00.000Z" });
  assert.deepEqual(Object.keys(collected.envelope.sections), ["preferences"]);
  assert.deepEqual(collected.unavailable, ["history", "cardNotes", "customSpreads", "aiChats"]);
  assert.deepEqual(collected.envelope.sections.preferences, { theme: "grove-light", locale: "zh-CN" });

  // parseBackup handles partial backup cleanly
  var parsed = fullBackup.parseBackup(collected.json);
  assert.deepEqual(parsed.availableSections, ["preferences"]);
  assert.deepEqual(parsed.counts, {
    history: 0,
    cardNotes: 0,
    customSpreads: 0,
    aiChats: 0,
    preferences: 2
  });

  // Restoring partial backup on classic page (only 4 themes) warns cleanly for unsupported theme while applying locale
  var classicEnv = createTestEnvironment({
    theme: "celestial",
    locale: "en",
    allowedThemes: ["celestial", "parchment", "ember", "grove"]
  });
  var restored = await fullBackup.restoreBackup(parsed, ["preferences"], classicEnv.adapters);
  assert.deepEqual(restored.appliedPreferences, { theme: null, locale: "zh-CN" });
  assert.equal(classicEnv.adapters.themeApi.getTheme(), "celestial");
  assert.equal(classicEnv.adapters.i18nApi.getLocale(), "zh-CN");
  assert.equal(restored.warnings.length, 1);
  assert.match(restored.warnings[0], /grove-light/);
});

test("all 8 valid themes and both locales round-trip cleanly", async function () {
  for (var i = 0; i < fullBackup.VALID_THEMES.length; i += 1) {
    var theme = fullBackup.VALID_THEMES[i];
    var locale = fullBackup.VALID_LOCALES[i % fullBackup.VALID_LOCALES.length];
    var raw = JSON.stringify({
      format: fullBackup.BACKUP_FORMAT,
      version: 1,
      exportedAt: "2026-11-28T09:00:00.000Z",
      sections: { preferences: { theme: theme, locale: locale } }
    });
    var parsed = fullBackup.parseBackup(raw);
    assert.deepEqual(parsed.sections.preferences, { theme: theme, locale: locale });

    var target = createTestEnvironment({ theme: "celestial", locale: "zh-CN" });
    var res = await fullBackup.restoreBackup(parsed, ["preferences"], target.adapters);
    assert.deepEqual(res.appliedPreferences, { theme: theme, locale: locale });
    assert.equal(target.adapters.themeApi.getTheme(), theme);
    assert.equal(target.adapters.i18nApi.getLocale(), locale);
  }
});

test("rejects oversized aiChats section (>8 MiB) fail-closed before writing any other section", async function () {
  var env = createTestEnvironment();
  var a = env.adapters;
  var bigContent = "x".repeat(aiChatStoreApi.MAX_BACKUP_BYTES + 1024);
  var raw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T09:30:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([
        makePresetRecord("before-big-chat", "2026-11-01T00:00:00.000Z")
      ], "2026-11-28T09:30:00.000Z"),
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000000000,
        conversations: [{
          id: "huge-chat",
          title: "Huge",
          createdAt: 1000,
          updatedAt: 1000,
          messages: [{ id: "m1", role: "user", content: bigContent, createdAt: 1000 }]
        }]
      }
    }
  });
  // Total payload is ~8 MiB (<16 MiB overall limit), so aiChats' own 8 MiB limit catches it fail-closed!
  assert.ok(fullBackup.utf8ByteLength(raw) < fullBackup.MAX_BACKUP_BYTES);
  assert.throws(function () { fullBackup.parseBackup(raw, a); }, { code: "backup_too_large" });
  await assert.rejects(fullBackup.restoreBackup(raw, ["history", "aiChats"], a), { code: "backup_too_large" });
  assert.equal((await a.historyStore.listRecords()).length, 0, "History must not be written when aiChats exceeds 8 MiB");
});

test("supports legacy QSP1 custom spread codes and skips canonical duplicates cleanly", async function () {
  var env = createTestEnvironment({ platform: "web" });
  var a = env.adapters;
  var def = makeCustomSpreadDef("Legacy Spread", "From QSP1");
  // Save canonical v2 spread locally
  a.customSpreadsLibrary.upsert(def);
  var v2Code = customSpreadsApi.encode(def);
  // Construct matching v1 QSP1 code (same name/desc/grid/positions)
  var v1Json = JSON.stringify({
    v: 1,
    n: def.name,
    d: def.description,
    c: def.columns,
    r: def.rows,
    p: def.positions.map(function (p) { return [p.name, p.meaning, p.column, p.row]; })
  });
  var payload = Buffer.from(v1Json, "utf8").toString("base64url");
  var hash = 0x811C9DC5;
  for (var i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  var v1Code = "QSP1." + payload + "." + hash.toString(16).padStart(8, "0");
  assert.notEqual(v1Code, v2Code);

  var raw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T10:00:00.000Z",
    sections: {
      customSpreads: {
        format: "quareia-custom-spreads",
        version: 1,
        codes: [v1Code]
      }
    }
  });
  var res = await fullBackup.restoreBackup(raw, ["customSpreads"], a);
  assert.deepEqual(res.restored.customSpreads, { imported: 0, skipped: 1 });
  assert.equal(a.customSpreadsLibrary.list().length, 1);

  // Duplicate canonical codes (QSP1 + QSP2 of same spread) inside ONE backup fail closed
  var dupRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T10:00:00.000Z",
    sections: {
      customSpreads: {
        format: "quareia-custom-spreads",
        version: 1,
        codes: [v1Code, v2Code]
      }
    }
  });
  assert.throws(function () { fullBackup.parseBackup(dupRaw, a); }, /duplicate/i);
});

test("loads cleanly as a pure browser UMD global without CommonJS and rejects forged pre-parsed objects", async function () {
  var sandbox = {
    URL: URL,
    TextEncoder: TextEncoder,
    Buffer: undefined
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  var scripts = [
    "js/tarot-data.js",
    "js/mystagogus-data.js",
    "js/lxxxi-data.js",
    "js/history-records.js",
    "js/history-store.js",
    "js/card-notes-store.js",
    "js/custom-spreads.js",
    "js/ai-chat-store.js",
    "js/full-backup.js"
  ];
  scripts.forEach(function (rel) {
    var code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    vm.runInNewContext(code, sandbox, { filename: rel });
  });

  var browserApi = sandbox.DivinationFullBackup;
  assert.ok(browserApi, "Browser global DivinationFullBackup must be exported");
  assert.equal(browserApi.BACKUP_FORMAT, "quareia-full-backup");

  // Uses top-level const tarotDeckFull / mystagogusDeckFull / lxxxiDeckFull automatically in browser mode
  var okRaw = JSON.stringify({
    format: "quareia-full-backup",
    version: 1,
    exportedAt: "2026-11-28T11:00:00.000Z",
    sections: {
      cardNotes: {
        format: "divination-card-notes",
        version: 1,
        notes: [
          { deckType: "tarot", cardId: "minor-cups-queen", text: "Queen of Cups" },
          { deckType: "mystagogus", cardId: "m-78", text: "Empty Vessel" },
          { deckType: "lxxxi", cardId: "lxxxi-81", text: "Card 81" }
        ]
      }
    }
  });
  var parsed = browserApi.parseBackup(okRaw);
  assert.equal(parsed.counts.cardNotes, 3);

  // Rejects forged pre-parsed objects with unexpected or non-enumerable forbidden keys
  var env = createTestEnvironment();
  var forgedExtra = {
    format: "quareia-full-backup",
    version: 1,
    exportedAt: "2026-11-28T11:00:00.000Z",
    sections: { preferences: { theme: "parchment" } },
    unexpectedTopKey: true
  };
  await assert.rejects(fullBackup.restoreBackup(forgedExtra, ["preferences"], env.adapters), /unexpected key/i);
  assert.equal(env.adapters.themeApi.getTheme(), "celestial");

  var forgedHidden = {
    format: "quareia-full-backup",
    version: 1,
    exportedAt: "2026-11-28T11:00:00.000Z",
    sections: { preferences: { theme: "parchment" } }
  };
  Object.defineProperty(forgedHidden.sections.preferences, "apiKey", {
    value: "sk-hidden",
    enumerable: false
  });
  await assert.rejects(fullBackup.restoreBackup(forgedHidden, ["preferences"], env.adapters), /forbidden key/i);
  assert.equal(env.adapters.themeApi.getTheme(), "celestial");
});

test("Fix #1: rejects incomplete/missing-timestamp AI conversations and never lets unverified or equal timestamps overwrite local chats", async function () {
  var env = createTestEnvironment();
  var a = env.adapters;

  await a.aiChatStore.createConversation({
    id: "chat-keep",
    title: "Local important conversation",
    createdAt: 1700000000000,
    updatedAt: 1700000005000,
    pinned: true,
    messages: [{ id: "m-local", role: "user", content: "Do not wipe me", createdAt: 1700000005000 }]
  });

  // Incomplete entries from a 2020 backup (missing timestamps / messages / zero timestamps) must fail closed.
  var incompleteConversations = [
    { id: "chat-keep" },
    { id: "chat-keep", messages: [] },
    { id: "chat-keep", createdAt: 1577836800000, messages: [] },
    { id: "chat-keep", updatedAt: 1577836800000, messages: [] },
    { id: "chat-keep", createdAt: 1577836800000, updatedAt: 1577836800000 },
    { id: "chat-keep", createdAt: 0, updatedAt: 1577836800000, messages: [] },
    { id: "chat-keep", createdAt: 1577836800000, updatedAt: 0, messages: [] },
    { id: "chat-keep", createdAt: 1577836800000, updatedAt: "", messages: [] },
    { title: "No id", createdAt: 1577836800000, updatedAt: 1577836800000, messages: [] }
  ];

  for (var i = 0; i < incompleteConversations.length; i += 1) {
    var raw = JSON.stringify({
      format: fullBackup.BACKUP_FORMAT,
      version: 1,
      exportedAt: "2020-01-01T00:00:00.000Z",
      sections: {
        aiChats: {
          format: "quareia-ai-chats-backup",
          version: 1,
          exportedAt: 1577836800000,
          conversations: [incompleteConversations[i]]
        }
      }
    });
    assert.throws(function () { fullBackup.parseBackup(raw, a); }, /createdAt|updatedAt|messages|id/i);
    await assert.rejects(fullBackup.restoreBackup(raw, ["aiChats"], a));
  }

  // Local conversation must be completely untouched.
  var afterBad = await a.aiChatStore.getConversation("chat-keep");
  assert.equal(afterBad.messages.length, 1);
  assert.equal(afterBad.messages[0].content, "Do not wipe me");
  assert.equal(afterBad.pinned, true);

  // Equal timestamp (e.g. local was pinned/edited without touching updatedAt, or empty messages) must keep local intact.
  var equalTsRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T06:00:00.000Z",
    sections: {
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000005000,
        conversations: [{
          id: "chat-keep",
          title: "Unpinned backup with 0 messages",
          createdAt: 1700000000000,
          updatedAt: 1700000005000,
          pinned: false,
          messages: []
        }]
      }
    }
  });
  var equalRes = await fullBackup.restoreBackup(equalTsRaw, ["aiChats"], a);
  assert.equal(equalRes.status, "ok");
  assert.deepEqual(equalRes.restored.aiChats, { imported: 0, updated: 0, skipped: 1 });
  var afterEqual = await a.aiChatStore.getConversation("chat-keep");
  assert.equal(afterEqual.messages.length, 1);
  assert.equal(afterEqual.pinned, true);
  assert.equal(afterEqual.title, "Local important conversation");

  // Strictly newer proven timestamp updates cleanly.
  var newerTsRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T06:00:00.000Z",
    sections: {
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000010000,
        conversations: [{
          id: "chat-keep",
          title: "Legitimately newer chat",
          createdAt: 1700000000000,
          updatedAt: 1700000010000,
          pinned: true,
          messages: [
            { id: "m-local", role: "user", content: "Do not wipe me", createdAt: 1700000005000 },
            { id: "m-reply", role: "assistant", content: "Newer assistant reply", createdAt: 1700000010000 }
          ]
        }]
      }
    }
  });
  var newerRes = await fullBackup.restoreBackup(newerTsRaw, ["aiChats"], a);
  assert.equal(newerRes.status, "ok");
  assert.deepEqual(newerRes.restored.aiChats, { imported: 0, updated: 1, skipped: 0 });
  var afterNewer = await a.aiChatStore.getConversation("chat-keep");
  assert.equal(afterNewer.title, "Legitimately newer chat");
  assert.equal(afterNewer.messages.length, 2);
});

test("Fix #2 & Fix #4: remapped history IDs rewrite restored AI chat references and retrying ID-conflicting backup does not duplicate records", async function () {
  var env = createTestEnvironment();
  var a = env.adapters;

  // Local device has reading id="shared" with Card A (major-00 / Fool).
  await a.historyStore.saveRecord(makePresetRecord("shared", "2026-11-01T10:00:00.000Z", {
    question: "Local Fool reading"
  }));

  // Backup also has id="shared" with Card B (major-01 / Magician), plus a non-colliding reading "unique-2",
  // and an AI chat linked to both "shared" and "unique-2" across readingIds, readingSnapshots, and interpretedReadingIds.
  var backupReadingShared = makePresetRecord("shared", "2026-11-02T12:00:00.000Z", {
    question: "Backup Magician reading",
    cards: [{
      cardId: "major-01",
      cardNumber: "1",
      cardName: "魔法师",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "当下 · Present",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  });
  var backupReadingUnique = makePresetRecord("unique-2", "2026-11-03T12:00:00.000Z", {
    question: "Unique reading"
  });

  var rawBackup = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T08:00:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([backupReadingShared, backupReadingUnique], "2026-11-28T08:00:00.000Z"),
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000020000,
        conversations: [{
          id: "chat-linked",
          title: "Magician follow-up",
          createdAt: 1700000010000,
          updatedAt: 1700000020000,
          readingIds: ["shared", "unique-2"],
          readingSnapshots: [
            {
              id: "shared",
              layoutMode: "preset",
              deckType: "tarot",
              spreadId: "three-card-horizontal",
              spreadName: "三张牌",
              positionCount: 1,
              createdAt: 1700000005000,
              question: "Backup Magician reading",
              cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-01", cardName: "魔法师", orientation: "upright" }]
            },
            {
              id: "unique-2",
              layoutMode: "preset",
              deckType: "tarot",
              spreadId: "three-card-horizontal",
              spreadName: "三张牌",
              positionCount: 1,
              createdAt: 1700000006000,
              question: "Unique reading",
              cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-00", cardName: "愚者", orientation: "upright" }]
            }
          ],
          messages: [
            { id: "m1", role: "user", content: "Analyze both spreads", createdAt: 1700000011000 },
            {
              id: "m2",
              role: "assistant",
              content: "Magician directs focus.",
              createdAt: 1700000012000,
              interpretedReadingIds: ["shared", "unique-2"]
            }
          ]
        }]
      }
    }
  });

  var parsed = fullBackup.parseBackup(rawBackup, a);

  // First restore: "shared" remaps to a fresh ID, AI chat links must follow the remapped ID.
  var firstRes = await fullBackup.restoreBackup(parsed, ["history", "aiChats"], a);
  assert.equal(firstRes.status, "ok");
  assert.deepEqual(firstRes.succeededSections, ["history", "aiChats"]);
  assert.deepEqual(firstRes.failedSections, []);
  assert.deepEqual(firstRes.restored.history, { imported: 2, remapped: 1, skipped: 0 });
  assert.deepEqual(firstRes.restored.aiChats, { imported: 1, updated: 0, skipped: 0 });

  var remappedId = firstRes.historyIdMap.shared;
  assert.ok(typeof remappedId === "string" && remappedId.length > 0 && remappedId !== "shared");
  assert.deepEqual(Object.keys(firstRes.historyIdMap), ["shared"]);

  // Local "shared" is untouched; remappedId holds Magician; total history count is 3.
  assert.equal((await a.historyStore.listRecords()).length, 3);
  assert.equal((await a.historyStore.getRecord("shared")).question, "Local Fool reading");
  assert.equal((await a.historyStore.getRecord(remappedId)).question, "Backup Magician reading");
  assert.equal((await a.historyStore.getRecord(remappedId)).cards[0].cardId, "major-01");

  // Restored AI chat must reference remappedId (NOT local "shared") across all reference locations.
  var chat = await a.aiChatStore.getConversation("chat-linked");
  assert.deepEqual(chat.readingIds, [remappedId, "unique-2"]);
  assert.deepEqual(chat.readingSnapshots.map(function (s) { return s.id; }), [remappedId, "unique-2"]);
  assert.deepEqual(chat.messages[1].interpretedReadingIds, [remappedId, "unique-2"]);

  // Parsed object must not have been mutated in place.
  assert.deepEqual(parsed.sections.aiChats.conversations[0].readingIds, ["shared", "unique-2"]);

  // Fix #4: Retrying the EXACT same ID-conflicting backup must NOT create a duplicate remapped copy!
  var retryRes = await fullBackup.restoreBackup(parsed, ["history", "aiChats"], a);
  assert.equal(retryRes.status, "ok");
  assert.deepEqual(retryRes.restored.history, { imported: 0, remapped: 0, skipped: 2 });
  assert.deepEqual(retryRes.restored.aiChats, { imported: 0, updated: 0, skipped: 1 });
  assert.equal((await a.historyStore.listRecords()).length, 3, "No duplicate remapped record on retry");
  assert.deepEqual(retryRes.historyIdMap, { shared: remappedId }, "historyIdMap must still point to existing remapped copy on retry");

  // Partial-failure retry: if AI chat failed on attempt 1 and user retries ONLY ["aiChats"], it still remaps to remappedId!
  await a.aiChatStore.deleteConversation("chat-linked");
  var aiRetryOnly = await fullBackup.restoreBackup(parsed, ["aiChats"], a);
  assert.equal(aiRetryOnly.status, "ok");
  assert.deepEqual(aiRetryOnly.historyIdMap, { shared: remappedId });
  var chatAfterAiOnlyRetry = await a.aiChatStore.getConversation("chat-linked");
  assert.deepEqual(chatAfterAiOnlyRetry.readingIds, [remappedId, "unique-2"]);
  assert.deepEqual(chatAfterAiOnlyRetry.readingSnapshots.map(function (s) { return s.id; }), [remappedId, "unique-2"]);
  assert.deepEqual(chatAfterAiOnlyRetry.messages[1].interpretedReadingIds, [remappedId, "unique-2"]);
});

test("Fix #3: collectBackup rejects un-importable oversized exports with structured export_too_large errors", async function () {
  // Repro A: 1,150 valid history records exceeding DivinationHistoryRecords.MAX_IMPORT_BYTES (5 MiB)
  var manyRecords = [];
  var longQuestion = "Q".repeat(1500);
  var longNote = "A".repeat(3800);
  var baseTs = Date.parse("2026-01-01T00:00:00.000Z");
  for (var i = 0; i < 1150; i += 1) {
    manyRecords.push(makePresetRecord("rec-" + i, new Date(baseTs + i * 60000).toISOString(), {
      question: longQuestion + "-" + i,
      reflection: longNote
    }));
  }
  var envHistoryTooBig = createTestEnvironment();
  envHistoryTooBig.adapters.historyStore = {
    listRecords: async function () { return manyRecords; },
    importRecords: async function () { return { importedCount: 0, remappedCount: 0, records: [] }; }
  };

  await assert.rejects(
    fullBackup.collectBackup(envHistoryTooBig.adapters, { exportedAt: "2026-11-28T10:00:00.000Z" }),
    function (err) {
      assert.equal(err.code, "export_too_large");
      assert.equal(err.maxBytes, fullBackup.MAX_BACKUP_BYTES);
      assert.ok(typeof err.totalBytes === "number" && err.totalBytes > historyRecords.MAX_IMPORT_BYTES);
      assert.ok(Array.isArray(err.oversizedSections));
      var histEntry = err.oversizedSections.find(function (s) { return s.section === "history"; });
      assert.ok(histEntry, "oversizedSections must identify history");
      assert.equal(histEntry.maxBytes, historyRecords.MAX_IMPORT_BYTES);
      assert.ok(histEntry.bytes > historyRecords.MAX_IMPORT_BYTES);
      assert.match(err.message, /history/i);
      return true;
    }
  );

  // Repro B: Huge card notes exceeding MAX_BACKUP_BYTES (16 MiB)
  var hugeText = "X".repeat(16 * 1024 * 1024 + 4096);
  var envNotesTooBig = createTestEnvironment();
  envNotesTooBig.adapters.cardNotesStore = {
    exportBackup: async function () {
      return JSON.stringify({
        format: "divination-card-notes",
        version: 1,
        notes: [{ deckType: "tarot", cardId: "major-00", text: hugeText }]
      });
    }
  };
  await assert.rejects(
    fullBackup.collectBackup(envNotesTooBig.adapters, { exportedAt: "2026-11-28T10:00:00.000Z" }),
    function (err) {
      assert.equal(err.code, "export_too_large");
      assert.ok(err.totalBytes > fullBackup.MAX_BACKUP_BYTES);
      assert.equal(err.maxBytes, fullBackup.MAX_BACKUP_BYTES);
      assert.ok(err.oversizedSections.some(function (s) { return s.section === "cardNotes"; }));
      assert.ok(err.oversizedSections.some(function (s) { return s.section === "total"; }));
      return true;
    }
  );

  // Repro C: Oversized AI chats (> 8 MiB) must throw export_too_large rather than silently becoming unavailable
  var hugeChatText = "Y".repeat(aiChatStoreApi.MAX_BACKUP_BYTES + 2048);
  var envAiTooBig = createTestEnvironment();
  envAiTooBig.adapters.aiChatStore = {
    exportBackup: async function () {
      return {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000000000,
        conversations: [{
          id: "big-chat",
          title: "Huge chat",
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          messages: [{ id: "m1", role: "user", content: hugeChatText, createdAt: 1700000000000 }]
        }]
      };
    }
  };
  await assert.rejects(
    fullBackup.collectBackup(envAiTooBig.adapters, { exportedAt: "2026-11-28T10:00:00.000Z" }),
    function (err) {
      assert.equal(err.code, "export_too_large");
      var aiEntry = err.oversizedSections.find(function (s) { return s.section === "aiChats"; });
      assert.ok(aiEntry, "oversizedSections must identify aiChats");
      assert.equal(aiEntry.maxBytes, aiChatStoreApi.MAX_BACKUP_BYTES);
      assert.ok(aiEntry.bytes > aiChatStoreApi.MAX_BACKUP_BYTES);
      return true;
    }
  );

  // Repro D: Combined sections individually within limits, but total exceeds 16 MiB
  var envTotalTooBig = createTestEnvironment();
  envTotalTooBig.adapters.cardNotesStore = {
    exportBackup: async function () {
      return JSON.stringify({
        format: "divination-card-notes",
        version: 1,
        notes: [
          { deckType: "tarot", cardId: "major-00", text: "N".repeat(10 * 1024 * 1024) }
        ]
      });
    }
  };
  envTotalTooBig.adapters.aiChatStore = {
    exportBackup: async function () {
      return {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000000000,
        conversations: [{
          id: "med-chat",
          title: "7 MiB chat",
          createdAt: 1700000000000,
          updatedAt: 1700000000000,
          messages: [{ id: "m1", role: "user", content: "C".repeat(7 * 1024 * 1024), createdAt: 1700000000000 }]
        }]
      };
    }
  };
  await assert.rejects(
    fullBackup.collectBackup(envTotalTooBig.adapters, { exportedAt: "2026-11-28T10:00:00.000Z" }),
    function (err) {
      assert.equal(err.code, "export_too_large");
      assert.ok(err.totalBytes > fullBackup.MAX_BACKUP_BYTES);
      assert.deepEqual(err.oversizedSections.map(function (s) { return s.section; }), ["total"]);
      return true;
    }
  );
});

test("Shared outcome contract: restoreBackup returns status ok | partial | failed with succeededSections, failedSections, and historyIdMap", async function () {
  var raw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T11:30:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([
        makePresetRecord("h-1", "2026-11-01T00:00:00.000Z")
      ], "2026-11-28T11:30:00.000Z"),
      cardNotes: {
        format: "divination-card-notes",
        version: 1,
        notes: [{ deckType: "tarot", cardId: "major-00", text: "Note 1" }]
      },
      preferences: { theme: "parchment", locale: "en" }
    }
  });

  // 1. All-failed: selecting only cardNotes when notes store refuses to open
  var envAllFail = createTestEnvironment();
  envAllFail.adapters.cardNotesStore = {
    importBackup: async function () {
      var err = new Error("IndexedDB blocked");
      err.code = "idb_blocked";
      throw err;
    }
  };
  var allFailRes = await fullBackup.restoreBackup(raw, ["cardNotes"], envAllFail.adapters);
  assert.equal(allFailRes.status, "failed");
  assert.deepEqual(allFailRes.succeededSections, []);
  assert.equal(allFailRes.failedSections.length, 1);
  assert.equal(allFailRes.failedSections[0].section, "cardNotes");
  assert.equal(allFailRes.failedSections[0].code, "idb_blocked");
  assert.match(allFailRes.failedSections[0].message, /IndexedDB blocked/);
  assert.deepEqual(allFailRes.historyIdMap, {});

  // 2. Partial-failed: history + preferences succeed, cardNotes fails
  var partialRes = await fullBackup.restoreBackup(raw, ["history", "cardNotes", "preferences"], envAllFail.adapters);
  assert.equal(partialRes.status, "partial");
  assert.deepEqual(partialRes.succeededSections, ["history", "preferences"]);
  assert.equal(partialRes.failedSections.length, 1);
  assert.equal(partialRes.failedSections[0].section, "cardNotes");

  // 3. All-ok on empty selection
  var emptySelRes = await fullBackup.restoreBackup(raw, [], envAllFail.adapters);
  assert.equal(emptySelRes.status, "ok");
  assert.deepEqual(emptySelRes.succeededSections, []);
  assert.deepEqual(emptySelRes.failedSections, []);
  assert.deepEqual(emptySelRes.historyIdMap, {});
});

test("Review 2 Fix #1: blocks or defers aiChats when colliding history readings are unresolved (both aiChats-first and 5000-cap history failure)", async function () {
  var localReading = makePresetRecord("shared", "2026-11-01T10:00:00.000Z", {
    question: "Local Hierophant",
    cards: [{
      cardId: "major-05",
      cardNumber: "5",
      cardName: "教皇",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "当下 · Present",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  });
  var backupReading = makePresetRecord("shared", "2026-11-02T10:00:00.000Z", {
    question: "Backup Fool",
    cards: [{
      cardId: "major-00",
      cardNumber: "0",
      cardName: "愚者",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "当下 · Present",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  });
  var rawBackup = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T12:00:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([backupReading], "2026-11-28T12:00:00.000Z"),
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000050000,
        conversations: [{
          id: "chat-shared",
          title: "Fool reading chat",
          createdAt: 1700000040000,
          updatedAt: 1700000050000,
          readingIds: ["shared"],
          readingSnapshots: [{
            id: "shared",
            layoutMode: "preset",
            deckType: "tarot",
            spreadId: "three-card-horizontal",
            spreadName: "三张牌",
            positionCount: 1,
            createdAt: 1700000030000,
            question: "Backup Fool",
            cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-00", cardName: "愚者", orientation: "upright" }]
          }],
          messages: [
            { id: "m1", role: "user", content: "Interpret Fool", createdAt: 1700000045000 },
            { id: "m2", role: "assistant", content: "Fool means blank slate.", createdAt: 1700000050000, interpretedReadingIds: ["shared"] }
          ]
        }]
      }
    }
  });

  // Repro A: user restores aiChats ONLY before history -> MUST fail with history_dependency_required and NOT write aiChats!
  var envA = createTestEnvironment();
  await envA.adapters.historyStore.saveRecord(localReading);
  var resAiFirst = await fullBackup.restoreBackup(rawBackup, ["aiChats"], envA.adapters);
  assert.equal(resAiFirst.status, "failed");
  assert.deepEqual(resAiFirst.succeededSections, []);
  assert.equal(resAiFirst.failedSections.length, 1);
  assert.equal(resAiFirst.failedSections[0].section, "aiChats");
  assert.equal(resAiFirst.failedSections[0].code, "history_dependency_required");
  assert.equal((await envA.adapters.aiChatStore.listConversations({ archived: "all" })).length, 0, "aiChats must NOT be written when colliding history is unresolved");

  // Once history is restored first, restoring aiChats second succeeds and links to the deterministic remapped ID!
  var resHistThen = await fullBackup.restoreBackup(rawBackup, ["history"], envA.adapters);
  assert.equal(resHistThen.status, "ok");
  var remappedIdA = resHistThen.historyIdMap.shared;
  assert.match(remappedIdA, /^reading-remap-[0-9a-f]{32}$/);

  var resAiSecond = await fullBackup.restoreBackup(rawBackup, ["aiChats"], envA.adapters);
  assert.equal(resAiSecond.status, "ok");
  assert.deepEqual(resAiSecond.historyIdMap, { shared: remappedIdA });
  var chatA = await envA.adapters.aiChatStore.getConversation("chat-shared");
  assert.deepEqual(chatA.readingIds, [remappedIdA]);
  assert.equal(chatA.readingSnapshots[0].id, remappedIdA);
  assert.deepEqual(chatA.messages[1].interpretedReadingIds, [remappedIdA]);

  // Repro B: local history is at MAX_RECORDS cap (modeled via bounded MAX_RECORDS=2 with 2 existing records).
  var cappedRecordsApi = Object.assign({}, historyRecords, { MAX_RECORDS: 2 });
  var envB = createTestEnvironment({ recordsApi: cappedRecordsApi });
  await envB.adapters.historyStore.saveRecord(localReading);
  await envB.adapters.historyStore.saveRecord(makePresetRecord("filler-cap", "2026-10-01T00:00:00.000Z"));

  var resAtCap = await fullBackup.restoreBackup(rawBackup, ["history", "aiChats"], envB.adapters);
  assert.equal(resAtCap.status, "failed");
  assert.deepEqual(resAtCap.succeededSections, []);
  assert.equal(resAtCap.failedSections.length, 2);
  assert.equal(resAtCap.failedSections[0].section, "history");
  assert.equal(resAtCap.failedSections[1].section, "aiChats");
  assert.equal(resAtCap.failedSections[1].code, "history_dependency_failed");
  assert.equal((await envB.adapters.aiChatStore.listConversations({ archived: "all" })).length, 0, "aiChats must stay deferred when history fails at record cap");

  // Free 1 slot and retry both -> succeeds cleanly with aiChats bound to remapped ID (NOT local major-05)!
  await envB.adapters.historyStore.deleteRecord("filler-cap");
  var resAfterFree = await fullBackup.restoreBackup(rawBackup, ["history", "aiChats"], envB.adapters);
  assert.equal(resAfterFree.status, "ok");
  assert.deepEqual(resAfterFree.succeededSections, ["history", "aiChats"]);
  var remappedIdB = resAfterFree.historyIdMap.shared;
  assert.equal(remappedIdB, remappedIdA, "Deterministic remap ID must be identical across devices");
  var chatB = await envB.adapters.aiChatStore.getConversation("chat-shared");
  assert.deepEqual(chatB.readingIds, [remappedIdB]);
  assert.equal((await envB.adapters.historyStore.getRecord(remappedIdB)).cards[0].cardId, "major-00");
  assert.equal((await envB.adapters.historyStore.getRecord("shared")).cards[0].cardId, "major-05");
});

test("Review 2 Fix #2: preserves two independent history IDs with identical createdAt and cards across restore and AI chat links", async function () {
  var twin1 = makePresetRecord("r1", "2026-11-10T08:00:00.000Z", { question: "Identical reading" });
  var twin2 = makePresetRecord("r2", "2026-11-10T08:00:00.000Z", { question: "Identical reading" });

  var rawBackup = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T12:30:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([twin1, twin2], "2026-11-28T12:30:00.000Z"),
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000060000,
        conversations: [{
          id: "chat-twins",
          title: "Comparing r1 and r2",
          createdAt: 1700000055000,
          updatedAt: 1700000060000,
          readingIds: ["r1", "r2"],
          readingSnapshots: [
            { id: "r1", layoutMode: "preset", deckType: "tarot", spreadName: "三张牌", positionCount: 1, createdAt: 1700000050000, cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-00", cardName: "愚者" }] },
            { id: "r2", layoutMode: "preset", deckType: "tarot", spreadName: "三张牌", positionCount: 1, createdAt: 1700000050000, cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-00", cardName: "愚者" }] }
          ],
          messages: [
            { id: "m1", role: "user", content: "Compare", createdAt: 1700000056000 },
            { id: "m2", role: "assistant", content: "Both attached.", createdAt: 1700000060000, interpretedReadingIds: ["r1", "r2"] }
          ]
        }]
      }
    }
  });

  // Device already holds r1 -> r1 skips, r2 MUST import under "r2" (NOT collapse into "r1")!
  var env = createTestEnvironment();
  await env.adapters.historyStore.saveRecord(twin1);

  var res = await fullBackup.restoreBackup(rawBackup, ["history", "aiChats"], env.adapters);
  assert.equal(res.status, "ok");
  assert.deepEqual(res.restored.history, { imported: 1, remapped: 0, skipped: 1 });
  assert.deepEqual(res.historyIdMap, {});
  assert.equal((await env.adapters.historyStore.listRecords()).length, 2);
  assert.ok(await env.adapters.historyStore.getRecord("r1"));
  assert.ok(await env.adapters.historyStore.getRecord("r2"));

  var chat = await env.adapters.aiChatStore.getConversation("chat-twins");
  assert.deepEqual(chat.readingIds, ["r1", "r2"]);
  assert.deepEqual(chat.readingSnapshots.map(function (s) { return s.id; }), ["r1", "r2"]);
  assert.deepEqual(chat.messages[1].interpretedReadingIds, ["r1", "r2"]);

  // Even when BOTH r1 and r2 collide with DIFFERENT local readings, deterministic IDs remain distinct!
  var envBothCollide = createTestEnvironment();
  await envBothCollide.adapters.historyStore.saveRecord(makePresetRecord("r1", "2026-10-01T00:00:00.000Z", { question: "Other 1" }));
  await envBothCollide.adapters.historyStore.saveRecord(makePresetRecord("r2", "2026-10-02T00:00:00.000Z", { question: "Other 2" }));
  var resCollide = await fullBackup.restoreBackup(rawBackup, ["history", "aiChats"], envBothCollide.adapters);
  assert.equal(resCollide.status, "ok");
  assert.deepEqual(resCollide.restored.history, { imported: 2, remapped: 2, skipped: 0 });
  assert.notEqual(resCollide.historyIdMap.r1, resCollide.historyIdMap.r2);
  var chatCollide = await envBothCollide.adapters.aiChatStore.getConversation("chat-twins");
  assert.deepEqual(chatCollide.readingIds, [resCollide.historyIdMap.r1, resCollide.historyIdMap.r2]);
  assert.equal(chatCollide.readingSnapshots.length, 2);
});

test("Review 2 Fix #3: rejects out-of-range numeric timestamps (1.8e18) fail-closed before touching local AI chats or crashing Markdown export", async function () {
  var env = createTestEnvironment();
  await env.adapters.aiChatStore.createConversation({
    id: "chat-safe",
    title: "Valid local chat",
    createdAt: 1700000000000,
    updatedAt: 1700000005000,
    messages: [{ id: "m1", role: "user", content: "Safe message", createdAt: 1700000005000 }]
  });

  var badTimestamps = [
    { id: "chat-safe", createdAt: 1700000000000, updatedAt: 1.8e18, messages: [] },
    { id: "chat-safe", createdAt: 1.8e18, updatedAt: 1700000005000, messages: [] },
    { id: "chat-safe", createdAt: 1700000000000, updatedAt: "1800000000000000000", messages: [] },
    { id: "chat-safe", createdAt: 1700000000000, updatedAt: 8640000000000001, messages: [] },
    {
      id: "chat-safe",
      createdAt: 1700000000000,
      updatedAt: 1700000010000,
      messages: [{ id: "m2", role: "user", content: "Bad msg ts", createdAt: 1.8e18 }]
    }
  ];

  for (var i = 0; i < badTimestamps.length; i += 1) {
    var raw = JSON.stringify({
      format: fullBackup.BACKUP_FORMAT,
      version: 1,
      exportedAt: "2026-11-28T13:00:00.000Z",
      sections: {
        aiChats: {
          format: "quareia-ai-chats-backup",
          version: 1,
          exportedAt: 1700000010000,
          conversations: [badTimestamps[i]]
        }
      }
    });
    assert.throws(function () { fullBackup.parseBackup(raw, env.adapters); }, /valid timestamp/i);
    await assert.rejects(fullBackup.restoreBackup(raw, ["aiChats"], env.adapters), /valid timestamp/i);
  }

  // Local conversation remains intact and Markdown export succeeds without RangeError.
  var kept = await env.adapters.aiChatStore.getConversation("chat-safe");
  assert.equal(kept.messages.length, 1);
  assert.equal(kept.messages[0].content, "Safe message");
  var md = aiChatStoreApi.formatConversationMarkdown(kept, { locale: "en" });
  assert.match(md, /Safe message/);
});

test("Review 2 Fix #4: concurrent two-tab restores of the same ID-conflicting backup produce zero duplicate history records", async function () {
  var sharedIdb = createUnifiedFakeIndexedDB();
  var sharedStorage = createMemoryStorage();
  var tab1 = createTestEnvironment({ indexedDB: sharedIdb, storage: sharedStorage });
  var tab2 = createTestEnvironment({ indexedDB: sharedIdb, storage: sharedStorage });

  await tab1.adapters.historyStore.saveRecord(makePresetRecord("shared", "2026-11-01T10:00:00.000Z", {
    question: "Local original"
  }));

  var colliding = makePresetRecord("shared", "2026-11-05T10:00:00.000Z", {
    question: "Backup colliding",
    cards: [{
      cardId: "major-02",
      cardNumber: "2",
      cardName: "女祭司",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "当下 · Present",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  });
  var rawBackup = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T13:30:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([colliding], "2026-11-28T13:30:00.000Z"),
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000070000,
        conversations: [{
          id: "chat-race",
          title: "Concurrent chat",
          createdAt: 1700000065000,
          updatedAt: 1700000070000,
          readingIds: ["shared"],
          readingSnapshots: [{
            id: "shared",
            layoutMode: "preset",
            deckType: "tarot",
            spreadName: "三张牌",
            positionCount: 1,
            createdAt: 1700000060000,
            cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-02", cardName: "女祭司" }]
          }],
          messages: [{ id: "m1", role: "user", content: "Hi", createdAt: 1700000070000 }]
        }]
      }
    }
  });

  var pair = await Promise.all([
    fullBackup.restoreBackup(rawBackup, ["history", "aiChats"], tab1.adapters),
    fullBackup.restoreBackup(rawBackup, ["history", "aiChats"], tab2.adapters)
  ]);

  assert.equal(pair[0].status, "ok");
  assert.equal(pair[1].status, "ok");
  assert.equal(pair[0].restored.history.imported + pair[1].restored.history.imported, 1);
  assert.equal(pair[0].restored.history.remapped + pair[1].restored.history.remapped, 1);
  assert.equal(pair[0].restored.history.skipped + pair[1].restored.history.skipped, 1);
  assert.deepEqual(pair[0].historyIdMap, pair[1].historyIdMap);

  var allRecords = await tab1.adapters.historyStore.listRecords();
  assert.equal(allRecords.length, 2, "Must hold exact 1 local + 1 remapped backup record (zero duplicates)");
  var chat = await tab1.adapters.aiChatStore.getConversation("chat-race");
  assert.deepEqual(chat.readingIds, [pair[0].historyIdMap.shared]);
});

test("Review 2 Fix #5: preferences QuotaExceededError or failed read-back fails restore with preferences_persist_failed and succeeds on retry", async function () {
  var backing = new Map();
  var quotaBlocked = true;
  var flakyStorage = {
    getItem: function (k) { return backing.has(k) ? backing.get(k) : null; },
    setItem: function (k, v) {
      if (quotaBlocked) {
        var err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      backing.set(k, String(v));
    },
    removeItem: function (k) { backing.delete(k); }
  };

  var env = createTestEnvironment({ theme: "celestial", locale: "zh-CN", storage: flakyStorage });
  var raw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T14:00:00.000Z",
    sections: {
      preferences: { theme: "parchment", locale: "en" }
    }
  });

  // 1. QuotaExceededError -> status MUST be "failed", code MUST be "preferences_persist_failed", memory unchanged!
  var failedRes = await fullBackup.restoreBackup(raw, ["preferences"], env.adapters);
  assert.equal(failedRes.status, "failed");
  assert.deepEqual(failedRes.succeededSections, []);
  assert.equal(failedRes.failedSections.length, 1);
  assert.equal(failedRes.failedSections[0].section, "preferences");
  assert.equal(failedRes.failedSections[0].code, "preferences_persist_failed");
  assert.deepEqual(failedRes.appliedPreferences, { theme: null, locale: null });
  assert.equal(env.adapters.themeApi.getTheme(), "celestial");
  assert.equal(env.adapters.i18nApi.getLocale(), "zh-CN");

  // 2. Lift quota block and retry -> persists durably and reports status "ok"!
  quotaBlocked = false;
  var retryRes = await fullBackup.restoreBackup(raw, ["preferences"], env.adapters);
  assert.equal(retryRes.status, "ok");
  assert.deepEqual(retryRes.succeededSections, ["preferences"]);
  assert.deepEqual(retryRes.failedSections, []);
  assert.deepEqual(retryRes.appliedPreferences, { theme: "parchment", locale: "en" });
  assert.equal(backing.get("quareia-divination-theme"), "parchment");
  assert.equal(backing.get("quareia-divination-locale"), "en");
  assert.equal(env.adapters.themeApi.getTheme(), "parchment");
  assert.equal(env.adapters.i18nApi.getLocale(), "en");

  // 3. Silent storage drop (setItem doesn't throw, but getItem doesn't match) -> also fails with preferences_persist_failed!
  var silentDropStorage = {
    getItem: function () { return "celestial"; },
    setItem: function () {},
    removeItem: function () {}
  };
  var envDrop = createTestEnvironment({ theme: "celestial", locale: "zh-CN", storage: silentDropStorage });
  var dropRes = await fullBackup.restoreBackup(raw, ["preferences"], envDrop.adapters);
  assert.equal(dropRes.status, "failed");
  assert.equal(dropRes.failedSections[0].code, "preferences_persist_failed");
});

test("Review 3 Fix #1: aiChats-only / deleted-history backup detaches colliding snapshots instead of linking to wrong local reading, and fails closed without snapshot", async function () {
  var localTsIso = "2026-11-01T10:00:00.000Z";
  var localTsMs = Date.parse(localTsIso);
  var backupTsMs = Date.parse("2026-11-02T10:00:00.000Z");

  var localReading = makePresetRecord("shared", localTsIso, {
    question: "Local Hierophant",
    cards: [{
      cardId: "major-05",
      cardNumber: "5",
      cardName: "教皇",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "当下 · Present",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  });

  // Case 1A: aiChats-only backup (sections.history omitted) containing TWO conversations referencing "shared":
  // - chat-diff: snapshot is Backup Fool (differs from local Hierophant) -> MUST detach to deterministic reading-detached-*!
  // - chat-same: snapshot matches local Hierophant (same card + timestamp, even with edited chat-local question) -> keeps "shared"!
  var aiOnlyRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T15:00:00.000Z",
    sections: {
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000100000,
        conversations: [
          {
            id: "chat-diff",
            title: "Deleted Fool reading chat",
            createdAt: 1700000090000,
            updatedAt: 1700000100000,
            readingIds: ["shared"],
            readingSnapshots: [{
              id: "shared",
              layoutMode: "preset",
              deckType: "tarot",
              spreadId: "three-card-horizontal",
              spreadName: "三张牌",
              positionCount: 1,
              createdAt: backupTsMs,
              question: "Backup Fool",
              cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-00", cardName: "愚者", orientation: "upright" }]
            }],
            messages: [
              { id: "m1", role: "user", content: "Read Fool", createdAt: 1700000095000 },
              { id: "m2", role: "assistant", content: "Fool insight.", createdAt: 1700000100000, interpretedReadingIds: ["shared"] }
            ]
          },
          {
            id: "chat-same",
            title: "Matching Hierophant chat",
            createdAt: 1700000090000,
            updatedAt: 1700000100000,
            readingIds: ["shared"],
            readingSnapshots: [{
              id: "shared",
              layoutMode: "preset",
              deckType: "tarot",
              spreadId: "three-card-horizontal",
              spreadName: "三张牌",
              positionCount: 1,
              createdAt: localTsMs,
              question: "Slightly edited chat-local question",
              cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-05", cardName: "教皇", orientation: "upright" }]
            }],
            messages: [
              { id: "m3", role: "user", content: "Read Hierophant", createdAt: 1700000095000 },
              { id: "m4", role: "assistant", content: "Hierophant insight.", createdAt: 1700000100000, interpretedReadingIds: ["shared"] }
            ]
          }
        ]
      }
    }
  });

  var envA = createTestEnvironment();
  await envA.adapters.historyStore.saveRecord(localReading);
  var parsedA = fullBackup.parseBackup(aiOnlyRaw, envA.adapters);

  var resA = await fullBackup.restoreBackup(parsedA, ["aiChats"], envA.adapters);
  assert.equal(resA.status, "ok");
  assert.deepEqual(resA.succeededSections, ["aiChats"]);
  assert.deepEqual(resA.failedSections, []);
  assert.deepEqual(resA.restored.aiChats, { imported: 2, updated: 0, skipped: 0 });

  var diffChat = await envA.adapters.aiChatStore.getConversation("chat-diff");
  assert.equal(diffChat.readingIds.length, 1);
  assert.notEqual(diffChat.readingIds[0], "shared", "Colliding deleted-history chat MUST NOT link to local 'shared'");
  assert.match(diffChat.readingIds[0], /^reading-detached-[0-9a-f]{32}$/);
  var detachedId = diffChat.readingIds[0];
  assert.equal(diffChat.readingSnapshots.length, 1);
  assert.equal(diffChat.readingSnapshots[0].id, detachedId);
  assert.equal(diffChat.readingSnapshots[0].cards[0].cardId, "major-00");
  assert.deepEqual(diffChat.messages[1].interpretedReadingIds, [detachedId]);

  var sameChat = await envA.adapters.aiChatStore.getConversation("chat-same");
  assert.deepEqual(sameChat.readingIds, ["shared"], "Verified matching local reading keeps live link");
  assert.equal(sameChat.readingSnapshots[0].id, "shared");
  assert.deepEqual(sameChat.messages[1].interpretedReadingIds, ["shared"]);

  // Local history reading must remain untouched and parsed backup must not be mutated.
  assert.equal((await envA.adapters.historyStore.getRecord("shared")).cards[0].cardId, "major-05");
  assert.deepEqual(parsedA.sections.aiChats.conversations[0].readingIds, ["shared"]);

  // Re-restoring the same aiChats-only backup is idempotent (deterministic detached ID, skipped: 2).
  var resARetry = await fullBackup.restoreBackup(parsedA, ["aiChats"], envA.adapters);
  assert.equal(resARetry.status, "ok");
  assert.deepEqual(resARetry.restored.aiChats, { imported: 0, updated: 0, skipped: 2 });

  // Case 1B: Full backup whose sections.history is present (empty records: []) while aiChats references deleted "shared"
  // Restoring ["history", "aiChats"] together must STILL run the local collision check and detach!
  var emptyHistoryRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T15:05:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([], "2026-11-28T15:05:00.000Z"),
      aiChats: parsedA.sections.aiChats
    }
  });
  var envB = createTestEnvironment();
  await envB.adapters.historyStore.saveRecord(localReading);
  var resB = await fullBackup.restoreBackup(emptyHistoryRaw, ["history", "aiChats"], envB.adapters);
  assert.equal(resB.status, "ok");
  assert.deepEqual(resB.succeededSections, ["history", "aiChats"]);
  var diffChatB = await envB.adapters.aiChatStore.getConversation("chat-diff");
  assert.equal(diffChatB.readingIds[0], detachedId, "Detached ID must be deterministic across restores");

  // Case 1C: Colliding deleted-history reference with NO usable snapshot -> MUST fail closed (zero chats written)!
  var noSnapRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T15:10:00.000Z",
    sections: {
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000110000,
        conversations: [{
          id: "chat-no-snap",
          title: "Snapshotless chat",
          createdAt: 1700000105000,
          updatedAt: 1700000110000,
          readingIds: ["shared"],
          readingSnapshots: [],
          messages: [{ id: "m1", role: "user", content: "What did it mean?", createdAt: 1700000110000 }]
        }]
      }
    }
  });
  var envC = createTestEnvironment();
  await envC.adapters.historyStore.saveRecord(localReading);
  var resC = await fullBackup.restoreBackup(noSnapRaw, ["aiChats"], envC.adapters);
  assert.equal(resC.status, "failed");
  assert.deepEqual(resC.succeededSections, []);
  assert.equal(resC.failedSections.length, 1);
  assert.equal(resC.failedSections[0].section, "aiChats");
  assert.equal(resC.failedSections[0].code, "history_conflict_unresolved");
  assert.equal((await envC.adapters.aiChatStore.listConversations({ archived: "all" })).length, 0);
});

test("Review 3 Fix #2: aiChats-only restore fails closed with history_check_failed when local historyStore cannot be read", async function () {
  var linkedRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T15:20:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([
        makePresetRecord("r1", "2026-11-01T10:00:00.000Z", { question: "Reading 1" })
      ], "2026-11-28T15:20:00.000Z"),
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000120000,
        conversations: [{
          id: "chat-needs-check",
          title: "Linked chat",
          createdAt: 1700000115000,
          updatedAt: 1700000120000,
          readingIds: ["r1"],
          readingSnapshots: [{
            id: "r1",
            layoutMode: "preset",
            deckType: "tarot",
            spreadId: "three-card-horizontal",
            spreadName: "三张牌",
            positionCount: 1,
            createdAt: Date.parse("2026-11-01T10:00:00.000Z"),
            cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-00", cardName: "愚者", orientation: "upright" }]
          }],
          messages: [{ id: "m1", role: "user", content: "Check link", createdAt: 1700000120000 }]
        }]
      }
    }
  });

  // Case 2A: historyStore.listRecords rejects (IndexedDB blocked / corrupted / unavailable).
  var envReject = createTestEnvironment();
  envReject.adapters.historyStore = {
    listRecords: async function () { throw new Error("IDB read failed"); }
  };
  var resReject = await fullBackup.restoreBackup(linkedRaw, ["aiChats"], envReject.adapters);
  assert.equal(resReject.status, "failed");
  assert.deepEqual(resReject.succeededSections, []);
  assert.equal(resReject.failedSections.length, 1);
  assert.equal(resReject.failedSections[0].section, "aiChats");
  assert.equal(resReject.failedSections[0].code, "history_check_failed");
  assert.equal((await envReject.adapters.aiChatStore.listConversations({ archived: "all" })).length, 0, "Zero AI chats written when historyStore cannot be read");

  // Case 2B: historyStore adapter is completely missing (null).
  var envMissing = createTestEnvironment();
  envMissing.adapters.historyStore = null;
  var resMissing = await fullBackup.restoreBackup(linkedRaw, ["aiChats"], envMissing.adapters);
  assert.equal(resMissing.status, "failed");
  assert.equal(resMissing.failedSections.length, 1);
  assert.equal(resMissing.failedSections[0].section, "aiChats");
  assert.equal(resMissing.failedSections[0].code, "history_check_failed");
  assert.equal((await envMissing.adapters.aiChatStore.listConversations({ archived: "all" })).length, 0);

  // Case 2C: Free-chat conversation with NO linked reading IDs still succeeds even when historyStore is unavailable.
  var freeChatRaw = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T15:25:00.000Z",
    sections: {
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000125000,
        conversations: [{
          id: "chat-free",
          title: "General tarot Q&A",
          createdAt: 1700000120000,
          updatedAt: 1700000125000,
          readingIds: [],
          readingSnapshots: [],
          messages: [{ id: "m1", role: "user", content: "What is the Fool?", createdAt: 1700000125000 }]
        }]
      }
    }
  });
  var resFree = await fullBackup.restoreBackup(freeChatRaw, ["aiChats"], envReject.adapters);
  assert.equal(resFree.status, "ok");
  assert.deepEqual(resFree.succeededSections, ["aiChats"]);
  assert.equal((await envReject.adapters.aiChatStore.listConversations({ archived: "all" })).length, 1);
});

test("Review 3 Fix #3: deleting original colliding local reading before re-restore reuses reading-remap-* with zero duplicate and preserves AI links", async function () {
  var localReading = makePresetRecord("shared", "2026-11-01T10:00:00.000Z", {
    question: "Local Hierophant",
    cards: [{
      cardId: "major-05",
      cardNumber: "5",
      cardName: "教皇",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "当下 · Present",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  });
  var backupReading = makePresetRecord("shared", "2026-11-02T10:00:00.000Z", {
    question: "Backup Fool",
    cards: [{
      cardId: "major-00",
      cardNumber: "0",
      cardName: "愚者",
      orientation: "upright",
      slotIndex: 0,
      positionNumber: 1,
      positionName: "当下 · Present",
      layer: null,
      arcana: "major",
      suit: ""
    }]
  });

  var rawBackup = JSON.stringify({
    format: fullBackup.BACKUP_FORMAT,
    version: 1,
    exportedAt: "2026-11-28T15:30:00.000Z",
    sections: {
      history: historyRecords.createExportEnvelope([backupReading], "2026-11-28T15:30:00.000Z"),
      aiChats: {
        format: "quareia-ai-chats-backup",
        version: 1,
        exportedAt: 1700000130000,
        conversations: [{
          id: "chat-remap-del",
          title: "Fool reading follow-up",
          createdAt: 1700000125000,
          updatedAt: 1700000130000,
          readingIds: ["shared"],
          readingSnapshots: [{
            id: "shared",
            layoutMode: "preset",
            deckType: "tarot",
            spreadId: "three-card-horizontal",
            spreadName: "三张牌",
            positionCount: 1,
            createdAt: Date.parse("2026-11-02T10:00:00.000Z"),
            question: "Backup Fool",
            cards: [{ slotIndex: 0, positionNumber: 1, cardId: "major-00", cardName: "愚者", orientation: "upright" }]
          }],
          messages: [
            { id: "m1", role: "user", content: "Interpret", createdAt: 1700000126000 },
            { id: "m2", role: "assistant", content: "Done", createdAt: 1700000130000, interpretedReadingIds: ["shared"] }
          ]
        }]
      }
    }
  });

  var env = createTestEnvironment();
  await env.adapters.historyStore.saveRecord(localReading);

  // Restore #1: backup "shared" remaps to reading-remap-<hex32>.
  var res1 = await fullBackup.restoreBackup(rawBackup, ["history", "aiChats"], env.adapters);
  assert.equal(res1.status, "ok");
  assert.deepEqual(res1.restored.history, { imported: 1, remapped: 1, skipped: 0 });
  var remappedId = res1.historyIdMap.shared;
  assert.match(remappedId, /^reading-remap-[0-9a-f]{32}$/);
  assert.equal((await env.adapters.historyStore.listRecords()).length, 2);

  // User deletes original local "shared" (Hierophant); only remappedId (Fool) stays.
  await env.adapters.historyStore.deleteRecord("shared");
  assert.equal((await env.adapters.historyStore.listRecords()).length, 1);

  // Restore #2: re-restoring ["history", "aiChats"] MUST skip (reuse remappedId), create ZERO duplicate at "shared"!
  var res2 = await fullBackup.restoreBackup(rawBackup, ["history", "aiChats"], env.adapters);
  assert.equal(res2.status, "ok");
  assert.deepEqual(res2.restored.history, { imported: 0, remapped: 0, skipped: 1 });
  assert.deepEqual(res2.restored.aiChats, { imported: 0, updated: 0, skipped: 1 });
  assert.deepEqual(res2.historyIdMap, { shared: remappedId });
  var recordsAfter2 = await env.adapters.historyStore.listRecords();
  assert.equal(recordsAfter2.length, 1, "Must NOT duplicate Fool back under 'shared'");
  assert.equal(recordsAfter2[0].id, remappedId);

  // Also test aiChats-only restore after deleting original local "shared" and the AI chat:
  // checkAiChatsHistoryDependency must STILL find remappedId and link the restored chat to remappedId (not dead "shared")!
  await env.adapters.aiChatStore.deleteConversation("chat-remap-del");
  var res3 = await fullBackup.restoreBackup(rawBackup, ["aiChats"], env.adapters);
  assert.equal(res3.status, "ok");
  assert.deepEqual(res3.historyIdMap, { shared: remappedId });
  var chatAfter3 = await env.adapters.aiChatStore.getConversation("chat-remap-del");
  assert.deepEqual(chatAfter3.readingIds, [remappedId]);
  assert.equal(chatAfter3.readingSnapshots[0].id, remappedId);
  assert.deepEqual(chatAfter3.messages[1].interpretedReadingIds, [remappedId]);
});

