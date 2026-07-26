(function () {
  "use strict";

  // ---------- State ----------
  var deckType = "tarot";          // tarot | mystagogus
  var mode = "upright-only";       // upright-only | mixed
  var arcanaFilter = "mixed";      // mixed | major-only | minor-only | major-then-minor | minor-then-major
  var currentPhase = "major";      // used by phase filters (tarot only)
  var selectedSpreadId = "three-card-horizontal";
  var overviewMethod = "single";   // single | stacked

  var pile = [];       // remaining face-down cards (shuffled)
  var spread = [];      // drawn cards: { uid, card, orientation, revealed, slotIndex, layer? }
  var uidCounter = 0;

  var el = {};

  function cacheElements() {
    el.settings = document.getElementById("settings");
    el.settingsToggle = document.getElementById("settingsToggle");
    el.deckSelect = document.getElementById("deckSelect");
    el.modeSelect = document.getElementById("modeSelect");
    el.arcanaFilter = document.getElementById("arcanaFilter");
    el.arcanaFilterGroup = document.getElementById("arcanaFilterGroup");
    el.overviewMethod = document.getElementById("overviewMethod");
    el.overviewMethodGroup = document.getElementById("overviewMethodGroup");
    el.overviewMethodSummary = document.getElementById("overviewMethodSummary");
    el.spreadSelect = document.getElementById("spreadSelect");
    el.spreadSettingSummary = document.getElementById("spreadSettingSummary");
    el.shuffleBtn = document.getElementById("shuffleBtn");
    el.switchArcanaBtn = document.getElementById("switchArcanaBtn");
    el.deckSpread = document.getElementById("deckSpread");
    el.deckRemaining = document.getElementById("deckRemaining");
    el.deckCta = document.getElementById("deckCta");
    el.spreadArea = document.getElementById("spreadArea");
    el.spreadGrid = document.getElementById("spreadGrid");
    el.spreadBoardScroll = document.getElementById("spreadBoardScroll");
    el.spreadTitle = document.getElementById("spreadTitle");
    el.spreadCount = document.getElementById("spreadCount");
    el.phaseLabel = document.getElementById("phaseLabel");
    el.revealBtn = document.getElementById("revealBtn");
    el.clearBtn = document.getElementById("clearBtn");
    el.spreadHint = document.getElementById("spreadHint");
    el.positionGuide = document.getElementById("positionGuide");
    el.positionGuideList = document.getElementById("positionGuideList");
    el.resultsSection = document.getElementById("resultsSection");
    el.resultsList = document.getElementById("resultsList");
    el.supportBtn = document.getElementById("supportBtn");
    el.supportModal = document.getElementById("supportModal");
  }

  // ---------- Deck helpers ----------
  function shuffle(deck) {
    var r = deck.slice();
    for (var i = r.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = r[i]; r[i] = r[j]; r[j] = t;
    }
    return r;
  }

  function orientationFor() {
    if (mode === "upright-only") return "upright";
    // LXXXI 魔法牌固定全正位（说明书未提供逆位含义）。
    if (deckType === "lxxxi") return "upright";
    return Math.random() > 0.5 ? "upright" : "reversed";
  }

  function activeDeckCards() {
    if (deckType === "mystagogus") return mystagogusDeckFull.slice();
    if (deckType === "lxxxi") return lxxxiDeckFull.slice();
    if (currentPositionDrawRule()) return tarotDeckFull.slice();
    if (isOverviewStacking()) {
      return getDeckByArcanaFilter(currentPhase === "major" ? "major-only" : "minor-only", currentPhase);
    }
    return getDeckByArcanaFilter(arcanaFilter, currentPhase);
  }

  function buildPile() {
    pile = shuffle(activeDeckCards());
    if (isOverviewStacking()) {
      pile = getAvailableOverviewStackingCards(pile, spread, currentPhase);
    } else if (currentPositionDrawRule()) {
      pile = getAvailableCardsForDrawRule(pile, spread, currentPositionDrawRule());
    }
  }

  function selectedSpread() { return getSpreadById(deckType, selectedSpreadId); }

  function isOverviewStacking() {
    return isOverviewStackingMode(deckType, selectedSpreadId, overviewMethod);
  }

  function hasPositionDrawRules() {
    return deckType === "tarot" && selectedSpread().positions.some(function (position) {
      return Boolean(position.drawRule);
    });
  }

  function currentPositionDrawRule() {
    if (deckType !== "tarot") return null;
    var slotIndex = nextOpenSlotIndex();
    if (slotIndex === -1) return null;
    return selectedSpread().positions[slotIndex].drawRule || null;
  }

  function overviewStackingPhase() {
    return overviewStackingState().status;
  }

  function overviewStackingState() {
    return getOverviewStackingState(spread, selectedSpread().positions.length);
  }

  function spreadTargetCount() {
    return isOverviewStacking()
      ? overviewStackingState().targetCount
      : selectedSpread().positions.length;
  }

  function defaultSpreadIdForDeck(type) {
    if (type === "mystagogus") return mystagogusSpreads[0].id;
    if (type === "lxxxi") return lxxxiSpreads[0].id;
    return "three-card-horizontal";
  }

  function updateDeckSpreadAriaLabel(drawRule) {
    var label = "塔罗牌堆，左右滑动浏览，轻点抽牌";
    if (deckType === "mystagogus") label = "Mystagogus 牌堆，左右滑动浏览，轻点抽牌";
    else if (deckType === "lxxxi") label = "LXXXI 魔法牌堆，左右滑动浏览，轻点抽牌";
    else if (drawRule) label += "；当前" + drawRule.label;
    el.deckSpread.setAttribute("aria-label", label);
  }

  function applyDeckUi() {
    var nonTarot = isNonTarotDeck();
    var stackingAvailable = deckType === "tarot" && selectedSpreadId === "overview";
    if (el.overviewMethodGroup) {
      el.overviewMethodGroup.style.display = stackingAvailable ? "" : "none";
    }
    if (el.arcanaFilterGroup) {
      el.arcanaFilterGroup.style.display =
        nonTarot || isOverviewStacking() || hasPositionDrawRules() ? "none" : "";
    }
    if (el.overviewMethodSummary) {
      el.overviewMethodSummary.textContent = isOverviewStacking()
        ? "先铺 13 张大阿卡那作为原因与力量，再将 13 张小阿卡那叠在对应牌位作为具体表现。"
        : "单牌法在十三个牌位各抽一张；需要更多信息时可切换为分牌叠放。";
    }
    // M 牌与 LXXXI 魔法牌固定全正位（说明书未提供逆位含义）：
    // 禁用「正逆位混合」选项，并把已选中的 mixed 回退为全正位。
    if (el.modeSelect) {
      var mixedOption = el.modeSelect.querySelector('option[value="mixed"]');
      if (mixedOption) mixedOption.disabled = nonTarot;
      if (nonTarot && mode === "mixed") {
        mode = "upright-only";
        el.modeSelect.value = "upright-only";
      }
    }
    updateDeckSpreadAriaLabel(currentPositionDrawRule());
  }

  function orderedSpreadEntries() {
    return spread.slice().sort(function (a, b) {
      if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
      if (a.layer === b.layer) return 0;
      return a.layer === "major" ? -1 : 1;
    });
  }

  function nextOpenSlotIndex() {
    if (isOverviewStacking()) {
      if (overviewStackingPhase() === "complete") return -1;
      return getNextOverviewStackingSlot(spread, selectedSpread().positions.length, currentPhase);
    }
    var used = {};
    spread.forEach(function (entry) { used[entry.slotIndex] = true; });
    for (var i = 0; i < selectedSpread().positions.length; i++) {
      if (!used[i]) return i;
    }
    return -1;
  }

  // Full reset: rebuild pile and clear the spread.
  function resetDeck() {
    currentPhase = "major";
    spread = [];
    buildPile();
    renderSpreadCards();
    renderDeckSpread();
    renderSpreadMeta();
    renderResults();
  }

  function getOrientationLabel(o) { return o === "upright" ? "正位" : "逆位"; }

  var MYSTAGOGUS_BACK = "assets/cards/m/m-back.jpeg";
  var LXXXI_BACK = "assets/cards/lxxxi/lxxxi-back.jpeg";

  // Non-tarot decks (Mystagogus, LXXXI) use a fixed deck back and no arcana filter.
  function isNonTarotDeck() {
    return deckType === "mystagogus" || deckType === "lxxxi";
  }

  function deckBackImage() {
    if (deckType === "lxxxi") return LXXXI_BACK;
    return MYSTAGOGUS_BACK;
  }

  function createCardImage(card, className, orientation) {
    var img = document.createElement("img");
    img.className = className + (orientation === "reversed" ? " reversed" : "");
    img.src = card.image;
    img.alt = card.name;
    img.loading = "lazy";
    img.decoding = "async";
    return img;
  }

  function createBackArtImage(className) {
    var img = document.createElement("img");
    img.className = className;
    img.src = deckBackImage();
    img.alt = "";
    img.decoding = "async";
    img.setAttribute("aria-hidden", "true");
    return img;
  }

  /** Append Chinese + English position labels into a parent element. */
  function appendPositionLabels(parent, position, baseClass) {
    var wrap = document.createElement("span");
    wrap.className = baseClass;
    var zh = document.createElement("span");
    zh.className = baseClass + "-zh";
    zh.textContent = position.name;
    wrap.appendChild(zh);
    if (position.nameEn) {
      var en = document.createElement("span");
      en.className = baseClass + "-en";
      en.textContent = position.nameEn;
      wrap.appendChild(en);
    }
    parent.appendChild(wrap);
    return wrap;
  }

  // ---------- Deck spread (pick any card) ----------
  function renderDeckSpread() {
    var prevScroll = el.deckSpread.scrollLeft;
    el.deckSpread.innerHTML = "";
    var stacking = isOverviewStacking();
    var drawRule = currentPositionDrawRule();
    updateDeckSpreadAriaLabel(drawRule);
    var spreadIsFull = stacking
      ? overviewStackingPhase() === "complete"
      : nextOpenSlotIndex() === -1;

    if (pile.length === 0) {
      el.deckSpread.classList.add("empty");
      el.deckSpread.textContent = stacking || isPhaseFilter(arcanaFilter)
        ? "这组牌已抽完，可切换牌组或重新洗牌"
        : "牌已抽完，按「洗牌」重新开始";
    } else {
      el.deckSpread.classList.remove("empty");
      pile.forEach(function (card, index) {
        var cardEl = document.createElement("button");
        cardEl.type = "button";
        cardEl.setAttribute("data-pile-index", String(index));
        var isM = deckType === "mystagogus";
        cardEl.className = "deck-card" +
          (isM ? " deck-card-m" : "") +
          (deckType === "lxxxi" ? " deck-card-lxxxi" : "") +
          (spreadIsFull ? " disabled" : "");
        var nextPosition = spreadIsFull ? null : selectedSpread().positions[nextOpenSlotIndex()];
        var selectionLabel = stacking
          ? (currentPhase === "major" ? "大阿卡那底牌" : "小阿卡那叠牌")
          : drawRule ? "，" + drawRule.label : "";
        cardEl.setAttribute("aria-label", spreadIsFull
          ? "牌阵已完成"
          : "第 " + (index + 1) + " 张，轻点抽到" +
            formatPositionName(nextPosition, "slash") +
            (stacking ? "的" + selectionLabel : selectionLabel));
        if (isNonTarotDeck()) {
          cardEl.appendChild(createBackArtImage("deck-card-back-img"));
        }
        if (spreadIsFull) {
          cardEl.disabled = true;
        } else {
          cardEl.addEventListener("click", function (event) {
            drawAt(index, event.detail === 0);
          });
        }
        el.deckSpread.appendChild(cardEl);
      });
      el.deckSpread.scrollLeft = prevScroll;
    }

    el.deckRemaining.textContent = (stacking
      ? (currentPhase === "major" ? "大阿卡那 · " : "小阿卡那 · ")
      : drawRule ? drawRule.label + " · " : "") + "剩 " + pile.length + " 张";

    if (spreadIsFull) {
      el.deckCta.classList.add("complete");
      el.deckCta.classList.remove("empty");
      el.deckCta.textContent = stacking
        ? "概览布局 · 分牌叠放已完成（13 组 / 26 张），可以逐组开牌解读"
        : selectedSpread().name + " · " +
          getSpreadOriginLabel(selectedSpread()) + " 已完成，可以开牌解读";
    } else if (pile.length === 0) {
      el.deckCta.classList.add("empty");
      el.deckCta.classList.remove("complete");
      el.deckCta.textContent = "牌堆已空，翻开你的牌，或重新洗牌再来一次";
    } else {
      el.deckCta.classList.remove("empty");
      el.deckCta.classList.remove("complete");
      var nextPosition = selectedSpread().positions[nextOpenSlotIndex()];
      if (stacking) {
        var layerInstruction = currentPhase === "major"
          ? "大阿卡那底牌 · 原因与力量"
          : "小阿卡那叠牌 · 具体表现";
        el.deckCta.textContent = "下一张：位置 " + nextPosition.number + " · " +
          formatPositionName(nextPosition, "slash") + " · " + layerInstruction +
          "（轻点任意一张牌抽出）";
      } else if (drawRule) {
        el.deckCta.textContent = "下一张：位置 " + nextPosition.number + " · " +
          formatPositionName(nextPosition, "slash") + " · " + drawRule.label +
          "（从当前合法牌池中任选一张）";
      } else {
        el.deckCta.textContent = "下一张：位置 " + nextPosition.number + " · " +
          formatPositionName(nextPosition, "slash") + "（轻点任意一张牌抽出）";
      }
    }

    if (deckType === "tarot" && isPhaseFilter(arcanaFilter) && !stacking && !hasPositionDrawRules()) {
      el.switchArcanaBtn.style.display = "inline-block";
      el.switchArcanaBtn.textContent = getOtherPhaseLabel(arcanaFilter, currentPhase);
    } else {
      el.switchArcanaBtn.style.display = "none";
    }
  }

  // ---------- Spread (drawn cards) ----------
  function buildSpreadCardEl(entry) {
    var card = entry.card;
    var position = selectedSpread().positions[entry.slotIndex];
    var stacking = isOverviewStacking() && Boolean(entry.layer);
    var layerName = entry.layer === "major"
      ? "大阿卡那底牌"
      : "小阿卡那叠牌";

    var cardEl = document.createElement("div");
    cardEl.className = "spread-card" +
      (entry.isNew ? " is-new" : "") +
      (stacking ? " overview-stack-card stack-layer-" + entry.layer : "");
    cardEl.setAttribute("data-uid", entry.uid);
    if (stacking) cardEl.setAttribute("data-layer", entry.layer);
    cardEl.setAttribute("role", "listitem");
    cardEl.style.gridColumn = position.column + " / span " + (position.columnSpan || 1);
    cardEl.style.gridRow = position.row + " / span " + (position.rowSpan || 1);
    cardEl.style.setProperty("--position-offset-x",
      (stacking ? (entry.layer === "major" ? -8 : 8) : (position.offsetX || 0)) + "%");
    cardEl.style.setProperty("--position-offset-y",
      (stacking ? (entry.layer === "major" ? -10 : 12) : (position.offsetY || 0)) + "%");
    cardEl.style.zIndex = String(position.number + (stacking && entry.layer === "minor" ? 100 : 0));

    var flipButton = document.createElement("button");
    flipButton.className = "spread-card-flip";
    flipButton.type = "button";
    flipButton.setAttribute(
      "aria-label",
      "位置 " + position.number + "，" + formatPositionName(position, "slash") +
        (stacking ? "，" + layerName : "") + "，轻点翻开这张牌"
    );

    var inner = document.createElement("div");
    inner.className = "spread-card-inner";

    var back = document.createElement("div");
    back.className = "spread-card-face spread-card-back" +
      (deckType === "mystagogus" ? " spread-card-back-m" : "") +
      (deckType === "lxxxi" ? " spread-card-back-lxxxi" : "");
    if (isNonTarotDeck()) {
      back.appendChild(createBackArtImage("spread-card-back-img"));
    }
    var posNum = document.createElement("span");
    posNum.className = "pos-num";
    posNum.textContent = position.number;
    back.appendChild(posNum);
    if (position.drawRule) {
      var drawRuleBadge = document.createElement("span");
      drawRuleBadge.className = "draw-rule-badge";
      drawRuleBadge.textContent = position.drawRule.label;
      back.appendChild(drawRuleBadge);
    }
    if (stacking) {
      var layerBadge = document.createElement("span");
      layerBadge.className = "stack-layer-badge";
      layerBadge.textContent = entry.layer === "major" ? "大牌 · 因" : "小牌 · 果";
      back.appendChild(layerBadge);
    }
    appendPositionLabels(back, position, "pos-name");

    // Front face is built up-front but hidden by backface-visibility until flipped,
    // so we get an instant, smooth 3D flip without leaking the card face.
    var front = document.createElement("div");
    front.className = "spread-card-face spread-card-front" +
      (entry.orientation === "reversed" ? " reversed" : "");
    var faceImg = createCardImage(card, "card-image", entry.orientation);
    if (deckType === "mystagogus") faceImg.classList.add("card-image-m");
    if (deckType === "lxxxi") faceImg.classList.add("card-image-lxxxi");
    front.appendChild(faceImg);
    var caption = document.createElement("div");
    caption.className = "spread-card-caption";
    if (stacking) {
      var captionLayer = document.createElement("span");
      captionLayer.className = "stack-layer-caption";
      captionLayer.textContent = entry.layer === "major" ? "大牌底牌 · 因" : "小牌叠牌 · 果";
      caption.appendChild(captionLayer);
    }
    var nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = card.name;
    var oriEl = document.createElement("span");
    oriEl.className = "ori " + entry.orientation;
    oriEl.textContent = getOrientationLabel(entry.orientation);
    caption.appendChild(nameEl);
    caption.appendChild(oriEl);
    front.appendChild(caption);

    inner.appendChild(back);
    inner.appendChild(front);
    flipButton.appendChild(inner);
    cardEl.appendChild(flipButton);

    var removeBtn = document.createElement("button");
    removeBtn.className = "remove-btn";
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", "移除位置 " + position.number +
      (stacking ? "的" + layerName : "的这张牌"));
    removeBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      removeEntry(entry, ev.detail === 0);
    });
    cardEl.appendChild(removeBtn);

    flipButton.addEventListener("click", function () { revealEntry(entry); });

    if (entry.revealed) cardEl.classList.add("revealed");
    return cardEl;
  }

  function renderSpreadCards() {
    var spreadDefinition = selectedSpread();
    var stacking = isOverviewStacking();
    var hadRenderedCards = Boolean(el.spreadGrid.querySelector(".spread-card"));
    var previousScrollLeft = el.spreadBoardScroll.scrollLeft;
    el.spreadGrid.innerHTML = "";
    el.spreadGrid.classList.toggle("overview-stacking", stacking);
    el.spreadGrid.style.setProperty("--spread-columns", spreadDefinition.columns);
    el.spreadGrid.style.setProperty("--spread-rows", spreadDefinition.rows);
    el.spreadGrid.style.setProperty("--spread-min-width", Math.max(280, spreadDefinition.columns * 76) + "px");
    var usedSlots = {};
    spread.forEach(function (entry) {
      if (!stacking || entry.layer === currentPhase) usedSlots[entry.slotIndex] = true;
    });
    spreadDefinition.positions.forEach(function (position, index) {
      if (usedSlots[index]) return;
      var slot = document.createElement("div");
      slot.className = "spread-slot" +
        (stacking ? " overview-stack-slot stack-layer-" + currentPhase : "");
      slot.setAttribute("aria-hidden", "true");
      slot.style.gridColumn = position.column + " / span " + (position.columnSpan || 1);
      slot.style.gridRow = position.row + " / span " + (position.rowSpan || 1);
      slot.style.setProperty("--position-offset-x",
        (stacking ? (currentPhase === "major" ? -8 : 8) : (position.offsetX || 0)) + "%");
      slot.style.setProperty("--position-offset-y",
        (stacking ? (currentPhase === "major" ? -10 : 12) : (position.offsetY || 0)) + "%");
      if (stacking) {
        slot.style.zIndex = String(position.number + (currentPhase === "minor" ? 100 : 0));
      }
      var slotNumber = document.createElement("span");
      slotNumber.textContent = position.number;
      slot.appendChild(slotNumber);
      if (stacking) {
        var slotLayer = document.createElement("span");
        slotLayer.className = "stack-slot-layer";
        slotLayer.textContent = currentPhase === "major" ? "大牌底牌" : "小牌叠牌";
        slot.appendChild(slotLayer);
      }
      appendPositionLabels(slot, position, "slot-name");
      if (position.drawRule) {
        var slotDrawRule = document.createElement("span");
        slotDrawRule.className = "slot-draw-rule";
        slotDrawRule.textContent = position.drawRule.label;
        slot.appendChild(slotDrawRule);
      }
      el.spreadGrid.appendChild(slot);
    });
    orderedSpreadEntries().forEach(function (entry) {
      el.spreadGrid.appendChild(buildSpreadCardEl(entry));
    });
    requestAnimationFrame(function () {
      el.spreadBoardScroll.scrollLeft = hadRenderedCards
        ? previousScrollLeft
        : Math.max(0, (el.spreadBoardScroll.scrollWidth - el.spreadBoardScroll.clientWidth) / 2);
    });
  }

  function getSpreadEl(entry) {
    return el.spreadGrid.querySelector('.spread-card[data-uid="' + entry.uid + '"]');
  }

  function syncOverviewStackingPhase() {
    if (!isOverviewStacking()) return;
    var state = overviewStackingState();
    var phaseChanged = currentPhase !== state.activeLayer;
    currentPhase = state.activeLayer;
    if (state.complete) {
      pile = [];
    } else if (phaseChanged) {
      buildPile();
    }
  }

  function restoreDeckFocus(preferredIndex, shouldMoveFocus) {
    if (!shouldMoveFocus) return;
    requestAnimationFrame(function () {
      if (nextOpenSlotIndex() === -1) {
        el.revealBtn.focus({ preventScroll: true });
        el.revealBtn.scrollIntoView({ block: "nearest", inline: "nearest" });
        return;
      }
      if (pile.length === 0) return;
      var safeIndex = Math.min(Math.max(preferredIndex || 0, 0), pile.length - 1);
      var nextCard = el.deckSpread.querySelector('[data-pile-index="' + safeIndex + '"]');
      if (nextCard) {
        nextCard.focus({ preventScroll: true });
        nextCard.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }

  function drawAt(index, keyboardTriggered) {
    if (index < 0 || index >= pile.length) return;
    var slotIndex = nextOpenSlotIndex();
    if (slotIndex === -1) return;
    var card = pile.splice(index, 1)[0];
    var entry = {
      uid: ++uidCounter,
      card: card,
      orientation: orientationFor(),
      revealed: false,
      slotIndex: slotIndex,
      isNew: true,
      layer: isOverviewStacking() ? currentPhase : null
    };
    spread.push(entry);
    syncOverviewStackingPhase();
    if (hasPositionDrawRules()) {
      if (nextOpenSlotIndex() === -1) pile = [];
      else buildPile();
    }

    renderSpreadCards();
    requestAnimationFrame(function () {
      entry.isNew = false;
      var cardEl = getSpreadEl(entry);
      if (cardEl) {
        setTimeout(function () { cardEl.classList.remove("is-new"); }, 340);
      }
    });
    renderDeckSpread();
    renderSpreadMeta();
    restoreDeckFocus(index, keyboardTriggered);

    if (spread.length === 1 && !keyboardTriggered) {
      requestAnimationFrame(function () {
        el.spreadArea.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  function revealEntry(entry) {
    if (entry.revealed) return;
    entry.revealed = true;
    var cardEl = getSpreadEl(entry);
    if (cardEl) {
      // The card has been in the DOM (face-down) since it was drawn, so toggling
      // the class here triggers the 3D flip transition directly.
      cardEl.classList.remove("is-new");
      cardEl.classList.add("revealed");
      var position = selectedSpread().positions[entry.slotIndex];
      var flipButton = cardEl.querySelector(".spread-card-flip");
      if (flipButton) {
        flipButton.setAttribute(
          "aria-label",
          "位置 " + position.number + " · " + formatPositionName(position, "slash") +
            (isOverviewStacking()
              ? " · " + (entry.layer === "major" ? "大阿卡那底牌" : "小阿卡那叠牌")
              : "") +
            " · " + entry.card.name + " · " + getOrientationLabel(entry.orientation)
        );
      }
    }
    renderSpreadMeta();
    renderResults();
  }

  function removeEntry(entry, keyboardTriggered) {
    var idx = spread.indexOf(entry);
    if (idx === -1) return;
    spread.splice(idx, 1);
    if (isOverviewStacking()) {
      var state = overviewStackingState();
      currentPhase = state.activeLayer;
      if (state.complete) pile = [];
      else buildPile();
    } else if (hasPositionDrawRules()) {
      buildPile();
    } else {
      // Return the card to a random spot in the pile so it can be redrawn.
      var pos = Math.floor(Math.random() * (pile.length + 1));
      pile.splice(pos, 0, entry.card);
    }

    renderSpreadCards();
    renderDeckSpread();
    renderSpreadMeta();
    renderResults();
    restoreDeckFocus(0, keyboardTriggered);
  }

  function revealAll() {
    var pending = spread.filter(function (e) { return !e.revealed; });
    pending.forEach(function (entry, i) {
      setTimeout(function () { revealEntry(entry); }, i * 80);
    });
  }

  function renderSpreadMeta() {
    if (spread.length === 0) {
      el.spreadArea.style.display = "none";
      return;
    }
    el.spreadArea.style.display = "block";
    el.spreadCount.textContent = spread.length;

    // Keep position numbers on face-down cards in sync after removals.
    spread.forEach(function (entry) {
      var cardEl = getSpreadEl(entry);
      if (cardEl) {
        var posNum = cardEl.querySelector(".pos-num");
        if (posNum) posNum.textContent = selectedSpread().positions[entry.slotIndex].number;
      }
    });

    var activeSpread = selectedSpread();
    var stacking = isOverviewStacking();
    el.spreadTitle.textContent = activeSpread.name + " · " + getSpreadOriginLabel(activeSpread);
    el.spreadCount.textContent = spread.length + " / " + spreadTargetCount();

    if (stacking) {
      el.phaseLabel.style.display = "inline-block";
      var stackingPhase = overviewStackingPhase();
      el.phaseLabel.textContent = stackingPhase === "complete"
        ? "分牌叠放 · 13 组已完成"
        : currentPhase === "major"
          ? "分牌叠放 · 第 1 层：大牌（因）"
          : "分牌叠放 · 第 2 层：小牌（果）";
    } else if (hasPositionDrawRules()) {
      el.phaseLabel.style.display = "inline-block";
      var nextRule = currentPositionDrawRule();
      el.phaseLabel.textContent = nextRule
        ? "当前牌位：" + nextRule.label
        : "四季牌阵 · 五个限定牌位已完成";
    } else if (deckType === "tarot" && isPhaseFilter(arcanaFilter)) {
      el.phaseLabel.style.display = "inline-block";
      el.phaseLabel.textContent = "当前：" + getPhaseArcanaLabel(arcanaFilter, currentPhase);
    } else {
      el.phaseLabel.style.display = "none";
    }

    var allRevealed = spread.every(function (e) { return e.revealed; });
    el.revealBtn.textContent = allRevealed ? "已全部翻开" : "开牌解读";
    el.revealBtn.disabled = allRevealed;
    el.spreadHint.style.display = allRevealed ? "none" : "block";
    el.spreadHint.textContent = stacking
      ? "同一牌位的大牌与小牌需一起解读：大牌是背后的原因与力量，小牌是这种力量的具体表现。"
      : hasPositionDrawRules()
        ? "每个牌位只会展示符合限制的牌背供你选择；轻点牌可单独翻开，或按「开牌解读」全部翻开。"
        : "轻点任意一张牌可单独翻开，或按「开牌解读」全部翻开。";
  }

  function buildResultCard(entry, position, layer) {
    var card = entry.card;
    var isUpright = entry.orientation === "upright";
    var showReversed = mode === "mixed" && !isUpright;
    var keywords = showReversed ? card.reversedKeywords : card.uprightKeywords;
    var meaning = showReversed ? card.reversedMeaning : card.uprightMeaning;
    var resultCard = document.createElement("div");
    resultCard.className = "result-card" + (layer ? " stack-layer-" + layer : "");

    if (card.image) {
      var resultImg = createCardImage(card, "result-card-image", entry.orientation);
      if (card.deck === "mystagogus") resultImg.classList.add("result-card-image-m");
      if (card.deck === "lxxxi") resultImg.classList.add("result-card-image-lxxxi");
      resultCard.appendChild(resultImg);
    }

    var header = document.createElement("div");
    header.className = "result-header";

    var posEl = document.createElement("span");
    posEl.className = "result-pos";
    posEl.textContent = layer
      ? layer === "major" ? "大牌底牌（因）" : "小牌叠牌（果）"
      : "位置 " + position.number + " · " + formatPositionName(position, "slash");

    var nameEl = document.createElement("span");
    nameEl.className = "result-name";
    nameEl.textContent = card.name;

    var orientEl = document.createElement("span");
    orientEl.className = "result-orientation " + entry.orientation;
    orientEl.textContent = getOrientationLabel(entry.orientation);

    header.appendChild(posEl);
    header.appendChild(nameEl);
    header.appendChild(orientEl);

    if (card.suit) {
      var suitEl = document.createElement("span");
      suitEl.className = "result-suit";
      suitEl.textContent = card.suit + " · " + card.element + (card.direction ? " · " + card.direction : "");
      header.appendChild(suitEl);
    } else if (card.deck === "mystagogus" && card.nameEn) {
      var enEl = document.createElement("span");
      enEl.className = "result-suit";
      enEl.textContent = "M" + card.number + " · " + card.nameEn;
      header.appendChild(enEl);
    } else if (card.deck === "lxxxi" && card.nameEn) {
      var lxxxiEnEl = document.createElement("span");
      lxxxiEnEl.className = "result-suit";
      lxxxiEnEl.textContent = card.number + "/81 · " + card.nameEn;
      header.appendChild(lxxxiEnEl);
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
    if (!layer) {
      var positionMeaningEl = document.createElement("div");
      positionMeaningEl.className = "result-position-meaning";
      positionMeaningEl.textContent = "牌位：" + position.meaning;
      resultCard.appendChild(positionMeaningEl);
    }
    resultCard.appendChild(keywordsEl);
    resultCard.appendChild(meaningEl);
    resultCard.appendChild(sourceEl);
    return resultCard;
  }

  function renderOverviewStackingResults() {
    var positions = selectedSpread().positions;
    positions.forEach(function (position, slotIndex) {
      var pair = {};
      spread.forEach(function (entry) {
        if (entry.slotIndex === slotIndex && entry.revealed) pair[entry.layer] = entry;
      });
      if (!pair.major && !pair.minor) return;

      var group = document.createElement("section");
      group.className = "result-pair-card";
      group.setAttribute("aria-labelledby", "result-pair-title-" + slotIndex);

      var title = document.createElement("h3");
      title.id = "result-pair-title-" + slotIndex;
      title.textContent = "位置 " + position.number + " · " + formatPositionName(position, "slash");

      var positionMeaning = document.createElement("p");
      positionMeaning.className = "result-position-meaning";
      positionMeaning.textContent = "牌位：" + position.meaning;

      var pairHint = document.createElement("p");
      pairHint.className = "result-pair-hint";
      pairHint.textContent = "大牌揭示背后的原因与力量，小牌说明这种力量将如何具体表现；请将两张牌作为一组解读。";

      var pairGrid = document.createElement("div");
      pairGrid.className = "result-pair-grid";
      ["major", "minor"].forEach(function (layer) {
        if (pair[layer]) {
          pairGrid.appendChild(buildResultCard(pair[layer], position, layer));
          return;
        }
        var pending = document.createElement("div");
        pending.className = "result-pair-pending stack-layer-" + layer;
        pending.textContent = layer === "major"
          ? "大牌底牌（因）尚未翻开"
          : "小牌叠牌（果）尚未翻开";
        pairGrid.appendChild(pending);
      });

      group.appendChild(title);
      group.appendChild(positionMeaning);
      group.appendChild(pairHint);
      group.appendChild(pairGrid);
      el.resultsList.appendChild(group);
    });
  }

  function renderResults() {
    var revealed = spread.filter(function (e) { return e.revealed; });
    if (revealed.length === 0) {
      el.resultsSection.style.display = "none";
      return;
    }
    el.resultsSection.style.display = "block";
    el.resultsList.innerHTML = "";

    if (isOverviewStacking()) {
      renderOverviewStackingResults();
      return;
    }

    orderedSpreadEntries().forEach(function (entry) {
      if (!entry.revealed) return;
      el.resultsList.appendChild(
        buildResultCard(entry, selectedSpread().positions[entry.slotIndex], null)
      );
    });
  }

  // ---------- Settings / phase ----------
  function switchArcanaPhase() {
    if (deckType !== "tarot" || isOverviewStacking() || hasPositionDrawRules()) return;
    currentPhase = currentPhase === "major" ? "minor" : "major";
    buildPile();
    renderDeckSpread();
    renderSpreadMeta();
  }

  function confirmIfSpread(message) {
    if (spread.length === 0) return true;
    return confirm(message);
  }

  function handleModeChange() {
    var newMode = el.modeSelect.value;
    if (newMode === mode) return;
    // M 牌与 LXXXI 魔法牌不支持逆位，拒绝切换到混合模式。
    if (newMode === "mixed" && isNonTarotDeck()) {
      el.modeSelect.value = mode;
      return;
    }
    if (!confirmIfSpread("切换模式会清空当前牌阵并重新洗牌，是否继续？")) {
      el.modeSelect.value = mode;
      return;
    }
    mode = newMode;
    resetDeck();
  }

  function handleArcanaChange() {
    if (deckType !== "tarot") return;
    var newFilter = el.arcanaFilter.value;
    if (newFilter === arcanaFilter) return;
    if (!confirmIfSpread("切换筛选会清空当前牌阵并重新洗牌，是否继续？")) {
      el.arcanaFilter.value = arcanaFilter;
      return;
    }
    arcanaFilter = newFilter;
    resetDeck();
  }

  function handleOverviewMethodChange() {
    var newMethod = el.overviewMethod.value;
    if (newMethod === overviewMethod) return;
    if (!confirmIfSpread("切换概览抽法会清空当前牌阵并重新洗牌，是否继续？")) {
      el.overviewMethod.value = overviewMethod;
      return;
    }
    overviewMethod = newMethod;
    applyDeckUi();
    renderSpreadDefinition();
    resetDeck();
  }

  function handleSpreadChange() {
    var newSpreadId = el.spreadSelect.value;
    if (newSpreadId === selectedSpreadId) return;
    if (!confirmIfSpread("切换牌阵会清空当前抽牌并重新洗牌，是否继续？")) {
      el.spreadSelect.value = selectedSpreadId;
      return;
    }
    selectedSpreadId = newSpreadId;
    applyDeckUi();
    renderSpreadDefinition();
    resetDeck();
  }

  function populateSpreadSelect() {
    el.spreadSelect.innerHTML = "";
    var catalogue = getSpreadsForDeck(deckType);
    var mGroup = document.createElement("optgroup");
    mGroup.label = "M 牌牌阵";
    var tGroup = document.createElement("optgroup");
    tGroup.label = "塔罗牌阵";
    var lGroup = document.createElement("optgroup");
    lGroup.label = "LXXXI 牌阵";
    catalogue.forEach(function (spreadDefinition) {
      var option = document.createElement("option");
      option.value = spreadDefinition.id;
      var cardCountLabel = deckType === "tarot" && spreadDefinition.id === "overview"
        ? spreadDefinition.positions.length + " 张（可叠放 26 张）"
        : spreadDefinition.positions.length + " 张";
      option.textContent = spreadDefinition.name + " · " + getSpreadOriginLabel(spreadDefinition) +
        " · " + cardCountLabel;
      if (spreadDefinition.deck === "mystagogus") mGroup.appendChild(option);
      else if (spreadDefinition.deck === "lxxxi") lGroup.appendChild(option);
      else tGroup.appendChild(option);
    });
    // 当前牌组本族牌阵分组排在前面
    if (deckType === "mystagogus") {
      el.spreadSelect.appendChild(mGroup);
      el.spreadSelect.appendChild(tGroup);
      el.spreadSelect.appendChild(lGroup);
    } else if (deckType === "lxxxi") {
      el.spreadSelect.appendChild(lGroup);
      el.spreadSelect.appendChild(tGroup);
      el.spreadSelect.appendChild(mGroup);
    } else {
      el.spreadSelect.appendChild(tGroup);
      el.spreadSelect.appendChild(mGroup);
      el.spreadSelect.appendChild(lGroup);
    }
    if (!catalogue.some(function (s) { return s.id === selectedSpreadId; })) {
      selectedSpreadId = defaultSpreadIdForDeck(deckType);
    }
    el.spreadSelect.value = selectedSpreadId;
  }

  function handleDeckChange() {
    var newDeck = el.deckSelect.value;
    if (newDeck === deckType) return;
    if (!confirmIfSpread("切换牌组会清空当前牌阵并重新洗牌，是否继续？")) {
      el.deckSelect.value = deckType;
      return;
    }
    deckType = newDeck;
    // 双方均可使用对方牌阵；仅在 id 无效时回退默认。
    var allowed = getSpreadsForDeck(deckType);
    if (!allowed.some(function (s) { return s.id === selectedSpreadId; })) {
      selectedSpreadId = defaultSpreadIdForDeck(deckType);
    }
    applyDeckUi();
    populateSpreadSelect();
    renderSpreadDefinition();
    resetDeck();
  }

  function renderSpreadDefinition() {
    var spreadDefinition = selectedSpread();
    var countLabel = isOverviewStacking()
      ? "26 张（13 组） · 分牌叠放"
      : spreadDefinition.positions.length + " 张";
    el.spreadSettingSummary.textContent = getSpreadOriginLabel(spreadDefinition) + " · " +
      countLabel + " · " + spreadDefinition.description +
      (isOverviewStacking()
        ? " 每组大牌表示原因与力量，小牌表示这种力量如何表现。"
        : "");
    el.positionGuideList.innerHTML = "";
    spreadDefinition.positions.forEach(function (position) {
      var item = document.createElement("li");
      var title = document.createElement("strong");
      title.textContent = position.number + ". " + formatPositionName(position, "slash");
      var meaning = document.createElement("span");
      meaning.textContent = position.meaning +
        (position.drawRule ? "（" + position.drawRule.label + "）" : "");
      item.appendChild(title);
      item.appendChild(meaning);
      el.positionGuideList.appendChild(item);
    });
    el.positionGuide.open = false;
  }

  function handleShuffle() {
    if (!confirmIfSpread("确定要重新洗牌吗？这会清空当前牌阵。")) return;
    resetDeck();
  }

  function toggleSettings() {
    var collapsed = el.settings.classList.toggle("collapsed");
    el.settingsToggle.setAttribute("aria-expanded", String(!collapsed));
  }

  function openSupportModal() {
    if (!el.supportModal) return;
    el.supportModal.hidden = false;
    document.body.style.overflow = "hidden";
    var closeBtn = el.supportModal.querySelector(".support-modal-close");
    if (closeBtn) closeBtn.focus();
  }

  function closeSupportModal() {
    if (!el.supportModal || el.supportModal.hidden) return;
    el.supportModal.hidden = true;
    document.body.style.overflow = "";
    if (el.supportBtn) el.supportBtn.focus();
  }

  function bindSupportModal() {
    if (!el.supportBtn || !el.supportModal) return;
    el.supportBtn.addEventListener("click", openSupportModal);
    el.supportModal.addEventListener("click", function (ev) {
      if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute("data-close-support")) {
        closeSupportModal();
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeSupportModal();
    });
  }

  // ---------- Init ----------
  function init() {
    cacheElements();

    deckType = el.deckSelect.value || "tarot";
    mode = el.modeSelect.value;
    arcanaFilter = el.arcanaFilter.value;
    overviewMethod = el.overviewMethod.value || "single";
    applyDeckUi();
    populateSpreadSelect();
    selectedSpreadId = el.spreadSelect.value;
    renderSpreadDefinition();

    el.settingsToggle.addEventListener("click", toggleSettings);
    el.deckSelect.addEventListener("change", handleDeckChange);
    el.modeSelect.addEventListener("change", handleModeChange);
    el.arcanaFilter.addEventListener("change", handleArcanaChange);
    el.overviewMethod.addEventListener("change", handleOverviewMethodChange);
    el.spreadSelect.addEventListener("change", handleSpreadChange);
    el.shuffleBtn.addEventListener("click", handleShuffle);
    el.switchArcanaBtn.addEventListener("click", switchArcanaPhase);
    el.revealBtn.addEventListener("click", revealAll);
    el.clearBtn.addEventListener("click", handleShuffle);
    bindSupportModal();

    resetDeck();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
