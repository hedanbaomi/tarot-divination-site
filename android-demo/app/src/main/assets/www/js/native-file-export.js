(function (global) {
  "use strict";

  // The host has one document picker. Its callback reports the final destination
  // name, which the user may have changed. Route by request, not by filename.
  var pending = null;
  global.__quareiaHistoryExportResult = function (result) {
    var receiver = pending;
    pending = null;
    if (receiver && typeof receiver.onResult === "function") receiver.onResult(result);
  };
  if (typeof global.addEventListener === "function") {
    global.addEventListener("pagehide", function () { pending = null; });
  }

  function start(method, content, fileName, onResult) {
    if (pending) return false;
    var request = { onResult: onResult };
    pending = request;
    try {
      if (global.androidHistoryExport[method](content, fileName) !== false) return true;
      if (pending === request) pending = null;
      return false;
    } catch (error) {
      if (pending === request) pending = null;
      throw error;
    }
  }

  global.DivinationNativeFileExport = {
    save: function (content, fileName, onResult) {
      return start("save", content, fileName, onResult);
    },
    savePng: function (base64, fileName, onResult) {
      return start("savePng", base64, fileName, onResult);
    }
  };
})(globalThis);
