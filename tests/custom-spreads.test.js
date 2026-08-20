"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var test = require("node:test");
var customSpreads = require("../js/custom-spreads.js");

function definition() {
  return {
    name: "  我的牌阵 🌙  ",
    description: "  用于测试的中文说明  ",
    columns: 2,
    rows: 2,
    positions: [
      { name: "  过去  ", meaning: "  已经发生的事  ", column: 1, row: 1 },
      { name: "现在", meaning: "此刻的状态", column: 2, row: 1 }
    ]
  };
}

function withChanges(source, changes) {
  var result = JSON.parse(JSON.stringify(source));
  Object.keys(changes).forEach(function (key) { result[key] = changes[key]; });
  return result;
}

function storageFixture(initial) {
  var values = Object.create(null);
  if (initial !== undefined) values[customSpreads.STORAGE_KEY] = initial;
  var calls = { get: 0, set: 0, remove: 0 };
  return {
    calls: calls,
    getItem: function (key) { calls.get++; return hasOwn(values, key) ? values[key] : null; },
    setItem: function (key, value) { calls.set++; values[key] = String(value); },
    removeItem: function (key) { calls.remove++; delete values[key]; },
    raw: function () { return values[customSpreads.STORAGE_KEY]; }
  };
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

test("custom spread tracer normalizes UTF-8 input and produces deterministic codes", function () {
  var normalized = customSpreads.normalizeDefinition(definition());

  assert.equal(normalized.name, "我的牌阵 🌙");
  assert.equal(normalized.positions[0].name, "过去");
  assert.equal(normalized.positions[0].number, 1);
  assert.equal(normalized.positions[0].nameEn, "过去");
  assert.equal(normalized.positions[0].meaningEn, "已经发生的事");

  var first = customSpreads.encode(definition());
  var second = customSpreads.encode(definition());
  assert.equal(first, second);
  assert.match(first, /^QSP1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);
  assert.deepEqual(customSpreads.decode(first), normalized);
});

test("normalization enforces the public schema, text limits, and integer grid bounds", function () {
  assert.throws(function () { customSpreads.normalizeDefinition(withChanges(definition(), { extra: true })); });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), { name: " \t\n " }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), { name: "a\u0000b" }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), { columns: 1.5 }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), { columns: customSpreads.MAX_COLUMNS + 1 }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), { rows: 0 }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), {
      positions: [{ name: "x", meaning: "", column: 3, row: 1 }]
    }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), {
      positions: [{ name: "x", meaning: "", column: 1, row: 1, unknown: true }]
    }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), {
      description: "x".repeat(customSpreads.MAX_DESCRIPTION_LENGTH + 1)
    }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), {
      positions: [{
        name: "x",
        meaning: "x".repeat(customSpreads.MAX_MEANING_LENGTH + 1),
        column: 1,
        row: 1
      }]
    }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(withChanges(definition(), {
      positions: Array.from({ length: customSpreads.MAX_POSITIONS + 1 }, function () {
        return { name: "x", meaning: "", column: 1, row: 1 };
      })
    }));
  });
  assert.throws(function () {
    customSpreads.normalizeDefinition(new Date());
  });
});

