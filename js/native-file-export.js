(function (global) {
  "use strict";

  // The host has one document picker. Its callback reports the final destination
  // name, which the user may have changed. Route by request, not by filename.
  var pending = null;
  global.__quareiaHistoryExportResult = function (result) {
    var receiver = pending;
    pending = null;
    if (receiver) receiver(result);
  };

  global.DivinationNativeFileExport = {
    save: function (content, fileName, onResult) {
      if (pending) return false;
      pending = onResult;
      try {
        global.androidHistoryExport.save(content, fileName);
        return true;
      } catch (error) {
        pending = null;
        throw error;
      }
    }
  };
})(globalThis);
