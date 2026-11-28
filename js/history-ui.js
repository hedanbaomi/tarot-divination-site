(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DivinationHistoryUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var fallbackI18n = null;
  var fallbackStats = null;
  if (typeof require === "function") {
    fallbackI18n = require("./i18n.js");
    fallbackStats = require("./history-stats.js");
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

  function currentSpread(record, customResolver) {
    if (!record || record.layoutMode === "freeform" || !record.spreadId) return null;
    if (typeof customResolver === "function") {
      var resolved = customResolver(record);
      if (resolved && resolved.id === record.spreadId && Array.isArray(resolved.positions)) {
        return resolved;
      }
    }
    if (typeof getSpreadById !== "function") return null;
    var spread = getSpreadById(record.deckType, record.spreadId);
    return spread && spread.id === record.spreadId && Array.isArray(spread.positions) ? spread : null;
  }

  function canRenderActualSpread(record, spread) {
    return Boolean(
      record &&
      record.layoutMode !== "freeform" &&
      spread &&
      Array.isArray(spread.positions) &&
      spread.positions.length > 0 &&
      Array.isArray(record.cards) &&
      record.cards.length > 0 &&
      record.cards.every(function (card) {
        return Number.isInteger(card.slotIndex) && Boolean(spread.positions[card.slotIndex]);
      })
    );
  }

  function currentDeck(record) {
    if (record.deckType === "tarot" && typeof tarotDeckFull !== "undefined") return tarotDeckFull;
    if (record.deckType === "mystagogus" && typeof mystagogusDeckFull !== "undefined") return mystagogusDeckFull;
    if (record.deckType === "lxxxi" && typeof lxxxiDeckFull !== "undefined") return lxxxiDeckFull;
    return [];
  }

  function displaySpreadName(record, customResolver) {
    if (record && record.layoutMode === "freeform") return t("history.freeBoard");
    var spread = currentSpread(record, customResolver);
    return localized(spread, "name") || record.spreadName;
  }

  function displayPositionName(record, card, customResolver) {
    var spread = currentSpread(record, customResolver);
    var position = spread && spread.positions && spread.positions[card.slotIndex];
    return localized(position, "name") || card.positionName;
  }

  function sourceForCard(record, card) {
    return currentDeck(record).find(function (item) { return item.id === card.cardId; });
  }

  function displayCardName(record, card) {
    return localized(sourceForCard(record, card), "name") || card.cardName;
  }

  function getCardInterpretation(record, card, sourceCard) {
    if (!sourceCard) return { keywords: [], meaning: "" };
    var showReversed = record.orientationMode === "mixed" && card.orientation === "reversed";
    return {
      keywords: localized(sourceCard, showReversed ? "reversedKeywords" : "uprightKeywords") || [],
      meaning: localized(sourceCard, showReversed ? "reversedMeaning" : "uprightMeaning") || ""
    };
  }

  function displayDeckName(record) {
    return t("deck.name." + record.deckType) || record.deckName;
  }

  function formatMarkdown(records, resolveSpread) {
    return globalThis.DivinationHistoryMarkdown.format(records, {
      t: t,
      formatTime: formatTime,
      deckName: displayDeckName,
      spreadName: function (record) { return displaySpreadName(record, resolveSpread); },
      positionName: function (record, card) { return displayPositionName(record, card, resolveSpread); },
      cardName: displayCardName,
      interpretation: function (record, card) {
        return getCardInterpretation(record, card, sourceForCard(record, card));
      }
    });
  }

  // Only bundled deck entries supply media URLs. Imported snapshots supply
  // names and geometry when a definition is no longer installed.
  function imageModel(record, resolveSpread) {
    var spread = currentSpread(record, resolveSpread);
    var freeform = record.layoutMode === "freeform";
    var credit = globalThis.DivinationHistoryMarkdown.deckCredit(record.deckType, t)
      .replace(/\[([^\]]+)\]\((https:[^)]+)\)/g, "$1 ($2)");
    var artCredit = record.deckType === "tarot" ? t("image.tarotArt") : t("attribution." + record.deckType + "Rights");
    var cards = record.cards.slice().sort(function (a, b) {
      if (freeform) return a.drawOrder - b.drawOrder;
      return a.slotIndex - b.slotIndex || (a.layer === "minor") - (b.layer === "minor");
    }).map(function (card) {
      var hidden = freeform && card.revealed === false;
      var source = hidden ? null : sourceForCard(record, card);
      var pos = spread && spread.positions[card.slotIndex];
      return {
        number: freeform ? card.drawOrder : card.positionNumber,
        positionName: freeform ? "" : localized(pos, "name") || card.positionName,
        name: hidden ? t("history.freeBoardHidden") : localized(source, "name") || card.cardName,
        hidden: hidden,
        image: source && source.image || "",
        orientation: hidden ? "upright" : card.orientation,
        orientationLabel: hidden ? "" : t("orientation." + card.orientation),
        realmLabel: localized(source && source.realm, "name"),
        realmBorder: source && source.realm ? source.realm.border : "",
        layer: card.layer || null,
        layerLabel: card.layer ? t("history.layer." + card.layer).replace(/^\s*[·•]\s*/, "") : "",
        column: pos && pos.column, row: pos && pos.row,
        columnSpan: pos && pos.columnSpan, rowSpan: pos && pos.rowSpan,
        offsetX: pos && pos.offsetX, offsetY: pos && pos.offsetY, rotation: pos && pos.rotation,
        x: card.x, y: card.y, z: card.z, boardRotation: card.boardRotation
      };
    });
    return {
      title: displaySpreadName(record, resolveSpread), deckName: displayDeckName(record),
      date: formatTime(record.createdAt), question: record.question || "", freeform: freeform,
      columns: spread && spread.columns, rows: spread && spread.rows, cards: cards,
      labels: { hidden: t("history.freeBoardHidden"), question: t("history.question"), index: t("image.positions"), sources: t("history.sourcesAndCredits") },
      credit: [credit, artCredit, t("image.unofficial")].join("\n"),
      projectUrl: "https://github.com/hedanbaomi/tarot-divination-site", officialUrl: "https://www.quareia.com"
    };
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
    var statsApi = options.statsApi || globalThis.DivinationHistoryStats || fallbackStats;
    var createSnapshot = options.createSnapshot;
    var resolveSpread = options.resolveSpread;
    var actualLayoutOpen = false;
    var available = false;
    var readingComplete = false;
    var storeReady = null;
    var enqueueSave = createSerialTaskQueue();
    var selectedRecordId = null;
    var selectedRecord = null;
    var restoreFocusTo = null;
    var allRecords = [];
    var selecting = false;
    var selectedIds = new Set();
    var questionRevision = 0;
    var tableRecord = null;
    var tableSave = null;
    var editingField = null;
    var cardFilter = null;
    var useSavedQuestion = false;
    var listRevision = 0;
    var activeTab = "list";
    var statsDeck = null;
    var statsDeckUserPicked = false;
    var statsPeriod = "all";
    var statsCategoryId = null;
    var statsExpanded = false;

    var elements = {
      question: byId("readingQuestion"),
      questionToggle: byId("readingQuestionToggle"),
      questionCaption: byId("readingQuestionCaption"),
      questionPanel: byId("readingQuestionPanel"),
      summary: byId("readingQuestionSummary"),
      tabs: byId("historyTabs"),
      tabList: byId("historyTabList"),
      tabStats: byId("historyTabStats"),
      toolbar: byId("historyToolbar"),
      listView: byId("historyListView"),
      statsView: byId("historyStatsView"),
      statsDecks: byId("historyStatsDecks"),
      statsPeriods: byId("historyStatsPeriods"),
      statsBody: byId("historyStatsBody"),
      search: byId("historySearch"),
      cardFilter: byId("historyCardFilter"),
      readingStatus: byId("readingActionStatus"),
      clearReflection: byId("historyClearReflection"),
      select: byId("historySelectBtn"),
      exportSelected: byId("historyExportSelectedBtn"),
      markdown: byId("historyMarkdownBtn"),
      image: byId("historyImageBtn"),
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

    var noteEditors = {
      question: {
        text: byId("historyQuestionText"), edit: byId("historyEditQuestionBtn"),
        panel: byId("historyQuestionEditor"), input: byId("historyQuestionInput"),
        save: byId("historySaveQuestionBtn"), cancel: byId("historyCancelQuestionBtn"),
        addKey: "history.addQuestion", editKey: "history.editQuestion",
        savedKey: "history.questionSaved", failedKey: "history.questionFailed",
        update: function (id, value) { return store.updateQuestion(id, value); }
      },
      reflection: {
        text: byId("historyReflectionText"), edit: byId("historyEditReflection"),
        panel: byId("historyReflectionEditor"), input: byId("historyReflectionInput"),
        save: byId("historySaveReflection"), cancel: byId("historyCancelReflection"),
        addKey: "history.addReflection", editKey: "history.editReflection",
        savedKey: "history.reflectionSaved", failedKey: "history.reflectionFailed",
        update: function (id, value) { return store.updateReflection(id, value); }
      }
    };

    // The Android host opens the system save picker and calls this callback
    // only after it has written the selected content:// destination.
    function onHistoryExportResult(status, result) {
      if (result && result.cancelled) {
        setTranslatedStatus(status, "history.exportCancelled", null, false);
      } else if (result && result.ok) {
        setTranslatedStatus(status, "history.fileSaved", {
          fileName: result.fileName || "tarot-history.json"
        }, false);
      } else {
        setTranslatedStatus(status, "history.exportFailed", null, true);
      }
    }

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
      [elements.exportButton, elements.clear, elements.filter, elements.select, elements.search, elements.tabStats].forEach(function (element) {
        if (element) element.disabled = true;
      });
      if (readingComplete) {
        setTranslatedStatus(elements.saveStatus, "history.unavailableSave", null, true);
      } else {
        setStatus(elements.saveStatus, "", true);
      }
      setTranslatedStatus(elements.actionStatus, "history.unavailable", null, true);
    }

    function syncDialogViews() {
      var inDetail = Boolean(selectedRecordId);
      var inStats = !inDetail && activeTab === "stats" && Boolean(elements.statsView);
      if (elements.tabs) elements.tabs.hidden = inDetail;
      if (elements.toolbar) elements.toolbar.hidden = inDetail || inStats;
      elements.cardFilter.hidden = inDetail || inStats || !cardFilter;
      if (elements.listView) elements.listView.hidden = inDetail || inStats;
      if (elements.statsView) elements.statsView.hidden = !inStats;
      if (elements.tabList) {
        elements.tabList.classList.toggle("is-active", !inStats);
        elements.tabList.setAttribute("aria-selected", String(!inStats));
      }
      if (elements.tabStats) {
        elements.tabStats.classList.toggle("is-active", inStats);
        elements.tabStats.setAttribute("aria-selected", String(inStats));
      }
    }

    function showListView() {
      activeTab = "list";
      actualLayoutOpen = false;
      selectedRecordId = null;
      selectedRecord = null;
      if (elements.list) elements.list.hidden = false;
      if (elements.empty) elements.empty.hidden = true;
      if (elements.detail) elements.detail.hidden = true;
      if (elements.back) elements.back.hidden = true;
      if (elements.deleteButton) elements.deleteButton.hidden = true;
      syncDialogViews();
    }

    function formatPercent(ratio) {
      if (!ratio || ratio <= 0) return "0";
      var pct = ratio * 100;
      if (pct < 1) return pct.toFixed(1);
      return String(Math.round(pct));
    }

    function preferredStatsDeck() {
      if (elements.filter && elements.filter.value) {
        return elements.filter.value;
      }
      return "all";
    }

    function syncStatsControls() {
      if (elements.statsDecks) {
        Array.prototype.forEach.call(elements.statsDecks.querySelectorAll("[data-stats-deck]"), function (btn) {
          var active = btn.getAttribute("data-stats-deck") === statsDeck;
          btn.classList.toggle("is-active", active);
          btn.setAttribute("aria-pressed", String(active));
        });
      }
      if (elements.statsPeriods) {
        Array.prototype.forEach.call(elements.statsPeriods.querySelectorAll("[data-stats-period]"), function (btn) {
          var active = btn.getAttribute("data-stats-period") === statsPeriod;
          btn.classList.toggle("is-active", active);
          btn.setAttribute("aria-pressed", String(active));
        });
      }
    }

    function createStatsKpi(label, value) {
      var card = document.createElement("div");
      card.className = "history-stats-kpi";
      card.appendChild(textElement("span", "history-stats-kpi-label", label));
      card.appendChild(textElement("strong", "history-stats-kpi-value", value));
      return card;
    }

    function renderStats() {
      if (!elements.statsBody || !statsApi) return;
      if (!statsDeck || !statsDeckUserPicked) {
        statsDeck = statsApi.pickDefaultDeck(allRecords, preferredStatsDeck());
      }
      syncStatsControls();
      syncDialogViews();

      var summary = statsApi.summarize(allRecords, {
        deckType: statsDeck,
        period: statsPeriod
      });
      var categoryById = new Map();
      summary.categories.forEach(function (cat) { categoryById.set(cat.id, cat); });
      if (statsCategoryId && !categoryById.has(statsCategoryId)) statsCategoryId = null;

      elements.statsBody.replaceChildren();

      if (summary.totalDraws === 0) {
        elements.statsBody.appendChild(textElement(
          "p",
          "history-stats-empty",
          t(summary.deckType === "all" ? "history.stats.emptyAll" : "history.stats.empty")
        ));
        return;
      }

      var kpis = document.createElement("div");
      kpis.className = "history-stats-kpis";
      kpis.appendChild(createStatsKpi(t("history.stats.readings"), String(summary.readingCount)));
      kpis.appendChild(createStatsKpi(t("history.stats.draws"), String(summary.totalDraws)));
      kpis.appendChild(createStatsKpi(t("history.stats.unique"), summary.uniqueCards + " / " + summary.deckSize));
      elements.statsBody.appendChild(kpis);

      if (summary.arcana) {
        var arcanaCard = document.createElement("section");
        arcanaCard.className = "history-stats-section history-stats-arcana";
        arcanaCard.appendChild(textElement("h3", "history-stats-heading", t("history.stats.arcanaTitle")));

        var majorPct = summary.arcana.major.share * 100;
        var minorPct = summary.arcana.minor.share * 100;
        var bar = document.createElement("div");
        bar.className = "history-stats-arcana-bar";
        bar.setAttribute("aria-hidden", "true");
        var majorSeg = document.createElement("span");
        majorSeg.className = "history-stats-arcana-major";
        majorSeg.style.width = majorPct.toFixed(1) + "%";
        var minorSeg = document.createElement("span");
        minorSeg.className = "history-stats-arcana-minor";
        minorSeg.style.width = minorPct.toFixed(1) + "%";
        bar.appendChild(majorSeg);
        bar.appendChild(minorSeg);
        arcanaCard.appendChild(bar);

        var legend = document.createElement("div");
        legend.className = "history-stats-arcana-legend";
        var majorItem = document.createElement("span");
        majorItem.className = "history-stats-arcana-item";
        majorItem.appendChild(textElement("span", "history-stats-swatch history-stats-swatch-major", ""));
        majorItem.appendChild(textElement("span", "", t("history.stats.major") + " · " +
          t("history.stats.countAndPct", {
            count: summary.arcana.major.count,
            pct: formatPercent(summary.arcana.major.share)
          })));
        var minorItem = document.createElement("span");
        minorItem.className = "history-stats-arcana-item";
        minorItem.appendChild(textElement("span", "history-stats-swatch history-stats-swatch-minor", ""));
        minorItem.appendChild(textElement("span", "", t("history.stats.minor") + " · " +
          t("history.stats.countAndPct", {
            count: summary.arcana.minor.count,
            pct: formatPercent(summary.arcana.minor.share)
          })));
        legend.appendChild(majorItem);
        legend.appendChild(minorItem);
        arcanaCard.appendChild(legend);

        if (summary.orientation && summary.orientation.hasReversed) {
          arcanaCard.appendChild(textElement(
            "p",
            "history-stats-subline",
            t("history.stats.orientationSummary", {
              upright: summary.orientation.upright.count,
              uprightPct: formatPercent(summary.orientation.upright.share),
              reversed: summary.orientation.reversed.count,
              reversedPct: formatPercent(summary.orientation.reversed.share)
            })
          ));
        }
        elements.statsBody.appendChild(arcanaCard);
      }

      var catSection = document.createElement("section");
      catSection.className = "history-stats-section";
      catSection.appendChild(textElement(
        "h3",
        "history-stats-heading",
        t(summary.deckType === "all" ? "history.stats.decksTitle" : "history.stats.categoriesTitle")
      ));
      catSection.appendChild(textElement("p", "history-stats-hint", t("history.stats.hint." + summary.deckType)));

      var catList = document.createElement("div");
      catList.className = "history-stats-categories";
      summary.categories.forEach(function (cat) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "history-stats-cat-row";
        row.setAttribute("data-stats-category", cat.id);
        var selected = statsCategoryId === cat.id;
        row.classList.toggle("is-selected", selected);
        row.setAttribute("aria-pressed", String(selected));

        var head = document.createElement("div");
        head.className = "history-stats-cat-head";
        var labelWrap = document.createElement("span");
        labelWrap.className = "history-stats-cat-name";
        if (cat.swatch) {
          var swatch = document.createElement("span");
          swatch.className = "history-stats-swatch";
          swatch.setAttribute("data-stats-swatch", cat.swatch);
          swatch.setAttribute("aria-hidden", "true");
          labelWrap.appendChild(swatch);
        }
        labelWrap.appendChild(textElement("span", "", localized(cat, "name")));

        var metricWrap = document.createElement("span");
        metricWrap.className = "history-stats-cat-metrics";
        metricWrap.appendChild(textElement("strong", "", t("history.stats.countAndPct", {
          count: cat.count,
          pct: formatPercent(cat.share)
        })));
        if (summary.deckType !== "all") {
          metricWrap.appendChild(textElement("span", "history-stats-baseline", t("history.stats.deckBaseline", {
            pct: formatPercent(cat.expectedShare)
          })));
        }
        head.appendChild(labelWrap);
        head.appendChild(metricWrap);
        row.appendChild(head);

        var track = document.createElement("div");
        track.className = "history-stats-bar-track";
        track.setAttribute("aria-hidden", "true");
        var fill = document.createElement("span");
        fill.className = "history-stats-bar-fill";
        if (cat.swatch) fill.setAttribute("data-stats-swatch", cat.swatch);
        fill.style.width = (cat.share * 100).toFixed(1) + "%";
        track.appendChild(fill);
        if (summary.deckType !== "all") {
          var baseline = document.createElement("span");
          baseline.className = "history-stats-bar-baseline";
          baseline.style.left = (cat.expectedShare * 100).toFixed(1) + "%";
          track.appendChild(baseline);
        }
        row.appendChild(track);

        row.addEventListener("click", function () {
          statsCategoryId = statsCategoryId === cat.id ? null : cat.id;
          statsExpanded = false;
          renderStats();
        });
        catList.appendChild(row);
      });
      catSection.appendChild(catList);
      elements.statsBody.appendChild(catSection);

      var cardsSection = document.createElement("section");
      cardsSection.className = "history-stats-section";
      var cardsHead = document.createElement("div");
      cardsHead.className = "history-stats-cards-head";
      cardsHead.appendChild(textElement("h3", "history-stats-heading", t("history.stats.topCardsTitle")));
      if (statsCategoryId && categoryById.has(statsCategoryId)) {
        var filterWrap = document.createElement("div");
        filterWrap.className = "history-stats-filter-tag";
        filterWrap.appendChild(textElement("span", "", t("history.stats.filterActive", {
          category: localized(categoryById.get(statsCategoryId), "name")
        })));
        var clearFilterBtn = button(t("history.stats.clearFilter"), "btn-mini");
        clearFilterBtn.addEventListener("click", function () {
          statsCategoryId = null;
          statsExpanded = false;
          renderStats();
        });
        filterWrap.appendChild(clearFilterBtn);
        cardsHead.appendChild(filterWrap);
      }
      cardsSection.appendChild(cardsHead);

      var filteredCards = statsCategoryId
        ? summary.cards.filter(function (entry) { return entry.categoryId === statsCategoryId; })
        : summary.cards;

      if (!filteredCards.length) {
        cardsSection.appendChild(textElement("p", "history-stats-empty", t("history.stats.noCardsInCategory")));
      } else {
        var topLimit = 10;
        var visibleCards = statsExpanded ? filteredCards : filteredCards.slice(0, topLimit);
        var cardList = document.createElement("ol");
        cardList.className = "history-stats-cards";

        visibleCards.forEach(function (entry, index) {
          var item = document.createElement("li");
          item.className = "history-stats-card-row";
          item.appendChild(textElement("span", "history-stats-rank", "#" + (index + 1)));

          var info = document.createElement("div");
          info.className = "history-stats-card-info";
          var cardTitle = (entry.sourceCard && localized(entry.sourceCard, "name")) || entry.fallbackName;
          info.appendChild(textElement("strong", "history-stats-card-name", cardTitle));

          var meta = document.createElement("span");
          meta.className = "history-stats-card-meta";
          var realmBorder = entry.sourceCard && entry.sourceCard.realm && entry.sourceCard.realm.border;
          if (realmBorder) {
            var realmDot = document.createElement("span");
            realmDot.className = "history-stats-swatch";
            realmDot.setAttribute("data-stats-swatch", realmBorder);
            realmDot.setAttribute("aria-hidden", "true");
            meta.appendChild(realmDot);
          }
          var badgeParts = [];
          if (summary.deckType === "all") {
            badgeParts.push(t("deck.name." + entry.deckType));
          }
          var detailCategory = entry.sourceCard && entry.sourceCard.realm
            ? localized(entry.sourceCard.realm, "name")
            : localized(
              summary.deckType === "all"
                ? statsApi.getCategoryInfo(entry.deckType, entry.subCategoryId)
                : categoryById.get(entry.categoryId),
              "name"
            );
          if (detailCategory) badgeParts.push(detailCategory);
          if (entry.deckType === "tarot" && entry.reversedCount > 0) {
            badgeParts.push(t("history.stats.uprightReversed", {
              upright: entry.uprightCount,
              reversed: entry.reversedCount
            }));
          }
          meta.appendChild(textElement("span", "", badgeParts.join(" · ")));
          info.appendChild(meta);
          item.appendChild(info);

          var side = document.createElement("div");
          side.className = "history-stats-card-side";
          side.appendChild(textElement("span", "history-stats-card-count", t("history.stats.countAndPct", {
            count: entry.count,
            pct: formatPercent(entry.share)
          })));
          var viewRecords = button(t("history.viewCardRecords"), "btn-mini");
          viewRecords.setAttribute("data-view-card-records", entry.cardId);
          viewRecords.addEventListener("click", function () {
            var previousDeck = cardFilter ? cardFilter.previousDeck : elements.filter.value;
            cardFilter = {
              deckType: entry.deckType, cardId: entry.cardId, entry: entry,
              period: summary.period, cutoffMs: summary.cutoffMs, previousDeck: previousDeck
            };
            setDeckFilter(entry.deckType);
            elements.search.value = "";
            renderList();
            elements.cardFilter.focus();
          });
          side.appendChild(viewRecords);
          if (globalThis.DivinationCardNotes && typeof globalThis.DivinationCardNotes.createButton === "function") {
            var noteBtn = globalThis.DivinationCardNotes.createButton(entry.deckType, entry.cardId);
            if (noteBtn) side.appendChild(noteBtn);
          }
          item.appendChild(side);
          cardList.appendChild(item);
        });
        cardsSection.appendChild(cardList);

        if (filteredCards.length > topLimit) {
          var toggleBtn = button(
            statsExpanded
              ? t("history.stats.showTop", { count: topLimit })
              : t("history.stats.showAll", { count: filteredCards.length }),
            "btn btn-secondary history-stats-more-btn"
          );
          toggleBtn.addEventListener("click", function () {
            statsExpanded = !statsExpanded;
            renderStats();
          });
          cardsSection.appendChild(toggleBtn);
        }
      }
      elements.statsBody.appendChild(cardsSection);
    }

    function showStatsView() {
      activeTab = "stats";
      selecting = false;
      selectedIds.clear();
      actualLayoutOpen = false;
      selectedRecordId = null;
      selectedRecord = null;
      if (elements.detail) elements.detail.hidden = true;
      if (elements.back) elements.back.hidden = true;
      if (elements.deleteButton) elements.deleteButton.hidden = true;
      renderStats();
    }

    function updateSelectionActions() {
      elements.select.setAttribute("aria-pressed", String(selecting));
      elements.select.textContent = t(selecting ? "history.cancelSelection" : "history.selectReadings");
      elements.select.disabled = !allRecords.length;
      elements.exportSelected.hidden = !selecting;
      elements.exportSelected.disabled = !selectedIds.size;
      elements.exportSelected.textContent = t("history.exportSelected", { count: selectedIds.size });
    }

    function matchesSearch(record, query) {
      if (!query) return true;
      function contains(value) {
        return value && value.toLocaleLowerCase().includes(query);
      }
      return contains(record.question) || contains(record.reflection) || contains(displaySpreadName(record, resolveSpread)) ||
        contains(displayDeckName(record)) || record.cards.some(function (card) {
          return contains(displayCardName(record, card)) ||
            contains(displayPositionName(record, card, resolveSpread));
        });
    }

    function renderList() {
      var deck = elements.filter.value;
      var query = elements.search.value.trim().toLocaleLowerCase();
      var records = allRecords.filter(function (record) {
        return (!deck || deck === "all" || deck === record.deckType) &&
          (!cardFilter || statsApi.matchesCardFilter(record, cardFilter)) && matchesSearch(record, query);
      });
      if (cardFilter) {
        var entry = cardFilter.entry;
        var label = t("history.cardFilter", {
          card: localized(entry.sourceCard, "name") || entry.fallbackName,
          deck: t("deck.name." + entry.deckType)
        });
        if (cardFilter.period !== "all") label += " · " + t("history.stats.period" + cardFilter.period);
        elements.cardFilter.textContent = label + " ×";
        elements.cardFilter.setAttribute("aria-label", t("history.clearCardFilter", { filter: label }));
      }
      updateSelectionActions();
      showListView();
      elements.list.replaceChildren();
      elements.empty.hidden = records.length !== 0;
      elements.empty.textContent = t(allRecords.length ? "history.noMatches" : "history.empty");
      records.forEach(function (record) {
        var item = document.createElement("li");
        item.className = "history-list-item";
        var openButton = selecting ? document.createElement("label") : button("", "history-record-open");
        openButton.className = "history-record-open";
        if (selecting) {
          openButton.classList.add("history-choice");
          var checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.checked = selectedIds.has(record.id);
          checkbox.addEventListener("change", function () {
            if (checkbox.checked) selectedIds.add(record.id);
            else selectedIds.delete(record.id);
            updateSelectionActions();
          });
          openButton.appendChild(checkbox);
        }

        var heading = document.createElement("span");
        heading.className = "history-record-title";
        heading.textContent = displaySpreadName(record, resolveSpread);
        var meta = document.createElement("span");
        meta.className = "history-record-meta";
        meta.textContent = formatTime(record.createdAt) + " · " +
          displayDeckName(record) + " · " +
          t("history.cards", { count: record.cards.length });
        openButton.appendChild(heading);
        if (record.question) {
          openButton.appendChild(textElement("span", "history-question-preview", record.question));
        }
        if (record.reflection) {
          openButton.appendChild(textElement("span", "history-reflection-badge", t("history.hasReflection")));
        }
        openButton.appendChild(meta);
        if (!selecting) {
          openButton.addEventListener("click", function () {
            actualLayoutOpen = false;
            showDetail(record);
          });
        }
        item.appendChild(openButton);
        elements.list.appendChild(item);
      });
    }

    function renderCard(record, card) {
      var item = document.createElement("li");
      item.className = "history-detail-card";
      var name = document.createElement("h4");
      name.textContent = card.positionNumber + ". " + displayPositionName(record, card, resolveSpread);
      var cardName = document.createElement("p");
      var orientation = card.orientation === "reversed"
        ? t("history.orientation.reversed")
        : t("history.orientation.upright");
      var layer = card.layer === "major" ? t("history.layer.major") :
        card.layer === "minor" ? t("history.layer.minor") : "";
      var source = sourceForCard(record, card);
      var realm = source && localized(source.realm, "name");
      cardName.textContent = displayCardName(record, card) + " (" + card.cardNumber + ") · " + orientation + layer +
        (realm ? " · " + realm : "");
      item.appendChild(name);
      item.appendChild(cardName);
      if (globalThis.DivinationCardNotes) {
        var note = globalThis.DivinationCardNotes.createButton(record.deckType, card.cardId);
        if (note) item.appendChild(note);
      }
      return item;
    }

    function renderFreeformCard(record, card, positionNumber) {
      var item = document.createElement("li");
      item.className = "history-detail-card history-free-board-card-summary";
      var name = document.createElement("h4");
      name.textContent = t("freeBoard.drawOrder", { order: positionNumber }) +
        " · " + displayCardName(record, card);
      var orientation = card.orientation === "reversed"
        ? t("history.orientation.reversed")
        : t("history.orientation.upright");
      var state = card.revealed
        ? t("history.freeBoardRevealed", { orientation: orientation })
        : t("history.freeBoardHidden");
      var details = document.createElement("p");
      var source = card.revealed && sourceForCard(record, card);
      var realm = source && localized(source.realm, "name");
      details.textContent = t("history.freeBoardCardState", {
        card: displayCardName(record, card),
        state: state
      }) + (realm ? " · " + realm : "");
      item.appendChild(name);
      item.appendChild(details);
      if (card.revealed && globalThis.DivinationCardNotes) {
        var note = globalThis.DivinationCardNotes.createButton(record.deckType, card.cardId);
        if (note) item.appendChild(note);
      }
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

    function renderActualSpreadCard(record, card, spread, boardStacking) {
      var position = spread.positions[card.slotIndex];
      var posNumber = position && position.number ? position.number : card.positionNumber;
      var posName = displayPositionName(record, card, resolveSpread);
      var cardName = displayCardName(record, card);
      var orientationLabel = card.orientation === "reversed"
        ? t("history.orientation.reversed")
        : t("history.orientation.upright");
      var cardStacking = Boolean(boardStacking && card.layer);
      var sourceCard = sourceForCard(record, card);
      var interpretation = getCardInterpretation(record, card, sourceCard);

      var cardEl = document.createElement("div");
      cardEl.className = "spread-card revealed history-spread-card" +
        (cardStacking ? " overview-stack-card stack-layer-" + card.layer : "");
      cardEl.setAttribute("role", "listitem");
      cardEl.setAttribute("data-slot-index", String(card.slotIndex));
      if (cardStacking) cardEl.setAttribute("data-layer", card.layer);
      var realm = sourceCard && sourceCard.realm;
      if (realm) cardEl.setAttribute("data-lxxxi-border", realm.border);
      var realmLabel = localized(realm, "name");
      cardEl.style.gridColumn = position.column + " / span " + (position.columnSpan || 1);
      cardEl.style.gridRow = position.row + " / span " + (position.rowSpan || 1);
      cardEl.style.setProperty(
        "--position-offset-x",
        (cardStacking ? (card.layer === "major" ? -8 : 8) : (position.offsetX || 0)) + "%"
      );
      cardEl.style.setProperty(
        "--position-offset-y",
        (cardStacking ? (card.layer === "major" ? -10 : 12) : (position.offsetY || 0)) + "%"
      );
      cardEl.style.setProperty("--position-rotation", (position.rotation || 0) + "deg");
      cardEl.style.zIndex = String(posNumber + (cardStacking && card.layer === "minor" ? 100 : 0));

      var flipButton = document.createElement("button");
      flipButton.className = "spread-card-flip";
      flipButton.type = "button";

      var inner = document.createElement("div");
      inner.className = "spread-card-inner";

      var back = document.createElement("div");
      back.className = "spread-card-face spread-card-back" +
        (record.deckType === "mystagogus" ? " spread-card-back-m" : "") +
        (record.deckType === "lxxxi" ? " spread-card-back-lxxxi" : "");
      var meaningPanel = document.createElement("div");
      meaningPanel.className = "spread-card-meaning";
      meaningPanel.appendChild(
        textElement("span", "spread-card-meaning-kicker", posNumber + ". " + posName + " · " + (realmLabel || t("app.meaningTitle")))
      );
      meaningPanel.appendChild(textElement("strong", "spread-card-meaning-name", cardName));
      if (interpretation.keywords.length) {
        meaningPanel.appendChild(
          textElement("span", "spread-card-meaning-keywords", interpretation.keywords.join(" · "))
        );
      }
      meaningPanel.appendChild(textElement("span", "spread-card-meaning-text", interpretation.meaning));
      back.appendChild(meaningPanel);

      var front = document.createElement("div");
      front.className = "spread-card-face spread-card-front" +
        (card.orientation === "reversed" ? " reversed" : "");
      if (sourceCard && sourceCard.image) {
        var faceImg = document.createElement("img");
        faceImg.className = "card-image" +
          (card.orientation === "reversed" ? " reversed" : "") +
          (record.deckType === "mystagogus" ? " card-image-m" : "") +
          (record.deckType === "lxxxi" ? " card-image-lxxxi" : "");
        faceImg.src = sourceCard.image;
        faceImg.alt = cardName;
        faceImg.loading = "lazy";
        faceImg.decoding = "async";
        front.appendChild(faceImg);
      }
      var posBadge = textElement("span", "history-spread-pos-badge", String(posNumber));
      posBadge.setAttribute("title", posNumber + ". " + posName);
      front.appendChild(posBadge);

      var caption = document.createElement("div");
      caption.className = "spread-card-caption";
      if (cardStacking) {
        caption.appendChild(
          textElement(
            "span",
            "stack-layer-caption",
            card.layer === "major" ? t("app.layerMajorCaption") : t("app.layerMinorCaption")
          )
        );
      }
      caption.appendChild(textElement("span", "name", cardName));
      caption.appendChild(textElement("span", "ori " + card.orientation, orientationLabel));
      front.appendChild(caption);

      inner.appendChild(back);
      inner.appendChild(front);
      flipButton.appendChild(inner);
      cardEl.appendChild(flipButton);
      var note = globalThis.DivinationCardNotes && globalThis.DivinationCardNotes.createButton(record.deckType, card.cardId);
      if (note) {
        note.hidden = true;
        cardEl.appendChild(note);
      }

      function syncFlipAria() {
        var meaningVisible = cardEl.classList.contains("meaning-visible");
        if (note) note.hidden = !meaningVisible;
        var layerLabel = cardStacking
          ? " · " + (card.layer === "major" ? t("app.layerMajorBase") : t("app.layerMinorTop"))
          : "";
        flipButton.setAttribute(
          "aria-label",
          t(meaningVisible ? "app.meaningAria" : "app.revealedAria", {
            number: posNumber,
            position: posName,
            layer: layerLabel,
            card: cardName,
            orientation: orientationLabel
          }) + (realmLabel ? " · " + realmLabel : "")
        );
        flipButton.setAttribute("aria-pressed", String(meaningVisible));
      }

      flipButton.addEventListener("click", function () {
        cardEl.classList.toggle("meaning-visible");
        syncFlipAria();
      });
      syncFlipAria();
      return cardEl;
    }

    function renderActualSpreadBoard(record, spread) {
      var section = document.createElement("section");
      section.className = "history-actual-layout";
      section.setAttribute("aria-label", t("history.actualLayoutAria"));

      var hint = textElement("p", "history-actual-layout-hint", t("history.actualLayoutHint"));
      section.appendChild(hint);

      var boardStacking = record.overviewMethod === "stacked" || record.cards.some(function (card) {
        return Boolean(card.layer);
      });
      var boardScroll = document.createElement("div");
      boardScroll.className = "spread-board-scroll history-spread-board-scroll" +
        (spread.isCustom ? " custom-spread-board" : "");

      var grid = document.createElement("div");
      grid.className = "spread-grid history-spread-grid" +
        (boardStacking ? " overview-stacking" : "") +
        (spread.isCustom ? " custom-spread-layout" : "");
      grid.setAttribute("role", "list");
      grid.style.setProperty("--spread-columns", String(spread.columns));
      grid.style.setProperty("--spread-rows", String(spread.rows));
      grid.style.setProperty("--spread-min-width", Math.max(280, spread.columns * 76) + "px");

      var orderedCards = record.cards.slice().sort(function (a, b) {
        if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
        if (a.layer === b.layer) return 0;
        return a.layer === "major" ? -1 : 1;
      });
      orderedCards.forEach(function (card) {
        grid.appendChild(renderActualSpreadCard(record, card, spread, boardStacking));
      });

      boardScroll.appendChild(grid);
      section.appendChild(boardScroll);
      return section;
    }

    function renderNotes() {
      Object.keys(noteEditors).forEach(function (field) {
        var editor = noteEditors[field];
        var value = selectedRecord[field] || "";
        var editing = editingField === field;
        editor.text.textContent = value;
        editor.text.hidden = editing || !value;
        editor.edit.textContent = t(value ? editor.editKey : editor.addKey);
        editor.edit.hidden = editing;
        editor.edit.disabled = Boolean(editingField);
        editor.panel.hidden = !editing;
      });
      elements.clearReflection.hidden = editingField !== "reflection" || !selectedRecord.reflection;
      elements.markdown.disabled = Boolean(editingField);
      if (elements.image) elements.image.disabled = Boolean(editingField);
    }

    function finishNoteEdit(editor) {
      editingField = null;
      renderNotes();
      editor.edit.focus();
    }

    async function saveNote(field, value) {
      var editor = noteEditors[field];
      var id = selectedRecordId;
      if (!id || editor.save.disabled) return;
      editor.save.disabled = editor.cancel.disabled = editor.input.disabled = true;
      if (field === "reflection") elements.clearReflection.disabled = true;
      try {
        var updated = await editor.update(id, value);
        if (!updated) throw new Error("Reading no longer exists");
        if (tableRecord && tableRecord.id === id) tableRecord = updated;
        if (selectedRecordId !== id) return;
        selectedRecord = updated;
        finishNoteEdit(editor);
        var cleared = field === "reflection" && !updated.reflection;
        setTranslatedStatus(elements.actionStatus, cleared ? "history.reflectionCleared" : editor.savedKey, null, false);
      } catch (_error) {
        if (selectedRecordId === id) setTranslatedStatus(elements.actionStatus, editor.failedKey, null, true);
      } finally {
        editor.save.disabled = editor.cancel.disabled = editor.input.disabled = false;
        if (field === "reflection") elements.clearReflection.disabled = false;
      }
    }

    function showDetail(record) {
      if (selectedRecordId !== record.id) editingField = null;
      listRevision++;
      selectedRecordId = record.id;
      selectedRecord = record;
      renderNotes();
      syncDialogViews();
      elements.list.hidden = true;
      elements.empty.hidden = true;
      elements.detail.hidden = false;
      elements.back.hidden = false;
      elements.deleteButton.hidden = false;
      elements.detailTitle.textContent = record.layoutMode === "freeform"
        ? t("history.freeBoardDetail")
        : displaySpreadName(record, resolveSpread);
      elements.detailBody.replaceChildren();

      var definitions = document.createElement("dl");
      definitions.className = "history-definitions";
      definitions.appendChild(createDefinition(t("history.field.time"), formatTime(record.createdAt)));
      definitions.appendChild(createDefinition(t("history.field.deck"), displayDeckName(record)));
      definitions.appendChild(createDefinition(t("history.field.cards"), String(record.cards.length)));
      elements.detailBody.appendChild(definitions);

      if (record.layoutMode === "freeform") {
        var freeBoardHeading = document.createElement("h3");
        freeBoardHeading.textContent = t("history.completePositions");
        var freeBoardCards = document.createElement("ol");
        freeBoardCards.className = "history-detail-cards";
        record.cards.slice().sort(function (a, b) { return a.drawOrder - b.drawOrder; }).forEach(function (card, index) {
          freeBoardCards.appendChild(renderFreeformCard(record, card, index + 1));
        });
        elements.detailBody.appendChild(freeBoardHeading);
        elements.detailBody.appendChild(freeBoardCards);
        elements.back.focus();
        return;
      }

      var spread = currentSpread(record, resolveSpread);
      var positionsHeader = document.createElement("div");
      positionsHeader.className = "history-positions-head";
      var cardsHeading = document.createElement("h3");
      cardsHeading.textContent = t("history.completePositions");
      positionsHeader.appendChild(cardsHeading);

      var openInAiLink = document.createElement("a");
      openInAiLink.className = "btn btn-secondary btn-mini history-open-ai-link";
      openInAiLink.href = "ai.html?readingId=" + encodeURIComponent(record.id);
      openInAiLink.style.textDecoration = "none";
      openInAiLink.textContent = t("history.openInAi");
      positionsHeader.appendChild(openInAiLink);

      var actualLayoutSection = null;
      if (canRenderActualSpread(record, spread)) {
        var actualLayoutBtn = button(
          t(actualLayoutOpen ? "history.hideActualLayout" : "history.actualLayout"),
          "btn btn-secondary btn-mini history-actual-layout-btn" + (actualLayoutOpen ? " is-active" : "")
        );
        actualLayoutBtn.setAttribute("aria-expanded", String(actualLayoutOpen));
        actualLayoutSection = renderActualSpreadBoard(record, spread);
        actualLayoutSection.hidden = !actualLayoutOpen;
        actualLayoutBtn.addEventListener("click", function () {
          actualLayoutOpen = !actualLayoutOpen;
          actualLayoutSection.hidden = !actualLayoutOpen;
          actualLayoutBtn.classList.toggle("is-active", actualLayoutOpen);
          actualLayoutBtn.setAttribute("aria-expanded", String(actualLayoutOpen));
          actualLayoutBtn.textContent = t(
            actualLayoutOpen ? "history.hideActualLayout" : "history.actualLayout"
          );
          var boardScroll = actualLayoutSection.querySelector(".spread-board-scroll");
          if (actualLayoutOpen && boardScroll && typeof requestAnimationFrame === "function") {
            requestAnimationFrame(function () {
              boardScroll.scrollLeft = Math.max(
                0,
                (boardScroll.scrollWidth - boardScroll.clientWidth) / 2
              );
            });
          }
        });
        positionsHeader.appendChild(actualLayoutBtn);
      }
      var cards = document.createElement("ol");
      cards.className = "history-detail-cards";
      record.cards.forEach(function (card) {
        cards.appendChild(renderCard(record, card));
      });
      elements.detailBody.appendChild(positionsHeader);
      if (actualLayoutSection) {
        elements.detailBody.appendChild(actualLayoutSection);
        var activeScroll = actualLayoutSection.querySelector(".spread-board-scroll");
        if (actualLayoutOpen && activeScroll && typeof requestAnimationFrame === "function") {
          requestAnimationFrame(function () {
            activeScroll.scrollLeft = Math.max(
              0,
              (activeScroll.scrollWidth - activeScroll.clientWidth) / 2
            );
          });
        }
      }
      elements.detailBody.appendChild(cards);
      elements.back.focus();
    }

    async function refreshList() {
      var revision = ++listRevision;
      if (!available && !(await storeReady)) {
        elements.list.replaceChildren();
        elements.empty.hidden = false;
        return;
      }
      try {
        var records = await store.listRecords("all");
        if (revision !== listRevision) return;
        allRecords = records;
        var liveIds = new Set(records.map(function (record) { return record.id; }));
        selectedIds.forEach(function (id) { if (!liveIds.has(id)) selectedIds.delete(id); });
        if (activeTab === "stats" && !selectedRecordId) {
          renderStats();
        } else {
          renderList();
        }
      } catch (_error) {
        setUnavailable();
      }
    }

    function setDeckFilter(deck) {
      elements.filter.value = deck;
      if (globalThis.DivinationCustomSelects) globalThis.DivinationCustomSelects.sync();
    }

    function clearCardFilter() {
      if (cardFilter) setDeckFilter(cardFilter.previousDeck);
      cardFilter = null;
    }

    function openDialog() {
      clearCardFilter();
      restoreFocusTo = document.activeElement;
      selecting = false;
      selectedIds.clear();
      elements.search.value = "";
      statsDeck = null;
      statsDeckUserPicked = false;
      statsPeriod = "all";
      statsCategoryId = null;
      statsExpanded = false;
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

    function setQuestionExpanded(expanded) {
      elements.questionToggle.setAttribute("aria-expanded", String(expanded));
      elements.questionPanel.inert = !expanded;
      if (expanded) elements.question.focus();
    }

    function renderQuestionSummary() {
      var summary = elements.question.value.trim();
      elements.summary.textContent = summary;
      elements.questionCaption.textContent = t(summary ? "history.question" : "history.addQuestion");
    }

    function resetQuestion() {
      tableRecord = null;
      useSavedQuestion = false;
      questionRevision++;
      tableSave = null;
      setStatus(elements.saveStatus, "", false);
      setStatus(elements.readingStatus, "", false);
      clearQuestionDraft();
    }

    function clearQuestionDraft() {
      elements.question.value = "";
      renderQuestionSummary();
      setQuestionExpanded(false);
    }

    function saveRecord(record, saveOptions) {
      saveOptions = saveOptions || {};
      // Capture the question before queuing. A later save or reset may belong to a different reading.
      var revision = questionRevision;
      var draftQuestion = elements.question.value;
      tableRecord = record;
      useSavedQuestion = false;
      var isFreeBoard = saveOptions.kind === "freeform" || record && record.layoutMode === "freeform";
      var savingKey = isFreeBoard ? "history.savingFreeBoard" : "history.saving";
      var savedKey = isFreeBoard ? "history.savedFreeBoard" : "history.saved";
      var duplicateKey = isFreeBoard ? "history.duplicateFreeBoard" : "history.duplicate";
      var failedKey = "history.saveSnapshotError";
      setTranslatedStatus(elements.saveStatus, savingKey, null, false);
      setStatus(elements.readingStatus, "", false);
      tableSave = enqueueSave(async function () {
        var ready = available || await storeReady;
        if (!ready) {
          if (revision === questionRevision) setTranslatedStatus(elements.saveStatus, "history.saveUnavailable", null, true);
          return null;
        }
        try {
          var question = recordsApi.normalizeQuestion(draftQuestion);
          if (question) record.question = question;
          var result = await store.saveRecord(record);
          if (revision === questionRevision && tableRecord === record) {
            if (elements.question.value === draftQuestion) {
              clearQuestionDraft();
              useSavedQuestion = true;
            }
            tableRecord = result.record;
            setTranslatedStatus(elements.saveStatus, result.duplicate ? duplicateKey : savedKey, null, false);
          }
          if (elements.dialog.open && !selectedRecordId) await refreshList();
          return result;
        } catch (_error) {
          if (revision === questionRevision) setTranslatedStatus(elements.saveStatus, failedKey, null, true);
          return null;
        }
      });
      return tableSave;
    }

    async function openTableInAi() {
      var pending = tableSave;
      try {
        var result = await pending;
        if (pending !== tableSave || !readingComplete) return;
        var saved = result && result.record && await store.getRecord(result.record.id);
        if (pending !== tableSave || !readingComplete) return;
        if (saved && saved.layoutMode !== "freeform") {
          globalThis.location.assign("ai.html?readingId=" + encodeURIComponent(saved.id));
          return;
        }
      } catch (_error) {
        // Local history may have been cleared or become unavailable after the draw.
      }
      if (pending === tableSave) setTranslatedStatus(elements.readingStatus, "reading.aiUnavailable", null, true);
    }

    function saveCurrentReading() {
      if (!readingComplete) return;
      tableSave = null;
      var record;
      try {
        record = createSnapshot();
      } catch (_error) {
        setTranslatedStatus(elements.saveStatus, "history.saveSnapshotError", null, true);
        return;
      }
      return saveRecord(record, { kind: "preset" });
    }

    /* 自由画板没有预设牌位，用它的摆牌记录单独建一条 history 记录 */
    function saveFreeformReading(input) {
      var record;
      try {
        record = recordsApi.buildFreeformLayoutRecord(input);
      } catch (_error) {
        setTranslatedStatus(elements.saveStatus, "history.saveSnapshotError", null, true);
        return null;
      }
      return saveRecord(record, { kind: "freeform" });
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

    function downloadFile(content, fileName, mimeType, status) {
      status = status || elements.actionStatus;
      var nativeBridge = globalThis.androidHistoryExport;
      if (nativeBridge && typeof nativeBridge.save === "function") {
        setTranslatedStatus(status, "history.exportChoosing", { fileName: fileName }, false);
        if (!globalThis.DivinationNativeFileExport.save(content, fileName, function (result) {
          onHistoryExportResult(status, result);
        })) {
          setTranslatedStatus(status, "history.exportBusy", null, true);
        }
        return;
      }
      var blob = new Blob([content], { type: mimeType + ";charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      setTranslatedStatus(status, "history.fileDownloaded", { fileName: fileName }, false);
    }

    function openImage(record, freeCardWidth) {
      var model = imageModel(record, resolveSpread);
      model.freeCardWidth = freeCardWidth;
      globalThis.DivinationReadingImageUi.open(model, record.createdAt);
    }

    function annotateTableSnapshot(record) {
      var question = recordsApi.normalizeQuestion(elements.question.value);
      var sameReading = tableRecord && tableRecord.deckType === record.deckType &&
        tableRecord.spreadId === record.spreadId && tableRecord.cards.length === record.cards.length &&
        tableRecord.cards.every(function (card, i) {
          var other = record.cards[i];
          return card.cardId === other.cardId && card.orientation === other.orientation &&
            card.slotIndex === other.slotIndex && card.layer === other.layer && card.drawOrder === other.drawOrder;
        });
      if (sameReading) {
        record.createdAt = tableRecord.createdAt;
        if (tableRecord.reflection) record.reflection = tableRecord.reflection;
        if (!question && useSavedQuestion) question = tableRecord.question;
      }
      if (question) record.question = question;
      else delete record.question;
      return record;
    }

    function exportTableImage(record, freeCardWidth) {
      openImage(annotateTableSnapshot(record), freeCardWidth);
    }

    function exportTableMarkdown(record, status) {
      exportMarkdown([annotateTableSnapshot(record)], status || elements.readingStatus);
    }

    function exportMarkdown(records, status) {
      if (!records.length) return;
      try {
        var content = formatMarkdown(records, resolveSpread);
        var stamp = records.length === 1 ? records[0].createdAt : new Date().toISOString();
        var fileName = (records.length === 1 ? "reading-" : "readings-") +
          new Date(stamp).toISOString().replace(/[:.]/g, "-") + ".md";
        downloadFile(content, fileName, "text/markdown", status);
      } catch (_error) {
        setTranslatedStatus(status || elements.actionStatus, "history.exportFailed", null, true);
      }
    }

    async function exportAll() {
      if (!available) return;
      try {
        var records = await store.listRecords("all");
        var fileName = "tarot-history-" + new Date().toISOString().slice(0, 10) + ".json";
        downloadFile(recordsApi.serializeExport(records), fileName, "application/json");
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
      renderQuestionSummary();
      refreshStatus(elements.saveStatus);
      refreshStatus(elements.actionStatus);
      refreshStatus(elements.readingStatus);
      if (selectedRecord) {
        showDetail(selectedRecord);
        return Promise.resolve();
      }
      if (activeTab === "stats" && elements.statsView) {
        renderStats();
        return Promise.resolve();
      }
      return refreshList();
    }

    elements.open.addEventListener("click", openDialog);
    elements.close.addEventListener("click", closeDialog);
    elements.dialog.addEventListener("keydown", function (event) {
      if (globalThis.DivinationCardNotes && globalThis.DivinationCardNotes.isOpen()) return;
      if (event.key === "Escape" && typeof elements.dialog.close !== "function") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || typeof elements.dialog.showModal === "function") return;
      var focusable = Array.prototype.slice.call(elements.dialog.querySelectorAll(
        "button:not([disabled]), select:not([disabled]), textarea, input:not([tabindex='-1']), [href], [tabindex]:not([tabindex='-1'])"
      )).filter(function (element) { return element.getClientRects().length > 0; });
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
    elements.questionToggle.addEventListener("click", function () {
      setQuestionExpanded(elements.questionToggle.getAttribute("aria-expanded") !== "true");
    });
    elements.question.addEventListener("input", function () {
      useSavedQuestion = false;
      renderQuestionSummary();
    });
    Object.keys(noteEditors).forEach(function (field) {
      var editor = noteEditors[field];
      editor.edit.addEventListener("click", function () {
        editingField = field;
        editor.input.value = selectedRecord[field] || "";
        renderNotes();
        editor.input.focus();
      });
      editor.cancel.addEventListener("click", function () { finishNoteEdit(editor); });
      editor.save.addEventListener("click", function () { saveNote(field, editor.input.value); });
    });
    elements.clearReflection.addEventListener("click", function () { saveNote("reflection", ""); });
    if (elements.tabList) {
      elements.tabList.addEventListener("click", function () {
        if (activeTab === "list") return;
        renderList();
      });
    }
    if (elements.tabStats) {
      elements.tabStats.addEventListener("click", function () {
        if (!available) return;
        showStatsView();
      });
    }
    if (elements.tabs) {
      elements.tabs.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        if (!elements.tabList || !elements.tabStats || elements.tabStats.disabled) return;
        event.preventDefault();
        if (activeTab === "list") {
          showStatsView();
          elements.tabStats.focus();
        } else {
          renderList();
          elements.tabList.focus();
        }
      });
    }
    if (elements.statsDecks) {
      elements.statsDecks.addEventListener("click", function (event) {
        var btn = event.target && event.target.closest ? event.target.closest("[data-stats-deck]") : null;
        if (!btn) return;
        var nextDeck = btn.getAttribute("data-stats-deck");
        if (!nextDeck || nextDeck === statsDeck) return;
        clearCardFilter();
        statsDeck = nextDeck;
        statsDeckUserPicked = true;
        statsCategoryId = null;
        statsExpanded = false;
        renderStats();
      });
    }
    if (elements.statsPeriods) {
      elements.statsPeriods.addEventListener("click", function (event) {
        var btn = event.target && event.target.closest ? event.target.closest("[data-stats-period]") : null;
        if (!btn) return;
        var nextPeriod = btn.getAttribute("data-stats-period");
        if (!nextPeriod || nextPeriod === statsPeriod) return;
        statsPeriod = nextPeriod;
        statsExpanded = false;
        renderStats();
      });
    }
    elements.cardFilter.addEventListener("click", function () {
      clearCardFilter();
      renderList();
      (byId("historyDeckFilterTrigger") || elements.filter).focus();
    });
    elements.filter.addEventListener("change", function () {
      cardFilter = null;
      renderList();
    });
    elements.search.addEventListener("input", renderList);
    elements.select.addEventListener("click", function () {
      selecting = !selecting;
      selectedIds.clear();
      renderList();
    });
    elements.exportSelected.addEventListener("click", function () {
      exportMarkdown(allRecords.filter(function (record) { return selectedIds.has(record.id); }));
    });
    if (elements.image) elements.image.addEventListener("click", function () {
      if (selectedRecord) openImage(selectedRecord);
    });
    elements.markdown.addEventListener("click", function () {
      if (selectedRecord) exportMarkdown([selectedRecord]);
    });
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

    return {
      resetQuestion: resetQuestion,
      updateSaveAvailability: updateSaveAvailability,
      saveCompletedReading: saveCurrentReading,
      openTableInAi: openTableInAi,
      exportTableMarkdown: exportTableMarkdown,
      exportTableImage: exportTableImage,
      saveFreeformReading: saveFreeformReading,
      saveRecord: saveRecord,
      refresh: refreshList,
      refreshLanguage: refreshLanguage
    };
  }

  return {
    init: init,
    formatMarkdown: formatMarkdown,
    imageModel: imageModel,
    createSerialTaskQueue: createSerialTaskQueue,
    calculateFreeformPreviewLayout: calculateFreeformPreviewLayout,
    canRenderActualSpread: canRenderActualSpread
  };
});