test("share codes reject damage, unknown versions, non-canonical payloads, and oversized inputs", function () {
  var code = customSpreads.encode(definition());
  var damaged = code.slice(0, -1) + (code.endsWith("0") ? "1" : "0");
  assert.throws(function () { customSpreads.decode(damaged); });
  assert.throws(function () { customSpreads.decode(code.replace("QSP1.", "QSP2.")); });
  assert.throws(function () { customSpreads.decode("QSP1." + "A".repeat(customSpreads.MAX_CODE_LENGTH)); });
  assert.throws(function () { customSpreads.decode(code + ".extra"); });
  assert.throws(function () { customSpreads.decode("QSP1.not-base64.00000000"); });

  var compact = JSON.stringify({ v: 1, n: "x", d: "", c: 1, r: 1, p: [["one", "", 1, 1]] });
  var payload = Buffer.from(compact, "utf8").toString("base64url");
  var reordered = JSON.stringify({ p: [["one", "", 1, 1]], r: 1, c: 1, d: "", n: "x", v: 1 });
  var reorderedPayload = Buffer.from(reordered, "utf8").toString("base64url");
  function checksum(value) {
    var hash = 0x811c9dc5;
    for (var index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
    return hash.toString(16).padStart(8, "0");
  }
  assert.throws(function () {
    customSpreads.decode("QSP1." + reorderedPayload + "." + checksum(reorderedPayload));
  });
  var unknown = JSON.stringify({ v: 1, n: "x", d: "", c: 1, r: 1, p: [["one", "", 1, 1]], x: 1 });
  var unknownPayload = Buffer.from(unknown, "utf8").toString("base64url");
  assert.throws(function () {
    customSpreads.decode("QSP1." + unknownPayload + "." + checksum(unknownPayload));
  });
});

test("runtime spreads carry custom metadata and make same-cell positions visible", function () {
  var runtime = customSpreads.toRuntimeSpread({
    name: "Stacked",
    description: "",
    columns: 1,
    rows: 1,
    positions: [
      { name: "Base", meaning: "", column: 1, row: 1 },
      { name: "Top", meaning: "", column: 1, row: 1 },
      { name: "Last", meaning: "", column: 1, row: 1 }
    ]
  });
  var sameRuntime = customSpreads.toRuntimeSpread({
    name: "Stacked",
    description: "",
    columns: 1,
    rows: 1,
    positions: [
      { name: "Base", meaning: "", column: 1, row: 1 },
      { name: "Top", meaning: "", column: 1, row: 1 },
      { name: "Last", meaning: "", column: 1, row: 1 }
    ]
  });
  assert.match(runtime.id, /^custom-[0-9a-f]{16}$/);
  assert.equal(runtime.id, sameRuntime.id);
  assert.ok(runtime.id.length <= 100, "runtime ID must fit the history schema");
  assert.equal(runtime.category, "custom");
  assert.equal(runtime.source, "User-created spread");
  assert.equal(runtime.isCustom, true);
  assert.deepEqual(runtime.positions.map(function (position) {
    return [position.number, position.offsetX, position.offsetY];
  }), [[1, 0, 0], [2, customSpreads.STACK_OFFSET_X, customSpreads.STACK_OFFSET_Y],
    [3, customSpreads.STACK_OFFSET_X * 2, customSpreads.STACK_OFFSET_Y * 2]]);
});

test("runtime IDs do not reproduce the 32-bit s24797/s101153 collision", function () {
  function collisionDefinition(name) {
    return {
      name: name,
      description: "",
      columns: 1,
      rows: 1,
      positions: [{ name: "p", meaning: "", column: 1, row: 1 }]
    };
  }
  var first = collisionDefinition("s24797");
  var second = collisionDefinition("s101153");
  var firstCode = customSpreads.encode(first);
  var secondCode = customSpreads.encode(second);
  assert.equal(firstCode.slice(-8), secondCode.slice(-8));
  var firstRuntime = customSpreads.toRuntimeSpread(first);
  var secondRuntime = customSpreads.toRuntimeSpread(second);
  assert.notEqual(firstRuntime.id, secondRuntime.id);

  var library = customSpreads.createLibrary({ platform: "web" });
  library.upsert(first);
  library.upsert(second);
  assert.equal(library.list().length, 2);
  assert.deepEqual(library.list().map(function (spread) { return spread.name; }), ["s24797", "s101153"]);
});

test("Android library persists, reloads, removes, locks corrupt storage, and caps at 50", function () {
  var storage = storageFixture();
  var android = customSpreads.createLibrary({ platform: "android", storage: storage });
  var saved = android.upsert(definition());
  assert.equal(storage.calls.get, 1);
  assert.equal(storage.calls.set, 1);
  assert.equal(android.exportCode(saved.id), customSpreads.encode(definition()));

  var reloaded = customSpreads.createLibrary({ platform: "android", storage: storage });
  assert.deepEqual(reloaded.list(), android.list());
  assert.equal(reloaded.remove(saved.id), true);
  assert.equal(reloaded.list().length, 0);
  var afterDelete = customSpreads.createLibrary({ platform: "android", storage: storage });
  assert.deepEqual(afterDelete.list(), []);

  storage.setItem(customSpreads.STORAGE_KEY, "{broken");
  var recovered = customSpreads.createLibrary({ platform: "android", storage: storage });
  assert.deepEqual(recovered.list(), []);
  var corruptRaw = storage.raw();
  assert.throws(function () { recovered.upsert(definition()); }, function (error) {
    return error && error.code === "CUSTOM_SPREAD_STORAGE";
  });
  assert.throws(function () { recovered.remove("custom-missing"); }, function (error) {
    return error && error.code === "CUSTOM_SPREAD_STORAGE";
  });
  assert.equal(storage.raw(), corruptRaw, "corrupt data must not be overwritten");

  var futureRaw = '{"v":99,"items":[]}';
  var futureStorage = storageFixture(futureRaw);
  var futureLibrary = customSpreads.createLibrary({ platform: "android", storage: futureStorage });
  assert.deepEqual(futureLibrary.list(), []);
  assert.throws(function () { futureLibrary.upsert(definition()); }, function (error) {
    return error && error.code === "CUSTOM_SPREAD_STORAGE";
  });
  assert.throws(function () { futureLibrary.remove("custom-missing"); }, function (error) {
    return error && error.code === "CUSTOM_SPREAD_STORAGE";
  });
  assert.equal(futureStorage.raw(), futureRaw, "unknown versions must remain recoverable");

  var cappedStorage = storageFixture();
  var capped = customSpreads.createLibrary({ platform: "android", storage: cappedStorage });
  for (var index = 0; index < customSpreads.MAX_LIBRARY_SIZE; index++) {
    capped.upsert({
      name: "Spread " + index,
      description: "",
      columns: 1,
      rows: 1,
      positions: [{ name: "Position", meaning: "", column: 1, row: 1 }]
    });
  }
  assert.equal(capped.list().length, customSpreads.MAX_LIBRARY_SIZE);
  assert.throws(function () {
    capped.upsert({
      name: "One too many",
      description: "",
      columns: 1,
      rows: 1,
      positions: [{ name: "Position", meaning: "", column: 1, row: 1 }]
    });
  });
  assert.equal(capped.list().length, customSpreads.MAX_LIBRARY_SIZE);
});

test("library results are defensive clones and the web library never touches storage", function () {
  var storage = {
    getItem: function () { throw new Error("web must not read storage"); },
    setItem: function () { throw new Error("web must not write storage"); },
    removeItem: function () { throw new Error("web must not remove storage"); }
  };
  var web = customSpreads.createLibrary({ platform: "web", storage: storage });
  var saved = web.upsert(definition());
  saved.name = "mutated";
  saved.positions[0].name = "mutated";
  var listed = web.list();
  listed[0].positions[0].meaning = "mutated";
  assert.equal(web.getById(web.list()[0].id).name, "我的牌阵 🌙");
  assert.equal(web.getById(web.list()[0].id).positions[0].name, "过去");
  assert.equal(web.getById(web.list()[0].id).positions[0].meaning, "已经发生的事");
  assert.equal(web.importCode(web.exportCode(web.list()[0].id)).id, web.list()[0].id);
});

test("Android storage failures are coded and leave library state unchanged", function () {
  var missingStorage = customSpreads.createLibrary({ platform: "android", storage: null });
  assert.throws(function () { missingStorage.upsert(definition()); }, function (error) {
    return error && error.code === "CUSTOM_SPREAD_STORAGE";
  });
  assert.deepEqual(missingStorage.list(), []);

  var failingUpsertStorage = storageFixture();
  failingUpsertStorage.setItem = function () {
    failingUpsertStorage.calls.set++;
    throw new Error("write failed");
  };
  var failingUpsert = customSpreads.createLibrary({ platform: "android", storage: failingUpsertStorage });
  assert.throws(function () { failingUpsert.upsert(definition()); }, function (error) {
    return error && error.code === "CUSTOM_SPREAD_STORAGE";
  });
  assert.deepEqual(failingUpsert.list(), []);

  var removeStorage = storageFixture();
  var removable = customSpreads.createLibrary({ platform: "android", storage: removeStorage });
  var saved = removable.upsert(definition());
  var beforeRemoveFailure = removable.list();
  removeStorage.setItem = function () {
    removeStorage.calls.set++;
    throw new Error("write failed");
  };
  assert.throws(function () { removable.remove(saved.id); }, function (error) {
    return error && error.code === "CUSTOM_SPREAD_STORAGE";
  });
  assert.deepEqual(removable.list(), beforeRemoveFailure);
});

test("web and Android core assets are mirrored byte-for-byte", function () {
  assert.equal(
    fs.readFileSync("js/custom-spreads.js", "utf8"),
    fs.readFileSync("android-demo/app/src/main/assets/www/js/custom-spreads.js", "utf8")
  );
});
