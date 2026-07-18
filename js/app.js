(function () {
  "use strict";

  // ---------- State ----------
  var deckType = "tarot";          // tarot | mystagogus
  var mode = "upright-only";       // upright-only | mixed
  var arcanaFilter = "mixed";      // mixed | major-only | minor-only | major-then-minor | minor-then-major
  var currentPhase = "major";      // used by phase filters (tarot only)
  var selectedSpreadId = "three-card-horizontal";

  var pile = [];       // remaining face-down cards (shuffled)
  var spread = [];      // drawn cards: { uid, card, orientation, revealed }
  var uidCounter = 0;

  var el = {};

  function cacheElements() {
    el.settings = document.getElementById("settings");
    el.settingsToggle = document.getElementById("settingsToggle");
    el.deckSelect = document.getElementById("deckSelect");
    el.modeSelect = document.getElementById("modeSelect");
    el.arcanaFilter = document.getElementById("arcanaFilter");
    el.arcanaFilterGroup = document.getElementById("arcanaFilterGroup");
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
    return getDeckByArcanaFilter(arcanaFilter, currentPhase);
  }

  function buildPile() {
    pile = shuffle(activeDeckCards());
  }

  function selectedSpread() { return getSpreadById(deckType, selectedSpreadId); }

  function defaultSpreadIdForDeck(type) {
    if (type === "mystagogus") return mystagogusSpreads[0].id;
    if (type === "lxxxi") return lxxxiSpreads[0].id;
    return "three-card-horizontal";
  }

  function applyDeckUi() {
    var nonTarot = isNonTarotDeck();
    if (el.arcanaFilterGroup) {
      el.arcanaFilterGroup.style.display = nonTarot ? "none" : "";
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
    var label = "塔罗牌堆，左右滑动浏览，轻点抽牌";
    if (deckType === "mystagogus") label = "Mystagogus 牌堆，左右滑动浏览，轻点抽牌";
    else if (deckType === "lxxxi") label = "LXXXI 魔法牌堆，左右滑动浏览，轻点抽牌";
    el.deckSpread.setAttribute("aria-label", label);
  }

  function orderedSpreadEntries() {
    return spread.slice().sort(function (a, b) { return a.slotIndex - b.slotIndex; });
  }

  function nextOpenSlotIndex() {
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
    buildPile();
    spread = [];
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
    var spreadIsFull = nextOpenSlotIndex() === -1;

    if (pile.length === 0) {
      el.deckSpread.classList.add("empty");
      el.deckSpread.textContent = isPhaseFilter(arcanaFilter)
        ? "这组牌已抽完，可切换牌组或重新洗牌"
        : "牌已抽完，按「洗牌」重新开始";
    } else {
      el.deckSpread.classList.remove("empty");
      pile.forEach(function (card, index) {
        var cardEl = document.createElement("button");
        cardEl.type = "button";
        var isM = deckType === "mystagogus";
        cardEl.className = "deck-card" +
          (isM ? " deck-card-m" : "") +
          (deckType === "lxxxi" ? " deck-card-lxxxi" : "") +
          (spreadIsFull ? " disabled" : "");
        cardEl.setAttribute("aria-label", spreadIsFull
          ? "牌阵已完成"
          : "第 " + (index + 1) + " 张，轻点抽到" + formatPositionName(selectedSpread().positions[nextOpenSlotIndex()], "slash"));
        if (isNonTarotDeck()) {
          cardEl.appendChild(createBackArtImage("deck-card-back-img"));
        }
        if (spreadIsFull) {
          cardEl.disabled = true;
        } else {
          cardEl.addEventListener("click", function () { drawAt(index); });
        }
        el.deckSpread.appendChild(cardEl);
      });
      el.deckSpread.scrollLeft = prevScroll;
    }

    el.deckRemaining.textContent = "剩 " + pile.length + " 张";

    if (spreadIsFull) {
      el.deckCta.classList.add("complete");
      el.deckCta.classList.remove("empty");
      el.deckCta.textContent = selectedSpread().name + " · " +
        getSpreadOriginLabel(selectedSpread()) + " 已完成，可以开牌解读";
    } else if (pile.length === 0) {
      el.deckCta.classList.add("empty");
      el.deckCta.classList.remove("complete");
      el.deckCta.textContent = "牌堆已空，翻开你的牌，或重新洗牌再来一次";
    } else {
      el.deckCta.classList.remove("empty");
      el.deckCta.classList.remove("complete");
      var nextPosition = selectedSpread().positions[nextOpenSlotIndex()];
      el.deckCta.textContent = "下一张：位置 " + nextPosition.number + " · " +
        formatPositionName(nextPosition, "slash") + "（轻点任意一张牌抽出）";
    }

    if (deckType === "tarot" && isPhaseFilter(arcanaFilter)) {
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

    var cardEl = document.createElement("div");
    cardEl.className = "spread-card" + (entry.isNew ? " is-new" : "");
    cardEl.setAttribute("data-uid", entry.uid);
    cardEl.setAttribute("role", "listitem");
    cardEl.style.gridColumn = position.column + " / span " + (position.columnSpan || 1);
    cardEl.style.gridRow = position.row + " / span " + (position.rowSpan || 1);
    cardEl.style.setProperty("--position-offset-x", (position.offsetX || 0) + "%");
    cardEl.style.setProperty("--position-offset-y", (position.offsetY || 0) + "%");
    cardEl.style.zIndex = String(position.number);

    var flipButton = document.createElement("button");
    flipButton.className = "spread-card-flip";
    flipButton.type = "button";
    flipButton.setAttribute(
      "aria-label",
      "位置 " + position.number + "，" + formatPositionName(position, "slash") + "，轻点翻开这张牌"
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
    removeBtn.setAttribute("aria-label", "移除这张牌");
    removeBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      removeEntry(entry);
    });
    cardEl.appendChild(removeBtn);

    flipButton.addEventListener("click", function () { revealEntry(entry); });

    if (entry.revealed) cardEl.classList.add("revealed");
    return cardEl;
  }

  function renderSpreadCards() {
    var spreadDefinition = selectedSpread();
    var hadRenderedCards = Boolean(el.spreadGrid.querySelector(".spread-card"));
    var previousScrollLeft = el.spreadBoardScroll.scrollLeft;
    el.spreadGrid.innerHTML = "";
    el.spreadGrid.style.setProperty("--spread-columns", spreadDefinition.columns);
    el.spreadGrid.style.setProperty("--spread-rows", spreadDefinition.rows);
    el.spreadGrid.style.setProperty("--spread-min-width", Math.max(280, spreadDefinition.columns * 76) + "px");
    var usedSlots = {};
    spread.forEach(function (entry) { usedSlots[entry.slotIndex] = true; });
    spreadDefinition.positions.forEach(function (position, index) {
      if (usedSlots[index]) return;
      var slot = document.createElement("div");
      slot.className = "spread-slot";
      slot.setAttribute("aria-hidden", "true");
      slot.style.gridColumn = position.column + " / span " + (position.columnSpan || 1);
      slot.style.gridRow = position.row + " / span " + (position.rowSpan || 1);
      slot.style.setProperty("--position-offset-x", (position.offsetX || 0) + "%");
      slot.style.setProperty("--position-offset-y", (position.offsetY || 0) + "%");
      var slotNumber = document.createElement("span");
      slotNumber.textContent = position.number;
      slot.appendChild(slotNumber);
      appendPositionLabels(slot, position, "slot-name");
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

  function drawAt(index) {
    if (index < 0 || index >= pile.length) return;
    var slotIndex = nextOpenSlotIndex();
    if (slotIndex === -1) return;
    var card = pile.splice(index, 1)[0];
    var entry = { uid: ++uidCounter, card: card, orientation: orientationFor(), revealed: false, slotIndex: slotIndex, isNew: true };
    spread.push(entry);

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

    if (spread.length === 1) {
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
            " · " + entry.card.name + " · " + getOrientationLabel(entry.orientation)
        );
      }
    }
    renderSpreadMeta();
    renderResults();
  }

  function removeEntry(entry) {
    var idx = spread.indexOf(entry);
    if (idx === -1) return;
    spread.splice(idx, 1);
    // Return the card to a random spot in the pile so it can be redrawn.
    var pos = Math.floor(Math.random() * (pile.length + 1));
    pile.splice(pos, 0, entry.card);

    renderSpreadCards();
    renderDeckSpread();
    renderSpreadMeta();
    renderResults();
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
    el.spreadTitle.textContent = activeSpread.name + " · " + getSpreadOriginLabel(activeSpread);
    el.spreadCount.textContent = spread.length + " / " + activeSpread.positions.length;

    if (deckType === "tarot" && isPhaseFilter(arcanaFilter)) {
      el.phaseLabel.style.display = "inline-block";
      el.phaseLabel.textContent = "当前：" + getPhaseArcanaLabel(arcanaFilter, currentPhase);
    } else {
      el.phaseLabel.style.display = "none";
    }

    var allRevealed = spread.every(function (e) { return e.revealed; });
    el.revealBtn.textContent = allRevealed ? "已全部翻开" : "开牌解读";
    el.revealBtn.disabled = allRevealed;
    el.spreadHint.style.display = allRevealed ? "none" : "block";
  }

  function renderResults() {
    var revealed = spread.filter(function (e) { return e.revealed; });
    if (revealed.length === 0) {
      el.resultsSection.style.display = "none";
      return;
    }
    el.resultsSection.style.display = "block";
    el.resultsList.innerHTML = "";

    orderedSpreadEntries().forEach(function (entry) {
      if (!entry.revealed) return;
      var card = entry.card;
      var position = selectedSpread().positions[entry.slotIndex];
      var isUpright = entry.orientation === "upright";
      var showReversed = mode === "mixed" && !isUpright;
      var keywords = showReversed ? card.reversedKeywords : card.uprightKeywords;
      var meaning = showReversed ? card.reversedMeaning : card.uprightMeaning;

      var resultCard = document.createElement("div");
      resultCard.className = "result-card";

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
      posEl.textContent = "位置 " + position.number + " · " + formatPositionName(position, "slash");

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
        var enEl = document.createElement("span");
        enEl.className = "result-suit";
        enEl.textContent = card.number + "/81 · " + card.nameEn;
        header.appendChild(enEl);
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

      var positionMeaningEl = document.createElement("div");
      positionMeaningEl.className = "result-position-meaning";
      positionMeaningEl.textContent = "牌位：" + position.meaning;

      var sourceEl = document.createElement("div");
      sourceEl.className = "result-source";
      sourceEl.textContent = card.source || quareiaSource;

      resultCard.appendChild(header);
      resultCard.appendChild(positionMeaningEl);
      resultCard.appendChild(keywordsEl);
      resultCard.appendChild(meaningEl);
      resultCard.appendChild(sourceEl);
      el.resultsList.appendChild(resultCard);
    });
  }

  // ---------- Settings / phase ----------
  function switchArcanaPhase() {
    if (deckType !== "tarot") return;
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

  function handleSpreadChange() {
    var newSpreadId = el.spreadSelect.value;
    if (newSpreadId === selectedSpreadId) return;
    if (!confirmIfSpread("切换牌阵会清空当前抽牌并重新洗牌，是否继续？")) {
      el.spreadSelect.value = selectedSpreadId;
      return;
    }
    selectedSpreadId = newSpreadId;
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
      option.textContent = spreadDefinition.name + " · " + getSpreadOriginLabel(spreadDefinition) +
        " · " + spreadDefinition.positions.length + " 张";
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
    el.spreadSettingSummary.textContent = getSpreadOriginLabel(spreadDefinition) + " · " +
      spreadDefinition.positions.length + " 张 · " + spreadDefinition.description;
    el.positionGuideList.innerHTML = "";
    spreadDefinition.positions.forEach(function (position) {
      var item = document.createElement("li");
      var title = document.createElement("strong");
      title.textContent = position.number + ". " + formatPositionName(position, "slash");
      var meaning = document.createElement("span");
      meaning.textContent = position.meaning;
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
    applyDeckUi();
    populateSpreadSelect();
    selectedSpreadId = el.spreadSelect.value;
    renderSpreadDefinition();

    el.settingsToggle.addEventListener("click", toggleSettings);
    el.deckSelect.addEventListener("change", handleDeckChange);
    el.modeSelect.addEventListener("change", handleModeChange);
    el.arcanaFilter.addEventListener("change", handleArcanaChange);
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
