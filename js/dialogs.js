(function (root) {
  "use strict";

  var pendingResolver = null;
  var previousFocus = null;
  var elements = null;

  function cacheElements() {
    if (elements) return elements;
    elements = {
      overlay: document.getElementById("confirmDialog"),
      kicker: document.querySelector("#confirmDialog .confirm-kicker"),
      title: document.getElementById("confirmDialogTitle"),
      message: document.getElementById("confirmMessage"),
      cancel: document.getElementById("confirmCancelBtn"),
      proceed: document.getElementById("confirmProceedBtn")
    };
    return elements;
  }

  function settle(accepted) {
    if (!pendingResolver) return;
    var current = cacheElements();
    var resolve = pendingResolver;
    pendingResolver = null;
    if (current.overlay.open) current.overlay.close();
    current.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("confirm-open");
    resolve(Boolean(accepted));
    root.dispatchEvent(new CustomEvent("quareia:dialogsettled", {
      detail: { accepted: Boolean(accepted) }
    }));
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  function handleKeydown(event) {
    var current = cacheElements();
    if (event.key === "Escape") {
      event.preventDefault();
      settle(false);
      return;
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === current.cancel) {
      event.preventDefault();
      current.proceed.focus();
    } else if (!event.shiftKey && document.activeElement === current.proceed) {
      event.preventDefault();
      current.cancel.focus();
    }
  }

  function request(options) {
    var current = cacheElements();
    if (!current.overlay || pendingResolver) return Promise.resolve(false);

    current.kicker.textContent = options.kicker || "";
    current.title.textContent = options.title || "";
    current.message.textContent = options.message || "";
    current.cancel.textContent = options.cancelLabel || "";
    current.proceed.textContent = options.proceedLabel || "";
    previousFocus = document.activeElement;
    current.overlay.showModal();
    current.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("confirm-open");

    return new Promise(function (resolve) {
      pendingResolver = resolve;
      requestAnimationFrame(function () { current.cancel.focus(); });
    });
  }

  function init() {
    var current = cacheElements();
    if (!current.overlay) return;
    current.cancel.addEventListener("click", function () { settle(false); });
    current.proceed.addEventListener("click", function () { settle(true); });
    current.overlay.addEventListener("click", function (event) {
      if (event.target === current.overlay) settle(false);
    });
    current.overlay.addEventListener("cancel", function (event) {
      event.preventDefault();
      settle(false);
    });
    current.overlay.addEventListener("keydown", handleKeydown);
  }

  init();
  root.DivinationDialog = { request: request };
})(typeof globalThis !== "undefined" ? globalThis : this);
