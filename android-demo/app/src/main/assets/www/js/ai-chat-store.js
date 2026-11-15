(function (global) {
  "use strict";

  var DB_NAME = "quareia-divination-ai-chats";
  var DB_VERSION = 1;
  var CONVERSATIONS_STORE = "conversations";
  var BACKUP_FORMAT = "quareia-ai-chats-backup";
  var BACKUP_VERSION = 1;

  function trimString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function parseTimestampMs(value) {
    if (typeof value === "number" && isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (!trimmed) {
        return 0;
      }
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        var numeric = Number(trimmed);
        return isFinite(numeric) ? numeric : 0;
      }
      var parsed = Date.parse(trimmed);
      return isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function generateChatId() {
    return "chat_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function generateMessageId() {
    return "msg_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function normalizeMessage(raw) {
    var input = raw && typeof raw === "object" ? raw : {};
    var role = input.role === "assistant" ? "assistant" : "user";
    return {
      id: trimString(input.id) || generateMessageId(),
      role: role,
      content: typeof input.content === "string" ? input.content : String(input.content || ""),
      reasoning: typeof input.reasoning === "string" ? input.reasoning : "",
      model: trimString(input.model),
      format: trimString(input.format),
      createdAt: parseTimestampMs(input.createdAt) || Date.now(),
      error: trimString(input.error)
    };
  }

  function normalizeSnapshotCard(raw, fallbackIndex) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    var cardId = trimString(raw.cardId);
    var cardName = trimString(raw.cardName);
    if (!cardId && !cardName) {
      return null;
    }
    var slotIndex = Number.isFinite(Number(raw.slotIndex)) ? Number(raw.slotIndex) : fallbackIndex;
    var posNum = Number.isFinite(Number(raw.positionNumber)) ? Number(raw.positionNumber) : (slotIndex + 1);
    var entry = {
      slotIndex: slotIndex,
      positionNumber: posNum,
      positionName: trimString(raw.positionName),
      cardId: cardId,
      cardName: cardName,
      orientation: trimString(raw.orientation) || "upright",
      arcana: trimString(raw.arcana),
      suit: trimString(raw.suit),
      layer: trimString(raw.layer)
    };
    if (typeof raw.stackOn === "number" && isFinite(raw.stackOn)) {
      entry.stackOn = raw.stackOn;
    }
    if (typeof raw.column === "number" && isFinite(raw.column)) {
      entry.column = raw.column;
    }
    if (typeof raw.row === "number" && isFinite(raw.row)) {
      entry.row = raw.row;
    }
    if (typeof raw.offsetX === "number" && isFinite(raw.offsetX)) {
      entry.offsetX = raw.offsetX;
    }
    if (typeof raw.offsetY === "number" && isFinite(raw.offsetY)) {
      entry.offsetY = raw.offsetY;
    }
    return entry;
  }

  function normalizeReadingSnapshot(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    var layoutMode = trimString(raw.layoutMode).toLowerCase();
    if (layoutMode === "freeform") {
      return null;
    }
    var id = trimString(raw.id);
    if (!id) {
      return null;
    }
    var cards = [];
    if (Array.isArray(raw.cards)) {
      for (var i = 0; i < raw.cards.length; i += 1) {
        var card = normalizeSnapshotCard(raw.cards[i], i);
        if (card) {
          cards.push(card);
        }
      }
    }
    var rawPosCount = Number(raw.positionCount);
    var positionCount = isFinite(rawPosCount) && rawPosCount > 0 ? Math.floor(rawPosCount) : cards.length;
    return {
      id: id,
      layoutMode: "preset",
      deckType: trimString(raw.deckType),
      spreadId: trimString(raw.spreadId),
      spreadName: trimString(raw.spreadName || raw.spreadNameSnapshot || raw.spreadId),
      positionCount: positionCount,
      orientationMode: trimString(raw.orientationMode),
      filterMode: trimString(raw.filterMode),
      overviewMethod: trimString(raw.overviewMethod),
      createdAt: parseTimestampMs(raw.createdAt),
      question: trimString(raw.question),
      cards: cards
    };
  }

  function normalizeContextSummary(raw, messages) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    var text = trimString(raw.text);
    if (!text) {
      return null;
    }
    var coveredUntilId = trimString(raw.coveredUntilId);
    if (coveredUntilId) {
      var found = false;
      var msgList = Array.isArray(messages) ? messages : [];
      for (var i = 0; i < msgList.length; i += 1) {
        if (msgList[i] && msgList[i].id === coveredUntilId) {
          found = true;
          break;
        }
      }
      if (!found) {
        return null;
      }
    }
    var count = Math.max(0, Math.floor(Number(raw.compressedCount) || 0));
    return {
      text: text,
      coveredUntilId: coveredUntilId,
      compressedCount: count,
      updatedAt: parseTimestampMs(raw.updatedAt) || Date.now()
    };
  }

  function normalizeLastUsage(raw) {
    if (!raw || typeof raw !== "object") {
      return null;
    }
    var inputTokens = Math.max(0, Math.round(Number(raw.inputTokens) || 0));
    var outputTokens = Math.max(0, Math.round(Number(raw.outputTokens) || 0));
    var totalTokens = Math.max(0, Math.round(Number(raw.totalTokens) || (inputTokens + outputTokens)));
    if (inputTokens === 0 && outputTokens === 0 && totalTokens === 0) {
      return null;
    }
    return {
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      totalTokens: totalTokens,
      updatedAt: parseTimestampMs(raw.updatedAt) || Date.now()
    };
  }

  function normalizeConversation(raw) {
    var input = raw && typeof raw === "object" ? raw : {};
    var now = Date.now();
    var readingIds = [];
    var seenIds = Object.create(null);
    if (Array.isArray(input.readingIds)) {
      for (var i = 0; i < input.readingIds.length; i += 1) {
        var rid = trimString(input.readingIds[i]);
        if (rid && !seenIds[rid]) {
          seenIds[rid] = true;
          readingIds.push(rid);
        }
      }
    }

    var snapshots = [];
    var rejectedFreeformIds = Object.create(null);
    if (Array.isArray(input.readingSnapshots)) {
      for (var s = 0; s < input.readingSnapshots.length; s += 1) {
        var rawSnap = input.readingSnapshots[s];
        if (rawSnap && typeof rawSnap === "object" && trimString(rawSnap.layoutMode).toLowerCase() === "freeform") {
          var freeId = trimString(rawSnap.id);
          if (freeId) {
            rejectedFreeformIds[freeId] = true;
          }
          continue;
        }
        var snap = normalizeReadingSnapshot(rawSnap);
        if (snap && seenIds[snap.id]) {
          snapshots.push(snap);
        }
      }
    }
    if (Object.keys(rejectedFreeformIds).length > 0) {
      readingIds = readingIds.filter(function (ridItem) {
        return !rejectedFreeformIds[ridItem];
      });
    }

    var messages = [];
    if (Array.isArray(input.messages)) {
      for (var m = 0; m < input.messages.length; m += 1) {
        if (input.messages[m] && typeof input.messages[m] === "object") {
          messages.push(normalizeMessage(input.messages[m]));
        }
      }
    }

    var createdAt = parseTimestampMs(input.createdAt) || now;
    var updatedAt = parseTimestampMs(input.updatedAt) || createdAt;
    return {
      id: trimString(input.id) || generateChatId(),
      title: trimString(input.title),
      createdAt: createdAt,
      updatedAt: updatedAt,
      archived: Boolean(input.archived),
      pinned: Boolean(input.pinned),
      profileId: trimString(input.profileId),
      readingIds: readingIds,
      readingSnapshots: snapshots,
      messages: messages,
      contextSummary: normalizeContextSummary(input.contextSummary, messages),
      lastUsage: normalizeLastUsage(input.lastUsage)
    };
  }

  function matchesQuery(conversation, lowerQuery) {
    if (!lowerQuery) {
      return true;
    }
    if ((conversation.title || "").toLowerCase().indexOf(lowerQuery) !== -1) {
      return true;
    }
    for (var s = 0; s < conversation.readingSnapshots.length; s += 1) {
      var snap = conversation.readingSnapshots[s];
      if ((snap.spreadName || "").toLowerCase().indexOf(lowerQuery) !== -1) {
        return true;
      }
      if ((snap.question || "").toLowerCase().indexOf(lowerQuery) !== -1) {
        return true;
      }
    }
    for (var i = 0; i < conversation.messages.length; i += 1) {
      var msg = conversation.messages[i];
      if ((msg.content || "").toLowerCase().indexOf(lowerQuery) !== -1) {
        return true;
      }
    }
    return false;
  }

  function sortConversations(list) {
    return list.slice().sort(function (a, b) {
      var pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      if (pinDiff !== 0) {
        return pinDiff;
      }
      var updatedDiff = (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
      if (updatedDiff !== 0) {
        return updatedDiff;
      }
      return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
    });
  }

  function createMemoryAdapter() {
    var map = Object.create(null);
    return {
      getAll: function () {
        var out = [];
        var keys = Object.keys(map);
        for (var i = 0; i < keys.length; i += 1) {
          out.push(normalizeConversation(map[keys[i]]));
        }
        return Promise.resolve(out);
      },
      get: function (id) {
        return Promise.resolve(map[id] ? normalizeConversation(map[id]) : null);
      },
      put: function (record) {
        var normalized = normalizeConversation(record);
        map[normalized.id] = normalized;
        return Promise.resolve(normalized);
      },
      delete: function (id) {
        delete map[id];
        return Promise.resolve();
      },
      clear: function () {
        map = Object.create(null);
        return Promise.resolve();
      }
    };
  }

  function createStore(options) {
    var opts = options && typeof options === "object" ? options : {};
    var dbName = trimString(opts.dbName) || DB_NAME;
    var dbVersion = Number(opts.dbVersion) || DB_VERSION;
    var idb = opts.indexedDB !== undefined
      ? opts.indexedDB
      : (typeof global.indexedDB !== "undefined" ? global.indexedDB : null);

    var openPromise = null;
    var memoryFallback = opts.memoryFallback ? createMemoryAdapter() : null;

    function open() {
      if (openPromise) {
        return openPromise;
      }
      if (!idb || typeof idb.open !== "function") {
        if (memoryFallback) {
          return Promise.resolve({ __memory: true });
        }
        return Promise.reject(new Error("IndexedDB is unavailable"));
      }
      openPromise = new Promise(function (resolve, reject) {
        var req;
        try {
          req = idb.open(dbName, dbVersion);
        } catch (err) {
          openPromise = null;
          if (memoryFallback) {
            resolve({ __memory: true });
          } else {
            reject(err);
          }
          return;
        }
        req.onupgradeneeded = function (event) {
          var db = (event && event.target && event.target.result) || req.result;
          var store;
          if (!db.objectStoreNames.contains(CONVERSATIONS_STORE)) {
            store = db.createObjectStore(CONVERSATIONS_STORE, { keyPath: "id" });
          } else if (req.transaction) {
            store = req.transaction.objectStore(CONVERSATIONS_STORE);
          }
          if (store && typeof store.createIndex === "function") {
            if (!store.indexNames.contains("updatedAt")) {
              store.createIndex("updatedAt", "updatedAt", { unique: false });
            }
            if (!store.indexNames.contains("archived")) {
              store.createIndex("archived", "archived", { unique: false });
            }
          }
        };
        req.onsuccess = function (event) {
          var db = (event && event.target && event.target.result) || req.result;
          if (db && !db.onversionchange) {
            db.onversionchange = function () {
              try {
                db.close();
              } catch (_err) {
                // Ignore close error
              }
              openPromise = null;
            };
          }
          resolve(db);
        };
        req.onerror = function (event) {
          openPromise = null;
          if (memoryFallback) {
            resolve({ __memory: true });
          } else {
            reject((event && event.target && event.target.error) || req.error || new Error("Failed to open AI chat store"));
          }
        };
      });
      return openPromise;
    }

    function withStore(mode, fn) {
      return open().then(function (db) {
        if (db && db.__memory && memoryFallback) {
          return fn(null, memoryFallback);
        }
        return new Promise(function (resolve, reject) {
          var tx = db.transaction([CONVERSATIONS_STORE], mode);
          var store = tx.objectStore(CONVERSATIONS_STORE);
          var finished = false;
          function fail(err) {
            if (!finished) {
              finished = true;
              reject(err || new Error("IndexedDB transaction failed"));
            }
          }
          tx.onabort = function () { fail(tx.error); };
          tx.onerror = function () { fail(tx.error); };
          try {
            Promise.resolve(fn(store, null)).then(function (result) {
              if (!finished) {
                finished = true;
                resolve(result);
              }
            }, fail);
          } catch (err) {
            fail(err);
          }
        });
      });
    }

    function reqToPromise(req) {
      return new Promise(function (resolve, reject) {
        req.onsuccess = function (event) {
          resolve((event && event.target && "result" in event.target) ? event.target.result : req.result);
        };
        req.onerror = function (event) {
          reject((event && event.target && event.target.error) || req.error || new Error("IndexedDB request error"));
        };
      });
    }

    function readAllRaw() {
      return withStore("readonly", function (store, mem) {
        if (mem) {
          return mem.getAll();
        }
        if (typeof store.getAll === "function") {
          return reqToPromise(store.getAll()).then(function (items) {
            return Array.isArray(items) ? items.map(normalizeConversation) : [];
          });
        }
        return new Promise(function (resolve, reject) {
          var results = [];
          var cursorReq = store.openCursor();
          cursorReq.onsuccess = function (event) {
            var cursor = event && event.target ? event.target.result : cursorReq.result;
            if (cursor) {
              results.push(normalizeConversation(cursor.value));
              cursor.continue();
            } else {
              resolve(results);
            }
          };
          cursorReq.onerror = function (event) {
            reject((event && event.target && event.target.error) || cursorReq.error);
          };
        });
      });
    }

    function listConversations(filterOpts) {
      var optsFilter = filterOpts && typeof filterOpts === "object" ? filterOpts : {};
      var archivedFilter = optsFilter.archived;
      var query = trimString(optsFilter.query).toLowerCase();

      return readAllRaw().then(function (items) {
        var filtered = items.filter(function (item) {
          if (archivedFilter === true && item.archived !== true) {
            return false;
          }
          if (archivedFilter === false && item.archived === true) {
            return false;
          }
          return matchesQuery(item, query);
        });
        return sortConversations(filtered);
      });
    }

    function getConversation(id) {
      var cleanId = trimString(id);
      if (!cleanId) {
        return Promise.resolve(null);
      }
      return withStore("readonly", function (store, mem) {
        if (mem) {
          return mem.get(cleanId);
        }
        return reqToPromise(store.get(cleanId)).then(function (val) {
          return val ? normalizeConversation(val) : null;
        });
      });
    }

    function saveConversation(record) {
      var normalized = normalizeConversation(record);
      return withStore("readwrite", function (store, mem) {
        if (mem) {
          return mem.put(normalized);
        }
        return reqToPromise(store.put(normalized)).then(function () {
          return normalized;
        });
      });
    }

    function createConversation(input) {
      var now = Date.now();
      var base = Object.assign({
        id: generateChatId(),
        createdAt: now,
        updatedAt: now
      }, input && typeof input === "object" ? input : {});
      return saveConversation(base);
    }

    function updateConversation(id, patchOrUpdater, updateOpts) {
      var optsUpdate = updateOpts && typeof updateOpts === "object" ? updateOpts : {};
      return getConversation(id).then(function (existing) {
        if (!existing) {
          return null;
        }
        var nextObj;
        if (typeof patchOrUpdater === "function") {
          nextObj = patchOrUpdater(normalizeConversation(existing));
        } else {
          nextObj = Object.assign({}, existing, patchOrUpdater && typeof patchOrUpdater === "object" ? patchOrUpdater : {});
        }
        if (!nextObj || typeof nextObj !== "object") {
          return existing;
        }
        nextObj.id = existing.id;
        if (optsUpdate.touchUpdatedAt !== false) {
          nextObj.updatedAt = Date.now();
        } else if (!nextObj.updatedAt) {
          nextObj.updatedAt = existing.updatedAt;
        }
        return saveConversation(nextObj);
      });
    }

    function setArchived(id, archived) {
      return updateConversation(id, { archived: Boolean(archived) }, { touchUpdatedAt: false });
    }

    function setPinned(id, pinned) {
      return updateConversation(id, { pinned: Boolean(pinned) }, { touchUpdatedAt: false });
    }

    function setContextSummary(id, summary) {
      return updateConversation(id, {
        contextSummary: summary || null
      }, { touchUpdatedAt: false });
    }

    function setLastUsage(id, usage) {
      return updateConversation(id, {
        lastUsage: usage || null
      }, { touchUpdatedAt: false });
    }

    function editMessageAndTruncate(id, messageId, newContent) {
      var cleanMsgId = trimString(messageId);
      var trimmedContent = typeof newContent === "string" ? newContent.trim() : "";
      return updateConversation(id, function (conv) {
        var idx = -1;
        for (var i = 0; i < conv.messages.length; i += 1) {
          if (conv.messages[i].id === cleanMsgId) {
            idx = i;
            break;
          }
        }
        if (idx === -1) {
          return conv;
        }
        var nextMessages = conv.messages.slice(0, idx + 1);
        nextMessages[idx] = Object.assign({}, nextMessages[idx], {
          content: trimmedContent,
          error: ""
        });
        var nextSummary = conv.contextSummary;
        if (nextSummary) {
          var coveredIdx = -1;
          for (var c = 0; c < nextMessages.length; c += 1) {
            if (nextMessages[c].id === nextSummary.coveredUntilId) {
              coveredIdx = c;
              break;
            }
          }
          if (!nextSummary.coveredUntilId || coveredIdx === -1 || idx <= coveredIdx) {
            nextSummary = null;
          }
        }
        return Object.assign({}, conv, {
          messages: nextMessages,
          contextSummary: nextSummary
        });
      });
    }

    function deleteMessage(id, messageId) {
      var cleanMsgId = trimString(messageId);
      return updateConversation(id, function (conv) {
        var idx = -1;
        for (var i = 0; i < conv.messages.length; i += 1) {
          if (conv.messages[i].id === cleanMsgId) {
            idx = i;
            break;
          }
        }
        if (idx === -1) {
          return conv;
        }
        var prevCoveredId = conv.contextSummary ? conv.contextSummary.coveredUntilId : "";
        var prevCoveredIdx = -1;
        if (prevCoveredId) {
          for (var c = 0; c < conv.messages.length; c += 1) {
            if (conv.messages[c].id === prevCoveredId) {
              prevCoveredIdx = c;
              break;
            }
          }
        }
        var nextMessages = conv.messages.filter(function (m) {
          return m.id !== cleanMsgId;
        });
        var nextSummary = conv.contextSummary;
        if (nextSummary) {
          var stillHasCovered = false;
          for (var j = 0; j < nextMessages.length; j += 1) {
            if (nextMessages[j].id === prevCoveredId) {
              stillHasCovered = true;
              break;
            }
          }
          if (!prevCoveredId || !stillHasCovered || prevCoveredIdx === -1 || idx <= prevCoveredIdx) {
            nextSummary = null;
          }
        }
        return Object.assign({}, conv, {
          messages: nextMessages,
          contextSummary: nextSummary
        });
      });
    }

    function deleteConversation(id) {
      var cleanId = trimString(id);
      if (!cleanId) {
        return Promise.resolve(false);
      }
      return withStore("readwrite", function (store, mem) {
        if (mem) {
          return mem.delete(cleanId).then(function () { return true; });
        }
        return reqToPromise(store.delete(cleanId)).then(function () {
          return true;
        });
      });
    }

    function clearConversations(clearOpts) {
      var optsClear = clearOpts && typeof clearOpts === "object" ? clearOpts : {};
      if (optsClear.archivedOnly) {
        return listConversations({ archived: true }).then(function (archivedItems) {
          if (archivedItems.length === 0) {
            return 0;
          }
          return withStore("readwrite", function (store, mem) {
            if (mem) {
              return Promise.all(archivedItems.map(function (item) {
                return mem.delete(item.id);
              })).then(function () {
                return archivedItems.length;
              });
            }
            return Promise.all(archivedItems.map(function (item) {
              return reqToPromise(store.delete(item.id));
            })).then(function () {
              return archivedItems.length;
            });
          });
        });
      }
      return readAllRaw().then(function (allItems) {
        return withStore("readwrite", function (store, mem) {
          if (mem) {
            return mem.clear().then(function () { return allItems.length; });
          }
          return reqToPromise(store.clear()).then(function () {
            return allItems.length;
          });
        });
      });
    }

    function exportBackup() {
      return listConversations({ archived: "all" }).then(function (items) {
        return {
          format: BACKUP_FORMAT,
          version: BACKUP_VERSION,
          exportedAt: Date.now(),
          conversations: items
        };
      });
    }

    function importBackup(rawInput, importOpts) {
      var optsImport = importOpts && typeof importOpts === "object" ? importOpts : {};
      var mode = optsImport.mode === "replace" ? "replace" : "merge";
      var parsed = rawInput;
      if (typeof rawInput === "string") {
        try {
          parsed = JSON.parse(rawInput);
        } catch (_err) {
          return Promise.reject(new Error("Invalid backup JSON"));
        }
      }
      if (!parsed || typeof parsed !== "object") {
        return Promise.reject(new Error("Invalid backup payload"));
      }
      var list = Array.isArray(parsed.conversations)
        ? parsed.conversations
        : (Array.isArray(parsed) ? parsed : null);
      if (!list) {
        return Promise.reject(new Error("Missing conversations array in backup"));
      }
      if (parsed.format && parsed.format !== BACKUP_FORMAT) {
        return Promise.reject(new Error("Unsupported backup format: " + parsed.format));
      }

      var validItems = [];
      var skippedCount = 0;
      for (var i = 0; i < list.length; i += 1) {
        var entry = list[i];
        if (!entry || typeof entry !== "object") {
          skippedCount += 1;
          continue;
        }
        validItems.push(normalizeConversation(entry));
      }

      var prep = mode === "replace" ? clearConversations({ archivedOnly: false }) : Promise.resolve(0);
      return prep.then(function () {
        return withStore("readwrite", function (store, mem) {
          if (mem) {
            return Promise.all(validItems.map(function (item) {
              return mem.put(item);
            }));
          }
          return Promise.all(validItems.map(function (item) {
            return reqToPromise(store.put(item));
          }));
        });
      }).then(function () {
        return listConversations({ archived: "all" }).then(function (all) {
          return {
            importedCount: validItems.length,
            skippedCount: skippedCount,
            totalCount: all.length
          };
        });
      });
    }

    return {
      open: open,
      listConversations: listConversations,
      getConversation: getConversation,
      createConversation: createConversation,
      updateConversation: updateConversation,
      setArchived: setArchived,
      setPinned: setPinned,
      setContextSummary: setContextSummary,
      setLastUsage: setLastUsage,
      editMessageAndTruncate: editMessageAndTruncate,
      deleteMessage: deleteMessage,
      deleteConversation: deleteConversation,
      clearConversations: clearConversations,
      exportBackup: exportBackup,
      importBackup: importBackup
    };
  }

  function formatConversationMarkdown(conversation, options) {
    var conv = normalizeConversation(conversation);
    var opts = options && typeof options === "object" ? options : {};
    var isEnglish = opts.locale === "en";
    var lines = [];
    var title = conv.title || (isEnglish ? "Untitled AI Reading Chat" : "未命名 AI 解牌对话");
    lines.push("# " + title);
    lines.push("");
    lines.push("- " + (isEnglish ? "Created" : "创建时间") + ": " + new Date(conv.createdAt).toISOString());
    lines.push("- " + (isEnglish ? "Updated" : "最后更新") + ": " + new Date(conv.updatedAt).toISOString());
    lines.push("- " + (isEnglish ? "Status" : "状态") + ": " + (conv.archived ? (isEnglish ? "Archived" : "已归档") : (isEnglish ? "Active" : "进行中")));

    if (conv.readingSnapshots.length > 0) {
      lines.push("- " + (isEnglish ? "Attached Readings" : "关联占卜记录") + ":");
      for (var r = 0; r < conv.readingSnapshots.length; r += 1) {
        var snap = conv.readingSnapshots[r];
        var metaParts = [];
        if (snap.deckType) {
          if (snap.deckType === "tarot") {
            metaParts.push(isEnglish ? "Tarot" : "塔罗");
          } else if (snap.deckType === "mystagogus") {
            metaParts.push("Mystagogus");
          } else if (snap.deckType === "lxxxi") {
            metaParts.push("LXXXI");
          } else {
            metaParts.push(snap.deckType);
          }
        }
        var isStacked = snap.overviewMethod === "stacked" || snap.filterMode === "stacked";
        if (isStacked) {
          metaParts.push(isEnglish ? "Stacked" : "叠牌法");
        } else if (Array.isArray(snap.cards) && snap.cards.length > 0) {
          metaParts.push(snap.cards.length + (isEnglish ? " cards" : " 张"));
        } else if (snap.positionCount > 0) {
          metaParts.push(snap.positionCount + (isEnglish ? " cards" : " 张"));
        }
        var metaText = metaParts.length > 0 ? (" (" + metaParts.join(" · ") + ")") : "";
        var q = snap.question ? (" — " + snap.question) : "";
        lines.push("  - " + (snap.spreadName || snap.id) + metaText + q);
      }
    }

    lines.push("");
    lines.push("---");

    for (var i = 0; i < conv.messages.length; i += 1) {
      var msg = conv.messages[i];
      var speaker = msg.role === "assistant"
        ? (isEnglish ? "## Assistant" : "## AI 助手") + (msg.model ? (" (" + msg.model + ")") : "")
        : (isEnglish ? "## User" : "## 用户");
      lines.push("");
      lines.push(speaker);
      lines.push("");
      if (msg.reasoning && opts.includeReasoning !== false) {
        lines.push("> " + (isEnglish ? "**Reasoning Summary**" : "**思考过程**"));
        lines.push("> " + msg.reasoning.replace(/\r?\n/g, "\n> "));
        lines.push("");
      }
      lines.push(msg.content || "");
    }

    return lines.join("\n").trim() + "\n";
  }

  var api = {
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    CONVERSATIONS_STORE: CONVERSATIONS_STORE,
    BACKUP_FORMAT: BACKUP_FORMAT,
    BACKUP_VERSION: BACKUP_VERSION,
    parseTimestampMs: parseTimestampMs,
    normalizeMessage: normalizeMessage,
    normalizeReadingSnapshot: normalizeReadingSnapshot,
    normalizeConversation: normalizeConversation,
    createStore: createStore,
    formatConversationMarkdown: formatConversationMarkdown
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.DivinationAiChatStore = api;
})(typeof window !== "undefined" ? window : globalThis);
