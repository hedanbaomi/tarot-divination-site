(function () {
  "use strict";

  // ---------- State ----------
  var deckType = "tarot";          // tarot | mystagogus
  var mode = "upright-only";       // upright-only | mixed
  var arcanaFilter = "mixed";      // mixed | major-only | minor-only | major-then-minor | minor-then-major
  var currentPhase = "major";      // used by phase filters (tarot only)
  var selectedSpreadId = "three-card-horizontal";
  var overviewMethod = "single";   // single | stacked
  var layoutMode = "preset";       // preset | freeform

  /* 自由模式：抽到桌上的牌，以及撤销/重做两条栈 */
  var freeDrawn = [];
  var freeRedo = [];
  var freeZ = 10;

  var pile = [];       // remaining face-down cards (shuffled)
  var spread = [];      // drawn cards: { uid, card, orientation, revealed, slotIndex, layer? }
  var uidCounter = 0;
  var lastSavedPresetUid = -1;
  var readingReported = false;
  var freeBoardReadingReported = false;

  var el = {};
  var historyUiController = null;
  var freeBoardUi = null;
  var customSpreadsUi = null;

  function cacheElements() {
    el.settings = document.getElementById("settings");
    el.settingsToggle = document.getElementById("settingsToggle");
    el.deckSelect = document.getElementById("deckSelect");
    el.modeSelect = document.getElementById("modeSelect");
    el.layoutModeSelect = document.getElementById("layoutModeSelect");
    el.arcanaFilter = document.getElementById("arcanaFilter");
    el.arcanaFilterGroup = document.getElementById("arcanaFilterGroup");
    el.overviewMethod = document.getElementById("overviewMethod");
    el.overviewMethodGroup = document.getElementById("overviewMethodGroup");
    el.overviewMethodSummary = document.getElementById("overviewMethodSummary");
    el.spreadSelect = document.getElementById("spreadSelect");
    el.spreadSettingGroup = document.querySelector(".setting-group-spread");
    el.spreadSettingSummary = document.getElementById("spreadSettingSummary");
    el.shuffleBtn = document.getElementById("shuffleBtn");
    el.switchArcanaBtn = document.getElementById("switchArcanaBtn");
    el.deckArea = document.querySelector(".deck-area");
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
    el.freeBoardArea = document.getElementById("freeBoardArea");
  }

  function t(key, values) {
    return globalThis.DivinationI18n
      ? globalThis.DivinationI18n.t(key, values)
      : key;
  }

  function localized(value, field) {
    if (!value) return "";
    return globalThis.DivinationI18n
      ? globalThis.DivinationI18n.field(value, field)
      : value[field];
  }

  function localizedCardName(card) { return localized(card, "name"); }
  function localizedSpreadName(spreadDefinition) { return localized(spreadDefinition, "name"); }
  function localizedPositionMeaning(position) { return localized(position, "meaning"); }
  function localizedRuleLabel(rule) { return localized(rule, "label"); }
  function localizedCardSource(card) {
    if (globalThis.DivinationI18n && globalThis.DivinationI18n.isEnglish()) {
      if (card && card.sourceEn) return card.sourceEn;
      if (card && card.deck === "mystagogus") return t("source.mystagogus");
      if (card && card.deck === "lxxxi") return t("source.lxxxi");
      return t("source.tarot");
    }
    return (card && card.source) || quareiaSource;
  }

  function getEntryInterpretation(entry) {
    var showReversed = mode === "mixed" && entry.orientation !== "upright";
    return {
      keywords: localized(
        entry.card,
        showReversed ? "reversedKeywords" : "uprightKeywords"
      ) || [],
      meaning: localized(
        entry.card,
        showReversed ? "reversedMeaning" : "uprightMeaning"
      ) || ""
    };
  }

  function isFreeform() {
    return layoutMode === "freeform";
  }

  function freeBoardDeckName(type) {
    return t("deck.name." + type) || type;
  }

  function allDecksForFreeBoard() {
    return {
      tarot: typeof tarotDeckFull !== "undefined" ? tarotDeckFull : [],
      mystagogus: typeof mystagogusDeckFull !== "undefined" ? mystagogusDeckFull : [],
      lxxxi: typeof lxxxiDeckFull !== "undefined" ? lxxxiDeckFull : []
    };
  }

  function freeBoardCardsForDeck(type, filter) {
    var decks = allDecksForFreeBoard();
    var cards = (decks[type] || []).slice();
    if (type !== "tarot") return cards;
    var majors = cards.filter(function (card) { return card.arcana === "major"; });
    var minors = cards.filter(function (card) { return card.arcana === "minor"; });
    if (filter === "major-only") return majors;
    if (filter === "minor-only") return minors;
    // Free Board keeps both phases in the pile. The ordered concatenation is
    // important: phase filters must not silently stop after the first phase.
    if (filter === "major-then-minor") return majors.concat(minors);
    if (filter === "minor-then-major") return minors.concat(majors);
    return cards;
  }

  function freeBoardContext() {
    var filter = deckType === "tarot" ? arcanaFilter : "not-applicable";
    return {
      deckType: deckType,
      deckName: freeBoardDeckName(deckType),
      mode: deckType === "tarot" ? mode : "upright-only",
      filterMode: filter,
      cards: shuffle(freeBoardCardsForDeck(deckType, filter)),
      allDecks: allDecksForFreeBoard(),
      backImage: deckBackImage(deckType)
    };
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

  /* 自由模式的牌池只看当前牌组与筛选条件，不继承预设牌阵剩下的牌
     （预设牌阵会因为牌位规则只留一部分牌，例如四季牌阵只留 14 张权杖） */
  function freeformDeckCards() {
    return freeBoardCardsForDeck(deckType, deckType === "tarot" ? arcanaFilter : "not-applicable");
  }

  function buildPile() {
    if (isFreeform()) {
      pile = shuffle(freeformDeckCards());
      return;
    }
    pile = shuffle(activeDeckCards());
    if (isOverviewStacking()) {
      pile = getAvailableOverviewStackingCards(pile, spread, currentPhase);
    } else if (currentPositionDrawRule()) {
      pile = getAvailableCardsForDrawRule(pile, spread, currentPositionDrawRule());
    }
  }

  function customSpreadSupportsDeck(spreadDefinition, requestedDeckType) {
    if (!spreadDefinition || !spreadDefinition.isCustom) return true;
    if (globalThis.DivinationCustomSpreads &&
        typeof globalThis.DivinationCustomSpreads.supportsDeck === "function") {
      return globalThis.DivinationCustomSpreads.supportsDeck(spreadDefinition, requestedDeckType);
    }
    if (spreadDefinition.deckScope === "tarot-only") return requestedDeckType === "tarot";
    if (spreadDefinition.deckScope === "non-tarot-only") return requestedDeckType !== "tarot";
    return true;
  }

  function customSpreadTarotFilter(spreadDefinition, requestedDeckType, requestedFilter) {
    if (!spreadDefinition || !spreadDefinition.isCustom || requestedDeckType !== "tarot") {
      return requestedFilter;
    }
    if (globalThis.DivinationCustomSpreads &&
        typeof globalThis.DivinationCustomSpreads.requiredTarotMode === "function") {
      return globalThis.DivinationCustomSpreads.requiredTarotMode(spreadDefinition);
    }
    return spreadDefinition.tarotMode || requestedFilter;
  }

  function preferredDeckForCustomSpread(spreadDefinition, currentDeckType) {
    if (customSpreadSupportsDeck(spreadDefinition, currentDeckType)) return currentDeckType;
    if (spreadDefinition && spreadDefinition.deckScope === "tarot-only") return "tarot";
    if (spreadDefinition && spreadDefinition.deckScope === "non-tarot-only") return "mystagogus";
    return currentDeckType;
  }

  function selectedSpread() {
    var custom = customSpreadsUi && customSpreadsUi.getById(selectedSpreadId);
    return custom && customSpreadSupportsDeck(custom, deckType)
      ? custom
      : getSpreadById(deckType, selectedSpreadId);
  }

  function isReadingComplete() {
    if (isFreeform()) return false;
    return spread.length === spreadTargetCount() && nextOpenSlotIndex() === -1;
  }

  function createCurrentHistoryRecord() {
    if (isFreeform()) throw new Error("Free Board saves history after Reveal All");
    if (!isReadingComplete()) throw new Error("Reading is not complete");
    var activeSpread = selectedSpread();
    var deckNames = {
      tarot: "RWS 塔罗",
      mystagogus: "Mystagogus",
      lxxxi: "LXXXI"
    };
    return globalThis.DivinationHistoryRecords.buildReadingRecord({
      deckType: deckType,
      deckMode: deckType,
      deckName: deckNames[deckType],
      spreadId: activeSpread.id,
      spreadName: activeSpread.name,
      orientationMode: deckType === "tarot" ? mode : "upright-only",
      filterMode: deckType === "tarot" ? arcanaFilter : "not-applicable",
      overviewMethod: isOverviewStacking()
        ? "stacked"
        : deckType === "tarot" && activeSpread.id === "overview"
          ? overviewMethod
          : "not-applicable",
      positions: activeSpread.positions,
      entries: orderedSpreadEntries()
    });
  }

  function isOverviewStacking() {
    var activeSpread = selectedSpread();
    var customStacking = Boolean(
      activeSpread && activeSpread.isCustom &&
      globalThis.DivinationCustomSpreads &&
      typeof globalThis.DivinationCustomSpreads.isMajorMinorStacking === "function" &&
      globalThis.DivinationCustomSpreads.isMajorMinorStacking(activeSpread, deckType)
    );
    return isOverviewStackingMode(deckType, selectedSpreadId, overviewMethod) || customStacking;
  }

  function hasCustomTarotMode() {
    var activeSpread = selectedSpread();
    return deckType === "tarot" && Boolean(activeSpread && activeSpread.isCustom);
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
    if (isFreeform()) return 0;
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
    var label = t("app.deckAria.tarot");
    if (deckType === "mystagogus") label = t("app.deckAria.mystagogus");
    else if (deckType === "lxxxi") label = t("app.deckAria.lxxxi");
    else if (drawRule) {
      label = t("app.deckAriaRule", { label: label, rule: localizedRuleLabel(drawRule) });
    }
    el.deckSpread.setAttribute("aria-label", label);
  }

  function setOverviewMethodVisibility(visible) {
    if (!el.overviewMethodGroup) return;
    el.overviewMethodGroup.style.display = visible ? "" : "none";
    el.overviewMethodGroup.hidden = !visible;
    el.overviewMethodGroup.setAttribute("aria-hidden", visible ? "false" : "true");
    var select = el.overviewMethod;
    var trigger = select && select.nextElementSibling;
    if (trigger && trigger.classList && trigger.classList.contains("themed-select-trigger")) {
      trigger.style.display = visible ? "" : "none";
      trigger.hidden = !visible;
      trigger.setAttribute("aria-hidden", visible ? "false" : "true");
    }
  }

  function updateOverviewMethodUi() {
    setOverviewMethodVisibility(
      layoutMode === "preset" && deckType === "tarot" && selectedSpreadId === "overview"
    );
  }

  function applyDeckUi() {
    var nonTarot = isNonTarotDeck();
    updateOverviewMethodUi();
    if (el.arcanaFilterGroup) {
      el.arcanaFilterGroup.style.display =
        nonTarot || (!isFreeform() &&
          (isOverviewStacking() || hasPositionDrawRules() || hasCustomTarotMode())) ? "none" : "";
    }
    if (el.overviewMethodSummary) {
      el.overviewMethodSummary.textContent = isOverviewStacking()
        ? t("app.overviewStackedSummary")
        : t("app.overviewSingleSummary");
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

  function applyLayoutUi() {
    var freeform = isFreeform();
    var layoutButton = document.getElementById("freeBoardOpenBtn");
    if (layoutButton) {
      var key = freeform ? "freeBoard.backToPreset" : "freeBoard.open";
      layoutButton.setAttribute("data-i18n", key);
      layoutButton.textContent = t(key);
    }
    var hint = document.getElementById("freeBoardOpenHint");
    if (hint) hint.hidden = freeform;
    var tableArea = document.getElementById("tableArea");
    /* the fan stays on the table in freeform: it is the card source */
    if (tableArea) {
      tableArea.style.display = "";
      tableArea.classList.toggle("is-freeform", freeform);
    }
    if (el.deckArea) el.deckArea.style.display = freeform ? "none" : "";
    if (el.spreadArea) el.spreadArea.style.display = freeform ? "none" : "";
    var spreadActions = document.querySelector(".spread-actions");
    /* 自由模式下也要能一键开牌：这排动作始终留在页面上 */
    if (spreadActions) spreadActions.style.display = "";
    var deckCta = document.getElementById("deckCta");
    if (deckCta) deckCta.style.display = freeform ? "none" : "";
    if (el.positionGuide) el.positionGuide.hidden = freeform;
    if (el.resultsSection) el.resultsSection.style.display = freeform ? "none" : "";
    updateOverviewMethodUi();
    /* 自由模式下“牌阵设置”仍然可用（从这里可以换回预设牌阵） */
    if (el.spreadSettingGroup) el.spreadSettingGroup.style.display = "";
    if (el.freeBoardArea) {
      el.freeBoardArea.hidden = !freeform;
      el.freeBoardArea.setAttribute("aria-hidden", freeform ? "false" : "true");
    }
    if (freeBoardUi && typeof freeBoardUi.setVisible === "function") {
      freeBoardUi.setVisible(freeform);
    }
    if (freeform) renderFreeformFan();
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
    freeDrawn.length = 0;
    freeRedo.length = 0;
    freeBoardReadingReported = false;
    if (isFreeform()) {
      /* freeform keeps the deck on the table: a reshuffle means a freshly
         built (and shuffled) pile, not just putting the drawn cards back */
      buildPile();
      renderFreeformFan();
      scheduleFreeformDraft();
      return;
    }
    currentPhase = "major";
    spread = [];
    readingReported = false;
    buildPile();
    renderSpreadCards();
    renderDeckSpread();
    renderSpreadMeta();
    renderResults();
  }

  function getOrientationLabel(o) {
    return o === "upright" ? t("orientation.upright") : t("orientation.reversed");
  }

  var MYSTAGOGUS_BACK = "assets/cards/m/m-back.jpeg";
  var LXXXI_BACK = LXXXI_ASSET_BASE_URL + "/backs/lxxxi-back.webp";

  // Non-tarot decks (Mystagogus, LXXXI) use a fixed deck back and no arcana filter.
  function isNonTarotDeck() {
    return deckType === "mystagogus" || deckType === "lxxxi";
  }

  function deckBackImage(type) {
    type = type || deckType;
    if (type === "lxxxi") return LXXXI_BACK;
    if (type === "mystagogus") return MYSTAGOGUS_BACK;
    return "";
  }

  function createCardImage(card, className, orientation) {
    var img = document.createElement("img");
    img.className = className + (orientation === "reversed" ? " reversed" : "");
    img.src = card.image;
    img.alt = localizedCardName(card);
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
    var label = document.createElement("span");
    label.className = baseClass + "-" +
      (globalThis.DivinationI18n && globalThis.DivinationI18n.isEnglish() ? "en" : "zh");
    label.textContent = formatPositionName(position);
    wrap.appendChild(label);
    parent.appendChild(wrap);
    return wrap;
  }

  // ---------- Deck spread (pick any card) ----------
  /* ---------- freeform: cards drawn to the table ---------- */
  function freeRemainingIds() {
    var drawn = Object.create(null);
    freeDrawn.forEach(function (item) { drawn[item.id] = true; });
    return pile.filter(function (card) { return !drawn[card.id]; })
      .map(function (card) { return card.id; });
  }

  function freeIndex(id) {
    for (var i = 0; i < freeDrawn.length; i++) {
      if (freeDrawn[i].id === id) return i;
    }
    return -1;
  }

  function cardById(id) {
    for (var i = 0; i < pile.length; i++) {
      if (pile[i].id === id) return pile[i];
    }
    /* 已抽出的牌不在 pile 里（草稿恢复后尤其如此），回整副牌里找 */
    var full = freeformDeckCards();
    for (var k = 0; k < full.length; k++) {
      if (full[k].id === id) return full[k];
    }
    return null;
  }

  /* 抽出来的牌按列排在牌桌下方：每张都有自己的位置，连抽也不会互相盖住 */
  function freeDefaultPoint(index) {
    var layer = document.getElementById("freeDrawCards");
    var w = (layer && layer.clientWidth) || 640;
    var h = (layer && layer.clientHeight) || 460;
    var narrow = w < 620;
    var cols = narrow ? 2 : 4;
    var stepX = narrow ? 84 : 100;
    /* 行距按实际牌高算，牌一多也不会压住上一行 */
    var sample = document.querySelector(".free-table-card");
    var cardH = (sample && sample.offsetHeight) || (narrow ? 111 : 126);
    var stepY = cardH + (narrow ? 30 : 24);
    var col = index % cols;
    var row = Math.floor(index / cols);
    /* 牌层的顶边已经压到「一键开牌」下面了（见 renderFreeDraw），这里只排网格 */
    var baseY = 92;
    return {
      x: Math.round(Math.min(w - 56, (narrow ? 66 : 120) + col * stepX + row * 14)),
      y: Math.round(Math.min(h - 70, Math.max(70, baseY + row * stepY)))
    };
  }

  function buildFreeTableCard(item, index) {
    var card = cardById(item.id);
    if (!card) return null;
    var el = document.createElement("div");
    el.className = "spread-card free-table-card" + (item.revealed ? " revealed" : "");
    el.setAttribute("data-card-id", item.id);
    el.style.left = item.x + "px";
    el.style.top = item.y + "px";
    el.style.transform = "translate(-50%, -50%) rotate(" + (item.angle || 0) + "deg)";
    /* 未翻开的牌不给辅助技术读牌名，只报「第几张、未翻开」 */
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", item.revealed
      ? t("freeBoard.cardAria", {
          index: index + 1,
          name: localizedCardName(card),
          orientation: t(item.orientation === "reversed" ? "orientation.reversed" : "orientation.upright")
        })
      : t("freeBoard.cardHiddenAria", { index: index + 1 }));

    var inner = document.createElement("div");
    inner.className = "spread-card-inner";

    var back = document.createElement("div");
    back.className = "spread-card-face spread-card-back" +
      (deckType === "mystagogus" ? " spread-card-back-m" : "") +
      (deckType === "lxxxi" ? " spread-card-back-lxxxi" : "");
    var backArt = document.createElement("div");
    backArt.className = "spread-card-back-art";
    if (isNonTarotDeck()) backArt.appendChild(createBackArtImage("spread-card-back-img"));
    back.appendChild(backArt);

    var front = document.createElement("div");
    front.className = "spread-card-face spread-card-front";
    /* 逆位要靠 front 上的 reversed 类把牌面转 180°，只给 img 加类不会转 */
    if (item.orientation === "reversed") front.classList.add("reversed");
    if (!item.revealed) front.setAttribute("aria-hidden", "true");
    /* 方向在抽牌那一刻就定下来，翻面、重绘、撤销重做都沿用同一个结果 */
    var img = createCardImage(card, "card-image", item.orientation || "upright");
    if (!item.revealed) img.alt = "";
    if (deckType === "mystagogus") img.classList.add("card-image-m");
    if (deckType === "lxxxi") img.classList.add("card-image-lxxxi");
    front.appendChild(img);
    var caption = document.createElement("div");
    caption.className = "spread-card-caption";
    var nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = item.revealed ? localizedCardName(card) : "";
    caption.appendChild(nameEl);
    front.appendChild(caption);

    inner.appendChild(back);
    inner.appendChild(front);
    el.appendChild(inner);
    return el;
  }

  /* ---------- 自由画板：调整单张牌的角度 ---------- */
  var freeAngleItem = null;
  var freeAngleEl = null;

  function freeAnglePanel() {
    var panel = document.getElementById("freeAnglePanel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "free-angle";
    panel.id = "freeAnglePanel";
    panel.hidden = true;
    panel.setAttribute("role", "group");
    panel.innerHTML =
      '<p class="free-angle-title" data-angle-title>角度</p>' +
      '<div class="free-angle-row">' +
      '<button type="button" data-angle-step="-15" aria-label="逆时针 15 度">↺</button>' +
      '<span class="free-angle-value" data-angle-value>0°</span>' +
      '<button type="button" data-angle-step="15" aria-label="顺时针 15 度">↻</button>' +
      '</div>' +
      '<button type="button" class="free-angle-reset" data-angle-reset>复位</button>' +
      '<button type="button" class="free-angle-close" data-angle-close aria-label="关闭">×</button>';
    document.body.appendChild(panel);
    panel.addEventListener("click", function (ev) {
      var stepBtn = ev.target.closest("[data-angle-step]");
      if (stepBtn) {
        ev.stopPropagation();
        applyFreeAngle(freeAngleItem, freeAngleEl, Number(stepBtn.getAttribute("data-angle-step")));
        return;
      }
      if (ev.target.closest("[data-angle-reset]")) {
        ev.stopPropagation();
        setFreeAngle(freeAngleItem, freeAngleEl, 0);
        return;
      }
      if (ev.target.closest("[data-angle-close]")) {
        ev.stopPropagation();
        hideFreeAngle();
      }
    });
    document.addEventListener("pointerdown", function (ev) {
      var p = document.getElementById("freeAnglePanel");
      if (!p || p.hidden) return;
      if (p.contains(ev.target)) return;
      if (freeAngleEl && freeAngleEl.contains(ev.target)) return;
      hideFreeAngle();
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") hideFreeAngle();
    });
    return panel;
  }

  function hideFreeAngle() {
    var panel = document.getElementById("freeAnglePanel");
    if (panel) panel.hidden = true;
    if (freeAngleEl) freeAngleEl.classList.remove("is-tuning");
    freeAngleItem = null;
    freeAngleEl = null;
  }

  function setFreeAngle(item, el, angle) {
    if (!item || !el) return;
    var normalized = ((angle % 360) + 360) % 360;
    if (normalized > 180) normalized -= 360;
    item.angle = normalized;
    el.style.transform = "translate(-50%, -50%) rotate(" + normalized + "deg)";
    var panel = document.getElementById("freeAnglePanel");
    var value = panel && panel.querySelector("[data-angle-value]");
    if (value) value.textContent = normalized + "°";
    scheduleFreeformDraft();
  }

  function applyFreeAngle(item, el, delta) {
    if (!item) return;
    setFreeAngle(item, el, (item.angle || 0) + delta);
  }

  function openFreeAngle(el, item) {
    var panel = freeAnglePanel();
    var title = panel.querySelector("[data-angle-title]");
    if (title) title.textContent = t("freeBoard.angleTitle");
    freeAngleItem = item;
    freeAngleEl = el;
    el.classList.add("is-tuning");
    var value = panel.querySelector("[data-angle-value]");
    if (value) value.textContent = (item.angle || 0) + "°";
    panel.hidden = false;
    var rect = el.getBoundingClientRect();
    var box = panel.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(12, Math.min(window.innerWidth - box.width - 12, left));
    var top = rect.bottom + 10;
    if (top + box.height > window.innerHeight - 12) top = Math.max(12, rect.top - box.height - 10);
    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
  }
  function bindFreeTableCard(el, item) {
    var angleTimer = 0;
    var longPressed = false;
    /* 长按（触屏）/ 右键（鼠标）：调这张牌的角度 */
    el.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      openFreeAngle(el, item);
    });
    el.addEventListener("pointerdown", function (ev) {
      longPressed = false;
      angleTimer = window.setTimeout(function () {
        longPressed = true;
        openFreeAngle(el, item);
      }, 520);
    });
    var cancelAngleTimer = function () {
      if (angleTimer) window.clearTimeout(angleTimer);
      angleTimer = 0;
    };
    el.addEventListener("pointerup", cancelAngleTimer);
    el.addEventListener("pointercancel", cancelAngleTimer);
    el.addEventListener("pointermove", function (ev) {
      if (Math.abs(ev.movementX || 0) + Math.abs(ev.movementY || 0) > 3) cancelAngleTimer();
    });

    /* 键盘与读屏用户：Tab 到牌上，Enter / 空格翻面；R 键旋转 */
    el.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " " && ev.key !== "Spacebar") return;
      ev.preventDefault();
      if (item.revealed) return;
      revealFreeCards([item]);
      var button = document.querySelector('.free-table-card[data-card-id="' + item.id + '"]');
      if (button) button.focus({ preventScroll: true });
    });
    el.addEventListener("click", function (ev) {
      if (ev.detail === 0) revealFreeCards([item]);
    });
    el.addEventListener("pointerdown", function (ev) {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      var startX = ev.clientX;
      var startY = ev.clientY;
      var originX = item.x;
      var originY = item.y;
      var moved = false;
      el.style.zIndex = String(++freeZ);
      if (el.setPointerCapture) {
        try { el.setPointerCapture(ev.pointerId); } catch (_e) { /* ignore */ }
      }
      function onMove(moveEv) {
        var dx = moveEv.clientX - startX;
        var dy = moveEv.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        item.x = originX + dx;
        item.y = originY + dy;
        el.style.left = item.x + "px";
        el.style.top = item.y + "px";
      }
      function onEnd(endEvent) {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onEnd);
        el.removeEventListener("pointercancel", onEnd);
        if (!moved && !longPressed && endEvent.type === "pointerup" && !item.revealed) {
          revealFreeCards([item]);
        } else {
          scheduleFreeformDraft();
        }
      }
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onEnd);
      el.addEventListener("pointercancel", onEnd);
      ev.preventDefault();
    });
  }

  /* 自由画板：一键开牌的可用状态跟着已抽出的牌走 */
  function syncFreeActions() {
    if (!isFreeform() || !el.revealBtn) return;
    var total = freeDrawn.length;
    var revealed = 0;
    freeDrawn.forEach(function (item) { if (item.revealed) revealed += 1; });
    el.revealBtn.disabled = total === 0 || revealed === total;
    el.revealBtn.textContent = total > 0 && revealed === total ? t("app.revealedAll") : t("spread.reveal");
  }

  function renderFreeDraw() {
    var wrap = document.getElementById("freeDraw");
    if (!wrap) return;
    wrap.hidden = !isFreeform();
    var box = document.getElementById("freeDrawCards");
    if (box) {
      box.innerHTML = "";
      var layerW = box.clientWidth;
      var layerH = box.clientHeight;
      freeDrawn.forEach(function (item, index) {
        if (legacyViewport && layerW && layerH) {
          // The original board used world coordinates anchored at its center.
          item.x = layerW / 2 + legacyViewport.panX + item.x * legacyViewport.zoom;
          item.y = layerH / 2 + legacyViewport.panY + item.y * legacyViewport.zoom;
        }
        if (layerW) item.x = Math.max(46, Math.min(layerW - 46, item.x));
        if (layerH) item.y = Math.max(70, Math.min(layerH - 70, item.y));
        var el = buildFreeTableCard(item, index);
        if (!el) return;
        el.style.zIndex = String(10 + freeIndex(item.id));
        bindFreeTableCard(el, item);
        el.style.left = item.x + "px";
        el.style.top = item.y + "px";
        box.appendChild(el);
      });
      if (layerW && layerH) legacyViewport = null;
    }
    var undo = document.getElementById("freeUndoBtn");
    var redo = document.getElementById("freeRedoBtn");
    if (undo) undo.disabled = freeDrawn.length === 0;
    if (redo) redo.disabled = freeRedo.length === 0;
    syncFreeActions();
  }

  /* ---------- freeform draft ----------
     和旧画板用同一份 schema（free-board/v1），所以主分支存下的草稿也能恢复；
     画板面板移除后这块逻辑改由牌桌自己维护。 */
  var FREEFORM_DRAFT_KEY = "quareia-divination-free-board-draft-v1";
  var freeformDraftTimer = 0;
  var legacyViewport = null;
  var parkedDraft = null;

  function isShuffleRunning() {
    var ring = el.deckSpread && el.deckSpread.closest ? el.deckSpread.closest(".deck-ring") : null;
    return !!(ring && ring.classList.contains("is-shuffling"));
  }

  function freeformDraftPayload() {
    var drawn = Object.create(null);
    freeDrawn.forEach(function (item) { drawn[item.id] = true; });
    var decks = allDecksForFreeBoard();
    return {
      schema: "free-board/v1",
      layout: 3,
      presetSpreadId: selectedSpreadId,
      version: 1,
      layoutMode: "freeform",
      cards: freeDrawn.map(function (item, index) {
        return {
          cardId: item.id,
          orientation: item.orientation || "upright",
          x: Math.round(item.x),
          y: Math.round(item.y),
          boardRotation: item.angle || 0,
          z: index + 1,
          revealed: !!item.revealed,
          meaningVisible: false,
          drawOrder: index + 1
        };
      }),
      remainingPile: pile.filter(function (card) { return !drawn[card.id]; })
        .map(function (card) { return card.id; }),
      viewport: { panX: 0, panY: 0, zoom: 1 },
      deck: {
        id: deckType,
        deckId: deckType,
        deckName: freeBoardDeckName(deckType),
        cardIds: pile.map(function (card) { return card.id; }),
        cards: (decks[deckType] || []).map(function (card) {
          return {
            id: card.id,
            cardType: card.deck === "tarot" || deckType === "tarot" ? "tarot" : "non-tarot"
          };
        })
      },
      settings: {
        deckType: deckType,
        orientationMode: deckType === "tarot" ? mode : "upright-only",
        filterMode: deckType === "tarot" ? arcanaFilter : "not-applicable",
        overviewMethod: "not-applicable"
      }
    };
  }

  function saveFreeformDraftNow(park) {
    if (!isFreeform()) return;
    if (freeformDraftTimer) {
      window.clearTimeout(freeformDraftTimer);
      freeformDraftTimer = 0;
    }
    var draft = freeformDraftPayload();
    if (park) draft.parked = true;
    parkedDraft = park ? draft : null;
    try {
      window.localStorage.setItem(FREEFORM_DRAFT_KEY, JSON.stringify(draft));
    } catch (_error) { /* storage disabled or full */ }
  }

  function scheduleFreeformDraft() {
    if (!isFreeform()) return;
    if (freeformDraftTimer) window.clearTimeout(freeformDraftTimer);
    freeformDraftTimer = window.setTimeout(function () {
      freeformDraftTimer = 0;
      saveFreeformDraftNow();
    }, 400);
  }

  function clearFreeformDraft() {
    parkedDraft = null;
    if (freeformDraftTimer) {
      window.clearTimeout(freeformDraftTimer);
      freeformDraftTimer = 0;
    }
    try { window.localStorage.removeItem(FREEFORM_DRAFT_KEY); } catch (_error) { /* ignore */ }
  }

  /* -1 = nothing to restore; otherwise the number of restored cards */
  function restoreFreeformDraft(resumeParked) {
    var draft = resumeParked ? parkedDraft : null;
    if (!draft) {
      try {
        draft = JSON.parse(window.localStorage.getItem(FREEFORM_DRAFT_KEY));
      } catch (_error) { return -1; }
    }
    if (draft && Boolean(draft.parked) !== Boolean(resumeParked)) return -1;
    if (!draft || draft.layoutMode !== "freeform" || !Array.isArray(draft.cards)) return -1;
    var settings = draft.settings || {};
    var type = settings.deckType || (draft.deck && (draft.deck.deckId || draft.deck.id));
    if (type !== "tarot" && type !== "mystagogus" && type !== "lxxxi") return -1;
    if (!resumeParked && typeof draft.presetSpreadId === "string") selectedSpreadId = draft.presetSpreadId;
    deckType = type;
    mode = settings.orientationMode === "mixed" && type === "tarot" ? "mixed" : "upright-only";
    if (type === "tarot" && [
      "mixed", "major-only", "minor-only", "major-then-minor", "minor-then-major"
    ].indexOf(settings.filterMode) !== -1) {
      arcanaFilter = settings.filterMode;
    }
    var byId = Object.create(null);
    (allDecksForFreeBoard()[type] || []).forEach(function (card) { byId[card.id] = card; });
    var drawnIds = Object.create(null);
    var cards = draft.cards.filter(function (item) {
      if (!item || !byId[item.cardId] || drawnIds[item.cardId]) return false;
      drawnIds[item.cardId] = true;
      return true;
    });
    /* remainingPile 是权威值：空数组表示牌堆真的抽空了，不能回退成整副牌 */
    var remaining;
    if (Array.isArray(draft.remainingPile)) {
      remaining = draft.remainingPile.filter(function (id) { return byId[id] && !drawnIds[id]; });
    } else {
      remaining = freeformDeckCards().map(function (card) { return card.id; })
        .filter(function (id) { return !drawnIds[id]; });
    }
    // Reinsert drawn cards in their original slots so undo returns them to the fan.
    // Older drafts may only list the remaining pile in deck.cardIds.
    var pileIds = Array.from(new Set(remaining));
    var missing = new Set(cards.map(function (item) { return item.cardId; }));
    if (draft.deck && Array.isArray(draft.deck.cardIds)) {
      draft.deck.cardIds.forEach(function (id, index) {
        if (missing.delete(id)) pileIds.splice(index, 0, id);
      });
    }
    pile = pileIds.concat(Array.from(missing)).map(function (id) { return byId[id]; });
    var restored = [];
    cards.forEach(function (item, index) {
      var point = freeDefaultPoint(index);
      restored.push({
        id: item.cardId,
        x: typeof item.x === "number" ? item.x : point.x,
        y: typeof item.y === "number" ? item.y : point.y,
        revealed: !!item.revealed,
        angle: typeof item.boardRotation === "number" ? item.boardRotation : 0,
        orientation: item.orientation === "reversed" ? "reversed" : "upright"
      });
    });
    freeDrawn = restored;
    var view = draft.viewport || {};
    legacyViewport = draft.layout === 3 ? null : {
      panX: Number.isFinite(view.panX) ? view.panX : 0,
      panY: Number.isFinite(view.panY) ? view.panY : 0,
      zoom: Number.isFinite(view.zoom) && view.zoom > 0 ? view.zoom : 1
    };
    freeRedo.length = 0;
    return freeDrawn.length;
  }

  function drawFreeCard(cardId) {
    if (!isFreeform() || !cardId) return;
    /* 洗牌动画期间牌被藏起来，但点击仍然会落到最近的牌上，这里直接挡住 */
    if (isShuffleRunning()) return;
    if (freeIndex(cardId) !== -1 || !cardById(cardId)) return;
    var point = freeDefaultPoint(freeDrawn.length);
    freeDrawn.push({
      id: cardId,
      x: point.x,
      y: point.y,
      revealed: false,
      angle: 0,
      orientation: orientationFor()
    });
    freeRedo.length = 0;
    renderFreeformFan();
    scheduleFreeformDraft();
  }

  function undoFreeDraw() {
    if (!isFreeform() || !freeDrawn.length) return;
    freeRedo.push(freeDrawn.pop());
    renderFreeformFan();
    scheduleFreeformDraft();
  }

  function redoFreeDraw() {
    if (!isFreeform() || !freeRedo.length) return;
    freeDrawn.push(freeRedo.pop());
    renderFreeformFan();
    scheduleFreeformDraft();
  }
  function renderFreeformFan() {
    if (!el.deckSpread) return;
    el.deckSpread.innerHTML = "";
    var boardState = freeBoardUi && freeBoardUi.getState ? freeBoardUi.getState() : null;
    /* 没有画板时（画板面板已移除）就退回本局自己的牌堆 */
    var remaining = boardState && boardState.remainingPile ? boardState.remainingPile
      : freeRemainingIds();
    el.deckSpread.classList.toggle("empty", remaining.length === 0);
    if (!remaining.length) {
      el.deckSpread.textContent = t("app.deckEmpty");
      if (el.deckRemaining) el.deckRemaining.textContent = t("app.remaining", { count: 0 });
      renderFreeDraw();
      renderResults();
      return;
    }
    remaining.forEach(function (cardId, index) {
      var cardEl = document.createElement("button");
      cardEl.type = "button";
      cardEl.className = "deck-card deck-card-free";
      cardEl.setAttribute("data-card-id", cardId);
      cardEl.setAttribute("data-pile-index", String(index));
      cardEl.setAttribute("aria-label", t("freeBoard.pileAria"));
      if (isNonTarotDeck()) cardEl.appendChild(createBackArtImage("deck-card-back-img"));
      cardEl.addEventListener("click", function () { drawFreeCard(cardId); });
      el.deckSpread.appendChild(cardEl);
    });
    if (el.deckRemaining) {
      el.deckRemaining.textContent = t("app.remaining", { count: remaining.length });
    }
    renderFreeDraw();
    renderResults();
  }

  function renderDeckSpread() {
    if (isFreeform()) {
      renderFreeformFan();
      return;
    }
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
        ? t("app.deckEmptyPhase")
        : t("app.deckEmpty");
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
          ? (currentPhase === "major" ? t("app.layerMajorBase") : t("app.layerMinorTop"))
          : drawRule ? " · " + localizedRuleLabel(drawRule) : "";
        cardEl.setAttribute("aria-label", spreadIsFull
          ? t("app.deckComplete")
          : t("app.drawAria", {
              index: index + 1,
              position: formatPositionName(nextPosition, "slash"),
              selection: stacking ? " · " + selectionLabel : selectionLabel
            }));
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

    var remainingPrefix = stacking
      ? (currentPhase === "major" ? t("arcana.major") : t("arcana.minor"))
      : drawRule ? localizedRuleLabel(drawRule) : "";
    el.deckRemaining.textContent = remainingPrefix
      ? t("app.remainingWithPrefix", { prefix: remainingPrefix, count: pile.length })
      : t("app.remaining", { count: pile.length });

    if (spreadIsFull) {
      el.deckCta.classList.add("complete");
      el.deckCta.classList.remove("empty");
      el.deckCta.textContent = stacking
        ? t("app.overviewComplete")
        : t("app.spreadComplete", {
            spread: localizedSpreadName(selectedSpread())
          });
    } else if (pile.length === 0) {
      el.deckCta.classList.add("empty");
      el.deckCta.classList.remove("complete");
      el.deckCta.textContent = t("app.pileEmptyCta");
    } else {
      el.deckCta.classList.remove("empty");
      el.deckCta.classList.remove("complete");
      var nextPosition = selectedSpread().positions[nextOpenSlotIndex()];
      if (stacking) {
        var layerInstruction = currentPhase === "major"
          ? t("app.majorInstruction")
          : t("app.minorInstruction");
        el.deckCta.textContent = t("app.nextStacking", {
          number: nextPosition.number,
          position: formatPositionName(nextPosition, "slash"),
          instruction: layerInstruction
        });
      } else if (drawRule) {
        el.deckCta.textContent = t("app.nextRule", {
          number: nextPosition.number,
          position: formatPositionName(nextPosition, "slash"),
          rule: localizedRuleLabel(drawRule)
        });
      } else {
        el.deckCta.textContent = t("app.nextCard", {
          number: nextPosition.number,
          position: formatPositionName(nextPosition, "slash")
        });
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
  function updateSpreadCardAria(cardEl, entry, position) {
    var flipButton = cardEl && cardEl.querySelector(".spread-card-flip");
    if (!flipButton) return;
    var layer = isOverviewStacking()
      ? " · " + (entry.layer === "major" ? t("app.layerMajorBase") : t("app.layerMinorTop"))
      : "";
    flipButton.setAttribute(
      "aria-label",
      t(cardEl.classList.contains("meaning-visible") ? "app.meaningAria" : "app.revealedAria", {
        number: position.number,
        position: formatPositionName(position, "slash"),
        layer: layer,
        card: localizedCardName(entry.card),
        orientation: getOrientationLabel(entry.orientation)
      })
    );
    flipButton.setAttribute(
      "aria-pressed",
      String(cardEl.classList.contains("meaning-visible"))
    );
  }

  function buildSpreadCardEl(entry) {
    var card = entry.card;
    var position = selectedSpread().positions[entry.slotIndex];
    var stacking = isOverviewStacking() && Boolean(entry.layer);
    var layerName = entry.layer === "major"
      ? t("app.layerMajorBase")
      : t("app.layerMinorTop");

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
    cardEl.style.setProperty("--position-rotation", (position.rotation || 0) + "deg");
    cardEl.style.zIndex = String(position.number + (stacking && entry.layer === "minor" ? 100 : 0));

    var flipButton = document.createElement("button");
    flipButton.className = "spread-card-flip";
    flipButton.type = "button";
    flipButton.setAttribute(
      "aria-label",
      t("app.flipAria", {
        number: position.number,
        position: formatPositionName(position, "slash"),
        layer: stacking ? " · " + layerName : ""
      })
    );

    var inner = document.createElement("div");
    inner.className = "spread-card-inner";

    var back = document.createElement("div");
    back.className = "spread-card-face spread-card-back" +
      (deckType === "mystagogus" ? " spread-card-back-m" : "") +
      (deckType === "lxxxi" ? " spread-card-back-lxxxi" : "");
    var backArt = document.createElement("div");
    backArt.className = "spread-card-back-art";
    back.appendChild(backArt);
    if (isNonTarotDeck()) {
      backArt.appendChild(createBackArtImage("spread-card-back-img"));
    }
    var posNum = document.createElement("span");
    posNum.className = "pos-num";
    posNum.textContent = position.number;
    backArt.appendChild(posNum);
    if (position.drawRule) {
      var drawRuleBadge = document.createElement("span");
      drawRuleBadge.className = "draw-rule-badge";
      drawRuleBadge.textContent = localizedRuleLabel(position.drawRule);
      backArt.appendChild(drawRuleBadge);
    }
    if (stacking) {
      var layerBadge = document.createElement("span");
      layerBadge.className = "stack-layer-badge";
      layerBadge.textContent = entry.layer === "major"
        ? t("app.layerMajorCause")
        : t("app.layerMinorEffect");
      backArt.appendChild(layerBadge);
    }
    appendPositionLabels(backArt, position, "pos-name");

    var interpretation = getEntryInterpretation(entry);
    var meaningPanel = document.createElement("div");
    meaningPanel.className = "spread-card-meaning";
    var meaningKicker = document.createElement("span");
    meaningKicker.className = "spread-card-meaning-kicker";
    meaningKicker.textContent = t("app.meaningTitle");
    var meaningName = document.createElement("strong");
    meaningName.className = "spread-card-meaning-name";
    meaningName.textContent = localizedCardName(card);
    var meaningKeywords = document.createElement("span");
    meaningKeywords.className = "spread-card-meaning-keywords";
    meaningKeywords.textContent = interpretation.keywords.join(" · ");
    var meaningText = document.createElement("span");
    meaningText.className = "spread-card-meaning-text";
    meaningText.textContent = interpretation.meaning;
    meaningPanel.appendChild(meaningKicker);
    meaningPanel.appendChild(meaningName);
    if (interpretation.keywords.length) meaningPanel.appendChild(meaningKeywords);
    meaningPanel.appendChild(meaningText);
    back.appendChild(meaningPanel);

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
      captionLayer.textContent = entry.layer === "major"
        ? t("app.layerMajorCaption")
        : t("app.layerMinorCaption");
      caption.appendChild(captionLayer);
    }
    var nameEl = document.createElement("span");
    nameEl.className = "name";
    nameEl.textContent = localizedCardName(card);
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
    removeBtn.setAttribute("aria-label", stacking
      ? t("app.removeLayerAria", { number: position.number, layer: layerName })
      : t("app.removeCardAria", { number: position.number }));
    removeBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      removeEntry(entry, ev.detail === 0);
    });
    cardEl.appendChild(removeBtn);

    flipButton.addEventListener("click", function () {
      if (!entry.revealed) {
        revealEntry(entry);
        return;
      }
      /* 牌意放到牌谱外面的浮层里读：牌本身不再被放大挤字 */
      var same = entry.meaningVisible && meaningAnchor === cardEl;
      entry.meaningVisible = !same;
      cardEl.classList.toggle("meaning-visible", entry.meaningVisible);
      if (entry.meaningVisible) {
        showCardMeaning(cardEl, entry, position);
      } else {
        hideCardMeaning();
      }
      updateSpreadCardAria(cardEl, entry, position);
    });

    if (entry.revealed) {
      cardEl.classList.add("revealed");
      cardEl.classList.toggle("meaning-visible", Boolean(entry.meaningVisible));
      updateSpreadCardAria(cardEl, entry, position);
    }
    return cardEl;
  }

  /* ---------- floating card-meaning sheet ---------- */
  var meaningAnchor = null;
  var meaningEntries = new WeakMap();

  function hideCardMeaning() {
    var panel = document.getElementById("cardMeaningPanel");
    if (panel) panel.hidden = true;
    if (meaningAnchor) {
      meaningAnchor.classList.remove("meaning-visible");
      var entryRef = meaningEntries.get(meaningAnchor);
      if (entryRef) entryRef.meaningVisible = false;
      meaningAnchor = null;
    }
  }

  function showCardMeaning(cardEl, entry, position) {
    var panel = document.getElementById("cardMeaningPanel");
    if (!panel || !entry || !entry.card) return;
    hideCardMeaning();
    var interpretation = getEntryInterpretation(entry);
    var setText = function (selector, value) {
      var node = panel.querySelector(selector);
      if (node) node.textContent = value;
    };
    setText("[data-meaning-kicker]", t("app.meaningTitle"));
    setText("[data-meaning-name]", localizedCardName(entry.card));
    setText("[data-meaning-meta]", [
      (position.number ? position.number + '. ' : '') + position.name,
      t(entry.orientation === "reversed" ? "orientation.reversed" : "orientation.upright")
    ].join(" · "));
    setText("[data-meaning-keywords]", interpretation.keywords.join(" · "));
    setText("[data-meaning-text]", interpretation.meaning || "");

    panel.hidden = false;
    var rect = cardEl.getBoundingClientRect();
    var box = panel.getBoundingClientRect();
    var left = rect.left + rect.width / 2 - box.width / 2;
    left = Math.max(12, Math.min(window.innerWidth - box.width - 12, left));
    var top = rect.top - box.height - 12;
    if (top < 12) top = rect.bottom + 12;
    if (top + box.height > window.innerHeight - 12) {
      top = Math.max(12, window.innerHeight - box.height - 12);
    }
    panel.style.left = Math.round(left) + "px";
    panel.style.top = Math.round(top) + "px";
    meaningEntries.set(cardEl, entry);
    meaningAnchor = cardEl;
  }
  /* close the meaning sheet on the usual escapes */
  document.addEventListener("pointerdown", function (event) {
    var panel = document.getElementById("cardMeaningPanel");
    if (!panel || panel.hidden) return;
    if (panel.contains(event.target) || (meaningAnchor && meaningAnchor.contains(event.target))) return;
    hideCardMeaning();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") hideCardMeaning();
  });
  var meaningCloseBtn = document.getElementById("cardMeaningClose");
  if (meaningCloseBtn) {
    meaningCloseBtn.addEventListener("click", function () { hideCardMeaning(); });
  }
  /* 面板在脚本之后才解析出来，直接绑会拿到 null；用事件委托兜住关闭按钮 */
  document.addEventListener("click", function (event) {
    if (!event.target || !event.target.closest) return;
    if (event.target.closest("#cardMeaningClose")) hideCardMeaning();
  });

  function renderSpreadCards() {
    if (isFreeform()) return;
    hideCardMeaning();
    var spreadDefinition = selectedSpread();
    var stacking = isOverviewStacking();
    var hadRenderedCards = Boolean(el.spreadGrid.querySelector(".spread-card"));
    var previousScrollLeft = el.spreadBoardScroll.scrollLeft;
    el.spreadGrid.innerHTML = "";
    el.spreadGrid.classList.toggle("overview-stacking", stacking);
    el.spreadGrid.classList.toggle("custom-spread-layout", Boolean(spreadDefinition.isCustom));
    el.spreadBoardScroll.classList.toggle("custom-spread-board", Boolean(spreadDefinition.isCustom));
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
      slot.style.setProperty("--position-rotation", (position.rotation || 0) + "deg");
      if (stacking) {
        slot.style.zIndex = String(position.number + (currentPhase === "minor" ? 100 : 0));
      }
      var slotNumber = document.createElement("span");
      slotNumber.textContent = position.number;
      slot.appendChild(slotNumber);
      if (stacking) {
        var slotLayer = document.createElement("span");
        slotLayer.className = "stack-slot-layer";
        slotLayer.textContent = currentPhase === "major"
          ? t("app.stackSlotMajor")
          : t("app.stackSlotMinor");
        slot.appendChild(slotLayer);
      }
      appendPositionLabels(slot, position, "slot-name");
      if (position.drawRule) {
        var slotDrawRule = document.createElement("span");
        slotDrawRule.className = "slot-draw-rule";
        slotDrawRule.textContent = localizedRuleLabel(position.drawRule);
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
    if (entry.revealed || spread.indexOf(entry) === -1) return;
    entry.revealed = true;
    var cardEl = getSpreadEl(entry);
    if (cardEl) {
      // The card has been in the DOM (face-down) since it was drawn, so toggling
      // the class here triggers the 3D flip transition directly.
      cardEl.classList.remove("is-new");
      cardEl.classList.add("revealed");
      var position = selectedSpread().positions[entry.slotIndex];
      updateSpreadCardAria(cardEl, entry, position);
    }
    renderSpreadMeta();
    renderResults();
    if (isReadingComplete() && spread.every(function (card) { return card.revealed; })) {
      completePresetReading();
    }
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

  function revealFreeCards(items) {
    if (!items.some(function (item) { return !item.revealed; })) return;
    items.forEach(function (item) { item.revealed = true; });
    renderFreeDraw();
    renderResults();
    saveFreeformDraftNow();
    if (freeDrawn.every(function (item) { return item.revealed; })) {
      saveFreeformHistory();
      notifyFreeformReadingCompleted();
    }
  }

  function revealAll() {
    if (isFreeform()) {
      revealFreeCards(freeDrawn);
      return;
    }
    var pending = spread.filter(function (e) { return !e.revealed; });
    pending.forEach(function (entry, i) {
      setTimeout(function () { revealEntry(entry); }, i * 80);
    });
    if (isReadingComplete()) completePresetReading();
  }

  function completePresetReading() {
    // Bulk reveal saves immediately. Its final animation and any manual flips
    // refer to the same reading until another card is drawn.
    if (historyUiController && lastSavedPresetUid !== uidCounter) {
      historyUiController.saveCompletedReading();
      lastSavedPresetUid = uidCounter;
    }
    notifyReadingCompleted();
  }

  // A full spread explicitly revealed, through Reveal All or individual flips.
  function notifyReadingCompleted() {
    if (readingReported) return;
    readingReported = true;
    try {
      var telemetry = globalThis.DivinationWebTelemetry;
      if (telemetry && telemetry.isEnabled()) telemetry.logReadingCompleted(deckType, spread.length);
    } catch (_error) { /* Statistics must never interrupt a reading. */ }
  }

  function notifyFreeformReadingCompleted() {
    if (freeBoardReadingReported) return;
    freeBoardReadingReported = true;
    try {
      var telemetry = globalThis.DivinationWebTelemetry;
      if (telemetry && telemetry.isEnabled()) {
        telemetry.logReadingCompleted(deckType, freeDrawn.length);
      }
    } catch (_error) { /* Statistics must never interrupt a reading. */ }
  }

  function freeformHistoryCards() {
    return freeDrawn.map(function (item, index) {
      var card = cardById(item.id);
      var name = card ? localizedCardName(card) : "";
      return {
        cardId: item.id,
        card: card,
        cardName: name || String(item.id),
        orientation: item.orientation || "upright",
        x: Math.round(item.x),
        y: Math.round(item.y),
        boardRotation: item.angle || 0,
        z: index + 1,
        revealed: !!item.revealed,
        meaningVisible: false,
        drawOrder: index + 1
      };
    });
  }

  function saveFreeformHistory() {
    if (!historyUiController || typeof historyUiController.saveFreeformReading !== "function") return;
    try {
      historyUiController.saveFreeformReading({
        cards: freeformHistoryCards(),
        deckType: deckType,
        deckMode: deckType,
        deckName: freeBoardDeckName(deckType),
        orientationMode: deckType === "tarot" ? mode : "upright-only",
        filterMode: deckType === "tarot" ? arcanaFilter : "not-applicable",
        overviewMethod: "not-applicable"
      });
    } catch (_error) { /* 历史写入失败不能打断占卜 */ }
  }

  function notifyFreeBoardReadingCompleted(state, reason) {
    if (!state || !Array.isArray(state.cards)) return;
    if (state.cards.length === 0 || (reason === "draw" && state.cards.length === 1)) {
      freeBoardReadingReported = false;
    }
    if (reason !== "reveal-all" || !state.cards.length || freeBoardReadingReported) return;
    freeBoardReadingReported = true;
    try {
      var telemetry = globalThis.DivinationWebTelemetry;
      if (telemetry && telemetry.isEnabled()) {
        telemetry.logReadingCompleted(state.settings.deckType, state.cards.length);
      }
    } catch (_error) { /* Statistics must never interrupt a reading. */ }
  }

  function renderSpreadMeta() {
    if (isFreeform()) {
      el.spreadArea.style.display = "none";
      el.resultsSection.style.display = "none";
      if (el.positionGuide) el.positionGuide.hidden = true;
      if (historyUiController) historyUiController.updateSaveAvailability(false);
      return;
    }
    if (el.positionGuide) el.positionGuide.hidden = false;
    el.spreadArea.style.display = "block";
    el.spreadArea.classList.toggle("is-empty", spread.length === 0);

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
    el.spreadTitle.textContent = localizedSpreadName(activeSpread);
    el.spreadCount.textContent = spread.length + " / " + spreadTargetCount();

    if (stacking) {
      el.phaseLabel.style.display = "inline-block";
      var stackingPhase = overviewStackingPhase();
      el.phaseLabel.textContent = stackingPhase === "complete"
        ? t("app.stackPhaseComplete")
        : currentPhase === "major"
          ? t("app.stackPhaseMajor")
          : t("app.stackPhaseMinor");
    } else if (hasPositionDrawRules()) {
      el.phaseLabel.style.display = "inline-block";
      var nextRule = currentPositionDrawRule();
      el.phaseLabel.textContent = nextRule
        ? t("app.currentRule", { rule: localizedRuleLabel(nextRule) })
        : t("app.fourSeasonsComplete");
    } else if (deckType === "tarot" && isPhaseFilter(arcanaFilter)) {
      el.phaseLabel.style.display = "inline-block";
      el.phaseLabel.textContent = t("app.current", {
        value: getPhaseArcanaLabel(arcanaFilter, currentPhase)
      });
    } else {
      el.phaseLabel.style.display = "none";
    }

    /* 自由画板没有牌阵：以已抽出的牌来算这排动作的可用状态 */
    var boardCards = isFreeform() ? freeDrawn : spread;
    var empty = boardCards.length === 0;
    var allRevealed = !empty && boardCards.every(function (e) { return e.revealed; });
    el.revealBtn.textContent = allRevealed ? t("app.revealedAll") : t("spread.reveal");
    el.revealBtn.disabled = empty || allRevealed;
    el.spreadHint.style.display = "block";
    el.spreadHint.textContent = empty
      ? t("app.emptySpreadHint")
      : allRevealed
      ? t("app.meaningHint")
      : stacking
      ? t("app.stackHint")
      : hasPositionDrawRules()
        ? t("app.ruleHint")
        : t("app.defaultHint");
    if (historyUiController) historyUiController.updateSaveAvailability(isReadingComplete());
  }

  function buildResultCard(entry, position, layer) {
    var card = entry.card;
    var interpretation = getEntryInterpretation(entry);
    var keywords = interpretation.keywords;
    var meaning = interpretation.meaning;
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
      ? layer === "major" ? t("app.resultMajor") : t("app.resultMinor")
      : t("app.position", {
          number: position.number,
          position: formatPositionName(position, "slash")
        });

    var nameEl = document.createElement("span");
    nameEl.className = "result-name";
    nameEl.textContent = localizedCardName(card);

    var orientEl = document.createElement("span");
    orientEl.className = "result-orientation " + entry.orientation;
    orientEl.textContent = getOrientationLabel(entry.orientation);

    header.appendChild(posEl);
    header.appendChild(nameEl);
    header.appendChild(orientEl);

    if (card.suit) {
      var suitEl = document.createElement("span");
      suitEl.className = "result-suit";
      var suit = localized(card, "suit");
      var element = localized(card, "element");
      var direction = localized(card, "direction");
      suitEl.textContent = suit + " · " + element + (direction ? " · " + direction : "");
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
    sourceEl.textContent = localizedCardSource(card);

    resultCard.appendChild(header);
    if (!layer && !position.free) {
      var positionMeaningEl = document.createElement("div");
      positionMeaningEl.className = "result-position-meaning";
      positionMeaningEl.textContent = t("app.positionMeaning", {
        meaning: localizedPositionMeaning(position)
      });
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
      title.textContent = t("app.position", {
        number: position.number,
        position: formatPositionName(position, "slash")
      });

      var positionMeaning = document.createElement("p");
      positionMeaning.className = "result-position-meaning";
      positionMeaning.textContent = t("app.positionMeaning", {
        meaning: localizedPositionMeaning(position)
      });

      var pairHint = document.createElement("p");
      pairHint.className = "result-pair-hint";
      pairHint.textContent = t("app.pairHint");

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
          ? t("app.majorPending")
          : t("app.minorPending");
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
    if (isFreeform()) {
      /* 自由模式没有牌位，翻开的牌直接按摆牌顺序列成解读列表 */
      var revealedCards = freeDrawn.filter(function (item) { return item.revealed; });
      if (!revealedCards.length) {
        el.resultsSection.style.display = "none";
        return;
      }
      el.resultsSection.style.display = "block";
      el.resultsList.innerHTML = "";
      revealedCards.forEach(function (item) {
        var card = cardById(item.id);
        if (!card) return;
        el.resultsList.appendChild(buildResultCard({
          card: card,
          orientation: item.orientation || "upright",
          revealed: true
        }, {
          number: freeIndex(item.id) + 1,
          name: t("freeBoard.slotName"),
          nameEn: t("freeBoard.slotName"),
          free: true
        }, null));
      });
      return;
    }
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

  function confirmIfSpread(message, cancelLabel) {
    var freeBoardCards = freeBoardUi && typeof freeBoardUi.getCardCount === "function"
      ? freeBoardUi.getCardCount()
      : 0;
    // A Free Board draft is meaningful even with no cards on the board: its
    // remaining pile order and viewport are persisted. Never bypass the
    // destructive-transition confirmation merely because every card was
    // returned to the pile.
    if (!isFreeform() && spread.length === 0 && freeBoardCards === 0) {
      return Promise.resolve(true);
    }
    /* dialogs.js is always loaded with the app; if it is missing, let the
       action through instead of dead-ending, and never fall back to a native prompt */
    if (!globalThis.DivinationDialog) {
      return Promise.resolve(true);
    }
    return globalThis.DivinationDialog.request({
      kicker: t("confirm.kicker"),
      title: t("confirm.title"),
      message: message,
      cancelLabel: cancelLabel || t("confirm.cancel"),
      proceedLabel: t("confirm.proceed")
    });
  }

  async function handleModeChange() {
    var newMode = el.modeSelect.value;
    if (newMode === mode) return;
    // M 牌与 LXXXI 魔法牌不支持逆位，拒绝切换到混合模式。
    if (newMode === "mixed" && isNonTarotDeck()) {
      el.modeSelect.value = mode;
      return;
    }
    if (!(await confirmIfSpread(t("confirm.mode")))) {
      el.modeSelect.value = mode;
      return;
    }
    mode = newMode;
    resetDeck();
  }

  async function resolveCustomSpreadFilter(spreadDefinition, requestedDeckType, requestedFilter) {
    requestedFilter = customSpreadTarotFilter(spreadDefinition, requestedDeckType, requestedFilter);
    if (!spreadDefinition || !spreadDefinition.isCustom ||
        requestedDeckType !== "tarot" || requestedFilter !== "major-only") {
      return requestedFilter;
    }
    var majorCount = tarotDeckFull.filter(function (card) { return card.arcana === "major"; }).length;
    if (spreadDefinition.positions.length <= majorCount) return requestedFilter;
    if (!globalThis.DivinationDialog || !(await globalThis.DivinationDialog.request({
      kicker: t("customSpread.capacityKicker"),
      title: t("customSpread.capacityTitle"),
      message: t("customSpread.capacityMessage", {
        positions: spreadDefinition.positions.length,
        available: majorCount
      }),
      cancelLabel: t("customSpread.keepFilter"),
      proceedLabel: t("customSpread.switchFullDeck")
    }))) return null;
    return "mixed";
  }

  async function handleArcanaChange() {
    if (deckType !== "tarot") return;
    var newFilter = el.arcanaFilter.value;
    if (newFilter === arcanaFilter) return;
    if (!(await confirmIfSpread(t("confirm.arcana")))) {
      el.arcanaFilter.value = arcanaFilter;
      return;
    }
    var resolvedFilter = await resolveCustomSpreadFilter(selectedSpread(), deckType, newFilter);
    if (resolvedFilter === null || resolvedFilter === arcanaFilter) {
      el.arcanaFilter.value = arcanaFilter;
      return;
    }
    arcanaFilter = resolvedFilter;
    el.arcanaFilter.value = arcanaFilter;
    resetDeck();
  }

  async function handleOverviewMethodChange() {
    var newMethod = el.overviewMethod.value;
    if (newMethod === overviewMethod) return;
    if (!(await confirmIfSpread(t("confirm.overview")))) {
      el.overviewMethod.value = overviewMethod;
      return;
    }
    overviewMethod = newMethod;
    applyDeckUi();
    renderSpreadDefinition();
    resetDeck();
  }

  async function handleSpreadChange() {
    var newSpreadId = el.spreadSelect.value;
    if (newSpreadId === selectedSpreadId) return;
    if (!(await confirmIfSpread(t("confirm.spread")))) {
      el.spreadSelect.value = selectedSpreadId;
      return;
    }
    var nextCustomSpread = customSpreadsUi && customSpreadsUi.getById(newSpreadId);
    var resolvedFilter = await resolveCustomSpreadFilter(nextCustomSpread, deckType, arcanaFilter);
    if (resolvedFilter === null) {
      el.spreadSelect.value = selectedSpreadId;
      return;
    }
    arcanaFilter = resolvedFilter;
    el.arcanaFilter.value = arcanaFilter;
    /* 从自由模式里挑了一个预设牌阵：回到牌阵模式 */
    if (isFreeform()) {
      leaveFreeform();
      if (el.layoutModeSelect) el.layoutModeSelect.value = "preset";
      applyLayoutUi();
    }
    selectedSpreadId = newSpreadId;
    applyDeckUi();
    renderSpreadDefinition();
    resetDeck();
  }

  async function activateCustomSpread(spreadDefinition) {
    if (!spreadDefinition || !spreadDefinition.id) return false;
    if (!(await confirmIfSpread(t("confirm.spread")))) return false;
    var targetDeckType = preferredDeckForCustomSpread(spreadDefinition, deckType);
    if (!customSpreadSupportsDeck(spreadDefinition, targetDeckType)) return false;
    var resolvedFilter = await resolveCustomSpreadFilter(spreadDefinition, targetDeckType, arcanaFilter);
    if (resolvedFilter === null) return false;
    deckType = targetDeckType;
    el.deckSelect.value = deckType;
    arcanaFilter = resolvedFilter;
    el.arcanaFilter.value = arcanaFilter;
    if (isFreeform()) leaveFreeform();
    selectedSpreadId = spreadDefinition.id;
    if (el.layoutModeSelect) el.layoutModeSelect.value = "preset";
    applyDeckUi();
    populateSpreadSelect();
    renderSpreadDefinition();
    applyLayoutUi();
    resetDeck();
    syncCustomSelectVisuals();
    return true;
  }

  function handleCustomCatalogueChange(preferredId, removedId) {
    if (removedId && selectedSpreadId === removedId) {
      selectedSpreadId = defaultSpreadIdForDeck(deckType);
      resetDeck();
    }
    populateSpreadSelect();
    if (preferredId && customSpreadsUi && customSpreadsUi.getById(preferredId)) {
      el.spreadSelect.value = preferredId;
    }
    renderSpreadDefinition();
    syncCustomSelectVisuals();
  }

  function populateSpreadSelect() {
    el.spreadSelect.innerHTML = "";
    var catalogue = getSpreadsForDeck(deckType);
    var customCatalogue = customSpreadsUi ? customSpreadsUi.list() : [];
    customCatalogue = customCatalogue.filter(function (spreadDefinition) {
      return customSpreadSupportsDeck(spreadDefinition, deckType);
    });
    var customGroup = document.createElement("optgroup");
    customGroup.className = "custom-spreads";
    customGroup.label = t("customSpread.group");
    var mGroup = document.createElement("optgroup");
    mGroup.label = t("deck.group.mystagogus");
    var tGroup = document.createElement("optgroup");
    tGroup.label = t("deck.group.tarot");
    var lGroup = document.createElement("optgroup");
    lGroup.label = t("deck.group.lxxxi");
    catalogue.forEach(function (spreadDefinition) {
      var option = document.createElement("option");
      option.value = spreadDefinition.id;
      var cardCountLabel = deckType === "tarot" && spreadDefinition.id === "overview"
        ? t("app.cardsStackable", { count: spreadDefinition.positions.length })
        : t("app.cards", { count: spreadDefinition.positions.length });
      option.textContent = localizedSpreadName(spreadDefinition) + " · " + cardCountLabel;
      if (spreadDefinition.deck === "mystagogus") mGroup.appendChild(option);
      else if (spreadDefinition.deck === "lxxxi") lGroup.appendChild(option);
      else tGroup.appendChild(option);
    });
    customCatalogue.forEach(function (spreadDefinition) {
      var option = document.createElement("option");
      option.value = spreadDefinition.id;
      option.textContent = localizedSpreadName(spreadDefinition) + " · " +
        t("app.cards", { count: spreadDefinition.positions.length });
      customGroup.appendChild(option);
    });
    if (customCatalogue.length) el.spreadSelect.appendChild(customGroup);
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
    if (!catalogue.concat(customCatalogue).some(function (s) { return s.id === selectedSpreadId; })) {
      selectedSpreadId = defaultSpreadIdForDeck(deckType);
    }
    el.spreadSelect.value = selectedSpreadId;
  }

  async function handleDeckChange() {
    var newDeck = el.deckSelect.value;
    if (newDeck === deckType) return;
    if (!(await confirmIfSpread(t("confirm.deck")))) {
      el.deckSelect.value = deckType;
      syncSelectControls();
      return;
    }
    var currentCustomSpread = customSpreadsUi && customSpreadsUi.getById(selectedSpreadId);
    var currentCustomIsAllowed = customSpreadSupportsDeck(currentCustomSpread, newDeck);
    var resolvedFilter = await resolveCustomSpreadFilter(
      currentCustomIsAllowed ? currentCustomSpread : null,
      newDeck,
      arcanaFilter
    );
    if (resolvedFilter === null) {
      el.deckSelect.value = deckType;
      syncSelectControls();
      return;
    }
    arcanaFilter = resolvedFilter;
    el.arcanaFilter.value = arcanaFilter;
    deckType = newDeck;
    // 双方均可使用对方牌阵；仅在 id 无效时回退默认。
    var allowedCustomSpreads = customSpreadsUi ? customSpreadsUi.list().filter(function (spreadDefinition) {
      return customSpreadSupportsDeck(spreadDefinition, deckType);
    }) : [];
    var allowed = getSpreadsForDeck(deckType).concat(allowedCustomSpreads);
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
      ? t("app.cardsStacked")
      : t("app.cards", { count: spreadDefinition.positions.length });
    el.spreadSettingSummary.textContent = countLabel + " · " +
      localized(spreadDefinition, "description") +
      (isOverviewStacking()
        ? t("app.stackedDefinition")
        : "");
    el.positionGuideList.innerHTML = "";
    spreadDefinition.positions.forEach(function (position) {
      var item = document.createElement("li");
      var title = document.createElement("strong");
      title.textContent = position.number + ". " + formatPositionName(position, "slash");
      var meaning = document.createElement("span");
      meaning.textContent = localizedPositionMeaning(position) +
        (position.drawRule ? " (" + localizedRuleLabel(position.drawRule) + ")" : "");
      item.appendChild(title);
      item.appendChild(meaning);
      el.positionGuideList.appendChild(item);
    });
    el.positionGuide.open = true;
  }

  async function handleShuffle() {
    if (isFreeform()) {
      /* ask first only when cards are already laid out on the table */
      if (freeDrawn.length && !(await confirmIfSpread(t("confirm.shuffle"), t("confirm.keep")))) return;
      resetDeck();
      window.requestAnimationFrame(function () {
        globalThis.dispatchEvent(new CustomEvent("quareia:shuffled"));
      });
      return;
    }
    if (!(await confirmIfSpread(t("confirm.shuffle"), t("confirm.keep")))) return;
    resetDeck();
    window.requestAnimationFrame(function () {
      globalThis.dispatchEvent(new CustomEvent("quareia:shuffled"));
    });
  }

  function leaveFreeform(park) {
    if (park) saveFreeformDraftNow(true);
    else clearFreeformDraft();
    layoutMode = "preset";
    freeDrawn.length = 0;
    freeRedo.length = 0;
    renderFreeDraw();
  }

  async function handleLayoutModeChange() {
    var newLayoutMode = el.layoutModeSelect.value;
    if (newLayoutMode === layoutMode) return;
    if (newLayoutMode === "preset") {
      leaveFreeform(true);
      applyDeckUi();
      applyLayoutUi();
      populateSpreadSelect();
      renderSpreadDefinition();
      resetDeck();
      syncSelectControls();
      return;
    }

    if (!(await confirmIfSpread(t("confirm.layout")))) {
      el.layoutModeSelect.value = layoutMode;
      syncSelectControls();
      return;
    }

    if (restoreFreeformDraft(true) >= 0) {
      spread = [];
      currentPhase = "major";
      freeBoardReadingReported = false;
      showRestoredFreeform();
      saveFreeformDraftNow();
      return;
    }

    spread = [];
    currentPhase = "major";
    layoutMode = "freeform";
    freeBoardReadingReported = false;
    freeDrawn = [];
    freeRedo.length = 0;
    applyDeckUi();
    applyLayoutUi();
    buildPile();
    renderFreeformFan();
    scheduleFreeformDraft();
    renderSpreadMeta();
    renderResults();
    syncSelectControls();
  }

  function toggleSettings() {
    var collapsed = el.settings.classList.toggle("collapsed");
    el.settingsToggle.setAttribute("aria-expanded", String(!collapsed));
  }

  function handleLanguageChange() {
    applyDeckUi();
    populateSpreadSelect();
    renderSpreadDefinition();
    applyLayoutUi();
    if (isFreeform()) {
      if (freeBoardUi && typeof freeBoardUi.refreshLanguage === "function") {
        freeBoardUi.refreshLanguage();
      }
      if (historyUiController && historyUiController.refreshLanguage) {
        historyUiController.refreshLanguage();
      }
      return;
    }
    renderSpreadCards();
    renderDeckSpread();
    renderSpreadMeta();
    renderResults();
    if (historyUiController && historyUiController.refreshLanguage) {
      historyUiController.refreshLanguage();
    }
  }

  function syncStateFromFreeBoard(state) {
    if (!state) return;
    var settings = state.settings || {};
    var restoredDeck = settings.deckType || state.deck && (state.deck.deckId || state.deck.id);
    if (restoredDeck === "tarot" || restoredDeck === "mystagogus" || restoredDeck === "lxxxi") {
      deckType = restoredDeck;
    }
    mode = settings.orientationMode === "mixed" && deckType === "tarot"
      ? "mixed"
      : "upright-only";
    if (deckType === "tarot" && [
      "mixed", "major-only", "minor-only", "major-then-minor", "minor-then-major"
    ].indexOf(settings.filterMode) !== -1) {
      arcanaFilter = settings.filterMode;
    }
    if (el.deckSelect) el.deckSelect.value = deckType;
    if (el.modeSelect) el.modeSelect.value = mode;
    if (el.arcanaFilter) el.arcanaFilter.value = arcanaFilter;
    if (el.layoutModeSelect) el.layoutModeSelect.value = "freeform";
  }

  function syncCustomSelectVisuals() {
    if (globalThis.DivinationCustomSelects &&
        typeof globalThis.DivinationCustomSelects.sync === "function") {
      globalThis.DivinationCustomSelects.sync();
    }
  }

  function syncSelectControls() {
    syncCustomSelectVisuals();
    if (globalThis.DivinationSegmented && typeof globalThis.DivinationSegmented.sync === "function") {
      globalThis.DivinationSegmented.sync();
    }
  }

  function showRestoredFreeform() {
    layoutMode = "freeform";
    el.deckSelect.value = deckType;
    el.modeSelect.value = mode;
    el.arcanaFilter.value = arcanaFilter;
    el.layoutModeSelect.value = "freeform";
    applyDeckUi();
    populateSpreadSelect();
    renderSpreadDefinition();
    applyLayoutUi();
    syncSelectControls();
  }

  // ---------- Init ----------
  function init() {
    cacheElements();

    deckType = el.deckSelect.value || "tarot";
    mode = el.modeSelect.value;
    layoutMode = el.layoutModeSelect ? (el.layoutModeSelect.value || "preset") : "preset";
    arcanaFilter = el.arcanaFilter.value;
    overviewMethod = el.overviewMethod.value || "single";
    if (globalThis.DivinationCustomSpreadUi && globalThis.DivinationCustomSpreads) {
      customSpreadsUi = globalThis.DivinationCustomSpreadUi.init({
        document: document,
        core: globalThis.DivinationCustomSpreads,
        platform: "web",
        storage: null,
        activateSpread: activateCustomSpread,
        onCatalogueChange: handleCustomCatalogueChange
      });
    }
    applyDeckUi();
    populateSpreadSelect();
    selectedSpreadId = el.spreadSelect.value;
    renderSpreadDefinition();
    applyLayoutUi();

    el.settingsToggle.addEventListener("click", toggleSettings);
    el.deckSelect.addEventListener("change", handleDeckChange);
    el.modeSelect.addEventListener("change", handleModeChange);
    if (el.layoutModeSelect) el.layoutModeSelect.addEventListener("change", handleLayoutModeChange);
    el.arcanaFilter.addEventListener("change", handleArcanaChange);
    el.overviewMethod.addEventListener("change", handleOverviewMethodChange);
    el.spreadSelect.addEventListener("change", handleSpreadChange);
    el.shuffleBtn.addEventListener("click", handleShuffle);
    var freeUndoBtn = document.getElementById("freeUndoBtn");
    if (freeUndoBtn) freeUndoBtn.addEventListener("click", undoFreeDraw);
    var freeRedoBtn = document.getElementById("freeRedoBtn");
    if (freeRedoBtn) freeRedoBtn.addEventListener("click", redoFreeDraw);
    el.switchArcanaBtn.addEventListener("click", switchArcanaPhase);
    el.revealBtn.addEventListener("click", revealAll);
    if (el.clearBtn) el.clearBtn.addEventListener("click", handleShuffle);
    globalThis.addEventListener("quareia:languagechange", handleLanguageChange);
    if (globalThis.DivinationHistoryUi &&
        globalThis.DivinationHistoryStore &&
        globalThis.DivinationHistoryRecords) {
      historyUiController = globalThis.DivinationHistoryUi.init({
        store: globalThis.DivinationHistoryStore.createStore({
          recordsApi: globalThis.DivinationHistoryRecords
        }),
        recordsApi: globalThis.DivinationHistoryRecords,
        createSnapshot: createCurrentHistoryRecord,
        resolveSpread: function (record) {
          if (!record || !record.spreadId) return null;
          var custom = customSpreadsUi && customSpreadsUi.getById(record.spreadId);
          if (custom && customSpreadSupportsDeck(custom, record.deckType)) return custom;
          var preset = getSpreadById(record.deckType, record.spreadId);
          return preset && preset.id === record.spreadId ? preset : null;
        }
      });
    }
    var restoredCards = restoreFreeformDraft();
    if (restoredCards >= 0) {
      showRestoredFreeform();
    } else {
      applyLayoutUi();
      resetDeck();
    }
  }



  window.addEventListener("pagehide", function () {
    if (freeformDraftTimer) saveFreeformDraftNow();
  });

  /* 屏幕尺寸变了：把自由画板上的牌拉回可视范围 */
  window.addEventListener("resize", function () {
    if (isFreeform() && freeDrawn.length) renderFreeDraw();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
