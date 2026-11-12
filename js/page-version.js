(function () {
  "use strict";

  var url = new URL(window.location.href);
  var classic = document.documentElement.dataset.pageVersion === "classic";
  var explicitModern = !classic && url.searchParams.get("view") === "modern";
  var preferenceKey = "quareia-page-version";
  var preferred = null;
  try {
    preferred = localStorage.getItem(preferenceKey);
    if (preferred === null) {
      // A visitor upgrading from the original site may already have a classic draft.
      var draftKey = "quareia-divination-free-board-draft-v1";
      var raw = localStorage.getItem(draftKey);
      if (raw && localStorage.getItem(draftKey + "-classic") === null) {
        var draft;
        try { draft = JSON.parse(raw); } catch (_error) { /* Keep the source untouched. */ }
        if (draft && draft.schema === "free-board/v1" && !draft.layout && !draft.parked) {
          localStorage.setItem(draftKey + "-classic", raw);
        }
      }
    }
    if (classic || explicitModern || preferred === null) {
      localStorage.setItem(preferenceKey, classic ? "classic" : "modern");
    }
  } catch (_error) { /* Direct links work even when storage is unavailable. */ }

  if (!classic && !explicitModern && preferred === "classic" && url.searchParams.get("smoke") !== "1") {
    var destination = new URL("classic.html", url);
    destination.search = url.search;
    destination.hash = url.hash;
    window.location.replace(destination.href);
  } else if (explicitModern) {
    url.searchParams.delete("view");
    try { history.replaceState(history.state, "", url.href); } catch (_error) { /* file URLs */ }
  }
})();
