/* Segmented pill controls: turn the settings <select>s into draggable pill
   strips. The real <select> stays in the DOM (hidden) so app.js keeps
   working untouched; pills write the value back and fire a change event. */
(function () {
  "use strict";

  var SELECTS = ["deckSelect", "modeSelect", "layoutModeSelect", "arcanaFilter", "overviewMethod"];

  function pillsFor(select) {
    return Array.prototype.slice.call(select.options).filter(function (o) {
      return !o.disabled && o.textContent.trim() !== "";
    });
  }

  function build(select) {
    var old = select.parentNode.querySelector(".seg[data-for='" + select.id + "']");
    if (old) old.parentNode.removeChild(old);

    var seg = document.createElement("div");
    seg.className = "seg";
    seg.setAttribute("data-for", select.id);
    seg.setAttribute("role", "group");
    if (select.id === "spreadSelect") seg.setAttribute("aria-label", "牌阵");

    pillsFor(select).forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "seg-btn";
      btn.textContent = opt.textContent;
      btn.dataset.value = opt.value;
      btn.setAttribute("aria-pressed", String(opt.value === select.value));
      if (opt.value === select.value) btn.classList.add("is-on");
      seg.appendChild(btn);
    });

    var thumb = document.createElement("span");
    thumb.className = "seg-thumb";
    thumb.setAttribute("aria-hidden", "true");
    seg.appendChild(thumb);

    select.classList.add("seg-native");
    var anchor = select.nextElementSibling;
    if (anchor && anchor.classList.contains("themed-select-trigger")) {
      anchor.hidden = true;
      anchor.style.display = "none";
      anchor.parentNode.insertBefore(seg, anchor.nextSibling);
    } else {
      select.parentNode.insertBefore(seg, select.nextSibling);
    }

    seg.addEventListener("click", function (ev) {
      if (seg.dataset.dragged === "1") return;
      var btn = ev.target.closest(".seg-btn");
      if (!btn) return;
      if (select.value !== btn.dataset.value) {
        select.value = btn.dataset.value;
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      sync(select);
    });

    bindDrag(seg);
    var edges = function () {
      var room = seg.scrollWidth - seg.clientWidth;
      seg.classList.toggle("is-scroll", room > 4);
      seg.classList.toggle("at-start", seg.scrollLeft <= 4);
      seg.classList.toggle("at-end", seg.scrollLeft >= room - 4);
    };
    seg.addEventListener("scroll", edges, { passive: true });
    window.addEventListener("resize", edges);
    edges();
    equalize(seg);
    sync(select);
    window.requestAnimationFrame(function () { equalize(seg); sync(select); });
    return seg;
  }

  /* every option gets the same slot width, so the strip reads as a switch */
  function equalize(seg) {
    var btns = seg.querySelectorAll(".seg-btn");
    var max = 0;
    for (var i = 0; i < btns.length; i++) {
      btns[i].style.minWidth = "";
      max = Math.max(max, btns[i].offsetWidth);
    }
    if (max > 0) {
      for (var j = 0; j < btns.length; j++) btns[j].style.minWidth = max + "px";
    }
  }

  function sync(select) {
    var seg = select.parentNode.querySelector(".seg[data-for='" + select.id + "']");
    if (!seg) return;
    var thumb = seg.querySelector(".seg-thumb");
    var btns = seg.querySelectorAll(".seg-btn");
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].dataset.value === select.value;
      btns[i].setAttribute("aria-pressed", String(on));
      btns[i].classList.toggle("is-on", on);
      if (on) {
        if (thumb) {
          thumb.style.width = btns[i].offsetWidth + "px";
          thumb.style.transform = "translateX(" + btns[i].offsetLeft + "px)";
        }
        seg.classList.add("is-ready");
        var left = btns[i].offsetLeft - 20;
        if (left < -2 || left > seg.scrollLeft + 2) seg.scrollLeft = Math.max(0, left);
      }
    }
  }

  function bindDrag(seg) {
    var down = false, startX = 0, startScroll = 0, moved = 0;

    seg.addEventListener("pointerdown", function (ev) {
      if (ev.button !== 0) return;
      down = true;
      moved = 0;
      startX = ev.clientX;
      startScroll = seg.scrollLeft;
    });

    seg.addEventListener("pointermove", function (ev) {
      if (!down) return;
      var dx = ev.clientX - startX;
      moved = Math.max(moved, Math.abs(dx));
      if (Math.abs(dx) > 6) {
        seg.classList.add("is-drag");
        seg.scrollLeft = startScroll - dx;
        ev.preventDefault();
      }
    });

    function up() {
      if (!down) return;
      down = false;
      seg.classList.remove("is-drag");
      if (moved > 6) {
        seg.dataset.dragged = "1";
        window.setTimeout(function () { delete seg.dataset.dragged; }, 260);
      }
    }
    seg.addEventListener("pointerup", up);
    seg.addEventListener("pointercancel", up);
    seg.addEventListener("pointerleave", up);
    seg.addEventListener("dragstart", function (ev) { ev.preventDefault(); });
  }

  var built = {};
  function refresh(select) {
    var sig = Array.prototype.map.call(select.options, function (o) {
      return o.value + "=" + o.textContent;
    }).join("|");
    if (built[select.id] === sig) { sync(select); return; }
    built[select.id] = sig;
    build(select);
  }

  function init() {
    SELECTS.forEach(function (id) {
      var select = document.getElementById(id);
      if (!select) return;
      refresh(select);
      new MutationObserver(function () { refresh(select); }).observe(select, {
        childList: true, subtree: true, characterData: true
      });
      select.addEventListener("change", function () { sync(select); });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  document.addEventListener("quareia:languagechange", function () {
    SELECTS.forEach(function (id) {
      var select = document.getElementById(id);
      if (select) refresh(select);
    });
  });
})();
