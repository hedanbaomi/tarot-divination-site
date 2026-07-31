(function (global) {
  "use strict";

  var menu = null;
  var backdrop = null;
  var toggle = null;
  var closeButton = null;
  var previousFocus = null;

  function setOpen(nextOpen, restoreFocus) {
    if (!menu || !toggle || !backdrop) return;
    if (nextOpen) {
      previousFocus = document.activeElement;
      menu.classList.add("is-open");
      backdrop.classList.add("is-visible");
      toggle.setAttribute("aria-expanded", "true");
      menu.setAttribute("aria-hidden", "false");
      backdrop.setAttribute("aria-hidden", "false");
      document.body.classList.add("menu-open");
      requestAnimationFrame(function () {
        if (closeButton) closeButton.focus();
      });
      return;
    }

    menu.classList.remove("is-open");
    backdrop.classList.remove("is-visible");
    toggle.setAttribute("aria-expanded", "false");
    menu.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("aria-hidden", "true");
    document.body.classList.remove("menu-open");
    if (restoreFocus !== false && previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  function openAbout() {
    setOpen(false);
    if (global.androidAbout && typeof global.androidAbout.open === "function") {
      global.androidAbout.open();
    }
  }

  function init() {
    menu = document.getElementById("appMenu");
    backdrop = document.getElementById("menuBackdrop");
    toggle = document.getElementById("menuToggle");
    closeButton = document.getElementById("menuClose");
    if (!menu || !backdrop || !toggle) return;

    toggle.addEventListener("click", function () {
      setOpen(!menu.classList.contains("is-open"));
    });
    if (closeButton) closeButton.addEventListener("click", function () { setOpen(false); });
    backdrop.addEventListener("click", function () { setOpen(false); });

    var historyButton = document.getElementById("historyOpenBtn");
    if (historyButton) historyButton.addEventListener("click", function () { setOpen(false); });
    var aboutButton = document.getElementById("aboutOpenBtn");
    if (aboutButton) aboutButton.addEventListener("click", openAbout);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.classList.contains("is-open")) {
        event.preventDefault();
        setOpen(false);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  global.DivinationMenu = {
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    toggle: function () { setOpen(!menu || !menu.classList.contains("is-open")); },
    isOpen: function () { return Boolean(menu && menu.classList.contains("is-open")); }
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
