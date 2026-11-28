(function (root, factory) {
  "use strict";

  var defaultDeps = {
    historyRecords: root && root.DivinationHistoryRecords,
    historyStore: root && root.DivinationHistoryStore,
    cardNotesStore: root && root.DivinationCardNotesStore,
    customSpreads: root && root.DivinationCustomSpreads,
    aiChatStore: root && root.DivinationAiChatStore,
    theme: root && root.DivinationTheme,
    i18n: root && root.DivinationI18n
  };
  if (typeof module !== "undefined" && module.exports) {
    try { defaultDeps.historyRecords = defaultDeps.historyRecords || require("./history-records.js"); } catch (_e) {}
    try { defaultDeps.historyStore = defaultDeps.historyStore || require("./history-store.js"); } catch (_e) {}
    try { defaultDeps.cardNotesStore = defaultDeps.cardNotesStore || require("./card-notes-store.js"); } catch (_e) {}
    try { defaultDeps.customSpreads = defaultDeps.customSpreads || require("./custom-spreads.js"); } catch (_e) {}
    try { defaultDeps.aiChatStore = defaultDeps.aiChatStore || require("./ai-chat-store.js"); } catch (_e) {}
  }

  var api = factory(root, defaultDeps);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DivinationFullBackup = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, defaultDeps) {
  "use strict";

  var BACKUP_FORMAT = "quareia-full-backup";
  var BACKUP_VERSION = 1;
  var MAX_BACKUP_BYTES = 16 * 1024 * 1024;
  var SECTION_KEYS = Object.freeze(["history", "cardNotes", "customSpreads", "aiChats", "preferences"]);
  var VALID_THEMES = Object.freeze([
    "celestial",
    "parchment",
    "ember",
    "grove",
    "grove-light",
    "jade",
    "dusk",
    "ash"
  ]);
  var VALID_LOCALES = Object.freeze(["zh-CN", "en"]);
  var CUSTOM_SPREADS_FORMAT = "quareia-custom-spreads";
  var CUSTOM_SPREADS_VERSION = 1;
  var CARD_NOTES_FORMAT = "divination-card-notes";
  var CARD_NOTES_VERSION = 1;
  var AI_CHATS_FORMAT = "quareia-ai-chats-backup";
  var AI_CHATS_VERSION = 1;
  var DEFAULT_HISTORY_MAX_BYTES = 5 * 1024 * 1024;
  var DEFAULT_AI_CHATS_MAX_BYTES = 8 * 1024 * 1024;
  var DEFAULT_CUSTOM_SPREADS_MAX_SIZE = 50;
  var MAX_VALID_DATE_MS = 8640000000000000;
  var DEFAULT_THEME_STORAGE_KEY = "quareia-divination-theme";
  var DEFAULT_LOCALE_STORAGE_KEY = "quareia-divination-locale";

  var ENVELOPE_KEYS = ["format", "version", "exportedAt", "sections"];
  var HISTORY_ENVELOPE_KEYS = ["formatVersion", "exportedAt", "records"];
  var CARD_NOTES_ENVELOPE_KEYS = ["format", "version", "notes"];
  var CARD_NOTE_ROW_KEYS = ["deckType", "cardId", "text"];
  var CUSTOM_SPREADS_ENVELOPE_KEYS = ["format", "version", "codes"];
  var AI_CHATS_ENVELOPE_KEYS = ["format", "version", "exportedAt", "conversations"];
  var PREFERENCES_KEYS = ["theme", "locale"];

  var AI_CONVERSATION_KEYS = [
    "id",
    "title",
    "createdAt",
    "updatedAt",
    "archived",
    "pinned",
    "profileId",
    "skillMode",
    "readingIds",
    "readingSnapshots",
    "messages",
    "contextSummary",
    "lastUsage"
  ];
  var AI_SNAPSHOT_KEYS = [
    "id",
    "layoutMode",
    "deckType",
    "spreadId",
    "spreadName",
    "spreadNameSnapshot",
    "spreadDescription",
    "spreadSource",
    "positionCount",
    "orientationMode",
    "filterMode",
    "overviewMethod",
    "createdAt",
    "question",
    "cards",
    "attachedAt"
  ];
  var AI_SNAPSHOT_CARD_KEYS = [
    "slotIndex",
    "positionNumber",
    "positionName",
    "positionMeaning",
    "cardId",
    "cardName",
    "orientation",
    "arcana",
    "suit",
    "layer",
    "stackOn",
    "column",
    "row",
    "offsetX",
    "offsetY"
  ];
  var AI_MESSAGE_KEYS = [
    "id",
    "role",
    "content",
    "reasoning",
    "model",
    "format",
    "createdAt",
    "error",
    "interpretedReadingIds"
  ];
  var AI_CONTEXT_SUMMARY_KEYS = ["text", "coveredUntilId", "compressedCount", "updatedAt"];
  var AI_LAST_USAGE_KEYS = ["inputTokens", "outputTokens", "totalTokens", "updatedAt"];
  var VALID_SKILL_MODES = ["auto", "direct", "deep", "action"];

  var FORBIDDEN_KEYS_LOWER = Object.create(null);
  [
    "__proto__",
    "constructor",
    "prototype",
    "apikey",
    "apikeys",
    "api_key",
    "api_keys",
    "provider",
    "providers",
    "profile",
    "profiles",
    "endpoint",
    "endpoints",
    "baseurl",
    "base_url",
    "token",
    "tokens",
    "accesstoken",
    "access_token",
    "refreshtoken",
    "refresh_token",
    "idtoken",
    "id_token",
    "bearertoken",
    "bearer_token",
    "secret",
    "secrets",
    "clientsecret",
    "client_secret",
    "password",
    "passwd",
    "authorization",
    "x-api-key",
    "x-goog-api-key",
    "aiconfig",
    "ai_config"
  ].forEach(function (key) {
    FORBIDDEN_KEYS_LOWER[key] = true;
  });

  var BUILTIN_KNOWN_CARDS = null;

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function ownKeys(obj) {
    if (typeof Reflect !== "undefined" && typeof Reflect.ownKeys === "function") {
      return Reflect.ownKeys(obj);
    }
    var keys = Object.getOwnPropertyNames(obj);
    if (typeof Object.getOwnPropertySymbols === "function") {
      keys = keys.concat(Object.getOwnPropertySymbols(obj));
    }
    return keys;
  }

  function createError(code, message) {
    var err = new Error(message);
    err.code = code || "invalid_backup";
    return err;
  }

  function fail(path, message, code) {
    throw createError(code || "invalid_backup", path + ": " + message);
  }

  function isForbiddenKey(key) {
    if (typeof key !== "string") return true;
    return FORBIDDEN_KEYS_LOWER[key.toLowerCase()] === true;
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    var proto = Object.getPrototypeOf(value);
    if (proto === null || proto === Object.prototype) return true;
    if (Object.prototype.toString.call(value) !== "[object Object]") return false;
    return typeof proto.constructor === "function" &&
      Function.prototype.toString.call(proto.constructor) === Function.prototype.toString.call(Object);
  }

  function assertPlainObject(value, path) {
    if (!isPlainObject(value)) fail(path, "must be a plain object");
  }

  function assertArrayNoHoles(value, path) {
    if (!Array.isArray(value)) fail(path, "must be an array");
    var keys = ownKeys(value);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (key === "length") continue;
      if (typeof key !== "string" || !/^\d+$/.test(key) || String(Number(key)) !== key || Number(key) >= value.length) {
        fail(path, "contains unexpected array property " + String(key));
      }
    }
    for (var idx = 0; idx < value.length; idx += 1) {
      if (!hasOwn(value, idx)) fail(path, "must not contain holes");
    }
  }

  function assertOnlyKeys(value, allowed, path) {
    var allowedSet = Object.create(null);
    for (var i = 0; i < allowed.length; i += 1) {
      allowedSet[allowed[i]] = true;
    }
    var keys = ownKeys(value);
    for (var k = 0; k < keys.length; k += 1) {
      var key = keys[k];
      if (typeof key !== "string") fail(path, "contains non-string key");
      if (isForbiddenKey(key)) fail(path, "contains forbidden key " + key, "forbidden_key");
      if (!allowedSet[key]) fail(path, "contains unexpected key " + key);
    }
  }

  function assertExactKeys(value, required, path) {
    assertOnlyKeys(value, required, path);
    for (var i = 0; i < required.length; i += 1) {
      if (!hasOwn(value, required[i])) {
        fail(path, "missing required field " + required[i]);
      }
    }
  }

  function assertIsoDate(value, path) {
    if (typeof value !== "string" || value.length < 20 || value.length > 30) {
      fail(path, "must be a canonical ISO timestamp");
    }
    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      fail(path, "must be a canonical ISO timestamp");
    }
  }

  function utf8ByteLength(text) {
    if (typeof text !== "string") return 0;
    var bytes = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff &&
          i + 1 < text.length &&
          text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function exceedsUtf8ByteLimit(text, maxBytes) {
    if (typeof text !== "string") return true;
    if (text.length > maxBytes) return true;
    var bytes = 0;
    for (var i = 0; i < text.length; i += 1) {
      var code = text.charCodeAt(i);
      if (code < 0x80) {
        bytes += 1;
      } else if (code < 0x800) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff &&
          i + 1 < text.length &&
          text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
      if (bytes > maxBytes) return true;
    }
    return false;
  }

  function scanTreeSecurity(node, path, seen) {
    if (node === null || typeof node !== "object") return;
    if (seen.has(node)) fail(path, "must not contain circular references");
    seen.add(node);

    if (Array.isArray(node)) {
      assertArrayNoHoles(node, path);
      for (var i = 0; i < node.length; i += 1) {
        scanTreeSecurity(node[i], path + "[" + i + "]", seen);
      }
      return;
    }

    assertPlainObject(node, path);
    var keys = ownKeys(node);
    for (var k = 0; k < keys.length; k += 1) {
      var key = keys[k];
      if (typeof key !== "string") fail(path, "contains non-string key");
      if (isForbiddenKey(key)) fail(path, "contains forbidden key " + key, "forbidden_key");
      scanTreeSecurity(node[key], path + "." + key, seen);
    }
  }

  function safeClone(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value.map(safeClone);
    }
    var out = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      out[key] = safeClone(value[key]);
    }
    return out;
  }

  function resolveDep(adapters, adapterKey, globalName, fallbackKey) {
    if (adapters && hasOwn(adapters, adapterKey)) {
      return adapters[adapterKey];
    }
    if (root && globalName && root[globalName]) {
      return root[globalName];
    }
    return fallbackKey ? defaultDeps[fallbackKey] : null;
  }

  function getBuiltinKnownCards() {
    if (BUILTIN_KNOWN_CARDS) return BUILTIN_KNOWN_CARDS;
    var set = Object.create(null);
    var i;
    var num;
    for (i = 0; i <= 21; i += 1) {
      num = i < 10 ? "0" + i : String(i);
      set["tarot/major-" + num] = true;
    }
    var suits = ["wands", "cups", "swords", "pentacles"];
    var ranks = [
      "ace", "two", "three", "four", "five", "six", "seven",
      "eight", "nine", "ten", "page", "knight", "queen", "king"
    ];
    for (var s = 0; s < suits.length; s += 1) {
      for (var r = 0; r < ranks.length; r += 1) {
        set["tarot/minor-" + suits[s] + "-" + ranks[r]] = true;
      }
    }
    for (i = 1; i <= 78; i += 1) {
      num = i < 10 ? "0" + i : String(i);
      set["mystagogus/m-" + num] = true;
    }
    for (i = 1; i <= 81; i += 1) {
      num = i < 10 ? "0" + i : String(i);
      set["lxxxi/lxxxi-" + num] = true;
    }
    BUILTIN_KNOWN_CARDS = set;
    return set;
  }

  function readGlobalDeck(lexicalValue, propName) {
    if (Array.isArray(lexicalValue) && lexicalValue.length > 0) return lexicalValue;
    if (root && Array.isArray(root[propName]) && root[propName].length > 0) return root[propName];
    return null;
  }

  function resolveIsKnownCard(validators) {
    if (validators && typeof validators.isKnownCard === "function") {
      return validators.isKnownCard;
    }
    if (validators && validators.cardNotes && typeof validators.cardNotes.isKnownCard === "function") {
      return validators.cardNotes.isKnownCard;
    }
    var decksSource = validators && isPlainObject(validators.decks) ? validators.decks : null;
    if (!decksSource) {
      var tDeck = readGlobalDeck(typeof tarotDeckFull !== "undefined" ? tarotDeckFull : null, "tarotDeckFull");
      var mDeck = readGlobalDeck(typeof mystagogusDeckFull !== "undefined" ? mystagogusDeckFull : null, "mystagogusDeckFull");
      var lDeck = readGlobalDeck(typeof lxxxiDeckFull !== "undefined" ? lxxxiDeckFull : null, "lxxxiDeckFull");
      if (tDeck && mDeck && lDeck) {
        decksSource = { tarot: tDeck, mystagogus: mDeck, lxxxi: lDeck };
      }
    }
    if (decksSource) {
      var catalog = Object.create(null);
      var deckKeys = Object.keys(decksSource);
      for (var d = 0; d < deckKeys.length; d += 1) {
        var deckName = deckKeys[d];
        var cards = decksSource[deckName];
        if (!Array.isArray(cards)) continue;
        for (var c = 0; c < cards.length; c += 1) {
          if (cards[c] && typeof cards[c].id === "string" && cards[c].id.length > 0) {
            catalog[deckName + "/" + cards[c].id] = true;
          }
        }
      }
      return function (deckType, cardId) {
        return typeof deckType === "string" && typeof cardId === "string" &&
          catalog[deckType + "/" + cardId] === true;
      };
    }
    var builtin = getBuiltinKnownCards();
    return function (deckType, cardId) {
      return typeof deckType === "string" && typeof cardId === "string" &&
        builtin[deckType + "/" + cardId] === true;
    };
  }

  function parseStrictTimestampMs(value) {
    var ms = NaN;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0 || value > MAX_VALID_DATE_MS) return NaN;
      ms = value;
    } else if (typeof value === "string") {
      var trimmed = value.trim();
      if (!trimmed) return NaN;
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
        var num = Number(trimmed);
        if (!Number.isFinite(num) || num < 0 || num > MAX_VALID_DATE_MS) return NaN;
        ms = num;
      } else {
        var parsed = Date.parse(trimmed);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_VALID_DATE_MS) return NaN;
        ms = parsed;
      }
    } else {
      return NaN;
    }
    var date = new Date(ms);
    if (Number.isNaN(date.getTime())) return NaN;
    try {
      date.toISOString();
    } catch (_error) {
      return NaN;
    }
    return ms;
  }

  function validateAiTimestamp(value, path, allowZero) {
    var ms = parseStrictTimestampMs(value);
    if (!Number.isFinite(ms) || ms < 0 || ms > MAX_VALID_DATE_MS || (!allowZero && ms === 0)) {
      fail(path, "must be a valid timestamp");
    }
    return ms;
  }

  function validateAiSnapshotCard(card, path) {
    assertPlainObject(card, path);
    assertOnlyKeys(card, AI_SNAPSHOT_CARD_KEYS, path);
    var stringFields = ["positionName", "positionMeaning", "cardId", "cardName", "orientation", "arcana", "suit", "layer"];
    for (var i = 0; i < stringFields.length; i += 1) {
      var f = stringFields[i];
      if (hasOwn(card, f) && typeof card[f] !== "string") {
        fail(path + "." + f, "must be a string");
      }
    }
    var hasCardId = typeof card.cardId === "string" && card.cardId.trim().length > 0;
    var hasCardName = typeof card.cardName === "string" && card.cardName.trim().length > 0;
    if (!hasCardId && !hasCardName) {
      fail(path, "must include cardId or cardName");
    }
    if (hasOwn(card, "slotIndex") && card.slotIndex !== null) {
      if (typeof card.slotIndex !== "number" || !Number.isInteger(card.slotIndex) || card.slotIndex < 0) {
        fail(path + ".slotIndex", "must be a non-negative integer");
      }
    }
    if (hasOwn(card, "positionNumber") && card.positionNumber !== null) {
      if (typeof card.positionNumber !== "number" || !Number.isInteger(card.positionNumber) || card.positionNumber < 1) {
        fail(path + ".positionNumber", "must be a positive integer");
      }
    }
    var numericFields = ["stackOn", "column", "row", "offsetX", "offsetY"];
    for (var n = 0; n < numericFields.length; n += 1) {
      var nf = numericFields[n];
      if (hasOwn(card, nf) && (typeof card[nf] !== "number" || !Number.isFinite(card[nf]))) {
        fail(path + "." + nf, "must be a finite number");
      }
    }
  }

  function validateAiSnapshot(snap, path) {
    assertPlainObject(snap, path);
    assertOnlyKeys(snap, AI_SNAPSHOT_KEYS, path);
    var stringFields = [
      "id", "layoutMode", "deckType", "spreadId", "spreadName", "spreadNameSnapshot",
      "spreadDescription", "spreadSource", "orientationMode", "filterMode",
      "overviewMethod", "question"
    ];
    for (var i = 0; i < stringFields.length; i += 1) {
      var f = stringFields[i];
      if (hasOwn(snap, f) && typeof snap[f] !== "string") {
        fail(path + "." + f, "must be a string");
      }
    }
    if (!hasOwn(snap, "id") || !snap.id.trim()) {
      fail(path + ".id", "must be a non-empty string");
    }
    if (hasOwn(snap, "layoutMode") && snap.layoutMode !== "" && snap.layoutMode !== "preset") {
      fail(path + ".layoutMode", "unsupported layoutMode in AI reading snapshot");
    }
    if (hasOwn(snap, "positionCount") &&
        (typeof snap.positionCount !== "number" || !Number.isInteger(snap.positionCount) || snap.positionCount < 0)) {
      fail(path + ".positionCount", "must be a non-negative integer");
    }
    if (hasOwn(snap, "createdAt")) {
      validateAiTimestamp(snap.createdAt, path + ".createdAt", true);
    }
    if (hasOwn(snap, "attachedAt")) {
      validateAiTimestamp(snap.attachedAt, path + ".attachedAt", true);
    }
    if (hasOwn(snap, "cards")) {
      assertArrayNoHoles(snap.cards, path + ".cards");
      for (var c = 0; c < snap.cards.length; c += 1) {
        validateAiSnapshotCard(snap.cards[c], path + ".cards[" + c + "]");
      }
    }
  }

  function validateAiMessage(msg, path) {
    assertPlainObject(msg, path);
    assertOnlyKeys(msg, AI_MESSAGE_KEYS, path);
    if (hasOwn(msg, "role") && msg.role !== "user" && msg.role !== "assistant") {
      fail(path + ".role", "must be user or assistant");
    }
    var stringFields = ["id", "content", "reasoning", "model", "format", "error"];
    for (var i = 0; i < stringFields.length; i += 1) {
      var f = stringFields[i];
      if (hasOwn(msg, f) && typeof msg[f] !== "string") {
        fail(path + "." + f, "must be a string");
      }
    }
    if (hasOwn(msg, "createdAt")) {
      validateAiTimestamp(msg.createdAt, path + ".createdAt", false);
    }
    if (hasOwn(msg, "interpretedReadingIds")) {
      assertArrayNoHoles(msg.interpretedReadingIds, path + ".interpretedReadingIds");
      for (var r = 0; r < msg.interpretedReadingIds.length; r += 1) {
        if (typeof msg.interpretedReadingIds[r] !== "string") {
          fail(path + ".interpretedReadingIds[" + r + "]", "must be a string");
        }
      }
    }
  }

  function validateAiContextSummary(summary, path) {
    if (summary === null) return;
    assertPlainObject(summary, path);
    assertOnlyKeys(summary, AI_CONTEXT_SUMMARY_KEYS, path);
    if (hasOwn(summary, "text") && typeof summary.text !== "string") {
      fail(path + ".text", "must be a string");
    }
    if (hasOwn(summary, "coveredUntilId") && typeof summary.coveredUntilId !== "string") {
      fail(path + ".coveredUntilId", "must be a string");
    }
    if (hasOwn(summary, "compressedCount") &&
        (typeof summary.compressedCount !== "number" || !Number.isFinite(summary.compressedCount) || summary.compressedCount < 0)) {
      fail(path + ".compressedCount", "must be a non-negative finite number");
    }
    if (hasOwn(summary, "updatedAt")) {
      validateAiTimestamp(summary.updatedAt, path + ".updatedAt", true);
    }
  }

  function validateAiLastUsage(usage, path) {
    if (usage === null) return;
    assertPlainObject(usage, path);
    assertOnlyKeys(usage, AI_LAST_USAGE_KEYS, path);
    var numFields = ["inputTokens", "outputTokens", "totalTokens"];
    for (var i = 0; i < numFields.length; i += 1) {
      var f = numFields[i];
      if (hasOwn(usage, f) && (typeof usage[f] !== "number" || !Number.isFinite(usage[f]) || usage[f] < 0)) {
        fail(path + "." + f, "must be a non-negative finite number");
      }
    }
    if (hasOwn(usage, "updatedAt")) {
      validateAiTimestamp(usage.updatedAt, path + ".updatedAt", true);
    }
  }

  function validateAiConversation(conv, path) {
    assertPlainObject(conv, path);
    assertOnlyKeys(conv, AI_CONVERSATION_KEYS, path);
    if (!hasOwn(conv, "id") || typeof conv.id !== "string" || !conv.id.trim()) {
      fail(path + ".id", "must be a non-empty string");
    }
    if (!hasOwn(conv, "createdAt")) {
      fail(path + ".createdAt", "is required");
    }
    validateAiTimestamp(conv.createdAt, path + ".createdAt", false);
    if (!hasOwn(conv, "updatedAt")) {
      fail(path + ".updatedAt", "is required");
    }
    validateAiTimestamp(conv.updatedAt, path + ".updatedAt", false);
    if (!hasOwn(conv, "messages") || !Array.isArray(conv.messages)) {
      fail(path + ".messages", "must be an array");
    }
    var stringFields = ["id", "title", "profileId"];
    for (var i = 0; i < stringFields.length; i += 1) {
      var f = stringFields[i];
      if (hasOwn(conv, f) && typeof conv[f] !== "string") {
        fail(path + "." + f, "must be a string");
      }
    }
    if (hasOwn(conv, "archived") && typeof conv.archived !== "boolean") {
      fail(path + ".archived", "must be a boolean");
    }
    if (hasOwn(conv, "pinned") && typeof conv.pinned !== "boolean") {
      fail(path + ".pinned", "must be a boolean");
    }
    if (hasOwn(conv, "skillMode")) {
      if (typeof conv.skillMode !== "string" || VALID_SKILL_MODES.indexOf(conv.skillMode.trim().toLowerCase()) === -1) {
        fail(path + ".skillMode", "unsupported skillMode");
      }
    }
    if (hasOwn(conv, "readingIds")) {
      assertArrayNoHoles(conv.readingIds, path + ".readingIds");
      for (var r = 0; r < conv.readingIds.length; r += 1) {
        if (typeof conv.readingIds[r] !== "string") {
          fail(path + ".readingIds[" + r + "]", "must be a string");
        }
      }
    }
    if (hasOwn(conv, "readingSnapshots")) {
      assertArrayNoHoles(conv.readingSnapshots, path + ".readingSnapshots");
      for (var s = 0; s < conv.readingSnapshots.length; s += 1) {
        validateAiSnapshot(conv.readingSnapshots[s], path + ".readingSnapshots[" + s + "]");
      }
    }
    assertArrayNoHoles(conv.messages, path + ".messages");
    for (var m = 0; m < conv.messages.length; m += 1) {
      validateAiMessage(conv.messages[m], path + ".messages[" + m + "]");
    }
    if (hasOwn(conv, "contextSummary")) {
      validateAiContextSummary(conv.contextSummary, path + ".contextSummary");
    }
    if (hasOwn(conv, "lastUsage")) {
      validateAiLastUsage(conv.lastUsage, path + ".lastUsage");
    }
  }

  function validateHistorySection(section, validators, skipByteLimit) {
    var historyRecords = resolveDep(validators, "historyRecords", "DivinationHistoryRecords", "historyRecords");
    if (!historyRecords || typeof historyRecords.parseImportJson !== "function") {
      fail("sections.history", "DivinationHistoryRecords validator is unavailable");
    }
    assertPlainObject(section, "sections.history");
    assertExactKeys(section, HISTORY_ENVELOPE_KEYS, "sections.history");
    var maxBytes = typeof historyRecords.MAX_IMPORT_BYTES === "number"
      ? historyRecords.MAX_IMPORT_BYTES
      : DEFAULT_HISTORY_MAX_BYTES;
    var serialized = JSON.stringify(section);
    if (!skipByteLimit && exceedsUtf8ByteLimit(serialized, maxBytes)) {
      fail("sections.history", "exceeds history backup byte limit", "backup_too_large");
    }
    if (skipByteLimit) {
      return safeClone(section);
    }
    var parsed = historyRecords.parseImportJson(serialized);
    return parsed;
  }

  function validateCardNotesSection(section, validators) {
    assertPlainObject(section, "sections.cardNotes");
    assertExactKeys(section, CARD_NOTES_ENVELOPE_KEYS, "sections.cardNotes");
    if (section.format !== CARD_NOTES_FORMAT) {
      fail("sections.cardNotes.format", "unsupported card notes backup format");
    }
    if (section.version !== CARD_NOTES_VERSION) {
      fail("sections.cardNotes.version", "unsupported card notes backup version");
    }
    assertArrayNoHoles(section.notes, "sections.cardNotes.notes");
    var isKnownCard = resolveIsKnownCard(validators);
    var seen = Object.create(null);
    var cleanNotes = [];
    for (var i = 0; i < section.notes.length; i += 1) {
      var row = section.notes[i];
      var path = "sections.cardNotes.notes[" + i + "]";
      assertPlainObject(row, path);
      assertExactKeys(row, CARD_NOTE_ROW_KEYS, path);
      if (typeof row.deckType !== "string" || row.deckType.length === 0 ||
          typeof row.cardId !== "string" || row.cardId.length === 0 ||
          isKnownCard(row.deckType, row.cardId) !== true) {
        fail(path, "unknown card key");
      }
      if (typeof row.text !== "string" || !row.text.trim()) {
        fail(path + ".text", "must be a non-empty string");
      }
      var compoundKey = JSON.stringify([row.deckType, row.cardId]);
      if (seen[compoundKey]) {
        fail(path, "duplicate card note key");
      }
      seen[compoundKey] = true;
      cleanNotes.push({
        deckType: row.deckType,
        cardId: row.cardId,
        text: row.text
      });
    }
    return {
      format: CARD_NOTES_FORMAT,
      version: CARD_NOTES_VERSION,
      notes: cleanNotes
    };
  }

  function validateCustomSpreadsSection(section, validators) {
    var customSpreads = resolveDep(validators, "customSpreads", "DivinationCustomSpreads", "customSpreads");
    if (!customSpreads || typeof customSpreads.decode !== "function" || typeof customSpreads.encode !== "function") {
      fail("sections.customSpreads", "DivinationCustomSpreads validator is unavailable");
    }
    assertPlainObject(section, "sections.customSpreads");
    assertExactKeys(section, CUSTOM_SPREADS_ENVELOPE_KEYS, "sections.customSpreads");
    if (section.format !== CUSTOM_SPREADS_FORMAT) {
      fail("sections.customSpreads.format", "unsupported custom spreads backup format");
    }
    if (section.version !== CUSTOM_SPREADS_VERSION) {
      fail("sections.customSpreads.version", "unsupported custom spreads backup version");
    }
    assertArrayNoHoles(section.codes, "sections.customSpreads.codes");
    var maxSize = typeof customSpreads.MAX_LIBRARY_SIZE === "number"
      ? customSpreads.MAX_LIBRARY_SIZE
      : DEFAULT_CUSTOM_SPREADS_MAX_SIZE;
    if (section.codes.length > maxSize) {
      fail("sections.customSpreads.codes", "exceeds maximum custom spread count (" + maxSize + ")");
    }
    var seenCanonical = Object.create(null);
    var seenRuntimeIds = Object.create(null);
    var cleanCodes = [];
    for (var i = 0; i < section.codes.length; i += 1) {
      var code = section.codes[i];
      var path = "sections.customSpreads.codes[" + i + "]";
      if (typeof code !== "string" || code.length === 0) {
        fail(path, "must be a non-empty share code string");
      }
      var decoded = customSpreads.decode(code);
      var canonical = customSpreads.encode(decoded);
      if (seenCanonical[canonical]) {
        fail(path, "duplicate custom spread share code");
      }
      seenCanonical[canonical] = true;
      if (typeof customSpreads.toRuntimeSpread === "function") {
        var runtime = customSpreads.toRuntimeSpread(decoded);
        if (runtime && runtime.id) {
          if (seenRuntimeIds[runtime.id]) {
            fail(path, "custom spread runtime ID collision");
          }
          seenRuntimeIds[runtime.id] = true;
        }
      }
      cleanCodes.push(code);
    }
    return {
      format: CUSTOM_SPREADS_FORMAT,
      version: CUSTOM_SPREADS_VERSION,
      codes: cleanCodes
    };
  }

  function validateAiChatsSection(section, validators, skipByteLimit) {
    var aiChatModule = resolveDep(validators, "aiChatStoreApi", "DivinationAiChatStore", "aiChatStore");
    assertPlainObject(section, "sections.aiChats");
    assertExactKeys(section, AI_CHATS_ENVELOPE_KEYS, "sections.aiChats");
    if (section.format !== AI_CHATS_FORMAT) {
      fail("sections.aiChats.format", "unsupported AI chats backup format");
    }
    if (section.version !== AI_CHATS_VERSION) {
      fail("sections.aiChats.version", "unsupported AI chats backup version");
    }
    validateAiTimestamp(section.exportedAt, "sections.aiChats.exportedAt", true);
    assertArrayNoHoles(section.conversations, "sections.aiChats.conversations");
    var maxBytes = aiChatModule && typeof aiChatModule.MAX_BACKUP_BYTES === "number"
      ? aiChatModule.MAX_BACKUP_BYTES
      : DEFAULT_AI_CHATS_MAX_BYTES;
    if (!skipByteLimit) {
      var serialized = JSON.stringify(section);
      if (exceedsUtf8ByteLimit(serialized, maxBytes)) {
        fail("sections.aiChats", "exceeds AI chat backup byte limit", "backup_too_large");
      }
    }
    for (var i = 0; i < section.conversations.length; i += 1) {
      validateAiConversation(section.conversations[i], "sections.aiChats.conversations[" + i + "]");
    }
    return safeClone(section);
  }

  function validatePreferencesSection(section) {
    assertPlainObject(section, "sections.preferences");
    assertOnlyKeys(section, PREFERENCES_KEYS, "sections.preferences");
    var clean = {};
    if (hasOwn(section, "theme")) {
      if (typeof section.theme !== "string" || VALID_THEMES.indexOf(section.theme) === -1) {
        fail("sections.preferences.theme", "unsupported theme value");
      }
      clean.theme = section.theme;
    }
    if (hasOwn(section, "locale")) {
      if (typeof section.locale !== "string" || VALID_LOCALES.indexOf(section.locale) === -1) {
        fail("sections.preferences.locale", "unsupported locale value");
      }
      clean.locale = section.locale;
    }
    return clean;
  }

  function validateEnvelopeObject(envelope, validators) {
    scanTreeSecurity(envelope, "backup", new Set());
    assertPlainObject(envelope, "backup");
    assertExactKeys(envelope, ENVELOPE_KEYS, "backup");
    if (envelope.format !== BACKUP_FORMAT) {
      fail("backup.format", "unsupported backup format");
    }
    if (envelope.version !== BACKUP_VERSION) {
      fail("backup.version", "unsupported backup version");
    }
    assertIsoDate(envelope.exportedAt, "backup.exportedAt");
    assertPlainObject(envelope.sections, "backup.sections");
    assertOnlyKeys(envelope.sections, SECTION_KEYS, "backup.sections");

    var sections = {};
    var counts = {
      history: 0,
      cardNotes: 0,
      customSpreads: 0,
      aiChats: 0,
      preferences: 0
    };
    var availableSections = [];

    if (hasOwn(envelope.sections, "history")) {
      sections.history = validateHistorySection(envelope.sections.history, validators);
      counts.history = sections.history.records.length;
      availableSections.push("history");
    }
    if (hasOwn(envelope.sections, "cardNotes")) {
      sections.cardNotes = validateCardNotesSection(envelope.sections.cardNotes, validators);
      counts.cardNotes = sections.cardNotes.notes.length;
      availableSections.push("cardNotes");
    }
    if (hasOwn(envelope.sections, "customSpreads")) {
      sections.customSpreads = validateCustomSpreadsSection(envelope.sections.customSpreads, validators);
      counts.customSpreads = sections.customSpreads.codes.length;
      availableSections.push("customSpreads");
    }
    if (hasOwn(envelope.sections, "aiChats")) {
      sections.aiChats = validateAiChatsSection(envelope.sections.aiChats, validators);
      counts.aiChats = sections.aiChats.conversations.length;
      availableSections.push("aiChats");
    }
    if (hasOwn(envelope.sections, "preferences")) {
      sections.preferences = validatePreferencesSection(envelope.sections.preferences);
      counts.preferences = Object.keys(sections.preferences).length;
      availableSections.push("preferences");
    }

    return {
      format: envelope.format,
      version: envelope.version,
      exportedAt: envelope.exportedAt,
      sections: sections,
      counts: counts,
      availableSections: availableSections
    };
  }

  function parseBackup(rawString, validators) {
    if (typeof rawString !== "string" || rawString.length === 0) {
      fail("backup", "backup payload must be a non-empty JSON string");
    }
    if (exceedsUtf8ByteLimit(rawString, MAX_BACKUP_BYTES)) {
      fail("backup", "backup exceeds the 16 MiB size limit", "backup_too_large");
    }
    var parsed;
    try {
      parsed = JSON.parse(rawString, function (key, value) {
        if (key !== "" && isForbiddenKey(key)) {
          fail("backup", "contains forbidden key " + key, "forbidden_key");
        }
        return value;
      });
    } catch (error) {
      if (error && (error.code === "forbidden_key" || error.code === "invalid_backup" || error.code === "backup_too_large")) {
        throw error;
      }
      fail("backup", "invalid JSON");
    }
    return validateEnvelopeObject(parsed, validators);
  }

  function resolveRuntimeAdapters(adapters) {
    var input = adapters && typeof adapters === "object" ? adapters : {};
    var historyRecords = resolveDep(input, "historyRecords", "DivinationHistoryRecords", "historyRecords");
    var customSpreads = resolveDep(input, "customSpreads", "DivinationCustomSpreads", "customSpreads");
    var aiChatModule = resolveDep(input, "aiChatStoreApi", "DivinationAiChatStore", "aiChatStore");
    var themeApi = hasOwn(input, "themeApi") ? input.themeApi : (root && root.DivinationTheme) || null;
    var i18nApi = hasOwn(input, "i18nApi") ? input.i18nApi : (root && root.DivinationI18n) || null;
    var isKnownCard = resolveIsKnownCard(input);

    var historyStore = null;
    if (hasOwn(input, "historyStore")) {
      historyStore = input.historyStore;
    } else {
      var hsMod = resolveDep(null, null, "DivinationHistoryStore", "historyStore");
      if (hsMod && typeof hsMod.createStore === "function" && root && root.indexedDB) {
        try {
          historyStore = hsMod.createStore({ indexedDB: root.indexedDB, recordsApi: historyRecords });
        } catch (_e) {
          historyStore = null;
        }
      }
    }

    var cardNotesStore = null;
    if (hasOwn(input, "cardNotesStore")) {
      cardNotesStore = input.cardNotesStore;
    } else {
      var cnMod = resolveDep(null, null, "DivinationCardNotesStore", "cardNotesStore");
      if (cnMod && typeof cnMod.createStore === "function" && root && root.indexedDB) {
        try {
          cardNotesStore = cnMod.createStore({ indexedDB: root.indexedDB, isKnownCard: isKnownCard });
        } catch (_e) {
          cardNotesStore = null;
        }
      }
    }

    var customSpreadsLibrary = hasOwn(input, "customSpreadsLibrary") ? input.customSpreadsLibrary : null;

    var aiChatStore = null;
    if (hasOwn(input, "aiChatStore")) {
      aiChatStore = input.aiChatStore;
    } else if (aiChatModule && typeof aiChatModule.createStore === "function" && root && root.indexedDB) {
      try {
        aiChatStore = aiChatModule.createStore({ indexedDB: root.indexedDB, memoryFallback: false });
      } catch (_e) {
        aiChatStore = null;
      }
    }

    var hasExplicitStorage = hasOwn(input, "storage");
    var storage = null;
    var storageError = null;
    if (hasExplicitStorage) {
      storage = input.storage;
    } else if (root && "localStorage" in root) {
      try {
        storage = root.localStorage || null;
      } catch (err) {
        storage = null;
        storageError = err;
      }
    }

    var historyStoreApi = resolveDep(input, "historyStoreApi", "DivinationHistoryStore", "historyStore");

    return {
      historyRecords: historyRecords,
      historyStoreApi: historyStoreApi,
      historyStore: historyStore,
      cardNotesStore: cardNotesStore,
      customSpreads: customSpreads,
      customSpreadsLibrary: customSpreadsLibrary,
      aiChatStoreApi: aiChatModule,
      aiChatStore: aiChatStore,
      themeApi: themeApi,
      i18nApi: i18nApi,
      storage: storage,
      storageError: storageError,
      isKnownCard: isKnownCard
    };
  }

  function readLocalPreferences(resolved) {
    var prefs = {};
    var readable = false;
    if (resolved.themeApi && typeof resolved.themeApi.getTheme === "function") {
      try {
        var theme = resolved.themeApi.getTheme();
        if (typeof theme === "string" && VALID_THEMES.indexOf(theme) !== -1) {
          prefs.theme = theme;
          readable = true;
        }
      } catch (_e) {}
    }
    if (resolved.i18nApi && typeof resolved.i18nApi.getLocale === "function") {
      try {
        var locale = resolved.i18nApi.getLocale();
        if (typeof locale === "string" && VALID_LOCALES.indexOf(locale) !== -1) {
          prefs.locale = locale;
          readable = true;
        }
      } catch (_e) {}
    }
    return { readable: readable, preferences: prefs };
  }

  function inspectLocalCounts(adapters) {
    var resolved = resolveRuntimeAdapters(adapters);
    var unavailableMap = Object.create(null);
    var counts = {
      history: 0,
      cardNotes: 0,
      customSpreads: 0,
      aiChats: 0,
      preferences: 0
    };

    var tasks = [];

    // 1. history
    if (resolved.historyStore && typeof resolved.historyStore.listRecords === "function") {
      tasks.push(Promise.resolve().then(function () {
        return resolved.historyStore.listRecords();
      }).then(function (records) {
        if (!Array.isArray(records)) throw new Error("Invalid history records list");
        counts.history = records.length;
      }).catch(function () {
        counts.history = 0;
        unavailableMap.history = true;
      }));
    } else {
      unavailableMap.history = true;
    }

    // 2. cardNotes
    if (resolved.cardNotesStore &&
        (typeof resolved.cardNotesStore.keys === "function" || typeof resolved.cardNotesStore.list === "function")) {
      tasks.push(Promise.resolve().then(function () {
        return typeof resolved.cardNotesStore.keys === "function"
          ? resolved.cardNotesStore.keys()
          : resolved.cardNotesStore.list();
      }).then(function (items) {
        if (!Array.isArray(items)) throw new Error("Invalid card notes list");
        counts.cardNotes = items.length;
      }).catch(function () {
        counts.cardNotes = 0;
        unavailableMap.cardNotes = true;
      }));
    } else {
      unavailableMap.cardNotes = true;
    }

    // 3. customSpreads
    if (resolved.customSpreadsLibrary && typeof resolved.customSpreadsLibrary.list === "function") {
      tasks.push(Promise.resolve().then(function () {
        return resolved.customSpreadsLibrary.list();
      }).then(function (items) {
        if (!Array.isArray(items)) throw new Error("Invalid custom spreads list");
        counts.customSpreads = items.length;
      }).catch(function () {
        counts.customSpreads = 0;
        unavailableMap.customSpreads = true;
      }));
    } else {
      unavailableMap.customSpreads = true;
    }

    // 4. aiChats
    if (resolved.aiChatStore &&
        (typeof resolved.aiChatStore.listConversations === "function" ||
         typeof resolved.aiChatStore.exportBackup === "function")) {
      tasks.push(Promise.resolve().then(function () {
        if (typeof resolved.aiChatStore.listConversations === "function") {
          return resolved.aiChatStore.listConversations({ archived: "all" });
        }
        return resolved.aiChatStore.exportBackup().then(function (backup) {
          return backup && Array.isArray(backup.conversations) ? backup.conversations : [];
        });
      }).then(function (items) {
        if (!Array.isArray(items)) throw new Error("Invalid AI chats list");
        counts.aiChats = items.length;
      }).catch(function () {
        counts.aiChats = 0;
        unavailableMap.aiChats = true;
      }));
    } else {
      unavailableMap.aiChats = true;
    }

    // 5. preferences
    var prefInfo = readLocalPreferences(resolved);
    if (prefInfo.readable) {
      counts.preferences = Object.keys(prefInfo.preferences).length;
    } else {
      unavailableMap.preferences = true;
    }

    return Promise.all(tasks).then(function () {
      var unavailable = SECTION_KEYS.filter(function (key) {
        return unavailableMap[key] === true;
      });
      return {
        history: counts.history,
        cardNotes: counts.cardNotes,
        customSpreads: counts.customSpreads,
        aiChats: counts.aiChats,
        preferences: counts.preferences,
        unavailable: unavailable
      };
    });
  }

  function collectBackup(adapters, options) {
    options = options && typeof options === "object" ? options : {};
    var exportedAt = options.exportedAt || new Date().toISOString();
    try {
      assertIsoDate(exportedAt, "options.exportedAt");
    } catch (error) {
      return Promise.reject(error);
    }

    var requestedSections = SECTION_KEYS.slice();
    if (options.sections !== undefined) {
      if (!Array.isArray(options.sections)) {
        return Promise.reject(createError("invalid_options", "options.sections must be an array"));
      }
      var reqSet = Object.create(null);
      for (var i = 0; i < options.sections.length; i += 1) {
        var key = options.sections[i];
        if (SECTION_KEYS.indexOf(key) === -1) {
          return Promise.reject(createError("invalid_options", "Unknown backup section: " + String(key)));
        }
        reqSet[key] = true;
      }
      requestedSections = SECTION_KEYS.filter(function (k) { return reqSet[k] === true; });
    }

    var resolved = resolveRuntimeAdapters(adapters);
    var sections = {};
    var unavailableMap = Object.create(null);
    var counts = {
      history: 0,
      cardNotes: 0,
      customSpreads: 0,
      aiChats: 0,
      preferences: 0
    };
    var tasks = [];

    var validationErrors = [];

    // 1. history
    if (requestedSections.indexOf("history") !== -1) {
      if (resolved.historyStore && typeof resolved.historyStore.listRecords === "function" &&
          resolved.historyRecords && typeof resolved.historyRecords.createExportEnvelope === "function") {
        tasks.push(Promise.resolve().then(function () {
          return resolved.historyStore.listRecords();
        }).then(function (records) {
          try {
            var historyEnv = resolved.historyRecords.createExportEnvelope(records, exportedAt);
            scanTreeSecurity(historyEnv, "sections.history", new Set());
            sections.history = historyEnv;
            counts.history = historyEnv.records.length;
          } catch (error) {
            validationErrors.push(error);
          }
        }, function () {
          unavailableMap.history = true;
        }));
      } else {
        unavailableMap.history = true;
      }
    }

    // 2. cardNotes
    if (requestedSections.indexOf("cardNotes") !== -1) {
      if (resolved.cardNotesStore &&
          (typeof resolved.cardNotesStore.exportBackup === "function" ||
           typeof resolved.cardNotesStore.list === "function")) {
        tasks.push(Promise.resolve().then(function () {
          if (typeof resolved.cardNotesStore.exportBackup === "function") {
            return resolved.cardNotesStore.exportBackup().then(function (raw) {
              return JSON.parse(raw);
            });
          }
          return resolved.cardNotesStore.list().then(function (notes) {
            return {
              format: CARD_NOTES_FORMAT,
              version: CARD_NOTES_VERSION,
              notes: notes
            };
          });
        }).then(function (notesObj) {
          try {
            var clean = validateCardNotesSection(notesObj, resolved);
            sections.cardNotes = clean;
            counts.cardNotes = clean.notes.length;
          } catch (error) {
            validationErrors.push(error);
          }
        }, function () {
          unavailableMap.cardNotes = true;
        }));
      } else {
        unavailableMap.cardNotes = true;
      }
    }

    // 3. customSpreads
    if (requestedSections.indexOf("customSpreads") !== -1) {
      if (resolved.customSpreadsLibrary &&
          typeof resolved.customSpreadsLibrary.list === "function" &&
          typeof resolved.customSpreadsLibrary.exportCode === "function" &&
          resolved.customSpreads) {
        tasks.push(Promise.resolve().then(function () {
          return resolved.customSpreadsLibrary.list();
        }).then(function (spreads) {
          if (!Array.isArray(spreads)) throw new Error("Invalid custom spreads list");
          var codePromises = spreads.map(function (spread) {
            if (!spread || typeof spread.id !== "string") {
              return Promise.reject(new Error("Invalid custom spread item"));
            }
            return Promise.resolve().then(function () {
              return resolved.customSpreadsLibrary.exportCode(spread.id);
            }).then(function (code) {
              if (typeof code !== "string" || !code) {
                throw new Error("Failed to export custom spread code");
              }
              return code;
            });
          });
          return Promise.all(codePromises);
        }).then(function (codes) {
          try {
            var sectionObj = {
              format: CUSTOM_SPREADS_FORMAT,
              version: CUSTOM_SPREADS_VERSION,
              codes: codes
            };
            var clean = validateCustomSpreadsSection(sectionObj, resolved);
            sections.customSpreads = clean;
            counts.customSpreads = clean.codes.length;
          } catch (error) {
            validationErrors.push(error);
          }
        }, function () {
          unavailableMap.customSpreads = true;
        }));
      } else {
        unavailableMap.customSpreads = true;
      }
    }

    // 4. aiChats
    if (requestedSections.indexOf("aiChats") !== -1) {
      if (resolved.aiChatStore && typeof resolved.aiChatStore.exportBackup === "function") {
        tasks.push(Promise.resolve().then(function () {
          return resolved.aiChatStore.exportBackup();
        }).then(function (exported) {
          try {
            scanTreeSecurity(exported, "sections.aiChats", new Set());
            var clean = validateAiChatsSection(exported, resolved, true);
            sections.aiChats = clean;
            counts.aiChats = clean.conversations.length;
          } catch (error) {
            validationErrors.push(error);
          }
        }, function () {
          unavailableMap.aiChats = true;
        }));
      } else {
        unavailableMap.aiChats = true;
      }
    }

    // 5. preferences
    if (requestedSections.indexOf("preferences") !== -1) {
      var prefInfo = readLocalPreferences(resolved);
      if (prefInfo.readable) {
        sections.preferences = prefInfo.preferences;
        counts.preferences = Object.keys(prefInfo.preferences).length;
      } else {
        unavailableMap.preferences = true;
      }
    }

    return Promise.all(tasks).then(function () {
      if (validationErrors.length > 0) {
        throw validationErrors[0];
      }

      var orderedSections = {};
      for (var k = 0; k < SECTION_KEYS.length; k += 1) {
        var sectionKey = SECTION_KEYS[k];
        if (hasOwn(sections, sectionKey)) {
          orderedSections[sectionKey] = sections[sectionKey];
        }
      }
      var envelope = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        exportedAt: exportedAt,
        sections: orderedSections
      };
      var json = JSON.stringify(envelope, null, 2);
      var totalBytes = utf8ByteLength(json);
      var oversizedSections = [];

      if (hasOwn(orderedSections, "history")) {
        var historyMaxBytes = resolved.historyRecords && typeof resolved.historyRecords.MAX_IMPORT_BYTES === "number"
          ? resolved.historyRecords.MAX_IMPORT_BYTES
          : DEFAULT_HISTORY_MAX_BYTES;
        var historyCompact = JSON.stringify(orderedSections.history);
        var historyBytes = utf8ByteLength(historyCompact);
        if (historyBytes > historyMaxBytes) {
          oversizedSections.push({
            section: "history",
            bytes: historyBytes,
            maxBytes: historyMaxBytes
          });
        }
      }

      if (hasOwn(orderedSections, "aiChats")) {
        var aiChatsMaxBytes = resolved.aiChatStoreApi && typeof resolved.aiChatStoreApi.MAX_BACKUP_BYTES === "number"
          ? resolved.aiChatStoreApi.MAX_BACKUP_BYTES
          : DEFAULT_AI_CHATS_MAX_BYTES;
        var aiChatsCompact = JSON.stringify(orderedSections.aiChats);
        var aiChatsBytes = utf8ByteLength(aiChatsCompact);
        if (aiChatsBytes > aiChatsMaxBytes) {
          oversizedSections.push({
            section: "aiChats",
            bytes: aiChatsBytes,
            maxBytes: aiChatsMaxBytes
          });
        }
      }

      if (totalBytes > MAX_BACKUP_BYTES) {
        var otherSections = ["cardNotes", "customSpreads", "preferences"];
        for (var oi = 0; oi < otherSections.length; oi += 1) {
          var oKey = otherSections[oi];
          if (!hasOwn(orderedSections, oKey)) continue;
          var singleSection = {};
          singleSection[oKey] = orderedSections[oKey];
          var aloneEnvelope = {
            format: BACKUP_FORMAT,
            version: BACKUP_VERSION,
            exportedAt: exportedAt,
            sections: singleSection
          };
          var aloneBytes = utf8ByteLength(JSON.stringify(aloneEnvelope, null, 2));
          if (aloneBytes > MAX_BACKUP_BYTES) {
            oversizedSections.push({
              section: oKey,
              bytes: aloneBytes,
              maxBytes: MAX_BACKUP_BYTES
            });
          }
        }
        oversizedSections.push({
          section: "total",
          bytes: totalBytes,
          maxBytes: MAX_BACKUP_BYTES
        });
      }

      if (oversizedSections.length > 0) {
        var summaryParts = oversizedSections.map(function (entry) {
          return entry.section + " (" + entry.bytes + " / " + entry.maxBytes + " bytes)";
        });
        var sizeError = createError(
          "export_too_large",
          "Backup export exceeds import size limit: " + summaryParts.join(", ")
        );
        sizeError.totalBytes = totalBytes;
        sizeError.maxBytes = MAX_BACKUP_BYTES;
        sizeError.oversizedSections = oversizedSections;
        throw sizeError;
      }

      // Self-validate final JSON with the exact parseBackup pipeline so no exported file can fail re-import.
      try {
        parseBackup(json, resolved);
      } catch (selfCheckError) {
        if (selfCheckError && selfCheckError.code === "backup_too_large") {
          var wrappedSizeError = createError("export_too_large", selfCheckError.message);
          wrappedSizeError.totalBytes = totalBytes;
          wrappedSizeError.maxBytes = MAX_BACKUP_BYTES;
          wrappedSizeError.oversizedSections = [{
            section: "total",
            bytes: totalBytes,
            maxBytes: MAX_BACKUP_BYTES
          }];
          throw wrappedSizeError;
        }
        throw selfCheckError;
      }

      var unavailable = SECTION_KEYS.filter(function (key) {
        return unavailableMap[key] === true;
      });
      return {
        envelope: envelope,
        json: json,
        counts: counts,
        exportedAt: exportedAt,
        unavailable: unavailable
      };
    });
  }

  function recordSectionFailure(failedSections, warnings, section, code, message) {
    var fullMessage = section + ": " + message;
    warnings.push(fullMessage);
    failedSections.push({
      section: section,
      code: code || "restore_failed",
      message: fullMessage
    });
  }

  function deriveDeterministicRemapId(originalId, createdAt, canonicalContent, attempt, resolved) {
    if (resolved && resolved.historyStoreApi &&
        typeof resolved.historyStoreApi.deriveRemappedId === "function") {
      return resolved.historyStoreApi.deriveRemappedId(originalId, createdAt, canonicalContent, attempt);
    }
    if (defaultDeps.historyStore && typeof defaultDeps.historyStore.deriveRemappedId === "function") {
      return defaultDeps.historyStore.deriveRemappedId(originalId, createdAt, canonicalContent, attempt);
    }
    // Fallback pure-JS synchronous deterministic hash if DivinationHistoryStore module is absent.
    var input = originalId + "\0" + createdAt + "\0" + canonicalContent;
    var h1 = 0x811c9dc5;
    var h2 = 0x811c9dc5;
    var h3 = 0x9e3779b9;
    var h4 = 0x85ebca6b;
    for (var i = 0; i < input.length; i += 1) {
      var ch = input.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ (ch + i), 0x01000193) >>> 0;
      h3 = Math.imul(h3 ^ (ch * 31 + i), 0x85ebca6b) >>> 0;
      h4 = Math.imul(h4 ^ (ch + (i << 3)), 0xc2b2ae35) >>> 0;
    }
    var hex = h1.toString(16).padStart(8, "0") +
      h2.toString(16).padStart(8, "0") +
      h3.toString(16).padStart(8, "0") +
      h4.toString(16).padStart(8, "0");
    var suffix = attempt && attempt > 0 ? "-" + String(attempt + 1) : "";
    return "reading-remap-" + hex + suffix;
  }

  function collectAiReferencedReadingIds(aiChatsSection) {
    var refs = Object.create(null);
    if (!aiChatsSection || !Array.isArray(aiChatsSection.conversations)) return refs;
    for (var i = 0; i < aiChatsSection.conversations.length; i += 1) {
      var conv = aiChatsSection.conversations[i];
      if (!conv || typeof conv !== "object") continue;
      if (Array.isArray(conv.readingIds)) {
        for (var r = 0; r < conv.readingIds.length; r += 1) {
          if (typeof conv.readingIds[r] === "string" && conv.readingIds[r].trim()) {
            refs[conv.readingIds[r].trim()] = true;
          }
        }
      }
      if (Array.isArray(conv.readingSnapshots)) {
        for (var s = 0; s < conv.readingSnapshots.length; s += 1) {
          var snap = conv.readingSnapshots[s];
          if (snap && typeof snap === "object") {
            if (typeof snap.id === "string" && snap.id.trim()) refs[snap.id.trim()] = true;
            if (typeof snap.readingId === "string" && snap.readingId.trim()) refs[snap.readingId.trim()] = true;
          }
        }
      }
      if (Array.isArray(conv.messages)) {
        for (var m = 0; m < conv.messages.length; m += 1) {
          var msg = conv.messages[m];
          if (msg && typeof msg === "object" && Array.isArray(msg.interpretedReadingIds)) {
            for (var k = 0; k < msg.interpretedReadingIds.length; k += 1) {
              if (typeof msg.interpretedReadingIds[k] === "string" && msg.interpretedReadingIds[k].trim()) {
                refs[msg.interpretedReadingIds[k].trim()] = true;
              }
            }
          }
        }
      }
    }
    return refs;
  }

  function checkAiChatsHistoryDependency(historySection, aiChatsSection, resolved, historyIdMap, historyWasSelected, historySucceeded) {
    if (!historySection || !Array.isArray(historySection.records) || historySection.records.length === 0) {
      return Promise.resolve({ ok: true });
    }
    var referencedIds = collectAiReferencedReadingIds(aiChatsSection);
    var referencedRecords = [];
    for (var i = 0; i < historySection.records.length; i += 1) {
      var rec = historySection.records[i];
      if (rec && typeof rec.id === "string" && referencedIds[rec.id]) {
        referencedRecords.push(rec);
      }
    }
    if (referencedRecords.length === 0) {
      return Promise.resolve({ ok: true });
    }
    if (historyWasSelected && historySucceeded) {
      return Promise.resolve({ ok: true });
    }

    // Check existing local history store to see if any referenced backup reading collides with
    // a different local reading without already having its deterministic remapped copy stored.
    var recordsApi = resolved.historyRecords;
    if (!resolved.historyStore || typeof resolved.historyStore.listRecords !== "function" ||
        !recordsApi || typeof recordsApi.canonicalRecordContent !== "function") {
      if (historyWasSelected && !historySucceeded) {
        return Promise.resolve({
          ok: false,
          code: "history_dependency_failed",
          message: "deferred because linked history records failed to restore"
        });
      }
      return Promise.resolve({ ok: true });
    }

    return Promise.resolve().then(function () {
      return resolved.historyStore.listRecords();
    }).then(function (existingRecords) {
      if (!Array.isArray(existingRecords)) existingRecords = [];
      var existingById = Object.create(null);
      var canonicalById = Object.create(null);
      for (var e = 0; e < existingRecords.length; e += 1) {
        var existing = existingRecords[e];
        existingById[existing.id] = existing;
        canonicalById[existing.id] = recordsApi.canonicalRecordContent(existing);
      }

      var unresolvedCollisions = [];
      for (var j = 0; j < referencedRecords.length; j += 1) {
        var backupRec = referencedRecords[j];
        if (hasOwn(historyIdMap, backupRec.id)) continue;
        var atOriginal = existingById[backupRec.id];
        if (!atOriginal) continue;
        var backupCanonical = recordsApi.canonicalRecordContent(backupRec);
        if (atOriginal.createdAt === backupRec.createdAt &&
            canonicalById[backupRec.id] === backupCanonical) {
          continue;
        }
        // True collision with a DIFFERENT local reading: check if deterministic remapped copy already exists.
        var foundRemappedId = null;
        for (var attempt = 0; attempt < 1000; attempt += 1) {
          var candidateId = deriveDeterministicRemapId(
            backupRec.id,
            backupRec.createdAt,
            backupCanonical,
            attempt,
            resolved
          );
          var atCandidate = existingById[candidateId];
          if (!atCandidate) {
            break;
          }
          if (atCandidate.createdAt === backupRec.createdAt &&
              canonicalById[candidateId] === backupCanonical) {
            foundRemappedId = candidateId;
            break;
          }
        }
        if (foundRemappedId) {
          historyIdMap[backupRec.id] = foundRemappedId;
        } else {
          unresolvedCollisions.push(backupRec.id);
        }
      }

      if (unresolvedCollisions.length > 0) {
        if (historyWasSelected && !historySucceeded) {
          return {
            ok: false,
            code: "history_dependency_failed",
            message: "deferred because colliding history reading(s) failed to restore (" + unresolvedCollisions.join(", ") + ")"
          };
        }
        return {
          ok: false,
          code: "history_dependency_required",
          message: "colliding history reading(s) must be restored before or together with AI chats (" + unresolvedCollisions.join(", ") + ")"
        };
      }
      return { ok: true };
    }).catch(function () {
      if (historyWasSelected && !historySucceeded) {
        return {
          ok: false,
          code: "history_dependency_failed",
          message: "deferred because linked history records failed to restore"
        };
      }
      return { ok: true };
    });
  }

  function rewriteAiChatsReadingIds(section, historyIdMap) {
    var keys = historyIdMap ? Object.keys(historyIdMap) : [];
    if (keys.length === 0) return section;
    var cloned = safeClone(section);
    if (!cloned || !Array.isArray(cloned.conversations)) return cloned;

    function mapReadingId(id) {
      return typeof id === "string" && hasOwn(historyIdMap, id) ? historyIdMap[id] : id;
    }

    for (var i = 0; i < cloned.conversations.length; i += 1) {
      var conv = cloned.conversations[i];
      if (!conv || typeof conv !== "object") continue;

      if (Array.isArray(conv.readingIds)) {
        var nextIds = [];
        var seenId = Object.create(null);
        for (var r = 0; r < conv.readingIds.length; r += 1) {
          var mappedId = mapReadingId(conv.readingIds[r]);
          if (typeof mappedId === "string" && mappedId && !seenId[mappedId]) {
            seenId[mappedId] = true;
            nextIds.push(mappedId);
          }
        }
        conv.readingIds = nextIds;
      }

      if (Array.isArray(conv.readingSnapshots)) {
        var nextSnaps = [];
        var seenSnap = Object.create(null);
        for (var s = 0; s < conv.readingSnapshots.length; s += 1) {
          var snap = conv.readingSnapshots[s];
          if (snap && typeof snap === "object") {
            if (typeof snap.id === "string") {
              snap.id = mapReadingId(snap.id);
            }
            if (typeof snap.readingId === "string") {
              snap.readingId = mapReadingId(snap.readingId);
            }
            var snapKey = typeof snap.id === "string" ? snap.id : "";
            if (!snapKey || !seenSnap[snapKey]) {
              if (snapKey) seenSnap[snapKey] = true;
              nextSnaps.push(snap);
            }
          }
        }
        conv.readingSnapshots = nextSnaps;
      }

      if (Array.isArray(conv.messages)) {
        for (var m = 0; m < conv.messages.length; m += 1) {
          var msg = conv.messages[m];
          if (msg && typeof msg === "object" && Array.isArray(msg.interpretedReadingIds)) {
            var nextInterp = [];
            var seenInterp = Object.create(null);
            for (var k = 0; k < msg.interpretedReadingIds.length; k += 1) {
              var mappedInterp = mapReadingId(msg.interpretedReadingIds[k]);
              if (typeof mappedInterp === "string" && mappedInterp && !seenInterp[mappedInterp]) {
                seenInterp[mappedInterp] = true;
                nextInterp.push(mappedInterp);
              }
            }
            msg.interpretedReadingIds = nextInterp;
          }
        }
      }
    }
    return cloned;
  }

  function restoreHistorySection(section, resolved, warnings, failedSections, historyIdMap) {
    if (!resolved.historyStore ||
        (typeof resolved.historyStore.mergeBackupRecords !== "function" &&
         typeof resolved.historyStore.importRecords !== "function")) {
      recordSectionFailure(failedSections, warnings, "history", "storage_unavailable", "storage is unavailable");
      return Promise.resolve({ ok: false, summary: { imported: 0, remapped: 0, skipped: 0 } });
    }
    var incomingRecords = section.records;
    if (incomingRecords.length === 0) {
      return Promise.resolve({ ok: true, summary: { imported: 0, remapped: 0, skipped: 0 } });
    }

    // Preferred atomic single-transaction path in DivinationHistoryStore.
    if (typeof resolved.historyStore.mergeBackupRecords === "function") {
      return Promise.resolve().then(function () {
        return resolved.historyStore.mergeBackupRecords(incomingRecords, {
          deriveRemappedId: function (originalId, createdAt, canonicalContent, attempt) {
            return deriveDeterministicRemapId(originalId, createdAt, canonicalContent, attempt, resolved);
          }
        });
      }).then(function (res) {
        if (res && isPlainObject(res.idMap)) {
          Object.keys(res.idMap).forEach(function (oldId) {
            historyIdMap[oldId] = res.idMap[oldId];
          });
        }
        return {
          ok: true,
          summary: {
            imported: res && typeof res.importedCount === "number" ? res.importedCount : 0,
            remapped: res && typeof res.remappedCount === "number" ? res.remappedCount : 0,
            skipped: res && typeof res.skippedCount === "number" ? res.skippedCount : 0
          }
        };
      }).catch(function (error) {
        recordSectionFailure(
          failedSections,
          warnings,
          "history",
          (error && error.code) || "restore_failed",
          error && error.message ? error.message : "restore failed"
        );
        return { ok: false, summary: { imported: 0, remapped: 0, skipped: 0 } };
      });
    }

    // Fallback for minimal mock stores without mergeBackupRecords (still preserves non-colliding IDs
    // and uses deterministic source-ID-scoped remapping on true collisions).
    var recordsApi = resolved.historyRecords;
    var readExisting = typeof resolved.historyStore.listRecords === "function"
      ? Promise.resolve().then(function () { return resolved.historyStore.listRecords(); })
      : Promise.resolve(null);

    return readExisting.then(function (existingRecords) {
      var toImport = incomingRecords;
      var skipped = 0;
      var remappedCount = 0;
      if (Array.isArray(existingRecords) && recordsApi && typeof recordsApi.canonicalRecordContent === "function") {
        var occupiedById = Object.create(null);
        var canonicalById = Object.create(null);
        for (var i = 0; i < existingRecords.length; i += 1) {
          var existing = existingRecords[i];
          occupiedById[existing.id] = existing;
          canonicalById[existing.id] = recordsApi.canonicalRecordContent(existing);
        }
        toImport = [];
        for (var j = 0; j < incomingRecords.length; j += 1) {
          var incoming = incomingRecords[j];
          var incomingCanonical = recordsApi.canonicalRecordContent(incoming);
          var existingAtId = occupiedById[incoming.id];
          if (!existingAtId) {
            var directCopy = safeClone(incoming);
            occupiedById[directCopy.id] = directCopy;
            canonicalById[directCopy.id] = incomingCanonical;
            toImport.push(directCopy);
            continue;
          }
          if (existingAtId.createdAt === incoming.createdAt &&
              canonicalById[incoming.id] === incomingCanonical) {
            skipped += 1;
            continue;
          }
          for (var attempt = 0; attempt < 1000; attempt += 1) {
            var candidateId = deriveDeterministicRemapId(
              incoming.id,
              incoming.createdAt,
              incomingCanonical,
              attempt,
              resolved
            );
            var atCandidate = occupiedById[candidateId];
            if (!atCandidate) {
              var remappedCopy = safeClone(incoming);
              remappedCopy.id = candidateId;
              occupiedById[candidateId] = remappedCopy;
              canonicalById[candidateId] = incomingCanonical;
              toImport.push(remappedCopy);
              remappedCount += 1;
              if (!hasOwn(historyIdMap, incoming.id)) {
                historyIdMap[incoming.id] = candidateId;
              }
              break;
            }
            if (atCandidate.createdAt === incoming.createdAt &&
                canonicalById[candidateId] === incomingCanonical) {
              skipped += 1;
              if (!hasOwn(historyIdMap, incoming.id)) {
                historyIdMap[incoming.id] = candidateId;
              }
              break;
            }
          }
        }
      }
      if (toImport.length === 0) {
        return { ok: true, summary: { imported: 0, remapped: 0, skipped: skipped } };
      }
      return resolved.historyStore.importRecords(toImport).then(function (res) {
        return {
          ok: true,
          summary: {
            imported: res && typeof res.importedCount === "number" ? res.importedCount : toImport.length,
            remapped: remappedCount + (res && typeof res.remappedCount === "number" ? res.remappedCount : 0),
            skipped: skipped
          }
        };
      });
    }).catch(function (error) {
      recordSectionFailure(
        failedSections,
        warnings,
        "history",
        (error && error.code) || "restore_failed",
        error && error.message ? error.message : "restore failed"
      );
      return { ok: false, summary: { imported: 0, remapped: 0, skipped: 0 } };
    });
  }

  function restoreCardNotesSection(section, resolved, warnings, failedSections) {
    if (!resolved.cardNotesStore || typeof resolved.cardNotesStore.importBackup !== "function") {
      recordSectionFailure(failedSections, warnings, "cardNotes", "storage_unavailable", "storage is unavailable");
      return Promise.resolve({ ok: false, summary: { imported: 0, skipped: 0 } });
    }
    return Promise.resolve().then(function () {
      return resolved.cardNotesStore.importBackup(JSON.stringify(section));
    }).then(function (res) {
      return {
        ok: true,
        summary: {
          imported: res && typeof res.imported === "number" ? res.imported : 0,
          skipped: res && typeof res.skipped === "number" ? res.skipped : 0
        }
      };
    }).catch(function (error) {
      recordSectionFailure(
        failedSections,
        warnings,
        "cardNotes",
        (error && error.code) || "restore_failed",
        error && error.message ? error.message : "restore failed"
      );
      return { ok: false, summary: { imported: 0, skipped: 0 } };
    });
  }

  function restoreCustomSpreadsSection(section, resolved, warnings, failedSections) {
    if (!resolved.customSpreadsLibrary ||
        typeof resolved.customSpreadsLibrary.list !== "function" ||
        typeof resolved.customSpreadsLibrary.importCode !== "function" ||
        !resolved.customSpreads) {
      recordSectionFailure(failedSections, warnings, "customSpreads", "storage_unavailable", "storage is unavailable");
      return Promise.resolve({ ok: false, summary: { imported: 0, skipped: 0 } });
    }
    return Promise.resolve().then(function () {
      return resolved.customSpreadsLibrary.list();
    }).then(function (existingList) {
      var existingCanonical = Object.create(null);
      var existingCodeTasks = [];
      if (Array.isArray(existingList) && typeof resolved.customSpreadsLibrary.exportCode === "function") {
        for (var i = 0; i < existingList.length; i += 1) {
          var item = existingList[i];
          if (!item || typeof item.id !== "string") continue;
          (function (id) {
            existingCodeTasks.push(Promise.resolve().then(function () {
              return resolved.customSpreadsLibrary.exportCode(id);
            }).then(function (existingCode) {
              if (typeof existingCode === "string" && existingCode) {
                try {
                  existingCanonical[resolved.customSpreads.encode(resolved.customSpreads.decode(existingCode))] = true;
                } catch (_e) {
                  existingCanonical[existingCode] = true;
                }
              }
            }).catch(function () {}));
          })(item.id);
        }
      }

      return Promise.all(existingCodeTasks).then(function () {
        var imported = 0;
        var skipped = 0;
        var capacityOverflow = 0;
        var storageErrorMessage = "";
        var storageErrorCode = "";

        var step = Promise.resolve();
        section.codes.forEach(function (code) {
          step = step.then(function () {
            var canonical = resolved.customSpreads.encode(resolved.customSpreads.decode(code));
            if (existingCanonical[canonical]) {
              skipped += 1;
              return undefined;
            }
            return Promise.resolve().then(function () {
              return resolved.customSpreadsLibrary.importCode(code);
            }).then(function () {
              existingCanonical[canonical] = true;
              imported += 1;
            }, function (error) {
              if (error && (error.code === "CUSTOM_SPREAD_LIBRARY_FULL" ||
                  /contains at most \d+ spreads/i.test(error.message || ""))) {
                skipped += 1;
                capacityOverflow += 1;
              } else {
                skipped += 1;
                if (!storageErrorMessage) {
                  storageErrorMessage = error && error.message ? error.message : "restore failed";
                  storageErrorCode = (error && error.code) || "restore_failed";
                }
              }
            });
          });
        });

        return step.then(function () {
          var failed = false;
          if (capacityOverflow > 0) {
            var capMsg = "library capacity limit reached; skipped " + capacityOverflow + " spread(s)";
            if (imported === 0 && !storageErrorMessage) {
              recordSectionFailure(failedSections, warnings, "customSpreads", "CUSTOM_SPREAD_LIBRARY_FULL", capMsg);
              failed = true;
            } else {
              warnings.push("customSpreads: " + capMsg);
            }
          }
          if (storageErrorMessage) {
            recordSectionFailure(failedSections, warnings, "customSpreads", storageErrorCode, storageErrorMessage);
            failed = true;
          }
          return { ok: !failed, summary: { imported: imported, skipped: skipped } };
        });
      });
    }).catch(function (error) {
      recordSectionFailure(
        failedSections,
        warnings,
        "customSpreads",
        (error && error.code) || "restore_failed",
        error && error.message ? error.message : "restore failed"
      );
      return { ok: false, summary: { imported: 0, skipped: 0 } };
    });
  }

  function restoreAiChatsSection(section, resolved, warnings, failedSections, historyIdMap) {
    if (!resolved.aiChatStore || typeof resolved.aiChatStore.importBackup !== "function") {
      recordSectionFailure(failedSections, warnings, "aiChats", "storage_unavailable", "storage is unavailable");
      return Promise.resolve({ ok: false, summary: { imported: 0, updated: 0, skipped: 0 } });
    }
    var rewrittenSection = rewriteAiChatsReadingIds(section, historyIdMap);
    var aiChatModule = resolved.aiChatStoreApi;
    var hasInspector = typeof resolved.aiChatStore.listConversations === "function" &&
      aiChatModule && typeof aiChatModule.normalizeConversation === "function";

    if (!hasInspector) {
      return Promise.resolve().then(function () {
        return resolved.aiChatStore.importBackup(rewrittenSection, { mode: "merge" });
      }).then(function (res) {
        return {
          ok: true,
          summary: {
            imported: res && typeof res.importedCount === "number" ? res.importedCount : 0,
            updated: 0,
            skipped: res && typeof res.skippedCount === "number" ? res.skippedCount : 0
          }
        };
      }).catch(function (error) {
        recordSectionFailure(
          failedSections,
          warnings,
          "aiChats",
          (error && error.code) || "restore_failed",
          error && error.message ? error.message : "restore failed"
        );
        return { ok: false, summary: { imported: 0, updated: 0, skipped: 0 } };
      });
    }

    return Promise.resolve().then(function () {
      return resolved.aiChatStore.listConversations({ archived: "all" });
    }).then(function (existingList) {
      var existingById = Object.create(null);
      if (Array.isArray(existingList)) {
        for (var i = 0; i < existingList.length; i += 1) {
          var exNorm = aiChatModule.normalizeConversation(existingList[i]);
          existingById[exNorm.id] = exNorm;
        }
      }

      // Deduplicate incoming conversations by ID keeping the newest proven timestamp (never synthesized Date.now()).
      var deduped = [];
      var dedupIndexById = Object.create(null);
      var skipped = 0;
      for (var c = 0; c < rewrittenSection.conversations.length; c += 1) {
        var rawConv = rewrittenSection.conversations[c];
        var rawUpdatedAt = parseStrictTimestampMs(rawConv && rawConv.updatedAt);
        var rawCreatedAt = parseStrictTimestampMs(rawConv && rawConv.createdAt);
        var invalidMsgTs = false;
        if (rawConv && Array.isArray(rawConv.messages)) {
          for (var mi = 0; mi < rawConv.messages.length; mi += 1) {
            var rawMsg = rawConv.messages[mi];
            if (rawMsg && hasOwn(rawMsg, "createdAt")) {
              var msgTs = parseStrictTimestampMs(rawMsg.createdAt);
              if (!Number.isFinite(msgTs) || msgTs <= 0 || msgTs > MAX_VALID_DATE_MS) {
                invalidMsgTs = true;
                break;
              }
            }
          }
        }
        if (!rawConv || typeof rawConv.id !== "string" || !rawConv.id.trim() ||
            !Number.isFinite(rawUpdatedAt) || rawUpdatedAt <= 0 || rawUpdatedAt > MAX_VALID_DATE_MS ||
            !Number.isFinite(rawCreatedAt) || rawCreatedAt <= 0 || rawCreatedAt > MAX_VALID_DATE_MS ||
            !Array.isArray(rawConv.messages) || invalidMsgTs) {
          skipped += 1;
          continue;
        }
        var norm = aiChatModule.normalizeConversation(rawConv);
        var entry = { conv: norm, provenUpdatedAt: rawUpdatedAt };
        var prevIdx = dedupIndexById[norm.id];
        if (prevIdx !== undefined) {
          skipped += 1;
          var prevEntry = deduped[prevIdx];
          if (entry.provenUpdatedAt > prevEntry.provenUpdatedAt ||
              (entry.provenUpdatedAt === prevEntry.provenUpdatedAt &&
               entry.conv.messages.length > prevEntry.conv.messages.length)) {
            deduped[prevIdx] = entry;
          }
        } else {
          dedupIndexById[norm.id] = deduped.length;
          deduped.push(entry);
        }
      }

      var toImport = [];
      var plannedImported = 0;
      var plannedUpdated = 0;

      for (var j = 0; j < deduped.length; j += 1) {
        var incoming = deduped[j].conv;
        var incomingUpdated = deduped[j].provenUpdatedAt;
        var existing = existingById[incoming.id];
        if (!existing) {
          toImport.push(incoming);
          plannedImported += 1;
          continue;
        }
        var existingUpdated = parseStrictTimestampMs(existing.updatedAt);
        var safeExistingUpdated = Number.isFinite(existingUpdated) ? existingUpdated : 0;
        // Never allow an equal, older, or unverified timestamp to overwrite an existing local conversation.
        if (!(incomingUpdated > 0 && incomingUpdated > safeExistingUpdated)) {
          skipped += 1;
          continue;
        }
        toImport.push(incoming);
        plannedUpdated += 1;
      }

      if (toImport.length === 0) {
        return { ok: true, summary: { imported: 0, updated: 0, skipped: skipped } };
      }

      var payload = {
        format: rewrittenSection.format,
        version: rewrittenSection.version,
        exportedAt: rewrittenSection.exportedAt,
        conversations: toImport
      };
      return resolved.aiChatStore.importBackup(payload, { mode: "merge" }).then(function (res) {
        var extraSkipped = res && typeof res.skippedCount === "number" ? res.skippedCount : 0;
        var writtenCount = res && typeof res.importedCount === "number" ? res.importedCount : toImport.length;
        // Reconcile if a concurrent change skipped one of the planned writes.
        var actualImported = Math.min(plannedImported, writtenCount);
        var actualUpdated = Math.max(0, Math.min(plannedUpdated, writtenCount - actualImported));
        return {
          ok: true,
          summary: {
            imported: actualImported,
            updated: actualUpdated,
            skipped: skipped + extraSkipped
          }
        };
      });
    }).catch(function (error) {
      recordSectionFailure(
        failedSections,
        warnings,
        "aiChats",
        (error && error.code) || "restore_failed",
        error && error.message ? error.message : "restore failed"
      );
      return { ok: false, summary: { imported: 0, updated: 0, skipped: 0 } };
    });
  }

  function persistPreferenceKey(storage, storageError, key, value) {
    if (!storage || typeof storage.setItem !== "function" || typeof storage.getItem !== "function") {
      var unavailMsg = storageError && storageError.message
        ? storageError.message
        : "local storage is unavailable";
      return { ok: false, message: unavailMsg, previous: null, hadPrevious: false };
    }
    var hadPrevious = false;
    var previous = null;
    try {
      previous = storage.getItem(key);
      hadPrevious = previous !== null && previous !== undefined;
    } catch (readErr) {
      return {
        ok: false,
        message: readErr && readErr.message ? readErr.message : "could not read local storage",
        previous: null,
        hadPrevious: false
      };
    }
    try {
      storage.setItem(key, value);
    } catch (writeErr) {
      return {
        ok: false,
        message: writeErr && writeErr.message ? writeErr.message : "could not save to local storage",
        previous: previous,
        hadPrevious: hadPrevious
      };
    }
    try {
      var verified = storage.getItem(key);
      if (verified !== value) {
        return {
          ok: false,
          message: "saved value could not be verified in local storage",
          previous: previous,
          hadPrevious: hadPrevious
        };
      }
    } catch (verifyErr) {
      return {
        ok: false,
        message: verifyErr && verifyErr.message ? verifyErr.message : "could not verify local storage write",
        previous: previous,
        hadPrevious: hadPrevious
      };
    }
    return { ok: true, previous: previous, hadPrevious: hadPrevious };
  }

  function rollbackPreferenceKey(storage, key, persistInfo) {
    if (!storage) return;
    try {
      if (persistInfo && persistInfo.hadPrevious) {
        storage.setItem(key, persistInfo.previous);
      } else if (typeof storage.removeItem === "function") {
        storage.removeItem(key);
      }
    } catch (_e) {}
  }

  function restorePreferencesSection(section, resolved, warnings, failedSections) {
    var applied = { theme: null, locale: null };
    var appliedCount = 0;
    var expectedCount = 0;
    var persistFailed = false;
    var persistErrorMessage = "";
    var firstFailureCode = "";
    var firstFailureMessage = "";

    if (hasOwn(section, "theme")) {
      expectedCount += 1;
      if (resolved.themeApi && typeof resolved.themeApi.setTheme === "function") {
        var themeSupported = !Array.isArray(resolved.themeApi.THEMES) ||
          resolved.themeApi.THEMES.indexOf(section.theme) !== -1;
        if (!themeSupported) {
          var unsupportedThemeMsg = "theme '" + section.theme + "' is not supported in this view";
          warnings.push("preferences: " + unsupportedThemeMsg);
          if (!firstFailureMessage) {
            firstFailureCode = "unsupported_preference";
            firstFailureMessage = unsupportedThemeMsg;
          }
        } else {
          var themeKey = (typeof resolved.themeApi.STORAGE_KEY === "string" && resolved.themeApi.STORAGE_KEY) ||
            DEFAULT_THEME_STORAGE_KEY;
          var themePersist = persistPreferenceKey(resolved.storage, resolved.storageError, themeKey, section.theme);
          if (!themePersist.ok) {
            persistFailed = true;
            var themePersistMsg = "could not persist theme '" + section.theme + "' (" + themePersist.message + ")";
            warnings.push("preferences: " + themePersistMsg);
            if (!persistErrorMessage) persistErrorMessage = themePersistMsg;
          } else {
            try {
              var themeRes = resolved.themeApi.setTheme(section.theme);
              var currentTheme = typeof resolved.themeApi.getTheme === "function"
                ? resolved.themeApi.getTheme()
                : section.theme;
              if (themeRes === true || currentTheme === section.theme ||
                  (themeRes === undefined && currentTheme === section.theme)) {
                var recheckTheme = null;
                try { recheckTheme = resolved.storage.getItem(themeKey); } catch (_reErr) { recheckTheme = null; }
                if (recheckTheme === section.theme) {
                  applied.theme = section.theme;
                  appliedCount += 1;
                } else {
                  persistFailed = true;
                  var themeVerifyMsg = "theme '" + section.theme + "' did not persist in local storage";
                  warnings.push("preferences: " + themeVerifyMsg);
                  if (!persistErrorMessage) persistErrorMessage = themeVerifyMsg;
                }
              } else {
                rollbackPreferenceKey(resolved.storage, themeKey, themePersist);
                var unsupportedMsg = "theme '" + section.theme + "' is not supported in this view";
                warnings.push("preferences: " + unsupportedMsg);
                if (!firstFailureMessage) {
                  firstFailureCode = "unsupported_preference";
                  firstFailureMessage = unsupportedMsg;
                }
              }
            } catch (error) {
              rollbackPreferenceKey(resolved.storage, themeKey, themePersist);
              var themeErrMsg = error && error.message ? error.message : "could not apply theme";
              warnings.push("preferences: " + themeErrMsg);
              if (!firstFailureMessage) {
                firstFailureCode = (error && error.code) || "restore_failed";
                firstFailureMessage = themeErrMsg;
              }
            }
          }
        }
      } else {
        warnings.push("preferences: theme API is unavailable");
        if (!firstFailureMessage) {
          firstFailureCode = "storage_unavailable";
          firstFailureMessage = "theme API is unavailable";
        }
      }
    }

    if (hasOwn(section, "locale")) {
      expectedCount += 1;
      if (resolved.i18nApi && typeof resolved.i18nApi.setLocale === "function") {
        var localeKey = (typeof resolved.i18nApi.STORAGE_KEY === "string" && resolved.i18nApi.STORAGE_KEY) ||
          DEFAULT_LOCALE_STORAGE_KEY;
        var localePersist = persistPreferenceKey(resolved.storage, resolved.storageError, localeKey, section.locale);
        if (!localePersist.ok) {
          persistFailed = true;
          var localePersistMsg = "could not persist locale '" + section.locale + "' (" + localePersist.message + ")";
          warnings.push("preferences: " + localePersistMsg);
          if (!persistErrorMessage) persistErrorMessage = localePersistMsg;
        } else {
          try {
            var localeRes = resolved.i18nApi.setLocale(section.locale);
            var currentLocale = typeof resolved.i18nApi.getLocale === "function"
              ? resolved.i18nApi.getLocale()
              : section.locale;
            if (localeRes === true || currentLocale === section.locale ||
                (localeRes === undefined && currentLocale === section.locale)) {
              var recheckLocale = null;
              try { recheckLocale = resolved.storage.getItem(localeKey); } catch (_leErr) { recheckLocale = null; }
              if (recheckLocale === section.locale) {
                applied.locale = section.locale;
                appliedCount += 1;
              } else {
                persistFailed = true;
                var localeVerifyMsg = "locale '" + section.locale + "' did not persist in local storage";
                warnings.push("preferences: " + localeVerifyMsg);
                if (!persistErrorMessage) persistErrorMessage = localeVerifyMsg;
              }
            } else {
              rollbackPreferenceKey(resolved.storage, localeKey, localePersist);
              var localeUnsupportedMsg = "locale '" + section.locale + "' could not be applied";
              warnings.push("preferences: " + localeUnsupportedMsg);
              if (!firstFailureMessage) {
                firstFailureCode = "unsupported_preference";
                firstFailureMessage = localeUnsupportedMsg;
              }
            }
          } catch (error) {
            rollbackPreferenceKey(resolved.storage, localeKey, localePersist);
            var localeErrMsg = error && error.message ? error.message : "could not apply locale";
            warnings.push("preferences: " + localeErrMsg);
            if (!firstFailureMessage) {
              firstFailureCode = (error && error.code) || "restore_failed";
              firstFailureMessage = localeErrMsg;
            }
          }
        }
      } else {
        warnings.push("preferences: i18n API is unavailable");
        if (!firstFailureMessage) {
          firstFailureCode = "storage_unavailable";
          firstFailureMessage = "i18n API is unavailable";
        }
      }
    }

    var ok = !persistFailed && (expectedCount === 0 || appliedCount > 0);
    if (!ok) {
      failedSections.push({
        section: "preferences",
        code: persistFailed ? "preferences_persist_failed" : (firstFailureCode || "restore_failed"),
        message: "preferences: " + (persistFailed ? persistErrorMessage : (firstFailureMessage || "restore failed"))
      });
    }

    return {
      ok: ok,
      appliedPreferences: applied,
      summary: {
        theme: applied.theme,
        locale: applied.locale,
        applied: appliedCount
      }
    };
  }

  function restoreBackup(parsedOrRaw, selectedSections, adapters) {
    return Promise.resolve().then(function () {
      var resolved = resolveRuntimeAdapters(adapters);
      var parsed;
      if (typeof parsedOrRaw === "string") {
        parsed = parseBackup(parsedOrRaw, resolved);
      } else if (isPlainObject(parsedOrRaw)) {
        // Re-validate strictly even if caller passes a pre-parsed object.
        scanTreeSecurity(parsedOrRaw, "backup", new Set());
        assertOnlyKeys(parsedOrRaw, ["format", "version", "exportedAt", "sections", "counts", "availableSections"], "backup");
        var envelopeCandidate = {
          format: parsedOrRaw.format,
          version: parsedOrRaw.version,
          exportedAt: parsedOrRaw.exportedAt,
          sections: parsedOrRaw.sections
        };
        var serialized = JSON.stringify(envelopeCandidate);
        if (exceedsUtf8ByteLimit(serialized, MAX_BACKUP_BYTES)) {
          fail("backup", "backup exceeds the 16 MiB size limit", "backup_too_large");
        }
        parsed = validateEnvelopeObject(envelopeCandidate, resolved);
      } else {
        fail("backup", "backup input must be a JSON string or parsed backup object");
      }

      var targetSections;
      if (selectedSections === undefined || selectedSections === null) {
        targetSections = parsed.availableSections.slice();
      } else {
        if (!Array.isArray(selectedSections)) {
          fail("selectedSections", "must be an array of section keys");
        }
        var selectedMap = Object.create(null);
        for (var i = 0; i < selectedSections.length; i += 1) {
          var key = selectedSections[i];
          if (typeof key !== "string" || SECTION_KEYS.indexOf(key) === -1) {
            fail("selectedSections", "unknown backup section " + String(key));
          }
          selectedMap[key] = true;
        }
        targetSections = SECTION_KEYS.filter(function (k) { return selectedMap[k] === true; });
      }

      var restored = {};
      var appliedPreferences = { theme: null, locale: null };
      var warnings = [];
      var succeededSections = [];
      var failedSections = [];
      var historyIdMap = {};
      var historyWasSelected = targetSections.indexOf("history") !== -1 && hasOwn(parsed.sections, "history");
      var historySucceeded = false;

      var chain = Promise.resolve();
      targetSections.forEach(function (sectionKey) {
        if (!hasOwn(parsed.sections, sectionKey)) {
          warnings.push(sectionKey + ": not present in backup");
          return;
        }
        chain = chain.then(function () {
          if (sectionKey === "history") {
            return restoreHistorySection(parsed.sections.history, resolved, warnings, failedSections, historyIdMap)
              .then(function (outcome) {
                restored.history = outcome.summary;
                if (outcome.ok) {
                  historySucceeded = true;
                  succeededSections.push("history");
                }
              });
          }
          if (sectionKey === "cardNotes") {
            return restoreCardNotesSection(parsed.sections.cardNotes, resolved, warnings, failedSections)
              .then(function (outcome) {
                restored.cardNotes = outcome.summary;
                if (outcome.ok) succeededSections.push("cardNotes");
              });
          }
          if (sectionKey === "customSpreads") {
            return restoreCustomSpreadsSection(parsed.sections.customSpreads, resolved, warnings, failedSections)
              .then(function (outcome) {
                restored.customSpreads = outcome.summary;
                if (outcome.ok) succeededSections.push("customSpreads");
              });
          }
          if (sectionKey === "aiChats") {
            return checkAiChatsHistoryDependency(
              parsed.sections.history,
              parsed.sections.aiChats,
              resolved,
              historyIdMap,
              historyWasSelected,
              historySucceeded
            ).then(function (dep) {
              if (!dep.ok) {
                recordSectionFailure(failedSections, warnings, "aiChats", dep.code, dep.message);
                restored.aiChats = { imported: 0, updated: 0, skipped: 0 };
                return undefined;
              }
              return restoreAiChatsSection(parsed.sections.aiChats, resolved, warnings, failedSections, historyIdMap)
                .then(function (outcome) {
                  restored.aiChats = outcome.summary;
                  if (outcome.ok) succeededSections.push("aiChats");
                });
            });
          }
          if (sectionKey === "preferences") {
            var prefOutcome = restorePreferencesSection(parsed.sections.preferences, resolved, warnings, failedSections);
            appliedPreferences = prefOutcome.appliedPreferences;
            restored.preferences = prefOutcome.summary;
            if (prefOutcome.ok) succeededSections.push("preferences");
            return undefined;
          }
          return undefined;
        });
      });

      return chain.then(function () {
        var status = "ok";
        if (failedSections.length > 0) {
          status = (targetSections.length > 0 && succeededSections.length === 0) ? "failed" : "partial";
        }
        return {
          status: status,
          restored: restored,
          appliedPreferences: appliedPreferences,
          succeededSections: succeededSections,
          failedSections: failedSections,
          historyIdMap: historyIdMap,
          warnings: warnings
        };
      });
    });
  }

  return {
    BACKUP_FORMAT: BACKUP_FORMAT,
    BACKUP_VERSION: BACKUP_VERSION,
    MAX_BACKUP_BYTES: MAX_BACKUP_BYTES,
    SECTION_KEYS: SECTION_KEYS,
    VALID_THEMES: VALID_THEMES,
    VALID_LOCALES: VALID_LOCALES,
    CUSTOM_SPREADS_FORMAT: CUSTOM_SPREADS_FORMAT,
    CUSTOM_SPREADS_VERSION: CUSTOM_SPREADS_VERSION,
    utf8ByteLength: utf8ByteLength,
    inspectLocalCounts: inspectLocalCounts,
    collectBackup: collectBackup,
    parseBackup: parseBackup,
    restoreBackup: restoreBackup
  };
});
