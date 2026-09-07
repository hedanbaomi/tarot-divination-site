// SPDX-License-Identifier: MPL-2.0
(function (root, factory) {
  "use strict";

  var api = factory(root);
  if (root) {
    Object.defineProperty(root, "QuareiaIOS", {
      value: api,
      writable: false,
      configurable: false
    });
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var MAX_TRANSFER_BYTES = 16 * 1024 * 1024;
  var CHUNK_BYTES = 32 * 1024;
  var THEMES = ["celestial", "parchment", "ember", "grove"];
  var LOCALES = ["zh-CN", "en"];
  var DECK_TYPES = ["tarot", "mystagogus", "lxxxi"];
  var FILE_KINDS = ["history", "qsp", "backup"];
  var FILE_ACTIONS = ["save", "share"];
  var PROTECTED_BASE_PATTERN = /^quareia-app:\/\/app\/_m\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}){2}$/;

  function fail(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isPlainObject(value) {
    if (!value || Object.prototype.toString.call(value) !== "[object Object]") return false;
    var prototype = Object.getPrototypeOf(value);
    return prototype === null || prototype === Object.prototype;
  }

  function integer(value, minimum, maximum, code) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) throw fail(code);
    return value;
  }

  function oneOf(value, allowed, code) {
    if (allowed.indexOf(value) === -1) throw fail(code);
    return value;
  }

  function boundedText(value, maximumBytes, code) {
    if (typeof value !== "string" || value.length === 0 || utf8(value).length > maximumBytes) throw fail(code);
    return value;
  }

  function fileName(value) {
    boundedText(value, 128, "INVALID_FILE_NAME");
    if (value !== value.trim() || value.charAt(0) === "." || /[\\/:\0]/.test(value)) {
      throw fail("INVALID_FILE_NAME");
    }
    return value;
  }

  function exactKeys(value, expected) {
    if (!isPlainObject(value)) return false;
    var actual = Object.keys(value).sort();
    expected = expected.slice().sort();
    return actual.length === expected.length && actual.every(function (key, index) {
      return key === expected[index];
    });
  }

  function utf8(value) {
    if (typeof TextEncoder === "undefined") throw fail("TEXT_ENCODER_UNAVAILABLE");
    return new TextEncoder().encode(value);
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder === "undefined") throw fail("TEXT_DECODER_UNAVAILABLE");
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (_error) {
      throw fail("INVALID_UTF8");
    }
  }

  function encodeBase64(bytes) {
    var binary = "";
    for (var offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, Math.min(bytes.length, offset + 8192)));
    }
    if (root && typeof root.btoa === "function") return root.btoa(binary);
    if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
    throw fail("BASE64_UNAVAILABLE");
  }

  function decodeBase64(value) {
    if (typeof value !== "string" || value.length > Math.ceil(CHUNK_BYTES / 3) * 4 + 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
      throw fail("INVALID_BASE64");
    }
    var binary;
    try {
      if (root && typeof root.atob === "function") binary = root.atob(value);
      else if (typeof Buffer !== "undefined") binary = Buffer.from(value, "base64").toString("latin1");
      else throw fail("BASE64_UNAVAILABLE");
    } catch (_error) {
      throw fail("INVALID_BASE64");
    }
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    if (bytes.length > CHUNK_BYTES || encodeBase64(bytes) !== value) {
      throw fail("INVALID_BASE64");
    }
    return bytes;
  }

  function concat(chunks, total) {
    var bytes = new Uint8Array(total);
    var offset = 0;
    chunks.forEach(function (chunk) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    });
    return bytes;
  }

  function validateTransferID(value) {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
      throw fail("INVALID_TRANSFER_ID");
    }
    return value;
  }

  function validateProtectedAssetBaseURL(value) {
    if (typeof value !== "string" || !PROTECTED_BASE_PATTERN.test(value)) {
      throw fail("INVALID_HOST_INFO");
    }
    return value;
  }

  function createAdapter(options) {
    options = options || {};
    var sequence = 0;
    var environment = options.root || root;
    var nativeProvider = options.native || function () { return environment && environment.QuareiaNative; };

    function request(method, params) {
      var nativeApi = typeof nativeProvider === "function" ? nativeProvider() : nativeProvider;
      if (!nativeApi || typeof nativeApi.request !== "function") return Promise.reject(fail("NATIVE_UNAVAILABLE"));
      sequence = (sequence + 1) % 1000000000;
      var id = "ios_" + Date.now().toString(36) + "_" + sequence.toString(36);
      return Promise.resolve(nativeApi.request({ id: id, method: method, params: params || {} }));
    }

    function fire(method, params) {
      var pending = request(method, params);
      pending.catch(function () {});
      return pending;
    }

    function setTheme(theme) {
      return fire("setTheme", { theme: oneOf(theme, THEMES, "INVALID_THEME") });
    }

    function setLocale(locale) {
      return fire("setLocale", { locale: oneOf(locale, LOCALES, "INVALID_LOCALE") });
    }

    function readingCompleted(deckType, cardCount) {
      oneOf(deckType, DECK_TYPES, "INVALID_DECK_TYPE");
      return fire("readingCompleted", {
        deckType: deckType,
        cardCount: integer(cardCount, 1, deckType === "tarot" ? 78 : 81, "INVALID_CARD_COUNT")
      });
    }

    function setTelemetryEnabled(enabled) {
      if (typeof enabled !== "boolean") return Promise.reject(fail("INVALID_ENABLED"));
      return request("setTelemetryEnabled", { enabled: enabled });
    }

    async function initialize() {
      var info = await request("hostInfo", {});
      if (!isPlainObject(info)) throw fail("INVALID_HOST_INFO");
      var protectedBase = validateProtectedAssetBaseURL(info.protectedAssetBaseURL);
      if (!environment || Object.prototype.hasOwnProperty.call(environment, "__qMediaBase")) {
        throw fail("INVALID_HOST_INFO");
      }
      try {
        Object.defineProperty(environment, "__qMediaBase", {
          value: protectedBase,
          writable: false,
          configurable: false,
          enumerable: false
        });
      } catch (_error) {
        throw fail("INVALID_HOST_INFO");
      }
      return info;
    }

    async function exportBytes(kind, name, bytes, action) {
      oneOf(kind, FILE_KINDS, "INVALID_FILE_KIND");
      oneOf(action || "save", FILE_ACTIONS, "INVALID_FILE_ACTION");
      fileName(name);
      if (!(bytes instanceof Uint8Array)) throw fail("INVALID_FILE_BYTES");
      integer(bytes.length, 0, MAX_TRANSFER_BYTES, "FILE_TOO_LARGE");
      if (kind === "qsp" && bytes.length > 16 * 1024) throw fail("FILE_TOO_LARGE");
      var transferID = null;
      try {
        var opened = await request("fileExportBegin", {
          kind: kind,
          name: name,
          byteCount: bytes.length
        });
        if (!exactKeys(opened, ["transferID"])) throw fail("INVALID_NATIVE_REPLY");
        transferID = validateTransferID(opened.transferID);
        for (var offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
          var chunk = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK_BYTES));
          var accepted = await request("fileExportChunk", {
            transferID: transferID,
            offset: offset,
            base64: encodeBase64(chunk)
          });
          if (!exactKeys(accepted, ["offset", "byteCount", "nextOffset"]) || accepted.offset !== offset || accepted.byteCount !== chunk.length ||
              accepted.nextOffset !== offset + chunk.length) {
            throw fail("INVALID_NATIVE_REPLY");
          }
        }
        var result = await request("fileExportFinish", {
          transferID: transferID,
          action: action || "save"
        });
        if (!exactKeys(result, ["outcome", "name"]) || ["success", "cancelled", "failure"].indexOf(result.outcome) === -1 ||
            typeof result.name !== "string") {
          throw fail("INVALID_NATIVE_REPLY");
        }
        transferID = null;
        return result;
      } catch (error) {
        if (transferID) {
          try { await request("fileTransferCancel", { transferID: transferID }); } catch (_cancelError) {}
        }
        throw error;
      }
    }

    function exportText(kind, name, text, action) {
      if (typeof text !== "string") return Promise.reject(fail("INVALID_FILE_TEXT"));
      var bytes;
      try { bytes = utf8(text); } catch (error) { return Promise.reject(error); }
      return exportBytes(kind, name, bytes, action || "save");
    }

    async function importBytes(kind) {
      oneOf(kind, FILE_KINDS, "INVALID_FILE_KIND");
      var transferID = null;
      try {
        var opened = await request("fileImport", { kind: kind });
        if (!isPlainObject(opened)) throw fail("INVALID_NATIVE_REPLY");
        if (opened.outcome === "cancelled" || opened.outcome === "failure") {
          if (!exactKeys(opened, ["outcome"])) throw fail("INVALID_NATIVE_REPLY");
          return { outcome: opened.outcome };
        }
        if (opened.outcome !== "success" || !exactKeys(opened, ["outcome", "transferID", "name", "byteCount"])) {
          throw fail("INVALID_NATIVE_REPLY");
        }
        transferID = validateTransferID(opened.transferID);
        var declaredBytes = integer(opened.byteCount, 0, MAX_TRANSFER_BYTES, "FILE_TOO_LARGE");
        var chunks = [];
        var offset = 0;
        var eof = declaredBytes === 0;
        while (!eof) {
          var reply = await request("fileImportRead", {
            transferID: transferID,
            offset: offset,
            length: Math.min(CHUNK_BYTES, declaredBytes - offset)
          });
          if (!exactKeys(reply, ["base64", "offset", "byteCount", "eof"]) || reply.offset !== offset || typeof reply.eof !== "boolean") {
            throw fail("INVALID_NATIVE_REPLY");
          }
          var chunk = decodeBase64(reply.base64);
          if (reply.byteCount !== chunk.length || chunk.length === 0 || offset + chunk.length > declaredBytes) {
            throw fail("INVALID_NATIVE_REPLY");
          }
          chunks.push(chunk);
          offset += chunk.length;
          eof = reply.eof;
          if (eof !== (offset === declaredBytes)) throw fail("INVALID_NATIVE_REPLY");
        }
        var finished = await request("fileImportFinish", { transferID: transferID });
        if (!exactKeys(finished, [])) throw fail("INVALID_NATIVE_REPLY");
        transferID = null;
        return {
          outcome: "success",
          name: typeof opened.name === "string" ? opened.name : "",
          bytes: concat(chunks, declaredBytes)
        };
      } catch (error) {
        if (transferID) {
          try { await request("fileTransferCancel", { transferID: transferID }); } catch (_cancelError) {}
        }
        throw error;
      }
    }

    async function importText(kind) {
      var result = await importBytes(kind);
      if (result.outcome !== "success") return result;
      return { outcome: "success", name: result.name, text: decodeUtf8(result.bytes) };
    }

    var ready = initialize();
    ready.catch(function () {});

    return Object.freeze({
      ready: ready,
      request: request,
      hostInfo: function () { return request("hostInfo", {}); },
      setTheme: setTheme,
      setLocale: setLocale,
      presentAbout: function () { return fire("presentAbout", {}); },
      presentPrivacy: function () { return fire("presentPrivacy", {}); },
      presentAnnouncements: function () { return fire("presentAnnouncements", {}); },
      checkForUpdates: function () { return fire("checkForUpdates", {}); },
      readingCompleted: readingCompleted,
      telemetryState: function () { return request("telemetryState", {}); },
      setTelemetryEnabled: setTelemetryEnabled,
      exportBytes: exportBytes,
      exportText: exportText,
      importBytes: importBytes,
      importText: importText
    });
  }

  var adapter = createAdapter();
  var api = {};
  Object.keys(adapter).forEach(function (key) { api[key] = adapter[key]; });
  api.MAX_TRANSFER_BYTES = MAX_TRANSFER_BYTES;
  api.CHUNK_BYTES = CHUNK_BYTES;
  api.THEMES = Object.freeze(THEMES.slice());
  api.LOCALES = Object.freeze(LOCALES.slice());
  api.DECK_TYPES = Object.freeze(DECK_TYPES.slice());
  api.FILE_KINDS = Object.freeze(FILE_KINDS.slice());
  api.createAdapter = createAdapter;
  return Object.freeze(api);
});
