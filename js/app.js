(function () {
  "use strict";

  // ---------- State ----------
  var mode = "upright-only";       // upright-only | mixed
  var arcanaFilter = "mixed";      // mixed | major-only | minor-only | major-then-minor | minor-then-major
  var currentPhase = "major";      // used by phase filters

  var pile = [];       // remaining face-down cards (shuffled)
  var spread = [];      // drawn cards: { uid, card, orientation, revealed }
  var uidCounter = 0;

  var el = {};

  function cacheElements() {
    el.settings = document.getElementById("settings");
    el.settingsToggle = document.getElementById("settingsToggle");
    el.modeSelect = document.getElementById("modeSelect");
    el.arcanaFilter = document.getElementById("arcanaFilter");
    el.shuffleBtn = document.getElementById("shuffleBtn");
    el.switchArcanaBtn = document.getElementById("switchArcanaBtn");
    el.deckSpread = document.getElementById("deckSpread");
    el.deckRemaining = document.getElementById("deckRemaining");
    el.deckCta = document.getElementById("deckCta");
    el.spreadArea = document.getElementById("spreadArea");
    el.spreadGrid = document.getElementById("spreadGrid");
    el.spreadCount = document.getElementById("spreadCount");
    el.phaseLabel = document.getElementById("phaseLabel");
    el.revealBtn = document.getElementById("revealBtn");
    el.clearBtn = document.getElementById("clearBtn");
    el.spreadHint = document.getElementById("spreadHint");
    el.resultsSection = document.getElementById("resultsSection");
    el.resultsList = document.getElementById("resultsList");
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
    return Math.random() > 0.5 ? "upright" : "reversed";
  }

  function buildPile() {
    pile = shuffle(getDeckByArcanaFilter(arcanaFilter, currentPhase));
  }

  // Full reset: rebuild pile and clear the spread.
  function resetDeck() {
    currentPhase = "major";
    buildPile();
    spread = [];
    el.spreadGrid.innerHTML = "";
    renderDeckSpread();
    renderSpreadMeta();
    renderResults();
  }

  function getOrientationLabel(o) { return o === "upright" ? "正位" : "逆位"; }

  function createCardImage(card, className, orientation) {
    var img = document.createElement("img");
    img.className = className + (orientation === "reversed" ? " reversed" : "");
    img.src = card.image;
    img.alt = card.name;
    img.loading = "lazy";
    img.decoding = "async";
    return img;
  }

  // ---------- Deck spread (pick any card) ----------
  function renderDeckSpread() {
    var prevScroll = el.deckSpread.scrollLeft;
    el.deckSpread.innerHTML = "";

    if (pile.length === 0) {
      el.deckSpread.classList.add("empty");
      el.deckSpread.textContent = isPhaseFilter(arcanaFilter)
        ? "这组牌已抽完，可切换牌组或重新洗牌"
        : "牌已抽完，按「洗牌」重新开始";
    } else {
      el.deckSpread.classList.remove("empty");
      pile.forEach(function (card, index) {
        var cardEl = document.createElement("div");
        cardEl.className = "deck-card";
        cardEl.setAttribute("role", "listitem");
        cardEl.setAttribute("aria-label", "第 " + (index + 1) + " 张，轻点抽出");
        cardEl.addEventListener("click", function () { drawAt(index); });
        el.deckSpread.appendChild(cardEl);
      });
      el.deckSpread.scrollLeft = prevScroll;
    }

    el.deckRemaining.textContent = "剩 " + pile.length + " 张";

    if (pile.length === 0) {
      el.deckCta.classList.add("empty");
      el.deckCta.textContent = "牌堆已空，翻开你的牌，或重新洗牌再来一次";
    } else {
      el.deckCta.classList.remove("empty");
      el.deckCta.textContent = "左右滑动浏览牌堆，轻点任意一张牌抽出";
    }

    if (isPhaseFilter(arcanaFilter)) {
      el.switchArcanaBtn.style.display = "inline-block";
      el.switchArcanaBtn.textContent = getOtherPhaseLabel(arcanaFilter, currentPhase);
    } else {
      el.switchArcanaBtn.style.display = "none";
    }
  }

  // ---------- Spread (drawn cards) ----------
  function buildSpreadCardEl(entry) {
    var card = entry.card;

    var cardEl = document.createElement("div");
    cardEl.className = "spread-card is-new";
    cardEl.setAttribute("data-uid", entry.uid);
    cardEl.setAttribute("role", "button");
    cardEl.setAttribute("aria-label", "轻点翻开这张牌");

    var inner = document.createElement("div");
    inner.className = "spread-card-inner";

    var back = document.createElement("div");
    back.className = "spread-card-face spread-card-back";
    var posNum = document.createElement("span");
    posNum.className = "pos-num";
    back.appendChild(posNum);

    // Front face is built up-front but hidden by backface-visibility until flipped,
    // so we get an instant, smooth 3D flip without leaking the card face.
    var front = document.createElement("div");
    front.className = "spread-card-face spread-card-front" +
      (entry.orientation === "reversed" ? " reversed" : "");
    front.appendChild(createCardImage(card, "card-image", entry.orientation));
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
    cardEl.appendChild(inner);

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

    cardEl.addEventListener("click", function () { revealEntry(entry); });

    if (entry.revealed) cardEl.classList.add("revealed");
    return cardEl;
  }

  function getSpreadEl(entry) {
    return el.spreadGrid.querySelector('.spread-card[data-uid="' + entry.uid + '"]');
  }

  function drawAt(index) {
    if (index < 0 || index >= pile.length) return;
    var card = pile.splice(index, 1)[0];
    var entry = { uid: ++uidCounter, card: card, orientation: orientationFor(), revealed: false };
    spread.push(entry);

    el.spreadGrid.appendChild(buildSpreadCardEl(entry));
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
      cardEl.setAttribute("aria-label", entry.card.name + " · " + getOrientationLabel(entry.orientation));
    }
    renderSpreadMeta();
    renderResults();
  }

  function removeEntry(entry) {
    var idx = spread.indexOf(entry);
    if (idx === -1) return;
    spread.splice(idx, 1);
    var cardEl = getSpreadEl(entry);
    if (cardEl) cardEl.remove();

    // Return the card to a random spot in the pile so it can be redrawn.
    var pos = Math.floor(Math.random() * (pile.length + 1));
    pile.splice(pos, 0, entry.card);

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
    spread.forEach(function (entry, index) {
      var cardEl = getSpreadEl(entry);
      if (cardEl) {
        var posNum = cardEl.querySelector(".pos-num");
        if (posNum) posNum.textContent = index + 1;
      }
    });

    if (isPhaseFilter(arcanaFilter)) {
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

    spread.forEach(function (entry, index) {
      if (!entry.revealed) return;
      var card = entry.card;
      var isUpright = entry.orientation === "upright";
      var showReversed = mode === "mixed" && !isUpright;
      var keywords = showReversed ? card.reversedKeywords : card.uprightKeywords;
      var meaning = showReversed ? card.reversedMeaning : card.uprightMeaning;

      var resultCard = document.createElement("div");
      resultCard.className = "result-card";

      if (card.image) {
        resultCard.appendChild(createCardImage(card, "result-card-image", entry.orientation));
      }

      var header = document.createElement("div");
      header.className = "result-header";

      var posEl = document.createElement("span");
      posEl.className = "result-pos";
      posEl.textContent = "位置 " + (index + 1);

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
      el.resultsList.appendChild(resultCard);
    });
  }

  // ---------- Settings / phase ----------
  function switchArcanaPhase() {
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
    if (!confirmIfSpread("切换模式会清空当前牌阵并重新洗牌，是否继续？")) {
      el.modeSelect.value = mode;
      return;
    }
    mode = newMode;
    resetDeck();
  }

  function handleArcanaChange() {
    var newFilter = el.arcanaFilter.value;
    if (newFilter === arcanaFilter) return;
    if (!confirmIfSpread("切换牌组会清空当前牌阵并重新洗牌，是否继续？")) {
      el.arcanaFilter.value = arcanaFilter;
      return;
    }
    arcanaFilter = newFilter;
    resetDeck();
  }

  function handleShuffle() {
    if (!confirmIfSpread("确定要重新洗牌吗？这会清空当前牌阵。")) return;
    resetDeck();
  }

  function toggleSettings() {
    var collapsed = el.settings.classList.toggle("collapsed");
    el.settingsToggle.setAttribute("aria-expanded", String(!collapsed));
  }

  // ---------- Init ----------
  function init() {
    cacheElements();

    mode = el.modeSelect.value;
    arcanaFilter = el.arcanaFilter.value;

    el.settingsToggle.addEventListener("click", toggleSettings);
    el.modeSelect.addEventListener("change", handleModeChange);
    el.arcanaFilter.addEventListener("change", handleArcanaChange);
    el.shuffleBtn.addEventListener("click", handleShuffle);
    el.switchArcanaBtn.addEventListener("click", switchArcanaPhase);
    el.revealBtn.addEventListener("click", revealAll);
    el.clearBtn.addEventListener("click", handleShuffle);

    resetDeck();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
