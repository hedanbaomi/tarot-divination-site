(function (global) {
  "use strict";

  var CJK_CHAR_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]/g;

  function parseTimestampMs(value) {
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (!trimmed) {
        return 0;
      }
      if (/^\d+$/.test(trimmed)) {
        var asInt = Number(trimmed);
        return Number.isFinite(asInt) && asInt > 0 ? asInt : 0;
      }
      var parsed = Date.parse(trimmed);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    return 0;
  }

  function isSelectableReadingRecord(record) {
    return Boolean(
      record
      && typeof record === "object"
      && record.layoutMode !== "freeform"
      && typeof record.spreadId === "string"
      && record.spreadId.length > 0
      && Array.isArray(record.cards)
      && record.cards.length > 0
    );
  }

  function filterSelectableHistoryRecords(records) {
    if (!Array.isArray(records)) {
      return [];
    }
    return records.filter(isSelectableReadingRecord).sort(function (a, b) {
      return parseTimestampMs(b.createdAt) - parseTimestampMs(a.createdAt);
    });
  }

  function resolveGlobalBinding(explicitValue, getLexical, globalName, fallbackValue) {
    if (explicitValue !== undefined && explicitValue !== null) {
      return explicitValue;
    }
    if (typeof getLexical === "function") {
      try {
        var lexicalVal = getLexical();
        if (lexicalVal !== undefined && lexicalVal !== null) {
          return lexicalVal;
        }
      } catch (_err) {
        // Ignore ReferenceError when global lexical binding does not exist
      }
    }
    if (global && globalName && global[globalName] !== undefined && global[globalName] !== null) {
      return global[globalName];
    }
    return fallbackValue;
  }

  function getDefaultEnvironment(options) {
    var opts = options && typeof options === "object" ? options : {};
    var tarotDeck = resolveGlobalBinding(opts.tarotDeck, function () { return tarotDeckFull; }, "tarotDeckFull", []);
    var mystagogusDeck = resolveGlobalBinding(opts.mystagogusDeck, function () { return mystagogusDeckFull; }, "mystagogusDeckFull", []);
    var lxxxiDeck = resolveGlobalBinding(opts.lxxxiDeck, function () { return lxxxiDeckFull; }, "lxxxiDeckFull", []);
    var tSpreads = resolveGlobalBinding(opts.tarotSpreads, function () { return tarotSpreads; }, "tarotSpreads", []);
    var mSpreads = resolveGlobalBinding(opts.mystagogusSpreads, function () { return mystagogusSpreads; }, "mystagogusSpreads", []);
    var lSpreads = resolveGlobalBinding(opts.lxxxiSpreads, function () { return lxxxiSpreads; }, "lxxxiSpreads", []);
    var spreadGetter = resolveGlobalBinding(opts.getSpreadById, function () { return getSpreadById; }, "getSpreadById", null);

    var customLibrary = opts.customLibrary || null;
    if (!customLibrary && global.DivinationCustomSpreads && typeof global.DivinationCustomSpreads.createLibrary === "function") {
      try {
        var isAndroid = Boolean(global.androidAbout || global.androidHistoryExport || global.androidAiConfig);
        customLibrary = global.DivinationCustomSpreads.createLibrary({
          platform: isAndroid ? "android" : "web",
          storage: typeof global.localStorage !== "undefined" ? global.localStorage : null
        });
      } catch (_err) {
        customLibrary = null;
      }
    }

    return {
      tarotDeck: Array.isArray(tarotDeck) ? tarotDeck : [],
      mystagogusDeck: Array.isArray(mystagogusDeck) ? mystagogusDeck : [],
      lxxxiDeck: Array.isArray(lxxxiDeck) ? lxxxiDeck : [],
      tarotSpreads: Array.isArray(tSpreads) ? tSpreads : [],
      mystagogusSpreads: Array.isArray(mSpreads) ? mSpreads : [],
      lxxxiSpreads: Array.isArray(lSpreads) ? lSpreads : [],
      getSpreadById: typeof spreadGetter === "function" ? spreadGetter : null,
      customLibrary: customLibrary
    };
  }

  function resolveSkillsEngine(options) {
    if (options && options.skillsEngine && typeof options.skillsEngine === "object") {
      return options.skillsEngine;
    }
    if (global && global.DivinationAiSkills && typeof global.DivinationAiSkills === "object") {
      return global.DivinationAiSkills;
    }
    if (typeof require === "function") {
      try {
        var loaded = require("./ai-skills.js");
        if (loaded && typeof loaded === "object") {
          return loaded;
        }
      } catch (_err) {
        // Optional fallback when running ai-context.js standalone without ai-skills.js
      }
    }
    return null;
  }

  function resolveLocale(options, record) {
    if (options && (options.locale === "en" || options.locale === "zh-CN")) {
      return options.locale;
    }
    if (global.DivinationI18n && typeof global.DivinationI18n.getLocale === "function") {
      var uiLocale = global.DivinationI18n.getLocale();
      if (uiLocale === "en" || uiLocale === "zh-CN") {
        return uiLocale;
      }
    }
    if (record && record.locale === "en") {
      return "en";
    }
    return "zh-CN";
  }

  function findExactSpread(spreadId, deckType, env) {
    if (!spreadId) {
      return null;
    }
    if (env.customLibrary && typeof env.customLibrary.getById === "function") {
      try {
        var customSpread = env.customLibrary.getById(spreadId);
        if (customSpread && customSpread.id === spreadId) {
          return customSpread;
        }
      } catch (_err) {
        // Ignore custom spread storage error
      }
    }
    var groups = [env.tarotSpreads, env.mystagogusSpreads, env.lxxxiSpreads];
    for (var g = 0; g < groups.length; g += 1) {
      var list = groups[g];
      for (var i = 0; i < list.length; i += 1) {
        if (list[i] && list[i].id === spreadId) {
          return list[i];
        }
      }
    }
    // Check explicit getSpreadById only when it returns an exact ID match (never its default fallback).
    if (env.getSpreadById) {
      try {
        var candidate = env.getSpreadById(deckType, spreadId);
        if (candidate && candidate.id === spreadId) {
          return candidate;
        }
      } catch (_err) {
        // Ignore
      }
    }
    return null;
  }

  function findCardInDeck(cardId, deckType, env) {
    var primary = deckType === "mystagogus"
      ? env.mystagogusDeck
      : (deckType === "lxxxi" ? env.lxxxiDeck : env.tarotDeck);
    for (var i = 0; i < primary.length; i += 1) {
      if (primary[i] && primary[i].id === cardId) {
        return primary[i];
      }
    }
    var fallbacks = [env.tarotDeck, env.mystagogusDeck, env.lxxxiDeck];
    for (var f = 0; f < fallbacks.length; f += 1) {
      var list = fallbacks[f];
      if (list === primary) {
        continue;
      }
      for (var j = 0; j < list.length; j += 1) {
        if (list[j] && list[j].id === cardId) {
          return list[j];
        }
      }
    }
    return null;
  }

  function pickText(obj, zhField, enField, isEnglish) {
    if (!obj || typeof obj !== "object") {
      return "";
    }
    if (isEnglish) {
      if (typeof obj[enField] === "string" && obj[enField]) {
        return obj[enField];
      }
      if (typeof obj[zhField] === "string" && obj[zhField]) {
        return obj[zhField];
      }
      return "";
    }
    return typeof obj[zhField] === "string" ? obj[zhField] : "";
  }

  function pickList(obj, zhField, enField, isEnglish) {
    if (!obj || typeof obj !== "object") {
      return [];
    }
    if (isEnglish && Array.isArray(obj[enField]) && obj[enField].length > 0) {
      return obj[enField].slice();
    }
    return Array.isArray(obj[zhField]) ? obj[zhField].slice() : [];
  }

  function getDeckDisplayName(deckType, isEnglish) {
    if (deckType === "mystagogus") {
      return isEnglish ? "Mystagogus Oracle (78 cards)" : "Mystagogus 神谕牌（78 张）";
    }
    if (deckType === "lxxxi") {
      return isEnglish ? "LXXXI Quareia Magical Deck (81 cards)" : "LXXXI 奎瑞亚魔法牌（81 张）";
    }
    return isEnglish ? "Quareia Traditional Tarot (78 cards)" : "Quareia 传统塔罗（78 张）";
  }

  function getDeckShortLabel(deckType, isEnglish) {
    if (deckType === "mystagogus") {
      return isEnglish ? "Mystagogus" : "M 牌";
    }
    if (deckType === "lxxxi") {
      return "LXXXI";
    }
    return isEnglish ? "Tarot" : "塔罗";
  }

  function getOrientationModeLabel(record, isEnglish) {
    if (record.deckType === "tarot" && record.orientationMode === "mixed") {
      return isEnglish ? "Upright + Reversed" : "正逆位混抽";
    }
    return isEnglish ? "Upright only" : "全正位";
  }

  function formatTimestamp(value, isEnglish) {
    var num = parseTimestampMs(value);
    if (!num) {
      return isEnglish ? "Unknown time" : "未知时间";
    }
    try {
      return new Date(num).toLocaleString(isEnglish ? "en-US" : "zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch (_err) {
      return new Date(num).toISOString();
    }
  }

  function parseOptionalSlotIndex(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") {
      return null;
    }
    var num = Number(value);
    return Number.isInteger(num) && num >= 0 ? num : null;
  }

  function parsePositivePositionNumber(value) {
    if (value === null || value === undefined || value === "" || typeof value === "boolean") {
      return 0;
    }
    var num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }

  function findSpreadPosition(spread, cardEntry, index) {
    if (!spread || !Array.isArray(spread.positions) || spread.positions.length === 0) {
      return null;
    }
    var targetNumber = parsePositivePositionNumber(cardEntry.positionNumber);
    if (targetNumber > 0) {
      for (var i = 0; i < spread.positions.length; i += 1) {
        if (Number(spread.positions[i].number) === targetNumber) {
          return spread.positions[i];
        }
      }
    }
    var slotIndex = parseOptionalSlotIndex(cardEntry.slotIndex);
    if (slotIndex !== null && slotIndex < spread.positions.length) {
      return spread.positions[slotIndex];
    }
    return spread.positions[index] || null;
  }

  function resolveCrossingTarget(spread, pos) {
    if (!pos) {
      return null;
    }
    if (Number.isInteger(pos.stackOn) && pos.stackOn > 0) {
      return pos.stackOn;
    }
    if (
      spread
      && Array.isArray(spread.positions)
      && (pos.offsetX || pos.offsetY)
      && pos.column !== null
      && pos.column !== undefined
      && pos.row !== null
      && pos.row !== undefined
    ) {
      for (var i = 0; i < spread.positions.length; i += 1) {
        var peer = spread.positions[i];
        if (peer
          && peer.column !== null
          && peer.column !== undefined
          && peer.row !== null
          && peer.row !== undefined
          && Number(peer.number) !== Number(pos.number)
          && Number(peer.column) === Number(pos.column)
          && Number(peer.row) === Number(pos.row)) {
          return Number(peer.number);
        }
      }
    }
    return null;
  }

  function isRecordSplitDeckStacked(record, spread) {
    if (!record || typeof record !== "object") {
      return false;
    }
    if (record.overviewMethod === "stacked") {
      return true;
    }
    if (spread && spread.stackingMode === "major-minor") {
      return true;
    }
    var cards = Array.isArray(record.cards) ? record.cards : [];
    for (var i = 0; i < cards.length; i += 1) {
      var c = cards[i];
      if (c && (c.layer === "major" || c.layer === "minor")) {
        return true;
      }
    }
    return false;
  }

  function resolveReadingDetails(record, options) {
    if (!isSelectableReadingRecord(record)) {
      return null;
    }
    var env = getDefaultEnvironment(options);
    var locale = resolveLocale(options, record);
    var isEnglish = locale === "en";
    var deckType = record.deckType === "mystagogus" || record.deckType === "lxxxi" ? record.deckType : "tarot";
    var spread = findExactSpread(record.spreadId, deckType, env);

    var spreadName = spread
      ? pickText(spread, "name", "nameEn", isEnglish)
      : (record.spreadName || record.spreadNameSnapshot || record.spreadId);
    var spreadDescription = spread ? pickText(spread, "description", "descriptionEn", isEnglish) : (record.spreadDescription || "");
    var spreadSource = spread ? pickText(spread, "source", "sourceEn", isEnglish) : (record.spreadSource || "");
    var isSplitDeckStacked = isRecordSplitDeckStacked(record, spread);

    var resolvedCards = record.cards.map(function (entry, index) {
      var pos = findSpreadPosition(spread, entry, index);
      var entryPosNum = parsePositivePositionNumber(entry.positionNumber);
      var positionNumber = entryPosNum > 0
        ? entryPosNum
        : (pos ? Number(pos.number) : index + 1);
      var positionName = pos
        ? pickText(pos, "name", "nameEn", isEnglish)
        : (entry.positionName || entry.positionNameSnapshot || ((isEnglish ? "Position " : "牌位 ") + positionNumber));
      var positionMeaning = pos ? pickText(pos, "meaning", "meaningEn", isEnglish) : (entry.positionMeaning || "");
      var stackOn = pos ? resolveCrossingTarget(spread, pos)
        : (Number.isInteger(entry.stackOn) && entry.stackOn > 0 ? entry.stackOn : null);
      var parsedSlotIndex = parseOptionalSlotIndex(entry.slotIndex);

      var cardObj = findCardInDeck(entry.cardId, deckType, env);
      var cardName = cardObj
        ? pickText(cardObj, "name", "nameEn", isEnglish)
        : (entry.cardName || entry.cardNameSnapshot || entry.cardId || "?");

      // Mystagogus & LXXXI remain strictly upright-only.
      var allowReversed = deckType === "tarot" && record.orientationMode === "mixed";
      var isReversed = allowReversed && entry.orientation === "reversed";

      var keywords = cardObj
        ? (isReversed
          ? pickList(cardObj, "reversedKeywords", "reversedKeywordsEn", isEnglish)
          : pickList(cardObj, "uprightKeywords", "uprightKeywordsEn", isEnglish))
        : [];
      var meaning = cardObj
        ? (isReversed
          ? pickText(cardObj, "reversedMeaning", "reversedMeaningEn", isEnglish)
          : pickText(cardObj, "uprightMeaning", "uprightMeaningEn", isEnglish))
        : "";
      var uprightMeaningRef = (cardObj && isReversed)
        ? pickText(cardObj, "uprightMeaning", "uprightMeaningEn", isEnglish)
        : "";
      var uprightKeywordsRef = (cardObj && isReversed)
        ? pickList(cardObj, "uprightKeywords", "uprightKeywordsEn", isEnglish)
        : [];
      var cardSource = cardObj ? pickText(cardObj, "source", "sourceEn", isEnglish) : "";

      var rawArcana = (cardObj && cardObj.arcana) || entry.arcana || "";
      var layer = entry.layer === "major" || entry.layer === "minor"
        ? entry.layer
        : (isSplitDeckStacked && (rawArcana === "major" || rawArcana === "minor") ? rawArcana : "");
      var layerLabel = "";
      if (layer === "major") {
        layerLabel = isEnglish ? "Base / Major Arcana (Cause)" : "大阿卡那 · 底牌／因";
      } else if (layer === "minor") {
        layerLabel = isEnglish ? "Stacked / Minor Arcana (Manifestation)" : "小阿卡那 · 叠牌／果";
      }

      var orientationLabel = deckType === "tarot"
        ? (isReversed ? (isEnglish ? "Reversed" : "逆位") : (isEnglish ? "Upright" : "正位"))
        : (isEnglish ? "Upright" : "正位");

      var posCol = pos && typeof pos.column === "number" && Number.isFinite(pos.column)
        ? pos.column
        : (typeof entry.column === "number" && Number.isFinite(entry.column) ? entry.column : null);
      var posRow = pos && typeof pos.row === "number" && Number.isFinite(pos.row)
        ? pos.row
        : (typeof entry.row === "number" && Number.isFinite(entry.row) ? entry.row : null);

      return {
        index: index,
        slotIndex: parsedSlotIndex !== null ? parsedSlotIndex : Math.max(0, positionNumber - 1),
        cardId: entry.cardId,
        cardName: cardName,
        cardNameZh: cardObj ? (cardObj.name || "") : (entry.cardName || entry.cardNameSnapshot || ""),
        cardNameEn: cardObj ? (cardObj.nameEn || "") : "",
        number: cardObj && typeof cardObj.number === "number" ? cardObj.number : null,
        arcana: rawArcana,
        suit: (cardObj && cardObj.suit) || entry.suit || "",
        element: (cardObj && cardObj.element) || entry.element || "",
        direction: (cardObj && cardObj.direction) || entry.direction || "",
        orientation: isReversed ? "reversed" : "upright",
        orientationLabel: orientationLabel,
        positionNumber: positionNumber,
        positionName: positionName,
        positionNameZh: pos ? (pos.name || "") : (entry.positionName || entry.positionNameSnapshot || ""),
        positionNameEn: pos ? (pos.nameEn || "") : "",
        positionMeaning: positionMeaning,
        column: posCol,
        row: posRow,
        drawRule: pos && pos.drawRule ? pos.drawRule : null,
        stackOn: stackOn,
        layer: layer,
        layerLabel: layerLabel,
        keywords: keywords,
        meaning: meaning,
        uprightMeaningRef: uprightMeaningRef,
        uprightKeywordsRef: uprightKeywordsRef,
        source: cardSource
      };
    });

    return {
      id: record.id,
      locale: locale,
      createdAt: parseTimestampMs(record.createdAt),
      rawCreatedAt: record.createdAt,
      formattedTime: formatTimestamp(record.createdAt, isEnglish),
      deckType: deckType,
      deckName: getDeckDisplayName(deckType, isEnglish),
      deckShortLabel: getDeckShortLabel(deckType, isEnglish),
      orientationMode: record.orientationMode || "upright-only",
      orientationModeLabel: getOrientationModeLabel(record, isEnglish),
      filterMode: record.filterMode || "not-applicable",
      overviewMethod: record.overviewMethod || "not-applicable",
      isSplitDeckStacked: isSplitDeckStacked,
      spreadId: record.spreadId,
      spreadFound: Boolean(spread),
      spreadName: spreadName,
      spreadCategory: spread ? pickText(spread, "category", "categoryEn", isEnglish) : "",
      spreadDescription: spreadDescription,
      spreadSource: spreadSource,
      spreadColumns: spread && Number(spread.columns) > 0 ? Number(spread.columns) : 0,
      spreadRows: spread && Number(spread.rows) > 0 ? Number(spread.rows) : 0,
      question: typeof record.question === "string" ? record.question.trim() : "",
      cards: resolvedCards
    };
  }

  function buildReadingSnapshot(record, options) {
    if (!isSelectableReadingRecord(record)) {
      return null;
    }
    var resolved = resolveReadingDetails(record, options);
    var cards = (resolved ? resolved.cards : record.cards).map(function (c, index) {
      var raw = record.cards[index] || {};
      var resolvedPosNum = parsePositivePositionNumber(c.positionNumber);
      var posNum = resolvedPosNum > 0 ? resolvedPosNum : (index + 1);
      var rawSlotIndex = parseOptionalSlotIndex(raw.slotIndex);
      var resolvedSlotIndex = parseOptionalSlotIndex(c.slotIndex);
      var snapCard = {
        slotIndex: rawSlotIndex !== null
          ? rawSlotIndex
          : (resolvedSlotIndex !== null ? resolvedSlotIndex : Math.max(0, posNum - 1)),
        positionNumber: posNum,
        positionName: c.positionName || raw.positionName || raw.positionNameSnapshot || "",
        positionMeaning: c.positionMeaning || raw.positionMeaning || "",
        stackOn: Number.isInteger(c.stackOn) && c.stackOn > 0 ? c.stackOn : null,
        cardId: String(c.cardId || raw.cardId || ""),
        cardName: c.cardName || raw.cardName || raw.cardNameSnapshot || "",
        orientation: c.orientation || raw.orientation || "upright",
        arcana: c.arcana || raw.arcana || "",
        suit: c.suit || raw.suit || "",
        layer: (c.layer === "major" || c.layer === "minor") ? c.layer : null
      };
      var snapCol = typeof c.column === "number" && Number.isFinite(c.column)
        ? c.column
        : (typeof raw.column === "number" && Number.isFinite(raw.column) ? raw.column : null);
      var snapRow = typeof c.row === "number" && Number.isFinite(c.row)
        ? c.row
        : (typeof raw.row === "number" && Number.isFinite(raw.row) ? raw.row : null);
      if (snapCol !== null) {
        snapCard.column = snapCol;
      }
      if (snapRow !== null) {
        snapCard.row = snapRow;
      }
      return snapCard;
    });

    return {
      id: String(record.id || ""),
      layoutMode: "preset",
      createdAt: record.createdAt || (resolved ? resolved.createdAt : Date.now()),
      deckType: resolved ? resolved.deckType : (record.deckType || "tarot"),
      spreadId: String(record.spreadId || ""),
      spreadName: (resolved && resolved.spreadName) || record.spreadName || record.spreadNameSnapshot || String(record.spreadId || ""),
      spreadDescription: (resolved && resolved.spreadDescription) || record.spreadDescription || "",
      spreadSource: (resolved && resolved.spreadSource) || record.spreadSource || "",
      positionCount: Number(record.positionCount) || cards.length,
      orientationMode: record.orientationMode || "upright-only",
      filterMode: record.filterMode || "not-applicable",
      overviewMethod: record.overviewMethod || (resolved && resolved.isSplitDeckStacked ? "stacked" : "not-applicable"),
      question: typeof record.question === "string" ? record.question.trim() : "",
      cards: cards
    };
  }

  function buildReadingCardSummary(record, options) {
    if (!isSelectableReadingRecord(record)) {
      return null;
    }
    var locale = resolveLocale(options, record);
    var isEnglish = locale === "en";
    var resolved = resolveReadingDetails(record, options);
    if (!resolved) {
      return null;
    }

    var cards = resolved.cards || [];
    var cardCount = cards.length;
    var orientationShort = resolved.deckType === "tarot" && resolved.orientationMode === "mixed"
      ? (isEnglish ? "Mixed" : "正逆位")
      : (isEnglish ? "Upright" : "全正位");

    var modeBadge = resolved.isSplitDeckStacked
      ? (isEnglish ? ("Stacked · " + cardCount + " cards") : ("叠牌法 · " + cardCount + " 张"))
      : (isEnglish ? (cardCount + " cards · " + orientationShort) : (cardCount + " 张 · " + orientationShort));

    // Build concise approximate card-name preview (pairs stacked major/minor per position).
    var previewTokens = [];
    if (resolved.isSplitDeckStacked) {
      var groups = [];
      var byPos = Object.create(null);
      for (var i = 0; i < cards.length; i += 1) {
        var entry = cards[i];
        var key = String(entry.positionNumber);
        if (!byPos[key]) {
          byPos[key] = { positionNumber: entry.positionNumber, major: null, minor: null, other: [] };
          groups.push(byPos[key]);
        }
        if (entry.layer === "major") {
          byPos[key].major = entry;
        } else if (entry.layer === "minor") {
          byPos[key].minor = entry;
        } else {
          byPos[key].other.push(entry);
        }
      }
      var maxPairs = Math.min(3, groups.length);
      for (var g = 0; g < maxPairs; g += 1) {
        var grp = groups[g];
        if (grp.major && grp.minor) {
          previewTokens.push(grp.major.cardName + "/" + grp.minor.cardName);
        } else {
          var single = grp.major || grp.minor || grp.other[0];
          if (single) {
            previewTokens.push(single.cardName);
          }
        }
      }
      if (groups.length > maxPairs) {
        previewTokens.push("…");
      }
    } else {
      var maxCards = Math.min(4, cards.length);
      for (var k = 0; k < maxCards; k += 1) {
        previewTokens.push(cards[k].cardName);
      }
      if (cards.length > maxCards) {
        previewTokens.push("…");
      }
    }

    return {
      id: resolved.id,
      deckType: resolved.deckType,
      deckLabel: resolved.deckShortLabel,
      spreadId: resolved.spreadId,
      spreadName: resolved.spreadName,
      isStacked: resolved.isSplitDeckStacked,
      cardCount: cardCount,
      modeBadge: modeBadge,
      createdAt: resolved.createdAt,
      createdText: resolved.formattedTime,
      question: resolved.question,
      cardsPreview: previewTokens.join(isEnglish ? ", " : "、")
    };
  }

  function fallbackSanitizeCueText(rawText, isEnglish) {
    if (typeof rawText !== "string" || !rawText.trim()) {
      return "";
    }
    var text = rawText
      .replace(/\(cid:\d+\)[^，。；\n]*/g, "")
      .replace(/[（(]译注[：:][^）)]*[）)]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (isEnglish) {
      text = text
        .replace(/\s*Read this as the active pattern shaping the situation\.?/gi, "")
        .replace(/\s*Pause,\s*check the facts,\s*and correct the imbalance before proceeding\.?/gi, "")
        .trim();
    }
    return text;
  }

  function normalizeWordsForDedupe(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/\b(?:and|the|a|an)\b/g, " ")
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
  }

  function splitAndDedupeCue(cueText, kwList) {
    var raw = typeof cueText === "string" ? cueText.trim() : "";
    if (!raw) {
      return { tagPrefix: "", uniqueCueBody: "" };
    }
    var tagPrefix = "";
    var body = raw;
    var tagMatch = /^(\[[^\]]+\])\s*([\s\S]*)$/.exec(raw);
    if (tagMatch) {
      tagPrefix = tagMatch[1].trim();
      body = (tagMatch[2] || "").trim();
    }
    var kwJoined = Array.isArray(kwList) && kwList.length > 0 ? kwList.join(" ") : "";
    if (body && kwJoined && !/[|｜]/.test(body)) {
      var normBody = normalizeWordsForDedupe(body);
      var normKw = normalizeWordsForDedupe(kwJoined);
      if (normBody && normKw && normBody === normKw) {
        body = "";
      }
    }
    return {
      tagPrefix: tagPrefix,
      uniqueCueBody: body
    };
  }

  function formatCardDetailLine(c, prefix, isEnglish, cue) {
    var parts = [];
    var sep = isEnglish ? ", " : "、";
    parts.push(prefix + "**" + c.cardName + "** (" + c.orientationLabel + ")");
    var kwList = cue && Array.isArray(cue.keywordsClean) && cue.keywordsClean.length > 0
      ? cue.keywordsClean
      : (c.keywords || []);
    var hasSourceMeaning = Boolean(c.meaning && c.meaning.trim());
    var cueText = cue && cue.coreCue ? cue.coreCue : fallbackSanitizeCueText(c.meaning, isEnglish);
    var deduped = hasSourceMeaning && c.orientation !== "reversed"
      ? splitAndDedupeCue(cueText, kwList)
      : null;

    if (kwList.length > 0) {
      var inlineTag = deduped && !deduped.uniqueCueBody && deduped.tagPrefix
        ? (deduped.tagPrefix + " ")
        : "";
      parts.push((isEnglish ? "Key Anchors: " : "意象锚点：") + inlineTag + kwList.join(sep));
    }
    if (!hasSourceMeaning) {
      parts.push(isEnglish
        ? "Imagery Cue: (Snapshot name only)"
        : "意象线索：（仅保留牌名快照）");
    } else if (c.orientation === "reversed") {
      var revVec = (cue && cue.reversalVector) || cueText;
      if (revVec) {
        parts.push((isEnglish ? "Reversal Vector: " : "逆位偏转向量：") + revVec);
      }
      var upAnchor = (cue && cue.uprightAnchor) || fallbackSanitizeCueText(c.uprightMeaningRef, isEnglish);
      if (upAnchor) {
        parts.push((isEnglish ? "Quareia Upright Core Reference: " : "Quareia 正位内核参考：") + upAnchor);
      }
    } else if (deduped && deduped.uniqueCueBody) {
      parts.push((isEnglish ? "Imagery Cue: " : "意象线索：") + cueText);
    } else if (kwList.length === 0 && cueText) {
      parts.push((isEnglish ? "Imagery Cue: " : "意象线索：") + cueText);
    }
    if (cue && cue.filterSlotHint) {
      parts.push((isEnglish ? "Filter Rule: " : "筛查提示：") + cue.filterSlotHint);
    }
    return parts.join(" | ");
  }

  function formatSingleReadingMarkdown(resolved, index, total, formatContext) {
    var isEnglish = resolved.locale === "en";
    var ctx = formatContext && typeof formatContext === "object" ? formatContext : {};
    var skills = ctx.skills || null;
    var register = ctx.register || "mundane";
    var gestalt = skills && typeof skills.analyzeReadingGestalt === "function"
      ? skills.analyzeReadingGestalt(resolved, resolved.locale)
      : null;
    var isFilterSpread = Boolean(gestalt && gestalt.isFilterSpread);

    var lines = [];
    var headerPrefix = total > 1
      ? (isEnglish ? ("### Reading " + (index + 1) + ": ") : ("### 占卜记录 " + (index + 1) + "："))
      : (isEnglish ? "### Reading Context: " : "### 占卜记录上下文：");
    lines.push(headerPrefix + resolved.spreadName);
    lines.push("- " + (isEnglish ? "Reading ID" : "记录 ID") + ": " + resolved.id);
    lines.push("- " + (isEnglish ? "Time" : "占卜时间") + ": " + resolved.formattedTime);
    if (resolved.question) {
      lines.push("- " + (isEnglish ? "Question" : "占卜问题") + ": " + resolved.question);
    } else {
      lines.push("- " + (isEnglish
        ? "Question: (Not recorded on this spread — read as an open tension snapshot and invite the user's real-life context; never roll-call positions)"
        : "占卜问题：（未记录具体问题 — 请按无问题盲解快照提炼 1–2 组最突出的现实张力并在结尾轻问处境，切勿逐位念牌）"));
    }
    lines.push("- " + (isEnglish ? "Deck" : "牌组") + ": " + resolved.deckName);
    lines.push("- " + (isEnglish ? "Orientation Mode" : "正逆位模式") + ": " + resolved.orientationModeLabel);
    lines.push("- " + (isEnglish ? "Spread" : "牌阵") + ": " + resolved.spreadName + " (`" + resolved.spreadId + "`)");

    if (resolved.isSplitDeckStacked) {
      lines.push("- " + (isEnglish
        ? "Draw Method: Split-Deck Major+Minor Stacking (叠牌法 — 22 Majors laid first as BASE / root CAUSE; 56 Minors laid on top in matching order as STACKED / concrete MANIFESTATION. Synthesize every position's Base Major + Stacked Minor as one inseparable Cause -> Manifestation pair.)"
        : "抽牌方式：分牌叠放／叠牌法（Quareia Split-Deck Stacking — 先铺 22 张大阿卡那作「底牌（因 / 深层动因与格局力量）」，再按同序叠放 56 张小阿卡那作「叠牌（果 / 日常事件、人物与具体显化）」。同牌位底牌与叠牌须作「因→果」一体合参，不可拆作孤立补牌）"));
    }

    if (resolved.spreadDescription) {
      lines.push("- " + (isEnglish ? "Spread Overview" : "牌阵说明") + ": " + resolved.spreadDescription);
    }
    if (resolved.spreadSource) {
      lines.push("- " + (isEnglish ? "Spread Source" : "牌阵出处") + ": " + resolved.spreadSource);
    }
    if (!gestalt && resolved.spreadId === "overview") {
      lines.push("- " + (isEnglish
        ? "Overview Structural Polarity & Cross-Links: Upper row Pos 1-6 = constructive/supportive polarity; Lower row Pos 7-12 = tension/challenge polarity; Pos 13 = Path Ahead. Key paired axes: 1↔7, 2↔8, 3↔10, 4↔9, 6↔11, 5↔12 (acting consciously on 11 relieves pressure on 12 & 5)."
        : "概览布局结构对照：上排 1–6 位属建设性／支撑极；下排 7–12 位属张力／考验极；13 位为前方的道路。核心交叉联动：1↔7、2↔8、3↔10、4↔9、6↔11、5↔12（主动修习11位可减轻12位剥离并护持5位健康）。"));
    }
    if (!resolved.spreadFound) {
      lines.push("- " + (isEnglish
        ? "Note: Full custom spread definition is unavailable on this device; saved position name snapshots are used below."
        : "注：当前会话未加载该自定义牌阵完整定义，以下使用历史记录保存的牌位名称快照。"));
    }

    if (gestalt) {
      lines.push("");
      lines.push(isEnglish
        ? "#### First-Impressions Gestalt & Spread Circuitry (Pre-Computed)"
        : "#### 盘面首印气势与拓扑电路（预计算结构信号）");
      if (Array.isArray(gestalt.summaryLines)) {
        for (var gs = 0; gs < gestalt.summaryLines.length; gs += 1) {
          if (gestalt.summaryLines[gs]) {
            lines.push("- " + gestalt.summaryLines[gs]);
          }
        }
      }
      if (Array.isArray(gestalt.displacements) && gestalt.displacements.length > 0) {
        var joinedSummary = Array.isArray(gestalt.summaryLines) ? gestalt.summaryLines.join("\n") : "";
        for (var gd = 0; gd < gestalt.displacements.length; gd += 1) {
          var disp = gestalt.displacements[gd];
          var dispNote = disp && disp.note ? disp.note : "";
          if (dispNote && joinedSummary.indexOf(dispNote) === -1) {
            lines.push("- " + dispNote);
          }
        }
      }
      if (gestalt.readingCircuitHint && !ctx.omitCircuitHint) {
        lines.push("- " + (isEnglish ? "Reading Circuitry: " : "本阵解牌动线：") + gestalt.readingCircuitHint);
      }
    }

    lines.push("");
    lines.push(isEnglish
      ? "#### Positions & Internal Imagery Scratchpad (Use Core Concepts Naturally — Never Copy Whole Clauses or Roll-Call 1..N)"
      : "#### 牌位与内部意象底稿（可自然化用核心概念词与事实落点，严禁整句照抄原话或按 1→N 挨个点名）");

    function buildCueForCard(cardItem) {
      if (skills && typeof skills.compileCardCue === "function") {
        return skills.compileCardCue(cardItem, {
          locale: resolved.locale,
          deckType: resolved.deckType,
          spreadId: resolved.spreadId,
          register: register,
          isFilterSpread: isFilterSpread
        });
      }
      return null;
    }

    if (resolved.isSplitDeckStacked) {
      var posGroups = [];
      var byPosNum = Object.create(null);
      for (var i = 0; i < resolved.cards.length; i += 1) {
        var entry = resolved.cards[i];
        var key = String(entry.positionNumber);
        if (!byPosNum[key]) {
          byPosNum[key] = {
            positionNumber: entry.positionNumber,
            positionName: entry.positionName,
            positionMeaning: entry.positionMeaning,
            stackOn: entry.stackOn,
            entries: []
          };
          posGroups.push(byPosNum[key]);
        }
        byPosNum[key].entries.push(entry);
      }

      for (var g = 0; g < posGroups.length; g += 1) {
        var grp = posGroups[g];
        grp.entries.sort(function (a, b) {
          if (a.layer === b.layer) return a.index - b.index;
          if (a.layer === "major") return -1;
          if (b.layer === "major") return 1;
          if (a.layer === "minor") return -1;
          if (b.layer === "minor") return 1;
          return a.index - b.index;
        });

        var stackedCrossNote = "";
        if (Number.isInteger(grp.stackOn) && grp.stackOn > 0) {
          stackedCrossNote = isEnglish
            ? (" [Crossing over Pos " + grp.stackOn + "]")
            : ("（交叉叠放于第 " + grp.stackOn + " 位之上）");
        }
        var heading = isEnglish
          ? ("**" + grp.positionNumber + ". " + grp.positionName + "**" + stackedCrossNote + " [Stacked Pair: Major Cause -> Minor Manifestation]")
          : ("**第 " + grp.positionNumber + " 位 · " + grp.positionName + "**" + stackedCrossNote + "【叠牌组合：大牌为因 · 小牌为果】");
        lines.push(heading);
        if (grp.positionMeaning) {
          lines.push("  - " + (isEnglish ? "Position Role" : "牌位职能") + ": " + grp.positionMeaning);
        }
        for (var e = 0; e < grp.entries.length; e += 1) {
          var sub = grp.entries[e];
          var tag = sub.layerLabel ? ("[" + sub.layerLabel + "] ") : "";
          var subCue = buildCueForCard(sub);
          lines.push("  - " + formatCardDetailLine(sub, tag, isEnglish, subCue));
        }
      }
      return lines.join("\n");
    }

    for (var k = 0; k < resolved.cards.length; k += 1) {
      var c = resolved.cards[k];
      var cardCue = buildCueForCard(c);
      var crossNote = "";
      if (Number.isInteger(c.stackOn) && c.stackOn > 0) {
        crossNote = isEnglish
          ? (" [Crossing over Pos " + c.stackOn + " — direct intersecting force/verdict]")
          : ("【交叉叠放于第 " + c.stackOn + " 位之上 — 直接作用于核心锚点的交叉力量，非大小阿卡那分牌叠放】");
      }
      var posHeader = isEnglish
        ? ("**" + c.positionNumber + ". " + c.positionName + "**" + crossNote + " -> **" + c.cardName + "** (" + c.orientationLabel + ")")
        : ("**第 " + c.positionNumber + " 位 · " + c.positionName + "**" + crossNote + " -> **" + c.cardName + "**（" + c.orientationLabel + "）");
      lines.push(posHeader);
      if (c.positionMeaning) {
        lines.push("  - " + (isEnglish ? "Position Role" : "牌位职能") + ": " + c.positionMeaning);
      }
      var kwClean = cardCue && Array.isArray(cardCue.keywordsClean) && cardCue.keywordsClean.length > 0
        ? cardCue.keywordsClean
        : (c.keywords || []);
      var hasRawMeaning = Boolean(c.meaning && c.meaning.trim());
      var distilledCue = cardCue && cardCue.coreCue
        ? cardCue.coreCue
        : fallbackSanitizeCueText(c.meaning, isEnglish);
      var dedupedSlotCue = hasRawMeaning && c.orientation !== "reversed"
        ? splitAndDedupeCue(distilledCue, kwClean)
        : null;

      if (kwClean.length > 0) {
        var sep = isEnglish ? ", " : "、";
        var slotTagPrefix = dedupedSlotCue && !dedupedSlotCue.uniqueCueBody && dedupedSlotCue.tagPrefix
          ? (dedupedSlotCue.tagPrefix + " ")
          : "";
        lines.push("  - " + (isEnglish ? "Key Anchors" : "意象锚点") + ": " + slotTagPrefix + kwClean.join(sep));
      }
      if (!hasRawMeaning) {
        lines.push("  - " + (isEnglish ? "Imagery Cue" : "意象线索") + ": " + (isEnglish ? "(Snapshot name only)" : "（未匹配到完整牌义，仅保留牌名快照）"));
      } else if (c.orientation === "reversed") {
        var revText = (cardCue && cardCue.reversalVector) || distilledCue;
        if (revText) {
          lines.push("  - " + (isEnglish ? "Reversal Vector" : "逆位偏转向量") + ": " + revText);
        }
        var upRef = (cardCue && cardCue.uprightAnchor) || fallbackSanitizeCueText(c.uprightMeaningRef, isEnglish);
        if (upRef) {
          lines.push("  - " + (isEnglish ? "Quareia Upright Core Reference" : "Quareia 正位内核参考") + ": " + upRef);
        }
      } else if (dedupedSlotCue && dedupedSlotCue.uniqueCueBody) {
        lines.push("  - " + (isEnglish ? "Imagery Cue" : "意象线索") + ": " + distilledCue);
      } else if (kwClean.length === 0 && distilledCue) {
        lines.push("  - " + (isEnglish ? "Imagery Cue" : "意象线索") + ": " + distilledCue);
      }
      if (cardCue && cardCue.filterSlotHint) {
        lines.push("  - " + (isEnglish ? "Filter Rule" : "筛查提示") + ": " + cardCue.filterSlotHint);
      }
    }
    return lines.join("\n");
  }

  function resolveOrderedReadings(records, options) {
    if (!Array.isArray(records) || records.length === 0) {
      return [];
    }
    var resolvedList = [];
    for (var i = 0; i < records.length; i += 1) {
      if (isSelectableReadingRecord(records[i])) {
        var res = resolveReadingDetails(records[i], options);
        if (res) {
          resolvedList.push(res);
        }
      }
    }
    return resolvedList;
  }

  function formatReadingsForPrompt(records, options) {
    var opts = options && typeof options === "object" ? options : {};
    var resolvedList = Array.isArray(opts.resolvedReadings) && opts.resolvedReadings.length > 0
      ? opts.resolvedReadings
      : resolveOrderedReadings(records, opts);
    if (resolvedList.length === 0) {
      return "";
    }
    var skills = resolveSkillsEngine(opts);
    var locale = resolvedList[0].locale || resolveLocale(opts, null);
    var register = typeof opts.register === "string" && opts.register
      ? opts.register
      : (skills && typeof skills.detectRegister === "function"
          ? skills.detectRegister({
              locale: locale,
              resolvedReadings: resolvedList,
              records: Array.isArray(opts.records) ? opts.records : (Array.isArray(records) ? records : []),
              messages: Array.isArray(opts.messages) ? opts.messages : []
            })
          : "mundane");
    var sections = [];
    for (var j = 0; j < resolvedList.length; j += 1) {
      sections.push(formatSingleReadingMarkdown(resolvedList[j], j, resolvedList.length, {
        skills: skills,
        register: register,
        omitCircuitHint: Boolean(opts.omitCircuitHint)
      }));
    }
    return sections.join("\n\n---\n\n");
  }

  function inferSyntheticReadingsFromMarkdown(readingsMarkdown, locale) {
    var text = typeof readingsMarkdown === "string" ? readingsMarkdown.trim() : "";
    if (!text) {
      return [];
    }
    var deckType = "tarot";
    if (/Mystagogus/i.test(text)) {
      deckType = "mystagogus";
    } else if (/LXXXI/i.test(text)) {
      deckType = "lxxxi";
    }
    var spreadMatch = /\(`([a-z0-9-]+)`\)/i.exec(text);
    var spreadId = spreadMatch ? spreadMatch[1] : "three-card-horizontal";
    var questionMatch = /^(?:-\s*(?:Question|占卜问题):\s*)(.+)$/m.exec(text);
    var rawQ = questionMatch ? questionMatch[1].trim() : "";
    if (rawQ.indexOf("（未记录") === 0 || rawQ.indexOf("(Not recorded") === 0) {
      rawQ = "";
    }
    return [{
      id: "synthetic-md",
      locale: locale === "en" ? "en" : "zh-CN",
      deckType: deckType,
      spreadId: spreadId,
      isSplitDeckStacked: /Split-Deck|分牌叠放|叠牌法/.test(text),
      question: rawQ,
      cards: []
    }];
  }

  function getSkillModes(locale, options) {
    var isEnglish = locale === "en";
    var skills = resolveSkillsEngine(options);
    if (skills && Array.isArray(skills.SKILL_MODES) && skills.SKILL_MODES.length > 0) {
      return skills.SKILL_MODES.map(function (m) {
        return {
          id: m.id,
          label: isEnglish ? (m.labelEn || m.id) : (m.labelZh || m.id),
          description: isEnglish ? (m.descEn || "") : (m.descZh || ""),
          labelZh: m.labelZh || m.id,
          labelEn: m.labelEn || m.id,
          descZh: m.descZh || "",
          descEn: m.descEn || ""
        };
      });
    }
    var fallback = [
      { id: "auto", labelZh: "智能编排", labelEn: "Auto", descZh: "按牌阵、牌组、意图与追问自动组合技法", descEn: "Automatically mounts skills by spread, deck, intent, and turn" },
      { id: "direct", labelZh: "直断破局", labelEn: "Direct", descZh: "开门见山直给核心结论与关键转折", descEn: "Lead with the straight verdict and decisive turning point" },
      { id: "deep", labelZh: "全局深剖", labelEn: "Deep", descZh: "深挖跨轴因果链、潜流共振与暗面动力", descEn: "Trace cross-axis causality, hidden currents, and structural tension" },
      { id: "action", labelZh: "现实处方", labelEn: "Action", descZh: "聚焦可控抓手、止损边界与具体行动步骤", descEn: "Focus on controllable leverage, boundaries, and concrete next steps" }
    ];
    return fallback.map(function (m) {
      return Object.assign({}, m, {
        label: isEnglish ? m.labelEn : m.labelZh,
        description: isEnglish ? m.descEn : m.descZh
      });
    });
  }

  function previewActiveSkills(options) {
    var opts = options && typeof options === "object" ? options : {};
    var effLocale = opts.locale === "en" ? "en" : "zh-CN";
    var skills = resolveSkillsEngine(opts);
    var resolvedReadings = Array.isArray(opts.resolvedReadings)
      ? opts.resolvedReadings
      : resolveOrderedReadings(opts.records, { locale: effLocale, customLibrary: opts.customLibrary });
    var modeNorm = skills && typeof skills.normalizeSkillMode === "function"
      ? skills.normalizeSkillMode(opts.skillMode)
      : (typeof opts.skillMode === "string" && ["auto", "direct", "deep", "action"].indexOf(opts.skillMode) !== -1 ? opts.skillMode : "auto");

    if (skills && typeof skills.routeSkills === "function") {
      return skills.routeSkills({
        locale: effLocale,
        resolvedReadings: resolvedReadings,
        records: Array.isArray(opts.records) ? opts.records : [],
        messages: Array.isArray(opts.messages) ? opts.messages : [],
        skillMode: modeNorm,
        hasUninterpretedReading: Boolean(opts.hasUninterpretedReading)
      });
    }
    return {
      locale: effLocale,
      skillMode: modeNorm,
      register: "mundane",
      intent: resolvedReadings.length > 0 ? "open-snapshot" : "general",
      isFollowUp: false,
      hasUninterpretedReading: Boolean(opts.hasUninterpretedReading),
      validUserTurns: 0,
      hasReadings: resolvedReadings.length > 0,
      activeSkills: [],
      promptBlock: ""
    };
  }

  function buildSystemPrompt(locale, readingsMarkdown, contextSummaryText, options) {
    var isEnglish = locale === "en";
    var effLocale = isEnglish ? "en" : "zh-CN";
    var opts = options && typeof options === "object" ? options : {};
    var trimmedContext = typeof readingsMarkdown === "string" ? readingsMarkdown.trim() : "";
    var skills = resolveSkillsEngine(opts);

    var resolvedReadings = Array.isArray(opts.resolvedReadings)
      ? opts.resolvedReadings
      : resolveOrderedReadings(opts.records, { locale: effLocale, customLibrary: opts.customLibrary });
    if (resolvedReadings.length === 0 && trimmedContext) {
      resolvedReadings = inferSyntheticReadingsFromMarkdown(trimmedContext, effLocale);
    }

    var routed = skills && typeof skills.routeSkills === "function"
      ? skills.routeSkills({
          locale: effLocale,
          resolvedReadings: resolvedReadings,
          records: Array.isArray(opts.records) ? opts.records : [],
          messages: Array.isArray(opts.messages) ? opts.messages : [],
          skillMode: opts.skillMode,
          hasUninterpretedReading: Boolean(opts.hasUninterpretedReading)
        })
      : null;

    var baseLines = isEnglish
      ? [
          "You are a seasoned Quareia divination reader and thoughtful conversation partner built into this application.",
          "",
          "## Core Role & Non-Blocking Conversation Principle",
          "- When interpreting attached readings across Quareia Traditional Tarot, Mystagogus Oracle, and the LXXXI Magical Deck, read like an experienced practitioner sitting across the table—penetrating, plain-spoken, structurally rigorous, and grounded in real life rather than reciting a guidebook.",
          "- **Non-blocking rule**: NEVER refuse, block, scold, or force-redirect benign non-divination topics (such as everyday conversation, emotional reflection, career/study planning, writing, technical questions, or general Q&A), whether or not a reading is attached. Respond naturally, clearly, and helpfully to whatever the user brings up.",
          "",
          "## Scratchpad Internalization, Polarity & Anti-Parroting Law",
          "- **Fidelity without parroting**: Never invent cards or positions that were not drawn. All injected position roles, anchors, and imagery cues are your **private reader's scratchpad** for cross-synthesis: you are encouraged to naturally use accurate position names, card names, and concrete domain/polarity concepts (e.g., contract, surgery, theft, pregnancy, threshold, ancestor) where relevant, while **NEVER copying whole scratchpad clauses verbatim, NEVER citing dictionary meta-labels (\"In-App Meaning\", \"Key Anchors\", \"Read this as the active pattern shaping the situation\", \"Pause, check the facts...\"), and NEVER marching mechanically from Position 1 to Position N like a roll-call checklist**.",
          "- **Three-way translation**: Translate `[card visual/energetic action] × [position function & polarity] × [concrete question & timeframe]` directly into human language, weaving card names naturally as supporting evidence rather than paragraph headings.",
          "- **Quareia Upright-Only Negative Positions & Reversals**: In Josephine McCarthy's system, decks are natively read upright-only; shadow, friction, or loss emerge from **challenging/deprivation positions** (Conflict, Hidden Enemies, Ordeal, Withheld/Taken Away, Unraveller, Taker, Binder, Danger) and surrounding pressure. Never read a pleasant card in a challenging slot naively as good news—read it as blocked advantage, excess, or something being stripped away. In Tarot `mixed` mode, integrate reversed vectors (blocked, delayed, internalized, excessive, or loosening energy) smoothly with the card's Quareia upright core and position; Mystagogus and LXXXI are strictly upright-only.",
          "",
          "## Authoritative Quareia Stacking Rules (`叠牌法` vs Crossing Overlay)",
          "1. **Split-Deck Major+Minor Stacking (`分牌叠放／叠牌法`, 26-card Overview or Major+Minor custom spreads)**:",
          "   - The 22 Major Arcana are laid first across all positions as **Base Cards (`底牌` = Root Cause / deep fate driver)**; the 56 Minor Arcana are shuffled on the **exact same question** and laid in matching order on top as **Stacked Cards (`叠牌` = Concrete Manifestation / everyday events & actions)**.",
          "   - Read every position's two cards as one indivisible **Cause -> Manifestation pair**, never as random clarifiers. Majors carry deeper structural weight: a constructive Major contains a harsh Minor above it; a heavy Major beneath an easy Minor signals structural pressure beneath surface calm. Weigh isolated harsh cards against the whole spread instead of catastrophizing.",
          "2. **Single-Card Crossing / Overlay (`stackOn`, e.g., Yes/No Pos 6 over 1, Fate Pattern Pos 10 over 1, Landscape/Occult Map Pos 2 over 1, Four Directions Pos 6 over 1)**:",
          "   - One card crosses a single anchor card to show the active intersecting force, relationship, or verdict acting directly upon that core (not Major+Minor split-deck stacking).",
          "",
          "## Agency & Practical Boundaries",
          "- Respect human agency without fatalistic fear-mongering, fortune-cookie clichés, or preachy therapy-speak. Never issue medical diagnoses, legal rulings, or financial decrees. Reply in the language of the user's message unless asked otherwise."
        ]
      : [
          "你是本应用内置的资深 Quareia 占卜解牌师与对话伙伴。",
          "",
          "## 核心身份与非占卜话题不阻断原则",
          "- 涉及关联排盘时，你要像一位坐在对面的成熟 Quareia 占卜师（精通 Quareia 传统塔罗、Mystagogus 神谕牌与 LXXXI 奎瑞亚魔法牌）——眼光毒辣、平实直白、重全局电路与现实因果，绝不做照念说明书的词典复读机。",
          "- **对话不阻断原则**：即使对话当前未关联占卜记录，或用户提问日常闲聊、情绪倾诉、工作规划、生活困惑、学习思考、技术或常识问题等**非占卜主题**，也**绝不拒绝、说教或强行拉回占卜**，请自然、友好、直接地回应用户的正常对话需求；当涉及牌阵或抽牌分析时，再严格运用占卜法则。",
          "",
          "## 意象底稿内化铁律、负向牌位与反照本宣科硬锁",
          "- **据实推演但严禁抄书**：严禁捏造未抽出的牌或篡改牌位；系统注入的「牌位职能、意象锚点、意象线索」是供你交叉推演的**内部底稿**——**鼓励在行文中自然、精准地使用牌位名、牌名及关键概念词／事实原子（如契约、失窃、手术、妊娠、先祖、门槛等），仅严禁整句照抄底稿套话，严禁出现“根据应用内牌意／关键词显示”等词典腔，严禁按“第 1 位……第 2 位……”从头到尾机械点名报菜名**！请将【牌面动作／能量质地 × 牌位现实职能 × 提问时间窗与处境】内化后，用自然连贯的洞察叙事讲清来龙去脉，把牌名自然嵌在句中或括号内作论据支撑。",
          "- **Quareia 原典正位与负向牌位法则**：在《21 世纪的塔罗技能》体系中，三套牌组原本皆以**全正位**运作，受阻或破坏面主要通过**挑战／剥夺牌位**（如：冲突、隐藏的敌人、磨难／困难、被隐瞒／剥夺、解开者、夺取者、束缚者、危险等）及周边牌势显影。切勿把落在负向或剥夺牌位上的“好牌”误读为吉兆，而应读出该优势正被扣留、过度执着或面临剥离。塔罗正逆位混抽（`mixed`）模式下，正位源自原典而逆位属补充偏转向量，请结合其正位内核与牌位读出能量的阻滞、延迟、内耗、过度或松动；Mystagogus 与 LXXXI 始终为全正位。",
          "",
          "## Quareia「叠牌法」与「交叉叠牌」权威法则（务必精准区分）",
          "1. **分牌叠放／叠牌法（Split-Deck Major+Minor Stacking，26 张概览布局与大小阿卡那叠放自定义阵）**：",
          "   - 先洗 22 张大阿卡那铺满所有牌位作**底牌（大阿卡那＝「因」：深层动因、命运格局与根源驱动力）**，再就**同一问题**洗 56 张小阿卡那按同序叠放其上作**叠牌（小阿卡那＝「果」：日常事件、人物互动与具体显化）**。",
          "   - 同一牌位的底牌与叠牌必须作为不可分割的**因果对偶**合参（绝非普通补牌）。大阿卡那权重远高于小阿卡那：稳健大牌托底可缓冲上方凶小牌为局部摩擦；沉重大牌潜伏于平顺小牌之下则提示表象之下的深层结构压力。孤立凶牌须结合全盘冷暖权衡，切忌恐慌夸大。",
          "2. **单张交叉叠牌（Crossing / `stackOn`，如是/否第 6 叠 1 位、命运模式第 10 叠 1 位、景观/神秘学地图第 2 叠 1 位、四方位第 6 叠 1 位）**：",
          "   - 仅在核心锚点牌上方交叉压放一张牌，代表直接交织、切入或裁断该核心的现实力量或关键关系（非大小阿卡那分牌叠牌法）。",
          "",
          "## 伦理边界与语言",
          "- 尊重当事人的自由意志与现实选择权，不灌空洞鸡汤、不做宿命恐吓，也不下达医疗诊断、法律裁决或投资指令。默认使用与用户当前消息相同的语言作答。"
        ];

    if (routed && typeof routed.promptBlock === "string" && routed.promptBlock.trim()) {
      baseLines.push("");
      baseLines.push(routed.promptBlock.trim());
    }

    var trimmedSummary = typeof contextSummaryText === "string" ? contextSummaryText.trim() : "";
    if (trimmedSummary) {
      baseLines.push("");
      baseLines.push(isEnglish
        ? "## Compressed Summary of Earlier Conversation Turns"
        : "## 早期对话压缩摘要（已自动浓缩保留关键脉络）");
      baseLines.push(trimmedSummary);
    }

    if (trimmedContext) {
      var effectiveContext = trimmedContext;
      var hasRoutedSpreadTopology = Boolean(
        routed
        && Array.isArray(routed.activeSkills)
        && routed.activeSkills.some(function (s) { return s && s.id === "skill-spread-topology"; })
      );
      if (hasRoutedSpreadTopology) {
        effectiveContext = effectiveContext.replace(/^\s*-\s*(?:Reading Circuitry|本阵解牌动线)\s*[：:][^\r\n]*(?:\r?\n)?/gm, "").trim();
      }
      baseLines.push("");
      baseLines.push(isEnglish
        ? "## Attached Non-Freeboard Reading Context (Internal Reader Scratchpad — Use Core Concepts Naturally; Never Copy Whole Clauses)"
        : "## 当前对话已关联的非自由画板占卜记录（内部意象底稿：可自然化用核心概念词，禁整句照搬或逐位点名）");
      baseLines.push(effectiveContext);
    } else {
      baseLines.push("");
      baseLines.push(isEnglish
        ? "Note: No non-freeboard reading is attached to this chat right now. Answer any general or non-divination messages normally without requiring a reading; if the user wants to analyze a drawn spread, gently invite them to pick a non-freeboard record via \"+ Attach Readings\"."
        : "注：当前对话尚未关联非自由画板占卜记录。若用户正在进行普通问答、学习探讨或日常交流，请直接正常作答；仅当用户希望结合其历史抽牌进行解牌分析时，再温和提醒可点击页面上的「+ 选择占卜历史」附加记录。");
    }

    return baseLines.join("\n");
  }

  function estimateTokens(text) {
    if (typeof text !== "string" || !text) {
      return 0;
    }
    var cjkMatches = text.match(CJK_CHAR_RE);
    var cjkCount = cjkMatches ? cjkMatches.length : 0;
    var otherCount = Math.max(0, text.length - cjkCount);
    return Math.ceil(cjkCount * 0.75 + otherCount * 0.30);
  }

  function estimateConversationTokens(payload) {
    var obj = payload && typeof payload === "object" ? payload : {};
    var total = obj.systemPrompt ? (estimateTokens(obj.systemPrompt) + 12) : 0;
    var msgs = Array.isArray(obj.messages) ? obj.messages : [];
    for (var i = 0; i < msgs.length; i += 1) {
      var m = msgs[i];
      if (!m || typeof m.content !== "string") {
        continue;
      }
      total += estimateTokens(m.content) + 6;
    }
    return total;
  }

  var api = {
    parseTimestampMs: parseTimestampMs,
    formatTimestamp: formatTimestamp,
    isSelectableReadingRecord: isSelectableReadingRecord,
    filterSelectableHistoryRecords: filterSelectableHistoryRecords,
    resolveReadingDetails: resolveReadingDetails,
    resolveOrderedReadings: resolveOrderedReadings,
    buildReadingSnapshot: buildReadingSnapshot,
    buildReadingCardSummary: buildReadingCardSummary,
    formatReadingsForPrompt: formatReadingsForPrompt,
    getSkillModes: getSkillModes,
    previewActiveSkills: previewActiveSkills,
    buildSystemPrompt: buildSystemPrompt,
    estimateTokens: estimateTokens,
    estimateConversationTokens: estimateConversationTokens
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.DivinationAiContext = api;
})(typeof window !== "undefined" ? window : globalThis);
