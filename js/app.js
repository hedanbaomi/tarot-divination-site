(function () {
  "use strict";

  var mode = "upright-only";
  var arcanaFilter = "mixed";
  var currentPhase = "major";
  var currentDeck = [];
  var spreadCards = {};
  var revealedCards = {};
  var cardDrawnIds = {};
  var activatedCardId = null;
  var draggedCardId = null;

  var nextCanvasX = 14;
  var nextCanvasY = 14;
  var canvasCardDragging = null;
  var canvasDragStartX = 0;
  var canvasDragStartY = 0;
  var canvasDragOrigX = 0;
  var canvasDragOrigY = 0;

  var boardPanning = false;
  var boardPanStartX = 0;
  var boardPanStartY = 0;
  var boardPanScrollX = 0;
  var boardPanScrollY = 0;

  var deckPanning = false;
  var deckPanStartX = 0;
  var deckPanStartY = 0;
  var deckPanScrollX = 0;
  var deckPanMoved = false;
  var suppressDeckClick = false;
  var deckTouchPendingCardId = null;
  var deckTouchLongPressTimer = null;
  var deckTouchCardDragging = null;
  var deckTouchCardMoved = false;
  var deckTouchPointerId = null;
  var deckTouchStartX = 0;
  var deckTouchStartY = 0;
  var deckTouchLastX = 0;
  var deckTouchLastY = 0;
  var deckTouchGhost = null;

  var elements = {};

  function cacheElements() {
    elements.modeSelect = document.getElementById("modeSelect");
    elements.arcanaFilter = document.getElementById("arcanaFilter");
    elements.switchArcanaBtn = document.getElementById("switchArcanaBtn");
    elements.shuffleBtn = document.getElementById("shuffleBtn");
    elements.clearSpreadBtn = document.getElementById("clearSpreadBtn");
    elements.revealBtn = document.getElementById("revealBtn");
    elements.openAllBtn = document.getElementById("openAllBtn");
    elements.spreadBoard = document.getElementById("spreadBoard");
    elements.spreadPosCount = document.getElementById("spreadPosCount");
    elements.phaseLabel = document.getElementById("phaseLabel");
    elements.deckFan = document.getElementById("deckFan");
    elements.deckTitle = document.getElementById("deckTitle");
    elements.resultsSection = document.getElementById("resultsSection");
    elements.resultsList = document.getElementById("resultsList");
  }

  function shuffleDeck(deck) {
    var result = deck.slice();
    for (var i = result.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = result[i];
      result[i] = result[j];
      result[j] = temp;
    }
    return result;
  }

  function applyOrientation(deck, currentMode) {
    return deck.map(function (card) {
      var orientation = currentMode === "upright-only" ? "upright" :
        (Math.random() > 0.5 ? "upright" : "reversed");
      return Object.assign({}, card, { orientation: orientation });
    });
  }

  function resetDeck() {
    currentPhase = "major";
    var filtered = getDeckByArcanaFilter(arcanaFilter, currentPhase);
    currentDeck = applyOrientation(shuffleDeck(filtered), mode);
    spreadCards = {};
    revealedCards = {};
    cardDrawnIds = {};
    activatedCardId = null;
    nextCanvasX = 14;
    nextCanvasY = 14;
    elements.deckFan.scrollLeft = 0;
    renderAll();
    checkRevealReady();
  }

  function switchArcanaPhase() {
    currentPhase = currentPhase === "major" ? "minor" : "major";
    var filtered = getDeckByArcanaFilter(arcanaFilter, currentPhase);
    currentDeck = applyOrientation(shuffleDeck(filtered), mode);
    activatedCardId = null;
    elements.deckFan.scrollLeft = 0;
    renderAll();
  }

  function getOrientationLabel(orientation) {
    return orientation === "upright" ? "正位" : "逆位";
  }

  function getOrientationClass(orientation) {
    return orientation === "upright" ? "upright" : "reversed";
  }

  function findCardById(cardId) {
    for (var i = 0; i < currentDeck.length; i++) {
      if (currentDeck[i].id === cardId) return currentDeck[i];
    }
    return null;
  }

  function getSmartCanvasPosition() {
    var x = nextCanvasX;
    var y = nextCanvasY;
    nextCanvasX += 66;
    if (nextCanvasX > 580) {
      nextCanvasX = 14;
      nextCanvasY += 96;
    }
    return { x: x, y: y };
  }

  function placeCardOnSpread(cardId, x, y) {
    var card = findCardById(cardId);
    if (!card || cardDrawnIds[cardId]) return;
    cardDrawnIds[cardId] = true;
    spreadCards[cardId] = { x: Math.max(0, x), y: Math.max(0, y) };
    activatedCardId = null;
    renderAll();
    checkRevealReady();
  }

  function removeCardFromSpread(cardId) {
    delete spreadCards[cardId];
    delete revealedCards[cardId];
    delete cardDrawnIds[cardId];
    renderAll();
    checkRevealReady();
  }

  function moveCardOnCanvas(cardId, x, y) {
    if (!spreadCards[cardId]) return;
    spreadCards[cardId].x = Math.max(0, x);
    spreadCards[cardId].y = Math.max(0, y);
    var el = elements.spreadBoard.querySelector('.canvas-card[data-card-id="' + cardId + '"]');
    if (el) {
      el.style.left = spreadCards[cardId].x + "px";
      el.style.top = spreadCards[cardId].y + "px";
    }
  }

  function isPointInsideBoard(clientX, clientY) {
    var rect = elements.spreadBoard.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom;
  }

  function getBoardDropPosition(clientX, clientY) {
    var board = elements.spreadBoard;
    var rect = board.getBoundingClientRect();
    return {
      x: clientX - rect.left + board.scrollLeft - 29,
      y: clientY - rect.top + board.scrollTop - 43
    };
  }

  function createDeckTouchGhost(cardId, clientX, clientY) {
    var source = elements.deckFan.querySelector('.fan-card[data-card-id="' + cardId + '"]');
    if (!source) return;
    var rect = source.getBoundingClientRect();
    deckTouchGhost = source.cloneNode(false);
    deckTouchGhost.className = "fan-card deck-drag-ghost activated";
    deckTouchGhost.style.width = rect.width + "px";
    deckTouchGhost.style.height = rect.height + "px";
    deckTouchGhost.style.left = (clientX - rect.width / 2) + "px";
    deckTouchGhost.style.top = (clientY - rect.height / 2) + "px";
    document.body.appendChild(deckTouchGhost);
  }

  function moveDeckTouchGhost(clientX, clientY) {
    if (!deckTouchGhost) return;
    deckTouchGhost.style.left = (clientX - deckTouchGhost.offsetWidth / 2) + "px";
    deckTouchGhost.style.top = (clientY - deckTouchGhost.offsetHeight / 2) + "px";
    elements.spreadBoard.classList.toggle("drag-over-board", isPointInsideBoard(clientX, clientY));
  }

  function cleanupDeckTouchDrag() {
    if (deckTouchLongPressTimer) {
      clearTimeout(deckTouchLongPressTimer);
      deckTouchLongPressTimer = null;
    }
    deckTouchPendingCardId = null;
    if (deckTouchGhost) {
      deckTouchGhost.remove();
      deckTouchGhost = null;
    }
    elements.spreadBoard.classList.remove("drag-over-board");
    deckTouchCardDragging = null;
    deckTouchCardMoved = false;
    deckTouchPointerId = null;
  }

  function cancelDeckTouchPending() {
    if (deckTouchLongPressTimer) {
      clearTimeout(deckTouchLongPressTimer);
      deckTouchLongPressTimer = null;
    }
    deckTouchPendingCardId = null;
  }

  function startDeckTouchDrag(cardId, clientX, clientY) {
    if (!cardId || cardDrawnIds[cardId]) return;
    deckTouchLongPressTimer = null;
    deckTouchPendingCardId = null;
    deckPanning = false;
    elements.deckFan.classList.remove("panning");
    activatedCardId = cardId;
    suppressDeckClick = true;
    deckTouchCardDragging = cardId;
    deckTouchCardMoved = true;
    deckTouchLastX = clientX;
    deckTouchLastY = clientY;
    renderDeckFan();
    createDeckTouchGhost(cardId, clientX, clientY);
    moveDeckTouchGhost(clientX, clientY);
  }

  function activateCard(cardId) {
    if (cardDrawnIds[cardId]) return;
    if (activatedCardId === cardId) {
      var pos = getSmartCanvasPosition();
      placeCardOnSpread(cardId, pos.x, pos.y);
      return;
    }
    activatedCardId = cardId;
    renderAll();
  }

  function deactivateAll() {
    if (activatedCardId !== null) {
      activatedCardId = null;
      renderAll();
    }
  }

  function renderDeckFan() {
    var fan = elements.deckFan;
    var previousScroll = fan.scrollLeft;
    fan.innerHTML = "";

    var maxFanAngle = 16;
    var rowCards = currentDeck;
    var rowEl = document.createElement("div");
    rowEl.className = "deck-fan-row";

    rowCards.forEach(function (card, idx) {
      var cardEl = document.createElement("div");
      cardEl.className = "fan-card";
      cardEl.setAttribute("data-card-id", card.id);
      cardEl.setAttribute("title", cardDrawnIds[card.id] ? "已抽出" : "点击选择：" + card.name);

      var isActivated = activatedCardId === card.id;
      var isPlaced = !!cardDrawnIds[card.id];
      cardEl.draggable = isActivated && !isPlaced;

      var total = rowCards.length;
      var angle = total <= 1 ? 0 : (idx / (total - 1) - 0.5) * maxFanAngle * 2;
      cardEl.style.setProperty("--fan-angle", angle.toFixed(1) + "deg");

      if (isPlaced) {
        cardEl.classList.add("placed");
      } else if (isActivated) {
        cardEl.classList.add("activated");
      }

      if (!isPlaced) {
        cardEl.addEventListener("click", function (e) {
          e.stopPropagation();
          if (suppressDeckClick) return;
          activateCard(card.id);
        });
      }

      if (isActivated && !isPlaced) {
        cardEl.addEventListener("dragstart", function (e) {
          draggedCardId = card.id;
          cardEl.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", card.id);
          setTimeout(function () { cardEl.classList.remove("dragging"); }, 0);
        });
        cardEl.addEventListener("dragend", function () {
          cardEl.classList.remove("dragging");
          draggedCardId = null;
        });
      }

      rowEl.appendChild(cardEl);
    });

    fan.appendChild(rowEl);
    fan.scrollLeft = previousScroll;

    var totalCards = currentDeck.length;
    var arcanaLabel;
    if (arcanaFilter === "major-only") arcanaLabel = "大阿卡那";
    else if (arcanaFilter === "minor-only") arcanaLabel = "小阿卡那";
    else if (isPhaseFilter(arcanaFilter)) arcanaLabel = getPhaseArcanaLabel(arcanaFilter, currentPhase);
    else arcanaLabel = "全部";
    elements.deckTitle.textContent = "牌组（" + arcanaLabel + " · " + totalCards + "张）";
  }

  function renderSpreadBoard() {
    var board = elements.spreadBoard;
    board.innerHTML = "";

    var placedIds = Object.keys(spreadCards);
    if (placedIds.length === 0) {
      var ph = document.createElement("p");
      ph.className = "spread-placeholder";
      ph.textContent = "从下方牌组选择一张牌放到这里";
      board.appendChild(ph);
    }

    placedIds.forEach(function (cardId) {
      var pos = spreadCards[cardId];
      var card = findCardById(cardId);
      if (!card) return;

      var el = document.createElement("div");
      el.className = "canvas-card";
      el.setAttribute("data-card-id", cardId);
      el.style.left = pos.x + "px";
      el.style.top = pos.y + "px";

      if (revealedCards[cardId]) {
        el.classList.add("face-up");
        var nameEl = document.createElement("span");
        nameEl.className = "card-name-mini";
        nameEl.textContent = card.name;
        var oriEl = document.createElement("span");
        oriEl.className = "card-ori-mini " + getOrientationClass(card.orientation);
        oriEl.textContent = getOrientationLabel(card.orientation);
        el.appendChild(nameEl);
        el.appendChild(oriEl);
      } else {
        el.classList.add("face-down");
      }

      var removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", "移除 " + card.name);
      removeBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        removeCardFromSpread(cardId);
      });
      el.appendChild(removeBtn);

      el.addEventListener("mousedown", function (e) {
        if (e.target === removeBtn || e.target.closest(".remove-btn")) return;
        e.preventDefault();
        canvasCardDragging = cardId;
        canvasDragStartX = e.clientX;
        canvasDragStartY = e.clientY;
        canvasDragOrigX = pos.x;
        canvasDragOrigY = pos.y;
        el.style.zIndex = "200";
        el.style.transition = "none";
        el.style.cursor = "grabbing";
      });

      board.appendChild(el);
    });
  }

  function renderResults() {
    var section = elements.resultsSection;
    var list = elements.resultsList;
    var revealedCount = Object.keys(revealedCards).length;

    if (revealedCount === 0) {
      section.style.display = "none";
      return;
    }
    section.style.display = "block";
    elements.openAllBtn.style.display = revealedCount === Object.keys(spreadCards).length ? "none" : "block";

    list.innerHTML = "";
    Object.keys(spreadCards).forEach(function (cardId, index) {
      if (!revealedCards[cardId]) return;
      var card = findCardById(cardId);
      if (!card) return;

      var isUpright = card.orientation === "upright";
      var showReversed = mode === "mixed" && !isUpright;
      var keywords = showReversed ? card.reversedKeywords : card.uprightKeywords;
      var meaning = showReversed ? card.reversedMeaning : card.uprightMeaning;

      var resultCard = document.createElement("div");
      resultCard.className = "result-card";

      var header = document.createElement("div");
      header.className = "result-header";

      var posEl = document.createElement("span");
      posEl.className = "result-pos";
      posEl.textContent = "位置 " + (index + 1);

      var nameEl = document.createElement("span");
      nameEl.className = "result-name";
      nameEl.textContent = card.name;

      var orientEl = document.createElement("span");
      orientEl.className = "result-orientation " + getOrientationClass(card.orientation);
      orientEl.textContent = getOrientationLabel(card.orientation);

      header.appendChild(posEl);
      header.appendChild(nameEl);
      header.appendChild(orientEl);

      if (card.suit) {
        var suitEl = document.createElement("span");
        suitEl.className = "result-suit";
        suitEl.textContent = card.suit + " · " + card.element + " · " + card.direction;
        header.appendChild(suitEl);
      }

      var keywordsEl = document.createElement("div");
      keywordsEl.className = "result-keywords";
      keywords.forEach(function (kw) {
        var tag = document.createElement("span");
        tag.className = "keyword-tag";
        tag.textContent = kw;
        keywordsEl.appendChild(tag);
      });

      var meaningEl = document.createElement("div");
      meaningEl.className = "result-meaning";
      meaningEl.textContent = meaning;

      var sourceEl = document.createElement("div");
      sourceEl.className = "result-source";
      sourceEl.textContent = card.source || quareiaSource;

      resultCard.appendChild(header);
      resultCard.appendChild(keywordsEl);
      resultCard.appendChild(meaningEl);
      resultCard.appendChild(sourceEl);
      list.appendChild(resultCard);
    });
  }

  function renderAll() {
    updateStatusBar();
    updateArcanaSwitchBtn();
    renderSpreadBoard();
    renderResults();
    renderDeckFan();
  }

  function updateStatusBar() {
    var placedCount = Object.keys(spreadCards).length;
    elements.spreadPosCount.textContent = placedCount;

    if (isPhaseFilter(arcanaFilter)) {
      elements.phaseLabel.style.display = "inline";
      elements.phaseLabel.textContent = "当前阶段：" + getPhaseArcanaLabel(arcanaFilter, currentPhase);
    } else {
      elements.phaseLabel.style.display = "none";
    }
  }

  function updateArcanaSwitchBtn() {
    if (isPhaseFilter(arcanaFilter)) {
      elements.switchArcanaBtn.style.display = "inline-block";
      elements.switchArcanaBtn.textContent = getOtherPhaseLabel(arcanaFilter, currentPhase);
    } else {
      elements.switchArcanaBtn.style.display = "none";
    }
  }

  function checkRevealReady() {
    elements.revealBtn.style.display = Object.keys(spreadCards).length > 0 ? "inline-block" : "none";
  }

  function revealAllCards() {
    Object.keys(spreadCards).forEach(function (cardId) {
      revealedCards[cardId] = true;
    });
    renderAll();
  }

  function handleModeChange() {
    var newMode = elements.modeSelect.value;
    if (newMode !== mode) {
      if (Object.keys(spreadCards).length > 0) {
        var confirmed = confirm("切换模式会清空已选牌并重新洗牌，是否继续？");
        if (!confirmed) {
          elements.modeSelect.value = mode;
          return;
        }
      }
      mode = newMode;
      resetDeck();
    }
  }

  function handleArcanaFilterChange() {
    var newFilter = elements.arcanaFilter.value;
    if (newFilter !== arcanaFilter) {
      if (Object.keys(spreadCards).length > 0) {
        var confirmed = confirm("切换牌组筛选会清空已选和已摆放的牌，是否继续？");
        if (!confirmed) {
          elements.arcanaFilter.value = arcanaFilter;
          return;
        }
      }
      arcanaFilter = newFilter;
      currentPhase = "major";
      resetDeck();
    }
  }

  function handleClearSpread() {
    spreadCards = {};
    revealedCards = {};
    cardDrawnIds = {};
    activatedCardId = null;
    nextCanvasX = 14;
    nextCanvasY = 14;
    renderAll();
    checkRevealReady();
  }

  function setupBoardHandlers() {
    var board = elements.spreadBoard;

    board.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      board.classList.add("drag-over-board");
    });

    board.addEventListener("dragleave", function (e) {
      if (!board.contains(e.relatedTarget)) {
        board.classList.remove("drag-over-board");
      }
    });

    board.addEventListener("drop", function (e) {
      e.preventDefault();
      board.classList.remove("drag-over-board");
      var cardId = e.dataTransfer.getData("text/plain") || draggedCardId;
      if (!cardId) return;

      var pos = getBoardDropPosition(e.clientX, e.clientY);
      placeCardOnSpread(cardId, pos.x, pos.y);
      draggedCardId = null;
    });

    board.addEventListener("mousedown", function (e) {
      if (e.target.closest(".canvas-card")) return;
      e.preventDefault();
      boardPanning = true;
      boardPanStartX = e.clientX;
      boardPanStartY = e.clientY;
      boardPanScrollX = board.scrollLeft;
      boardPanScrollY = board.scrollTop;
      board.classList.add("panning");
    });

    board.addEventListener("touchstart", function (e) {
      if (e.target.closest(".canvas-card") || e.touches.length !== 1) return;
      boardPanning = true;
      boardPanStartX = e.touches[0].clientX;
      boardPanStartY = e.touches[0].clientY;
      boardPanScrollX = board.scrollLeft;
      boardPanScrollY = board.scrollTop;
      board.classList.add("panning");
    }, { passive: true });
  }

  function setupDeckPanHandlers() {
    var fan = elements.deckFan;

    fan.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (e.target.closest(".fan-card.activated")) return;
      deckPanning = true;
      deckPanMoved = false;
      deckPanStartX = e.clientX;
      deckPanStartY = e.clientY;
      deckPanScrollX = fan.scrollLeft;
      fan.classList.add("panning");
    });

    if (window.PointerEvent) {
      fan.addEventListener("pointerdown", function (e) {
        if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
        var cardEl = e.target.closest(".fan-card");
        if (!cardEl || cardEl.classList.contains("placed")) return;
        e.preventDefault();
        deckTouchPointerId = e.pointerId;
        deckTouchPendingCardId = cardEl.getAttribute("data-card-id");
        deckTouchCardMoved = false;
        deckTouchStartX = e.clientX;
        deckTouchStartY = e.clientY;
        deckTouchLastX = e.clientX;
        deckTouchLastY = e.clientY;
        deckPanMoved = false;
        deckPanScrollX = fan.scrollLeft;
        suppressDeckClick = false;
        if (deckTouchLongPressTimer) clearTimeout(deckTouchLongPressTimer);
        deckTouchLongPressTimer = setTimeout(function () {
          startDeckTouchDrag(deckTouchPendingCardId, deckTouchStartX, deckTouchStartY);
        }, 360);
        if (fan.setPointerCapture) {
          try { fan.setPointerCapture(e.pointerId); } catch (err) {}
        }
      });

      fan.addEventListener("pointermove", function (e) {
        if (deckTouchPointerId !== e.pointerId) return;
        var dx = e.clientX - deckTouchStartX;
        var dy = e.clientY - deckTouchStartY;

        if (deckTouchCardDragging) {
          e.preventDefault();
          deckTouchLastX = e.clientX;
          deckTouchLastY = e.clientY;
          moveDeckTouchGhost(e.clientX, e.clientY);
          return;
        }

        if (!deckTouchPendingCardId) return;
        if (Math.hypot(dx, dy) > 10) {
          cancelDeckTouchPending();
        }
        if (Math.abs(dx) > Math.abs(dy)) {
          e.preventDefault();
          fan.scrollLeft = deckPanScrollX - dx;
          deckPanMoved = true;
          suppressDeckClick = true;
        }
      });

      fan.addEventListener("pointerup", function (e) {
        if (deckTouchPointerId !== e.pointerId) return;
        if (deckTouchCardDragging) {
          var dropX = e.clientX || deckTouchLastX;
          var dropY = e.clientY || deckTouchLastY;
          if (isPointInsideBoard(dropX, dropY)) {
            var pos = getBoardDropPosition(dropX, dropY);
            placeCardOnSpread(deckTouchCardDragging, pos.x, pos.y);
          }
          suppressDeckClick = true;
          setTimeout(function () {
            suppressDeckClick = false;
          }, 250);
          cleanupDeckTouchDrag();
          return;
        }

        if (deckTouchPendingCardId) {
          var pendingCardId = deckTouchPendingCardId;
          cancelDeckTouchPending();
          if (!deckPanMoved) {
            suppressDeckClick = true;
            activateCard(pendingCardId);
            setTimeout(function () {
              suppressDeckClick = false;
            }, 250);
          }
        }

        deckTouchPointerId = null;
      });

      fan.addEventListener("pointercancel", function (e) {
        if (deckTouchPointerId !== e.pointerId) return;
        cleanupDeckTouchDrag();
        setTimeout(function () {
          suppressDeckClick = false;
        }, 250);
      });
    }

    fan.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) return;
      var cardEl = e.target.closest(".fan-card");
      if (cardEl && window.PointerEvent) return;
      if (cardEl && !cardEl.classList.contains("placed")) {
        e.preventDefault();
        deckTouchPendingCardId = cardEl.getAttribute("data-card-id");
        deckTouchCardMoved = false;
        deckTouchStartX = e.touches[0].clientX;
        deckTouchStartY = e.touches[0].clientY;
        if (deckTouchLongPressTimer) clearTimeout(deckTouchLongPressTimer);
        deckTouchLongPressTimer = setTimeout(function () {
          startDeckTouchDrag(deckTouchPendingCardId, deckTouchStartX, deckTouchStartY);
        }, 360);
      }
      deckPanning = true;
      deckPanMoved = false;
      deckPanStartX = e.touches[0].clientX;
      deckPanStartY = e.touches[0].clientY;
      deckPanScrollX = fan.scrollLeft;
      fan.classList.add("panning");
    }, { passive: false });

    fan.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) && e.deltaX === 0) return;
      e.preventDefault();
      fan.scrollLeft += e.deltaY + e.deltaX;
    }, { passive: false });

    fan.addEventListener("click", function (e) {
      if (!suppressDeckClick) return;
      e.preventDefault();
      e.stopPropagation();
      suppressDeckClick = false;
    }, true);
  }

  function setupGlobalHandlers() {
    document.addEventListener("mousemove", function (e) {
      if (canvasCardDragging) {
        var cardDx = e.clientX - canvasDragStartX;
        var cardDy = e.clientY - canvasDragStartY;
        moveCardOnCanvas(canvasCardDragging, canvasDragOrigX + cardDx, canvasDragOrigY + cardDy);
        return;
      }

      if (boardPanning) {
        var boardDx = e.clientX - boardPanStartX;
        var boardDy = e.clientY - boardPanStartY;
        elements.spreadBoard.scrollLeft = boardPanScrollX - boardDx;
        elements.spreadBoard.scrollTop = boardPanScrollY - boardDy;
      }

      if (deckPanning) {
        var deckDx = e.clientX - deckPanStartX;
        var deckDy = e.clientY - deckPanStartY;
        if (Math.abs(deckDx) > 5 || Math.abs(deckDy) > 5) {
          deckPanMoved = true;
          suppressDeckClick = true;
        }
        elements.deckFan.scrollLeft = deckPanScrollX - deckDx;
      }
    });

    document.addEventListener("mouseup", function () {
      if (canvasCardDragging) {
        var el = elements.spreadBoard.querySelector('.canvas-card[data-card-id="' + canvasCardDragging + '"]');
        if (el) {
          el.style.zIndex = "1";
          el.style.transition = "box-shadow 0.15s";
          el.style.cursor = "grab";
        }
        canvasCardDragging = null;
      }

      if (boardPanning) {
        boardPanning = false;
        elements.spreadBoard.classList.remove("panning");
      }

      if (deckPanning) {
        deckPanning = false;
        elements.deckFan.classList.remove("panning");
        if (!deckPanMoved) {
          suppressDeckClick = false;
        }
        setTimeout(function () {
          suppressDeckClick = false;
        }, 0);
      }
    });

    document.addEventListener("click", function (e) {
      if (!e.target.closest(".fan-card") && !e.target.closest(".canvas-card")) {
        deactivateAll();
      }
    });

    document.addEventListener("touchmove", function (e) {
      if (deckTouchCardDragging) {
        var deckCardTouch = e.touches[0];
        var deckCardDx = deckCardTouch.clientX - deckTouchStartX;
        var deckCardDy = deckCardTouch.clientY - deckTouchStartY;
        if (!deckTouchCardMoved && Math.hypot(deckCardDx, deckCardDy) > 8) {
          deckTouchCardMoved = true;
          suppressDeckClick = true;
          createDeckTouchGhost(deckTouchCardDragging, deckCardTouch.clientX, deckCardTouch.clientY);
        }
        if (deckTouchCardMoved) {
          e.preventDefault();
          moveDeckTouchGhost(deckCardTouch.clientX, deckCardTouch.clientY);
        }
        return;
      }

      if (deckTouchPendingCardId) {
        var pendingTouch = e.touches[0];
        var pendingDx = pendingTouch.clientX - deckTouchStartX;
        var pendingDy = pendingTouch.clientY - deckTouchStartY;
        if (Math.hypot(pendingDx, pendingDy) > 10) {
          if (deckTouchLongPressTimer) {
            clearTimeout(deckTouchLongPressTimer);
            deckTouchLongPressTimer = null;
          }
          deckTouchPendingCardId = null;
        }
      }

      if (canvasCardDragging) {
        e.preventDefault();
        var cardTouch = e.touches[0];
        var cardDx = cardTouch.clientX - canvasDragStartX;
        var cardDy = cardTouch.clientY - canvasDragStartY;
        moveCardOnCanvas(canvasCardDragging, canvasDragOrigX + cardDx, canvasDragOrigY + cardDy);
        return;
      }

      if (boardPanning) {
        e.preventDefault();
        var boardTouch = e.touches[0];
        var boardDx = boardTouch.clientX - boardPanStartX;
        var boardDy = boardTouch.clientY - boardPanStartY;
        elements.spreadBoard.scrollLeft = boardPanScrollX - boardDx;
        elements.spreadBoard.scrollTop = boardPanScrollY - boardDy;
      }

      if (deckPanning) {
        var deckTouch = e.touches[0];
        var deckDx = deckTouch.clientX - deckPanStartX;
        var deckDy = deckTouch.clientY - deckPanStartY;
        if (Math.abs(deckDx) > Math.abs(deckDy)) {
          e.preventDefault();
          elements.deckFan.scrollLeft = deckPanScrollX - deckDx;
          deckPanMoved = true;
          suppressDeckClick = true;
        }
      }
    }, { passive: false });

    document.addEventListener("touchend", function (e) {
      if (deckTouchCardDragging) {
        if (deckTouchCardMoved && e.changedTouches.length > 0) {
          var endTouch = e.changedTouches[0];
          if (isPointInsideBoard(endTouch.clientX, endTouch.clientY)) {
            var pos = getBoardDropPosition(endTouch.clientX, endTouch.clientY);
            placeCardOnSpread(deckTouchCardDragging, pos.x, pos.y);
          }
          suppressDeckClick = true;
          setTimeout(function () {
            suppressDeckClick = false;
          }, 250);
        }
        cleanupDeckTouchDrag();
        return;
      }

      if (deckTouchPendingCardId) {
        var pendingCardId = deckTouchPendingCardId;
        if (deckTouchLongPressTimer) {
          clearTimeout(deckTouchLongPressTimer);
          deckTouchLongPressTimer = null;
        }
        deckTouchPendingCardId = null;
        if (!deckPanMoved) {
          suppressDeckClick = true;
          activateCard(pendingCardId);
          setTimeout(function () {
            suppressDeckClick = false;
          }, 250);
        }
      }

      if (canvasCardDragging) {
        canvasCardDragging = null;
      }
      if (boardPanning) {
        boardPanning = false;
        elements.spreadBoard.classList.remove("panning");
      }
      if (deckPanning) {
        deckPanning = false;
        elements.deckFan.classList.remove("panning");
        if (!deckPanMoved) {
          suppressDeckClick = false;
        }
        setTimeout(function () {
          suppressDeckClick = false;
        }, 0);
      }
    });

    document.addEventListener("touchcancel", function () {
      cleanupDeckTouchDrag();
      if (boardPanning) {
        boardPanning = false;
        elements.spreadBoard.classList.remove("panning");
      }
      if (deckPanning) {
        deckPanning = false;
        elements.deckFan.classList.remove("panning");
      }
      canvasCardDragging = null;
      setTimeout(function () {
        suppressDeckClick = false;
      }, 250);
    });
  }

  function init() {
    cacheElements();
    setupBoardHandlers();
    setupDeckPanHandlers();
    setupGlobalHandlers();

    mode = elements.modeSelect.value;
    arcanaFilter = elements.arcanaFilter.value;

    elements.modeSelect.addEventListener("change", handleModeChange);
    elements.arcanaFilter.addEventListener("change", handleArcanaFilterChange);
    elements.shuffleBtn.addEventListener("click", resetDeck);
    elements.switchArcanaBtn.addEventListener("click", switchArcanaPhase);
    elements.clearSpreadBtn.addEventListener("click", handleClearSpread);
    elements.revealBtn.addEventListener("click", revealAllCards);
    elements.openAllBtn.addEventListener("click", revealAllCards);

    resetDeck();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
