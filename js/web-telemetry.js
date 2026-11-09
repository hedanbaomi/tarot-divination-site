(function () {
  "use strict";
  if (typeof window === "undefined" || typeof document === "undefined") return;
  var loc = window.location || {};
  if (loc.protocol !== "https:" || loc.hostname !== "hedanbaomi.github.io" ||
      typeof loc.pathname !== "string" || loc.pathname.indexOf("/tarot-divination-site/") !== 0 ||
      window.androidTelemetry || window.DivinationWebTelemetry) return;

  var ENDPOINT = "https://telemetry.luotianyi.fun/v1/events";
  var PREFIX = "quareia-web-telemetry-";
  var VERSION = "web-1";
  var pending = {};
  var controllers = [];
  var generation = 0;
  var disabled = false;
  var visited = false;
  var identityPromise = null;
  var storage;
  try {
    storage = window.localStorage;
    storage.setItem(PREFIX + "probe", "1");
    storage.removeItem(PREFIX + "probe");
  } catch (_error) { return; }

  function read(key) {
    try { return storage.getItem(PREFIX + key); } catch (_error) { return null; }
  }
  function write(key, value) {
    try { storage.setItem(PREFIX + key, value); } catch (_error) { /* Optional statistics. */ }
  }
  function isEnabled() {
    if (disabled) return false;
    try { return storage.getItem(PREFIX + "enabled") !== "false"; } catch (_error) { return false; }
  }
  function identity() {
    if (identityPromise) return identityPromise;
    identityPromise = Promise.resolve().then(function () {
      var existing = read("id");
      if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
      var bytes = new Uint8Array(32);
      window.crypto.getRandomValues(bytes);
      return window.crypto.subtle.digest("SHA-256", bytes).then(function (digest) {
        return Array.from(new Uint8Array(digest), function (value) {
          return value.toString(16).padStart(2, "0");
        }).join("");
      });
    });
    return identityPromise;
  }
  function send(event, extra) {
    var token = generation;
    if (!isEnabled() || typeof window.fetch !== "function") return Promise.resolve(false);
    return identity().then(function (id) {
      if (!isEnabled() || token !== generation) return false;
      write("id", id);
      var payload = {
        schema_version: 1, event: event, install_hash: id,
        app_version: VERSION, platform: "web",
        locale: String(document.documentElement.lang || "zh-CN").slice(0, 64)
      };
      if (extra) {
        payload.deck_type = extra.deck_type;
        payload.card_count = extra.card_count;
      }
      var controller = new AbortController();
      controllers.push(controller);
      var timer = setTimeout(function () { controller.abort(); }, 8000);
      return Promise.resolve().then(function () {
        if (!isEnabled() || token !== generation || controller.signal.aborted) return { status: 499 };
        return window.fetch(ENDPOINT, {
          method: "POST", mode: "cors", credentials: "omit", cache: "no-store",
          referrerPolicy: "no-referrer", keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), signal: controller.signal
        });
      }).then(function (response) {
        return response.status === 204 && isEnabled() && token === generation;
      }).finally(function () {
        clearTimeout(timer);
        controllers = controllers.filter(function (item) { return item !== controller; });
      });
    }).catch(function () { return false; });
  }
  function once(event, needed, onSuccess) {
    if (!needed || pending[event]) return;
    var token = generation;
    var promise = send(event).then(function (ok) {
      if (ok && token === generation && isEnabled()) onSuccess();
    }).finally(function () {
      if (pending[event] === promise) delete pending[event];
    });
    pending[event] = promise;
  }
  function start() {
    if (!isEnabled() || document.visibilityState === "hidden") return;
    once("web_visit", !visited, function () { visited = true; });
    once("install_seen", read("installed") !== "true", function () { write("installed", "true"); });
    var lastActive = Number(read("active")) || 0;
    once("app_active", !lastActive || Date.now() - lastActive >= 21600000 || lastActive > Date.now(),
      function () { write("active", String(Date.now())); });
  }
  function stop() {
    generation += 1;
    controllers.forEach(function (controller) { controller.abort(); });
    controllers = [];
    pending = {};
    identityPromise = null;
    // A completed page view stays counted for this document even after opt-in.
    ["id", "installed", "active"].forEach(function (key) {
      try { storage.removeItem(PREFIX + key); } catch (_error) { /* Optional statistics. */ }
    });
  }
  function updateButton() {
    var button = document.getElementById("webTelemetryToggle");
    if (!button) return;
    button.hidden = false;
    var key = isEnabled() ? "privacy.telemetryDisable" : "privacy.telemetryEnable";
    button.textContent = window.DivinationI18n ? window.DivinationI18n.t(key) : key;
    button.setAttribute("aria-pressed", String(isEnabled()));
  }
  function setEnabled(value) {
    disabled = !value;
    write("enabled", value ? "true" : "false");
    if (!value) stop();
    else start();
    updateButton();
  }
  window.DivinationWebTelemetry = {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    logReadingCompleted: function (deck, count) {
      if (["tarot", "mystagogus", "lxxxi"].indexOf(deck) === -1 ||
          !Number.isInteger(count) || count < 1 || count > 81) return Promise.resolve(false);
      start();
      return send("reading_completed", { deck_type: deck, card_count: count });
    }
  };
  var button = document.getElementById("webTelemetryToggle");
  if (button) button.addEventListener("click", function () { setEnabled(!isEnabled()); });
  window.addEventListener("quareia:languagechange", updateButton);
  window.addEventListener("storage", function (event) {
    if (event.key === PREFIX + "enabled" || event.key === null) {
      disabled = event.key !== null && event.newValue === "false";
      if (!isEnabled() || event.key === null) stop();
      updateButton();
    }
  });
  document.addEventListener("visibilitychange", start);
  window.addEventListener("pageshow", start);
  updateButton();
  start();
}());
