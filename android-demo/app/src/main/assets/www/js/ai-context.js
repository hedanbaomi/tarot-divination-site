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

      return {
        index: index,
        slotIndex: parsedSlotIndex !== null ? parsedSlotIndex : Math.max(0, positionNumber - 1),
        cardId: entry.cardId,
        cardName: cardName,
        arcana: rawArcana,
        suit: (cardObj && cardObj.suit) || entry.suit || "",
        orientation: isReversed ? "reversed" : "upright",
        orientationLabel: orientationLabel,
        positionNumber: positionNumber,
        positionName: positionName,
        positionMeaning: positionMeaning,
        stackOn: stackOn,
        layer: layer,
        layerLabel: layerLabel,
        keywords: keywords,
        meaning: meaning,
        uprightMeaningRef: uprightMeaningRef,
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
      spreadDescription: spreadDescription,
      spreadSource: spreadSource,
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
      return {
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

  function formatCardDetailLine(c, prefix, isEnglish) {
    var parts = [];
    var sep = isEnglish ? ", " : "、";
    parts.push(prefix + "**" + c.cardName + "** (" + c.orientationLabel + ")");
    if (c.keywords && c.keywords.length > 0) {
      parts.push((isEnglish ? "Keywords: " : "关键词：") + c.keywords.join(sep));
    }
    if (c.meaning) {
      parts.push((isEnglish ? "In-App Meaning: " : "应用内牌意：") + c.meaning);
    } else {
      parts.push(isEnglish
        ? "In-App Meaning: (Snapshot name only)"
        : "应用内牌意：（仅保留牌名快照）");
    }
    if (c.uprightMeaningRef) {
      parts.push((isEnglish ? "Quareia Upright Core Reference: " : "Quareia 正位内核参考：") + c.uprightMeaningRef);
    }
    return parts.join(" | ");
  }

  function formatSingleReadingMarkdown(resolved, index, total) {
    var isEnglish = resolved.locale === "en";
    var lines = [];
    var headerPrefix = total > 1
      ? (isEnglish ? ("### Reading " + (index + 1) + ": ") : ("### 占卜记录 " + (index + 1) + "："))
      : (isEnglish ? "### Reading Context: " : "### 占卜记录上下文：");
    lines.push(headerPrefix + resolved.spreadName);
    lines.push("- " + (isEnglish ? "Reading ID" : "记录 ID") + ": " + resolved.id);
    lines.push("- " + (isEnglish ? "Time" : "占卜时间") + ": " + resolved.formattedTime);
    if (resolved.question) {
      lines.push("- " + (isEnglish ? "Question" : "占卜问题") + ": " + resolved.question);
    }
    lines.push("- " + (isEnglish ? "Deck" : "牌组") + ": " + resolved.deckName);
    lines.push("- " + (isEnglish ? "Orientation Mode" : "正逆位模式") + ": " + resolved.orientationModeLabel);
    lines.push("- " + (isEnglish ? "Spread" : "牌阵") + ": " + resolved.spreadName + " (`" + resolved.spreadId + "`)");

    if (resolved.isSplitDeckStacked) {
      lines.push("- " + (isEnglish
        ? "Draw Method: Split-Deck Major+Minor Stacking (叠牌法 — First shuffle the 22 Major Arcana on the question and lay them across all positions as BASE cards representing underlying CAUSE / fate forces; then shuffle the 56 Minor Arcana on the same question and lay them in matching order ON TOP as STACKED cards representing concrete MANIFESTATION / effect. Read each position's Base Major + Stacked Minor strictly as a unified Cause -> Manifestation pair.)"
        : "抽牌方式：分牌叠放／叠牌法（Quareia Split-Deck Stacking — 先就同一问题洗 22 张大阿卡那依次铺作「底牌（因 / 深层动因与格局力量）」，再就同一问题洗 56 张小阿卡那按完全相同牌位顺序叠放其上作「叠牌（果 / 现实事件、人物与具体显化）」。每个牌位的底牌与叠牌必须作为「因→果」整体合参，不可拆成孤立单牌或普通补牌）"));
    }

    if (resolved.spreadDescription) {
      lines.push("- " + (isEnglish ? "Spread Overview" : "牌阵说明") + ": " + resolved.spreadDescription);
    }
    if (resolved.spreadSource) {
      lines.push("- " + (isEnglish ? "Spread Source" : "牌阵出处") + ": " + resolved.spreadSource);
    }
    if (resolved.spreadId === "overview") {
      lines.push("- " + (isEnglish
        ? "Overview Structural Polarity & Cross-Links: Upper row Pos 1-6 (Home, Relationships, Creativity, Fate Cycle, Health, Gifts) = constructive/supportive polarity; Lower row Pos 7-12 (Conflict, Hidden Enemies, Ordeal, Resources, Unraveller, Taker) = tension/challenge polarity; Pos 13 = Path Ahead. Key paired axes: 1↔7, 2↔8, 3↔10 (mundane/survival), 4↔9 (fate lessons), 6↔11 (gifts vs voluntary release), 5↔12 (health vs involuntary removal; acting consciously on 11 relieves pressure on 12 & 5)."
        : "概览布局结构对照：上排 1–6 位（家庭、关系、创造力、当前命运循环、健康、礼物）属建设性／支撑极；下排 7–12 位（冲突、隐藏的敌人、磨难、资源、解开者、夺取者）属张力／考验极；13 位为前方的道路。核心交叉联动：1(家庭)↔7(冲突)、2(关系)↔8(隐藏的敌人)、3(创造力)↔10(资源，日常生存轴)、4(当前命运循环)↔9(磨难，命运功课轴)、6(礼物)↔11(解开者，须主动识别放下的执念/弱点)、5(健康)↔12(夺取者，命运被动剥离；主动修习11位可减轻12位剥离并护持5位健康)。"));
    }
    if (!resolved.spreadFound) {
      lines.push("- " + (isEnglish
        ? "Note: Full custom spread definition is unavailable on this device; saved position name snapshots are used below."
        : "注：当前会话未加载该自定义牌阵完整定义，以下使用历史记录保存的牌位名称快照。"));
    }

    lines.push("");
    lines.push(isEnglish ? "#### Drawn Cards & In-App Meanings" : "#### 抽牌结果与应用内牌意");

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
          lines.push("  - " + (isEnglish ? "Position Meaning" : "牌位含义") + ": " + grp.positionMeaning);
        }
        for (var e = 0; e < grp.entries.length; e += 1) {
          var sub = grp.entries[e];
          var tag = sub.layerLabel ? ("[" + sub.layerLabel + "] ") : "";
          lines.push("  - " + formatCardDetailLine(sub, tag, isEnglish));
        }
      }
      return lines.join("\n");
    }

    for (var k = 0; k < resolved.cards.length; k += 1) {
      var c = resolved.cards[k];
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
        lines.push("  - " + (isEnglish ? "Position Meaning" : "牌位含义") + ": " + c.positionMeaning);
      }
      if (c.keywords && c.keywords.length > 0) {
        var sep = isEnglish ? ", " : "、";
        lines.push("  - " + (isEnglish ? "In-App Keywords" : "牌面关键词") + ": " + c.keywords.join(sep));
      }
      if (c.meaning) {
        lines.push("  - " + (isEnglish ? "In-App Card Meaning" : "应用内牌意") + ": " + c.meaning);
      } else {
        lines.push("  - " + (isEnglish ? "In-App Card Meaning" : "应用内牌意") + ": " + (isEnglish ? "(Snapshot name only)" : "（未匹配到完整牌义，仅保留牌名快照）"));
      }
      if (c.uprightMeaningRef) {
        lines.push("  - " + (isEnglish ? "Quareia Upright Core Reference" : "Quareia 正位内核参考") + ": " + c.uprightMeaningRef);
      }
    }
    return lines.join("\n");
  }

  function formatReadingsForPrompt(records, options) {
    if (!Array.isArray(records) || records.length === 0) {
      return "";
    }
    var ordered = [];
    for (var i = 0; i < records.length; i += 1) {
      if (isSelectableReadingRecord(records[i])) {
        ordered.push(records[i]);
      }
    }
    if (ordered.length === 0) {
      return "";
    }
    var sections = [];
    for (var j = 0; j < ordered.length; j += 1) {
      var resolved = resolveReadingDetails(ordered[j], options);
      if (resolved) {
        sections.push(formatSingleReadingMarkdown(resolved, j, ordered.length));
      }
    }
    return sections.join("\n\n---\n\n");
  }

  function buildSystemPrompt(locale, readingsMarkdown, contextSummaryText) {
    var isEnglish = locale === "en";
    var baseLines = isEnglish
      ? [
          "You are the built-in Quareia Divination & Reading Assistant for this application.",
          "",
          "## Core Role & Non-Blocking Conversation Principle",
          "- Your primary specialty is helping the user interpret divination readings attached to this conversation accurately, constructively, and faithfully to the in-app decks (Quareia Traditional Tarot, Mystagogus Oracle, and LXXXI Magical Deck).",
          "- **Non-blocking rule**: NEVER refuse, block, scold, or force-redirect benign non-divination topics (such as everyday conversation, emotional reflection, career/study planning, writing, technical questions, or general Q&A), whether or not a reading is attached. Respond naturally, clearly, and helpfully to whatever the user brings up.",
          "",
          "## In-App Meanings, Upright-Only Negative Positions & Reversed Tarot Provenance",
          "- Whenever analyzing cards from an attached reading, anchor your reading strictly in the injected in-app card keywords, card meanings, and spread position meanings. Never fabricate cards or positions that were not drawn.",
          "- **Quareia Upright-Only Negative Positions**: In Josephine McCarthy's *Tarot Skills for the 21st Century*, Tarot is natively read upright-only; difficult, blocked, or destructive meanings emerge from **challenging spread positions** (e.g., Conflict, Hidden Enemies, Difficulties/Ordeal, Withheld/Taken Away, Unraveller, Taker) and surrounding pressure. Never read a benign upright card in a challenging position naively as good news—translate it into friction or loss within that sphere.",
          "- **Reversed Tarot Meanings (`mixed` mode)**: Upright Tarot meanings in this app come from the Quareia Tarot reference book, whereas **reversed Tarot meanings are web-sourced supplementary meanings** provided when a user selects upright+reversed mode. When a Tarot card is reversed, integrate the injected reversed meaning smoothly with the card's Quareia core function and its spread position (indicating blocked, delayed, internalized, excessive, or inverted energy). Mystagogus and LXXXI are strictly upright-only.",
          "",
          "## Authoritative Quareia Stacking Rules (`叠牌法` vs Crossing Overlay)",
          "You must distinguish two completely different mechanisms:",
          "1. **Split-Deck Major+Minor Stacking (`分牌叠放／叠牌法`, 26-card Overview or Major+Minor spreads)**:",
          "   - The 22 Major Arcana and 56 Minor Arcana are separated into two piles. First, the 22 Major Arcana are shuffled on the question and laid across all positions (**Base / Lower Card = Major Arcana**). Second, the 56 Minor Arcana are shuffled on the **exact same question** and laid in the same order **on top of** each Major card (**Stacked / Upper Card = Minor Arcana**).",
          "   - This is NOT random clarifier pulling. Every position's two cards MUST be read together as a single **Cause -> Manifestation causal pair**:",
          "     - **Base Card (Major Arcana) = Root Cause (`因`)**: underlying archetypal force, fate pattern, or deep structural driver behind that position.",
          "     - **Stacked Card (Minor Arcana) = Concrete Manifestation (`果`)**: how that deeper force plays out tangibly in day-to-day events, circumstances, people, or actions.",
          "   - **Weighting**: Majors carry deeper structural authority than Minors. A constructive Major tempers and contains a harsh Minor above it; an ominous Major beneath an easy Minor signals deeper pressure beneath surface calm. Always weigh isolated difficult cards against the overall balance of the spread.",
          "2. **Single-Card Crossing / Overlay (e.g., Yes/No Pos 6 over Pos 1, Fate Pattern Pos 10 over Pos 1, Landscape/Occult Map Pos 2 over Pos 1, Four Directions Pos 6 over Pos 1)**:",
          "   - One card crosses/overlays a single anchor position to show the active intersecting influence, relationship, or verdict acting directly upon that core card (this is NOT Major+Minor split-deck stacking).",
          "",
          "## Style & Language",
          "- Synthesize structural patterns and causal links before offering balanced, non-fatalistic reflection that respects human agency. Avoid medical, legal, or financial decrees.",
          "- Reply in the language of the user's message unless asked otherwise."
        ]
      : [
          "你是本应用内置的 Quareia 占卜辅助解牌与对话助手。",
          "",
          "## 核心身份与非占卜话题不阻断原则",
          "- 你的核心专长是结合应用内牌组（Quareia 传统塔罗、Mystagogus 神谕牌、LXXXI 奎瑞亚魔法牌）的内置牌意与牌阵结构，帮助用户客观、深入地解读所关联的占卜记录。",
          "- **对话不阻断原则**：即使对话当前未关联占卜记录，或用户提问日常闲聊、情绪倾诉、工作规划、生活困惑、学习思考、技术或常识问题等**非占卜主题**，也**绝不拒绝、说教或强行拉回占卜**，请自然、友好、直接地回应用户的正常对话需求；当涉及牌阵或抽牌分析时，再严格运用下方占卜法则。",
          "",
          "## 应用内牌意依据、负向牌位与正逆位出处规则",
          "- 解读关联记录时，必须严格以系统注入的「牌位含义、关键词、应用内牌意」为依据，严禁捏造未抽出的牌或擅自篡改牌位。",
          "- **Quareia 原典正位与负向牌位法则**：在 Josephine McCarthy《21 世纪的塔罗技能》体系中，塔罗与 M 牌／LXXXI 原本皆以**全正位**解读，困难或受阻含义主要通过**挑战性／负向牌位**（如：冲突、隐藏的敌人、磨难／困难、被隐瞒／剥夺、解开者、夺取者、危险等）及周边牌组格局来体现。切勿把落在负向牌位上的“正位吉牌”简单误读为好事，而应读出该面向正在出现失衡、过度消耗或摩擦。",
          "- **正逆位出处差异（正逆位混抽模式）**：本应用中**塔罗正位牌意出自《21 世纪的塔罗技能》参考体系**，而**塔罗逆位牌意为网络获取的补充牌意**（仅在塔罗正逆位混抽时生效；Mystagogus 与 LXXXI 始终为全正位）。遇到塔罗逆位牌时，请将注入的逆位补充牌意与该牌核心原型、所处牌位含义有机整合（通常指向能量的阻塞、延迟、内化、过度或反转显化）。",
          "",
          "## Quareia「叠牌法」与「交叉叠牌」权威法则（务必精准区分）",
          "1. **分牌叠放／叠牌法（Split-Deck Major+Minor Stacking，常见于 26 张概览布局与大小阿卡那叠放自定义阵）**：",
          "   - 操作方式：将 22 张大阿卡那与 56 张小阿卡那**分开**；先就问题洗 22 张大阿卡那铺满所有牌位作为**底牌（大阿卡那）**，再就**完全同一问题**洗 56 张小阿卡那按相同牌位顺序一一叠放其上作为**叠牌（小阿卡那）**。",
          "   - 实质意义：这**不是**普通塔罗里“再抽一张补牌解释”。同一牌位的两张牌必须合参为一个不可分割的**因果对偶**：",
          "     - **底牌（大阿卡那）＝「因」**：决定该生活面向走向的深层动因、宿命／命运驱动力、原型与根源结构。",
          "     - **叠牌（小阿卡那）＝「果」**：该深层动因在现实事件、人物互动、具体行为或日常事务中的具体显化方式。",
          "   - **权重与制衡法则**：大阿卡那权重远高于小阿卡那。积极建设性的大阿卡那底牌会缓冲并收敛上方困难的小阿卡那（多属局部可控摩擦）；严厉或动荡的大阿卡那底牌下方即使表面小牌尚可，也提示更深层的结构压力。单处凶险组合理应结合周边整体格局权衡，避免孤立夸大灾祸。",
          "2. **单张交叉叠牌（Crossing / `stackOn`，如是/否布局第 6 位叠第 1 位、命运模式第 10 位叠第 1 位、景观/神秘学地图第 2 位叠第 1 位、四方位第 6 位叠第 1 位）**：",
          "   - 实质意义：仅在单个核心锚点牌位上方交叉压放一张牌，表示直接交织、裁断或作用于该核心的当前关键力量或关系（并非大小阿卡那分牌叠牌法）。",
          "",
          "## 解读风格",
          "- 表达清晰有条理，先抓整体格局与核心因果联动，再落到逐位解析与可行的现实反思；尊重当事人的自由意志，不做宿命式恐吓，也不下达医疗、法律或投资决策结论。",
          "- 默认使用与用户当前消息相同的语言作答。"
        ];

    var trimmedSummary = typeof contextSummaryText === "string" ? contextSummaryText.trim() : "";
    if (trimmedSummary) {
      baseLines.push("");
      baseLines.push(isEnglish
        ? "## Compressed Summary of Earlier Conversation Turns"
        : "## 早期对话压缩摘要（已自动浓缩保留关键脉络）");
      baseLines.push(trimmedSummary);
    }

    var trimmedContext = typeof readingsMarkdown === "string" ? readingsMarkdown.trim() : "";
    if (trimmedContext) {
      baseLines.push("");
      baseLines.push(isEnglish
        ? "## Attached Non-Freeboard Reading Context (In-App Meanings)"
        : "## 当前对话已关联的非自由画板占卜记录（含牌位与应用内牌意）");
      baseLines.push(trimmedContext);
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
    buildReadingSnapshot: buildReadingSnapshot,
    buildReadingCardSummary: buildReadingCardSummary,
    formatReadingsForPrompt: formatReadingsForPrompt,
    buildSystemPrompt: buildSystemPrompt,
    estimateTokens: estimateTokens,
    estimateConversationTokens: estimateConversationTokens
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.DivinationAiContext = api;
})(typeof window !== "undefined" ? window : globalThis);
