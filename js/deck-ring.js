/* Deck fan: a top-down arc of cards crowning the spread.
   Only a window of the deck is on the arc at once; dragging slides the deck
   along it and stops hard at the first and the last card. Tap to draw. */
(function () {
  "use strict";

  var stage = document.querySelector(".table-stage");
  var plane = stage ? stage.querySelector(".table-plane") : null;
  var ring = document.getElementById("deckSpread");
  var center = document.getElementById("spreadArea");
  if (!stage || !ring || !plane) return;

  /* slide is the fan's scroll position in "arc units": 0 = first card at the
     left end, maxSlide = last card at the right end. */
  var slide = 0;
  var velocity = 0;
  var dragging = false;
  var pointerId = null;
  var startX = 0;
  var startSlide = 0;
  var moved = 0;
  var suppressClickUntil = 0;
  var activeCard = null;
  var drawGuardUntil = 0;
  var syntheticClick = false;
  var raf = null;
  var lastTime = 0;
  var WINDOW = 172;
  var lut = null;
  var lutKey = "";
  /* how many cards the arc can hold without them squashing into each other;
     recomputed from the real arc length on every layout */
  var lastVis = 0;

  function visibleCount() {
    if (lastVis > 1) return lastVis;
    var w = stage.clientWidth || 900;
    return w < 620 ? 22 : 36;
  }

  function cardCount() {
    return ring.querySelectorAll(".deck-card").length;
  }

  function maxSlide() {
    var n = cardCount();
    var vis = visibleCount();
    if (n <= vis) return 0;
    return (n - vis) / (vis - 1);
  }

  /* ---------- even spacing along the arc ---------- */
  function buildLut(rx, ry) {
    var key = rx.toFixed(1) + "x" + ry.toFixed(1);
    if (lut && lutKey === key) return lut;
    var N = 240;
    var table = new Array(N + 1);
    var total = 0;
    var prev = 0;
    for (var i = 0; i <= N; i++) {
      var a = (-90 + (180 * i) / N) * (Math.PI / 180);
      var speed = Math.sqrt(rx * rx * Math.cos(a) * Math.cos(a) + ry * ry * Math.sin(a) * Math.sin(a));
      if (i > 0) total += ((speed + prev) / 2) * ((Math.PI * 180) / N / 180);
      prev = speed;
      table[i] = total;
    }
    lut = { table: table, total: total, N: N };
    lutKey = key;
    return lut;
  }

  function angleAt(u) {
    var table = lut.table;
    var target = u * lut.total;
    var lo = 0;
    var hi = table.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (table[mid] < target) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    var span = table[hi] - table[lo] || 1;
    var f = (target - table[lo]) / span;
    return -90 + ((lo + f) * 180) / lut.N;
  }

  function geometry() {
    var w = stage.clientWidth || 900;
    var grid = document.getElementById("spreadGrid");
    /* the spread's real footprint, measured from its own slots (not the
       grid's box, which is the full column width) */
    var gw = 0;
    var slotW = 0;
    var count = 0;
    var gapX = 20;
    if (grid) {
      var gcs = getComputedStyle(grid);
      var cg = parseFloat(gcs.columnGap) || 0;
      if (cg > 0) gapX = cg;
      for (var k = 0; k < grid.children.length; k++) {
        var box = grid.children[k].getBoundingClientRect();
        if (!box.width) continue;
        count++;
        if (box.width > slotW) slotW = box.width;
      }
    }
    if (count > 0) gw = slotW * count + gapX * (count - 1);
    /* the fan cradles the spread: its ends sit just outside the spread's sides,
       but never wider than the stage itself */
    var cardW = 78;
    var maxRx = (w - cardW) / 2 - 10;
    var reach = gw / 2 + (w < 620 ? 24 : 40);
    var rx = Math.min(reach, maxRx);
    rx = Math.max(rx, Math.min(w < 620 ? 126 : 196, maxRx));
    var ry = rx * (w < 620 ? 0.84 : 0.86);
    var ch = center && center.offsetHeight ? center.offsetHeight : 200;
    /* 自由模式下没有牌阵：扇形的下沿就是舞台的下沿 */
    if (count === 0) ch = 0;
    var gap = w < 620 ? 46 : 66;
    var cf = w < 620 ? 1.08 : 0.86;
    var h = Math.round(ry + gap + 42 + ch * cf + 24);
    stage.style.setProperty("--ring-rx", rx + "px");
    stage.style.setProperty("--ring-ry", ry + "px");
    stage.style.setProperty("--ring-cy", h - 24 - ch * cf + "px");
    stage.style.minHeight = h + 44 + "px";
    buildLut(rx, ry);
    return { rx: rx, ry: ry };
  }

  function layout() {
    var cards = ring.querySelectorAll(".deck-card");
    var n = cards.length;
    if (!n) return;
    var g = geometry();
    var cw = cards[0].offsetWidth || 78;
    var arcLen = (lut && lut.total) || Math.PI * ((g.rx + g.ry) / 2);
    var fit = Math.round(arcLen / (cw * 0.34));
    lastVis = Math.max(6, Math.min(40, n < fit ? n : fit));
    var vis = lastVis;
    var K = Math.max(1, Math.min(vis, n) - 1);
    var max = maxSlide();
    if (dragging) {
      if (slide < 0) slide = slide * 0.28;
      if (slide > max) slide = max + (slide - max) * 0.28;
    } else if (slide < 0) {
      slide = 0;
    } else if (slide > max) {
      slide = max;
    }
    for (var i = 0; i < n; i++) {
      var card = cards[i];
      var u = i / K - slide;
      if (u < -0.002 || u > 1.002) {
        if (card.style.visibility !== "hidden") {
          card.style.visibility = "hidden";
          card.style.opacity = "0";
          card.style.pointerEvents = "none";
        }
        continue;
      }
      var a = angleAt(Math.min(1, Math.max(0, u)));
      var rad = (a * Math.PI) / 180;
      var x = Math.sin(rad) * g.rx;
      var y = -Math.cos(rad) * g.ry;
      card.style.visibility = "visible";
      card.style.setProperty("--tx", x.toFixed(1) + "px");
      card.style.setProperty("--ty", y.toFixed(1) + "px");
      card.style.setProperty("--rot", a.toFixed(2) + "deg");
      card.style.opacity = card.disabled ? "0.35" : "1";
      card.style.pointerEvents = "auto";
      card.style.setProperty("--z", String(1000 + Math.round(u * 1000)));
    }
  }

  /* ---------- draw animation: the tapped card lifts out of the fan, in place ---------- */
  function flyToSlot(card) {
    var rect = card.getBoundingClientRect();
    if (!rect.width) return;
    var w = card.offsetWidth || 56;
    var h = card.offsetHeight || 84;
    var rot = parseFloat(card.style.getPropertyValue("--rot")) || 0;
    var rad = (rot * Math.PI) / 180;
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;

    var clone = card.cloneNode(true);
    clone.className = card.className + " is-flying";
    clone.removeAttribute("disabled");
    clone.style.cssText =
      "position:fixed;left:0;top:0;margin:0;z-index:9000;pointer-events:none;" +
      "width:" + w + "px;height:" + h + "px;transform-origin:50% 50%;";
    document.body.appendChild(clone);

    var cs = getComputedStyle(card);
    clone.style.borderRadius = cs.borderRadius;
    clone.style.background = cs.background;
    clone.style.border = cs.border;
    clone.style.boxShadow = "0 14px 30px rgba(0,0,0,.5)";

    var x0 = cx - w / 2;
    var y0 = cy - h / 2;
    /* outward along the card's own axis, so it leaves the fan where the finger is */
    var ox = Math.sin(rad) * 14;
    var oy = -Math.cos(rad) * 14;

    var anim = clone.animate(
      [
        { transform: "translate3d(" + x0 + "px," + y0 + "px,0) rotate(" + rot + "deg) scale(1)", opacity: 1 },
        {
          transform:
            "translate3d(" + (x0 + ox) + "px," + (y0 + oy) + "px,0) rotate(" + (rot * 0.6) +
            "deg) scale(1.03)",
          opacity: 1,
          offset: 0.55
        },
        {
          transform:
            "translate3d(" + (x0 + ox * 1.2) + "px," + (y0 + oy * 1.2) + "px,0) rotate(" + (rot * 0.4) +
            "deg) scale(1.03)",
          opacity: 0,
          offset: 1
        }
      ],
      { duration: 340, easing: "cubic-bezier(.3,.7,.3,1)", fill: "forwards" }
    );
    anim.onfinish = function () {
      clone.remove();
    };
    window.setTimeout(function () {
      if (clone.parentNode) clone.remove();
    }, 700);
  }

  function tick(now) {
    if (!lastTime) lastTime = now;
    var dt = Math.min(48, now - lastTime) / 16.67;
    lastTime = now;
    var max = maxSlide();
    var bound = slide < 0 ? 0 : slide > max ? max : null;
    if (bound !== null) {
      /* hard stop: settle onto the end of the deck and stop dead */
      slide += (bound - slide) * 0.34;
      velocity = 0;
      layout();
      if (Math.abs(bound - slide) > 0.0004) {
        raf = window.requestAnimationFrame(tick);
      } else {
        slide = bound;
        layout();
        raf = null;
        lastTime = 0;
      }
      return;
    }
    slide += velocity * dt;
    velocity *= Math.pow(0.93, dt);
    layout();
    if (Math.abs(velocity) > 0.0004) {
      raf = window.requestAnimationFrame(tick);
    } else {
      raf = null;
      lastTime = 0;
      velocity = 0;
    }
  }

  function startInertia() {
    if (raf) window.cancelAnimationFrame(raf);
    lastTime = 0;
    raf = window.requestAnimationFrame(tick);
  }

  /* the fan is a wide, forgiving target: a tap goes to the nearest card */
  function nearestCard(x, y, tolerance) {
    var cards = ring.querySelectorAll(".deck-card");
    var best = null;
    var bestD = tolerance;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.disabled || card.style.visibility === "hidden") continue;
      var r = card.getBoundingClientRect();
      if (!r.width) continue;
      var dx = Math.max(r.left - x, 0, x - r.right);
      var dy = Math.max(r.top - y, 0, y - r.bottom);
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= bestD) {
        bestD = d;
        best = card;
      }
    }
    return best;
  }

  function setActive(card) {
    if (activeCard === card) return;
    if (activeCard) activeCard.classList.remove("is-target");
    activeCard = card;
    if (activeCard) activeCard.classList.add("is-target");
  }

  function pick(card) {
    if (!card || card.disabled || card.classList.contains("is-flying")) return false;
    if (Date.now() < drawGuardUntil) return false;
    drawGuardUntil = Date.now() + 450;
    try {
      if (navigator.vibrate) navigator.vibrate(8);
    } catch (e) {}
    flyToSlot(card);
    return true;
  }

  function onDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest && event.target.closest(".spread-settings-btn")) return;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = null;
      lastTime = 0;
    }
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startSlide = slide;
    moved = 0;
    velocity = 0;
    stage.classList.add("is-dragging");
    setActive(nearestCard(event.clientX, event.clientY, 36));
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onMove(event) {
    if (!dragging || event.pointerId !== pointerId) return;
    var dx = event.clientX - startX;
    moved = Math.max(moved, Math.abs(dx));
    var perPixel = 1 / (lut ? lut.total : 400);
    var raw = startSlide - dx * perPixel;
    var max = maxSlide();
    var next = raw < 0 ? raw * 0.22 : raw > max ? max + (raw - max) * 0.22 : raw;
    velocity = next - slide;
    slide = next;
    layout();
  }

  function onUp(event) {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    stage.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    var max = maxSlide();
    if (slide < 0 || slide > max) {
      suppressClickUntil = Date.now() + 400;
      startInertia();
    } else if (moved > 8) {
      suppressClickUntil = Date.now() + 400;
      startInertia();
    } else {
      velocity = 0;
      layout();
    }
    setActive(null);
  }

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener(
    "click",
    function (event) {
      if (syntheticClick) return;
      if (Date.now() < suppressClickUntil) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      var direct = event.target.closest ? event.target.closest(".deck-card") : null;
      if (direct) {
        pick(direct);
        return;
      }
      var card = nearestCard(event.clientX, event.clientY, 34);
      if (!card) return;
      event.stopPropagation();
      event.preventDefault();
      if (!pick(card)) return;
      syntheticClick = true;
      try {
        card.click();
      } finally {
        syntheticClick = false;
      }
      suppressClickUntil = Date.now() + 500;
    },
    true
  );

  if (window.MutationObserver) {
    new MutationObserver(layout).observe(ring, { childList: true });
  }

  if (window.MutationObserver) {
    var gridWatch = document.getElementById("spreadGrid");
    if (gridWatch) {
      new MutationObserver(layout).observe(gridWatch, { childList: true, subtree: true });
    }
  }

  if (window.ResizeObserver) {
    var lastGW = 0;
    var lastGH = 0;
    var gridEl = document.getElementById("spreadGrid");
    if (gridEl) {
      new ResizeObserver(function () {
        var gw = gridEl.offsetWidth;
        var gh = gridEl.offsetHeight;
        if (gw === lastGW && gh === lastGH) return;
        lastGW = gw;
        lastGH = gh;
        layout();
      }).observe(gridEl);
    }
  }
  window.addEventListener("resize", layout);
  window.addEventListener("load", layout);
  layout();
  window.deckFanRelayout = layout;
})();

