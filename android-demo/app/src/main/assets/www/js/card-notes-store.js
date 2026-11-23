(function (root, factory) {
  "use strict";
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DivinationCardNotesStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var DB_NAME = "divination-card-notes";
  var DB_VERSION = 1;
  var STORE_NAME = "notes";
  var BACKUP_FORMAT = "divination-card-notes";
  var BACKUP_VERSION = 1;

  function exactFields(value, fields) {
    return value && typeof value === "object" && !Array.isArray(value) &&
      Object.keys(value).length === fields.length &&
      fields.every(function (field) { return Object.prototype.hasOwnProperty.call(value, field); });
  }

  function createStore(options) {
    options = options || {};
    if (typeof options.isKnownCard !== "function") throw new Error("isKnownCard is required");
    var openPromise = null;

    function validKey(deckType, cardId) {
      return typeof deckType === "string" && deckType.length > 0 &&
        typeof cardId === "string" && cardId.length > 0 && options.isKnownCard(deckType, cardId) === true;
    }
    function requireKey(deckType, cardId) {
      if (!validKey(deckType, cardId)) throw new Error("Unknown card key");
    }
    function validateRow(row) {
      if (!exactFields(row, ["deckType", "cardId", "text"]) ||
          !validKey(row.deckType, row.cardId) || typeof row.text !== "string" || !row.text.trim()) {
        throw new Error("Invalid card note");
      }
    }
    function open() {
      if (openPromise) return openPromise;
      openPromise = new Promise(function (resolve, reject) {
        var settled = false;
        function fail(error) { if (!settled) { settled = true; reject(error); } }
        var request;
        try {
          var indexedDB = Object.prototype.hasOwnProperty.call(options, "indexedDB") ? options.indexedDB : root.indexedDB;
          if (!indexedDB) throw new Error("IndexedDB is unavailable");
          request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (error) {
          fail(error);
          return;
        }
        request.onupgradeneeded = function () {
          try { request.result.createObjectStore(STORE_NAME, { keyPath: ["deckType", "cardId"] }); }
          catch (error) { try { request.transaction.abort(); } catch (_) {} fail(error); }
        };
        request.onerror = function () { fail(request.error || new Error("Could not open card notes")); };
        request.onblocked = function () { fail(new Error("Card notes database upgrade is blocked")); };
        request.onsuccess = function () {
          var database = request.result;
          if (settled) { database.close(); return; }
          settled = true;
          database.onversionchange = function () { database.close(); openPromise = null; };
          resolve(database);
        };
      });
      var current = openPromise;
      current.catch(function () { if (openPromise === current) openPromise = null; });
      return current;
    }
    function transaction(mode, operation) {
      return open().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx, output, settled = false;
          function fail(error) {
            if (settled) return;
            settled = true;
            try { if (tx) tx.abort(); } catch (_) {}
            reject(error || new Error("Card notes transaction failed"));
          }
          try {
            tx = database.transaction(STORE_NAME, mode);
            tx.oncomplete = function () { if (!settled) { settled = true; resolve(output); } };
            tx.onerror = function () { fail(tx.error); };
            tx.onabort = function () { fail(tx.error || new Error("Card notes transaction aborted")); };
            operation(tx.objectStore(STORE_NAME), function (value) { output = value; }, fail);
          } catch (error) { fail(error); }
        });
      });
    }
    function failedRequest(request, fail) {
      request.onerror = function () { fail(request.error || new Error("Card notes operation failed")); };
    }
    function list() {
      return transaction("readonly", function (store, done, fail) {
        var request = store.getAll();
        request.onsuccess = function () {
          try { request.result.forEach(validateRow); done(request.result); } catch (error) { fail(error); }
        };
        failedRequest(request, fail);
      });
    }
    function keys() {
      return transaction("readonly", function (store, done, fail) {
        var request = store.getAllKeys();
        request.onsuccess = function () {
          try {
            request.result.forEach(function (key) {
              if (!Array.isArray(key) || key.length !== 2) throw new Error("Invalid card note key");
              requireKey(key[0], key[1]);
            });
            done(request.result);
          } catch (error) { fail(error); }
        };
        failedRequest(request, fail);
      });
    }
    function get(deckType, cardId) {
      return Promise.resolve().then(function () {
        requireKey(deckType, cardId);
        return transaction("readonly", function (store, done, fail) {
          var request = store.get([deckType, cardId]);
          request.onsuccess = function () {
            try { if (request.result !== undefined) validateRow(request.result); done(request.result === undefined ? null : request.result); }
            catch (error) { fail(error); }
          };
          failedRequest(request, fail);
        });
      });
    }
    function save(deckType, cardId, text, expectedText) {
      return Promise.resolve().then(function () {
        requireKey(deckType, cardId);
        if (typeof text !== "string" || (typeof expectedText !== "string" && expectedText !== null)) {
          throw new Error("Text and expected text must be strings (or null for an absent note)");
        }
        var desired = text.trim() ? text : null;
        return transaction("readwrite", function (store, done, fail) {
          var request = store.get([deckType, cardId]);
          request.onsuccess = function () {
            try {
              var existing = request.result;
              if (existing !== undefined) validateRow(existing);
              var current = existing === undefined ? null : existing.text;
              var expected = expectedText === "" ? null : expectedText;
              if (current !== expected && current !== desired) {
                var conflict = new Error("Card note changed in another session");
                conflict.code = "conflict";
                fail(conflict);
                return;
              }
              if (current === desired) { done(existing === undefined ? null : existing); return; }
              var row = desired === null ? null : { deckType: deckType, cardId: cardId, text: desired };
              var write = row ? store.put(row) : store.delete([deckType, cardId]);
              write.onsuccess = function () { done(row); };
              failedRequest(write, fail);
            } catch (error) { fail(error); }
          };
          failedRequest(request, fail);
        });
      });
    }
    function exportBackup() {
      return list().then(function (notes) { return JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, notes: notes }, null, 2); });
    }
    function importBackup(rawString) {
      return Promise.resolve().then(function () {
        if (typeof rawString !== "string") throw new Error("Card notes backup must be JSON text");
        var backup;
        try { backup = JSON.parse(rawString); } catch (_) { throw new Error("Invalid card notes backup JSON"); }
        if (!exactFields(backup, ["format", "version", "notes"]) || backup.format !== BACKUP_FORMAT ||
            backup.version !== BACKUP_VERSION || !Array.isArray(backup.notes)) throw new Error("Invalid card notes backup envelope");
        var seen = new Set();
        backup.notes.forEach(function (row) {
          validateRow(row);
          var key = JSON.stringify([row.deckType, row.cardId]);
          if (seen.has(key)) throw new Error("Duplicate card note key");
          seen.add(key);
        });
        return transaction("readwrite", function (store, done, fail) {
          var result = { imported: 0, skipped: 0 };
          backup.notes.forEach(function (row) {
            var request = store.get([row.deckType, row.cardId]);
            request.onsuccess = function () {
              try {
                if (request.result !== undefined) { validateRow(request.result); result.skipped += 1; return; }
                var add = store.add(row);
                add.onsuccess = function () { result.imported += 1; };
                failedRequest(add, fail);
              } catch (error) { fail(error); }
            };
            failedRequest(request, fail);
          });
          done(result);
        });
      });
    }
    return { list: list, keys: keys, get: get, save: save, exportBackup: exportBackup, importBackup: importBackup };
  }
  return { DB_NAME: DB_NAME, DB_VERSION: DB_VERSION, STORE_NAME: STORE_NAME, BACKUP_FORMAT: BACKUP_FORMAT, BACKUP_VERSION: BACKUP_VERSION, createStore: createStore };
});
