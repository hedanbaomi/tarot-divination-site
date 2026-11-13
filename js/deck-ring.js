/* Deck fan: a top-down arc of cards crowning the spread.
   Only a window of the deck is on the arc at once; dragging slides the deck
   along it, with resistance and spring-back at either end. Tap to draw. */
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
  var pageRaf = 0;
  var moveRaf = 0;
  var lastTime = 0;
  var WINDOW = 172;
  var lut = null;
  var lutKey = "";
  var ringCardW = 0;
  var EDGE_DRAG_SCALE = 0.22 * 0.28; // Combined drag and display damping of the original fan.
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

  /* 牌弧的角跨：小于 1 时两端抬起，牌弧下沿不会压到牌阵上（1 = 完整半圆） */
  var ARC_SPREAD = 0.82;
  /* 洗牌动画写在下面另一个 IIFE 里，张角只有这一个来源 */
  window.DivinationDeckArc = ARC_SPREAD;

  var geomCache = null;
  function geometry() {
    if (dragging) {
      if (geomCache) return geomCache;
    } else if (geomCache) {
      geomCache = null;
    }
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
    var cy = h - 24 - ch * cf;
    if (count === 0) {
      /* 自由模式没有牌阵：牌弧的下沿要留够空间，别压住下面那行提示 */
      var halfCard = (w < 620 ? 102 : 117) / 2 + 16;
      h = Math.max(h, Math.round(cy + halfCard));
    } else if (grid) {
      /* 有牌阵时整个弧心往上收一点：两端牌位既不压牌阵，也还留着头顶空间 */
      cy = Math.round(cy - ry * 0.22);
    }

    stage.style.setProperty("--ring-rx", rx + "px");
    stage.style.setProperty("--ring-ry", ry + "px");
    stage.style.setProperty("--ring-cy", cy + "px");
    stage.style.minHeight = h + 44 + "px";
    buildLut(rx, ry);
    /* 同一次拖动内复用测量结果；拖动结束或下次按下时作废 */
    var g = { rx: rx, ry: ry };
    if (dragging) geomCache = g;
    return g;
  }

  function layout() {
    var cards = ring.querySelectorAll(".deck-card");
    var n = cards.length;
    if (!n) return;
    var g = geometry();
    /* 牌宽跟着断点走（64px ↔ 50px）：读一次实宽，变了就更新缓存，
       否则缩窗后可见张数还是按旧牌宽算的 */
    var cw = cards[0].offsetWidth || 78;
    if (cw !== ringCardW) ringCardW = cw;
    var arcLen = (lut && lut.total) || Math.PI * ((g.rx + g.ry) / 2);
    var fit = Math.round(arcLen / (cw * 0.34));
    lastVis = Math.max(6, Math.min(40, n < fit ? n : fit));
    var vis = lastVis;
    var K = Math.max(1, Math.min(vis, n) - 1);
    var max = maxSlide();
    // A drag and its release animation may temporarily extend past the endpoints.
    if (!dragging && !raf) slide = Math.max(0, Math.min(max, slide));
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
      var a = angleAt(Math.min(1, Math.max(0, u))) * ARC_SPREAD;
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
    if (!dragging) syncFanNav();
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
      /* Ease the resisted drag back to the first or last card. */
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
    slide = Math.max(0, Math.min(max, slide + velocity * dt));
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

  /* 从牌阵里铺开的牌上按下时交给它们自己处理，不启动扇形拖动 */
  function isSpreadTarget(event) {
    return event.target.closest && event.target.closest(".spread-grid, .spread-card, .spread-slot, #spreadGrid");
  }

  function onDown(event) {
    if (isSpreadTarget(event)) return;
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest && event.target.closest(".spread-settings-btn")) return;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = null;
      lastTime = 0;
    }
    if (pageRaf) {
      window.cancelAnimationFrame(pageRaf);
      pageRaf = 0;
    }
    if (moveRaf) {
      window.cancelAnimationFrame(moveRaf);
      moveRaf = 0;
    }
    /* 每次按下都重新量几何，缓存只在这一次拖动内复用 */
    geomCache = null;
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
    var bound = Math.max(0, Math.min(max, raw));
    var next = bound + (raw - bound) * EDGE_DRAG_SCALE;
    velocity = next - slide;
    slide = next;
    /* 一帧最多重排一次：同一帧里的移动事件全部合并进这一次 rAF */
    if (moveRaf) return;
    moveRaf = window.requestAnimationFrame(function () {
      moveRaf = 0;
      layout();
    });
  }

  function onUp(event) {
    if (!dragging || event.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    stage.classList.remove("is-dragging");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (moveRaf) {
      window.cancelAnimationFrame(moveRaf);
      moveRaf = 0;
    }
    var max = maxSlide();
    if (slide < 0 || slide > max || moved > 8) {
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
      /* only clicks inside the table plane are card picks — the caption row
         (牌阵设置) and everything else must keep their own click */
      var inPlane = event.target.closest ? event.target.closest(".table-plane") : null;
      if (!inPlane) return;
      /* 牌阵里已铺开的牌（含叠放的两层）自己处理点击，别被近邻判断抢走 */
      if (isSpreadTarget(event)) return;
      /* 洗牌动画期间牌被藏起来了，但这条命中逻辑仍然会找到最近的牌并合成点击 */
      if (ring.classList.contains("is-shuffling")) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      if (event.detail !== 0 && Date.now() < suppressClickUntil) {
        event.stopPropagation();
        event.preventDefault();
        return;
      }
      var direct = event.target.closest ? event.target.closest(".deck-card") : null;
      if (direct) {
        pick(direct);
        return;
      }
      if (event.detail === 0) return;
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

  /* ---------- keyboard: the fan is not reachable by pointer only ---------- */
  /* 翻牌堆：整圈平滑滚过去，而不是瞬移 */
  function syncFanNav() {
    var max = maxSlide();
    var prev = document.getElementById("deckPrevBtn");
    var next = document.getElementById("deckNextBtn");
    if (prev) prev.disabled = slide <= 0.0005;
    if (next) next.disabled = slide >= max - 0.0005;
  }

  /* 停掉正在跑的翻页动画：Home/End 这种「直接跳」不能被上一帧的缓动拉回去 */
  function stopGlide() {
    if (pageRaf) {
      window.cancelAnimationFrame(pageRaf);
      pageRaf = 0;
    }
  }

  function pageFan(direction) {
    if (ring.classList.contains("is-shuffling")) return;
    var step = 1 / Math.max(1, visibleCount() - 1);
    var max = maxSlide();
    var from = slide;
    var to = Math.min(max, Math.max(0, slide + direction * step));
    velocity = 0;
    stopGlide();
    /* 已经在尽头：按钮是灰的，按下去什么都不发生（也不再回弹） */
    if (Math.abs(to - from) < 0.0009) {
      slide = from;
      layout();
      syncFanNav();
      return;
    }
    var start = 0;
    var dur = 320;
    (function glide(now) {
      if (!start) start = now;
      var p = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      slide = from + (to - from) * e;
      layout();
      if (p < 1) {
        pageRaf = window.requestAnimationFrame(glide);
      } else {
        slide = to;
        layout();
        pageRaf = 0;
        syncFanNav();
      }
    })(performance.now());
  }

  function drawCenteredCard() {
    var cards = ring.querySelectorAll(".deck-card");
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (card.style.visibility === "hidden") continue;
      var rect = card.getBoundingClientRect();
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var stageRect = stage.getBoundingClientRect();
      var dist = Math.abs(cx - (stageRect.left + stageRect.width / 2)) +
        Math.abs(cy - (stageRect.top + stageRect.height / 2)) * 0.4;
      if (dist < bestDist) { bestDist = dist; best = card; }
    }
    if (best) best.click();
  }

  var prevBtn = document.getElementById("deckPrevBtn");
  var nextBtn = document.getElementById("deckNextBtn");
  if (prevBtn) prevBtn.addEventListener("click", function () { pageFan(-1); });
  if (nextBtn) nextBtn.addEventListener("click", function () { pageFan(1); });

  stage.addEventListener("keydown", function (event) {
    var target = event.target;
    if (target !== stage && !ring.contains(target) && target !== prevBtn && target !== nextBtn) return;
    if (event.key === "ArrowLeft") { pageFan(-1); event.preventDefault(); }
    else if (event.key === "ArrowRight") { pageFan(1); event.preventDefault(); }
    else if (event.key === "Home") { stopGlide(); slide = 0; velocity = 0; layout(); event.preventDefault(); }
    else if (event.key === "End") { stopGlide(); slide = maxSlide(); velocity = 0; layout(); event.preventDefault(); }
    else if (event.key === "Enter") {
      /* 只有焦点在牌桌本身时才由这里抽牌；焦点在子按钮上（牌阵设置、箭头…）
         时把 Enter 交给那个按钮自己处理，不再顺带抽一张 */
      if (event.target !== stage) return;
      drawCenteredCard();
      event.preventDefault();
    }
  });

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
  /* 与上面的扇形同一个张角：那个变量在本 IIFE 作用域外，读共享值 */
  var ARC_SPREAD = window.DivinationDeckArc || 0.82;
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

    function arc(i) {
      var u = N > 1 ? i / (N - 1) : 0.5;
      var a = (u * 180 - 90) * ARC_SPREAD;
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

    /* 节奏：摊开的牌收成两摞 → 交错互插成一摞 → 压一下 → 重新摊开。
       （原来是绕圈转 1080°，看着像转盘，不像洗牌。） */
    var D1 = quick ? 380 : 900;      /* 收两摞、互插、合一 */
    var D2 = quick ? 280 : 520;      /* 重新摊开 */
    var fanGap = quick ? 5 : 12;
    var tSettle = D1 + 30;
    var tSettleDur = quick ? 90 : 160;
    var tFan = tSettle + tSettleDur;

    /* 整段动作抬到扇形自己的高度上：收起的牌摞落在弧心，而不是压在牌阵上 */
    var LIFT = -Math.round(ry * 0.55);

    function halfPoint(i) {
      var side = i % 2 ? 1 : -1;
      return {
        x: side * cw * 1.22 + (i % 3) * 1.5,
        y: LIFT - 6 + (i % 6) * 2.4,
        rot: side * 8 + ((i % 5) - 2) * 1.3
      };
    }
    function crossPoint(i) {
      var side = i % 2 ? 1 : -1;
      return {
        x: side * cw * 0.42,
        y: LIFT + side * ch * 0.05 + (i % 4) * 3,
        rot: side * -4
      };
    }
    function pile(i) {
      var a = (i / N) * Math.PI * 2;
      return {
        x: Math.cos(a) * (8 + (i % 4) * 4),
        y: LIFT + Math.sin(a) * (4 + (i % 3) * 2) - (i % 5) * 1.4,
        rot: ((i % 7) - 3) * 1.5
      };
    }

    cards.forEach(function (c, i) {
      var s = scatter(i);
      var half = halfPoint(i);
      var cross = crossPoint(i);
      var p = pile(i);
      var oCross = 0.58 + (i % 5) * 0.026;
      c.animate(
        [
          { transform: tr(s), offset: 0, easing: "cubic-bezier(.36,.66,.32,1)" },
          { transform: tr(half), offset: 0.3, easing: "cubic-bezier(.5,.1,.35,1)" },
          { transform: tr(cross), offset: oCross, easing: "cubic-bezier(.3,.8,.3,1)" },
          { transform: tr(p), offset: 0.9 },
          { transform: tr(p), offset: 1 }
        ],
        { duration: D1, fill: "forwards" }
      );
    });

    /* 合成一摞时轻轻压一下，给"整好了"一个手感 */
    orbit.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1)", offset: 0.82 },
        { transform: "scale(0.94)", offset: 0.92, easing: "cubic-bezier(.3,.8,.3,1)" },
        { transform: "scale(1)" }
      ],
      { duration: D1 + tSettleDur, delay: 30, fill: "forwards" }
    );

    window.setTimeout(function () {
      cards.forEach(function (c, i) {
        c.animate(
          [
            { transform: tr(pile(i)) },
            { transform: tr({ x: pile(i).x * 0.45, y: pile(i).y * 0.6, rot: pile(i).rot * 0.5 }), offset: 0.22 },
            { transform: tr(arc(i)) }
          ],
          {
            duration: D2,
            delay: i * fanGap,
            easing: "cubic-bezier(.2,.86,.3,1)",
            fill: "forwards"
          }
        );
      });
    }, tFan);

    var tEnd = tFan + D2 + N * fanGap + 40;
    window.setTimeout(function () {
      layer.style.transition = "opacity .18s ease";
      layer.style.opacity = "0";
      window.setTimeout(function () {
        ring.classList.remove("is-shuffling");
        if (layer.parentNode) layer.parentNode.removeChild(layer);
        running = false;
      }, 200);
    }, tEnd);
  }
  globalThis.addEventListener("quareia:shuffled", playShuffle);
})();
