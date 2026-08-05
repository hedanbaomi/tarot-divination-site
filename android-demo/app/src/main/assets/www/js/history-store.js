(function (root, factory) {
  "use strict";

  var recordsApi = root && root.DivinationHistoryRecords;
  if (typeof module !== "undefined" && module.exports) {
    recordsApi = require("./history-records.js");
  }
  var api = factory(root, recordsApi);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DivinationHistoryStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, defaultRecordsApi) {
  "use strict";

  var DB_NAME = "tarot-divination-history";
  var DB_VERSION = 1;
  var READINGS_STORE = "readings";
  var META_STORE = "meta";
  var DEFAULT_DUPLICATE_WINDOW_MS = 10000;
  var DECK_TYPES = ["tarot", "mystagogus", "lxxxi"];

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function migrateDatabase(database, oldVersion, transaction, recordsApi) {
    if (oldVersion < 1) {
      var readings = database.createObjectStore(READINGS_STORE, { keyPath: "id" });
      readings.createIndex("createdAt", "createdAt", { unique: false });
      readings.createIndex("deckType", "deckType", { unique: false });

      var meta = database.createObjectStore(META_STORE, { keyPath: "key" });
      meta.put({
        key: "schemaVersion",
        value: recordsApi.SCHEMA_VERSION
      });
    }

    if (!transaction) {
      throw new Error("IndexedDB migration transaction is unavailable");
    }
  }

  function createStore(options) {
    options = options || {};
    var recordsApi = options.recordsApi || defaultRecordsApi;
    var indexedDB = Object.prototype.hasOwnProperty.call(options, "indexedDB")
      ? options.indexedDB
      : root && root.indexedDB;
    var dbName = options.dbName || DB_NAME;
    var duplicateWindowMs = options.duplicateWindowMs == null
      ? DEFAULT_DUPLICATE_WINDOW_MS
      : options.duplicateWindowMs;
    var idGenerator = options.idGenerator || (recordsApi && recordsApi.createId);
    var openPromise = null;

    if (!recordsApi ||
        typeof recordsApi.validateRecord !== "function" ||
        typeof recordsApi.isRecentDuplicate !== "function" ||
        typeof recordsApi.resolveImportedIds !== "function") {
      throw new Error("DivinationHistoryRecords API is unavailable");
    }
    if (!Number.isFinite(duplicateWindowMs) || duplicateWindowMs < 0) {
      throw new Error("duplicateWindowMs must be a non-negative number");
    }

    function open() {
      if (openPromise) return openPromise;
      openPromise = new Promise(function (resolve, reject) {
        var settled = false;

        function rejectOpen(error) {
          if (settled) return;
          settled = true;
          reject(error);
        }

        if (!indexedDB || typeof indexedDB.open !== "function") {
          rejectOpen(new Error("IndexedDB is unavailable in this browser"));
          return;
        }

        var request;
        try {
          request = indexedDB.open(dbName, DB_VERSION);
        } catch (error) {
          rejectOpen(error);
          return;
        }

        request.onupgradeneeded = function (event) {
          try {
            migrateDatabase(
              request.result,
              event.oldVersion || 0,
              request.transaction,
              recordsApi
            );
          } catch (error) {
            try {
              request.transaction.abort();
            } catch (_abortError) {
              // The open request will surface the original migration failure.
            }
            rejectOpen(error);
          }
        };
        request.onsuccess = function () {
          var database = request.result;
          if (settled) {
            database.close();
            return;
          }
          settled = true;
          database.onversionchange = function () {
            database.close();
            openPromise = null;
          };
          resolve(database);
        };
        request.onerror = function () {
          rejectOpen(request.error || new Error("Could not open IndexedDB"));
        };
        request.onblocked = function () {
          rejectOpen(new Error("IndexedDB upgrade is blocked by another open page"));
        };
      });
      var currentOpenPromise = openPromise;
      currentOpenPromise.catch(function () {
        if (openPromise === currentOpenPromise) openPromise = null;
      });
      return openPromise;
    }

    function runTransaction(mode, operation) {
      return open().then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction;
          var settled = false;
          var output;

          function rejectOnce(error) {
            if (settled) return;
            settled = true;
            reject(error || new Error("IndexedDB transaction failed"));
          }

          function fail(error) {
            try {
              transaction.abort();
            } catch (_abortError) {
              // Reject with the useful operation error below.
            }
            rejectOnce(error);
          }

          try {
            transaction = database.transaction(READINGS_STORE, mode);
            transaction.oncomplete = function () {
              if (settled) return;
              settled = true;
              resolve(output);
            };
            transaction.onerror = function () {
              rejectOnce(transaction.error || new Error("IndexedDB transaction failed"));
            };
            transaction.onabort = function () {
              rejectOnce(transaction.error || new Error("IndexedDB transaction was aborted"));
            };
            operation(
              transaction.objectStore(READINGS_STORE),
              function (value) { output = value; },
              fail
            );
          } catch (error) {
            fail(error);
          }
        });
      });
    }

    function validateStoredRecords(records) {
      records.forEach(recordsApi.validateRecord);
      return records;
    }

    function listRecords(deckFilter) {
      var selectedDeck = deckFilter || "all";
      if (selectedDeck !== "all" && DECK_TYPES.indexOf(selectedDeck) === -1) {
        return Promise.reject(new Error("Invalid history deck filter"));
      }
      return runTransaction("readonly", function (store, succeed, fail) {
        var request = store.getAll();
        request.onsuccess = function () {
          try {
            var records = validateStoredRecords(request.result || []);
            if (selectedDeck !== "all") {
              records = records.filter(function (record) {
                return record.deckType === selectedDeck;
              });
            }
            records.sort(function (a, b) {
              var delta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
              return delta || a.id.localeCompare(b.id);
            });
            succeed(records);
          } catch (error) {
            fail(error);
          }
        };
        request.onerror = function () {
          fail(request.error || new Error("Could not list history records"));
        };
      });
    }

    function getRecord(id) {
      if (typeof id !== "string" || id.length === 0) {
        return Promise.reject(new Error("History record id is required"));
      }
      return runTransaction("readonly", function (store, succeed, fail) {
        var request = store.get(id);
        request.onsuccess = function () {
          try {
            if (request.result === undefined) {
              succeed(null);
              return;
            }
            recordsApi.validateRecord(request.result);
            succeed(request.result);
          } catch (error) {
            fail(error);
          }
        };
        request.onerror = function () {
          fail(request.error || new Error("Could not read the history record"));
        };
      });
    }

    function saveRecord(record) {
      return Promise.resolve().then(function () {
        recordsApi.validateRecord(record);
        var candidate = cloneJson(record);
        return runTransaction("readwrite", function (store, succeed, fail) {
          var getAllRequest = store.getAll();
          getAllRequest.onsuccess = function () {
            try {
              var existing = validateStoredRecords(getAllRequest.result || []);
              if (recordsApi.isRecentDuplicate(existing, candidate, duplicateWindowMs)) {
                var duplicate = existing.find(function (item) {
                  return recordsApi.isRecentDuplicate([item], candidate, duplicateWindowMs);
                });
                succeed({
                  saved: false,
                  duplicate: true,
                  record: duplicate
                });
                return;
              }

              var addRequest = store.add(candidate);
              addRequest.onsuccess = function () {
                succeed({
                  saved: true,
                  duplicate: false,
                  record: cloneJson(candidate)
                });
              };
              addRequest.onerror = function () {
                fail(addRequest.error || new Error("Could not save the history record"));
              };
            } catch (error) {
              fail(error);
            }
          };
          getAllRequest.onerror = function () {
            fail(getAllRequest.error || new Error("Could not check history duplicates"));
          };
        });
      });
    }

    function deleteRecord(id) {
      if (typeof id !== "string" || id.length === 0) {
        return Promise.reject(new Error("History record id is required"));
      }
      return runTransaction("readwrite", function (store, succeed, fail) {
        var getRequest = store.get(id);
        getRequest.onsuccess = function () {
          if (getRequest.result === undefined) {
            succeed(false);
            return;
          }
          var deleteRequest = store.delete(id);
          deleteRequest.onsuccess = function () { succeed(true); };
          deleteRequest.onerror = function () {
            fail(deleteRequest.error || new Error("Could not delete the history record"));
          };
        };
        getRequest.onerror = function () {
          fail(getRequest.error || new Error("Could not read the history record"));
        };
      });
    }

    function clearRecords() {
      return runTransaction("readwrite", function (store, succeed, fail) {
        var request = store.clear();
        request.onsuccess = function () { succeed(undefined); };
        request.onerror = function () {
          fail(request.error || new Error("Could not clear history records"));
        };
      });
    }

    function importRecords(records) {
      return Promise.resolve().then(function () {
        if (!Array.isArray(records) || records.length > recordsApi.MAX_RECORDS) {
          throw new Error("History import exceeds the record limit");
        }
        records.forEach(recordsApi.validateRecord);
        var validated = cloneJson(records);

        return runTransaction("readwrite", function (store, succeed, fail) {
          var getAllRequest = store.getAll();
          getAllRequest.onsuccess = function () {
            try {
              var existing = validateStoredRecords(getAllRequest.result || []);
              if (existing.length + validated.length > recordsApi.MAX_RECORDS) {
                throw new Error("History import exceeds the record limit");
              }
              var resolved = recordsApi.resolveImportedIds(
                validated,
                existing.map(function (record) { return record.id; }),
                idGenerator
              );
              resolved.records.forEach(function (record) {
                recordsApi.validateRecord(record);
                var putRequest = store.put(record);
                putRequest.onerror = function () {
                  fail(putRequest.error || new Error("Could not import history records"));
                };
              });
              succeed({
                importedCount: resolved.records.length,
                remappedCount: resolved.remappedCount,
                records: cloneJson(resolved.records)
              });
            } catch (error) {
              fail(error);
            }
          };
          getAllRequest.onerror = function () {
            fail(getAllRequest.error || new Error("Could not prepare history import"));
          };
        });
      });
    }

    return {
      open: open,
      listRecords: listRecords,
      getRecord: getRecord,
      saveRecord: saveRecord,
      deleteRecord: deleteRecord,
      clearRecords: clearRecords,
      importRecords: importRecords
    };
  }

  return {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    READINGS_STORE: READINGS_STORE,
    META_STORE: META_STORE,
    migrateDatabase: migrateDatabase,
    createStore: createStore
  };
});
