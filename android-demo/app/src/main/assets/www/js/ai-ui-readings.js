(function (global) {
  "use strict";

  // A short "hello, I'm Olivia" reply is not a reading. Only assistant text that
  // actually names cards or spread positions counts as having interpreted the
  // attached reading; otherwise a greeting would silently flip the next turn into
  // follow-up mode and leave the reading uninterpreted.
  function normalizeCardToken(raw) {
    return String(raw == null ? "" : raw)
      .replace(/[*_`「」『』《》〈〉()（）\[\]【】]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // The record itself is the source of truth for "which cards are on the table".
  // Names are localized when the snapshot is built, and some decks (Mystagogus,
  // LXXXI) do not use Rider-Waite names, so matching the actual card names of the
  // record is more reliable than a hard-coded Major Arcana list.
  function collectRecordCardTokens(snapshot, resolved) {
    var tokens = new Set();
    function addNames(card) {
      [card.cardName, card.cardNameZh, card.cardNameEn].forEach(function (name) {
        if (!name) return;
        String(name).split(/[\/|｜]/).forEach(function (part) {
          var token = normalizeCardToken(part).toLowerCase();
          if (token) tokens.add(token);
        });
      });
    }
    if (snapshot && snapshot.cards) snapshot.cards.forEach(addNames);
    if (resolved && resolved.cards) resolved.cards.forEach(addNames);
    return Array.from(tokens);
  }

  function textMentionsCardToken(text, token) {
    if (!text || !token) return false;
    if (/[A-Za-z]/.test(token)) {
      var escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      try {
        return new RegExp("(^|[^A-Za-z0-9])" + escaped + "([^A-Za-z0-9]|$)", "i").test(text);
      } catch (err) {
        return text.toLowerCase().indexOf(token.toLowerCase()) !== -1;
      }
    }
    return text.indexOf(token) !== -1;
  }

  // Short, everyday names ("太阳", "世界", "Sun") are also ordinary vocabulary, so
  // they only count next to another card cue. Long or multi-word names
  // ("Dead End", "命运之轮") are distinctive enough on their own.
  function cardTokenIsDistinctive(token) {
    if (/[A-Za-z]/.test(token)) {
      return / /.test(token) || token.length >= 6;
    }
    return token.length >= 4;
  }

  // Markers that only occur when someone is actually reading cards. Deliberately
  // excludes bare 牌面: a clarification such as "在看牌面之前，你想先聊哪件事？"
  // talks about looking at the cards without having interpreted them.
  function hasStrongReadingMarker(text) {
    if (/正位|逆位|权杖|圣杯|宝剑|星币|大阿卡那|小阿卡那|第[一二三四五六七八九十百零\d]+张|这张牌|那张牌|牌阵|牌位|抽牌|抽到/.test(text)) {
      return true;
    }
    return /\b(?:upright|reversed|wands?|cups?|swords?|pentacles?|major arcana|minor arcana)\b/i.test(text);
  }

  function showsNamedArcanaWithCue(text) {
    var arcanaZh = /愚者|魔术师|女祭司|皇后|皇帝|教皇|恋人|战车|力量|隐士|命运之轮|正义|倒吊人|死神|节制|恶魔|高塔|星星|月亮|太阳|审判|世界/;
    var cueZh = /牌|张|位|抽|阵|正位|逆位/;
    if (arcanaZh.test(text) && cueZh.test(text)) return true;

    var arcanaEn = /\b(?:fool|magician|high priestess|empress|emperor|hierophant|lovers|chariot|strength|hermit|wheel of fortune|justice|hanged man|death|temperance|devil|tower|star|moon|sun|judgement|world)\b/i;
    var cueEn = /\b(?:card|position|slot|draw|spread|upright|reversed|arcana)\b/i;
    return arcanaEn.test(text) && cueEn.test(text);
  }

  function mentionsReadingCard(text, token) {
    if (!textMentionsCardToken(text, token)) return false;
    if (cardTokenIsDistinctive(token)) return true;
    var escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Bind cues to this occurrence. A card in one sentence must not turn a
    // casual reference to the sun/world elsewhere into a second interpretation.
    var name = /[a-z]/i.test(token) ? "\\b" + escaped + "\\b" : escaped;
    var before = "(?:(?:正位|逆位|第[一二三四五六七八九十百零\\d]+张|这张牌)(?:的|是|为|：|:)?\\s*|\\b(?:upright|reversed|card)\\s+(?:the\\s+)?)";
    var after = "(?:在[^。！？；，,\\n]{0,6}位|(?:这张)?牌|正位|逆位|提醒|意味着|象征|代表|提示|指向|暗示|说明|\\s+(?:card|upright|reversed|suggests?|means?|signals?|points? to)\\b)";
    return new RegExp(before + name + "|" + name + after, "i").test(normalizeCardToken(text));
  }

  function assistantMessageShowsReading(content, snapshot) {
    if (typeof content !== "string" || !content.trim()) return false;
    var tokens = collectRecordCardTokens(snapshot);
    if (tokens.length) return tokens.some(function (name) { return mentionsReadingCard(content, name); });
    return hasStrongReadingMarker(content) || showsNamedArcanaWithCue(content);
  }

  // When the same card is in two spreads, scope explicitly numbered passages to
  // the order in the actual request. Unlabelled mentions must identify one record.
  function interpretedRecordIds(text, records, useRequestOrder) {
    var ids = new Set();
    function matchPassage(passage, scope) {
      scope.forEach(function (record) {
        if (record.names.some(function (name) {
          return mentionsReadingCard(passage, name) && !scope.some(function (other) {
            return other !== record && other.names.indexOf(name) !== -1;
          });
        })) ids.add(record.id);
      });
    }
    var labels = /(?:\breading\s*#?\s*(\d+)\b|(?:占卜)?记录\s*(\d+)|第\s*(\d+|[一二三四五六七八九十])\s*(?:条记录|份记录|副牌阵|副牌|个牌阵))/gi;
    var scope = records;
    var start = 0;
    var label;
    while (useRequestOrder && (label = labels.exec(text))) {
      matchPassage(text.slice(start, label.index), scope);
      var raw = label[1] || label[2] || label[3];
      var ordinal = Number(raw) || ("一二三四五六七八九十".indexOf(raw) + 1);
      scope = records[ordinal - 1] ? [records[ordinal - 1]] : [];
      start = labels.lastIndex;
    }
    matchPassage(text.slice(start), scope);
    return Array.from(ids);
  }

  function computeHasUninterpretedReading(conv, uptoIndex, resolvedReadings) {
    if (!conv || !Array.isArray(conv.readingIds) || !conv.readingIds.length) return false;
    var snapshots = new Map((conv.readingSnapshots || []).map(function (snap) { return [snap.id, snap]; }));
    var details = new Map((resolvedReadings || []).map(function (rec) { return [rec.id, rec]; }));
    var records = conv.readingIds.map(function (id) {
      var snap = snapshots.get(id);
      return { id: id, attachedAt: Number(snap && snap.attachedAt) || 0, names: collectRecordCardTokens(snap, details.get(id)) };
    });
    var readIds = new Set();
    (conv.messages || []).slice(0, uptoIndex).forEach(function (msg) {
      if (msg.role !== "assistant" || msg.error || !msg.content) return;
      var eligible = records.filter(function (record) {
        return !record.attachedAt || record.attachedAt <= Number(msg.createdAt);
      });
      // New replies retain the attribution made at completion, even after a tab
      // removes or reorders attachments. Old backups can only use unambiguous names.
      var matched = msg.interpretedReadingIds;
      if (!Array.isArray(matched)) {
        matched = interpretedRecordIds(msg.content, eligible, false);
        if (records.length === 1 && eligible.length && !eligible[0].names.length && assistantMessageShowsReading(msg.content)) {
          matched.push(eligible[0].id);
        }
      }
      eligible.forEach(function (record) { if (matched.indexOf(record.id) !== -1) readIds.add(record.id); });
    });
    return records.some(function (record) { return !readIds.has(record.id); });
  }

  function create(page, helpers) {
    var historyStore = page.historyStore;
    var state = page.state;
    var contextApi = page.contextApi;
    var customLibrary = page.customLibrary;

    function loadSelectableReadings() {
      if (!historyStore) {
        state.selectableReadings = [];
        state.readingsById = Object.create(null);
        return Promise.resolve([]);
      }
      return historyStore.listRecords("all").then(function (allRecords) {
        var selectable = contextApi.filterSelectableHistoryRecords(allRecords);
        var map = Object.create(null);
        for (var i = 0; i < selectable.length; i += 1) {
          map[selectable[i].id] = selectable[i];
        }
        state.selectableReadings = selectable;
        state.readingsById = map;
        return selectable;
      }).catch(function () {
        state.selectableReadings = [];
        state.readingsById = Object.create(null);
        return [];
      });
    }

    function getAttachedRecordsForConversation(conv) {
      if (!conv || !Array.isArray(conv.readingIds)) return [];
      var snapById = Object.create(null);
      (conv.readingSnapshots || []).forEach(function (s) {
        if (s && s.id) {
          snapById[s.id] = s;
        }
      });
      var records = [];
      for (var i = 0; i < conv.readingIds.length; i += 1) {
        var rid = conv.readingIds[i];
        var rec = state.readingsById[rid];
        var snap = snapById[rid];
        if (rec && (!snap || contextApi.resolveReadingDetails(rec, { customLibrary: customLibrary }).spreadFound)) {
          var hasSnapQuestion = Boolean(snap && typeof snap.question === "string");
          if (hasSnapQuestion) {
            records.push(Object.assign({}, rec, { question: snap.question }));
          } else {
            records.push(rec);
          }
          continue;
        }
        if (snap && Array.isArray(snap.cards) && snap.cards.length > 0) {
          records.push(snap);
        }
      }
      return records;
    }

    function buildReadingSnapshots(ids, existingSnapshots) {
      var prevById = Object.create(null);
      var prevList = Array.isArray(existingSnapshots)
        ? existingSnapshots
        : ((state.activeConversation && state.activeConversation.readingSnapshots) || []);
      for (var p = 0; p < prevList.length; p += 1) {
        if (prevList[p] && prevList[p].id) {
          prevById[prevList[p].id] = prevList[p];
        }
      }
      var snaps = [];
      for (var i = 0; i < ids.length; i += 1) {
        var rid = ids[i];
        var rec = state.readingsById[rid];
        if (rec && (!prevById[rid] || contextApi.resolveReadingDetails(rec, { customLibrary: customLibrary }).spreadFound)) {
          var built = contextApi.buildReadingSnapshot(rec, {
            locale: helpers.currentLocale(),
            customLibrary: customLibrary
          });
          if (built) {
            if (prevById[rid]) {
              if (typeof prevById[rid].question === "string") {
                built.question = prevById[rid].question;
              }
              if (Number(prevById[rid].attachedAt) > 0) {
                built.attachedAt = Number(prevById[rid].attachedAt);
              }
            }
            snaps.push(built);
          }
        } else if (prevById[rid]) {
          snaps.push(prevById[rid]);
        }
      }
      return snaps;
    }

    function deriveReadingBaseAndQuestion(readingIds, snapshotsOverride) {
      if (!Array.isArray(readingIds) || readingIds.length === 0) {
        return null;
      }
      var targetId = readingIds[0];
      var firstRec = state.readingsById[targetId] || null;
      var snapList = Array.isArray(snapshotsOverride)
        ? snapshotsOverride
        : ((state.activeConversation && state.activeConversation.readingSnapshots) || []);
      var targetSnap = null;
      for (var s = 0; s < snapList.length; s += 1) {
        if (snapList[s] && snapList[s].id === targetId) {
          targetSnap = snapList[s];
          if (!firstRec) {
            firstRec = snapList[s];
          }
          break;
        }
      }
      if (!firstRec) {
        return null;
      }
      var resolved = contextApi.resolveReadingDetails(firstRec, {
        locale: helpers.currentLocale(),
        customLibrary: customLibrary
      });
      var base = resolved ? resolved.spreadName : (firstRec.spreadName || firstRec.spreadNameSnapshot || "");
      var hasSnapQ = Boolean(targetSnap && typeof targetSnap.question === "string");
      var effectiveQ = hasSnapQ ? targetSnap.question : (firstRec.question || "");
      return {
        base: base || "",
        question: String(effectiveQ || "").trim()
      };
    }

    function deriveAutoTitle(readingIds, firstUserMessage, snapshotsOverride) {
      var info = deriveReadingBaseAndQuestion(readingIds, snapshotsOverride);
      if (info) {
        if (info.question) {
          return (info.base ? info.base + " · " : "") + info.question.slice(0, 24);
        }
        if (info.base) return info.base;
      }
      if (firstUserMessage && firstUserMessage.trim()) {
        return firstUserMessage.trim().replace(/\s+/g, " ").slice(0, 28);
      }
      return "";
    }

    function resolveConversationSkillMode(conv) {
      // direct / deep / action are kept in storage (legacy preferences survive
      // backup + export) but the single persona runs every conversation.
      return "auto";
    }

    function buildPromptPayloadForConversation(conv, uptoIndex, options) {
      var personaLevel = options && options.personaLevel ? options.personaLevel : "full";
      var targetConv = conv || state.activeConversation;
      var locale = helpers.currentLocale();
      var skillMode = resolveConversationSkillMode(targetConv);
      var records = getAttachedRecordsForConversation(targetConv);
      var messages = targetConv && Array.isArray(targetConv.messages) ? targetConv.messages : [];
      var limitIdx = typeof uptoIndex === "number" ? Math.min(messages.length, Math.max(0, uptoIndex)) : messages.length;
      var summaryObj = targetConv && targetConv.contextSummary && targetConv.contextSummary.text
        ? targetConv.contextSummary
        : null;
      var summaryText = "";
      var startIndex = 0;
      var compressedCount = 0;

      if (summaryObj && summaryObj.coveredUntilId) {
        var coveredIdx = -1;
        for (var c = 0; c < limitIdx; c += 1) {
          if (messages[c] && messages[c].id === summaryObj.coveredUntilId) {
            coveredIdx = c;
            break;
          }
        }
        if (coveredIdx !== -1) {
          var postSummaryValid = helpers.normalizeConversationMessagesForApi(messages, coveredIdx + 1, limitIdx);
          if (postSummaryValid.length > 0) {
            summaryText = summaryObj.text;
            startIndex = coveredIdx + 1;
            compressedCount = summaryObj.compressedCount || (coveredIdx + 1);
          }
        }
      }

      var validMessages = helpers.normalizeConversationMessagesForApi(messages, startIndex, limitIdx);
      var apiMessages = validMessages.map(function (item) {
        return { role: item.role, content: item.content };
      });
      var resolvedReadings = typeof contextApi.resolveOrderedReadings === "function"
        ? contextApi.resolveOrderedReadings(records, { locale: locale, customLibrary: customLibrary })
        : null;
      var hasUninterpretedReading = computeHasUninterpretedReading(targetConv, limitIdx, resolvedReadings);
      var readingsMd = contextApi.formatReadingsForPrompt(records, {
        locale: locale,
        customLibrary: customLibrary,
        resolvedReadings: resolvedReadings,
        messages: apiMessages,
        skillMode: skillMode,
        hasUninterpretedReading: hasUninterpretedReading,
        omitCircuitHint: true
      });
      var systemPrompt = contextApi.buildSystemPrompt(locale, readingsMd, summaryText, {
        locale: locale,
        customLibrary: customLibrary,
        records: records,
        resolvedReadings: resolvedReadings,
        messages: apiMessages,
        skillMode: skillMode,
        hasUninterpretedReading: hasUninterpretedReading,
        personaLevel: personaLevel
      });
      var estimatedTokens = contextApi.estimateConversationTokens({
        systemPrompt: systemPrompt,
        messages: apiMessages
      });

      return {
        skillMode: skillMode,
        hasUninterpretedReading: hasUninterpretedReading,
        resolvedReadings: resolvedReadings,
        readingsMd: readingsMd,
        summaryText: summaryText,
        compressedCount: compressedCount,
        validMessages: validMessages,
        apiMessages: apiMessages,
        systemPrompt: systemPrompt,
        estimatedTokens: estimatedTokens
      };
    }

    // The persona prompt is heavy: with a 4K window it alone can exceed the
    // input budget, and truncation would then start dropping recent turns.
    // Fit the persona to the budget first (full -> compact -> none) so short
    // conversations keep their history.
    var PROMPT_PERSONA_LEVELS = ["full", "compact", "none"];

    function buildFittedPayload(conv, uptoIndex, hardCap) {
      var payload;
      for (var i = 0; i < PROMPT_PERSONA_LEVELS.length; i += 1) {
        payload = buildPromptPayloadForConversation(conv, uptoIndex, { personaLevel: PROMPT_PERSONA_LEVELS[i] });
        if (payload.estimatedTokens < hardCap) break;
      }
      return payload;
    }

    return {
      resolveConversationSkillMode: resolveConversationSkillMode,
      getAttachedRecordsForConversation: getAttachedRecordsForConversation,
      computeHasUninterpretedReading: computeHasUninterpretedReading,
      buildReadingSnapshots: buildReadingSnapshots,
      deriveReadingBaseAndQuestion: deriveReadingBaseAndQuestion,
      deriveAutoTitle: deriveAutoTitle,
      buildFittedPayload: buildFittedPayload,
      loadSelectableReadings: loadSelectableReadings
    };
  }

  var api = {
    assistantMessageShowsReading: assistantMessageShowsReading,
    interpretedRecordIds: interpretedRecordIds,
    collectRecordCardTokens: collectRecordCardTokens,
    computeHasUninterpretedReading: computeHasUninterpretedReading,
    create: create
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiReadings = api;
})(typeof window !== "undefined" ? window : globalThis);
