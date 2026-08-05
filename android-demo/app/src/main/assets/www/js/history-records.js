(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.DivinationHistoryRecords = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var SCHEMA_VERSION = 1;
  var FORMAT_VERSION = 1;
  var MAX_RECORDS = 5000;
  var MAX_CARDS = 100;
  var MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  var DECK_TYPES = ["tarot", "mystagogus", "lxxxi"];
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

  function validateRecord(record) {
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
      if (record.deckType !== "tarot" || record.spreadId !== "overview") {
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

  function canonicalRecordContent(record) {
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
      formatVersion: FORMAT_VERSION,
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
    if (value.formatVersion !== FORMAT_VERSION) fail("import.formatVersion", "unsupported formatVersion");
    assertIsoDate(value.exportedAt, "import.exportedAt");
    if (!Array.isArray(value.records) || value.records.length > MAX_RECORDS) {
      fail("import.records", "must be an array with at most " + MAX_RECORDS + " records");
    }
    value.records.forEach(validateRecord);
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
    FORMAT_VERSION: FORMAT_VERSION,
    MAX_RECORDS: MAX_RECORDS,
    MAX_CARDS: MAX_CARDS,
    MAX_IMPORT_BYTES: MAX_IMPORT_BYTES,
    buildReadingRecord: buildReadingRecord,
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
