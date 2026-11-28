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
  var SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function utf8BytesOf(text) {
    var str = String(text);
    var bytes = [];
    for (var i = 0; i < str.length; i += 1) {
      var code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var low = str.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          i += 1;
        }
      }
      if (code <= 0x7f) {
        bytes.push(code);
      } else if (code <= 0x7ff) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code <= 0xffff) {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f)
        );
      }
    }
    return bytes;
  }

  function sha256Hex(text) {
    var bytes = utf8BytesOf(text);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    var highBits = Math.floor(bitLen / 0x100000000);
    var lowBits = bitLen >>> 0;
    bytes.push(
      (highBits >>> 24) & 0xff, (highBits >>> 16) & 0xff, (highBits >>> 8) & 0xff, highBits & 0xff,
      (lowBits >>> 24) & 0xff, (lowBits >>> 16) & 0xff, (lowBits >>> 8) & 0xff, lowBits & 0xff
    );

    var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
    var w = new Array(64);

    for (var offset = 0; offset < bytes.length; offset += 64) {
      var i;
      for (i = 0; i < 16; i += 1) {
        var j = offset + i * 4;
        w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (i = 16; i < 64; i += 1) {
        var s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
        var s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (i = 0; i < 64; i += 1) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ ((~e) & g);
        var temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
    }

    var words = [h0, h1, h2, h3, h4, h5, h6, h7];
    var hex = "";
    for (var k = 0; k < words.length; k += 1) {
      hex += words[k].toString(16).padStart(8, "0");
    }
    return hex;
  }

  function deriveRemappedId(originalId, createdAt, canonicalContent, attempt) {
    var base = "reading-remap-" + sha256Hex(originalId + "\0" + createdAt + "\0" + canonicalContent).slice(0, 32);
    var suffix = attempt && attempt > 0 ? "-" + String(attempt + 1) : "";
    return base + suffix;
  }

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
        typeof recordsApi.normalizeQuestion !== "function" ||
        typeof recordsApi.normalizeReflection !== "function" ||
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
            rejectOnce(error);
            try {
              if (transaction) transaction.abort();
            } catch (_abortError) {
              // The useful operation error has already been surfaced above.
            }
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

    function updateNote(id, field, value, normalize) {
      if (typeof id !== "string" || id.length === 0) {
        return Promise.reject(new Error("History record id is required"));
      }
      return Promise.resolve().then(function () {
        var normalized = normalize(value);
        return runTransaction("readwrite", function (store, succeed, fail) {
          var request = store.get(id);
          request.onsuccess = function () {
            try {
              if (request.result === undefined) {
                succeed(null);
                return;
              }
              var record = request.result;
              recordsApi.validateRecord(record);
              if (normalized) record[field] = normalized;
              else delete record[field];
              recordsApi.validateRecord(record);
              var putRequest = store.put(record);
              putRequest.onsuccess = function () { succeed(cloneJson(record)); };
              putRequest.onerror = function () {
                fail(putRequest.error || new Error("Could not update the history " + field));
              };
            } catch (error) {
              fail(error);
            }
          };
          request.onerror = function () {
            fail(request.error || new Error("Could not read the history record"));
          };
        });
      });
    }

    function updateQuestion(id, question) {
      return updateNote(id, "question", question, recordsApi.normalizeQuestion);
    }

    function updateReflection(id, reflection) {
      return updateNote(id, "reflection", reflection, recordsApi.normalizeReflection);
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

    function mergeBackupRecords(records, mergeOptions) {
      mergeOptions = mergeOptions && typeof mergeOptions === "object" ? mergeOptions : {};
      var deriveId = typeof mergeOptions.deriveRemappedId === "function"
        ? mergeOptions.deriveRemappedId
        : deriveRemappedId;
      return Promise.resolve().then(function () {
        if (typeof recordsApi.canonicalRecordContent !== "function") {
          throw new Error("DivinationHistoryRecords.canonicalRecordContent is unavailable");
        }
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
              var occupiedById = Object.create(null);
              var canonicalById = Object.create(null);
              for (var i = 0; i < existing.length; i += 1) {
                var rec = existing[i];
                occupiedById[rec.id] = rec;
                canonicalById[rec.id] = recordsApi.canonicalRecordContent(rec);
              }

              var toInsert = [];
              var remappedCount = 0;
              var skippedCount = 0;
              var idMap = {};

              for (var j = 0; j < validated.length; j += 1) {
                var incoming = validated[j];
                var originalId = incoming.id;
                var incomingCanonical = recordsApi.canonicalRecordContent(incoming);
                var existingAtId = occupiedById[originalId];

                if (!existingAtId) {
                  var directCopy = cloneJson(incoming);
                  recordsApi.validateRecord(directCopy);
                  occupiedById[originalId] = directCopy;
                  canonicalById[originalId] = incomingCanonical;
                  toInsert.push(directCopy);
                  continue;
                }

                if (existingAtId.createdAt === incoming.createdAt &&
                    canonicalById[originalId] === incomingCanonical) {
                  skippedCount += 1;
                  continue;
                }

                // True ID collision with different content: resolve deterministically per source ID.
                var resolved = false;
                for (var attempt = 0; attempt < 1000; attempt += 1) {
                  var candidateId = deriveId(originalId, incoming.createdAt, incomingCanonical, attempt);
                  if (typeof candidateId !== "string" || candidateId.length === 0 || candidateId.length > 120) {
                    throw new Error("Derived remapped history id is invalid");
                  }
                  var atCandidate = occupiedById[candidateId];
                  if (!atCandidate) {
                    var remappedCopy = cloneJson(incoming);
                    remappedCopy.id = candidateId;
                    recordsApi.validateRecord(remappedCopy);
                    occupiedById[candidateId] = remappedCopy;
                    canonicalById[candidateId] = incomingCanonical;
                    toInsert.push(remappedCopy);
                    remappedCount += 1;
                    if (!Object.prototype.hasOwnProperty.call(idMap, originalId)) {
                      idMap[originalId] = candidateId;
                    }
                    resolved = true;
                    break;
                  }
                  if (atCandidate.createdAt === incoming.createdAt &&
                      canonicalById[candidateId] === incomingCanonical) {
                    skippedCount += 1;
                    if (!Object.prototype.hasOwnProperty.call(idMap, originalId)) {
                      idMap[originalId] = candidateId;
                    }
                    resolved = true;
                    break;
                  }
                }
                if (!resolved) {
                  throw new Error("Could not derive a unique remapped history id");
                }
              }

              if (existing.length + toInsert.length > recordsApi.MAX_RECORDS) {
                throw new Error("History import exceeds the record limit");
              }

              toInsert.forEach(function (record) {
                recordsApi.validateRecord(record);
                var addRequest = store.add(record);
                addRequest.onerror = function () {
                  fail(addRequest.error || new Error("Could not import history records"));
                };
              });

              succeed({
                importedCount: toInsert.length,
                remappedCount: remappedCount,
                skippedCount: skippedCount,
                idMap: idMap,
                records: cloneJson(toInsert)
              });
            } catch (error) {
              fail(error);
            }
          };
          getAllRequest.onerror = function () {
            fail(getAllRequest.error || new Error("Could not prepare history merge"));
          };
        });
      });
    }

    return {
      open: open,
      listRecords: listRecords,
      getRecord: getRecord,
      saveRecord: saveRecord,
      updateQuestion: updateQuestion,
      updateReflection: updateReflection,
      deleteRecord: deleteRecord,
      clearRecords: clearRecords,
      importRecords: importRecords,
      mergeBackupRecords: mergeBackupRecords
    };
  }

  return {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    READINGS_STORE: READINGS_STORE,
    META_STORE: META_STORE,
    sha256Hex: sha256Hex,
    deriveRemappedId: deriveRemappedId,
    migrateDatabase: migrateDatabase,
    createStore: createStore
  };
});
