// SPDX-License-Identifier: MPL-2.0
(function (root, factory) {
  "use strict";

  var api = factory(root);
  if (root) {
    Object.defineProperty(root, "QuareiaIOSBackup", {
      value: api,
      writable: false,
      configurable: false
    });
    Object.defineProperty(root, "DivinationBackup", {
      value: api,
      writable: false,
      configurable: false
    });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var FORMAT = "quareia-ios-backup";
  var VERSION = 1;
  var MAX_BYTES = 16 * 1024 * 1024;
  var JOURNAL_DB = "quareia-ios-backup-journal";
  var JOURNAL_STORE = "journal";
  var JOURNAL_KEY = "restore";
  var SETTINGS_KEYS = {
    theme: "quareia-divination-theme",
    locale: "quareia-divination-locale"
  };
  var THEMES = ["celestial", "parchment", "ember", "grove"];
  var LOCALES = ["zh-CN", "en"];

  function fail(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  }

  function exactKeys(value, keys, path) {
    if (!isPlainObject(value)) throw fail("INVALID_BACKUP", path + " must be an object");
    var actual = Object.keys(value).sort();
    var expected = keys.slice().sort();
    if (actual.length !== expected.length || actual.some(function (key, index) { return key !== expected[index]; })) {
      throw fail("INVALID_BACKUP", path + " contains missing or unknown fields");
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function utf8Length(value) {
    if (typeof TextEncoder === "undefined") throw fail("TEXT_ENCODER_UNAVAILABLE");
    return new TextEncoder().encode(value).length;
  }

  function canonicalDate(value, path) {
    if (typeof value !== "string") throw fail("INVALID_BACKUP", path + " must be an ISO date");
    var parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
      throw fail("INVALID_BACKUP", path + " must be a canonical ISO date");
    }
    return value;
  }

  function openDatabase(indexedDB, name, version, upgrade) {
    return new Promise(function (resolve, reject) {
      if (!indexedDB || typeof indexedDB.open !== "function") {
        reject(fail("INDEXEDDB_UNAVAILABLE"));
        return;
      }
      var request;
      try { request = indexedDB.open(name, version); } catch (error) { reject(error); return; }
      request.onupgradeneeded = function (event) {
        try { upgrade(request.result, event.oldVersion || 0, request.transaction); }
        catch (error) {
          try { request.transaction.abort(); } catch (_abortError) {}
          reject(error);
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || fail("INDEXEDDB_FAILED", "Could not open database")); };
      request.onblocked = function () { reject(fail("INDEXEDDB_BLOCKED")); };
    });
  }

  function createJournal(indexedDB) {
    var databasePromise;
    function open() {
      if (!databasePromise) {
        databasePromise = openDatabase(indexedDB, JOURNAL_DB, 1, function (database, oldVersion) {
          if (oldVersion < 1) database.createObjectStore(JOURNAL_STORE, { keyPath: "key" });
        });
      }
      return databasePromise;
    }
    function transaction(mode, operation) {
      return open().then(function (database) {
        return new Promise(function (resolve, reject) {
          var tx = database.transaction(JOURNAL_STORE, mode);
          var output;
          tx.oncomplete = function () { resolve(output); };
          tx.onerror = function () { reject(tx.error || fail("JOURNAL_FAILED")); };
          tx.onabort = function () { reject(tx.error || fail("JOURNAL_FAILED")); };
          try {
            operation(tx.objectStore(JOURNAL_STORE), function (value) { output = value; });
          } catch (error) {
            try { tx.abort(); } catch (_abortError) {}
            reject(error);
          }
        });
      });
    }
    return {
      get: function () {
        return transaction("readonly", function (store, output) {
          var request = store.get(JOURNAL_KEY);
          request.onsuccess = function () { output(request.result || null); };
        });
      },
      put: function (record) {
        return transaction("readwrite", function (store) { store.put(record); });
      },
      clear: function () {
        return transaction("readwrite", function (store) { store.delete(JOURNAL_KEY); });
      }
    };
  }

  function createHistoryAccess(indexedDB, historyStoreApi, recordsApi) {
    function list() {
      var store = historyStoreApi.createStore({ recordsApi: recordsApi, indexedDB: indexedDB });
      return store.open().then(function () { return store.listRecords("all"); });
    }

    function replace(records) {
      records.forEach(recordsApi.validateRecord);
      return openDatabase(
        indexedDB,
        historyStoreApi.DB_NAME,
        historyStoreApi.DB_VERSION,
        function (database, oldVersion, transaction) {
          historyStoreApi.migrateDatabase(database, oldVersion, transaction, recordsApi);
        }
      ).then(function (database) {
        return new Promise(function (resolve, reject) {
          var transaction = database.transaction(historyStoreApi.READINGS_STORE, "readwrite");
          var store = transaction.objectStore(historyStoreApi.READINGS_STORE);
          transaction.oncomplete = function () { resolve(); };
          transaction.onerror = function () { reject(transaction.error || fail("HISTORY_RESTORE_FAILED")); };
          transaction.onabort = function () { reject(transaction.error || fail("HISTORY_RESTORE_FAILED")); };
          var clear = store.clear();
          clear.onerror = function () {
            try { transaction.abort(); } catch (_abortError) {}
          };
          clear.onsuccess = function () {
            try {
              records.forEach(function (record) { store.add(clone(record)); });
            } catch (_error) {
              try { transaction.abort(); } catch (_abortError) {}
            }
          };
        });
      });
    }
    return { list: list, replace: replace };
  }

  function createManager(options) {
    options = options || {};
    var environment = options.root || root || {};
    var storage = options.storage || environment.localStorage;
    var indexedDB = options.indexedDB || environment.indexedDB;
    var recordsApi = options.recordsApi || environment.DivinationHistoryRecords;
    var historyStoreApi = options.historyStoreApi || environment.DivinationHistoryStore;
    var customSpreadsApi = options.customSpreadsApi || environment.DivinationCustomSpreads;
    var draftApi = options.draftApi || environment.DivinationFreeBoardDraft;
    var nativeAdapter = options.nativeAdapter || environment.QuareiaIOS;
    var now = options.now || function () { return new Date().toISOString(); };
    var journal = options.journal || createJournal(indexedDB);
    var history = options.history || createHistoryAccess(indexedDB, historyStoreApi, recordsApi);
    var activeOperation = null;
    var mutating = false;
    var nativeMenuBound = false;

    function setMutating(value) {
      mutating = value;
      if (environment.document && environment.document.documentElement) {
        if (value) environment.document.documentElement.setAttribute("data-backup-busy", "true");
        else environment.document.documentElement.removeAttribute("data-backup-busy");
        if (environment.document.body) {
          if (value) {
            environment.document.body.setAttribute("aria-busy", "true");
            environment.document.body.inert = true;
          } else {
            environment.document.body.removeAttribute("aria-busy");
            environment.document.body.inert = false;
          }
        }
      }
      if (typeof environment.dispatchEvent === "function" && typeof environment.CustomEvent === "function") {
        environment.dispatchEvent(new environment.CustomEvent("quareia:backupbusy", { detail: { busy: value } }));
      }
    }

    async function withMutation(operation) {
      setMutating(true);
      try { return await operation(); }
      finally { setMutating(false); }
    }

    function exclusive(name, operation) {
      if (activeOperation !== null) return Promise.reject(fail("BACKUP_BUSY", "backup operation already in progress"));
      activeOperation = name;
      return Promise.resolve()
        .then(operation)
        .finally(function () { activeOperation = null; });
    }

    function dependenciesReady() {
      if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" ||
          typeof storage.removeItem !== "function") throw fail("LOCAL_STORAGE_UNAVAILABLE");
      if (!recordsApi || typeof recordsApi.createExportEnvelope !== "function" ||
          typeof recordsApi.parseImportJson !== "function" || typeof recordsApi.validateRecord !== "function") {
        throw fail("HISTORY_API_UNAVAILABLE");
      }
      if (!historyStoreApi || !customSpreadsApi || !draftApi) throw fail("BACKUP_API_UNAVAILABLE");
    }

    function validateCustomSpreads(value) {
      if (value === null) return null;
      exactKeys(value, ["v", "items"], "customSpreads");
      if (value.v !== customSpreadsApi.SCHEMA_VERSION && value.v !== customSpreadsApi.LEGACY_SCHEMA_VERSION) {
        throw fail("INVALID_BACKUP", "customSpreads has an unsupported schema version");
      }
      if (!Array.isArray(value.items) || value.items.length > customSpreadsApi.MAX_ANDROID_LIBRARY_SIZE) {
        throw fail("INVALID_BACKUP", "customSpreads exceeds the mobile library limit");
      }
      var raw = JSON.stringify(value);
      var testStorage = { getItem: function () { return raw; }, setItem: function () {} };
      var library = customSpreadsApi.createLibrary({ platform: "android", storage: testStorage });
      var loaded = library.list();
      if (loaded.length !== value.items.length) {
        throw fail("INVALID_BACKUP", "customSpreads failed schema validation");
      }
      return clone(value);
    }

    function validateDraft(value) {
      if (value === null) return null;
      if (!isPlainObject(value)) throw fail("INVALID_BACKUP", "draft must be an object or null");
      draftApi.validate(JSON.stringify(value));
      return clone(value);
    }

    function validateSettings(value) {
      exactKeys(value, ["theme", "locale"], "settings");
      if (value.theme !== null && THEMES.indexOf(value.theme) === -1) throw fail("INVALID_BACKUP", "invalid theme");
      if (value.locale !== null && LOCALES.indexOf(value.locale) === -1) throw fail("INVALID_BACKUP", "invalid locale");
      return { theme: value.theme, locale: value.locale };
    }

    function validate(input) {
      dependenciesReady();
      var value;
      try {
        if (typeof input === "string" && utf8Length(input) > MAX_BYTES) throw fail("BACKUP_TOO_LARGE");
        value = typeof input === "string" ? JSON.parse(input) : clone(input);
      }
      catch (error) {
        if (error && error.code === "BACKUP_TOO_LARGE") throw error;
        throw fail("INVALID_BACKUP", "backup is not valid JSON");
      }
      exactKeys(value, ["format", "version", "exportedAt", "history", "customSpreads", "draft", "settings"], "backup");
      if (value.format !== FORMAT || value.version !== VERSION) throw fail("INVALID_BACKUP", "unsupported backup format");
      canonicalDate(value.exportedAt, "backup.exportedAt");
      var historyEnvelope = recordsApi.parseImportJson(JSON.stringify(value.history));
      var validated = {
        format: FORMAT,
        version: VERSION,
        exportedAt: value.exportedAt,
        history: historyEnvelope,
        customSpreads: validateCustomSpreads(value.customSpreads),
        draft: validateDraft(value.draft),
        settings: validateSettings(value.settings)
      };
      var serialized = JSON.stringify(validated);
      if (utf8Length(serialized) > MAX_BYTES) throw fail("BACKUP_TOO_LARGE");
      return validated;
    }

    function readJsonKey(key) {
      var raw = storage.getItem(key);
      if (raw === null || raw === "") return null;
      try { return JSON.parse(raw); }
      catch (_error) { throw fail("LOCAL_DATA_INVALID", key + " contains invalid JSON"); }
    }

    async function createSnapshotUnsafe() {
      dependenciesReady();
      var records = await history.list();
      var snapshot = {
        format: FORMAT,
        version: VERSION,
        exportedAt: canonicalDate(now(), "backup.exportedAt"),
        history: recordsApi.createExportEnvelope(records, now()),
        customSpreads: readJsonKey(customSpreadsApi.STORAGE_KEY),
        draft: readJsonKey(draftApi.STORAGE_KEY),
        settings: {
          theme: storage.getItem(SETTINGS_KEYS.theme),
          locale: storage.getItem(SETTINGS_KEYS.locale)
        }
      };
      return validate(snapshot);
    }

    function writeJsonKey(key, value) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    }

    function writeSetting(key, value) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }

    async function applySnapshot(snapshot) {
      var validated = validate(snapshot);
      writeJsonKey(customSpreadsApi.STORAGE_KEY, validated.customSpreads);
      writeJsonKey(draftApi.STORAGE_KEY, validated.draft);
      writeSetting(SETTINGS_KEYS.theme, validated.settings.theme);
      writeSetting(SETTINGS_KEYS.locale, validated.settings.locale);
      await history.replace(validated.history.records);
      return validated;
    }

    async function recoverIfNeededUnsafe() {
      dependenciesReady();
      var pending = await journal.get();
      if (!pending) return { recovered: false };
      exactKeys(pending, ["key", "phase", "previous"], "journal");
      if (pending.key !== JOURNAL_KEY || pending.phase !== "prepared") throw fail("INVALID_JOURNAL");
      await withMutation(async function () {
        await applySnapshot(pending.previous);
        await journal.clear();
      });
      return { recovered: true };
    }

    async function restoreUnsafe(input) {
      var target = validate(input);
      return withMutation(async function () {
        var previous = await createSnapshotUnsafe();
        await journal.put({ key: JOURNAL_KEY, phase: "prepared", previous: previous });
        try {
          await applySnapshot(target);
          await journal.clear();
        } catch (error) {
          try {
            await applySnapshot(previous);
            await journal.clear();
          } catch (_rollbackError) {
            var rollbackFailure = fail("RESTORE_ROLLBACK_PENDING");
            rollbackFailure.cause = error;
            throw rollbackFailure;
          }
          throw error;
        }
        return {
          outcome: "success",
          historyCount: target.history.records.length,
          customSpreadCount: target.customSpreads ? target.customSpreads.items.length : 0,
          hasDraft: target.draft !== null
        };
      });
    }

    async function exportToNativeUnsafe(action) {
      if (!nativeAdapter || typeof nativeAdapter.exportText !== "function") throw fail("NATIVE_UNAVAILABLE");
      var snapshot = await withMutation(createSnapshotUnsafe);
      var text = JSON.stringify(snapshot, null, 2);
      var name = "quareia-backup-" + snapshot.exportedAt.slice(0, 10) + ".json";
      return nativeAdapter.exportText("backup", name, text, action || "save");
    }

    async function importFromNativeUnsafe() {
      if (!nativeAdapter || typeof nativeAdapter.importText !== "function") throw fail("NATIVE_UNAVAILABLE");
      var imported = await nativeAdapter.importText("backup");
      if (imported.outcome !== "success") return imported;
      return restoreUnsafe(imported.text);
    }

    function exportToNative(action) {
      return exclusive("native-export", function () { return exportToNativeUnsafe(action); });
    }

    function importFromNative() {
      return exclusive("native-import", importFromNativeUnsafe);
    }

    function installUI(document) {
      if (!document || document.getElementById("iosBackupExportBtn")) return false;
      var menu = document.querySelector("#appMenu .menu-primary-actions");
      if (!menu) return false;
      var exportButton = document.createElement("button");
      var importButton = document.createElement("button");
      var status = document.createElement("p");
      exportButton.type = importButton.type = "button";
      exportButton.className = importButton.className = "menu-action";
      exportButton.id = "iosBackupExportBtn";
      importButton.id = "iosBackupImportBtn";
      status.id = "iosBackupStatus";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      var statusKey = null;
      function copy() {
        var english = document.documentElement.lang === "en";
        return english ? {
          exportLabel: "Export Full Backup",
          importLabel: "Restore Full Backup",
          exportCancelled: "Backup cancelled",
          exportSuccess: "Backup exported",
          exportFailed: "Backup export failed",
          restoreCancelled: "Backup restore cancelled",
          restoreSuccess: "Backup restored",
          restoreFailed: "Backup restore failed",
          dialogKicker: "LOCAL BACKUP",
          dialogTitle: "Restore full backup?",
          dialogMessage: "Current local history, templates, draft, theme, and language will be replaced.",
          dialogCancel: "Cancel",
          dialogProceed: "Restore"
        } : {
          exportLabel: "导出完整备份",
          importLabel: "恢复完整备份",
          exportCancelled: "已取消备份",
          exportSuccess: "完整备份已导出",
          exportFailed: "完整备份导出失败",
          restoreCancelled: "已取消恢复备份",
          restoreSuccess: "完整备份已恢复",
          restoreFailed: "完整备份恢复失败",
          dialogKicker: "本机备份",
          dialogTitle: "恢复完整备份？",
          dialogMessage: "当前本机的占卜历史、自定义牌阵、自由画板草稿、主题和语言将被替换。",
          dialogCancel: "取消",
          dialogProceed: "恢复"
        };
      }
      function setStatus(key) {
        statusKey = key;
        status.textContent = key ? copy()[key] : "";
      }
      function localize() {
        var strings = copy();
        exportButton.textContent = strings.exportLabel;
        importButton.textContent = strings.importLabel;
        setStatus(statusKey);
      }
      exportButton.addEventListener("click", async function () {
        setStatus(null);
        try {
          var result = await exportToNative("save");
          setStatus(result.outcome === "success"
            ? "exportSuccess"
            : result.outcome === "cancelled" ? "exportCancelled" : "exportFailed");
        } catch (_error) { setStatus("exportFailed"); }
      });
      importButton.addEventListener("click", async function () {
        setStatus(null);
        try {
          var approved = true;
          if (environment.DivinationDialog && typeof environment.DivinationDialog.request === "function") {
            var strings = copy();
            approved = await environment.DivinationDialog.request({
              kicker: strings.dialogKicker,
              title: strings.dialogTitle,
              message: strings.dialogMessage,
              cancelLabel: strings.dialogCancel,
              proceedLabel: strings.dialogProceed
            });
          }
          if (!approved) return;
          var result = await importFromNative();
          if (result.outcome !== "success") {
            setStatus(result.outcome === "cancelled" ? "restoreCancelled" : "restoreFailed");
            return;
          }
          setStatus("restoreSuccess");
          if (environment.location && typeof environment.location.reload === "function") environment.location.reload();
        } catch (_error) { setStatus("restoreFailed"); }
      });
      menu.appendChild(exportButton);
      menu.appendChild(importButton);
      menu.appendChild(status);
      localize();
      if (environment.addEventListener) environment.addEventListener("quareia:languagechange", localize);
      if (!nativeMenuBound && environment.addEventListener) {
        nativeMenuBound = true;
        environment.addEventListener("quareia-native-menu", function (event) {
          var action = event && event.detail && event.detail.action;
          if (action === "backup") exportButton.click();
          else if (action === "import") importButton.click();
          else if (action === "export") {
            var historyExport = document.getElementById("historyExportBtn");
            if (historyExport) historyExport.click();
          }
        });
      }
      return true;
    }

    return Object.freeze({
      validate: validate,
      isBusy: function () { return activeOperation !== null; },
      isMutating: function () { return mutating; },
      createSnapshot: function () { return exclusive("snapshot", function () { return withMutation(createSnapshotUnsafe); }); },
      serialize: function () { return exclusive("export", async function () { return JSON.stringify(await withMutation(createSnapshotUnsafe), null, 2); }); },
      restore: function (input) { return exclusive("restore", function () { return restoreUnsafe(input); }); },
      recoverIfNeeded: function () { return exclusive("recovery", recoverIfNeededUnsafe); },
      exportToNative: exportToNative,
      importFromNative: importFromNative,
      installUI: installUI
    });
  }

  var manager = createManager();
  var ready = Promise.resolve().then(manager.recoverIfNeeded);
  ready.catch(function () {});
  if (root && root.document) {
    var install = function () { ready.then(function () { manager.installUI(root.document); }).catch(function () {}); };
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", install);
    else install();
  }
  return Object.freeze({
    FORMAT: FORMAT,
    VERSION: VERSION,
    MAX_BYTES: MAX_BYTES,
    JOURNAL_DB: JOURNAL_DB,
    JOURNAL_STORE: JOURNAL_STORE,
    JOURNAL_KEY: JOURNAL_KEY,
    SETTINGS_KEYS: Object.freeze(SETTINGS_KEYS),
    createManager: createManager,
    ready: ready,
    validate: manager.validate,
    isBusy: manager.isBusy,
    isMutating: manager.isMutating,
    createSnapshot: manager.createSnapshot,
    serialize: manager.serialize,
    exportBackup: manager.serialize,
    restore: manager.restore,
    importBackup: manager.restore,
    recoverIfNeeded: manager.recoverIfNeeded,
    exportToNative: manager.exportToNative,
    importFromNative: manager.importFromNative,
    installUI: manager.installUI
  });
});
