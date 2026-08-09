(function (root, factory) {
  "use strict";

  var api;
  if (typeof module === "object" && module.exports) {
    api = factory(globalThis, require("./free-board-model.js"));
    module.exports = api;
  } else {
    api = factory(root, root && root.FreeBoardModel);
    if (root) root.DivinationFreeBoardDraft = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, defaultModelApi) {
  "use strict";

  var STORAGE_KEY = "quareia-divination-free-board-draft-v1";

  function resolveStorage(storage) {
    if (storage) return storage;
    try {
      return root && root.localStorage ? root.localStorage : null;
    } catch (_error) {
      return null;
    }
  }

  function resolveModel(modelApi) {
    return modelApi || defaultModelApi || (root && root.FreeBoardModel);
  }

  function serializeCandidate(candidate) {
    if (candidate && typeof candidate.serializeDraft === "function") {
      return candidate.serializeDraft();
    }
    if (typeof candidate === "string") return candidate;
    if (candidate && typeof candidate === "object") return JSON.stringify(candidate);
    throw new Error("free board draft must be a controller, JSON string, or object");
  }

  function validateSerialized(serialized, modelApi) {
    var api = resolveModel(modelApi);
    if (!api || typeof api.restoreDraft !== "function") {
      throw new Error("FreeBoardModel.restoreDraft is unavailable");
    }
    // restoreDraft performs the complete schema, deck, pile, card, and viewport
    // validation. The returned controller is deliberately discarded.
    api.restoreDraft(serialized);
    return serialized;
  }

  function removeQuietly(storage) {
    if (!storage || typeof storage.removeItem !== "function") return;
    try { storage.removeItem(STORAGE_KEY); } catch (_error) {}
  }

  function readResult(storage, options) {
    options = options || {};
    storage = resolveStorage(storage);
    if (!storage || typeof storage.getItem !== "function") {
      return { draft: null, invalid: false, unavailable: true };
    }

    var raw;
    try {
      raw = storage.getItem(options.key || STORAGE_KEY);
    } catch (_error) {
      return { draft: null, invalid: false, unavailable: true };
    }
    if (!raw) return { draft: null, invalid: false, unavailable: false };

    try {
      validateSerialized(raw, options.modelApi);
      return { draft: raw, invalid: false, unavailable: false };
    } catch (_error) {
      // Invalid drafts are not a source of truth. Remove only this stable key,
      // and let the UI surface a localized warning instead of crashing.
      try { storage.removeItem(options.key || STORAGE_KEY); } catch (_removeError) {}
      return { draft: null, invalid: true, unavailable: false };
    }
  }

  function read(storage, options) {
    return readResult(storage, options);
  }

  function load(storage, options) {
    return readResult(storage, options).draft;
  }

  function save(storage, candidate, options) {
    options = options || {};
    storage = resolveStorage(storage);
    if (!storage || typeof storage.setItem !== "function") {
      throw new Error("localStorage is unavailable");
    }
    var serialized = serializeCandidate(candidate);
    validateSerialized(serialized, options.modelApi);
    storage.setItem(options.key || STORAGE_KEY, serialized);
    return serialized;
  }

  function discard(storage, options) {
    options = options || {};
    storage = resolveStorage(storage);
    if (!storage || typeof storage.removeItem !== "function") return false;
    try {
      storage.removeItem(options.key || STORAGE_KEY);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function createAutosave(options) {
    options = options || {};
    var storage = resolveStorage(options.storage);
    var modelApi = resolveModel(options.modelApi);
    var key = options.key || STORAGE_KEY;
    var delay = Number.isFinite(options.debounceMs) && options.debounceMs >= 0
      ? options.debounceMs
      : 80;
    var timer = null;
    var latest = null;
    var pending = [];

    function settlePending(error, value) {
      var waiters = pending;
      pending = [];
      waiters.forEach(function (waiter) {
        if (error) waiter.reject(error);
        else waiter.resolve(value);
      });
    }

    function reportCallbackError(error) {
      if (typeof options.onError !== "function") return;
      try { options.onError(error); } catch (_callbackError) {}
    }

    function saveLatest() {
      timer = null;
      if (latest === null) {
        settlePending(null, false);
        return Promise.resolve(false);
      }
      var candidate = latest;
      latest = null;
      var serialized;
      try {
        serialized = save(storage, candidate, { key: key, modelApi: modelApi });
      } catch (error) {
        settlePending(error);
        reportCallbackError(error);
        return Promise.reject(error);
      }
      settlePending(null, serialized);
      if (typeof options.onSaved === "function") {
        try { options.onSaved(serialized); } catch (callbackError) { reportCallbackError(callbackError); }
      }
      return Promise.resolve(serialized);
    }

    function schedule(candidate) {
      // Validate before waiting so an invalid model state can never be queued
      // for storage. This also makes autosave fail closed in test and browser
      // environments with a throwing storage implementation.
      var serialized = serializeCandidate(candidate);
      validateSerialized(serialized, modelApi);
      latest = serialized;
      if (timer !== null) clearTimeout(timer);
      var promise = new Promise(function (resolve, reject) {
        pending.push({ resolve: resolve, reject: reject });
      });
      timer = setTimeout(saveLatest, delay);
      return promise;
    }

    function flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      return saveLatest();
    }

    function cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      latest = null;
      settlePending(null, false);
    }

    return {
      key: key,
      schedule: schedule,
      saveNow: function (candidate) {
        latest = candidate;
        return flush();
      },
      flush: flush,
      cancel: cancel,
      discard: function () { cancel(); return discard(storage, { key: key }); },
      read: function () { return readResult(storage, { key: key, modelApi: modelApi }); }
    };
  }

  return Object.freeze({
    STORAGE_KEY: STORAGE_KEY,
    read: read,
    readResult: readResult,
    load: load,
    save: save,
    write: save,
    discard: discard,
    clear: discard,
    createAutosave: createAutosave,
    validate: validateSerialized
  });
});
