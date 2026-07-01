(function () {
  "use strict";

  // ---------- State ----------
  var mode = "upright-only";       // upright-only | mixed
  var arcanaFilter = "mixed";      // mixed | major-only | minor-only | major-then-minor | minor-then-major
  var currentPhase = "major";      // used by phase filters

  var pile = [];     // remaining face-down cards (already shuffled + oriented)
  var spread = [];   // drawn cards: { card, orientation, revealed }

  var el = {};

  function cacheElements() {
    el.settings = document.getElementById("settings");
    el.settingsToggle = document.getElementById("settingsToggle");
    el.settingsBody = document.getElementById("settingsBody");
    el.modeSelect = document.getElementById("modeSelect");
    el.arcanaFilter = document.getElementById("arcanaFilter");
    el.switchArcanaBtn = document.getElementById("switchArcanaBtn");
    el.deckStack = document.getElementById("deckStack");
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
    var filtered = getDeckByArcanaFilter(arcanaFilter, currentPhase);
    pile = shuffle(filtered);
  }

  // Full reset: rebuild pile from scratch and clear the spread.
  function resetDeck() {
    currentPhase = "major";
    buildPile();
    spread = [];
    renderAll();
  }

  // ---------- Actions ----------
  function drawCard() {
    if (pile.length === 0) return;
    var card = pile.shift();
    spread.push({ card: card, orientation: orientationFor(), revealed: false });
    renderAll();
    // Keep the newest card in view on small screens.
    requestAnimationFrame(function () {
      el.spreadArea.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function removeAt(index) {
    var entry = spread.splice(index, 1)[0];
    if (entry) {
      // Return the card to a random spot in the pile so it can be redrawn.
      var pos = Math.floor(Math.random() * (pile.length + 1));
      pile.splice(pos, 0, entry.card);
    }
    renderAll();
  }

  function revealAt(index) {
    if (spread[index] && !spread[index].revealed) {
      spread[index].revealed = true;
      renderAll();
    }
  }

  function revealAll() {
    spread.forEach(function (s) { s.revealed = true; });
    renderAll();
  }

  function switchArcanaPhase() {
    currentPhase = currentPhase === "major" ? "minor" : "major";
    buildPile();
    renderAll();
  }

  // ---------- Rendering ----------
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

  function renderDeck() {
    var remaining = pile.length;
    el.deckRemaining.textContent = "剩 " + remaining + " 张";
    el.deckStack.disabled = remaining === 0;

    if (remaining === 0) {
      el.deckCta.classList.add("empty");
      if (isPhaseFilter(arcanaFilter)) {
        el.deckCta.textContent = "这组牌已抽完，可切换牌组或重新洗牌";
      } else {
        el.deckCta.textContent = "牌已抽完，按「重新洗牌」再来一次";
      }
    } else {
      el.deckCta.classList.remove("empty");
      el.deckCta.textContent = "轻点牌堆抽一张牌";
    }

    // Phase switch button (先大后小 / 先小后大)
    if (isPhaseFilter(arcanaFilter)) {
      el.switchArcanaBtn.style.display = "inline-block";
      el.switchArcanaBtn.textContent = getOtherPhaseLabel(arcanaFilter, currentPhase);
    } else {
      el.switchArcanaBtn.style.display = "none";
    }
  }

  function renderSpread() {
    if (spread.length === 0) {
      el.spreadArea.style.display = "none";
      return;
    }
    el.spreadArea.style.display = "block";
    el.spreadCount.textContent = spread.length;

    if (isPhaseFilter(arcanaFilter)) {
      el.phaseLabel.style.display = "inline-block";
      el.phaseLabel.textContent = "当前：" + getPhaseArcanaLabel(arcanaFilter, currentPhase);
    } else {
      el.phaseLabel.style.display = "none";
    }

    var allRevealed = spread.every(function (s) { return s.revealed; });
    el.revealBtn.textContent = allRevealed ? "已全部翻开" : "开牌解读";
    el.revealBtn.disabled = allRevealed;
    el.spreadHint.style.display = allRevealed ? "none" : "block";

    el.spreadGrid.innerHTML = "";
    spread.forEach(function (entry, index) {
      var card = entry.card;

      var cardEl = document.createElement("div");
      cardEl.className = "spread-card" + (entry.revealed ? " revealed" : "");
      cardEl.setAttribute("role", "button");
      cardEl.setAttribute("aria-label", entry.revealed ? card.name : "第 " + (index + 1) + " 张，轻点翻开");

      var inner = document.createElement("div");
      inner.className = "spread-card-inner";

      // Back face
      var back = document.createElement("div");
      back.className = "spread-card-face spread-card-back";
      var posNum = document.createElement("span");
      posNum.className = "pos-num";
      posNum.textContent = index + 1;
      back.appendChild(posNum);

      // Front face
      var front = document.createElement("div");
      front.className = "spread-card-face spread-card-front" +
        (entry.orientation === "reversed" ? " reversed" : "");
      if (entry.revealed) {
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
      }

      inner.appendChild(back);
      inner.appendChild(front);
      cardEl.appendChild(inner);

      // Remove button (always visible — works on touch)
      var removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.type = "button";
      removeBtn.textContent = "×";
      removeBtn.setAttribute("aria-label", "移除这张牌");
      removeBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        removeAt(index);
      });
      cardEl.appendChild(removeBtn);

      cardEl.addEventListener("click", function () {
        if (!entry.revealed) revealAt(index);
      });

      el.spreadGrid.appendChild(cardEl);
    });
  }

  function renderResults() {
    var revealed = spread.filter(function (s) { return s.revealed; });
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

  function renderAll() {
    renderDeck();
    renderSpread();
    renderResults();
  }

  // ---------- Settings changes ----------
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

  function handleClear() {
    if (!confirmIfSpread("确定要清空当前牌阵并重新洗牌吗？")) return;
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
    el.deckStack.addEventListener("click", drawCard);
    el.switchArcanaBtn.addEventListener("click", switchArcanaPhase);
    el.revealBtn.addEventListener("click", revealAll);
    el.clearBtn.addEventListener("click", handleClear);

    resetDeck();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
