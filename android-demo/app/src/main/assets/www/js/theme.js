(function (global) {
  "use strict";

  var STORAGE_KEY = "quareia-divination-theme";
  var DEFAULT_THEME = "celestial";
  var THEMES = ["celestial", "parchment", "ember", "grove"];
  var THEME_COLORS = {
    celestial: "#060919",
    parchment: "#efe4cc",
    ember: "#140a08",
    grove: "#07140f"
  };
  var initialized = false;
  var theme = readStoredTheme();

  function readStoredTheme() {
    try {
      var value = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
      return THEMES.indexOf(value) !== -1 ? value : DEFAULT_THEME;
    } catch (_error) {
      return DEFAULT_THEME;
    }
  }

  function applyThemeColor(id) {
    if (!global.document) return;
    var color = THEME_COLORS[id] || THEME_COLORS[DEFAULT_THEME];
    var meta = global.document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", color);
    try {
      if (global.androidThemeChrome && typeof global.androidThemeChrome.set === "function") {
        global.androidThemeChrome.set(color, id === "parchment" ? "1" : "0");
      }
    } catch (_error) {}
  }

  function applyDocument() {
    if (!global.document) return;
    var root = global.document.documentElement;
    root.setAttribute("data-theme", theme);
    applyThemeColor(theme);
    var buttons = global.document.querySelectorAll("[data-theme-id]");
    Array.prototype.forEach.call(buttons, function (button) {
      var selected = button.getAttribute("data-theme-id") === theme;
      button.setAttribute("aria-checked", selected ? "true" : "false");
      button.classList.toggle("is-active", selected);
    });
  }

  function setTheme(nextTheme) {
    if (THEMES.indexOf(nextTheme) === -1 || nextTheme === theme) return false;
    theme = nextTheme;
    try {
      if (global.localStorage) global.localStorage.setItem(STORAGE_KEY, theme);
    } catch (_error) {}
    applyDocument();
    if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
      global.dispatchEvent(new global.CustomEvent("quareia:themechange", {
        detail: { theme: theme }
      }));
    }
    return true;
  }

  function onSwatchClick(event) {
    var button = event.currentTarget;
    var id = button && button.getAttribute("data-theme-id");
    if (id) setTheme(id);
  }

  function onSwatchKeydown(event) {
    var keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
    var delta = keys[event.key];
    if (!delta || !global.document) return;
    var buttons = Array.prototype.slice.call(
      global.document.querySelectorAll("[data-theme-id]")
    );
    var index = buttons.indexOf(event.currentTarget);
    if (index === -1) return;
    event.preventDefault();
    var next = buttons[(index + delta + buttons.length) % buttons.length];
    next.focus();
    setTheme(next.getAttribute("data-theme-id"));
  }

  function init() {
    if (initialized || !global.document) return;
    initialized = true;
    applyDocument();
    Array.prototype.forEach.call(global.document.querySelectorAll("[data-theme-id]"), function (button) {
      button.addEventListener("click", onSwatchClick);
      button.addEventListener("keydown", onSwatchKeydown);
    });
    if (typeof global.addEventListener === "function") {
      global.addEventListener("quareia:languagechange", applyDocument);
    }
  }

  global.DivinationTheme = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_THEME: DEFAULT_THEME,
    THEMES: THEMES.slice(),
    THEME_COLORS: THEME_COLORS,
    getTheme: function () { return theme; },
    setTheme: setTheme,
    applyDocument: applyDocument,
    init: init
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = global.DivinationTheme;
  }

  if (global.document) init();
})(typeof globalThis !== "undefined" ? globalThis : this);
