(function (root, factory) {
  "use strict";

  var api = factory(root);
  if (root) root.DivinationCustomSpreads = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var PREFIX = "QSP2.";
  var LEGACY_PREFIX = "QSP1.";
  var STORAGE_KEY = "quareia-custom-spreads-v1";
  var SCHEMA_VERSION = 2;
  var LEGACY_SCHEMA_VERSION = 1;
  var LEGACY_MAX_COLUMNS = 7;
  var MAX_NAME_LENGTH = 80;
  var MAX_DESCRIPTION_LENGTH = 500;
  var MAX_COLUMNS = 10;
  var MAX_ROWS = 10;
  var MAX_POSITIONS = 24;
  var MAX_POSITION_NAME_LENGTH = 80;
  var MAX_MEANING_LENGTH = 300;
  var MAX_CODE_LENGTH = 16000;
  var MAX_LIBRARY_SIZE = 50;
  var STACK_OFFSET_X = 14;
  var STACK_OFFSET_Y = 32;
  var CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;
  var TOP_FIELDS = ["name", "nameEn", "description", "columns", "rows", "deckScope", "tarotMode", "stackingMode", "positions"];
  var POSITION_FIELDS = ["number", "name", "nameEn", "meaning", "meaningEn", "column", "row", "drawRule", "stackOn"];
  var LEGACY_COMPACT_FIELDS = ["v", "n", "d", "c", "r", "p"];
  var COMPACT_FIELDS = ["v", "n", "d", "c", "r", "s", "t", "m", "p"];
  var BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var DECK_SCOPES = ["any", "tarot-only", "non-tarot-only"];
  var TAROT_MODES = ["mixed", "major-only", "minor-only"];
  var STACKING_MODES = ["single", "major-minor"];
  var ARCANA_RULES = ["major", "minor"];
  var SUIT_RULES = ["wands", "cups", "swords", "pentacles"];
  var RUNTIME_SUITS = {
    wands: "权杖",
    cups: "圣杯",
    swords: "宝剑",
    pentacles: "星币"
  };
  var SUIT_LABELS = {
    wands: ["仅限权杖牌", "Wands only"],
    cups: ["仅限圣杯牌", "Cups only"],
    swords: ["仅限宝剑牌", "Swords only"],
    pentacles: ["仅限星币牌", "Pentacles only"]
  };

  function fail(message) {
    throw new Error("Invalid custom spread: " + message);
  }

  function storageFailure(message, cause) {
    var error = new Error("Custom spread storage: " + message);
    error.code = "CUSTOM_SPREAD_STORAGE";
    if (cause) error.cause = cause;
    return error;
  }

  function hasOwn(value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  function isPlainObject(value) {
    if (value === null || typeof value !== "object") return false;
    var prototype = Object.getPrototypeOf(value);
    if (prototype === null) return true;
    if (Object.prototype.toString.call(value) !== "[object Object]") return false;
    return typeof prototype.constructor === "function" &&
      Function.prototype.toString.call(prototype.constructor) === Function.prototype.toString.call(Object);
  }

  function ownKeys(value) {
    if (typeof Reflect !== "undefined" && Reflect.ownKeys) return Reflect.ownKeys(value);
    var keys = Object.getOwnPropertyNames(value);
    if (Object.getOwnPropertySymbols) keys = keys.concat(Object.getOwnPropertySymbols(value));
    return keys;
  }

  function assertAllowedKeys(value, allowed, path) {
    var known = Object.create(null);
    allowed.forEach(function (key) { known[key] = true; });
    ownKeys(value).forEach(function (key) {
      if (typeof key !== "string" || !known[key]) fail(path + " contains an unknown field");
    });
  }

  function assertRequired(value, key, path) {
    if (!hasOwn(value, key)) fail(path + "." + key + " is required");
  }

  function normalizeText(value, maximum, path, required) {
    if (typeof value !== "string") fail(path + " must be a string");
    if (CONTROL_CHARACTERS.test(value)) fail(path + " contains a control character");
    var normalized = value.trim();
    if (required && normalized.length === 0) fail(path + " must not be blank");
    if (normalized.length > maximum) fail(path + " exceeds its length limit");
    return normalized;
  }

  function normalizeInteger(value, minimum, maximum, path) {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
      fail(path + " must be an integer");
    }
    if (value < minimum || value > maximum) {
      fail(path + " must be between " + minimum + " and " + maximum);
    }
    return value;
  }

  function assertArrayProperties(value, path) {
    ownKeys(value).forEach(function (key) {
      if (key === "length") return;
      if (typeof key !== "string" || !/^\d+$/.test(key) || String(Number(key)) !== key || Number(key) >= value.length) {
        fail(path + " contains an unknown field");
      }
    });
  }

  function normalizeEnum(value, choices, path) {
    if (typeof value !== "string" || choices.indexOf(value) === -1) {
      fail(path + " has an unsupported value");
    }
    return value;
  }

  function normalizeDrawRule(value, path) {
    if (value === null) return null;
    if (!isPlainObject(value)) fail(path + " must be null or a plain object");
    assertAllowedKeys(value, ["arcana", "suit"], path);
    var keys = ownKeys(value).filter(function (key) { return typeof key === "string"; });
    if (keys.length !== 1) fail(path + " must contain exactly one rule");
    if (hasOwn(value, "arcana")) {
      return { arcana: normalizeEnum(value.arcana, ARCANA_RULES, path + ".arcana") };
    }
    return { suit: normalizeEnum(value.suit, SUIT_RULES, path + ".suit") };
  }

  function normalizePosition(value, index, columns, rows, previousPositions) {
    var path = "positions[" + index + "]";
    if (!isPlainObject(value)) fail(path + " must be a plain object");
    assertAllowedKeys(value, POSITION_FIELDS, path);
    assertRequired(value, "name", path);
    assertRequired(value, "meaning", path);
    assertRequired(value, "column", path);
    assertRequired(value, "row", path);

    var name = normalizeText(value.name, MAX_POSITION_NAME_LENGTH, path + ".name", true);
    var meaning = normalizeText(value.meaning, MAX_MEANING_LENGTH, path + ".meaning", false);
    var column = normalizeInteger(value.column, 1, columns, path + ".column");
    var row = normalizeInteger(value.row, 1, rows, path + ".row");
    var drawRule = hasOwn(value, "drawRule")
      ? normalizeDrawRule(value.drawRule, path + ".drawRule")
      : null;
    var stackOn = hasOwn(value, "stackOn") ? value.stackOn : null;
    if (stackOn !== null) {
      stackOn = normalizeInteger(stackOn, 1, index, path + ".stackOn");
      if (!previousPositions || !previousPositions[stackOn - 1]) {
        fail(path + ".stackOn must reference a previous position");
      }
      // An explicit stack is always anchored to its target cell. The input
      // coordinates are still type/range checked above, then canonicalized.
      column = previousPositions[stackOn - 1].column;
      row = previousPositions[stackOn - 1].row;
    }

    if (hasOwn(value, "number")) {
      if (normalizeInteger(value.number, 1, MAX_POSITIONS, path + ".number") !== index + 1) {
        fail(path + ".number must be continuous");
      }
    }
    if (hasOwn(value, "nameEn") &&
        normalizeText(value.nameEn, MAX_POSITION_NAME_LENGTH, path + ".nameEn", true) !== name) {
      fail(path + ".nameEn must match name");
    }
    if (hasOwn(value, "meaningEn") &&
        normalizeText(value.meaningEn, MAX_MEANING_LENGTH, path + ".meaningEn", false) !== meaning) {
      fail(path + ".meaningEn must match meaning");
    }

    return {
      number: index + 1,
      name: name,
      nameEn: name,
      meaning: meaning,
      meaningEn: meaning,
      column: column,
      row: row,
      drawRule: drawRule,
      stackOn: stackOn
    };
  }

  function validateDefinitionRules(normalized) {
    var positions = normalized.positions;
    var drawRules = positions.map(function (position) { return position.drawRule; });
    var hasDrawRules = drawRules.some(function (rule) { return rule !== null; });

    if (normalized.deckScope === "non-tarot-only" &&
        (normalized.tarotMode !== "mixed" || normalized.stackingMode !== "single" || hasDrawRules)) {
      fail("non-tarot-only spreads cannot require Tarot rules");
    }

    if (normalized.stackingMode === "major-minor" &&
        (normalized.deckScope !== "tarot-only" || normalized.tarotMode !== "mixed" || hasDrawRules)) {
      fail("major-minor stacking requires tarot-only mixed mode without position rules");
    }

    var majorCount = 0;
    var minorCount = 0;
    var suitCounts = { wands: 0, cups: 0, swords: 0, pentacles: 0 };
    drawRules.forEach(function (rule) {
      if (!rule) return;
      if (rule.arcana === "major") majorCount++;
      if (rule.arcana === "minor") minorCount++;
      if (rule.suit) {
        minorCount++;
        suitCounts[rule.suit]++;
      }
    });

    if (normalized.tarotMode === "major-only") {
      if (positions.length > 22) fail("major-only spreads cannot exceed 22 positions");
      if (drawRules.some(function (rule) {
        return rule && rule.arcana !== "major";
      })) {
        fail("major-only spreads cannot use minor draw rules");
      }
    } else if (normalized.tarotMode === "minor-only") {
      if (positions.length > 56) fail("minor-only spreads cannot exceed 56 positions");
      if (drawRules.some(function (rule) {
        return rule && rule.arcana === "major";
      })) {
        fail("minor-only spreads cannot use major draw rules");
      }
    }

    if (normalized.tarotMode === "mixed") {
      if (majorCount > 22) fail("major draw rules exceed the Tarot capacity");
      if (minorCount > 56) fail("minor draw rules exceed the Tarot capacity");
    }
    Object.keys(suitCounts).forEach(function (suit) {
      if (suitCounts[suit] > 14) fail("draw rules exceed the " + suit + " capacity");
    });
    if (normalized.stackingMode === "major-minor" && positions.length > 22) {
      fail("major-minor stacking requires at most 22 positions");
    }
  }

  function normalizeDefinition(input) {
    if (!isPlainObject(input)) fail("definition must be a plain object");
    assertAllowedKeys(input, TOP_FIELDS, "definition");
    ["name", "description", "columns", "rows", "positions"].forEach(function (key) {
      assertRequired(input, key, "definition");
    });

    var name = normalizeText(input.name, MAX_NAME_LENGTH, "name", true);
    var description = normalizeText(input.description, MAX_DESCRIPTION_LENGTH, "description", false);
    var columns = normalizeInteger(input.columns, 1, MAX_COLUMNS, "columns");
    var rows = normalizeInteger(input.rows, 1, MAX_ROWS, "rows");
    var deckScope = hasOwn(input, "deckScope")
      ? normalizeEnum(input.deckScope, DECK_SCOPES, "deckScope")
      : "any";
    var tarotMode = hasOwn(input, "tarotMode")
      ? normalizeEnum(input.tarotMode, TAROT_MODES, "tarotMode")
      : "mixed";
    var stackingMode = hasOwn(input, "stackingMode")
      ? normalizeEnum(input.stackingMode, STACKING_MODES, "stackingMode")
      : "single";
    var positions = input.positions;
    if (!Array.isArray(positions)) fail("positions must be an array");
    assertArrayProperties(positions, "positions");
    if (positions.length < 1 || positions.length > MAX_POSITIONS) {
      fail("positions must contain between 1 and " + MAX_POSITIONS + " items");
    }

    if (hasOwn(input, "nameEn") &&
        normalizeText(input.nameEn, MAX_NAME_LENGTH, "nameEn", true) !== name) {
      fail("nameEn must match name");
    }

    var normalizedPositions = [];
    for (var index = 0; index < positions.length; index++) {
      if (!hasOwn(positions, index)) fail("positions must not contain holes");
      normalizedPositions.push(normalizePosition(positions[index], index, columns, rows, normalizedPositions));
    }
    var normalized = {
      name: name,
      nameEn: name,
      description: description,
      columns: columns,
      rows: rows,
      deckScope: deckScope,
      tarotMode: tarotMode,
      stackingMode: stackingMode,
      positions: normalizedPositions
    };
    validateDefinitionRules(normalized);
    return normalized;
  }

  function utf8Encode(value) {
    var bytes = [];
    for (var index = 0; index < value.length; index++) {
      var code = value.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        if (index + 1 >= value.length) fail("text contains an invalid Unicode surrogate");
        var low = value.charCodeAt(++index);
        if (low < 0xDC00 || low > 0xDFFF) fail("text contains an invalid Unicode surrogate");
        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
      } else if (code >= 0xDC00 && code <= 0xDFFF) {
        fail("text contains an invalid Unicode surrogate");
      }
      if (code <= 0x7F) {
        bytes.push(code);
      } else if (code <= 0x7FF) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code <= 0xFFFF) {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        bytes.push(
          0xF0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3F),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F)
        );
      }
    }
    return bytes;
  }

  function utf8Decode(bytes) {
    var result = "";
    function continuation(value) {
      return value >= 0x80 && value <= 0xBF;
    }
    function codePoint(value) {
      if (value <= 0xFFFF) return String.fromCharCode(value);
      value -= 0x10000;
      return String.fromCharCode(0xD800 + (value >> 10), 0xDC00 + (value & 0x3FF));
    }
    for (var index = 0; index < bytes.length;) {
      var first = bytes[index++];
      var code;
      if (first <= 0x7F) {
        code = first;
      } else if (first >= 0xC2 && first <= 0xDF) {
        if (index >= bytes.length || !continuation(bytes[index])) fail("payload is not valid UTF-8");
        code = ((first & 0x1F) << 6) | (bytes[index++] & 0x3F);
      } else if (first >= 0xE0 && first <= 0xEF) {
        if (index + 1 >= bytes.length || !continuation(bytes[index]) || !continuation(bytes[index + 1])) {
          fail("payload is not valid UTF-8");
        }
        var second = bytes[index++];
        var third = bytes[index++];
        if ((first === 0xE0 && second < 0xA0) || (first === 0xED && second >= 0xA0)) {
          fail("payload is not valid UTF-8");
        }
        code = ((first & 0x0F) << 12) | ((second & 0x3F) << 6) | (third & 0x3F);
      } else if (first >= 0xF0 && first <= 0xF4) {
        if (index + 2 >= bytes.length || !continuation(bytes[index]) ||
            !continuation(bytes[index + 1]) || !continuation(bytes[index + 2])) {
          fail("payload is not valid UTF-8");
        }
        var fourthSecond = bytes[index++];
        var fourthThird = bytes[index++];
        var fourth = bytes[index++];
        if ((first === 0xF0 && fourthSecond < 0x90) || (first === 0xF4 && fourthSecond > 0x8F)) {
          fail("payload is not valid UTF-8");
        }
        code = ((first & 0x07) << 18) | ((fourthSecond & 0x3F) << 12) |
          ((fourthThird & 0x3F) << 6) | (fourth & 0x3F);
      } else {
        fail("payload is not valid UTF-8");
      }
      result += codePoint(code);
    }
    return result;
  }

  function base64UrlEncode(bytes) {
    var binary = "";
    for (var index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
    var encoded;
    if (root && typeof root.btoa === "function") {
      encoded = root.btoa(binary);
    } else if (typeof Buffer !== "undefined") {
      encoded = Buffer.from(bytes).toString("base64");
    } else {
      encoded = "";
      for (var offset = 0; offset < bytes.length; offset += 3) {
        var first = bytes[offset];
        var second = offset + 1 < bytes.length ? bytes[offset + 1] : 0;
        var third = offset + 2 < bytes.length ? bytes[offset + 2] : 0;
        encoded += BASE64_ALPHABET.charAt(first >> 2);
        encoded += BASE64_ALPHABET.charAt(((first & 3) << 4) | (second >> 4));
        encoded += offset + 1 < bytes.length ? BASE64_ALPHABET.charAt(((second & 15) << 2) | (third >> 6)) : "=";
        encoded += offset + 2 < bytes.length ? BASE64_ALPHABET.charAt(third & 63) : "=";
      }
    }
    return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlDecode(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) {
      fail("payload is not canonical base64url");
    }
    var canonicalBytes;
    var padded = value.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    try {
      if (root && typeof root.atob === "function") {
        var binary = root.atob(padded);
        canonicalBytes = [];
        for (var index = 0; index < binary.length; index++) canonicalBytes.push(binary.charCodeAt(index));
      } else if (typeof Buffer !== "undefined") {
        canonicalBytes = Array.prototype.slice.call(Buffer.from(padded, "base64"));
      } else {
        canonicalBytes = [];
        for (var offset = 0; offset < value.length; offset += 4) {
          var first = BASE64_ALPHABET.indexOf(value.charAt(offset));
          var second = BASE64_ALPHABET.indexOf(value.charAt(offset + 1));
          var third = offset + 2 < value.length ? BASE64_ALPHABET.indexOf(value.charAt(offset + 2)) : 0;
          var fourth = offset + 3 < value.length ? BASE64_ALPHABET.indexOf(value.charAt(offset + 3)) : 0;
          if (first < 0 || second < 0 || third < 0 || fourth < 0) fail("payload is not canonical base64url");
          canonicalBytes.push((first << 2) | (second >> 4));
          if (offset + 2 < value.length) canonicalBytes.push(((second & 15) << 4) | (third >> 2));
          if (offset + 3 < value.length) canonicalBytes.push(((third & 3) << 6) | fourth);
        }
      }
    } catch (_error) {
      fail("payload is not canonical base64url");
    }
    if (base64UrlEncode(canonicalBytes) !== value) fail("payload is not canonical base64url");
    return canonicalBytes;
  }

  function fnv1aAscii(value) {
    var hash = 0x811C9DC5;
    for (var index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  }

  function legacyCompactFromNormalized(normalized) {
    return {
      v: LEGACY_SCHEMA_VERSION,
      n: normalized.name,
      d: normalized.description,
      c: normalized.columns,
      r: normalized.rows,
      p: normalized.positions.map(function (position) {
        return [position.name, position.meaning, position.column, position.row];
      })
    };
  }

  function compactFromNormalized(normalized) {
    return {
      v: SCHEMA_VERSION,
      n: normalized.name,
      d: normalized.description,
      c: normalized.columns,
      r: normalized.rows,
      s: normalized.deckScope,
      t: normalized.tarotMode,
      m: normalized.stackingMode,
      p: normalized.positions.map(function (position) {
        return [position.name, position.meaning, position.column, position.row,
          position.drawRule, position.stackOn];
      })
    };
  }

  function normalizedFromLegacyCompact(input) {
    if (!isPlainObject(input)) fail("payload schema must be a plain object");
    assertAllowedKeys(input, LEGACY_COMPACT_FIELDS, "payload");
    LEGACY_COMPACT_FIELDS.forEach(function (key) { assertRequired(input, key, "payload"); });
    if (input.v !== LEGACY_SCHEMA_VERSION) fail("unknown payload version");
    if (typeof input.c === "number" && input.c > LEGACY_MAX_COLUMNS) {
      fail("legacy payload columns exceed the v1 limit");
    }
    if (!Array.isArray(input.p)) fail("payload positions must be an array");
    assertArrayProperties(input.p, "payload.p");
    if (input.p.length < 1 || input.p.length > MAX_POSITIONS) fail("payload positions exceed the limit");
    var positions = [];
    for (var index = 0; index < input.p.length; index++) {
      var item = input.p[index];
      if (!Array.isArray(item) || item.length !== 4) fail("payload position must have four fields");
      assertArrayProperties(item, "payload.p[" + index + "]");
      for (var itemIndex = 0; itemIndex < 4; itemIndex++) {
        if (!hasOwn(item, itemIndex)) fail("payload position must not contain holes");
      }
      positions.push({
        name: item[0],
        meaning: item[1],
        column: item[2],
        row: item[3],
        drawRule: null,
        stackOn: null
      });
    }
    return normalizeDefinition({
      name: input.n,
      description: input.d,
      columns: input.c,
      rows: input.r,
      positions: positions
    });
  }

  function normalizedFromCompact(input) {
    if (!isPlainObject(input)) fail("payload schema must be a plain object");
    assertAllowedKeys(input, COMPACT_FIELDS, "payload");
    COMPACT_FIELDS.forEach(function (key) { assertRequired(input, key, "payload"); });
    if (input.v !== SCHEMA_VERSION) fail("unknown payload version");
    if (!Array.isArray(input.p)) fail("payload positions must be an array");
    assertArrayProperties(input.p, "payload.p");
    if (input.p.length < 1 || input.p.length > MAX_POSITIONS) fail("payload positions exceed the limit");
    var positions = [];
    for (var index = 0; index < input.p.length; index++) {
      var item = input.p[index];
      if (!Array.isArray(item) || item.length !== 6) fail("payload position must have six fields");
      assertArrayProperties(item, "payload.p[" + index + "]");
      for (var itemIndex = 0; itemIndex < 6; itemIndex++) {
        if (!hasOwn(item, itemIndex)) fail("payload position must not contain holes");
      }
      positions.push({
        name: item[0],
        meaning: item[1],
        column: item[2],
        row: item[3],
        drawRule: item[4],
        stackOn: item[5]
      });
    }
    return normalizeDefinition({
      name: input.n,
      description: input.d,
      columns: input.c,
      rows: input.r,
      deckScope: input.s,
      tarotMode: input.t,
      stackingMode: input.m,
      positions: positions
    });
  }

  function encodeNormalized(normalized) {
    var json = JSON.stringify(compactFromNormalized(normalized));
    var payload = base64UrlEncode(utf8Encode(json));
    var code = PREFIX + payload + "." + fnv1aAscii(payload);
    if (code.length > MAX_CODE_LENGTH) fail("share code exceeds the size limit");
    return code;
  }

  function encode(definition) {
    return encodeNormalized(normalizeDefinition(definition));
  }

  function decode(code) {
    if (typeof code !== "string" || code.length > MAX_CODE_LENGTH) fail("share code exceeds the size limit");
    var prefix;
    var legacy = false;
    if (code.indexOf(PREFIX) === 0) {
      prefix = PREFIX;
    } else if (code.indexOf(LEGACY_PREFIX) === 0) {
      prefix = LEGACY_PREFIX;
      legacy = true;
    } else {
      fail("unknown share-code version");
    }
    var parts = code.slice(prefix.length).split(".");
    if (parts.length !== 2 || !/^[0-9a-f]{8}$/.test(parts[1])) fail("share code is malformed");
    if (fnv1aAscii(parts[0]) !== parts[1]) fail("share-code checksum does not match");
    var json;
    try {
      json = utf8Decode(base64UrlDecode(parts[0]));
    } catch (error) {
      if (error && /^Invalid custom spread:/.test(error.message)) throw error;
      fail("share-code payload cannot be decoded");
    }
    var parsed;
    try {
      parsed = JSON.parse(json);
    } catch (_parseError) {
      fail("share-code payload is not JSON");
    }
    var normalized = legacy ? normalizedFromLegacyCompact(parsed) : normalizedFromCompact(parsed);
    var canonical = legacy ? legacyCompactFromNormalized(normalized) : compactFromNormalized(normalized);
    if (JSON.stringify(canonical) !== json) {
      fail("share-code payload is not canonical JSON");
    }
    return normalized;
  }

  function runtimeId(normalized) {
    // Keep IDs bounded for the history schema while making the old deliberate
    // 32-bit collision insufficient. Library operations still compare the
    // complete canonical code and fail closed if both digests ever collide.
    var canonical = encodeNormalized(normalized);
    var reversed = canonical.split("").reverse().join("");
    return "custom-" + fnv1aAscii(canonical) + fnv1aAscii(reversed);
  }

  function runtimeDrawRule(rule) {
    if (!rule) return null;
    if (rule.arcana === "major") {
      return {
        arcana: "major",
        ruleCode: "major",
        label: "仅限大阿卡那",
        labelEn: "Major Arcana only"
      };
    }
    if (rule.arcana === "minor") {
      return {
        arcana: "minor",
        ruleCode: "minor",
        label: "仅限小阿卡那",
        labelEn: "Minor Arcana only"
      };
    }
    var labels = SUIT_LABELS[rule.suit];
    return {
      suit: RUNTIME_SUITS[rule.suit],
      ruleCode: rule.suit,
      label: labels[0],
      labelEn: labels[1]
    };
  }

  function runtimeFromNormalized(normalized) {
    var counts = Object.create(null);
    var positions = [];
    normalized.positions.forEach(function (position) {
      var key = position.column + ":" + position.row;
      var layer = counts[key] || 0;
      counts[key] = layer + 1;
      var offsetX = layer * STACK_OFFSET_X;
      var offsetY = layer * STACK_OFFSET_Y;
      positions.push({
        number: position.number,
        name: position.name,
        nameEn: position.nameEn,
        meaning: position.meaning,
        meaningEn: position.meaningEn,
        column: position.column,
        row: position.row,
        drawRule: runtimeDrawRule(position.drawRule),
        stackOn: position.stackOn,
        offsetX: offsetX,
        offsetY: offsetY
      });
    });
    return {
      id: runtimeId(normalized),
      name: normalized.name,
      nameEn: normalized.nameEn,
      description: normalized.description,
      columns: normalized.columns,
      rows: normalized.rows,
      deckScope: normalized.deckScope,
      tarotMode: normalized.tarotMode,
      stackingMode: normalized.stackingMode,
      positions: positions,
      category: "custom",
      source: "User-created spread",
      isCustom: true
    };
  }

  function toRuntimeSpread(definition) {
    var normalized = normalizeDefinition(definition);
    return runtimeFromNormalized(normalized);
  }

  function requiredTarotMode(value) {
    return value && TAROT_MODES.indexOf(value.tarotMode) !== -1 ? value.tarotMode : "mixed";
  }

  function runtimeTarotMode(value) {
    return requiredTarotMode(value);
  }

  function supportsDeck(value, deckType) {
    if (!isPlainObject(value)) return false;
    if (deckType !== "tarot" && deckType !== "mystagogus" && deckType !== "lxxxi") return false;
    var scope = value.deckScope;
    if (scope === undefined) scope = "any";
    if (DECK_SCOPES.indexOf(scope) === -1) return false;
    var isTarot = deckType === "tarot";
    if (scope === "tarot-only" && !isTarot) return false;
    if (scope === "non-tarot-only" && isTarot) return false;
    return true;
  }

  function isMajorMinorStacking(value, deckType) {
    if (!isPlainObject(value) || value.stackingMode !== "major-minor") return false;
    if (value.deckScope !== "tarot-only" || requiredTarotMode(value) !== "mixed") return false;
    if (!Array.isArray(value.positions)) return false;
    if (value.positions.some(function (position) {
      return position && position.drawRule !== null && position.drawRule !== undefined;
    })) return false;
    return deckType === undefined ? true : supportsDeck(value, deckType);
  }

  function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (isPlainObject(value)) {
      var result = {};
      ownKeys(value).forEach(function (key) { result[key] = clone(value[key]); });
      return result;
    }
    return value;
  }

  function compactEnvelope(records) {
    return JSON.stringify({
      v: SCHEMA_VERSION,
      items: records.map(compactFromNormalized)
    });
  }

  function loadRecords(storage) {
    if (!storage || typeof storage.getItem !== "function") {
      return { records: [], writeBlocked: false, needsMigration: false };
    }
    var raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
      if (raw === null || raw === "") return { records: [], writeBlocked: false, needsMigration: false };
      if (typeof raw !== "string") fail("stored library must be a string");
      var parsed = JSON.parse(raw);
      if (JSON.stringify(parsed) !== raw) fail("stored library is not canonical JSON");
      if (!isPlainObject(parsed)) fail("stored library must be a plain object");
      assertAllowedKeys(parsed, ["v", "items"], "storage");
      if (parsed.v !== SCHEMA_VERSION && parsed.v !== LEGACY_SCHEMA_VERSION) {
        fail("stored library version or size is invalid");
      }
      if (!Array.isArray(parsed.items) ||
          parsed.items.length > MAX_LIBRARY_SIZE) fail("stored library version or size is invalid");
      assertArrayProperties(parsed.items, "storage.items");
      var records = [];
      var ids = Object.create(null);
      for (var index = 0; index < parsed.items.length; index++) {
        if (!hasOwn(parsed.items, index)) fail("stored library must not contain holes");
        var normalized = parsed.v === LEGACY_SCHEMA_VERSION
          ? normalizedFromLegacyCompact(parsed.items[index])
          : normalizedFromCompact(parsed.items[index]);
        var id = runtimeId(normalized);
        if (ids[id]) {
          // A duplicate runtime ID may only represent the exact same
          // normalized definition. Never let a colliding record overwrite the
          // earlier one; reject the whole envelope instead.
          if (encodeNormalized(records[ids[id].index]) !== encodeNormalized(normalized)) {
            fail("stored library contains a runtime ID collision");
          }
        } else {
          ids[id] = { index: records.length };
          records.push(normalized);
        }
      }
      return {
        records: records,
        writeBlocked: false,
        needsMigration: parsed.v === LEGACY_SCHEMA_VERSION
      };
    } catch (_error) {
      // Do not let the next save overwrite data that a future version or a
      // recovery tool may still understand.
      return { records: [], writeBlocked: true, needsMigration: false };
    }
  }

  function defaultStorage() {
    try {
      return root && root.localStorage ? root.localStorage : null;
    } catch (_error) {
      return null;
    }
  }

  function createLibrary(options) {
    options = options || {};
    if (!isPlainObject(options)) fail("library options must be a plain object");
    var platform = options.platform;
    if (platform !== "web" && platform !== "android") fail("platform must be web or android");
    var storage = platform === "android" ? (options.storage || defaultStorage()) : null;
    var loaded = platform === "android"
      ? loadRecords(storage)
      : { records: [], writeBlocked: false, needsMigration: false };
    var records = loaded.records;
    var writeBlocked = loaded.writeBlocked;

    function findIndex(id, expected) {
      if (typeof id !== "string") return -1;
      var match = -1;
      for (var index = 0; index < records.length; index++) {
        if (runtimeId(records[index]) !== id) continue;
        if (match >= 0 && encodeNormalized(records[match]) !== encodeNormalized(records[index])) {
          fail("runtime ID collision");
        }
        if (expected && encodeNormalized(records[index]) !== encodeNormalized(expected)) {
          fail("runtime ID collision");
        }
        if (match < 0) match = index;
      }
      return match;
    }

    function persist(nextRecords) {
      if (platform !== "android") return;
      if (writeBlocked) {
        throw storageFailure("stored library is invalid; refusing to overwrite it");
      }
      if (!storage || typeof storage.setItem !== "function") {
        throw storageFailure("storage.setItem is unavailable");
      }
      try {
        storage.setItem(STORAGE_KEY, compactEnvelope(nextRecords));
        writeBlocked = false;
        loaded.needsMigration = false;
      } catch (error) {
        throw storageFailure("storage write failed", error);
      }
    }

    function list() {
      return records.map(function (record) { return clone(runtimeFromNormalized(record)); });
    }

    function getById(id) {
      var index = findIndex(id);
      return index < 0 ? null : clone(runtimeFromNormalized(records[index]));
    }

    function upsert(definition) {
      var normalized = normalizeDefinition(definition);
      var id = runtimeId(normalized);
      var index = findIndex(id, normalized);
      var nextRecords = records.slice();
      if (index < 0) {
        if (records.length >= MAX_LIBRARY_SIZE) fail("library contains at most " + MAX_LIBRARY_SIZE + " spreads");
        nextRecords.push(normalized);
      } else {
        nextRecords[index] = normalized;
      }
      persist(nextRecords);
      records = nextRecords;
      return clone(runtimeFromNormalized(normalized));
    }

    function importCode(code) {
      return upsert(decode(code));
    }

    function remove(id) {
      if (platform === "android" && writeBlocked) {
        throw storageFailure("stored library is invalid; refusing to overwrite it");
      }
      var index = findIndex(id);
      if (index < 0) return false;
      var nextRecords = records.slice();
      nextRecords.splice(index, 1);
      persist(nextRecords);
      records = nextRecords;
      return true;
    }

    function exportCode(id) {
      var index = findIndex(id);
      return index < 0 ? null : encodeNormalized(records[index]);
    }

    return {
      list: list,
      getById: getById,
      upsert: upsert,
      importCode: importCode,
      remove: remove,
      exportCode: exportCode
    };
  }

  return {
    PREFIX: PREFIX,
    LEGACY_PREFIX: LEGACY_PREFIX,
    STORAGE_KEY: STORAGE_KEY,
    SCHEMA_VERSION: SCHEMA_VERSION,
    LEGACY_SCHEMA_VERSION: LEGACY_SCHEMA_VERSION,
    LEGACY_MAX_COLUMNS: LEGACY_MAX_COLUMNS,
    MAX_NAME_LENGTH: MAX_NAME_LENGTH,
    MAX_DESCRIPTION_LENGTH: MAX_DESCRIPTION_LENGTH,
    MAX_COLUMNS: MAX_COLUMNS,
    MAX_ROWS: MAX_ROWS,
    MAX_POSITIONS: MAX_POSITIONS,
    MAX_POSITION_NAME_LENGTH: MAX_POSITION_NAME_LENGTH,
    MAX_MEANING_LENGTH: MAX_MEANING_LENGTH,
    MAX_CODE_LENGTH: MAX_CODE_LENGTH,
    MAX_LIBRARY_SIZE: MAX_LIBRARY_SIZE,
    STACK_OFFSET_X: STACK_OFFSET_X,
    STACK_OFFSET_Y: STACK_OFFSET_Y,
    normalizeDefinition: normalizeDefinition,
    encode: encode,
    decode: decode,
    toRuntimeSpread: toRuntimeSpread,
    supportsDeck: supportsDeck,
    requiredTarotMode: requiredTarotMode,
    runtimeTarotMode: runtimeTarotMode,
    isMajorMinorStacking: isMajorMinorStacking,
    createLibrary: createLibrary
  };
});
