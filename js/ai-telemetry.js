(function (global) {
  "use strict";
  var MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]{0,127}$/;
  function target() { return global.androidTelemetry || global.DivinationWebTelemetry; }
  function createObserver(model, kind, options) {
    var opts = options || {}, receiver = opts.receiver || target(), cryptoApi = opts.crypto || global.crypto;
    var requestId = "", consent = "", finished = false;
    return {
      onRequestStart: function () {
        if (requestId || finished || !MODEL_ID.test(model) || ["conversation", "compression"].indexOf(kind) < 0) return;
        try {
          if (!receiver || typeof receiver.beginAiUsage !== "function" || typeof receiver.logAiUsage !== "function") return;
          consent = receiver.beginAiUsage();
          if (typeof consent !== "string" || !consent || !cryptoApi || typeof cryptoApi.getRandomValues !== "function") return;
          var bytes = new Uint8Array(16);
          cryptoApi.getRandomValues(bytes);
          requestId = Array.from(bytes, function (b) { return b.toString(16).padStart(2, "0"); }).join("");
        } catch (_error) { requestId = ""; }
      },
      onRequestEnd: function (result) {
        if (finished) return;
        finished = true;
        if (!requestId || !result || result.complete !== true) return;
        var raw = result.usage ? result.usage.totalTokens : null;
        var total = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= 1000000000 ? raw : -1;
        try {
          // Only scalar usage metadata crosses the bridge. No profile or response object.
          var sent = receiver.logAiUsage(requestId, model, kind, total, consent);
          if (sent && typeof sent.catch === "function") sent.catch(function () {});
        } catch (_error) { /* Optional statistics never affect conversation output. */ }
      }
    };
  }
  function refreshToggle() {
    if (!global.document) return;
    var button = global.document.getElementById("aiTelemetryToggle"), receiver = target();
    if (!button || !receiver || typeof receiver.isEnabled !== "function" || typeof receiver.setEnabled !== "function") return;
    try {
      var enabled = receiver.isEnabled();
      var key = enabled ? "ai.telemetryDisable" : "ai.telemetryEnable";
      var i18n = global.DivinationI18n;
      button.hidden = false;
      button.textContent = i18n && typeof i18n.t === "function" ? i18n.t(key) : (enabled ? "关闭匿名使用统计" : "开启匿名使用统计");
      button.setAttribute("aria-pressed", String(enabled));
    } catch (_error) {}
  }
  function initToggle() {
    var button = global.document && global.document.getElementById("aiTelemetryToggle");
    if (button) button.addEventListener("click", function () {
      try { var receiver = target(); receiver.setEnabled(!receiver.isEnabled()); } catch (_error) {}
      refreshToggle();
    });
    refreshToggle();
  }
  var api = { createObserver: createObserver };
  if (typeof module === "object" && module.exports) module.exports = api;
  global.DivinationAiTelemetry = api;
  if (global.document) {
    if (global.document.readyState === "loading") global.document.addEventListener("DOMContentLoaded", initToggle);
    else initToggle();
    global.addEventListener("quareia:languagechange", refreshToggle);
    global.addEventListener("storage", refreshToggle);
    global.addEventListener("pageshow", refreshToggle);
  }
}(typeof window !== "undefined" ? window : globalThis));
