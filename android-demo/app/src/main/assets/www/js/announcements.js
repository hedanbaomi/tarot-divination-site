(function (global) {
  "use strict";

  var ENDPOINT = "https://telemetry.luotianyi.fun/v1/announcements";
  var WEB_VERSION_CODE = 1;
  var READ_STORAGE_KEY = "quareia-public-announcements-read-v1";
  var CACHE_STORAGE_PREFIX = "quareia-public-announcements-cache-v1:";
  var MAX_READ_MARKS = 200;
  var MAX_ANNOUNCEMENTS = 50;
  var SEVERITIES = ["info", "important", "update"];
  var TRUSTED_NATIVE_BRIDGES = [
    "androidAbout",
    "androidTelemetry",
    "androidHistoryExport"
  ];

  function isNativeContainer(root) {
    root = root || global;
    var location = root.location;
    var hostname = location && (location.hostname || location.host);
    if (hostname === "appassets.androidplatform.net") return true;
    return TRUSTED_NATIVE_BRIDGES.some(function (name) {
      return Boolean(root[name]);
    });
  }

  function normalizeLocale(value) {
    return String(value || "").toLowerCase().indexOf("zh") === 0 ? "zh-CN" : "en";
  }

  function buildAnnouncementUrl(locale) {
    var query = new URLSearchParams();
    query.set("platform", "web");
    query.set("version_code", String(WEB_VERSION_CODE));
    query.set("locale", locale || "en");
    return ENDPOINT + "?" + query.toString();
  }

  function trustedHttpsUrl(value) {
    if (typeof value !== "string" || value.length === 0) return false;
    try {
      var parsed = new URL(value);
      return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
    } catch (_error) {
      return false;
    }
  }

  function storageFor(root) {
    try {
      return root.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function getLocale(root, document) {
    var api = root.DivinationI18n;
    if (api && typeof api.getLocale === "function") {
      return normalizeLocale(api.getLocale());
    }
    if (document && document.documentElement) {
      return normalizeLocale(document.documentElement.lang);
    }
    return normalizeLocale(root.navigator && root.navigator.language);
  }

  function translate(root, key) {
    var api = root.DivinationI18n;
    return api && typeof api.t === "function" ? api.t(key) : key;
  }

  function validSeverity(value) {
    return SEVERITIES.indexOf(value) !== -1;
  }

  function normalizeAnnouncement(value) {
    if (!value || !Number.isSafeInteger(Number(value.id)) || Number(value.id) <= 0) return null;
    if (!Number.isSafeInteger(Number(value.revision)) || Number(value.revision) <= 0) return null;
    if (!validSeverity(value.severity)) return null;
    return {
      id: Number(value.id),
      revision: Number(value.revision),
      severity: value.severity,
      title: typeof value.title === "string" ? value.title : "",
      body: typeof value.body === "string" ? value.body : "",
      button: typeof value.button === "string" ? value.button : "",
      action_url: typeof value.action_url === "string" ? value.action_url : ""
    };
  }

  function normalizeAnnouncements(value) {
    if (!Array.isArray(value)) return [];
    return value.map(normalizeAnnouncement).filter(Boolean).slice(0, MAX_ANNOUNCEMENTS);
  }

  function createController(root) {
    root = root || global;
    var document = root.document;
    var storage = storageFor(root);
    var state = {
      initialized: false,
      guarded: false,
      loading: false,
      locale: "en",
      announcements: [],
      fromCache: false,
      promise: null,
      requestLocale: "",
      elements: {}
    };
    var readMarks = readStoredMarks(storage);
    var requestSerial = 0;

    function byId(id) {
      return document && typeof document.getElementById === "function"
        ? document.getElementById(id)
        : null;
    }

    function cacheKey(locale) {
      return CACHE_STORAGE_PREFIX + normalizeLocale(locale);
    }

    function readCache(locale) {
      if (!storage) return null;
      try {
        var raw = storage.getItem(cacheKey(locale));
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        var list = normalizeAnnouncements(parsed && parsed.announcements);
        return list.length || (parsed && Array.isArray(parsed.announcements))
          ? {
              announcements: list,
              etag: parsed && typeof parsed.etag === "string" ? parsed.etag : "",
              updatedAt: parsed && Number(parsed.updatedAt) > 0 ? Number(parsed.updatedAt) : 0
            }
          : null;
      } catch (_error) {
        return null;
      }
    }

    function writeCache(locale, list, etag) {
      if (!storage) return;
      try {
        storage.setItem(cacheKey(locale), JSON.stringify({
          announcements: list,
          etag: etag || "",
          updatedAt: Date.now()
        }));
      } catch (_error) {}
    }

    function saveStoredMarks() {
      if (!storage) return;
      try {
        storage.setItem(READ_STORAGE_KEY, JSON.stringify(readMarks));
      } catch (_error) {}
    }

    function markRead(item) {
      var key = String(item.id) + ":" + String(item.revision);
      if (readMarks.indexOf(key) !== -1) return;
      readMarks.push(key);
      while (readMarks.length > MAX_READ_MARKS) readMarks.shift();
      saveStoredMarks();
    }

    function markPromptableAsRead(list) {
      list.forEach(function (item) {
        if (item.severity === "important" || item.severity === "update") markRead(item);
      });
    }

    function clearList() {
      var list = state.elements.list;
      if (!list) return;
      while (list.firstChild) list.removeChild(list.firstChild);
    }

    function makeTextElement(tagName, className, text) {
      var element = document.createElement(tagName);
      if (className) element.className = className;
      element.textContent = text;
      return element;
    }

    function renderItem(item) {
      var row = document.createElement("li");
      row.className = "announcement-item";
      row.setAttribute("data-severity", item.severity);

      var meta = makeTextElement(
        "p",
        "announcement-severity",
        translate(root, "announcement.severity." + item.severity)
      );
      var title = makeTextElement("h3", "announcement-item-title", item.title);
      row.appendChild(meta);
      row.appendChild(title);
      if (item.body) row.appendChild(makeTextElement("p", "announcement-item-body", item.body));

      if (trustedHttpsUrl(item.action_url)) {
        var actionLabel = item.button || translate(
          root,
          item.severity === "update" ? "announcement.updateAction" : "announcement.openAction"
        );
        var action = document.createElement("a");
        action.className = "announcement-action";
        action.href = item.action_url;
        action.target = "_blank";
        action.rel = "noopener noreferrer";
        action.setAttribute("target", "_blank");
        action.setAttribute("rel", "noopener noreferrer");
        action.textContent = actionLabel;
        row.appendChild(action);
      }
      return row;
    }

    function render() {
      var list = state.elements.list;
      if (!list || !document || typeof document.createElement !== "function") return;
      clearList();
      state.announcements.forEach(function (item) {
        list.appendChild(renderItem(item));
      });
      if (state.elements.empty) state.elements.empty.hidden = state.announcements.length !== 0;
      if (state.elements.status) {
        state.elements.status.textContent = state.fromCache
          ? translate(root, "announcement.cached")
          : "";
      }
    }

    function openDialog(markReadItems) {
      if (!state.elements.dialog) return;
      if (markReadItems) markPromptableAsRead(state.announcements);
      if (typeof state.elements.dialog.showModal === "function") {
        if (!state.elements.dialog.open) state.elements.dialog.showModal();
      } else {
        state.elements.dialog.setAttribute("open", "");
        state.elements.dialog.open = true;
      }
    }

    function closeDialog() {
      if (!state.elements.dialog) return;
      if (typeof state.elements.dialog.close === "function") {
        state.elements.dialog.close();
      } else {
        state.elements.dialog.removeAttribute("open");
        state.elements.dialog.open = false;
      }
    }

    function promptUnread() {
      var unread = state.announcements.some(function (item) {
        var key = String(item.id) + ":" + String(item.revision);
        return (item.severity === "important" || item.severity === "update") && readMarks.indexOf(key) === -1;
      });
      if (unread) openDialog(true);
    }

    function setAnnouncements(list, locale, fromCache) {
      state.locale = locale;
      state.announcements = normalizeAnnouncements(list);
      state.fromCache = Boolean(fromCache);
      render();
      promptUnread();
    }

    function responseHeaders(response) {
      return response && response.headers && typeof response.headers.get === "function"
        ? response.headers
        : null;
    }

    function refresh() {
      if (state.guarded || !state.initialized) return Promise.resolve(state);
      var locale = getLocale(root, document);
      if (state.loading && state.promise && state.requestLocale === locale) return state.promise;
      var cached = readCache(locale);
      if (cached) setAnnouncements(cached.announcements, locale, true);
      else setAnnouncements([], locale, false);

      if (typeof root.fetch !== "function") return Promise.resolve(state);
      // Keep this a CORS-safelisted GET. Manually setting If-None-Match would
      // require an OPTIONS preflight; the browser's HTTP cache may perform
      // conditional validation itself without exposing that header to script.
      var headers = { Accept: "application/json" };
      var requestId = ++requestSerial;
      state.loading = true;
      state.requestLocale = locale;
      state.promise = Promise.resolve(root.fetch(buildAnnouncementUrl(locale), {
        method: "GET",
        credentials: "omit",
        headers: headers
      })).then(function (response) {
        if (requestId !== requestSerial) return state;
        if (response && response.status === 304) {
          if (cached) setAnnouncements(cached.announcements, locale, true);
          return state;
        }
        if (!response || response.status < 200 || response.status >= 300) {
          throw new Error("announcement request failed");
        }
        return response.json().then(function (payload) {
          if (requestId !== requestSerial) return state;
          var list = normalizeAnnouncements(payload && payload.announcements);
          var responseHeader = responseHeaders(response);
          var etag = responseHeader ? responseHeader.get("etag") : "";
          writeCache(locale, list, etag);
          setAnnouncements(list, locale, false);
          return state;
        });
      }).catch(function () {
        if (requestId !== requestSerial) return state;
        if (cached) setAnnouncements(cached.announcements, locale, true);
        return state;
      }).then(function (result) {
        if (requestId === requestSerial) {
          state.loading = false;
          state.promise = null;
        }
        return result;
      });
      return state.promise;
    }

    function onLanguageChange() {
      if (state.initialized && !state.guarded) refresh();
    }

    function init() {
      if (state.initialized) return state;
      state.initialized = true;
      if (isNativeContainer(root)) {
        state.guarded = true;
        return state;
      }
      if (!document || typeof document.getElementById !== "function") return state;
      state.elements.open = byId("announcementOpenBtn");
      state.elements.dialog = byId("announcementDialog");
      state.elements.close = byId("announcementCloseBtn");
      state.elements.status = byId("announcementStatus");
      state.elements.list = byId("announcementList");
      state.elements.empty = byId("announcementEmpty");
      if (!state.elements.open || !state.elements.dialog || !state.elements.list) return state;
      state.elements.open.addEventListener("click", function () { openDialog(true); });
      if (state.elements.close) state.elements.close.addEventListener("click", closeDialog);
      if (typeof root.addEventListener === "function") {
        root.addEventListener("quareia:languagechange", onLanguageChange);
      }
      refresh();
      return state;
    }

    return {
      init: init,
      refresh: refresh,
      open: function () { openDialog(true); },
      close: closeDialog,
      state: function () { return state; }
    };
  }

  function readStoredMarks(storage) {
    if (!storage) return [];
    try {
      var parsed = JSON.parse(storage.getItem(READ_STORAGE_KEY) || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (value) {
        return typeof value === "string" && /^\d+:\d+$/.test(value);
      }).slice(-MAX_READ_MARKS);
    } catch (_error) {
      return [];
    }
  }

  var defaultController = null;
  var api = {
    ENDPOINT: ENDPOINT,
    WEB_VERSION_CODE: WEB_VERSION_CODE,
    init: function () {
      if (!defaultController) defaultController = createController(global);
      return defaultController.init();
    },
    refresh: function () {
      if (!defaultController) defaultController = createController(global);
      if (!defaultController.state().initialized) defaultController.init();
      return defaultController.refresh();
    },
    open: function () {
      if (!defaultController) defaultController = createController(global);
      if (!defaultController.state().initialized) defaultController.init();
      defaultController.open();
    },
    close: function () {
      if (defaultController) defaultController.close();
    },
    __test: {
      READ_STORAGE_KEY: READ_STORAGE_KEY,
      buildAnnouncementUrl: buildAnnouncementUrl,
      isNativeContainer: isNativeContainer,
      trustedHttpsUrl: trustedHttpsUrl,
      createController: createController,
      normalizeAnnouncements: normalizeAnnouncements
    }
  };

  global.DivinationAnnouncements = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", function () { api.init(); });
    } else {
      api.init();
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
