(function () {
  "use strict";

  var BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";
  var BEACON_TOKEN = "f5cb15ff0d4d4a44a9eefb32c8fcfdf8";
  var SITE_PATH = "/tarot-divination-site/";

  if (typeof window === "undefined" || typeof document === "undefined") return;

  var location = window.location || {};
  if (
    location.protocol !== "https:" ||
    location.hostname !== "hedanbaomi.github.io" ||
    typeof location.pathname !== "string" ||
    (location.pathname !== SITE_PATH && location.pathname.indexOf(SITE_PATH) !== 0)
  ) {
    return;
  }

  if (document.querySelector("script[data-cf-beacon]")) return;

  var script = document.createElement("script");
  script.type = "module";
  script.src = BEACON_SRC;
  script.setAttribute("data-cf-beacon", JSON.stringify({ token: BEACON_TOKEN }));

  var parent = document.head || document.body;
  if (parent) parent.appendChild(script);
}());
