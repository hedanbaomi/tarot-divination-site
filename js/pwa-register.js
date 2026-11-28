(function () {
  "use strict";
  const { protocol, hostname } = window.location;
  const loopback = hostname === "localhost" || hostname === "127.0.0.1";
  if (protocol !== "https:" && !(protocol === "http:" && loopback)) return;
  if ("androidAbout" in window || "androidHistoryExport" in window || "androidAiConfig" in window) return;
  if (!("serviceWorker" in navigator)) return;

  // The browser checks for updates at registration. An update waits for existing
  // pages to close, so an open reading or chat is never forcibly reloaded.
  try {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function () {});
  } catch (_) { /* Storage or worker registration can be disabled in this browser. */ }
})();