/* ---------- shuffle choreography: scatter → vortex → pile → fan out ---------- */
(function () {
  var btn = document.getElementById("shuffleBtn");
  var ring = document.getElementById("deckSpread");
  if (!btn || !ring) return;
  var running = false;

  function reduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function playShuffle() {
    if (running) return;
    var src = ring.querySelector(".deck-card");
    var plane = ring.parentElement;
    if (!src || !plane) return;
    var quick = reduced();
    var stage = document.querySelector(".table-stage");
    var cs = stage ? getComputedStyle(stage) : null;
    var W = plane.clientWidth || 640;
    var H = plane.clientHeight || 420;
    var rx = parseFloat(cs ? cs.getPropertyValue("--ring-rx") : 0) || 240;
    var ry = parseFloat(cs ? cs.getPropertyValue("--ring-ry") : 0) || 200;
    var cy = parseFloat(cs ? cs.getPropertyValue("--ring-cy") : 0) || Math.round(H * 0.5);
    var cw = src.offsetWidth;
    var ch = src.offsetHeight;
    var sc = getComputedStyle(src);
    var N = 24;

    running = true;
    ring.classList.add("is-shuffling");
    /* watchdog: if anything throws mid-way, never leave the deck hidden */
    window.setTimeout(function () {
      if (!running) return;
      ring.classList.remove("is-shuffling");
      running = false;
      var stale = ring.parentElement ? ring.parentElement.querySelector(".shuffle-layer") : null;
      if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    }, 9000);

    var layer = document.createElement("div");
    layer.className = "shuffle-layer";
    var orbit = document.createElement("div");
    orbit.className = "shuffle-orbit";
    orbit.style.left = W / 2 + "px";
    orbit.style.top = cy + "px";
    layer.appendChild(orbit);
    plane.appendChild(layer);

    /* clones start exactly where the fan's cards stand, so nothing pops */
    var live = ring.querySelectorAll(".deck-card");
    var starts = [];
    for (var j = 0; j < live.length; j++) {
      var st = live[j].style;
      if (st.visibility === "hidden" || !st.getPropertyValue("--tx")) continue;
      starts.push({
        x: parseFloat(st.getPropertyValue("--tx")) || 0,
        y: parseFloat(st.getPropertyValue("--ty")) || 0,
        rot: parseFloat(st.getPropertyValue("--rot")) || 0
      });
    }

    function scatter(i) {
      if (starts.length) return starts[Math.floor((i * starts.length) / N)];
      var a = ((i * 137) % 360) * Math.PI / 180;
      var r = W * (0.2 + ((i * 31) % 100) / 460);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.4 + 26, rot: ((i * 47) % 84) - 42 };
    }
    function pile(i) {
      var a = (i / N) * Math.PI * 2;
      return {
        x: Math.cos(a) * (3 + (i % 3) * 3),
        y: Math.sin(a) * (2 + (i % 4) * 2),
        rot: (i % 2 ? 1 : -1) * (2 + (i % 5))
      };
    }
    function arc(i) {
      var u = N > 1 ? i / (N - 1) : 0.5;
      var a = u * 180 - 90;
      var rad = a * Math.PI / 180;
      return { x: Math.sin(rad) * rx, y: -Math.cos(rad) * ry, rot: a };
    }
    function tr(p, extra) {
      return "translate(" + (p.x - cw / 2) + "px," + (p.y - ch / 2) + "px) rotate(" + p.rot + "deg)" + (extra || "");
    }

    var cards = [];
    for (var i = 0; i < N; i++) {
      var c = src.cloneNode(true);
      c.className = "deck-card shuffle-clone";
      c.removeAttribute("disabled");
      c.removeAttribute("aria-label");
      c.style.cssText =
        "position:absolute;left:0;top:0;margin:0;width:" + cw + "px;height:" + ch + "px;" +
        "transform-origin:50% 50%;border-radius:" + sc.borderRadius + ";border:" + sc.border +
        ";background:" + sc.background + ";opacity:1;";
      orbit.appendChild(c);
      c.style.transform = tr(scatter(i));
      cards.push(c);
    }

    var T1 = quick ? 210 : 460, T2 = quick ? 200 : 760, T3 = quick ? 110 : 220, T4 = quick ? 280 : 600, GAP = quick ? 3 : 8;
    var fanDelay = 18;

    cards.forEach(function (c, i) {
      var s = scatter(i);
      var p = pile(i);
      c.animate(
        [
          { transform: tr(s), opacity: 1 },
          { transform: tr({ x: s.x * 0.5, y: s.y * 0.5, rot: s.rot * 0.7 }), opacity: 1, offset: 0.55 },
          { transform: tr(p), opacity: 1 }
        ],
        { duration: T1, delay: i * GAP, easing: "cubic-bezier(.2,.72,.3,1)", fill: "forwards" }
      );
    });

    var tOrbit = T1 + 180;
    orbit.animate(
      [
        { transform: "rotate(0deg)" },
        { transform: "rotate(" + (quick ? 120 : 1080) + "deg)" }
      ],
      { duration: T2, delay: tOrbit, easing: "cubic-bezier(.5,.02,.4,1)", fill: "forwards" }
    );

    var tSettle = tOrbit + T2;
    window.setTimeout(function () {
      cards.forEach(function (c, i) {
        c.animate(
          [{ transform: tr({ x: (i % 2 ? 0.6 : -0.6), y: (i % 3) * -0.4, rot: 0 }) }],
          { duration: T3, easing: "ease-out", fill: "forwards" }
        );
      });
    }, tSettle);

    var tFan = tSettle + T3;
    window.setTimeout(function () {
      cards.forEach(function (c, i) {
        c.animate(
          [{ transform: tr(arc(i)) }],
          {
            duration: T4,
            delay: i * fanDelay,
            easing: "cubic-bezier(.16,.84,.3,1)",
            fill: "forwards"
          }
        );
      });
    }, tFan);

    var tEnd = tFan + T4 + N * fanDelay + 60;
    window.setTimeout(function () {
      layer.style.transition = "opacity .22s ease";
      layer.style.opacity = "0";
      window.setTimeout(function () {
        ring.classList.remove("is-shuffling");
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        running = false;
      }, 240);
    }, tEnd);
  }

  globalThis.addEventListener("quareia:shuffled", playShuffle);
})();
