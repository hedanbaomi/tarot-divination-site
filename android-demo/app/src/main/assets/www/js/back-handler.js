(function (global) {
  "use strict";

  // Android asks this synchronous contract to consume the back button before
  // WebView history. The list is ordered from the most transient overlay to
  // the page-level drawer; a handler must return true only when it closed one.
  function handleBack() {
    var handlers = [
      global.DivinationDialog,
      global.DivinationCustomSelects,
      global.DivinationTelemetryNotice,
      global.DivinationHistoryUi,
      global.DivinationMenu
    ];
    for (var i = 0; i < handlers.length; i += 1) {
      var handler = handlers[i];
      if (handler && typeof handler.handleBack === "function" && handler.handleBack()) {
        return true;
      }
    }
    return false;
  }

  global.DivinationUiBack = { handleBack: handleBack };
})(typeof globalThis !== "undefined" ? globalThis : this);
