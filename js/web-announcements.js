(function () {
  "use strict";
  // The shared controller fetches at startup. On an offline launch, wait for a
  // connection or an explicit request to view previously saved announcements.
  const template = document.getElementById("webAnnouncementsModule");
  const button = document.getElementById("announcementOpenBtn");
  function load(event) {
    window.removeEventListener("online", load);
    if (button) button.removeEventListener("click", load);
    const script = document.createElement("script");
    script.src = template.content.querySelector("script").src;
    if (event && event.type === "click") {
      script.addEventListener("load", () => window.DivinationAnnouncements.open(), { once: true });
    }
    document.head.appendChild(script);
  }
  if (navigator.onLine === false) {
    if (button) button.addEventListener("click", load);
    window.addEventListener("online", load);
  } else {
    load();
  }
})();
