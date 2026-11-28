(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DivinationHistoryStats = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DECKS = ["tarot", "mystagogus", "lxxxi"];
  var DECK_FILTERS = ["all", "tarot", "mystagogus", "lxxxi"];
  var PERIODS = ["all", "30d", "90d", "365d"];
  var PERIOD_DAYS = { "30d": 30, "90d": 90, "365d": 365 };
  var DAY_MS = 24 * 60 * 60 * 1000;

  var DECK_SIZES = {
    all: 237,
    tarot: 78,
    mystagogus: 78,
    lxxxi: 81
  };

  var CATEGORIES = {
    all: [
      { id: "tarot", name: "塔罗牌", nameEn: "Tarot", deckSize: 78 },
      { id: "mystagogus", name: "Mystagogus", nameEn: "Mystagogus", deckSize: 78 },
      { id: "lxxxi", name: "LXXXI 魔法牌", nameEn: "LXXXI", deckSize: 81 }
    ],
    tarot: [
      { id: "major", name: "大阿卡那", nameEn: "Major Arcana", deckSize: 22, arcana: "major" },
      { id: "wands", name: "权杖", nameEn: "Wands", deckSize: 14, arcana: "minor" },
      { id: "cups", name: "圣杯", nameEn: "Cups", deckSize: 14, arcana: "minor" },
      { id: "swords", name: "宝剑", nameEn: "Swords", deckSize: 14, arcana: "minor" },
      { id: "pentacles", name: "星币", nameEn: "Pentacles", deckSize: 14, arcana: "minor" }
    ],
    mystagogus: [
      { id: "core-fate", last: 4, name: "第一章 · 核心命运力量", nameEn: "I · The Core Fate Powers", deckSize: 4 },
      { id: "magical-path-1", last: 17, name: "第二章 · 魔法之路 I", nameEn: "II · The Magical Path", deckSize: 13 },
      { id: "magical-path-2", last: 31, name: "第三章 · 魔法之路 II", nameEn: "III · The Magical Path II", deckSize: 14 },
      { id: "structures", last: 48, name: "第四章 · 结构与场域", nameEn: "IV · Structures", deckSize: 17 },
      { id: "beings", last: 59, name: "第五章 · 存在与灵体", nameEn: "V · Beings", deckSize: 11 },
      { id: "dynamics-1", last: 68, name: "第六章 · 动力与力量 I", nameEn: "VI · Dynamics and Powers", deckSize: 9 },
      { id: "dynamics-2", last: 78, name: "第七章 · 动力与力量 II", nameEn: "VII · Dynamics and Powers II", deckSize: 10 }
    ],
    lxxxi: [
      { id: "divine", last: 4, name: "神圣领域", nameEn: "Divine Realm", deckSize: 4, swatch: "divine" },
      { id: "inner", last: 26, name: "内在领域", nameEn: "Inner Realm", deckSize: 22, swatch: "inner" },
      { id: "physical", last: 77, name: "物质领域", nameEn: "Physical Realm", deckSize: 51, swatch: "physical" },
      { id: "underworld", last: 81, name: "死亡与地下世界领域", nameEn: "Death and the Underworld", deckSize: 4, swatch: "underworld" }
    ]
  };

  var TAROT_SUIT_TO_ID = {
    "权杖": "wands",
    "wands": "wands",
    "圣杯": "cups",
    "cups": "cups",
    "宝剑": "swords",
    "swords": "swords",
    "星币": "pentacles",
    "pentacles": "pentacles"
  };

  function resolveDeckCards(deckType, decks) {
    if (decks && Array.isArray(decks[deckType])) return decks[deckType];
    if (deckType === "tarot" && typeof tarotDeckFull !== "undefined") return tarotDeckFull;
    if (deckType === "mystagogus" && typeof mystagogusDeckFull !== "undefined") return mystagogusDeckFull;
    if (deckType === "lxxxi" && typeof lxxxiDeckFull !== "undefined") return lxxxiDeckFull;
    return [];
  }

  function parsePositiveNumber(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
    if (typeof value === "string") {
      var match = value.match(/(\d+)$/);
      if (match) {
        var parsed = parseInt(match[1], 10);
        if (parsed > 0) return parsed;
      }
    }
    return null;
  }

  function classifyCard(deckType, card, sourceCard) {
    var cardId = String((card && card.cardId) || (sourceCard && sourceCard.id) || "");

    if (deckType === "tarot") {
      if (cardId.indexOf("major-") === 0) return "major";
      var minorMatch = cardId.match(/^minor-(wands|cups|swords|pentacles)-/);
      if (minorMatch) return minorMatch[1];
      if (sourceCard) {
        if (sourceCard.arcana === "major") return "major";
        var suitKey = sourceCard.suit && TAROT_SUIT_TO_ID[String(sourceCard.suit).toLowerCase()];
        if (suitKey) return suitKey;
      }
      return null;
    }

    if (deckType === "mystagogus") {
      if (sourceCard && sourceCard.chapter && sourceCard.chapter.id) return sourceCard.chapter.id;
      var mNum = parsePositiveNumber(sourceCard && sourceCard.number) ||
        parsePositiveNumber(card && card.cardNumber) ||
        parsePositiveNumber(cardId);
      if (mNum === null) return null;
      var mGroup = CATEGORIES.mystagogus.find(function (item) { return mNum <= item.last; });
      return mGroup ? mGroup.id : null;
    }

    if (deckType === "lxxxi") {
      var lNum = parsePositiveNumber(sourceCard && sourceCard.number) ||
        parsePositiveNumber(card && card.cardNumber) ||
        parsePositiveNumber(cardId);
      if (lNum === null) return null;
      var lGroup = CATEGORIES.lxxxi.find(function (item) { return lNum <= item.last; });
      return lGroup ? lGroup.id : null;
    }

    return null;
  }

  function getCategoryInfo(deckType, categoryId) {
    var list = CATEGORIES[deckType];
    if (!list || !categoryId) return null;
    return list.find(function (item) { return item.id === categoryId; }) || null;
  }

  function parseTimestamp(value) {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    var parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function withinPeriod(createdMs, cutoffMs) {
    return cutoffMs == null || (createdMs !== null && createdMs >= cutoffMs);
  }

  function isCountableRecord(record) {
    return !!record && Array.isArray(record.cards) && DECKS.indexOf(record.deckType) !== -1;
  }

  function isCountableCard(record, card) {
    return card && card.cardId && (record.layoutMode !== "freeform" || card.revealed !== false);
  }

  function pickDefaultDeck(records, preferredDeck) {
    if (!preferredDeck || preferredDeck === "all") return "all";
    var counts = { tarot: 0, mystagogus: 0, lxxxi: 0 };
    var total = 0;
    (records || []).forEach(function (record) {
      if (record && Object.prototype.hasOwnProperty.call(counts, record.deckType)) {
        counts[record.deckType] += 1;
        total += 1;
      }
    });
    if (Object.prototype.hasOwnProperty.call(counts, preferredDeck) && counts[preferredDeck] > 0) {
      return preferredDeck;
    }
    if (total > 0) return "all";
    return DECK_FILTERS.indexOf(preferredDeck) !== -1 ? preferredDeck : "all";
  }

  function summarize(records, options) {
    options = options || {};
    var deckType = DECK_FILTERS.indexOf(options.deckType) !== -1 ? options.deckType : "all";
    var isAllDecks = deckType === "all";
    var period = PERIODS.indexOf(options.period) !== -1 ? options.period : "all";
    var nowMs = options.now != null ? parseTimestamp(options.now) : Date.now();
    if (nowMs === null) nowMs = Date.now();
    var cutoffMs = PERIOD_DAYS[period] ? nowMs - PERIOD_DAYS[period] * DAY_MS : null;

    var sourceByDeck = {};
    DECKS.forEach(function (deck) {
      var map = new Map();
      resolveDeckCards(deck, options.decks).forEach(function (item) {
        if (item && item.id) map.set(item.id, item);
      });
      sourceByDeck[deck] = map;
    });

    var deckSize = DECK_SIZES[deckType] || 1;
    var categoryDefs = CATEGORIES[deckType] || [];
    var categoryCounts = new Map();
    categoryDefs.forEach(function (def) { categoryCounts.set(def.id, 0); });

    var readingCount = 0;
    var totalDraws = 0;
    var uprightCount = 0;
    var reversedCount = 0;
    var cardMap = new Map();

    (records || []).forEach(function (record) {
      if (!isCountableRecord(record)) return;
      if (!isAllDecks && record.deckType !== deckType) return;
      var createdMs = parseTimestamp(record.createdAt);
      if (!withinPeriod(createdMs, cutoffMs)) return;

      var recordDeck = record.deckType;
      var deckSourceMap = sourceByDeck[recordDeck];
      var countedInReading = 0;

      record.cards.forEach(function (card) {
        if (!isCountableCard(record, card)) return;

        var sourceCard = (deckSourceMap && deckSourceMap.get(card.cardId)) || null;
        var subCategoryId = classifyCard(recordDeck, card, sourceCard);
        var bucketCategoryId = isAllDecks ? recordDeck : subCategoryId;
        var isReversed = recordDeck === "tarot" &&
          record.orientationMode === "mixed" &&
          card.orientation === "reversed";

        countedInReading += 1;
        totalDraws += 1;
        if (isReversed) reversedCount += 1;
        else uprightCount += 1;

        if (bucketCategoryId && categoryCounts.has(bucketCategoryId)) {
          categoryCounts.set(bucketCategoryId, categoryCounts.get(bucketCategoryId) + 1);
        }

        var mapKey = recordDeck + ":" + card.cardId;
        var entry = cardMap.get(mapKey);
        if (!entry) {
          var numeric = parsePositiveNumber(sourceCard && sourceCard.number) ||
            parsePositiveNumber(card.cardNumber) ||
            parsePositiveNumber(card.cardId) || 0;
          entry = {
            deckType: recordDeck,
            cardId: card.cardId,
            cardNumber: numeric,
            fallbackName: card.cardName || card.cardId,
            sourceCard: sourceCard,
            categoryId: bucketCategoryId,
            subCategoryId: subCategoryId,
            count: 0,
            uprightCount: 0,
            reversedCount: 0,
            lastDrawnAt: record.createdAt || "",
            _lastMs: createdMs === null ? -Infinity : createdMs
          };
          cardMap.set(mapKey, entry);
        }

        entry.count += 1;
        if (isReversed) entry.reversedCount += 1;
        else entry.uprightCount += 1;

        if (createdMs !== null && createdMs >= entry._lastMs) {
          entry._lastMs = createdMs;
          entry.lastDrawnAt = record.createdAt || entry.lastDrawnAt;
          if (card.cardName) entry.fallbackName = card.cardName;
        }
      });

      if (countedInReading > 0) readingCount += 1;
    });

    var categories = categoryDefs.map(function (def) {
      var count = categoryCounts.get(def.id) || 0;
      var expectedShare = def.deckSize / deckSize;
      var share = totalDraws > 0 ? count / totalDraws : 0;
      return {
        id: def.id,
        name: def.name,
        nameEn: def.nameEn,
        deckSize: def.deckSize,
        expectedShare: expectedShare,
        count: count,
        share: share,
        delta: totalDraws > 0 ? share - expectedShare : 0,
        ratio: totalDraws > 0 && expectedShare > 0 ? share / expectedShare : 0,
        swatch: def.swatch || ""
      };
    });

    var topCategory = null;
    if (totalDraws > 0) {
      categories.forEach(function (cat) {
        if (cat.count === 0) return;
        if (!topCategory ||
            cat.count > topCategory.count ||
            (cat.count === topCategory.count && cat.ratio > topCategory.ratio)) {
          topCategory = cat;
        }
      });
    }

    var arcana = null;
    var orientation = null;
    if (deckType === "tarot") {
      var majorCount = categoryCounts.get("major") || 0;
      var minorCount = Math.max(0, totalDraws - majorCount);
      arcana = {
        major: {
          count: majorCount,
          share: totalDraws > 0 ? majorCount / totalDraws : 0,
          deckSize: 22,
          expectedShare: 22 / 78
        },
        minor: {
          count: minorCount,
          share: totalDraws > 0 ? minorCount / totalDraws : 0,
          deckSize: 56,
          expectedShare: 56 / 78
        }
      };
      orientation = {
        upright: {
          count: uprightCount,
          share: totalDraws > 0 ? uprightCount / totalDraws : 0
        },
        reversed: {
          count: reversedCount,
          share: totalDraws > 0 ? reversedCount / totalDraws : 0
        },
        hasReversed: reversedCount > 0
      };
    }

    var cards = Array.from(cardMap.values()).sort(function (a, b) {
      if (b.count !== a.count) return b.count - a.count;
      if (b._lastMs !== a._lastMs) return b._lastMs - a._lastMs;
      if (a.deckType !== b.deckType) return DECKS.indexOf(a.deckType) - DECKS.indexOf(b.deckType);
      if (a.cardNumber !== b.cardNumber) return a.cardNumber - b.cardNumber;
      return a.cardId.localeCompare(b.cardId);
    }).map(function (entry) {
      return {
        deckType: entry.deckType,
        cardId: entry.cardId,
        cardNumber: entry.cardNumber,
        fallbackName: entry.fallbackName,
        sourceCard: entry.sourceCard,
        categoryId: entry.categoryId,
        subCategoryId: entry.subCategoryId,
        count: entry.count,
        share: totalDraws > 0 ? entry.count / totalDraws : 0,
        uprightCount: entry.uprightCount,
        reversedCount: entry.reversedCount,
        lastDrawnAt: entry.lastDrawnAt
      };
    });

    return {
      deckType: deckType,
      period: period,
      cutoffMs: cutoffMs,
      deckSize: deckSize,
      readingCount: readingCount,
      totalDraws: totalDraws,
      uniqueCards: cards.length,
      arcana: arcana,
      orientation: orientation,
      categories: categories,
      topCategory: topCategory,
      cards: cards
    };
  }

  function matchesCardFilter(record, filter) {
    if (!isCountableRecord(record) || !filter || record.deckType !== filter.deckType) return false;
    if (!withinPeriod(parseTimestamp(record.createdAt), filter.cutoffMs)) return false;
    return record.cards.some(function (card) {
      return isCountableCard(record, card) && card.cardId === filter.cardId;
    });
  }

  return {
    DECKS: DECKS,
    DECK_FILTERS: DECK_FILTERS,
    PERIODS: PERIODS,
    PERIOD_DAYS: PERIOD_DAYS,
    DECK_SIZES: DECK_SIZES,
    CATEGORIES: CATEGORIES,
    classifyCard: classifyCard,
    getCategoryInfo: getCategoryInfo,
    pickDefaultDeck: pickDefaultDeck,
    matchesCardFilter: matchesCardFilter,
    summarize: summarize
  };
});
