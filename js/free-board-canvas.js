/* ==========================================================================
   自由画板 · 画布交互
   - 桌上的扇形牌堆就是牌源：双击一张牌，它落到画板上
   - 画板上的牌可自由拖动（由 free-board-ui 负责），长按按 15° 步进旋转
   - 不做缩放：画板固定 1:1
   所有动作都以自定义事件交给 app.js，避免这里持有画板模型。
   ========================================================================== */
(function () {
  "use strict";

  var viewport = document.getElementById("freeBoardViewport");
  var deck = document.getElementById("deckSpread");
  if (!viewport || !deck) return;

  var HOLD_MS = 420;        // 按住多久开始旋转
  var STEP_MS = 300;        // 之后每隔多久转一格
  var STEP_DEG = 15;        // 每格角度
  var TAP_MS = 260;

  function isFreeform() {
    var select = document.getElementById("layoutModeSelect");
    return Boolean(select && select.value === "freeform");
  }

  function boardPoint(clientX, clientY) {
    var rect = viewport.getBoundingClientRect();
    var panX = 0;
    var panY = 0;
    var world = document.getElementById("freeBoardWorld");
    if (world) {
      var match = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(world.style.transform || "");
      if (match) {
        panX = Number(match[1]) || 0;
        panY = Number(match[2]) || 0;
      }
    }
    return {
      x: clientX - (rect.left + rect.width / 2) - panX,
      y: clientY - (rect.top + rect.height / 2) - panY
    };
  }

  function requestDraw(cardId, clientX, clientY) {
    if (!cardId) return;
    globalThis.dispatchEvent(new CustomEvent("quareia:board-draw", {
      detail: { cardId: cardId, point: boardPoint(clientX, clientY) }
    }));
  }

  /* ---------- 扇形牌堆：双击取牌 ---------- */
  var lastTapAt = 0;
  var lastTapCard = null;

  deck.addEventListener("pointerup", function (event) {
    if (!isFreeform()) return;
    var card = event.target.closest && event.target.closest(".deck-card-free");
    if (!card) return;
    if (card.dataset.dragged === "1") return;
    var id = card.getAttribute("data-card-id");
    var now = Date.now();
    if (lastTapCard === id && now - lastTapAt < 420) {
      lastTapCard = null;
      lastTapAt = 0;
      requestDraw(id, event.clientX, event.clientY);
      return;
    }
    lastTapCard = id;
    lastTapAt = now;
  }, { passive: true });

  /* ---------- 画板上的牌：长按旋转 ---------- */
  var holdTimer = 0;
  var stepTimer = 0;
  var holdCard = null;
  var holdMoved = false;
  var holdStart = null;

  function stopHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
    if (stepTimer) { clearInterval(stepTimer); stepTimer = 0; }
    if (holdCard) holdCard.classList.remove("is-rotating");
    holdCard = null;
    holdMoved = false;
    holdStart = null;
  }

  function rotateStep() {
    if (!holdCard) return;
    var id = holdCard.getAttribute("data-card-id");
    if (!id) return;
    globalThis.dispatchEvent(new CustomEvent("quareia:board-rotate", {
      detail: { cardId: id, degrees: STEP_DEG }
    }));
  }

  viewport.addEventListener("pointerdown", function (event) {
    if (!isFreeform()) return;
    var card = event.target.closest && event.target.closest(".free-board-card");
    if (!card) return;
    stopHold();
    holdCard = card;
    holdMoved = false;
    holdStart = { x: event.clientX, y: event.clientY };
    var downAt = Date.now();
    holdTimer = setTimeout(function () {
      holdTimer = 0;
      if (!holdCard || holdMoved) return;
      if (Date.now() - downAt < HOLD_MS - 60) return;
      holdCard.classList.add("is-rotating");
      rotateStep();
      stepTimer = setInterval(rotateStep, STEP_MS);
    }, HOLD_MS);
  }, true);

  viewport.addEventListener("pointermove", function (event) {
    if (!holdCard || !holdStart) return;
    if (Math.hypot(event.clientX - holdStart.x, event.clientY - holdStart.y) > 8) {
      holdMoved = true;
      stopHold();
    }
  }, true);

  ["pointerup", "pointercancel", "pointerleave"].forEach(function (type) {
    viewport.addEventListener(type, function () {
      stopHold();
    }, true);
  });

  /* 长按结束后浏览器可能补一个 click，把选中态留住即可，这里不改行为 */
  void TAP_MS;
})();
