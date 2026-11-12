/* Spread settings popover: reuses the real preset-spread controls from the settings panel. */
(function () {
  "use strict";

  var btn = document.getElementById("spreadSettingsBtn");
  var popover = document.getElementById("spreadPopover");
  var body = document.getElementById("spreadPopoverBody");
  var closeBtn = document.getElementById("spreadPopoverClose");
  var group = document.querySelector(".setting-group-spread");
  if (!btn || !popover || !body || !group) return;

  /* the preset-spread control belongs to this popover for good: it is never
     shown inside the advanced settings panel */
  if (group.parentNode !== body) body.appendChild(group);

  function place() {
    var rect = btn.getBoundingClientRect();
    var width = Math.min(340, window.innerWidth - 32);
    popover.style.width = width + "px";
    var left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(16, Math.min(window.innerWidth - width - 16, left));
    popover.style.left = left + "px";
    popover.style.top = Math.min(window.innerHeight - 40, rect.bottom + 12) + "px";
  }

  function onDocumentPointer(event) {
    if (popover.contains(event.target) || btn.contains(event.target)) return;
    close();
  }

  function open() {
    popover.hidden = false;
    place();
    btn.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onDocumentPointer, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
  }

  function close() {
    if (popover.hidden) return;
    popover.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onDocumentPointer, true);
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
  }

  btn.addEventListener("click", function () {
    if (popover.hidden) {
      open();
    } else {
      close();
    }
  });

  window.DivinationSpreadSettings = {
    handleBack: function () {
      if (popover.hidden) return false;
      close();
      btn.focus({ preventScroll: true });
      return true;
    }
  };

  if (closeBtn) closeBtn.addEventListener("click", close);

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !popover.hidden) close();
  });

  function toggleLayout() {
    var select = document.getElementById("layoutModeSelect");
    if (!select) return;
    select.value = select.value === "freeform" ? "preset" : "freeform";
    close();
    btn.focus({ preventScroll: true });
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  group.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest("#freeBoardOpenBtn")) {
      toggleLayout();
    }
  });
})();
