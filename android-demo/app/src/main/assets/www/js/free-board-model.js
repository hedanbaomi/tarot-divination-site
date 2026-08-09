(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FreeBoardModel = factory();
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA = "free-board/v1";
  var VERSION = 1;
  var LAYOUT_MODE = "freeform";
  var MAX_SAFE_INTEGER = 9007199254740991;
  var CARD_KEYS = [
    "cardId",
    "orientation",
    "x",
    "y",
    "boardRotation",
    "z",
    "revealed",
    "meaningVisible",
    "drawOrder"
  ];
  var VIEWPORT_KEYS = ["panX", "panY", "zoom"];
  var STATE_KEYS = ["layoutMode", "cards", "remainingPile", "viewport", "deck", "settings"];
  var DRAFT_KEYS = ["schema", "version"].concat(STATE_KEYS);
  var DRAW_OPTION_KEYS = [
    "orientation",
    "x",
    "y",
    "boardRotation",
    "revealed",
    "meaningVisible"
  ];
  var CONTROLLER_OPTION_KEYS = [
    "deck",
    "cardIds",
    "actualDeckCardIds",
    "settings",
    "initialState",
    "draft"
  ];
  var ORIENTATIONS = ["upright", "reversed"];
  var IDENTITY_KEYS = [
    "id",
    "deckId",
    "deckName",
    "name",
    "slug",
    "code",
    "deckCode",
    "kind",
    "type",
    "family"
  ];
  var LIMITS = Object.freeze({
    coordinateBound: 1000000,
    minZoom: 0.1,
    maxZoom: 4,
    maxDraftBytes: 512 * 1024,
    maxSnapshotDepth: 24
  });

  function FreeBoardValidationError(message, code) {
    this.name = "FreeBoardValidationError";
    this.code = code || "INVALID_STATE";
    this.message = message;
    if (Error.captureStackTrace) Error.captureStackTrace(this, FreeBoardValidationError);
  }

  FreeBoardValidationError.prototype = Object.create(Error.prototype);
  FreeBoardValidationError.prototype.constructor = FreeBoardValidationError;

  function fail(code, message) {
    throw new FreeBoardValidationError(message, code);
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;
    if (Object.prototype.toString.call(value) !== "[object Object]") return false;
    var prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    var constructor = prototype.constructor;
    return typeof constructor === "function" && constructor.name === "Object";
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isSafeInteger(value) {
    return isFiniteNumber(value) && Math.floor(value) === value &&
      Math.abs(value) <= MAX_SAFE_INTEGER;
  }

  function assertFiniteNumber(value, path) {
    if (!isFiniteNumber(value)) fail("NON_FINITE", path + " must be a finite number");
  }

  function assertCoordinate(value, path) {
    assertFiniteNumber(value, path);
    if (Math.abs(value) > LIMITS.coordinateBound) {
      fail("COORDINATE_OUT_OF_BOUNDS", path + " exceeds the coordinate bound of " +
        LIMITS.coordinateBound);
    }
  }

  function assertZoom(value, path) {
    assertFiniteNumber(value, path);
    if (value < LIMITS.minZoom || value > LIMITS.maxZoom) {
      fail("BAD_ZOOM", path + " must be between " + LIMITS.minZoom + " and " + LIMITS.maxZoom);
    }
  }

  function assertSafePositiveInteger(value, path) {
    if (!isSafeInteger(value) || value < 1) {
      fail("BAD_INTEGER", path + " must be a positive safe integer");
    }
  }

  function assertString(value, path) {
    if (typeof value !== "string" || value.length === 0 || value.trim().length === 0) {
      fail("BAD_STRING", path + " must be a non-empty string");
    }
  }

  function assertBoolean(value, path) {
    if (typeof value !== "boolean") fail("BAD_BOOLEAN", path + " must be a boolean");
  }

  function assertAllowedKeys(value, allowedKeys, path) {
    var allowed = new Set(allowedKeys);
    Object.keys(value).forEach(function (key) {
      if (!allowed.has(key)) fail("UNKNOWN_KEY", path + " contains unknown key " + key);
    });
  }

  function assertExactKeys(value, expectedKeys, path) {
    assertAllowedKeys(value, expectedKeys, path);
    var expected = new Set(expectedKeys);
    Object.keys(value).forEach(function (key) { expected.delete(key); });
    if (expected.size > 0) {
      fail("MISSING_KEY", path + " is missing key " + Array.from(expected).join(", "));
    }
  }

  function utf8ByteLength(text) {
    var bytes = 0;
    var index;
    for (index = 0; index < text.length; index += 1) {
      var code = text.charCodeAt(index);
      if (code <= 0x7f) {
        bytes += 1;
      } else if (code <= 0x7ff) {
        bytes += 2;
      } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
        var next = text.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else {
          bytes += 3;
        }
      } else {
        bytes += 3;
      }
    }
    return bytes;
  }

  function cloneJson(value, path, depth, seen) {
    path = path || "value";
    depth = depth || 0;
    seen = seen || [];
    if (depth > LIMITS.maxSnapshotDepth) {
      fail("SNAPSHOT_TOO_DEEP", path + " exceeds the maximum snapshot depth");
    }
    if (value === null) return null;
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!isFiniteNumber(value)) fail("NON_FINITE", path + " must be finite");
      return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value !== "object") {
      fail("NOT_JSON_VALUE", path + " must contain JSON-compatible values");
    }
    if (seen.indexOf(value) !== -1) fail("CYCLIC_VALUE", path + " must not contain cycles");
    seen.push(value);
    var copy;
    var index;
    if (Array.isArray(value)) {
      copy = [];
      for (index = 0; index < value.length; index += 1) {
        copy.push(cloneJson(value[index], path + "[" + index + "]", depth + 1, seen));
      }
    } else {
      if (!isPlainObject(value)) fail("NOT_JSON_OBJECT", path + " must be a plain object");
      copy = {};
      Object.keys(value).forEach(function (key) {
        if (key === "__proto__" || key === "prototype" || key === "constructor") {
          fail("UNSAFE_KEY", path + " contains unsafe key " + key);
        }
        copy[key] = cloneJson(value[key], path + "." + key, depth + 1, seen);
      });
    }
    seen.pop();
    return copy;
  }

  function deepFreeze(value, seen) {
    if (value === null || typeof value !== "object") return value;
    seen = seen || [];
    if (seen.indexOf(value) !== -1) return value;
    seen.push(value);
    Object.keys(value).forEach(function (key) { deepFreeze(value[key], seen); });
    seen.pop();
    return Object.freeze(value);
  }

  function jsonEqual(left, right) {
    if (left === right) return true;
    if (left === null || right === null) return false;
    if (typeof left !== typeof right) return false;
    if (typeof left !== "object") return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    if (Array.isArray(left)) {
      if (left.length !== right.length) return false;
      return left.every(function (value, index) { return jsonEqual(value, right[index]); });
    }
    var leftKeys = Object.keys(left);
    var rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every(function (key) {
      return hasOwn(right, key) && jsonEqual(left[key], right[key]);
    });
  }

  function normalizeDegrees(value, path) {
    assertFiniteNumber(value, path);
    var normalized = value % 360;
    if (normalized < 0) normalized += 360;
    return Object.is(normalized, -0) ? 0 : normalized;
  }

  function validateOrientation(value, path) {
    if (ORIENTATIONS.indexOf(value) === -1) {
      fail("BAD_ORIENTATION", path + " must be upright or reversed");
    }
  }

  function validateCardRecord(card, meta, path) {
    if (!isPlainObject(card)) fail("BAD_CARD", path + " must be an object");
    assertExactKeys(card, CARD_KEYS, path);
    assertString(card.cardId, path + ".cardId");
    if (!meta.cardIdSet.has(card.cardId)) fail("UNKNOWN_CARD", path + ".cardId is not in the supplied deck");
    validateOrientation(card.orientation, path + ".orientation");
    assertCoordinate(card.x, path + ".x");
    assertCoordinate(card.y, path + ".y");
    var boardRotation = normalizeDegrees(card.boardRotation, path + ".boardRotation");
    assertSafePositiveInteger(card.z, path + ".z");
    assertBoolean(card.revealed, path + ".revealed");
    assertBoolean(card.meaningVisible, path + ".meaningVisible");
    assertSafePositiveInteger(card.drawOrder, path + ".drawOrder");
    if (meta.specialDeck && meta.nonTarotCardIds.has(card.cardId) && card.orientation !== "upright") {
      fail("NON_TAROT_ORIENTATION", path + ".orientation must be upright for a non-Tarot Mystagogus/LXXXI card");
    }
    return {
      cardId: card.cardId,
      orientation: card.orientation,
      x: Object.is(card.x, -0) ? 0 : card.x,
      y: Object.is(card.y, -0) ? 0 : card.y,
      boardRotation: boardRotation,
      z: card.z,
      revealed: card.revealed,
      meaningVisible: card.meaningVisible,
      drawOrder: card.drawOrder
    };
  }

  function validateViewport(viewport, path) {
    if (!isPlainObject(viewport)) fail("BAD_VIEWPORT", path + " must be an object");
    assertExactKeys(viewport, VIEWPORT_KEYS, path);
    assertCoordinate(viewport.panX, path + ".panX");
    assertCoordinate(viewport.panY, path + ".panY");
    assertZoom(viewport.zoom, path + ".zoom");
    return {
      panX: Object.is(viewport.panX, -0) ? 0 : viewport.panX,
      panY: Object.is(viewport.panY, -0) ? 0 : viewport.panY,
      zoom: viewport.zoom
    };
  }

  function validateCardIdArray(cardIds, path) {
    if (!Array.isArray(cardIds) || cardIds.length === 0) {
      fail("BAD_DECK", path + " must be a non-empty array");
    }
    var seen = new Set();
    return cardIds.map(function (cardId, index) {
      assertString(cardId, path + "[" + index + "]");
      if (seen.has(cardId)) fail("DUPLICATE_CARD", path + " contains duplicate card " + cardId);
      seen.add(cardId);
      return cardId;
    });
  }

  function descriptorCardId(descriptor, path) {
    if (typeof descriptor === "string") {
      assertString(descriptor, path);
      return descriptor;
    }
    if (!isPlainObject(descriptor)) fail("BAD_DECK", path + " must be a card descriptor or card ID");
    var cardId = hasOwn(descriptor, "cardId") ? descriptor.cardId : descriptor.id;
    assertString(cardId, path + ".cardId");
    return cardId;
  }

  function descriptorIsNonTarot(descriptor, path) {
    if (typeof descriptor === "string") return false;
    var explicitKeys = ["isTarot", "isTarotCard", "tarot"];
    for (var index = 0; index < explicitKeys.length; index += 1) {
      var key = explicitKeys[index];
      if (hasOwn(descriptor, key)) {
        if (typeof descriptor[key] !== "boolean") {
          fail("BAD_DECK", path + "." + key + " must be a boolean");
        }
        return descriptor[key] === false;
      }
    }
    var type = descriptor.cardType || descriptor.type || descriptor.category;
    if (typeof type === "string") {
      var normalized = type.toLowerCase().replace(/[_\s]+/g, "-");
      return normalized === "non-tarot" || normalized === "oracle" || normalized === "sigil";
    }
    return false;
  }

  function snapshotIdentityText(snapshot) {
    var values = [];
    if (!isPlainObject(snapshot)) return "";
    IDENTITY_KEYS.forEach(function (key) {
      if (typeof snapshot[key] === "string") values.push(snapshot[key].toLowerCase());
    });
    ["metadata", "deck", "cardSet"].forEach(function (key) {
      if (isPlainObject(snapshot[key])) values.push(snapshotIdentityText(snapshot[key]));
    });
    return values.join(" ");
  }

  function normalizeSettings(settingsInput) {
    if (settingsInput === undefined) return {};
    var settings = cloneJson(settingsInput, "settings");
    if (!isPlainObject(settings)) fail("BAD_SETTINGS", "settings must be a plain object");
    return settings;
  }

  function buildDeckMeta(deckInput, settingsSnapshot) {
    var rawDeck = Array.isArray(deckInput) ? { cardIds: deckInput } : deckInput;
    var deckSnapshot = cloneJson(rawDeck, "deck");
    if (!isPlainObject(deckSnapshot)) fail("BAD_DECK", "deck must be a plain object or card ID array");

    var descriptorIds = null;
    var descriptors = null;
    if (hasOwn(deckSnapshot, "cards")) {
      if (!Array.isArray(deckSnapshot.cards) || deckSnapshot.cards.length === 0) {
        fail("BAD_DECK", "deck.cards must be a non-empty array");
      }
      descriptors = deckSnapshot.cards;
      descriptorIds = descriptors.map(function (descriptor, index) {
        return descriptorCardId(descriptor, "deck.cards[" + index + "]");
      });
      validateCardIdArray(descriptorIds, "deck.cards");
    }

    var cardIds;
    if (hasOwn(deckSnapshot, "cardIds")) {
      cardIds = validateCardIdArray(deckSnapshot.cardIds, "deck.cardIds");
      if (descriptorIds && (descriptorIds.length !== cardIds.length ||
          !cardIds.every(function (cardId) { return descriptorIds.indexOf(cardId) !== -1; }))) {
        fail("BAD_DECK", "deck.cardIds and deck.cards must describe the same cards");
      }
    } else if (descriptorIds) {
      cardIds = descriptorIds.slice();
    } else {
      fail("BAD_DECK", "deck must supply cardIds or cards");
    }

    var cardIdSet = new Set(cardIds);
    var nonTarotCardIds = new Set();
    if (descriptors) {
      descriptors.forEach(function (descriptor, index) {
        if (descriptorIsNonTarot(descriptor, "deck.cards[" + index + "]")) {
          nonTarotCardIds.add(descriptorIds[index]);
        }
      });
    }
    [deckSnapshot, settingsSnapshot].forEach(function (snapshot, snapshotIndex) {
      if (!hasOwn(snapshot, "nonTarotCardIds")) return;
      var path = snapshotIndex === 0 ? "deck.nonTarotCardIds" : "settings.nonTarotCardIds";
      validateCardIdArray(snapshot.nonTarotCardIds, path).forEach(function (cardId) {
        if (!cardIdSet.has(cardId)) fail("UNKNOWN_CARD", path + " contains unknown card " + cardId);
        nonTarotCardIds.add(cardId);
      });
    });

    var identity = snapshotIdentityText(deckSnapshot) + " " + snapshotIdentityText(settingsSnapshot);
    return {
      deckSnapshot: deckSnapshot,
      settingsSnapshot: settingsSnapshot,
      cardIds: cardIds,
      cardIdSet: cardIdSet,
      nonTarotCardIds: nonTarotCardIds,
      specialDeck: /mystagogus|lxxxi/.test(identity)
    };
  }

  function validateState(candidate, meta, requireSnapshots) {
    if (!isPlainObject(candidate)) fail("BAD_STATE", "state must be a plain object");
    assertExactKeys(candidate, STATE_KEYS, "state");
    if (candidate.layoutMode !== LAYOUT_MODE) fail("BAD_LAYOUT_MODE", "layoutMode must be freeform");

    var deckSnapshot = cloneJson(candidate.deck, "state.deck");
    var settingsSnapshot = cloneJson(candidate.settings, "state.settings");
    if (!isPlainObject(settingsSnapshot)) fail("BAD_SETTINGS", "state.settings must be a plain object");
    if (requireSnapshots && !jsonEqual(deckSnapshot, meta.deckSnapshot)) {
      fail("DECK_SNAPSHOT_MISMATCH", "state.deck must match the supplied deck snapshot");
    }
    if (requireSnapshots && !jsonEqual(settingsSnapshot, meta.settingsSnapshot)) {
      fail("SETTINGS_SNAPSHOT_MISMATCH", "state.settings must match the supplied settings snapshot");
    }

    if (!Array.isArray(candidate.cards)) fail("BAD_CARDS", "state.cards must be an array");
    if (!Array.isArray(candidate.remainingPile)) fail("BAD_PILE", "state.remainingPile must be an array");
    var viewport = validateViewport(candidate.viewport, "state.viewport");
    var cards = [];
    var seenCardIds = new Set();
    var seenZ = new Set();
    var seenDrawOrder = new Set();

    candidate.cards.forEach(function (card, index) {
      var normalizedCard = validateCardRecord(card, meta, "state.cards[" + index + "]");
      if (seenCardIds.has(normalizedCard.cardId)) {
        fail("DUPLICATE_CARD", "state contains duplicate card " + normalizedCard.cardId);
      }
      if (seenZ.has(normalizedCard.z)) fail("DUPLICATE_Z", "state contains duplicate z " + normalizedCard.z);
      if (seenDrawOrder.has(normalizedCard.drawOrder)) {
        fail("DUPLICATE_DRAW_ORDER", "state contains duplicate drawOrder " + normalizedCard.drawOrder);
      }
      seenCardIds.add(normalizedCard.cardId);
      seenZ.add(normalizedCard.z);
      seenDrawOrder.add(normalizedCard.drawOrder);
      cards.push(normalizedCard);
    });

    var remainingPile = candidate.remainingPile.map(function (cardId, index) {
      assertString(cardId, "state.remainingPile[" + index + "]");
      if (!meta.cardIdSet.has(cardId)) fail("UNKNOWN_CARD", "state.remainingPile contains " + cardId);
      if (seenCardIds.has(cardId)) fail("DUPLICATE_CARD", "card appears in both board and pile: " + cardId);
      seenCardIds.add(cardId);
      return cardId;
    });

    if (seenCardIds.size !== meta.cardIds.length) {
      var missing = meta.cardIds.filter(function (cardId) { return !seenCardIds.has(cardId); });
      fail("MISSING_CARD", "state does not account for deck card(s): " + missing.join(", "));
    }

    return {
      layoutMode: LAYOUT_MODE,
      cards: cards,
      remainingPile: remainingPile,
      viewport: viewport,
      deck: deckSnapshot,
      settings: settingsSnapshot
    };
  }

  function copyCard(card) {
    return {
      cardId: card.cardId,
      orientation: card.orientation,
      x: card.x,
      y: card.y,
      boardRotation: card.boardRotation,
      z: card.z,
      revealed: card.revealed,
      meaningVisible: card.meaningVisible,
      drawOrder: card.drawOrder
    };
  }

  function cloneInternalState(state) {
    return {
      layoutMode: state.layoutMode,
      cards: state.cards.map(copyCard),
      remainingPile: state.remainingPile.slice(),
      viewport: {
        panX: state.viewport.panX,
        panY: state.viewport.panY,
        zoom: state.viewport.zoom
      },
      deck: cloneJson(state.deck, "state.deck"),
      settings: cloneJson(state.settings, "state.settings")
    };
  }

  function compareCards(left, right) {
    if (left.z !== right.z) return left.z - right.z;
    if (left.drawOrder !== right.drawOrder) return left.drawOrder - right.drawOrder;
    return left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0;
  }

  function toPublicState(state) {
    var snapshot = {
      layoutMode: state.layoutMode,
      cards: state.cards.slice().sort(compareCards).map(copyCard),
      remainingPile: state.remainingPile.slice(),
      viewport: {
        panX: state.viewport.panX,
        panY: state.viewport.panY,
        zoom: state.viewport.zoom
      },
      deck: cloneJson(state.deck, "state.deck"),
      settings: cloneJson(state.settings, "state.settings")
    };
    return deepFreeze(snapshot);
  }

  function emptyState(meta) {
    return validateState({
      layoutMode: LAYOUT_MODE,
      cards: [],
      remainingPile: meta.cardIds.slice(),
      viewport: { panX: 0, panY: 0, zoom: 1 },
      deck: cloneJson(meta.deckSnapshot, "deck"),
      settings: cloneJson(meta.settingsSnapshot, "settings")
    }, meta, true);
  }

  function parsedDraftToState(draft) {
    return {
      layoutMode: draft.layoutMode,
      cards: draft.cards,
      remainingPile: draft.remainingPile,
      viewport: draft.viewport,
      deck: draft.deck,
      settings: draft.settings
    };
  }

  function normalizedDraftState(draft, meta) {
    var state = validateState(parsedDraftToState(draft), meta, true);
    compactDrawOrders(state.cards);
    return state;
  }

  function parseDraft(input) {
    var raw;
    if (typeof input === "string") {
      if (utf8ByteLength(input) > LIMITS.maxDraftBytes) {
        fail("DRAFT_TOO_LARGE", "draft exceeds the maximum size of " + LIMITS.maxDraftBytes + " bytes");
      }
      try {
        raw = JSON.parse(input);
      } catch (error) {
        fail("BAD_DRAFT", "draft is not valid JSON");
      }
    } else {
      raw = input;
      if (raw === null || typeof raw !== "object") fail("BAD_DRAFT", "draft must be a JSON string or object");
    }
    raw = cloneJson(raw, "draft");
    if (!isPlainObject(raw)) fail("BAD_DRAFT", "draft root must be an object");
    assertExactKeys(raw, DRAFT_KEYS, "draft");
    if (raw.schema !== SCHEMA || raw.version !== VERSION) {
      fail("BAD_DRAFT_VERSION", "draft schema must be " + SCHEMA + " version " + VERSION);
    }
    if (utf8ByteLength(JSON.stringify(raw)) > LIMITS.maxDraftBytes) {
      fail("DRAFT_TOO_LARGE", "draft exceeds the maximum size of " + LIMITS.maxDraftBytes + " bytes");
    }
    return raw;
  }

  function serializeDraftState(state) {
    var draft = {
      schema: SCHEMA,
      version: VERSION,
      layoutMode: state.layoutMode,
      cards: state.cards.slice().sort(compareCards).map(copyCard),
      remainingPile: state.remainingPile.slice(),
      viewport: {
        panX: state.viewport.panX,
        panY: state.viewport.panY,
        zoom: state.viewport.zoom
      },
      deck: cloneJson(state.deck, "state.deck"),
      settings: cloneJson(state.settings, "state.settings")
    };
    var serialized = JSON.stringify(draft);
    if (utf8ByteLength(serialized) > LIMITS.maxDraftBytes) {
      fail("DRAFT_TOO_LARGE", "draft exceeds the maximum size of " + LIMITS.maxDraftBytes + " bytes");
    }
    return serialized;
  }

  function hasDeckInput(options) {
    return ["deck", "cardIds", "actualDeckCardIds"].some(function (key) {
      return hasOwn(options, key);
    });
  }

  function resolveDeckInput(options, parsedDraft) {
    var keys = ["deck", "cardIds", "actualDeckCardIds"].filter(function (key) {
      return hasOwn(options, key);
    });
    if (keys.length > 1) fail("BAD_OPTIONS", "supply only one of deck, cardIds, or actualDeckCardIds");
    if (keys.length === 1) return options[keys[0]];
    if (parsedDraft) return parsedDraft.deck;
    fail("BAD_OPTIONS", "a supplied deck or actual card ID list is required");
  }

  function normalizeControllerOptions(options) {
    if (options === undefined) options = {};
    if (!isPlainObject(options)) fail("BAD_OPTIONS", "controller options must be a plain object");
    assertAllowedKeys(options, CONTROLLER_OPTION_KEYS, "controller options");
    if (hasOwn(options, "draft") && options.draft === undefined) fail("BAD_OPTIONS", "draft cannot be undefined");
    if (hasOwn(options, "initialState") && options.initialState === undefined) {
      fail("BAD_OPTIONS", "initialState cannot be undefined");
    }
    if (hasOwn(options, "settings") && options.settings === undefined) fail("BAD_OPTIONS", "settings cannot be undefined");
    return options;
  }

  function nextAvailableInteger(cards, key) {
    var max = 0;
    cards.forEach(function (card) {
      if (card[key] > max) max = card[key];
    });
    if (max >= MAX_SAFE_INTEGER) fail("INTEGER_EXHAUSTED", key + " cannot be incremented safely");
    return max + 1;
  }

  function compactDrawOrders(cards) {
    cards.slice().sort(function (left, right) {
      if (left.drawOrder !== right.drawOrder) return left.drawOrder - right.drawOrder;
      return left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0;
    }).forEach(function (card, index) {
      card.drawOrder = index + 1;
    });
  }

  function normalizeDrawOptions(options) {
    if (options === undefined) return {};
    if (!isPlainObject(options)) fail("BAD_OPTIONS", "draw options must be a plain object");
    assertAllowedKeys(options, DRAW_OPTION_KEYS, "draw options");
    return options;
  }

  function cardOption(options, key, defaultValue) {
    return hasOwn(options, key) ? options[key] : defaultValue;
  }

  function newCard(cardId, options, z, drawOrder, meta) {
    options = normalizeDrawOptions(options);
    return validateCardRecord({
      cardId: cardId,
      orientation: cardOption(options, "orientation", "upright"),
      x: cardOption(options, "x", 0),
      y: cardOption(options, "y", 0),
      boardRotation: cardOption(options, "boardRotation", 0),
      z: z,
      revealed: cardOption(options, "revealed", false),
      meaningVisible: cardOption(options, "meaningVisible", false),
      drawOrder: drawOrder
    }, meta, "drawn card");
  }

  function FreeBoardController(options) {
    options = normalizeControllerOptions(options);
    var parsedDraft = hasOwn(options, "draft") ? parseDraft(options.draft) : null;
    var deckInput = resolveDeckInput(options, parsedDraft);
    var settingsInput = hasOwn(options, "settings") ? options.settings : parsedDraft ? parsedDraft.settings : {};
    var settingsSnapshot = normalizeSettings(settingsInput);
    this._meta = buildDeckMeta(deckInput, settingsSnapshot);
    this._state = emptyState(this._meta);
    this._undo = [];
    this._redo = [];
    this._syncCounters();

    if (hasOwn(options, "initialState") && parsedDraft) {
      fail("BAD_OPTIONS", "initialState and draft cannot both be supplied");
    }
    if (hasOwn(options, "initialState")) {
      this._state = validateState(options.initialState, this._meta, true);
      compactDrawOrders(this._state.cards);
      this._syncCounters();
    }
    if (parsedDraft) {
      this._state = normalizedDraftState(parsedDraft, this._meta);
      this._syncCounters();
    }
  }

  FreeBoardController.prototype._syncCounters = function () {
    this._nextZ = nextAvailableInteger(this._state.cards, "z");
    this._nextDrawOrder = nextAvailableInteger(this._state.cards, "drawOrder");
  };

  FreeBoardController.prototype._commit = function (candidate) {
    var next = validateState(candidate, this._meta, true);
    if (jsonEqual(this._state, next)) return false;
    this._undo.push(cloneInternalState(this._state));
    this._redo.length = 0;
    this._state = next;
    this._syncCounters();
    return true;
  };

  FreeBoardController.prototype._cardIndex = function (cardId) {
    assertString(cardId, "cardId");
    if (!this._meta.cardIdSet.has(cardId)) fail("UNKNOWN_CARD", "unknown card " + cardId);
    var index = this._state.cards.findIndex(function (card) { return card.cardId === cardId; });
    if (index === -1) fail("CARD_NOT_ON_BOARD", "card " + cardId + " is not on the board");
    return index;
  };

  FreeBoardController.prototype.getState = function () {
    return toPublicState(this._state);
  };

  FreeBoardController.prototype.getCard = function (cardId) {
    var index = this._cardIndex(cardId);
    return deepFreeze(copyCard(this._state.cards[index]));
  };

  FreeBoardController.prototype.draw = function (cardId, options) {
    if (isPlainObject(cardId) && options === undefined) {
      options = cardId;
      cardId = undefined;
    }
    if (this._state.remainingPile.length === 0) fail("PILE_EMPTY", "remaining pile is empty");
    var pileIndex;
    if (cardId === undefined) {
      pileIndex = 0;
      cardId = this._state.remainingPile[0];
    } else {
      assertString(cardId, "cardId");
      pileIndex = this._state.remainingPile.indexOf(cardId);
      if (pileIndex === -1) {
        if (!this._meta.cardIdSet.has(cardId)) fail("UNKNOWN_CARD", "unknown card " + cardId);
        fail("CARD_ALREADY_ON_BOARD", "card " + cardId + " is already on the board");
      }
    }
    var next = cloneInternalState(this._state);
    next.remainingPile.splice(pileIndex, 1);
    next.cards.push(newCard(cardId, options, this._nextZ, this._nextDrawOrder, this._meta));
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.addFromPile = function (cardId, options) {
    return this.draw(cardId, options);
  };

  FreeBoardController.prototype.addCard = function (cardId, options) {
    return this.draw(cardId, options);
  };

  FreeBoardController.prototype.removeCard = function (cardId) {
    var index = this._cardIndex(cardId);
    var next = cloneInternalState(this._state);
    next.cards.splice(index, 1);
    compactDrawOrders(next.cards);
    next.remainingPile.push(cardId);
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.remove = function (cardId) {
    return this.removeCard(cardId);
  };

  FreeBoardController.prototype.move = function (cardId, x, y) {
    if (isPlainObject(x) && y === undefined) {
      assertExactKeys(x, ["x", "y"], "move coordinates");
      y = x.y;
      x = x.x;
    }
    assertCoordinate(x, "x");
    assertCoordinate(y, "y");
    var index = this._cardIndex(cardId);
    var next = cloneInternalState(this._state);
    next.cards[index].x = Object.is(x, -0) ? 0 : x;
    next.cards[index].y = Object.is(y, -0) ? 0 : y;
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.moveCard = function (cardId, x, y) {
    return this.move(cardId, x, y);
  };

  FreeBoardController.prototype.rotate = function (cardId, boardRotation) {
    var rotation = normalizeDegrees(boardRotation, "boardRotation");
    var index = this._cardIndex(cardId);
    var next = cloneInternalState(this._state);
    next.cards[index].boardRotation = rotation;
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.rotateBy = function (cardId, degrees) {
    assertFiniteNumber(degrees, "degrees");
    var index = this._cardIndex(cardId);
    return this.rotate(cardId, this._state.cards[index].boardRotation + degrees);
  };

  FreeBoardController.prototype.setOrientation = function (cardId, orientation) {
    validateOrientation(orientation, "orientation");
    var index = this._cardIndex(cardId);
    var next = cloneInternalState(this._state);
    next.cards[index].orientation = orientation;
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.flip = function (cardId) {
    var index = this._cardIndex(cardId);
    return this.setOrientation(cardId,
      this._state.cards[index].orientation === "upright" ? "reversed" : "upright");
  };

  FreeBoardController.prototype.bringToFront = function (cardId) {
    var index = this._cardIndex(cardId);
    var highest = this._state.cards.reduce(function (max, card) {
      return Math.max(max, card.z);
    }, 0);
    if (this._state.cards[index].z < highest) {
      if (highest >= MAX_SAFE_INTEGER) fail("INTEGER_EXHAUSTED", "z cannot be incremented safely");
      var next = cloneInternalState(this._state);
      next.cards[index].z = highest + 1;
      this._commit(next);
    }
    return this.getState();
  };

  FreeBoardController.prototype.setRevealed = function (cardId, revealed) {
    assertBoolean(revealed, "revealed");
    var index = this._cardIndex(cardId);
    var next = cloneInternalState(this._state);
    next.cards[index].revealed = revealed;
    if (!revealed) next.cards[index].meaningVisible = false;
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.reveal = function (cardId) {
    return this.setRevealed(cardId, true);
  };

  FreeBoardController.prototype.hide = function (cardId) {
    return this.setRevealed(cardId, false);
  };

  FreeBoardController.prototype.setMeaningVisible = function (cardId, meaningVisible) {
    assertBoolean(meaningVisible, "meaningVisible");
    var index = this._cardIndex(cardId);
    var next = cloneInternalState(this._state);
    next.cards[index].meaningVisible = meaningVisible;
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.toggleMeaning = function (cardId) {
    var index = this._cardIndex(cardId);
    return this.setMeaningVisible(cardId, !this._state.cards[index].meaningVisible);
  };

  FreeBoardController.prototype.revealAll = function () {
    var next = cloneInternalState(this._state);
    next.cards.forEach(function (card) { card.revealed = true; });
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.setViewport = function (viewport) {
    if (!isPlainObject(viewport)) fail("BAD_VIEWPORT", "viewport must be a plain object");
    assertAllowedKeys(viewport, VIEWPORT_KEYS, "viewport");
    var next = cloneInternalState(this._state);
    VIEWPORT_KEYS.forEach(function (key) {
      if (hasOwn(viewport, key)) next.viewport[key] = viewport[key];
    });
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.panViewport = function (deltaX, deltaY) {
    assertFiniteNumber(deltaX, "deltaX");
    assertFiniteNumber(deltaY, "deltaY");
    var next = cloneInternalState(this._state);
    next.viewport.panX += deltaX;
    next.viewport.panY += deltaY;
    validateViewport(next.viewport, "viewport");
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.zoomViewport = function (zoom) {
    assertZoom(zoom, "zoom");
    var next = cloneInternalState(this._state);
    next.viewport.zoom = zoom;
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.resetViewport = function () {
    var next = cloneInternalState(this._state);
    next.viewport = { panX: 0, panY: 0, zoom: 1 };
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.clear = function () {
    var next = cloneInternalState(this._state);
    next.cards = [];
    next.remainingPile = this._meta.cardIds.slice();
    this._commit(next);
    return this.getState();
  };

  FreeBoardController.prototype.canUndo = function () {
    return this._undo.length > 0;
  };

  FreeBoardController.prototype.canRedo = function () {
    return this._redo.length > 0;
  };

  FreeBoardController.prototype.undo = function () {
    if (this._undo.length === 0) return this.getState();
    this._redo.push(cloneInternalState(this._state));
    this._state = validateState(this._undo.pop(), this._meta, true);
    this._syncCounters();
    return this.getState();
  };

  FreeBoardController.prototype.redo = function () {
    if (this._redo.length === 0) return this.getState();
    this._undo.push(cloneInternalState(this._state));
    this._state = validateState(this._redo.pop(), this._meta, true);
    this._syncCounters();
    return this.getState();
  };

  FreeBoardController.prototype.serializeDraft = function () {
    return serializeDraftState(this._state);
  };

  FreeBoardController.prototype.restoreDraft = function (draft) {
    var parsed = parseDraft(draft);
    var next = normalizedDraftState(parsed, this._meta);
    this._state = next;
    this._undo = [];
    this._redo = [];
    this._syncCounters();
    return this.getState();
  };

  function createController(options) {
    return new FreeBoardController(options);
  }

  function restoreDraft(draft, options) {
    var parsed = parseDraft(draft);
    var controllerOptions = {};
    if (options !== undefined) {
      options = normalizeControllerOptions(options);
      Object.keys(options).forEach(function (key) { controllerOptions[key] = options[key]; });
    }
    if (!hasDeckInput(controllerOptions)) controllerOptions.deck = parsed.deck;
    if (!hasOwn(controllerOptions, "settings")) controllerOptions.settings = parsed.settings;
    controllerOptions.draft = parsed;
    return new FreeBoardController(controllerOptions);
  }

  return Object.freeze({
    SCHEMA: SCHEMA,
    VERSION: VERSION,
    LAYOUT_MODE: LAYOUT_MODE,
    ORIENTATIONS: Object.freeze(ORIENTATIONS.slice()),
    LIMITS: LIMITS,
    FreeBoardValidationError: FreeBoardValidationError,
    FreeBoardController: FreeBoardController,
    createController: createController,
    createFreeBoard: createController,
    restoreDraft: restoreDraft,
    fromDraft: restoreDraft
  });
}));
