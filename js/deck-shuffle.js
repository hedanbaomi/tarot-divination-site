/* Shared riffle animation for the modern fan and the two classic card rows. */
(function () {
  "use strict";

  function createVisual(ring, horizontal, eventName) {
    var ARC_SPREAD = window.DivinationDeckArc || 0.82;
    var CLONES = 24;
    var running = false;       /* overlay 在跑 */
    var holding = false;       /* 手指还按着：一轮接一轮地 riffle */
    var finishPending = false; /* 已经确认收牌：这一轮 riffle 结束就摊开 */
    var session = null;

    function reduced() {
      return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    }

    /* 单次洗牌（键盘、重新洗牌按钮、无障碍点击）：wash 一轮，然后摊开 */
    function playShuffle() {
      if (running) return;
      if (begin()) finish();
    }

    /* 摊开的牌收成两摞 → 交错互插成一摞 → 压一下。
       （原来是绕圈转 1080°，看着像转盘，不像洗牌。） */
    function halfPoint(s, i) {
      var side = i % 2 ? 1 : -1;
      return {
        x: side * s.cw * 1.22 + (i % 3) * 1.5,
        y: s.lift - 6 + (i % 6) * 2.4,
        rot: side * 8 + ((i % 5) - 2) * 1.3
      };
    }
    /* A tabletop riffle for the classic row. The inner edges tilt up, then
       adjacent left/right leaves land in sequence and square into one pack. */
    function rowFrames(s, i, start) {
      var side = i % 2 ? 1 : -1;
      var depth = i / s.N;
      var split = { x: side * Math.min(s.W * 0.25, s.cw * 1.28), y: 3 - depth * 5, rot: side * 7 };
      var tipped = { x: side * s.cw * 0.59, y: -4 - depth * 4, rot: -side * 10 };
      var tucked = { x: side * s.cw * 0.12, y: 1 - depth * 4, rot: -side * 2 };
      var drop = 0.49 + depth * 0.23;
      var pile = tr(s, pilePoint(s, i));
      return [
        { transform: tr(s, start), offset: 0 },
        { transform: tr(s, split), offset: 0.28, easing: "ease-in-out" },
        { transform: tr(s, tipped), offset: drop, easing: "ease-out" },
        { transform: tr(s, tucked), offset: drop + 0.12 },
        { transform: pile, offset: 0.94 },
        { transform: pile, offset: 1 }
      ];
    }

    function crossPoint(s, i) {
      var side = i % 2 ? 1 : -1;
      return {
        x: side * s.cw * 0.42,
        y: s.lift + side * s.ch * 0.05 + (i % 4) * 3,
        rot: side * -4
      };
    }
    function pilePoint(s, i) {
      if (horizontal) {
        var depth = i / s.N;
        return { x: (depth - 0.5) * 5, y: 3 - depth * 5, rot: (depth - 0.5) * 2 };
      }
      var a = (i / s.N) * Math.PI * 2;
      return {
        x: Math.cos(a) * (8 + (i % 4) * 4),
        y: s.lift + Math.sin(a) * (4 + (i % 3) * 2) - (i % 5) * 1.4,
        rot: ((i % 7) - 3) * 1.5
      };
    }
    /* 牌序：把攒起的一摞摊回扇形 */
    function arcPoint(s, i) {
      if (horizontal) return scatter(s, i);
      var u = s.N > 1 ? i / (s.N - 1) : 0.5;
      var a = (u * 180 - 90) * ARC_SPREAD;
      var rad = a * Math.PI / 180;
      return { x: Math.sin(rad) * s.rx, y: -Math.cos(rad) * s.ry, rot: a };
    }
    function tr(s, p, extra) {
      return "translate(" + (p.x - s.cw / 2) + "px," + (p.y - s.ch / 2) + "px) rotate(" + p.rot + "deg)" + (extra || "");
    }

    function measure() {
      var selector = horizontal && ring.id === "freeBoardPile" ? ".free-board-pile-card" : ".deck-card";
      var src = ring.querySelector(selector);
      var plane = ring.parentElement;
      if (!src || !plane) return null;
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

      /* 克隆从扇形上牌的实时位置出发，接上时不会跳 */
      var live = ring.querySelectorAll(selector);
      var starts = [];
      var planeRect = horizontal ? plane.getBoundingClientRect() : null;
      for (var j = 0; j < live.length; j++) {
        if (horizontal) {
          var cardRect = live[j].getBoundingClientRect();
          if (cardRect.right > planeRect.left && cardRect.left < planeRect.right) {
            starts.push({ x: cardRect.left + cw / 2 - planeRect.left - W / 2,
              y: cardRect.top + ch / 2 - planeRect.top - cy, rot: 0 });
          }
          continue;
        }
        var st = live[j].style;
        if (st.visibility === "hidden" || !st.getPropertyValue("--tx")) continue;
        starts.push({
          x: parseFloat(st.getPropertyValue("--tx")) || 0,
          y: parseFloat(st.getPropertyValue("--ty")) || 0,
          rot: parseFloat(st.getPropertyValue("--rot")) || 0
        });
      }

      return {
        src: src,
        plane: plane,
        quick: reduced() || typeof src.animate !== "function",
        W: W,
        H: H,
        rx: rx,
        ry: ry,
        cy: cy,
        cw: cw,
        ch: ch,
        sc: sc,
        N: Math.min(CLONES, live.length),
        starts: starts,
        /* 整段动作抬到扇形自己的高度上：收起的牌摞落在弧心，而不是压在牌阵上 */
        lift: horizontal ? 0 : -Math.round(ry * 0.55),
        layer: null,
        orbit: null,
        cards: [],
        timers: [],
        wasInert: ring.inert,
        idle: false,
        fanning: false
      };
    }

    function scatter(s, i) {
      if (s.starts.length) return s.starts[Math.floor((i * s.starts.length) / s.N)];
      var a = ((i * 137) % 360) * Math.PI / 180;
      var r = s.W * (0.2 + ((i * 31) % 100) / 460);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.4 + 26, rot: ((i * 47) % 84) - 42 };
    }

    function later(s, fn, ms) {
      var id = window.setTimeout(function () {
        var at = s.timers.indexOf(id);
        if (at !== -1) s.timers.splice(at, 1);
        if (session !== s) return;
        try { fn(); } catch (error) { cleanup(s); throw error; }
      }, ms);
      s.timers.push(id);
      return id;
    }

    function build() {
      var s = measure();
      if (!s) return null;
      var layer = document.createElement("div");
      layer.className = "shuffle-layer";
      var orbit = document.createElement("div");
      orbit.className = "shuffle-orbit";
      orbit.style.left = s.W / 2 + "px";
      orbit.style.top = s.cy + "px";
      layer.appendChild(orbit);
      layer.inert = true;
      layer.setAttribute("aria-hidden", "true");
      s.layer = layer;
      s.orbit = orbit;

      for (var i = 0; i < s.N; i++) {
        var c = s.src.cloneNode(true);
        c.classList.add("shuffle-clone");
        c.removeAttribute("id");
        c.tabIndex = -1;
        c.removeAttribute("disabled");
        c.removeAttribute("aria-label");
        c.style.cssText =
          "position:absolute;left:0;top:0;margin:0;width:" + s.cw + "px;height:" + s.ch + "px;" +
          "transform-origin:50% 50%;border-radius:" + s.sc.borderRadius + ";border:" + s.sc.border +
          ";background:" + s.sc.background + ";opacity:1;";
        orbit.appendChild(c);
        c.style.transform = tr(s, scatter(s, i));
        s.cards.push(c);
      }
      s.plane.appendChild(layer);
      return s;
    }

    /* 一轮 riffle：从摊开（或上一摞）收拢、互插、落成一摞 */
    function cycle(s, fromScatter) {
      if (!running || s.fanning) return;
      s.idle = false;
      if (s.quick) {
        s.cards.forEach(function (card, i) { card.style.transform = tr(s, pilePoint(s, i)); });
        s.idle = true;
        return;
      }
      var D = fromScatter ? 900 : (horizontal ? 840 : 620);
      var tail = fromScatter ? 160 : 120;
      var press = fromScatter ? 0.94 : 0.97;

      s.cards.forEach(function (c, i) {
        var p = pilePoint(s, i);
        if (horizontal) {
          c.animate(rowFrames(s, i, fromScatter ? scatter(s, i) : p), { duration: D, fill: "forwards" });
          return;
        }
        var crossAt = 0.58 + (i % 5) * 0.026;
        var frames = fromScatter ? [
          { transform: tr(s, scatter(s, i)), offset: 0, easing: "cubic-bezier(.36,.66,.32,1)" },
          { transform: tr(s, halfPoint(s, i)), offset: 0.3, easing: "cubic-bezier(.5,.1,.35,1)" },
          { transform: tr(s, crossPoint(s, i)), offset: crossAt, easing: "cubic-bezier(.3,.8,.3,1)" },
          { transform: tr(s, p), offset: 0.9 },
          { transform: tr(s, p), offset: 1 }
        ] : [
          { transform: tr(s, p), offset: 0 },
          { transform: tr(s, halfPoint(s, i)), offset: 0.32, easing: "cubic-bezier(.4,.1,.3,1)" },
          { transform: tr(s, crossPoint(s, i)), offset: 0.64, easing: "cubic-bezier(.3,.8,.3,1)" },
          { transform: tr(s, p), offset: 1, easing: "cubic-bezier(.3,.8,.3,1)" }
        ];
        c.animate(frames, { duration: D, fill: "forwards" });
      });

      /* 合成一摞时轻轻压一下，给"整好了"一个手感 */
      s.orbit.animate(
        [
          { transform: "scale(1)" },
          { transform: "scale(1)", offset: 0.8 },
          { transform: "scale(" + press + ")", offset: 0.92, easing: "cubic-bezier(.3,.8,.3,1)" },
          { transform: "scale(1)" }
        ],
        { duration: D + tail, fill: "forwards" }
      );

      later(s, function () { afterCycle(s); }, D + tail);
    }

    function afterCycle(s) {
      if (!running || session !== s) return;
      if (finishPending) { fanOut(s); return; }
      if (holding) { cycle(s, false); return; }
      /* 松手了，但确认框还没答：停在牌摞上等 finish / cancel */
      s.idle = true;
    }

    function fanOut(s) {
      if (!running || s.fanning) return;
      s.fanning = true;
      s.idle = false;
      if (s.quick) {
        later(s, function () { cleanup(s); }, 120);
        return;
      }
      var D2 = 520;
      var gap = 12;
      s.cards.forEach(function (c, i) {
        var p = pilePoint(s, i);
        c.animate(
          [
            { transform: tr(s, p) },
            { transform: tr(s, { x: p.x * 0.45, y: p.y * 0.6, rot: p.rot * 0.5 }), offset: 0.22 },
            { transform: tr(s, arcPoint(s, i)) }
          ],
          { duration: D2, delay: i * gap, easing: "cubic-bezier(.2,.86,.3,1)", fill: "forwards" }
        );
      });
      later(s, function () {
        s.layer.style.transition = "opacity .18s ease";
        s.layer.style.opacity = "0";
        later(s, function () { cleanup(s); }, 200);
      }, D2 + s.N * gap + 40);
    }

    function cleanup(s) {
      if (!s) return;
      s.timers.slice().forEach(function (id) { window.clearTimeout(id); });
      s.timers.length = 0;
      ring.inert = s.wasInert;
      ring.classList.remove("is-shuffling");
      if (s.layer && s.layer.parentNode) s.layer.parentNode.removeChild(s.layer);
      if (session === s) session = null;
      running = false;
      holding = false;
      finishPending = false;
    }

    function begin() {
      if (running) {
        if (finishPending || session.fanning) return false;
        holding = true;
        if (session.idle) cycle(session, false);
        return true;
      }
      var s = build();
      if (!s) return false;
      session = s;
      running = true;
      holding = true;
      finishPending = false;
      ring.classList.add("is-shuffling");

      ring.inert = true;
      try { cycle(s, true); } catch (error) { cleanup(s); throw error; }
      return true;
    }

    /* 手指松开：这一轮 riffle 做完就停在牌摞上，等确认结果 */
    function release() {
      if (!running) return;
      holding = false;
    }

    /* 收牌摊开（新牌序已经由 app 侧 resetDeck 摆好） */
    function finish() {
      if (!running) return;
      holding = false;
      finishPending = true;
      if (session && session.idle) fanOut(session);
    }

    function cancel() {
      if (session) cleanup(session);
    }

    window.addEventListener(eventName, playShuffle);
    return {
      begin: begin,
      release: release,
      finish: finish,
      cancel: cancel,
      isRunning: function () { return running; },
      isHolding: function () { return holding; }
    };
  }

  var deck = document.getElementById("deckSpread");
  if (deck) window.DivinationShuffle = createVisual(deck, !deck.classList.contains("deck-ring"), "quareia:shuffled");
  var board = document.getElementById("freeBoardPile");
  if (board) window.DivinationFreeBoardShuffle = createVisual(board, true, "quareia:board-shuffle");
})();
