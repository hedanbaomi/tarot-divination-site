(function (root, factory) {
  "use strict";

  var api;
  if (typeof module === "object" && module.exports) {
    api = factory(
      globalThis,
      require("./free-board-model.js"),
      require("./free-board-draft.js"),
      require("./history-records.js")
    );
    module.exports = api;
  } else {
    api = factory(
      root,
      root && root.FreeBoardModel,
      root && root.DivinationFreeBoardDraft,
      root && root.DivinationHistoryRecords
    );
    if (root) root.DivinationFreeBoardUi = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  root,
  defaultModelApi,
  defaultDraftApi,
  defaultRecordsApi
) {
  "use strict";

  var DEFAULT_CARD_WIDTH = 116;
  var DEFAULT_CARD_HEIGHT = 176;
  var ANDROID_COLUMN_GAP = 92;
  var ANDROID_ROW_GAP = 142;
  var MIN_ZOOM = 0.1;
  var MAX_ZOOM = 4;
  var DRAG_THRESHOLD = 6;

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function clampZoom(value, modelApi) {
    var limits = modelApi && modelApi.LIMITS;
    var minimum = limits && Number.isFinite(limits.minZoom) ? limits.minZoom : MIN_ZOOM;
    var maximum = limits && Number.isFinite(limits.maxZoom) ? limits.maxZoom : MAX_ZOOM;
    return clamp(value, minimum, maximum);
  }

  function distance(a, b) {
    return Math.hypot(b.x - a.x, b.y - a.y);
  }

  function midpoint(a, b) {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  function viewportRect(rect) {
    rect = rect || {};
    return {
      left: Number.isFinite(rect.left) ? rect.left : 0,
      top: Number.isFinite(rect.top) ? rect.top : 0,
      width: Number.isFinite(rect.width) && rect.width > 0 ? rect.width : 600,
      height: Number.isFinite(rect.height) && rect.height > 0 ? rect.height : 420
    };
  }

  function zoomAroundPoint(viewport, rectInput, anchor, nextZoom, modelApi) {
    var rect = viewportRect(rectInput);
    var current = viewport || { panX: 0, panY: 0, zoom: 1 };
    var target = clampZoom(nextZoom, modelApi);
    var anchorX = Number(anchor && (anchor.x != null ? anchor.x : anchor.clientX));
    var anchorY = Number(anchor && (anchor.y != null ? anchor.y : anchor.clientY));
    if (!Number.isFinite(anchorX)) anchorX = rect.left + rect.width / 2;
    if (!Number.isFinite(anchorY)) anchorY = rect.top + rect.height / 2;
    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height / 2;
    var worldX = (anchorX - centerX - current.panX) / current.zoom;
    var worldY = (anchorY - centerY - current.panY) / current.zoom;
    return {
      panX: anchorX - centerX - worldX * target,
      panY: anchorY - centerY - worldY * target,
      zoom: target
    };
  }

  function pinchViewport(viewport, rectInput, startMid, currentMid, startDistance, currentDistance, modelApi) {
    var current = viewport || { panX: 0, panY: 0, zoom: 1 };
    var ratio = startDistance > 0 ? currentDistance / startDistance : 1;
    var target = clampZoom(current.zoom * ratio, modelApi);
    var rect = viewportRect(rectInput);
    var start = startMid || { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    var now = currentMid || start;
    var centerX = rect.left + rect.width / 2;
    var centerY = rect.top + rect.height / 2;
    var worldX = (start.x - centerX - current.panX) / current.zoom;
    var worldY = (start.y - centerY - current.panY) / current.zoom;
    return {
      panX: now.x - centerX - worldX * target,
      panY: now.y - centerY - worldY * target,
      zoom: target
    };
  }

  function defaultDrawPosition(index, platform) {
    if (platform === "android") {
      var androidColumn = index % 3;
      var androidRow = Math.floor(index / 3);
      return {
        x: (androidColumn - 1) * ANDROID_COLUMN_GAP,
        y: (androidRow - 0.5) * ANDROID_ROW_GAP
      };
    }
    var column = index % 4;
    var row = Math.floor(index / 4);
    return {
      x: (column - 1.5) * 34,
      y: (row - 1) * 30
    };
  }

  function byId(document, id) {
    return document && typeof document.getElementById === "function"
      ? document.getElementById(id)
      : null;
  }

  function textElement(document, tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) element.className = className;
    element.textContent = text == null ? "" : String(text);
    return element;
  }

  function hasClass(element, className) {
    return Boolean(element && element.classList && element.classList.contains(className));
  }

  function isElementInside(element, ancestor) {
    var current = element;
    while (current) {
      if (current === ancestor) return true;
      current = current.parentNode;
    }
    return false;
  }

  function findCardElement(target) {
    var current = target;
    while (current) {
      if (current.getAttribute && current.getAttribute("data-card-id")) return current;
      current = current.parentNode;
    }
    return null;
  }

  function copyViewport(viewport) {
    return {
      panX: viewport.panX,
      panY: viewport.panY,
      zoom: viewport.zoom
    };
  }

  function shuffled(cards, random) {
    var result = (cards || []).slice();
    var source = random || Math.random;
    for (var index = result.length - 1; index > 0; index -= 1) {
      var swap = Math.floor(source() * (index + 1));
      var item = result[index];
      result[index] = result[swap];
      result[swap] = item;
    }
    return result;
  }

  function createController(options) {
    options = options || {};
    var document = options.document || (root && root.document);
    var modelApi = options.modelApi || defaultModelApi || (root && root.FreeBoardModel);
    var draftApi = options.draftApi || defaultDraftApi || (root && root.DivinationFreeBoardDraft);
    var recordsApi = options.recordsApi || defaultRecordsApi || (root && root.DivinationHistoryRecords);
    if (!document || !modelApi || typeof modelApi.createController !== "function") {
      throw new Error("free board UI requires a document and FreeBoardModel");
    }

    var elements = {
      area: options.area || byId(document, "freeBoardArea"),
      viewport: options.viewport || byId(document, "freeBoardViewport"),
      world: options.world || byId(document, "freeBoardWorld"),
      pile: options.pile || byId(document, "freeBoardPile"),
      pileRemaining: options.pileRemaining || byId(document, "freeBoardPileRemaining"),
      count: options.count || byId(document, "freeBoardCount"),
      status: options.status || byId(document, "freeBoardStatus"),
      hint: options.hint || byId(document, "freeBoardHint"),
      selected: options.selected || byId(document, "freeBoardSelectedControls"),
      saveStatus: options.saveStatus || byId(document, "freeBoardSaveStatus"),
      undo: options.undo || byId(document, "freeBoardUndoBtn"),
      redo: options.redo || byId(document, "freeBoardRedoBtn"),
      revealAll: options.revealAll || byId(document, "freeBoardRevealAllBtn"),
      resetView: options.resetView || byId(document, "freeBoardResetViewBtn"),
      shuffle: options.shuffle || byId(document, "freeBoardShuffleBtn"),
      discard: options.discard || byId(document, "freeBoardDiscardDraftBtn")
    };

    var platform = options.platform === "android" ? "android" : "web";

    var stateController = null;
    var context = null;
    var selectedCardId = null;
    var cardElements = Object.create(null);
    var cardSources = Object.create(null);
    var visualCards = Object.create(null);
    var visualViewport = null;
    var pointers = Object.create(null);
    var gesture = null;
    var bound = false;
    var draftAutosave = null;
    var invalidDraft = false;

    if (elements.area) elements.area.setAttribute("data-free-board-platform", platform);

    function t(key, values) {
      var i18n = root && root.DivinationI18n;
      return i18n && typeof i18n.t === "function" ? i18n.t(key, values) : key;
    }

    function field(value, key) {
      var i18n = root && root.DivinationI18n;
      if (!value) return "";
      return i18n && typeof i18n.field === "function"
        ? i18n.field(value, key)
        : value[key] || value[key + "En"] || "";
    }

    function currentLocaleIsEnglish() {
      var i18n = root && root.DivinationI18n;
      return Boolean(i18n && typeof i18n.isEnglish === "function" && i18n.isEnglish());
    }

    function backImageForType(type) {
      if (typeof options.getBackImage === "function") {
        try {
          return options.getBackImage(type) || "";
        } catch (_error) {
          return "";
        }
      }
      return type === "mystagogus" ? "assets/cards/m/m-back.jpeg" : "";
    }

    function backImageForState(state) {
      return context && context.backImage || backImageForType(deckTypeFromState(state));
    }

    function setStatus(message, error) {
      if (!elements.status) return;
      elements.status.textContent = message || "";
      elements.status.classList.toggle("is-error", Boolean(error));
    }

    function setSaveStatus(message, error) {
      if (!elements.saveStatus) return;
      elements.saveStatus.textContent = message || "";
      elements.saveStatus.classList.toggle("is-error", Boolean(error));
    }

    function deckTypeFromState(state) {
      if (state && state.settings && typeof state.settings.deckType === "string") {
        return state.settings.deckType;
      }
      if (state && state.deck) {
        return state.deck.deckId || state.deck.id || state.deck.type || "tarot";
      }
      return context && context.deckType || "tarot";
    }

    function deckMap() {
      return context && context.allDecks ? context.allDecks : {};
    }

    function sourceCardsForState(state) {
      var type = deckTypeFromState(state);
      var available = deckMap()[type] || [];
      var byIdMap = Object.create(null);
      available.forEach(function (card) { byIdMap[card.id] = card; });
      if (state && state.deck && Array.isArray(state.deck.cards)) {
        state.deck.cards.forEach(function (descriptor) {
          var id = descriptor && (descriptor.id || descriptor.cardId);
          if (id && !byIdMap[id]) byIdMap[id] = descriptor;
        });
      }
      return byIdMap;
    }

    function sourceForCard(state, cardId) {
      var source = sourceCardsForState(state)[cardId];
      if (source) return source;
      var type = deckTypeFromState(state);
      return {
        id: cardId,
        number: cardId,
        name: cardId,
        nameEn: cardId,
        deck: type,
        arcana: type === "tarot" ? "major" : type,
        suit: ""
      };
    }

    function cardName(source) {
      return field(source, "name") || source.id || "";
    }

    function orientationLabel(orientation) {
      return orientation === "reversed" ? t("orientation.reversed") : t("orientation.upright");
    }

    function meaningFor(source, orientation) {
      var reversed = orientation === "reversed";
      var keywords = field(source, reversed ? "reversedKeywords" : "uprightKeywords") || [];
      var meaning = field(source, reversed ? "reversedMeaning" : "uprightMeaning") || "";
      return { keywords: Array.isArray(keywords) ? keywords : [], meaning: meaning };
    }

    function normalizedContext(input) {
      input = input || {};
      var type = input.deckType || "tarot";
      var allDecks = input.allDecks || {};
      var source = Array.isArray(input.cards) ? input.cards.slice() : (allDecks[type] || []).slice();
      var mode = type === "tarot" ? (input.mode || "upright-only") : "upright-only";
      var filter = type === "tarot" ? (input.filterMode || "mixed") : "not-applicable";
      var deckName = input.deckName || type;
      var nonTarotCardIds = source.filter(function (card) {
        return type !== "tarot" || card.deck !== "tarot";
      }).map(function (card) { return card.id; });
      var descriptors = source.map(function (card) {
        return {
          id: card.id,
          cardType: card.deck === "tarot" || type === "tarot" ? "tarot" : "non-tarot"
        };
      });
      var deck = {
        id: type,
        deckId: type,
        deckName: deckName,
        cardIds: source.map(function (card) { return card.id; }),
        cards: descriptors
      };
      var settings = {
        deckType: type,
        orientationMode: mode,
        filterMode: filter,
        overviewMethod: "not-applicable"
      };
      if (nonTarotCardIds.length) {
        deck.nonTarotCardIds = nonTarotCardIds;
        settings.nonTarotCardIds = nonTarotCardIds;
      }
      return {
        deckType: type,
        deckName: deckName,
        mode: mode,
        filterMode: filter,
        cards: source,
        allDecks: allDecks,
        backImage: input.backImage || backImageForType(type),
        deck: deck,
        settings: settings
      };
    }

    function ensureDraftAutosave() {
      if (draftAutosave || !draftApi || typeof draftApi.createAutosave !== "function") return;
      draftAutosave = draftApi.createAutosave({
        storage: options.storage,
        modelApi: modelApi,
        debounceMs: options.draftDebounceMs,
        onError: function () { setStatus(t("freeBoard.draftSaveFailed"), true); }
      });
    }

    function scheduleDraft() {
      if (!stateController) return;
      ensureDraftAutosave();
      if (!draftAutosave) return;
      try {
        var pending = draftAutosave.schedule(stateController);
        if (pending && typeof pending.catch === "function") {
          pending.catch(function () { setStatus(t("freeBoard.draftSaveFailed"), true); });
        }
      } catch (_error) {
        setStatus(t("freeBoard.draftSaveFailed"), true);
      }
    }

    function notifyChange(reason) {
      if (!stateController) return;
      scheduleDraft();
      render();
      if (typeof options.onChange === "function") options.onChange(stateController.getState(), reason);
    }

    function mutate(method, args, reason) {
      if (!stateController || typeof stateController[method] !== "function") return null;
      var result = stateController[method].apply(stateController, args || []);
      selectedCardId = selectedCardId && result.cards.some(function (card) {
        return card.cardId === selectedCardId;
      }) ? selectedCardId : null;
      notifyChange(reason || method);
      return result;
    }

    function getState() {
      return stateController ? stateController.getState() : null;
    }

    function cardState(cardId) {
      var state = getState();
      if (!state) return null;
      return state.cards.filter(function (card) { return card.cardId === cardId; })[0] || null;
    }

    function renderWorldTransform(viewport) {
      if (!elements.world) return;
      viewport = viewport || (getState() && getState().viewport) || { panX: 0, panY: 0, zoom: 1 };
      elements.world.style.transform = "translate3d(" + viewport.panX + "px, " +
        viewport.panY + "px, 0) scale(" + viewport.zoom + ")";
    }

    function cardTransform(card, transient) {
      var value = transient || card;
      return "translate3d(" + value.x + "px, " + value.y + "px, 0) rotate(" +
        value.boardRotation + "deg)";
    }

    function applyCardTransform(cardId, value) {
      var element = cardElements[cardId];
      if (element) element.style.transform = cardTransform(cardState(cardId), value);
    }

    function makeCardFace(state, card, source) {
      var inner = document.createElement("div");
      inner.className = "free-board-card-inner" +
        (card.orientation === "reversed" ? " is-reversed" : "");
      inner.setAttribute("data-orientation", card.orientation);
      var face = document.createElement("div");
      var backImage = backImageForState(state);
      face.className = "free-board-card-face" + (card.revealed ? " is-revealed" : " is-face-down") +
        (!card.revealed && backImage ? " has-deck-back" : "");
      face.setAttribute("data-free-board-back", deckTypeFromState(state));

      if (!card.revealed) {
        if (backImage) face.appendChild(makeBackImage(backImage));
        face.appendChild(textElement(document, "span", "free-board-card-back-label", t("freeBoard.faceDown")));
      } else if (card.meaningVisible) {
        var meaning = meaningFor(source, card.orientation);
        face.appendChild(textElement(document, "span", "free-board-card-meaning-kicker", t("freeBoard.meaning")));
        face.appendChild(textElement(document, "strong", "free-board-card-meaning-name", cardName(source)));
        face.appendChild(textElement(document, "span", "free-board-card-meaning-orientation", orientationLabel(card.orientation)));
        if (meaning.keywords.length) {
          face.appendChild(textElement(document, "span", "free-board-card-meaning-keywords", meaning.keywords.join(" · ")));
        }
        face.appendChild(textElement(document, "span", "free-board-card-meaning-text", meaning.meaning));
      } else {
        if (source.image) {
          var image = document.createElement("img");
          image.className = "free-board-card-image";
          image.src = source.image;
          image.alt = cardName(source);
          image.loading = "lazy";
          image.decoding = "async";
          face.appendChild(image);
        }
        face.appendChild(textElement(document, "span", "free-board-card-caption", cardName(source)));
        face.appendChild(textElement(document, "span", "free-board-card-orientation", orientationLabel(card.orientation)));
      }
      inner.appendChild(face);
      return inner;
    }

    function makeBackImage(source) {
      var image = document.createElement("img");
      image.className = "free-board-card-back-image";
      image.src = source;
      image.alt = "";
      image.decoding = "async";
      image.setAttribute("aria-hidden", "true");
      return image;
    }

    function cardAriaLabel(card, source) {
      var name = cardName(source);
      var stateText = card.revealed ? t("freeBoard.revealed") : t("freeBoard.unrevealed");
      var orientation = card.revealed ? " · " + orientationLabel(card.orientation) : "";
      return t("freeBoard.cardAria", {
        card: name,
        state: stateText,
        orientation: orientation
      });
    }

    function renderCard(state, card) {
      var source = sourceForCard(state, card.cardId);
      cardSources[card.cardId] = source;
      var cardElement = document.createElement("article");
      cardElement.className = "free-board-card" +
        (selectedCardId === card.cardId ? " is-selected" : "");
      cardElement.setAttribute("role", "listitem");
      cardElement.setAttribute("tabindex", "0");
      cardElement.setAttribute("data-card-id", card.cardId);
      cardElement.setAttribute("aria-label", cardAriaLabel(card, source));
      cardElement.style.zIndex = String(card.z);
      cardElement.style.transform = cardTransform(card, visualCards[card.cardId]);

      var inner = makeCardFace(state, card, source);
      cardElement.appendChild(inner);
      var drawOrder = textElement(document, "span", "free-board-card-draw-order",
        t("freeBoard.drawOrder", { order: card.drawOrder }));
      drawOrder.setAttribute("data-draw-order", String(card.drawOrder));
      drawOrder.setAttribute("aria-hidden", "true");
      cardElement.appendChild(drawOrder);

      cardElements[card.cardId] = cardElement;
      return cardElement;
    }

    function renderPile(state) {
      if (!elements.pile) return;
      elements.pile.replaceChildren();
      state.remainingPile.forEach(function (cardId, index) {
        var source = sourceForCard(state, cardId);
        var button = document.createElement("button");
        button.type = "button";
        button.className = "free-board-pile-card";
        button.setAttribute("data-pile-card-id", cardId);
        button.setAttribute("aria-label", t("freeBoard.drawAria", {
          index: index + 1,
          count: state.remainingPile.length
        }));
        var backImage = backImageForState(state);
        var back = textElement(document, "span", "free-board-pile-card-back" +
          (backImage ? " has-deck-back" : ""), t("freeBoard.faceDown"));
        back.setAttribute("data-free-board-back", deckTypeFromState(state));
        back.setAttribute("aria-hidden", "true");
        if (backImage) back.appendChild(makeBackImage(backImage));
        button.appendChild(back);
        button.addEventListener("click", function () { draw(cardId); });
        elements.pile.appendChild(button);
        // Keep the source reachable for screen-reader text and later history
        // rendering without exposing it on the face-down card.
        cardSources[cardId] = source;
      });
    }

    function renderSelectedControls(state) {
      if (!elements.selected) return;
      var selected = selectedCardId && cardState(selectedCardId);
      elements.selected.hidden = !selected;
      if (!selected) return;
      elements.selected.setAttribute("aria-label", t("freeBoard.selectedControls", {
        card: cardName(sourceForCard(state, selected.cardId))
      }));
      Array.prototype.forEach.call(
        elements.selected.querySelectorAll("[data-card-control-action]"),
        function (button) {
          var action = button.getAttribute("data-card-control-action");
          button.setAttribute("data-card-id", selected.cardId);
          button.disabled = action === "toggle-meaning" && !selected.revealed;
          if (action === "toggle-meaning") {
            var meaningVisible = Boolean(selected.revealed && selected.meaningVisible);
            var labelKey = meaningVisible ? "freeBoard.hideMeaning" : "freeBoard.showMeaning";
            var ariaKey = meaningVisible ? "freeBoard.hideMeaningAria" : "freeBoard.showMeaningAria";
            button.setAttribute("data-i18n", labelKey);
            button.setAttribute("data-i18n-aria-label", ariaKey);
            button.textContent = t(labelKey);
            button.setAttribute("aria-label", t(ariaKey));
          }
        }
      );
    }

    function render() {
      var state = getState();
      if (!state) return;
      if (elements.area) elements.area.hidden = false;
      if (elements.world) elements.world.replaceChildren();
      cardElements = Object.create(null);
      cardSources = Object.create(null);
      state.cards.forEach(function (card) {
        if (elements.world) elements.world.appendChild(renderCard(state, card));
      });
      renderWorldTransform(visualViewport || state.viewport);
      renderPile(state);
      renderSelectedControls(state);
      if (elements.count) elements.count.textContent = t("freeBoard.cardsDrawn", { count: state.cards.length });
      if (elements.pileRemaining) {
        elements.pileRemaining.textContent = t("freeBoard.remaining", {
          count: state.remainingPile.length
        });
      }
      if (elements.status && !invalidDraft) {
        setStatus(t("freeBoard.status", {
          cards: state.cards.length,
          remaining: state.remainingPile.length
        }), false);
      }
      if (elements.hint) elements.hint.textContent = t("freeBoard.hint");
      if (elements.undo) elements.undo.disabled = !stateController.canUndo();
      if (elements.redo) elements.redo.disabled = !stateController.canRedo();
      if (elements.revealAll) elements.revealAll.disabled = state.cards.length === 0 ||
        state.cards.every(function (card) { return card.revealed; });
      if (elements.shuffle) elements.shuffle.disabled = state.cards.length === 0 && state.remainingPile.length === 0;
      if (elements.discard) elements.discard.disabled = state.cards.length === 0 && state.remainingPile.length === 0;
    }

    function refreshMedia() {
      if (context) context.backImage = backImageForType(context.deckType);
      if (stateController) render();
    }

    function setVisible(visible) {
      if (!elements.area) return;
      elements.area.hidden = !visible;
      elements.area.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    function requestConfirm(message, titleKey) {
      var dialog = root && root.DivinationDialog;
      if (!dialog || typeof dialog.request !== "function") return Promise.resolve(false);
      return dialog.request({
        kicker: t("confirm.kicker"),
        title: t(titleKey || "confirm.title"),
        message: message,
        cancelLabel: t("confirm.cancel"),
        proceedLabel: t("confirm.proceed")
      });
    }

    function buildHistoryRecord() {
      if (!stateController || !recordsApi || typeof recordsApi.buildFreeformRecord !== "function") {
        throw new Error("freeform history API is unavailable");
      }
      var state = getState();
      var type = deckTypeFromState(state);
      var cards = state.cards.map(function (card) {
        var source = sourceForCard(state, card.cardId);
        return {
          cardId: card.cardId,
          cardNumber: String(source.number == null ? card.cardId : source.number),
          cardName: cardName(source),
          arcana: source.arcana || (type === "tarot" ? "major" : type),
          suit: source.suit || "",
          orientation: card.orientation,
          revealed: card.revealed,
          x: card.x,
          y: card.y,
          boardRotation: card.boardRotation,
          z: card.z,
          drawOrder: card.drawOrder
        };
      });
      return recordsApi.buildFreeformRecord({
        deckType: type,
        deckMode: type,
        deckName: state.deck.deckName || (context && context.deckName) || type,
        orientationMode: state.settings.orientationMode || "upright-only",
        filterMode: state.settings.filterMode || "not-applicable",
        overviewMethod: "not-applicable",
        cards: cards
      });
    }

    function saveHistory() {
      if (!stateController || getState().cards.length === 0) return Promise.resolve(null);
      var record;
      try {
        record = buildHistoryRecord();
      } catch (_error) {
        setSaveStatus(t("freeBoard.saveFailed"), true);
        return Promise.resolve(null);
      }
      var getHistory = options.getHistoryController;
      var history = typeof getHistory === "function" ? getHistory() : options.historyController;
      if (!history || typeof history.saveRecord !== "function") {
        setSaveStatus(t("freeBoard.saveUnavailable"), true);
        return Promise.resolve(null);
      }
      setSaveStatus(t("freeBoard.saving"), false);
      return Promise.resolve(history.saveRecord(record, { kind: "freeform" }))
        .then(function (result) {
          if (!result) setSaveStatus(t("freeBoard.saveFailed"), true);
          else if (result.duplicate) setSaveStatus(t("freeBoard.duplicate"), false);
          else setSaveStatus(t("freeBoard.saved"), false);
          return result;
        })
        .catch(function () {
          setSaveStatus(t("freeBoard.saveFailed"), true);
          return null;
        });
    }

    function draw(cardId) {
      if (!stateController) return null;
      var state = getState();
      if (state.remainingPile.indexOf(cardId) === -1) return null;
      var position = defaultDrawPosition(state.cards.length, platform);
      var type = deckTypeFromState(state);
      var orientation = state.settings.orientationMode === "mixed" && type === "tarot" &&
        Math.random() > 0.5 ? "reversed" : "upright";
      return mutate("draw", [cardId, {
        orientation: orientation,
        x: position.x,
        y: position.y,
        boardRotation: 0,
        revealed: false,
        meaningVisible: false
      }], "draw");
    }

    function revealAll() {
      if (!stateController || getState().cards.length === 0) return Promise.resolve(null);
      mutate("revealAll", [], "reveal-all");
      return saveHistory();
    }

    function removeCard(cardId) {
      if (!cardState(cardId)) return null;
      if (selectedCardId === cardId) selectedCardId = null;
      return mutate("removeCard", [cardId], "remove");
    }

    function rotate(cardId, degrees) {
      if (!cardState(cardId)) return null;
      selectedCardId = cardId;
      return mutate("rotateBy", [cardId, degrees], "rotate");
    }

    function bringToFront(cardId) {
      if (!cardState(cardId)) return null;
      selectedCardId = cardId;
      return mutate("bringToFront", [cardId], "bring-front");
    }

    function resetView() {
      visualViewport = null;
      return mutate("resetViewport", [], "reset-view");
    }

    function clearBoard() {
      return mutate("clear", [], "clear");
    }

    function discardDraft() {
      if (!stateController) return Promise.resolve(false);
      // The draft also owns pile order and viewport, so an empty board can
      // still contain state the user asked us to preserve.
      var proceed = requestConfirm(t("confirm.freeBoardDiscard"), "confirm.title");
      return proceed.then(function (accepted) {
        if (!accepted) return false;
        selectedCardId = null;
        if (draftAutosave) draftAutosave.discard();
        else if (draftApi && typeof draftApi.discard === "function") {
          draftApi.discard(options.storage);
        }
        clearBoard();
        // clearBoard emits a normal change event and therefore schedules the
        // empty, valid board draft. Explicit discard must win over that
        // autosave, so remove the key once more after the reset.
        if (draftAutosave) draftAutosave.discard();
        else if (draftApi && typeof draftApi.discard === "function") {
          draftApi.discard(options.storage);
        }
        setStatus(t("freeBoard.draftDiscarded"), false);
        return true;
      });
    }

    function shuffleBoard() {
      if (!stateController || !context) return Promise.resolve(false);
      var proceed = requestConfirm(t("confirm.freeBoardShuffle"), "confirm.title");
      return proceed.then(function (accepted) {
        if (!accepted) return false;
        var next = normalizedContext({
          deckType: context.deckType,
          deckName: context.deckName,
          mode: context.mode,
          filterMode: context.filterMode,
          cards: shuffled(context.cards),
          allDecks: context.allDecks
        });
        reconfigure(next);
        return true;
      });
    }

    function handleAction(action, cardId) {
      switch (action) {
        case "rotate-minus-15": return rotate(cardId, -15);
        case "rotate-plus-15": return rotate(cardId, 15);
        case "rotate-minus-90": return rotate(cardId, -90);
        case "rotate-plus-90": return rotate(cardId, 90);
        case "bring-front": return bringToFront(cardId);
        case "toggle-meaning":
          if (!cardState(cardId) || !cardState(cardId).revealed) return null;
          selectedCardId = cardId;
          return mutate("toggleMeaning", [cardId], "meaning");
        case "remove": return removeCard(cardId);
        default: return null;
      }
    }

    function pointerPosition(event) {
      return {
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0
      };
    }

    function pointerId(event) {
      return event.pointerId == null ? 1 : event.pointerId;
    }

    function pointerCount() {
      return Object.keys(pointers).length;
    }

    function twoPointers() {
      var ids = Object.keys(pointers);
      return ids.length >= 2 ? [pointers[ids[0]], pointers[ids[1]]] : null;
    }

    function viewportClientToWorld(point, viewport) {
      var rect = viewportRect(elements.viewport && elements.viewport.getBoundingClientRect
        ? elements.viewport.getBoundingClientRect()
        : null);
      return {
        x: (point.x - (rect.left + rect.width / 2) - viewport.panX) / viewport.zoom,
        y: (point.y - (rect.top + rect.height / 2) - viewport.panY) / viewport.zoom
      };
    }

    function startPinch() {
      var pair = twoPointers();
      if (!pair || !stateController) return;
      var state = getState();
      var startMid = midpoint(pair[0], pair[1]);
      gesture = {
        kind: "pinch",
        startViewport: copyViewport(visualViewport || state.viewport),
        startMid: startMid,
        startDistance: distance(pair[0], pair[1]),
        moved: true
      };
      visualViewport = copyViewport(gesture.startViewport);
      visualCards = Object.create(null);
      renderWorldTransform(visualViewport);
    }

    function setPointerCapture(target, id) {
      if (target && typeof target.setPointerCapture === "function") {
        try { target.setPointerCapture(id); } catch (_error) {}
      }
    }

    function releasePointerCapture(target, id) {
      if (target && typeof target.releasePointerCapture === "function") {
        try { target.releasePointerCapture(id); } catch (_error) {}
      }
    }

    function handlePointerDown(event) {
      if (event.button != null && event.button !== 0) return;
      var id = pointerId(event);
      var point = pointerPosition(event);
      pointers[id] = { id: id, x: point.x, y: point.y, target: event.target };
      var cardElement = findCardElement(event.target);
      var cardId = cardElement && cardElement.getAttribute("data-card-id");
      if (cardId) {
        selectedCardId = cardId;
        renderSelectedControls(getState());
      }
      setPointerCapture(event.currentTarget || elements.viewport, id);
      if (pointerCount() >= 2) {
        startPinch();
        if (event.preventDefault) event.preventDefault();
        return;
      }
      if (!stateController) return;
      var state = getState();
      if (cardId && cardState(cardId)) {
        var world = viewportClientToWorld(point, visualViewport || state.viewport);
        var card = cardState(cardId);
        gesture = {
          kind: "card",
          pointerId: id,
          cardId: cardId,
          startPoint: point,
          startWorld: world,
          startCard: { x: card.x, y: card.y, boardRotation: card.boardRotation },
          moved: false
        };
      } else {
        gesture = {
          kind: "pan",
          pointerId: id,
          startPoint: point,
          startViewport: copyViewport(visualViewport || state.viewport),
          moved: false
        };
      }
      if (event.preventDefault) event.preventDefault();
    }

    function handlePointerMove(event) {
      var id = pointerId(event);
      if (!pointers[id]) return;
      var point = pointerPosition(event);
      pointers[id].x = point.x;
      pointers[id].y = point.y;
      if (!gesture || !stateController) return;
      if (pointerCount() >= 2) {
        if (gesture.kind !== "pinch") startPinch();
        var pair = twoPointers();
        if (!pair || gesture.kind !== "pinch") return;
        var currentMid = midpoint(pair[0], pair[1]);
        var next = pinchViewport(
          gesture.startViewport,
          elements.viewport && elements.viewport.getBoundingClientRect
            ? elements.viewport.getBoundingClientRect()
            : null,
          gesture.startMid,
          currentMid,
          gesture.startDistance,
          distance(pair[0], pair[1]),
          modelApi
        );
        visualViewport = next;
        renderWorldTransform(next);
        if (event.preventDefault) event.preventDefault();
        return;
      }
      if (gesture.kind === "card" && gesture.pointerId === id) {
        var deltaX = (point.x - gesture.startPoint.x) /
          (visualViewport || getState().viewport).zoom;
        var deltaY = (point.y - gesture.startPoint.y) /
          (visualViewport || getState().viewport).zoom;
        if (Math.hypot(point.x - gesture.startPoint.x, point.y - gesture.startPoint.y) > DRAG_THRESHOLD) {
          gesture.moved = true;
        }
        if (gesture.moved) {
          visualCards[gesture.cardId] = {
            x: gesture.startCard.x + deltaX,
            y: gesture.startCard.y + deltaY,
            boardRotation: gesture.startCard.boardRotation
          };
          applyCardTransform(gesture.cardId, visualCards[gesture.cardId]);
          if (event.preventDefault) event.preventDefault();
        }
      } else if (gesture.kind === "pan" && gesture.pointerId === id) {
        var distanceMoved = Math.hypot(point.x - gesture.startPoint.x, point.y - gesture.startPoint.y);
        if (distanceMoved > DRAG_THRESHOLD) gesture.moved = true;
        if (gesture.moved) {
          visualViewport = {
            panX: gesture.startViewport.panX + point.x - gesture.startPoint.x,
            panY: gesture.startViewport.panY + point.y - gesture.startPoint.y,
            zoom: gesture.startViewport.zoom
          };
          renderWorldTransform(visualViewport);
          if (event.preventDefault) event.preventDefault();
        }
      }
    }

    function commitVisualViewport() {
      if (!visualViewport || !stateController) return;
      var current = getState().viewport;
      if (visualViewport.panX === current.panX && visualViewport.panY === current.panY &&
          visualViewport.zoom === current.zoom) return;
      var next = copyViewport(visualViewport);
      visualViewport = null;
      mutate("setViewport", [next], "viewport");
    }

    function finishPointer(event) {
      var id = pointerId(event);
      var target = event.currentTarget || elements.viewport;
      var wasPinch = gesture && gesture.kind === "pinch";
      if (pointers[id]) delete pointers[id];
      releasePointerCapture(target, id);
      if (wasPinch) {
        if (pointerCount() === 0) {
          commitVisualViewport();
          gesture = null;
        }
        return;
      }
      if (!gesture || !stateController) return;
      if (gesture.kind === "card" && gesture.pointerId === id) {
        if (gesture.moved) {
          var moved = visualCards[gesture.cardId];
          delete visualCards[gesture.cardId];
          if (moved) mutate("move", [gesture.cardId, moved.x, moved.y], "move");
        } else if (cardState(gesture.cardId)) {
          selectedCardId = gesture.cardId;
          renderSelectedControls(getState());
        }
      } else if (gesture.kind === "pan" && gesture.pointerId === id) {
        if (gesture.moved) commitVisualViewport();
      }
      visualCards = Object.create(null);
      gesture = null;
      if (event.preventDefault) event.preventDefault();
    }

    function handleWheel(event) {
      if (!stateController) return;
      var state = getState();
      var delta = Number(event.deltaY) || 0;
      if (!delta) return;
      var factor = Math.exp(-delta * 0.0015);
      var target = clampZoom(state.viewport.zoom * factor, modelApi);
      var next = zoomAroundPoint(
        state.viewport,
        elements.viewport && elements.viewport.getBoundingClientRect
          ? elements.viewport.getBoundingClientRect()
          : null,
        { x: event.clientX, y: event.clientY },
        target,
        modelApi
      );
      mutate("setViewport", [next], "wheel-zoom");
      if (event.preventDefault) event.preventDefault();
    }

    function handleKeydown(event) {
      var cardElement = findCardElement(event.target);
      if (!cardElement || (event.key !== "Enter" && event.key !== " ")) return;
      var cardId = cardElement.getAttribute("data-card-id");
      if (!cardState(cardId)) return;
      if (event.preventDefault) event.preventDefault();
      selectedCardId = cardId;
      renderSelectedControls(getState());
    }

    function handleSelectedAction(event) {
      var button = event.target;
      while (button && button !== elements.selected &&
          !(button.getAttribute && button.getAttribute("data-card-control-action"))) {
        button = button.parentNode;
      }
      if (!button || button === elements.selected) return;
      var action = button.getAttribute("data-card-control-action");
      handleAction(action, button.getAttribute("data-card-id") || selectedCardId);
    }

    function bind() {
      if (bound) return;
      bound = true;
      if (elements.viewport) {
        elements.viewport.addEventListener("pointerdown", handlePointerDown);
        elements.viewport.addEventListener("pointermove", handlePointerMove);
        elements.viewport.addEventListener("pointerup", finishPointer);
        elements.viewport.addEventListener("pointercancel", finishPointer);
        elements.viewport.addEventListener("wheel", handleWheel, { passive: false });
        elements.viewport.addEventListener("keydown", handleKeydown);
      }
      if (elements.selected) elements.selected.addEventListener("click", handleSelectedAction);
      if (elements.undo) elements.undo.addEventListener("click", function () { mutate("undo", [], "undo"); });
      if (elements.redo) elements.redo.addEventListener("click", function () { mutate("redo", [], "redo"); });
      if (elements.revealAll) elements.revealAll.addEventListener("click", revealAll);
      if (elements.resetView) elements.resetView.addEventListener("click", resetView);
      if (elements.shuffle) elements.shuffle.addEventListener("click", shuffleBoard);
      if (elements.discard) elements.discard.addEventListener("click", discardDraft);
      if (root && typeof root.addEventListener === "function") {
        root.addEventListener("quareia:mediaready", refreshMedia);
      }
    }

    function loadDraft() {
      if (!draftApi || typeof draftApi.readResult !== "function") return null;
      var result = draftApi.readResult(options.storage, { modelApi: modelApi });
      invalidDraft = Boolean(result.invalid);
      if (result.invalid) {
        setStatus(t("freeBoard.draftInvalid"), true);
        if (typeof options.onDraftInvalid === "function") options.onDraftInvalid();
        return null;
      }
      return result.draft;
    }

    function restoreDraftIfAvailable() {
      var raw = loadDraft();
      if (!raw) return null;
      try {
        stateController = modelApi.restoreDraft(raw);
        var state = getState();
        var restoredCards = [];
        var restoredMap = sourceCardsForState(state);
        (state.deck.cardIds || []).forEach(function (cardId) {
          restoredCards.push(restoredMap[cardId] || { id: cardId, name: cardId, nameEn: cardId });
        });
        context = normalizedContext({
          deckType: deckTypeFromState(state),
          deckName: state.deck.deckName,
          mode: state.settings.orientationMode,
          filterMode: state.settings.filterMode,
          cards: restoredCards,
          allDecks: options.allDecks || {},
          backImage: backImageForType(deckTypeFromState(state))
        });
        ensureDraftAutosave();
        selectedCardId = null;
        bind();
        setVisible(true);
        render();
        if (typeof options.onRestoreState === "function") options.onRestoreState(state);
        return state;
      } catch (_error) {
        if (draftApi && typeof draftApi.discard === "function") draftApi.discard(options.storage);
        invalidDraft = true;
        setStatus(t("freeBoard.draftInvalid"), true);
        if (typeof options.onDraftInvalid === "function") options.onDraftInvalid();
        return null;
      }
    }

    function enter(input, enterOptions) {
      enterOptions = enterOptions || {};
      if (stateController && enterOptions.reuse !== false) {
        setVisible(true);
        render();
        return getState();
      }
      if (enterOptions.restoreDraft !== false) {
        var restored = restoreDraftIfAvailable();
        if (restored) return restored;
      }
      context = normalizedContext(input);
      stateController = modelApi.createController({
        deck: context.deck,
        settings: context.settings
      });
      invalidDraft = false;
      selectedCardId = null;
      visualCards = Object.create(null);
      visualViewport = null;
      ensureDraftAutosave();
      bind();
      setVisible(true);
      render();
      scheduleDraft();
      return getState();
    }

    function reconfigure(input) {
      context = normalizedContext(input);
      if (draftAutosave) draftAutosave.discard();
      stateController = modelApi.createController({
        deck: context.deck,
        settings: context.settings
      });
      selectedCardId = null;
      visualCards = Object.create(null);
      visualViewport = null;
      setVisible(true);
      render();
      scheduleDraft();
      return getState();
    }

    function exit() {
      if (draftAutosave) draftAutosave.discard();
      stateController = null;
      context = null;
      selectedCardId = null;
      visualCards = Object.create(null);
      visualViewport = null;
      pointers = Object.create(null);
      gesture = null;
      setVisible(false);
      if (elements.world) elements.world.replaceChildren();
      if (elements.pile) elements.pile.replaceChildren();
      if (typeof options.onExit === "function") options.onExit();
    }

    function discardDraftExplicit() {
      return discardDraft();
    }

    function refreshLanguage() {
      if (stateController) render();
      if (elements.area && stateController) setVisible(true);
    }

    function updateContext(input) {
      context = normalizedContext(input);
      return context;
    }

    bind();
    setVisible(false);

    return {
      enter: enter,
      reconfigure: reconfigure,
      exit: exit,
      restoreDraftIfAvailable: restoreDraftIfAvailable,
      getState: getState,
      getCardCount: function () { var state = getState(); return state ? state.cards.length : 0; },
      hasCards: function () { return Boolean(getState() && getState().cards.length); },
      isActive: function () { return Boolean(stateController); },
      draw: draw,
      revealAll: revealAll,
      undo: function () { return mutate("undo", [], "undo"); },
      redo: function () { return mutate("redo", [], "redo"); },
      resetView: resetView,
      shuffle: shuffleBoard,
      discardDraft: discardDraftExplicit,
      buildHistoryRecord: buildHistoryRecord,
      refreshMedia: refreshMedia,
      refreshLanguage: refreshLanguage,
      updateContext: updateContext,
      getContext: function () { return context; },
      setVisible: setVisible,
      clampZoom: function (value) { return clampZoom(value, modelApi); }
    };
  }

  return Object.freeze({
    clamp: clamp,
    clampZoom: clampZoom,
    zoomAroundPoint: zoomAroundPoint,
    pinchViewport: pinchViewport,
    defaultDrawPosition: defaultDrawPosition,
    shuffled: shuffled,
    createController: createController,
    init: createController,
    DEFAULT_CARD_WIDTH: DEFAULT_CARD_WIDTH,
    DEFAULT_CARD_HEIGHT: DEFAULT_CARD_HEIGHT
  });
});
