(function (global) {
  "use strict";

  var STORAGE_KEY = "quareia-telemetry-first-launch-notice";
  var dialog = null;
  var closeButton = null;
  var manageButton = null;

  function systemLocale() {
    var language = (global.navigator && (global.navigator.language || global.navigator.userLanguage)) || "en";
    return String(language).toLowerCase().indexOf("zh") === 0 ? "zh-CN" : "en";
  }

  function copyForSystem(key) {
    var i18n = global.DivinationI18n;
    if (!i18n) return key;
    if (typeof i18n.tForLocale === "function") return i18n.tForLocale(systemLocale(), key);
    return i18n.t(key);
  }

  function applySystemCopy() {
    if (!dialog) return;
    var title = document.getElementById("telemetryDialogTitle");
    var message = document.getElementById("telemetryDialogMessage");
    var kicker = document.querySelector("#telemetryDialog .telemetry-kicker");
    if (kicker) kicker.textContent = copyForSystem("telemetry.kicker");
    if (title) title.textContent = copyForSystem("telemetry.title");
    if (message) message.textContent = copyForSystem("telemetry.firstLaunchNotice");
    if (manageButton) manageButton.textContent = copyForSystem("telemetry.manage");
    if (closeButton) closeButton.textContent = copyForSystem("telemetry.acknowledge");
    dialog.setAttribute("lang", systemLocale());
  }

  function close() {
    if (!dialog) return;
    if (dialog.open) dialog.close();
    dialog.setAttribute("aria-hidden", "true");
  }

  function handleBack() {
    if (!dialog || !dialog.open) return false;
    close();
    return true;
  }

  function openAbout() {
    close();
    if (global.androidAbout && typeof global.androidAbout.open === "function") {
      global.androidAbout.open();
    }
  }

  function showIfNeeded() {
    var seen = false;
    try {
      seen = global.localStorage && global.localStorage.getItem(STORAGE_KEY) === "1";
    } catch (_error) {}
    if (seen || !dialog || typeof dialog.showModal !== "function") return;

    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, "1");
    } catch (_error) {}
    dialog.showModal();
    dialog.setAttribute("aria-hidden", "false");
    requestAnimationFrame(function () {
      if (closeButton) closeButton.focus();
    });
  }

  function init() {
    dialog = document.getElementById("telemetryDialog");
    closeButton = document.getElementById("telemetryNoticeClose");
    manageButton = document.getElementById("telemetryNoticeManage");
    if (!dialog) return;

    applySystemCopy();
    if (closeButton) closeButton.addEventListener("click", close);
    if (manageButton) manageButton.addEventListener("click", openAbout);
    global.addEventListener("quareia:languagechange", applySystemCopy);
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) close();
    });
    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      close();
    });
    global.setTimeout(showIfNeeded, 0);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.DivinationTelemetryNotice = {
    showIfNeeded: showIfNeeded,
    close: close,
    handleBack: handleBack
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
