(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DivinationHistoryUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var activeController = null;

  var fallbackI18n = null;
  if (typeof require === "function") {
    fallbackI18n = require("./i18n.js");
  }

  function i18n() {
    return globalThis.DivinationI18n || fallbackI18n;
  }

  function t(key, values) {
    var api = i18n();
    return api ? api.t(key, values) : key;
  }

  function localized(value, field) {
    if (!value) return "";
    var api = i18n();
    return api
      ? api.field(value, field)
      : value[field];
  }

  function currentSpread(record) {
    if (typeof getSpreadById !== "function") return null;
    var spread = getSpreadById(record.deckType, record.spreadId);
    return spread && spread.id === record.spreadId ? spread : null;
  }

  function currentDeck(record) {
    if (record.deckType === "tarot" && typeof tarotDeckFull !== "undefined") return tarotDeckFull;
    if (record.deckType === "mystagogus" && typeof mystagogusDeckFull !== "undefined") return mystagogusDeckFull;
    if (record.deckType === "lxxxi" && typeof lxxxiDeckFull !== "undefined") return lxxxiDeckFull;
    return [];
  }

  function displaySpreadName(record) {
    if (record && record.layoutMode === "freeform") return t("history.freeBoard");
    var spread = currentSpread(record);
    return localized(spread, "name") || record.spreadName;
  }

  function displayPositionName(record, card) {
    var spread = currentSpread(record);
    var position = spread && spread.positions && spread.positions[card.slotIndex];
    return localized(position, "name") || card.positionName;
  }

  function displayCardName(record, card) {
    var sourceCard = currentDeck(record).filter(function (item) {
      return item.id === card.cardId;
    })[0];
    return localized(sourceCard, "name") || card.cardName;
  }

  function displayDeckName(record) {
    return t("deck.name." + record.deckType) || record.deckName;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function formatTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(
      i18n() && i18n().isEnglish() ? "en-US" : "zh-CN",
      {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
      }
    ).format(date);
  }

  function button(text, className) {
    var element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function createDefinition(label, value) {
    var row = document.createElement("div");
    row.className = "history-definition-row";
    var term = document.createElement("dt");
    term.textContent = label;
    var description = document.createElement("dd");
    description.textContent = value;
    row.appendChild(term);
    row.appendChild(description);
    return row;
  }

  function createSerialTaskQueue() {
    var tail = Promise.resolve();
    return function enqueue(task) {
      var run = tail.then(task, task);
      tail = run.catch(function () {});
      return run;
    };
  }

  function calculateFreeformPreviewLayout(cards) {
    var cardWidth = 104;
    var cardHeight = 158;
    var padding = 18;
    var minCardScale = 0.5;
    var minX = cards.reduce(function (value, card) { return Math.min(value, card.x); }, 0);
    var minY = cards.reduce(function (value, card) { return Math.min(value, card.y); }, 0);
    var maxX = cards.reduce(function (value, card) { return Math.max(value, card.x); }, 0);
    var maxY = cards.reduce(function (value, card) { return Math.max(value, card.y); }, 0);
    var positionWidth = Math.max(0, maxX - minX);
    var positionHeight = Math.max(0, maxY - minY);
    var widthScale = positionWidth === 0
      ? 1
      : Math.max(0, (560 - cardWidth * minCardScale) / positionWidth);
    var heightScale = positionHeight === 0
      ? 1
      : Math.max(0, (340 - cardHeight * minCardScale) / positionHeight);
    var positionScale = Math.min(1, widthScale, heightScale);
    var cardScale = Math.max(minCardScale, positionScale);
    return {
      minX: minX,
      minY: minY,
      positionScale: positionScale,
      cardScale: cardScale,
      cardWidth: cardWidth,
      cardHeight: cardHeight,
      padding: padding,
      stageWidth: Math.max(260, positionWidth * positionScale + cardWidth * cardScale + padding * 2),
      stageHeight: Math.max(190, positionHeight * positionScale + cardHeight * cardScale + padding * 2)
    };
  }

  function init(options) {
    options = options || {};
    var store = options.store;
    var recordsApi = options.recordsApi || globalThis.DivinationHistoryRecords;
    var createSnapshot = options.createSnapshot;
    var available = false;
    var readingComplete = false;
    var storeReady = null;
    var enqueueSave = createSerialTaskQueue();
    var selectedRecordId = null;
    var selectedRecord = null;
    var restoreFocusTo = null;

    var elements = {
      open: byId("historyOpenBtn"),
      saveStatus: byId("historySaveStatus"),
      dialog: byId("historyDialog"),
      close: byId("historyCloseBtn"),
      filter: byId("historyDeckFilter"),
      exportButton: byId("historyExportBtn"),
      importInput: byId("historyImportInput"),
      importLabel: byId("historyImportLabel"),
      actionStatus: byId("historyActionStatus"),
      list: byId("historyList"),
      empty: byId("historyEmpty"),
      detail: byId("historyDetail"),
      detailTitle: byId("historyDetailTitle"),
      detailBody: byId("historyDetailBody"),
      back: byId("historyBackBtn"),
      deleteButton: byId("historyDeleteBtn"),
      clear: byId("historyClearBtn")
    };

    // The Android host opens the system save picker and calls this callback
    // only after it has written the selected content:// destination.
    globalThis.__quareiaHistoryExportResult = function (result) {
      if (result && result.cancelled) {
        setTranslatedStatus(elements.actionStatus, "history.exportCancelled", null, false);
      } else if (result && result.ok) {
        setTranslatedStatus(elements.actionStatus, "history.exportedTo", {
          fileName: result.fileName || "tarot-history.json"
        }, false);
      } else {
        setTranslatedStatus(elements.actionStatus, "history.exportFailed", null, true);
      }
    };

    function setStatus(target, message, isError, renderMessage) {
      if (!target) return;
      target.textContent = message;
      target.classList.toggle("is-error", Boolean(isError));
      target._historyStatusRender = typeof renderMessage === "function" ? renderMessage : null;
    }

    function setTranslatedStatus(target, key, values, isError) {
      var renderMessage = function () {
        return t(key, values);
      };
      setStatus(target, renderMessage(), isError, renderMessage);
    }

    function refreshStatus(target) {
      if (!target || typeof target._historyStatusRender !== "function") return;
      target.textContent = target._historyStatusRender();
    }

    function setUnavailable() {
      available = false;
      if (elements.importLabel) {
        elements.importLabel.setAttribute("aria-disabled", "true");
        elements.importLabel.classList.add("is-disabled");
      }
      [elements.exportButton, elements.clear, elements.filter].forEach(function (element) {
        if (element) element.disabled = true;
      });
      if (readingComplete) {
        setTranslatedStatus(elements.saveStatus, "history.unavailableSave", null, true);
      } else {
        setStatus(elements.saveStatus, "", true);
      }
      setTranslatedStatus(elements.actionStatus, "history.unavailable", null, true);
    }

    function showListView() {
      selectedRecordId = null;
      selectedRecord = null;
      if (elements.list) elements.list.hidden = false;
      if (elements.empty) elements.empty.hidden = true;
      if (elements.detail) elements.detail.hidden = true;
      if (elements.back) elements.back.hidden = true;
      if (elements.deleteButton) elements.deleteButton.hidden = true;
    }

  function renderList(records) {
      showListView();
      elements.list.replaceChildren();
      elements.empty.hidden = records.length !== 0;
      records.forEach(function (record) {
        var item = document.createElement("li");
        item.className = "history-list-item";
        var openButton = button("", "history-record-open");
        openButton.setAttribute("aria-label", t("history.viewAria", {
          spread: displaySpreadName(record),
          time: formatTime(record.createdAt)
        }));

        var heading = document.createElement("span");
        heading.className = "history-record-title";
        heading.textContent = displaySpreadName(record);
        var meta = document.createElement("span");
        meta.className = "history-record-meta";
        meta.textContent = formatTime(record.createdAt) + " · " +
          displayDeckName(record) + " · " +
          t("history.cards", { count: record.cards.length });
        openButton.appendChild(heading);
        openButton.appendChild(meta);
        openButton.addEventListener("click", function () {
          showDetail(record);
        });
        item.appendChild(openButton);
        elements.list.appendChild(item);
      });
    }

    function renderCard(record, card) {
      var item = document.createElement("li");
      item.className = "history-detail-card";
      var name = document.createElement("h4");
      name.textContent = card.positionNumber + ". " + displayPositionName(record, card);
      var cardName = document.createElement("p");
      var orientation = card.orientation === "reversed"
        ? t("history.orientation.reversed")
        : t("history.orientation.upright");
      var layer = card.layer === "major" ? t("history.layer.major") :
        card.layer === "minor" ? t("history.layer.minor") : "";
      cardName.textContent = displayCardName(record, card) + " (" + card.cardNumber + ") · " + orientation + layer;
      item.appendChild(name);
      item.appendChild(cardName);
      return item;
    }

    function renderFreeformCard(record, card, source) {
      var item = document.createElement("li");
      item.className = "history-detail-card history-free-board-card-summary";
      var name = document.createElement("h4");
      name.textContent = displayCardName(record, card);
      var orientation = card.orientation === "reversed"
        ? t("history.orientation.reversed")
        : t("history.orientation.upright");
      var state = card.revealed
        ? t("history.freeBoardRevealed", { orientation: orientation })
        : t("history.freeBoardHidden");
      var details = document.createElement("p");
      details.textContent = t("history.freeBoardCardState", {
        card: displayCardName(record, card),
        state: state
      }) + " · x " + card.x + " · y " + card.y + " · " + card.boardRotation + "°";
      item.appendChild(name);
      item.appendChild(details);
      return item;
    }

    function renderFreeformBoard(record) {
      var section = document.createElement("section");
      section.className = "history-free-board-preview";
      section.setAttribute("aria-label", t("history.freeBoardPreview"));

      var heading = document.createElement("h3");
      heading.textContent = t("history.freeBoardPreview");
      section.appendChild(heading);

      var stage = document.createElement("div");
      stage.className = "history-free-board-stage";
      stage.setAttribute("role", "list");

      var layout = calculateFreeformPreviewLayout(record.cards);
      stage.style.width = layout.stageWidth + "px";
      stage.style.height = layout.stageHeight + "px";

      record.cards.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (card) {
        var source = currentDeck(record).filter(function (item) { return item.id === card.cardId; })[0] || card;
        var cardElement = document.createElement("article");
        cardElement.className = "history-free-board-card";
        cardElement.setAttribute("role", "listitem");
        var cardName = displayCardName(record, card);
        var orientation = card.orientation === "reversed"
          ? t("history.orientation.reversed")
          : t("history.orientation.upright");
        var stateText = card.revealed
          ? t("history.freeBoardRevealed", { orientation: orientation })
          : t("history.freeBoardHidden");
        cardElement.setAttribute("aria-label", t("history.freeBoardCardState", {
          card: cardName,
          state: stateText
        }));
        cardElement.style.left = (layout.padding + (card.x - layout.minX) * layout.positionScale) + "px";
        cardElement.style.top = (layout.padding + (card.y - layout.minY) * layout.positionScale) + "px";
        cardElement.style.width = (layout.cardWidth * layout.cardScale) + "px";
        cardElement.style.height = (layout.cardHeight * layout.cardScale) + "px";
        cardElement.style.zIndex = String(card.z);
        cardElement.style.transform = "rotate(" + card.boardRotation + "deg)";

        var inner = document.createElement("div");
        inner.className = "history-free-board-card-inner" +
          (card.orientation === "reversed" ? " is-reversed" : "");
        if (card.revealed) {
          if (source.image) {
            var image = document.createElement("img");
            image.src = source.image;
            image.alt = cardName;
            inner.appendChild(image);
          }
          inner.appendChild(textElement("span", "history-free-board-card-name", cardName));
          inner.appendChild(textElement("span", "history-free-board-card-state", stateText));
        } else {
          inner.appendChild(textElement("span", "history-free-board-card-back", t("history.freeBoardHidden")));
        }
        cardElement.appendChild(inner);
        stage.appendChild(cardElement);
      });
      section.appendChild(stage);
      return section;
    }

    function textElement(tagName, className, value) {
      var element = document.createElement(tagName);
      element.className = className;
      element.textContent = value;
      return element;
    }

    function showDetail(record) {
      selectedRecordId = record.id;
      selectedRecord = record;
      elements.list.hidden = true;
      elements.empty.hidden = true;
      elements.detail.hidden = false;
      elements.back.hidden = false;
      elements.deleteButton.hidden = false;
      elements.detailTitle.textContent = record.layoutMode === "freeform"
        ? t("history.freeBoardDetail")
        : displaySpreadName(record);
      elements.detailBody.replaceChildren();

      var definitions = document.createElement("dl");
      definitions.className = "history-definitions";
      definitions.appendChild(createDefinition(t("history.field.time"), formatTime(record.createdAt)));
      definitions.appendChild(createDefinition(t("history.field.deck"), displayDeckName(record)));
      definitions.appendChild(createDefinition(t("history.field.cards"), String(record.cards.length)));
      elements.detailBody.appendChild(definitions);

      if (record.layoutMode === "freeform") {
        elements.detailBody.appendChild(renderFreeformBoard(record));
        var freeBoardHeading = document.createElement("h3");
        freeBoardHeading.textContent = t("history.freeBoardPreview");
        var freeBoardCards = document.createElement("ol");
        freeBoardCards.className = "history-detail-cards";
        record.cards.slice().sort(function (a, b) { return a.z - b.z; }).forEach(function (card) {
          freeBoardCards.appendChild(renderFreeformCard(record, card));
        });
        elements.detailBody.appendChild(freeBoardHeading);
        elements.detailBody.appendChild(freeBoardCards);
        elements.back.focus();
        return;
      }

      var cardsHeading = document.createElement("h3");
      cardsHeading.textContent = t("history.completePositions");
      var cards = document.createElement("ol");
      cards.className = "history-detail-cards";
      record.cards.forEach(function (card) {
        cards.appendChild(renderCard(record, card));
      });
      elements.detailBody.appendChild(cardsHeading);
      elements.detailBody.appendChild(cards);
      elements.back.focus();
    }

    async function refreshList() {
      if (!available) {
        elements.list.replaceChildren();
        elements.empty.hidden = false;
        return;
      }
      try {
        var records = await store.listRecords(elements.filter.value || "all");
        renderList(records);
      } catch (_error) {
        setUnavailable();
      }
    }

    function openDialog() {
      restoreFocusTo = document.activeElement;
      showListView();
      setStatus(elements.actionStatus, "", false);
      if (typeof elements.dialog.showModal === "function") {
        elements.dialog.showModal();
      } else {
        elements.dialog.setAttribute("open", "");
      }
      refreshList();
      elements.close.focus();
    }

    function closeDialog() {
      if (typeof elements.dialog.close === "function") elements.dialog.close();
      else {
        elements.dialog.removeAttribute("open");
        if (restoreFocusTo && typeof restoreFocusTo.focus === "function") restoreFocusTo.focus();
      }
    }

    function handleBack() {
      if (!elements.dialog || !elements.dialog.open) return false;
      closeDialog();
      return true;
    }

    function saveRecord(record, saveOptions) {
      saveOptions = saveOptions || {};
      var isFreeBoard = saveOptions.kind === "freeform" || record && record.layoutMode === "freeform";
      var savingKey = isFreeBoard ? "history.savingFreeBoard" : "history.saving";
      var savedKey = isFreeBoard ? "history.savedFreeBoard" : "history.saved";
      var duplicateKey = isFreeBoard ? "history.duplicateFreeBoard" : "history.duplicate";
      var failedKey = isFreeBoard ? "history.saveSnapshotError" : "history.saveSnapshotError";
      setTranslatedStatus(elements.saveStatus, savingKey, null, false);
      return enqueueSave(async function () {
        setTranslatedStatus(elements.saveStatus, savingKey, null, false);
        var ready = available || await storeReady;
        if (!ready) {
          setTranslatedStatus(elements.saveStatus, "history.saveUnavailable", null, true);
          return null;
        }
        try {
          var result = await store.saveRecord(record);
          setTranslatedStatus(elements.saveStatus, result.duplicate ? duplicateKey : savedKey, null, false);
          return result;
        } catch (_error) {
          setTranslatedStatus(elements.saveStatus, failedKey, null, true);
          return null;
        }
      });
    }

    function saveCurrentReading() {
      if (!readingComplete) return;
      var record;
      try {
        record = createSnapshot();
      } catch (_error) {
        setTranslatedStatus(elements.saveStatus, "history.saveSnapshotError", null, true);
        return;
      }
      return saveRecord(record, { kind: "preset" });
    }

    async function deleteSelected() {
      if (!available || !selectedRecordId) return;
      if (!(await requestDeletion(t("history.deleteConfirm")))) return;
      try {
        await store.deleteRecord(selectedRecordId);
        setTranslatedStatus(elements.actionStatus, "history.deleted", null, false);
        await refreshList();
        elements.filter.focus();
      } catch (_error) {
        setTranslatedStatus(elements.actionStatus, "history.deleteFailed", null, true);
      }
    }

    async function clearAll() {
      if (!available) return;
      if (!(await requestDeletion(t("history.clearConfirm")))) return;
      try {
        await store.clearRecords();
        setTranslatedStatus(elements.actionStatus, "history.cleared", null, false);
        await refreshList();
        elements.clear.focus();
      } catch (_error) {
        setTranslatedStatus(elements.actionStatus, "history.clearFailed", null, true);
      }
    }

    function requestDeletion(message) {
      if (!globalThis.DivinationDialog) return Promise.resolve(false);
      return globalThis.DivinationDialog.request({
        kicker: t("history.confirmKicker"),
        title: t("history.confirmTitle"),
        message: message,
        cancelLabel: t("history.confirmCancel"),
        proceedLabel: t("history.confirmProceed")
      });
    }

    async function exportAll() {
      if (!available) return;
      try {
        var records = await store.listRecords("all");
        var json = recordsApi.serializeExport(records);
        var fileName = "tarot-history-" + new Date().toISOString().slice(0, 10) + ".json";
        var nativeBridge = globalThis.androidHistoryExport;
        if (nativeBridge && typeof nativeBridge.save === "function") {
          nativeBridge.save(json, fileName);
          setTranslatedStatus(elements.actionStatus, "history.exportChoosing", {
            fileName: fileName
          }, false);
          return;
        }
        var blob = new Blob([json], { type: "application/json;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
        setTranslatedStatus(elements.actionStatus, "history.exported", { fileName: fileName }, false);
      } catch (_error) {
        setTranslatedStatus(elements.actionStatus, "history.exportFailed", null, true);
      }
    }

    async function importFile(event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!available || !file) return;
      try {
        if (file.size > recordsApi.MAX_IMPORT_BYTES) throw new Error("too large");
        var envelope = recordsApi.parseImportJson(await file.text());
        var result = await store.importRecords(envelope.records);
        var renderMessage = function () {
          var message = t("history.imported", { count: result.importedCount });
          if (result.remappedCount) message += t("history.remapped", { count: result.remappedCount });
          return message;
        };
        setStatus(elements.actionStatus, renderMessage(), false, renderMessage);
        await refreshList();
      } catch (_error) {
        setTranslatedStatus(elements.actionStatus, "history.importFailed", null, true);
      }
    }

    function updateSaveAvailability(complete) {
      readingComplete = Boolean(complete);
      if (!readingComplete) setStatus(elements.saveStatus, "", false);
      else if (!available) setTranslatedStatus(elements.saveStatus, "history.unavailableSave", null, true);
    }

    function refreshLanguage() {
      refreshStatus(elements.saveStatus);
      refreshStatus(elements.actionStatus);
      if (selectedRecord) {
        showDetail(selectedRecord);
        return Promise.resolve();
      }
      return refreshList();
    }

    elements.open.addEventListener("click", openDialog);
    elements.close.addEventListener("click", closeDialog);
    elements.dialog.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && typeof elements.dialog.close !== "function") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || typeof elements.dialog.showModal === "function") return;
      var focusable = Array.prototype.slice.call(elements.dialog.querySelectorAll(
        "button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
      )).filter(function (element) { return !element.hidden; });
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    elements.dialog.addEventListener("close", function () {
      if (restoreFocusTo && typeof restoreFocusTo.focus === "function") restoreFocusTo.focus();
    });
    elements.filter.addEventListener("change", refreshList);
    elements.back.addEventListener("click", function () {
      refreshList().then(function () { elements.filter.focus(); });
    });
    elements.deleteButton.addEventListener("click", deleteSelected);
    elements.clear.addEventListener("click", clearAll);
    elements.exportButton.addEventListener("click", exportAll);
    elements.importInput.addEventListener("change", importFile);
    elements.importLabel.addEventListener("keydown", function (event) {
      if (!available || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      elements.importInput.click();
    });

    updateSaveAvailability(false);
    storeReady = Promise.resolve()
      .then(function () { return store.open(); })
      .then(function () {
        available = true;
        elements.importLabel.removeAttribute("aria-disabled");
        elements.importLabel.classList.remove("is-disabled");
        return true;
      })
      .catch(function () {
        setUnavailable();
        return false;
      });

    var controller = {
      updateSaveAvailability: updateSaveAvailability,
      saveCompletedReading: saveCurrentReading,
      saveRecord: saveRecord,
      refresh: refreshList,
      refreshLanguage: refreshLanguage,
      handleBack: handleBack
    };
    activeController = controller;
    return controller;
  }

  return {
    init: init,
    createSerialTaskQueue: createSerialTaskQueue,
    calculateFreeformPreviewLayout: calculateFreeformPreviewLayout,
    handleBack: function () {
      return activeController ? activeController.handleBack() : false;
    }
  };
});
