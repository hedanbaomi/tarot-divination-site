"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var history = require("../js/history-records.js");
var spreads = require("../js/spreads.js");

function card(id, number, name, extras) {
  return Object.assign({
    id: id,
    number: number,
    name: name,
    arcana: "major",
    suit: ""
  }, extras || {});
}

function entry(slotIndex, sourceCard, orientation, layer) {
  return {
    card: sourceCard,
    orientation: orientation || "upright",
    slotIndex: slotIndex,
    layer: layer == null ? null : layer
  };
}

function buildInput(spreadDefinition, entries, overrides) {
  return Object.assign({
    id: "reading-test-1",
    createdAt: "2026-07-26T12:00:00.000Z",
    deckType: "tarot",
    deckMode: "tarot",
    deckName: "塔罗牌（Rider–Waite 体系）",
    spreadId: spreadDefinition.id,
    spreadName: spreadDefinition.name,
    orientationMode: "mixed",
    filterMode: "mixed",
    overviewMethod: "not-applicable",
    positions: spreadDefinition.positions,
    entries: entries
  }, overrides || {});
}

test("builds a complete immutable snapshot for a normal spread", function () {
  var spread = spreads.getTarotSpread("three-card-horizontal");
  var record = history.buildReadingRecord(buildInput(spread, [
    entry(0, card("major-00", "00", "愚者")),
    entry(1, card("major-01", "01", "魔法师"), "reversed"),
    entry(2, card("minor-cups-ace", "ace", "圣杯王牌", { arcana: "minor", suit: "圣杯" }))
  ]));

  assert.equal(record.schemaVersion, history.SCHEMA_VERSION);
  assert.equal(record.positionCount, 3);
  assert.equal(record.cards.length, 3);
  assert.deepEqual(record.cards[1], {
    cardId: "major-01",
    cardNumber: "01",
    cardName: "魔法师",
    orientation: "reversed",
    slotIndex: 1,
    positionNumber: 2,
    positionName: "现在 · Present",
    layer: null,
    arcana: "major",
    suit: ""
  });
  assert.equal(Object.prototype.hasOwnProperty.call(record.cards[0], "image"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(record.cards[0], "meaning"), false);
  assert.doesNotThrow(function () { history.validateRecord(record); });
});

test("assigns stable deck arcana values when non-tarot source cards omit arcana", function () {
  var spread = {
    id: "m-single",
    name: "单张牌",
    positions: [{ number: 1, name: "核心", nameEn: "Core" }]
  };
  var record = history.buildReadingRecord(buildInput(spread, [
    entry(0, { id: "m-01", number: 1, name: "魔法师", suit: "" })
  ], {
    deckType: "mystagogus",
    deckMode: "mystagogus",
    deckName: "Mystagogus",
    orientationMode: "upright-only",
    filterMode: "not-applicable",
    overviewMethod: "not-applicable"
  }));

  assert.equal(record.cards[0].arcana, "mystagogus");
  assert.doesNotThrow(function () { history.validateRecord(record); });
});

test("captures all five constrained Four Seasons positions", function () {
  var spread = spreads.getTarotSpread("four-seasons");
  var cards = [
    card("minor-wands-ace", "ace", "权杖王牌", { arcana: "minor", suit: "权杖" }),
    card("minor-cups-two", "two", "圣杯二", { arcana: "minor", suit: "圣杯" }),
    card("minor-swords-three", "three", "宝剑三", { arcana: "minor", suit: "宝剑" }),
    card("minor-pentacles-four", "four", "星币四", { arcana: "minor", suit: "星币" }),
    card("major-19", "19", "太阳", { arcana: "major", suit: "" })
  ];
  var record = history.buildReadingRecord(buildInput(
    spread,
    cards.map(function (sourceCard, index) { return entry(index, sourceCard); }),
    { orientationMode: "upright-only" }
  ));

  assert.equal(record.cards.length, 5);
  assert.deepEqual(record.cards.map(function (item) { return item.positionNumber; }), [1, 2, 3, 4, 5]);
  assert.deepEqual(record.cards.map(function (item) { return item.suit; }), ["权杖", "圣杯", "宝剑", "星币", ""]);
  assert.equal(record.cards[4].arcana, "major");
  assert.doesNotThrow(function () { history.validateRecord(record); });
});

test("captures the Overview 26-card major/minor layers in slot order", function () {
  var spread = spreads.getTarotSpread("overview");
  var entries = [];
  for (var i = 0; i < 13; i++) {
    entries.push(entry(i, card("major-" + String(i).padStart(2, "0"), String(i), "大牌 " + i), "upright", "major"));
  }
  for (var j = 0; j < 13; j++) {
    entries.push(entry(j, card("minor-wands-" + j, String(j), "小牌 " + j, {
      arcana: "minor",
      suit: "权杖"
    }), "upright", "minor"));
  }
  var record = history.buildReadingRecord(buildInput(spread, entries, {
    overviewMethod: "stacked",
    filterMode: "not-applicable",
    orientationMode: "upright-only"
  }));

  assert.equal(record.positionCount, 13);
  assert.equal(record.cards.length, 26);
  for (var slot = 0; slot < 13; slot++) {
    var pair = record.cards.filter(function (item) { return item.slotIndex === slot; });
    assert.deepEqual(pair.map(function (item) { return item.layer; }), ["major", "minor"]);
    assert.equal(pair[0].positionNumber, slot + 1);
    assert.equal(pair[1].positionName, pair[0].positionName);
  }
  assert.doesNotThrow(function () { history.validateRecord(record); });
});

test("serializes an export envelope with formatVersion and round-trips", function () {
  var spread = spreads.getTarotSpread("three-card-horizontal");
  var record = history.buildReadingRecord(buildInput(spread, [
    entry(0, card("major-00", "00", "愚者")),
    entry(1, card("major-01", "01", "魔法师")),
    entry(2, card("major-02", "02", "女祭司"))
  ]));
  var json = history.serializeExport([record], "2026-07-26T13:00:00.000Z");
  var parsed = history.parseImportJson(json);

  assert.equal(parsed.formatVersion, history.FORMAT_VERSION);
  assert.equal(parsed.exportedAt, "2026-07-26T13:00:00.000Z");
  assert.deepEqual(parsed.records, [record]);
});

test("strict import validation rejects invalid versions, dates and card fields", function () {
  var spread = spreads.getTarotSpread("three-card-horizontal");
  var record = history.buildReadingRecord(buildInput(spread, [
    entry(0, card("major-00", "00", "愚者")),
    entry(1, card("major-01", "01", "魔法师")),
    entry(2, card("major-02", "02", "女祭司"))
  ]));
  var envelope = history.createExportEnvelope([record], "2026-07-26T13:00:00.000Z");

  assert.throws(function () {
    history.parseImportJson(JSON.stringify(Object.assign({}, envelope, { formatVersion: 999 })));
  }, /formatVersion/);

  var badDate = JSON.parse(JSON.stringify(envelope));
  badDate.records[0].createdAt = "not-a-date";
  assert.throws(function () { history.parseImportJson(JSON.stringify(badDate)); }, /createdAt/);

  var badOrientation = JSON.parse(JSON.stringify(envelope));
  badOrientation.records[0].cards[0].orientation = "sideways";
  assert.throws(function () { history.parseImportJson(JSON.stringify(badOrientation)); }, /orientation/);

  var badSlot = JSON.parse(JSON.stringify(envelope));
  badSlot.records[0].cards[0].slotIndex = 99;
  assert.throws(function () { history.parseImportJson(JSON.stringify(badSlot)); }, /slotIndex/);

  var badPositionNumber = JSON.parse(JSON.stringify(envelope));
  badPositionNumber.records[0].cards[0].positionNumber = 2;
  assert.throws(function () {
    history.parseImportJson(JSON.stringify(badPositionNumber));
  }, /positionNumber/);

  var badOrientationMode = JSON.parse(JSON.stringify(envelope));
  badOrientationMode.records[0].orientationMode = "upright-only";
  badOrientationMode.records[0].cards[0].orientation = "reversed";
  assert.throws(function () {
    history.parseImportJson(JSON.stringify(badOrientationMode));
  }, /upright-only/);
});

test("strict validation rejects mismatched deck arcana and overview layers", function () {
  var spread = spreads.getTarotSpread("three-card-horizontal");
  var tarotRecord = history.buildReadingRecord(buildInput(spread, [
    entry(0, card("major-00", "00", "愚者")),
    entry(1, card("major-01", "01", "魔法师")),
    entry(2, card("major-02", "02", "女祭司"))
  ]));
  tarotRecord.cards[0].arcana = "mystagogus";
  assert.throws(function () { history.validateRecord(tarotRecord); }, /tarot arcana/);

  var overview = spreads.getTarotSpread("overview");
  var entries = [];
  overview.positions.forEach(function (_position, slotIndex) {
    entries.push(entry(slotIndex, card("major-" + slotIndex, slotIndex, "大牌" + slotIndex), "upright", "major"));
    entries.push(entry(slotIndex, card("minor-" + slotIndex, slotIndex, "小牌" + slotIndex, {
      arcana: "minor",
      suit: "圣杯"
    }), "upright", "minor"));
  });
  var overviewRecord = history.buildReadingRecord(buildInput(overview, entries, {
    spreadId: "overview",
    overviewMethod: "stacked"
  }));
  overviewRecord.cards[0].arcana = "minor";
  assert.throws(function () { history.validateRecord(overviewRecord); }, /layer/);
});

test("duplicate detection only suppresses identical recent snapshots", function () {
  var spread = spreads.getTarotSpread("three-card-horizontal");
  var existing = history.buildReadingRecord(buildInput(spread, [
    entry(0, card("major-00", "00", "愚者")),
    entry(1, card("major-01", "01", "魔法师")),
    entry(2, card("major-02", "02", "女祭司"))
  ]));
  var recent = JSON.parse(JSON.stringify(existing));
  recent.id = "reading-test-2";
  recent.createdAt = "2026-07-26T12:00:05.000Z";
  var later = JSON.parse(JSON.stringify(recent));
  later.createdAt = "2026-07-26T12:01:00.000Z";
  var changed = JSON.parse(JSON.stringify(recent));
  changed.cards[0].orientation = "reversed";

  assert.equal(history.isRecentDuplicate([existing], recent, 10000), true);
  assert.equal(history.isRecentDuplicate([existing], later, 10000), false);
  assert.equal(history.isRecentDuplicate([existing], changed, 10000), false);
});

test("duplicate imported IDs keep local records and deterministically remap imports", function () {
  var records = [
    { id: "existing-id" },
    { id: "fresh-id" },
    { id: "existing-id" }
  ];
  var generated = ["remapped-1", "remapped-2"];
  var result = history.resolveImportedIds(records, ["existing-id"], function () {
    return generated.shift();
  });

  assert.deepEqual(result.records.map(function (item) { return item.id; }), [
    "remapped-1",
    "fresh-id",
    "remapped-2"
  ]);
  assert.equal(result.remappedCount, 2);
  assert.equal(records[0].id, "existing-id");
});

test("malicious or over-broad JSON is rejected without accepting notes or meanings", function () {
  var spread = spreads.getTarotSpread("three-card-horizontal");
  var record = history.buildReadingRecord(buildInput(spread, [
    entry(0, card("major-00", "00", "愚者")),
    entry(1, card("major-01", "01", "魔法师")),
    entry(2, card("major-02", "02", "女祭司"))
  ]));
  var envelope = history.createExportEnvelope([record], "2026-07-26T13:00:00.000Z");

  var withNotes = JSON.parse(JSON.stringify(envelope));
  withNotes.records[0].notes = "<img src=x onerror=alert(1)>";
  assert.throws(function () { history.parseImportJson(JSON.stringify(withNotes)); }, /unexpected field/);

  var withMeaning = JSON.parse(JSON.stringify(envelope));
  withMeaning.records[0].cards[0].meaning = "<script>alert(1)</script>";
  assert.throws(function () { history.parseImportJson(JSON.stringify(withMeaning)); }, /unexpected field/);

  var polluted = JSON.stringify({
    formatVersion: history.FORMAT_VERSION,
    exportedAt: "2026-07-26T13:00:00.000Z",
    records: [Object.assign(JSON.parse(JSON.stringify(record)), { "__proto__": { polluted: true } })]
  }).replace('"cards"', '"__proto__":{"polluted":true},"cards"');
  assert.throws(function () { history.parseImportJson(polluted); }, /unexpected field/);
  assert.equal({}.polluted, undefined);
});
