(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DivinationHistoryRecords = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA_VERSION = 1;
  var SCHEMA_V2_VERSION = 2;
  var SCHEMA_V3_VERSION = 3;
  var FORMAT_VERSION = 1;
  var FORMAT_VERSION_V2 = 2;
  var FORMAT_VERSION_V3 = 3;
  var MAX_RECORDS = 5000;
  var MAX_CARDS = 100;
  var MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  var MAX_WORLD_COORDINATE = 1000000;
  var MAX_BOARD_ROTATION = 360;
  var MAX_SAFE_INTEGER = 9007199254740991;
  var DECK_TYPES = ["tarot", "mystagogus", "lxxxi"];
  var DECK_CARD_LIMITS = {
    tarot: 78,
    mystagogus: 78,
    lxxxi: 81
  };
  var ORIENTATION_MODES = ["upright-only", "mixed"];
  var ORIENTATIONS = ["upright", "reversed"];
  var FILTER_MODES = [
    "mixed",
    "major-only",
    "minor-only",
    "major-then-minor",
    "minor-then-major",
    "not-applicable"
  ];
  var OVERVIEW_METHODS = ["single", "stacked", "not-applicable"];
  var LAYERS = [null, "major", "minor"];
  var ARCANAS = ["major", "minor", "mystagogus", "lxxxi"];
  var RECORD_KEYS = [
    "schemaVersion",
    "id",
    "createdAt",
    "deckType",
    "deckMode",
    "deckName",
    "spreadId",
    "spreadName",
    "positionCount",
    "orientationMode",
    "filterMode",
    "overviewMethod",
    "cards"
  ];
  var CARD_KEYS = [
    "cardId",
    "cardNumber",
    "cardName",
    "orientation",
    "slotIndex",
    "positionNumber",
    "positionName",
    "layer",
    "arcana",
    "suit"
  ];
  var V2_PRESET_RECORD_KEYS = [
    "schemaVersion",
    "layoutMode",
    "id",
    "createdAt",
    "deckType",
    "deckMode",
    "deckName",
    "spreadId",
    "spreadName",
    "positionCount",
    "orientationMode",
    "filterMode",
    "overviewMethod",
    "cards"
  ];
  var FREEFORM_RECORD_KEYS = [
    "schemaVersion",
    "layoutMode",
    "id",
    "createdAt",
    "deckType",
    "deckMode",
    "deckName",
    "orientationMode",
    "filterMode",
    "overviewMethod",
    "cards"
  ];
  var FREEFORM_CARD_KEYS = [
    "cardId",
    "cardNumber",
    "cardName",
    "arcana",
    "suit",
    "orientation",
    "revealed",
    "x",
    "y",
    "boardRotation",
    "z",
    "drawOrder"
  ];
  var ORDER_ONLY_FREEFORM_RECORD_KEYS = [
    "schemaVersion",
    "layoutMode",
    "id",
    "createdAt",
    "deckType",
    "deckMode",
    "deckName",
    "orientationMode",
    "filterMode",
    "overviewMethod",
    "cards"
  ];
  var ORDER_ONLY_FREEFORM_CARD_KEYS = [
    "cardId",
    "cardNumber",
    "cardName",
    "arcana",
    "suit",
    "orientation",
    "revealed",
    "drawOrder"
  ];
  var LAYOUT_SNAPSHOT_KEYS = ["cards"];
  var LAYOUT_SNAPSHOT_CARD_KEYS = ["cardId", "x", "y", "boardRotation", "z", "drawOrder"];
  var WORLD_KEYS = ["x", "y"];

  function fail(path, message) {
    throw new Error(path + ": " + message);
  }

  function isPlainObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  }

  function assertPlainObject(value, path) {
    if (!isPlainObject(value)) fail(path, "must be a plain object");
  }

  function assertOnlyKeys(value, allowed, path) {
    Object.keys(value).forEach(function (key) {
      if (allowed.indexOf(key) === -1) fail(path, "unexpected field " + key);
    });
  }

  function assertString(value, path, min, max) {
    if (typeof value !== "string" || value.length < min || value.length > max) {
      fail(path, "must be a string between " + min + " and " + max + " characters");
    }
  }

  function assertInteger(value, path, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
      fail(path, "must be an integer between " + min + " and " + max);
    }
  }

  function assertBoolean(value, path) {
    if (typeof value !== "boolean") fail(path, "must be a boolean");
  }

  function assertBoundedNumber(value, path, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
      fail(path, "must be a finite number between " + min + " and " + max);
    }
  }

  function assertPositiveSafeInteger(value, path) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_SAFE_INTEGER) {
      fail(path, "must be a positive safe integer");
    }
  }

  function assertEnum(value, values, path) {
    if (values.indexOf(value) === -1) fail(path, "invalid value " + String(value));
  }

  function assertIsoDate(value, path) {
    assertString(value, path, 20, 30);
    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
      fail(path, "must be a canonical ISO timestamp");
    }
  }

  function positionSnapshotName(position) {
    var name = String(position.name || "");
    var nameEn = String(position.nameEn || "");
    return nameEn ? name + " · " + nameEn : name;
  }

  function cardNumberSnapshot(sourceCard) {
    if (sourceCard.number != null) return String(sourceCard.number);
    var segments = String(sourceCard.id || "").split("-");
    return segments[segments.length - 1] || String(sourceCard.id || "");
  }

  function defaultId() {
    var uuid = "";
    if (typeof crypto !== "undefined" && crypto && typeof crypto.randomUUID === "function") {
      uuid = crypto.randomUUID();
    } else {
      uuid = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 14);
    }
    return "reading-" + uuid;
  }

  function sortedEntries(entries) {
    return entries.slice().sort(function (a, b) {
      if (a.slotIndex !== b.slotIndex) return a.slotIndex - b.slotIndex;
      if (a.layer === b.layer) return 0;
      return a.layer === "major" ? -1 : 1;
    });
  }

  function buildReadingRecord(input) {
    assertPlainObject(input, "input");
    if (!Array.isArray(input.positions) || input.positions.length === 0) {
      fail("input.positions", "must contain spread positions");
    }
    if (!Array.isArray(input.entries)) fail("input.entries", "must be an array");

    var record = {
      schemaVersion: SCHEMA_VERSION,
      id: input.id || defaultId(),
      createdAt: input.createdAt || new Date().toISOString(),
      deckType: input.deckType,
      deckMode: input.deckMode,
      deckName: input.deckName,
      spreadId: input.spreadId,
      spreadName: input.spreadName,
      positionCount: input.positions.length,
      orientationMode: input.orientationMode,
      filterMode: input.filterMode,
      overviewMethod: input.overviewMethod,
      cards: sortedEntries(input.entries).map(function (item) {
        var position = input.positions[item.slotIndex];
        if (!position) fail("input.entries", "slotIndex has no matching position");
        return {
          cardId: String(item.card.id),
          cardNumber: cardNumberSnapshot(item.card),
          cardName: String(item.card.name),
          orientation: item.orientation,
          slotIndex: item.slotIndex,
          positionNumber: position.number,
          positionName: positionSnapshotName(position),
          layer: item.layer == null ? null : item.layer,
          arcana: String(item.card.arcana || input.deckType),
          suit: String(item.card.suit || "")
        };
      })
    };

    validateV1Record(record);
    return record;
  }

  function buildPresetRecord(input) {
    assertPlainObject(input, "input");
    var v1Record;
    if (Array.isArray(input.positions) || Array.isArray(input.entries)) {
      v1Record = buildReadingRecord(input);
    } else if (input.schemaVersion === SCHEMA_VERSION && Array.isArray(input.cards)) {
      v1Record = cloneJson(input);
      validateV1Record(v1Record);
    } else {
      fail("input", "must contain v1 preset input");
    }

    var record = {
      schemaVersion: SCHEMA_V2_VERSION,
      layoutMode: "preset",
      id: v1Record.id,
      createdAt: v1Record.createdAt,
      deckType: v1Record.deckType,
      deckMode: v1Record.deckMode,
      deckName: v1Record.deckName,
      spreadId: v1Record.spreadId,
      spreadName: v1Record.spreadName,
      positionCount: v1Record.positionCount,
      orientationMode: v1Record.orientationMode,
      filterMode: v1Record.filterMode,
      overviewMethod: v1Record.overviewMethod,
      cards: v1Record.cards
    };
    validateRecord(record);
    return record;
  }

  function freeformCardValue(item, sourceCard, key) {
    if (Object.prototype.hasOwnProperty.call(item, key)) return item[key];
    if (sourceCard && Object.prototype.hasOwnProperty.call(sourceCard, key)) return sourceCard[key];
    return undefined;
  }

  function buildFreeformLayoutCard(item, index, deckType) {
    var path = "input.cards[" + index + "]";
    assertPlainObject(item, path);
    var sourceCard = isPlainObject(item.card) ? item.card : item;
    var cardId = freeformCardValue(item, sourceCard, "cardId");
    if (cardId == null && sourceCard && Object.prototype.hasOwnProperty.call(sourceCard, "id")) {
      cardId = sourceCard.id;
    }
    var cardNumber = freeformCardValue(item, sourceCard, "cardNumber");
    if (cardNumber == null && sourceCard && sourceCard.number != null) cardNumber = sourceCard.number;
    if (cardNumber == null && sourceCard && sourceCard.id != null) {
      cardNumber = cardNumberSnapshot(sourceCard);
    }
    if (cardNumber == null && cardId != null) {
      var cardIdSegments = String(cardId).split("-");
      cardNumber = cardIdSegments[cardIdSegments.length - 1] || String(cardId);
    }
    var cardName = freeformCardValue(item, sourceCard, "cardName");
    if (cardName == null && sourceCard && Object.prototype.hasOwnProperty.call(sourceCard, "name")) {
      cardName = sourceCard.name;
    }
    var arcana = freeformCardValue(item, sourceCard, "arcana");
    if (arcana == null) arcana = deckType;
    var suit = freeformCardValue(item, sourceCard, "suit");
    if (suit == null) suit = "";

    var x = item.x;
    var y = item.y;
    if (item.world != null) {
      x = item.world.x;
      y = item.world.y;
    } else if (Object.prototype.hasOwnProperty.call(item, "worldX") ||
        Object.prototype.hasOwnProperty.call(item, "worldY")) {
      x = item.worldX;
      y = item.worldY;
    }

    return {
      cardId: cardId == null ? cardId : String(cardId),
      cardNumber: cardNumber == null ? cardNumber : String(cardNumber),
      cardName: cardName == null ? cardName : String(cardName),
      arcana: arcana == null ? arcana : String(arcana),
      suit: suit == null ? suit : String(suit),
      orientation: item.orientation,
      revealed: item.revealed,
      x: x,
      y: y,
      boardRotation: item.boardRotation,
      z: item.z,
      drawOrder: item.drawOrder
    };
  }

  function buildFreeformLayoutRecord(input) {
    assertPlainObject(input, "input");
    if (!Array.isArray(input.cards) || input.cards.length === 0) {
      fail("input.cards", "must contain freeform cards");
    }

    var cards = input.cards.map(function (item, index) {
      return buildFreeformLayoutCard(item, index, input.deckType);
    });
    cards.sort(function (a, b) {
      if (a.drawOrder !== b.drawOrder) return a.drawOrder - b.drawOrder;
      if (a.cardId === b.cardId) return 0;
      return a.cardId < b.cardId ? -1 : 1;
    });

    var record = {
      schemaVersion: SCHEMA_V2_VERSION,
      layoutMode: "freeform",
      id: input.id || defaultId(),
      createdAt: input.createdAt || new Date().toISOString(),
      deckType: input.deckType,
      deckMode: input.deckMode,
      deckName: input.deckName,
      orientationMode: input.orientationMode,
      filterMode: input.filterMode,
      overviewMethod: input.overviewMethod,
      cards: cards
    };
    validateRecord(record);
    return record;
  }

  function buildFreeformOrderOnlyCard(item, index, deckType) {
    var layoutCard = buildFreeformLayoutCard(item, index, deckType);
    return {
      cardId: layoutCard.cardId,
      cardNumber: layoutCard.cardNumber,
      cardName: layoutCard.cardName,
      arcana: layoutCard.arcana,
      suit: layoutCard.suit,
      orientation: layoutCard.orientation,
      revealed: layoutCard.revealed,
      drawOrder: layoutCard.drawOrder
    };
  }

  function buildFreeformRecord(input) {
    assertPlainObject(input, "input");
    if (!Array.isArray(input.cards) || input.cards.length === 0) {
      fail("input.cards", "must contain freeform cards");
    }

    var cards = input.cards.map(function (item, index) {
      return buildFreeformOrderOnlyCard(item, index, input.deckType);
    });
    cards.sort(function (a, b) {
      if (a.drawOrder !== b.drawOrder) return a.drawOrder - b.drawOrder;
      if (a.cardId === b.cardId) return 0;
      return a.cardId < b.cardId ? -1 : 1;
    });

    var record = {
      schemaVersion: SCHEMA_V3_VERSION,
      layoutMode: "freeform",
      id: input.id || defaultId(),
      createdAt: input.createdAt || new Date().toISOString(),
      deckType: input.deckType,
      deckMode: input.deckMode,
      deckName: input.deckName,
      orientationMode: input.orientationMode,
      filterMode: input.filterMode,
      overviewMethod: input.overviewMethod,
      cards: cards
    };
    validateRecord(record);
    return record;
  }

  function validateCard(item, index, positionCount) {
    var path = "record.cards[" + index + "]";
    assertPlainObject(item, path);
    assertOnlyKeys(item, CARD_KEYS, path);
    CARD_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) fail(path, "missing field " + key);
    });
    assertString(item.cardId, path + ".cardId", 1, 120);
    assertString(item.cardNumber, path + ".cardNumber", 1, 32);
    assertString(item.cardName, path + ".cardName", 1, 120);
    assertEnum(item.orientation, ORIENTATIONS, path + ".orientation");
    assertInteger(item.slotIndex, path + ".slotIndex", 0, positionCount - 1);
    assertInteger(item.positionNumber, path + ".positionNumber", 1, 100);
    assertString(item.positionName, path + ".positionName", 1, 160);
    assertEnum(item.layer, LAYERS, path + ".layer");
    assertEnum(item.arcana, ARCANAS, path + ".arcana");
    assertString(item.suit, path + ".suit", 0, 32);
  }

  function validateCardLayout(record) {
    var perSlot = {};
    var ids = {};
    record.cards.forEach(function (item, index) {
      validateCard(item, index, record.positionCount);
      if (item.positionNumber !== item.slotIndex + 1) {
        fail("record.cards", "positionNumber must match slotIndex");
      }
      if (ids[item.cardId]) fail("record.cards", "duplicate cardId " + item.cardId);
      ids[item.cardId] = true;
      if (!perSlot[item.slotIndex]) perSlot[item.slotIndex] = [];
      perSlot[item.slotIndex].push(item);
    });

    for (var slot = 0; slot < record.positionCount; slot++) {
      var items = perSlot[slot] || [];
      if (record.overviewMethod === "stacked") {
        if (items.length !== 2) fail("record.cards", "stacked overview requires two cards per slot");
        if (items[0].positionName !== items[1].positionName ||
            items[0].positionNumber !== items[1].positionNumber) {
          fail("record.cards", "stacked cards must share the same position snapshot");
        }
        var layers = items.map(function (item) { return item.layer; }).sort();
        if (layers[0] !== "major" || layers[1] !== "minor") {
          fail("record.cards", "stacked overview requires major and minor layers");
        }
        items.forEach(function (item) {
          if (item.layer !== item.arcana) {
            fail("record.cards", "stacked layer must match card arcana");
          }
        });
      } else {
        if (items.length !== 1) fail("record.cards", "complete spread requires one card per slot");
        if (items[0].layer !== null) fail("record.cards", "non-stacked cards must have a null layer");
      }
    }
  }

  function validateV1Record(record) {
    assertPlainObject(record, "record");
    assertOnlyKeys(record, RECORD_KEYS, "record");
    RECORD_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) fail("record", "missing field " + key);
    });
    if (record.schemaVersion !== SCHEMA_VERSION) fail("record.schemaVersion", "unsupported schemaVersion");
    assertString(record.id, "record.id", 1, 120);
    assertIsoDate(record.createdAt, "record.createdAt");
    assertEnum(record.deckType, DECK_TYPES, "record.deckType");
    assertEnum(record.deckMode, DECK_TYPES, "record.deckMode");
    if (record.deckMode !== record.deckType) fail("record.deckMode", "must match deckType");
    assertString(record.deckName, "record.deckName", 1, 100);
    assertString(record.spreadId, "record.spreadId", 1, 100);
    assertString(record.spreadName, "record.spreadName", 1, 160);
    assertInteger(record.positionCount, "record.positionCount", 1, 50);
    assertEnum(record.orientationMode, ORIENTATION_MODES, "record.orientationMode");
    assertEnum(record.filterMode, FILTER_MODES, "record.filterMode");
    assertEnum(record.overviewMethod, OVERVIEW_METHODS, "record.overviewMethod");
    if (!Array.isArray(record.cards) || record.cards.length === 0 || record.cards.length > MAX_CARDS) {
      fail("record.cards", "must contain between 1 and " + MAX_CARDS + " cards");
    }

    if (record.deckType !== "tarot") {
      if (record.orientationMode !== "upright-only") {
        fail("record.orientationMode", "non-tarot decks must be upright-only");
      }
      if (record.filterMode !== "not-applicable") {
        fail("record.filterMode", "non-tarot decks do not use a tarot filter");
      }
      if (record.overviewMethod !== "not-applicable") {
        fail("record.overviewMethod", "non-tarot decks do not use overview methods");
      }
    }
    if (record.overviewMethod === "stacked") {
      if (record.deckType !== "tarot" ||
          (record.spreadId !== "overview" && !/^custom-[0-9a-f]{16}$/.test(record.spreadId))) {
        fail("record.overviewMethod", "stacked mode is only valid for the tarot overview spread");
      }
      if (record.cards.length !== record.positionCount * 2) {
        fail("record.cards", "stacked overview card count is invalid");
      }
    } else if (record.cards.length !== record.positionCount) {
      fail("record.cards", "card count must match positionCount");
    }

    validateCardLayout(record);
    record.cards.forEach(function (item) {
      if (record.orientationMode === "upright-only" && item.orientation !== "upright") {
        fail("record.cards", "upright-only records cannot contain reversed cards");
      }
      if (record.deckType === "tarot" &&
          item.arcana !== "major" && item.arcana !== "minor") {
        fail("record.cards", "tarot records require tarot arcana values");
      }
      if (record.deckType !== "tarot" && item.arcana !== record.deckType) {
        fail("record.cards", "card arcana must match the non-tarot deck");
      }
    });
    if (record.deckType !== "tarot") {
      record.cards.forEach(function (item) {
        if (item.orientation !== "upright") fail("record.cards", "non-tarot cards must be upright");
      });
    }
    return record;
  }

  function assertDeckCardCount(count, deckType, path) {
    var maximum = DECK_CARD_LIMITS[deckType];
    if (!Number.isInteger(count) || count < 1 || count > maximum) {
      fail(path, "must contain between 1 and " + maximum + " cards for " + deckType);
    }
  }

  function validateLayoutSnapshot(snapshot) {
    assertPlainObject(snapshot, "layoutSnapshot");
    assertOnlyKeys(snapshot, LAYOUT_SNAPSHOT_KEYS, "layoutSnapshot");
    if (!Object.prototype.hasOwnProperty.call(snapshot, "cards")) {
      fail("layoutSnapshot", "missing field cards");
    }
    if (!Array.isArray(snapshot.cards) || snapshot.cards.length > MAX_CARDS) {
      fail("layoutSnapshot.cards", "must be an array with at most " + MAX_CARDS + " cards");
    }

    var cardIds = Object.create(null);
    var zValues = Object.create(null);
    var drawOrders = Object.create(null);
    var previousDrawOrder = 0;
    snapshot.cards.forEach(function (item, index) {
      var path = "layoutSnapshot.cards[" + index + "]";
      assertPlainObject(item, path);
      assertOnlyKeys(item, LAYOUT_SNAPSHOT_CARD_KEYS, path);
      LAYOUT_SNAPSHOT_CARD_KEYS.forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(item, key)) fail(path, "missing field " + key);
      });
      assertString(item.cardId, path + ".cardId", 1, 120);
      assertBoundedNumber(item.x, path + ".x", -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE);
      assertBoundedNumber(item.y, path + ".y", -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE);
      assertBoundedNumber(item.boardRotation, path + ".boardRotation", -MAX_BOARD_ROTATION, MAX_BOARD_ROTATION);
      assertPositiveSafeInteger(item.z, path + ".z");
      assertPositiveSafeInteger(item.drawOrder, path + ".drawOrder");
      if (Object.prototype.hasOwnProperty.call(cardIds, item.cardId)) {
        fail("layoutSnapshot.cards", "duplicate cardId " + item.cardId);
      }
      if (Object.prototype.hasOwnProperty.call(zValues, item.z)) {
        fail("layoutSnapshot.cards", "duplicate z " + item.z);
      }
      if (Object.prototype.hasOwnProperty.call(drawOrders, item.drawOrder)) {
        fail("layoutSnapshot.cards", "duplicate drawOrder " + item.drawOrder);
      }
      if (item.drawOrder <= previousDrawOrder) {
        fail("layoutSnapshot.cards", "drawOrder must be in canonical ascending order");
      }
      cardIds[item.cardId] = true;
      zValues[item.z] = true;
      drawOrders[item.drawOrder] = true;
      previousDrawOrder = item.drawOrder;
    });
    return snapshot;
  }

  function buildLayoutSnapshot(input) {
    var sourceCards = Array.isArray(input) ? input : input && input.cards;
    if (!Array.isArray(sourceCards)) fail("input.cards", "must be an array");
    var cards = sourceCards.map(function (item, index) {
      var path = "input.cards[" + index + "]";
      assertPlainObject(item, path);
      var sourceCard = isPlainObject(item.card) ? item.card : item;
      var cardId = freeformCardValue(item, sourceCard, "cardId");
      if (cardId == null && sourceCard && Object.prototype.hasOwnProperty.call(sourceCard, "id")) {
        cardId = sourceCard.id;
      }
      var x = item.x;
      var y = item.y;
      if (item.world != null) {
        x = item.world.x;
        y = item.world.y;
      } else if (Object.prototype.hasOwnProperty.call(item, "worldX") ||
          Object.prototype.hasOwnProperty.call(item, "worldY")) {
        x = item.worldX;
        y = item.worldY;
      }
      return {
        cardId: cardId == null ? cardId : String(cardId),
        x: x,
        y: y,
        boardRotation: item.boardRotation,
        z: item.z,
        drawOrder: item.drawOrder
      };
    });
    cards.sort(function (a, b) {
      if (a.drawOrder !== b.drawOrder) return a.drawOrder - b.drawOrder;
      if (a.cardId === b.cardId) return 0;
      return a.cardId < b.cardId ? -1 : 1;
    });
    return validateLayoutSnapshot({ cards: cards });
  }

  function validateFreeformCard(item, index) {
    var path = "record.cards[" + index + "]";
    assertPlainObject(item, path);
    assertOnlyKeys(item, FREEFORM_CARD_KEYS, path);
    FREEFORM_CARD_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) fail(path, "missing field " + key);
    });
    assertString(item.cardId, path + ".cardId", 1, 120);
    assertString(item.cardNumber, path + ".cardNumber", 1, 32);
    assertString(item.cardName, path + ".cardName", 1, 120);
    assertEnum(item.arcana, ARCANAS, path + ".arcana");
    assertString(item.suit, path + ".suit", 0, 32);
    assertEnum(item.orientation, ORIENTATIONS, path + ".orientation");
    assertBoolean(item.revealed, path + ".revealed");
    WORLD_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) {
        fail(path, "missing field " + key);
      }
    });
    assertBoundedNumber(item.x, path + ".x", -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE);
    assertBoundedNumber(item.y, path + ".y", -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE);
    assertBoundedNumber(item.boardRotation, path + ".boardRotation", -MAX_BOARD_ROTATION, MAX_BOARD_ROTATION);
    assertPositiveSafeInteger(item.z, path + ".z");
    assertPositiveSafeInteger(item.drawOrder, path + ".drawOrder");
  }

  function validateFreeformRecord(record) {
    assertPlainObject(record, "record");
    assertOnlyKeys(record, FREEFORM_RECORD_KEYS, "record");
    FREEFORM_RECORD_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) fail("record", "missing field " + key);
    });
    if (record.schemaVersion !== SCHEMA_V2_VERSION) {
      fail("record.schemaVersion", "unsupported schemaVersion");
    }
    assertEnum(record.layoutMode, ["freeform"], "record.layoutMode");
    assertString(record.id, "record.id", 1, 120);
    assertIsoDate(record.createdAt, "record.createdAt");
    assertEnum(record.deckType, DECK_TYPES, "record.deckType");
    assertEnum(record.deckMode, DECK_TYPES, "record.deckMode");
    if (record.deckMode !== record.deckType) fail("record.deckMode", "must match deckType");
    assertString(record.deckName, "record.deckName", 1, 100);
    assertEnum(record.orientationMode, ORIENTATION_MODES, "record.orientationMode");
    assertEnum(record.filterMode, FILTER_MODES, "record.filterMode");
    assertEnum(record.overviewMethod, OVERVIEW_METHODS, "record.overviewMethod");
    if (!Array.isArray(record.cards) || record.cards.length === 0) {
      fail("record.cards", "must contain at least 1 card");
    }
    assertDeckCardCount(record.cards.length, record.deckType, "record.cards");

    if (record.deckType !== "tarot") {
      if (record.orientationMode !== "upright-only") {
        fail("record.orientationMode", "non-tarot decks must be upright-only");
      }
      if (record.filterMode !== "not-applicable") {
        fail("record.filterMode", "non-tarot decks do not use a tarot filter");
      }
      if (record.overviewMethod !== "not-applicable") {
        fail("record.overviewMethod", "non-tarot decks do not use overview methods");
      }
    }

    var cardIds = Object.create(null);
    var zValues = Object.create(null);
    var drawOrders = Object.create(null);
    var previousDrawOrder = 0;
    record.cards.forEach(function (item, index) {
      validateFreeformCard(item, index);
      if (Object.prototype.hasOwnProperty.call(cardIds, item.cardId)) {
        fail("record.cards", "duplicate cardId " + item.cardId);
      }
      cardIds[item.cardId] = true;
      if (Object.prototype.hasOwnProperty.call(zValues, item.z)) {
        fail("record.cards", "duplicate z " + item.z);
      }
      zValues[item.z] = true;
      if (Object.prototype.hasOwnProperty.call(drawOrders, item.drawOrder)) {
        fail("record.cards", "duplicate drawOrder " + item.drawOrder);
      }
      drawOrders[item.drawOrder] = true;
      if (item.drawOrder <= previousDrawOrder) {
        fail("record.cards", "drawOrder must be in canonical ascending order");
      }
      previousDrawOrder = item.drawOrder;

      if (record.orientationMode === "upright-only" && item.orientation !== "upright") {
        fail("record.cards", "upright-only records cannot contain reversed cards");
      }
      if (record.deckType === "tarot" && item.arcana !== "major" && item.arcana !== "minor") {
        fail("record.cards", "tarot records require tarot arcana values");
      }
      if (record.deckType !== "tarot" && item.arcana !== record.deckType) {
        fail("record.cards", "card arcana must match the non-tarot deck");
      }
    });
    return record;
  }

  function validateOrderOnlyFreeformCard(item, index) {
    var path = "record.cards[" + index + "]";
    assertPlainObject(item, path);
    assertOnlyKeys(item, ORDER_ONLY_FREEFORM_CARD_KEYS, path);
    ORDER_ONLY_FREEFORM_CARD_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(item, key)) fail(path, "missing field " + key);
    });
    assertString(item.cardId, path + ".cardId", 1, 120);
    assertString(item.cardNumber, path + ".cardNumber", 1, 32);
    assertString(item.cardName, path + ".cardName", 1, 120);
    assertEnum(item.arcana, ARCANAS, path + ".arcana");
    assertString(item.suit, path + ".suit", 0, 32);
    assertEnum(item.orientation, ORIENTATIONS, path + ".orientation");
    assertBoolean(item.revealed, path + ".revealed");
    assertPositiveSafeInteger(item.drawOrder, path + ".drawOrder");
  }

  function validateOrderOnlyFreeformRecord(record) {
    assertPlainObject(record, "record");
    assertOnlyKeys(record, ORDER_ONLY_FREEFORM_RECORD_KEYS, "record");
    ORDER_ONLY_FREEFORM_RECORD_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) fail("record", "missing field " + key);
    });
    if (record.schemaVersion !== SCHEMA_V3_VERSION) {
      fail("record.schemaVersion", "unsupported schemaVersion");
    }
    assertEnum(record.layoutMode, ["freeform"], "record.layoutMode");
    assertString(record.id, "record.id", 1, 120);
    assertIsoDate(record.createdAt, "record.createdAt");
    assertEnum(record.deckType, DECK_TYPES, "record.deckType");
    assertEnum(record.deckMode, DECK_TYPES, "record.deckMode");
    if (record.deckMode !== record.deckType) fail("record.deckMode", "must match deckType");
    assertString(record.deckName, "record.deckName", 1, 100);
    assertEnum(record.orientationMode, ORIENTATION_MODES, "record.orientationMode");
    assertEnum(record.filterMode, FILTER_MODES, "record.filterMode");
    assertEnum(record.overviewMethod, OVERVIEW_METHODS, "record.overviewMethod");
    if (!Array.isArray(record.cards) || record.cards.length === 0) {
      fail("record.cards", "must contain at least 1 card");
    }
    assertDeckCardCount(record.cards.length, record.deckType, "record.cards");

    if (record.deckType !== "tarot") {
      if (record.orientationMode !== "upright-only") {
        fail("record.orientationMode", "non-tarot decks must be upright-only");
      }
      if (record.filterMode !== "not-applicable") {
        fail("record.filterMode", "non-tarot decks do not use a tarot filter");
      }
      if (record.overviewMethod !== "not-applicable") {
        fail("record.overviewMethod", "non-tarot decks do not use overview methods");
      }
    }

    var cardIds = Object.create(null);
    var drawOrders = Object.create(null);
    var previousDrawOrder = 0;
    record.cards.forEach(function (item, index) {
      validateOrderOnlyFreeformCard(item, index);
      if (Object.prototype.hasOwnProperty.call(cardIds, item.cardId)) {
        fail("record.cards", "duplicate cardId " + item.cardId);
      }
      if (Object.prototype.hasOwnProperty.call(drawOrders, item.drawOrder)) {
        fail("record.cards", "duplicate drawOrder " + item.drawOrder);
      }
      if (item.drawOrder <= previousDrawOrder) {
        fail("record.cards", "drawOrder must be in canonical ascending order");
      }
      cardIds[item.cardId] = true;
      drawOrders[item.drawOrder] = true;
      previousDrawOrder = item.drawOrder;

      if (record.orientationMode === "upright-only" && item.orientation !== "upright") {
        fail("record.cards", "upright-only records cannot contain reversed cards");
      }
      if (record.deckType === "tarot" && item.arcana !== "major" && item.arcana !== "minor") {
        fail("record.cards", "tarot records require tarot arcana values");
      }
      if (record.deckType !== "tarot" && item.arcana !== record.deckType) {
        fail("record.cards", "card arcana must match the non-tarot deck");
      }
    });
    return record;
  }

  function validateV2PresetRecord(record) {
    assertPlainObject(record, "record");
    assertOnlyKeys(record, V2_PRESET_RECORD_KEYS, "record");
    V2_PRESET_RECORD_KEYS.forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) fail("record", "missing field " + key);
    });
    if (record.schemaVersion !== SCHEMA_V2_VERSION) {
      fail("record.schemaVersion", "unsupported schemaVersion");
    }
    assertEnum(record.layoutMode, ["preset"], "record.layoutMode");

    var v1Record = {};
    RECORD_KEYS.forEach(function (key) {
      v1Record[key] = record[key];
    });
    v1Record.schemaVersion = SCHEMA_VERSION;
    validateV1Record(v1Record);
    assertDeckCardCount(record.cards.length, record.deckType, "record.cards");
    return record;
  }

  function validateV2Record(record) {
    assertPlainObject(record, "record");
    if (record.layoutMode === "preset") return validateV2PresetRecord(record);
    if (record.layoutMode === "freeform") return validateFreeformRecord(record);
    assertOnlyKeys(record, V2_PRESET_RECORD_KEYS.concat(FREEFORM_RECORD_KEYS.filter(function (key) {
      return V2_PRESET_RECORD_KEYS.indexOf(key) === -1;
    })), "record");
    fail("record.layoutMode", "invalid value " + String(record.layoutMode));
  }

  function validateV3Record(record) {
    assertPlainObject(record, "record");
    if (record.layoutMode === "freeform") return validateOrderOnlyFreeformRecord(record);
    assertOnlyKeys(record, ORDER_ONLY_FREEFORM_RECORD_KEYS, "record");
    fail("record.layoutMode", "invalid value " + String(record.layoutMode));
  }

  function validateRecord(record) {
    assertPlainObject(record, "record");
    if (record.schemaVersion === SCHEMA_V3_VERSION) return validateV3Record(record);
    if (record.schemaVersion === SCHEMA_V2_VERSION) return validateV2Record(record);
    return validateV1Record(record);
  }

  function canonicalCards(cards, keys) {
    return (cards || []).map(function (card) {
      var output = {};
      keys.forEach(function (key) { output[key] = card[key]; });
      return output;
    });
  }

  function canonicalRecordContent(record) {
    if (record && record.schemaVersion === SCHEMA_V2_VERSION && record.layoutMode === "preset") {
      return JSON.stringify({
        schemaVersion: record.schemaVersion,
        layoutMode: record.layoutMode,
        deckType: record.deckType,
        deckMode: record.deckMode,
        deckName: record.deckName,
        spreadId: record.spreadId,
        spreadName: record.spreadName,
        positionCount: record.positionCount,
        orientationMode: record.orientationMode,
        filterMode: record.filterMode,
        overviewMethod: record.overviewMethod,
        cards: canonicalCards(record.cards, CARD_KEYS)
      });
    }
    if (record && record.schemaVersion === SCHEMA_V2_VERSION && record.layoutMode === "freeform") {
      return JSON.stringify({
        schemaVersion: record.schemaVersion,
        layoutMode: record.layoutMode,
        deckType: record.deckType,
        deckMode: record.deckMode,
        deckName: record.deckName,
        orientationMode: record.orientationMode,
        filterMode: record.filterMode,
        overviewMethod: record.overviewMethod,
        cards: canonicalCards(record.cards, FREEFORM_CARD_KEYS)
      });
    }
    if (record && record.schemaVersion === SCHEMA_V3_VERSION && record.layoutMode === "freeform") {
      return JSON.stringify({
        schemaVersion: record.schemaVersion,
        layoutMode: record.layoutMode,
        deckType: record.deckType,
        deckMode: record.deckMode,
        deckName: record.deckName,
        orientationMode: record.orientationMode,
        filterMode: record.filterMode,
        overviewMethod: record.overviewMethod,
        cards: canonicalCards(record.cards, ORDER_ONLY_FREEFORM_CARD_KEYS)
      });
    }
    return JSON.stringify({
      schemaVersion: record.schemaVersion,
      deckType: record.deckType,
      deckMode: record.deckMode,
      deckName: record.deckName,
      spreadId: record.spreadId,
      spreadName: record.spreadName,
      positionCount: record.positionCount,
      orientationMode: record.orientationMode,
      filterMode: record.filterMode,
      overviewMethod: record.overviewMethod,
      cards: record.cards
    });
  }

  function recordsEquivalent(a, b) {
    return canonicalRecordContent(a) === canonicalRecordContent(b);
  }

  function isRecentDuplicate(existingRecords, candidate, windowMs) {
    var candidateTime = new Date(candidate.createdAt).getTime();
    return (existingRecords || []).some(function (record) {
      var delta = Math.abs(candidateTime - new Date(record.createdAt).getTime());
      return delta <= windowMs && recordsEquivalent(record, candidate);
    });
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createExportEnvelope(records, exportedAt) {
    if (!Array.isArray(records) || records.length > MAX_RECORDS) {
      fail("records", "invalid record collection");
    }
    records.forEach(validateRecord);
    var envelope = {
      formatVersion: records.some(function (record) {
        return record.schemaVersion === SCHEMA_V3_VERSION;
      }) ? FORMAT_VERSION_V3 : records.some(function (record) {
        return record.schemaVersion === SCHEMA_V2_VERSION;
      }) ? FORMAT_VERSION_V2 : FORMAT_VERSION,
      exportedAt: exportedAt || new Date().toISOString(),
      records: cloneJson(records)
    };
    assertIsoDate(envelope.exportedAt, "exportedAt");
    return envelope;
  }

  function serializeExport(records, exportedAt) {
    return JSON.stringify(createExportEnvelope(records, exportedAt), null, 2);
  }

  function parseImportJson(text) {
    if (typeof text !== "string" || text.length === 0 || text.length > MAX_IMPORT_BYTES) {
      fail("import", "file is empty or exceeds the size limit");
    }
    var value;
    try {
      value = JSON.parse(text);
    } catch (_error) {
      fail("import", "invalid JSON");
    }
    assertPlainObject(value, "import");
    assertOnlyKeys(value, ["formatVersion", "exportedAt", "records"], "import");
    ["formatVersion", "exportedAt", "records"].forEach(function (key) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) fail("import", "missing field " + key);
    });
    if (value.formatVersion !== FORMAT_VERSION && value.formatVersion !== FORMAT_VERSION_V2 &&
        value.formatVersion !== FORMAT_VERSION_V3) {
      fail("import.formatVersion", "unsupported formatVersion");
    }
    assertIsoDate(value.exportedAt, "import.exportedAt");
    if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS) {
      fail("import.records", "must be an array with at most " + MAX_RECORDS + " records");
    }
    if (value.formatVersion === FORMAT_VERSION) {
      value.records.forEach(validateV1Record);
    } else {
      value.records.forEach(function (record) {
        validateRecord(record);
        if (value.formatVersion === FORMAT_VERSION_V2 && record.schemaVersion === SCHEMA_V3_VERSION) {
          fail("import.records", "formatVersion 2 cannot contain schemaVersion 3");
        }
      });
    }
    return {
      formatVersion: value.formatVersion,
      exportedAt: value.exportedAt,
      records: cloneJson(value.records)
    };
  }

  function resolveImportedIds(records, existingIds, idGenerator) {
    var used = {};
    (existingIds || []).forEach(function (id) { used[id] = true; });
    var generate = idGenerator || defaultId;
    var remappedCount = 0;
    var output = records.map(function (record) {
      var id = record.id;
      if (used[id]) {
        var attempts = 0;
        do {
          id = generate();
          attempts += 1;
          if (attempts > 1000) fail("import.records", "could not generate a unique id");
        } while (used[id]);
        remappedCount += 1;
      }
      used[id] = true;
      var copy = cloneJson(record);
      copy.id = id;
      return copy;
    });
    return { records: output, remappedCount: remappedCount };
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    SCHEMA_V2_VERSION: SCHEMA_V2_VERSION,
    SCHEMA_V3_VERSION: SCHEMA_V3_VERSION,
    FORMAT_VERSION: FORMAT_VERSION,
    FORMAT_VERSION_V2: FORMAT_VERSION_V2,
    FORMAT_VERSION_V3: FORMAT_VERSION_V3,
    MAX_RECORDS: MAX_RECORDS,
    MAX_CARDS: MAX_CARDS,
    MAX_IMPORT_BYTES: MAX_IMPORT_BYTES,
    buildReadingRecord: buildReadingRecord,
    buildPresetRecord: buildPresetRecord,
    buildFreeformLayoutRecord: buildFreeformLayoutRecord,
    buildFreeformRecord: buildFreeformRecord,
    buildFreeformOrderRecord: buildFreeformRecord,
    buildLayoutSnapshot: buildLayoutSnapshot,
    validateLayoutSnapshot: validateLayoutSnapshot,
    validateRecord: validateRecord,
    canonicalRecordContent: canonicalRecordContent,
    recordsEquivalent: recordsEquivalent,
    isRecentDuplicate: isRecentDuplicate,
    createExportEnvelope: createExportEnvelope,
    serializeExport: serializeExport,
    parseImportJson: parseImportJson,
    resolveImportedIds: resolveImportedIds,
    createId: defaultId
  };
});
