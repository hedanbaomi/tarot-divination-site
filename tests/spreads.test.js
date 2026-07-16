"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var catalogue = require("../js/spreads.js");

var expectedCounts = {
  "three-card-horizontal": 3,
  "yes-no": 6,
  "tree-of-life": 10,
  overview: 13,
  event: 7,
  direction: 5,
  resources: 11,
  timing: 8,
  "manifestation-cause": 10,
  solution: 10,
  health: 15,
  "fate-pattern": 10,
  angel: 11,
  landscape: 12,
  "self-map": 18
};

var expectedCoordinates = {
  "three-card-horizontal": ["1,1", "2,1", "3,1"],
  "yes-no": ["2,2", "1,1", "1,3", "3,3", "3,1", "2,2"],
  "tree-of-life": ["2,1", "3,2", "1,2", "3,3", "1,3", "2,4", "3,5", "1,5", "2,6", "2,7"],
  overview: ["1,1", "2,1", "3,1", "4,1", "5,1", "6,1", "1,2", "2,2", "3,2", "4,2", "5,2", "6,2", "7,1"],
  event: ["2,3", "2,5", "1,4", "1,2", "3,2", "3,4", "2,1"],
  direction: ["2,2", "3,2", "2,3", "1,2", "2,1"],
  resources: ["2,4", "2,1", "2,7", "1,6", "1,5", "1,3", "1,2", "3,2", "3,3", "3,5", "3,6"],
  timing: ["1,1", "2,1", "3,1", "4,1", "1,2", "2,2", "3,2", "4,2"],
  "manifestation-cause": ["2,4", "1,6", "1,5", "1,3", "1,2", "2,1", "3,2", "3,3", "3,5", "3,6"],
  solution: ["2,4", "1,6", "1,5", "1,3", "1,2", "2,1", "3,2", "3,3", "3,5", "3,6"],
  health: ["2,1", "2,3", "2,5", "3,2", "1,2", "3,4", "1,4", "2,6", "3,6", "1,6", "3,8", "1,8", "2,7", "2,9", "2,10"],
  "fate-pattern": ["3,3", "3,5", "3,1", "1,3", "2,2", "4,2", "5,3", "4,4", "2,4", "3,3"],
  angel: ["3,3", "2,4", "1,3", "2,2", "4,2", "5,3", "4,4", "3,1", "2,5", "3,5", "4,5"],
  landscape: ["3,4", "3,4", "3,1", "3,7", "1,4", "2,3", "3,2", "4,3", "4,5", "3,6", "2,5", "5,4"],
  "self-map": ["4,5", "4,9", "4,1", "3,4", "5,4", "5,6", "3,6", "2,3", "4,3", "6,3", "6,7", "2,7", "1,8", "1,5", "1,2", "7,2", "7,5", "7,8"]
};

test("catalogue contains every Chapter 6 spread plus the horizontal three-card spread", function () {
  assert.deepEqual(
    catalogue.tarotSpreads.map(function (spread) { return spread.id; }).sort(),
    Object.keys(expectedCounts).sort()
  );
});

test("every spread has continuous, bounded positions and the expected card count", function () {
  assert.equal(catalogue.validateTarotSpreads(catalogue.tarotSpreads), true);

  catalogue.tarotSpreads.forEach(function (spread) {
    assert.equal(spread.positions.length, expectedCounts[spread.id], spread.id);
    assert.deepEqual(
      spread.positions.map(function (position) { return position.number; }),
      Array.from({ length: spread.positions.length }, function (_, index) { return index + 1; }),
      spread.id + " position order"
    );
    spread.positions.forEach(function (position) {
      assert.ok(position.name.length > 0, spread.id + " position name");
      assert.ok(position.nameEn && position.nameEn.length > 0, spread.id + " position nameEn");
      assert.ok(position.meaning.length > 0, spread.id + " position meaning");
      assert.ok(position.column >= 1 && position.column <= spread.columns, spread.id + " column");
      assert.ok(position.row >= 1 && position.row <= spread.rows, spread.id + " row");
    });
  });
});

test("formatPositionName joins Chinese and English labels", function () {
  assert.equal(
    catalogue.formatPositionName({ name: "过去", nameEn: "Past" }, "slash"),
    "过去 / Past"
  );
  assert.equal(
    catalogue.formatPositionName({ name: "现在", nameEn: "Present" }, "dot"),
    "现在 · Present"
  );
});

test("overlapping cross cards preserve the chapter diagrams", function () {
  [
    ["yes-no", 1, 6],
    ["fate-pattern", 1, 10],
    ["landscape", 1, 2]
  ].forEach(function (example) {
    var spread = catalogue.getTarotSpread(example[0]);
    var base = spread.positions[example[1] - 1];
    var crossing = spread.positions[example[2] - 1];
    assert.equal(base.column, crossing.column);
    assert.equal(base.row, crossing.row);
    assert.ok(crossing.offsetX || crossing.offsetY, example[0] + " crossing offset");
  });
});

test("all position coordinates match the Chapter 6 diagrams", function () {
  catalogue.tarotSpreads.forEach(function (spread) {
    assert.deepEqual(
      spread.positions.map(function (position) { return position.column + "," + position.row; }),
      expectedCoordinates[spread.id],
      spread.id
    );
  });
});

test("Mystagogus deck only exposes M-card spreads", function () {
  var mSpreads = catalogue.getSpreadsForDeck("mystagogus");
  assert.equal(mSpreads.length, 1);
  assert.equal(mSpreads[0].id, "mystagogus-layout");
  assert.equal(mSpreads[0].positions.length, 18);
  assert.equal(catalogue.validateTarotSpreads(catalogue.mystagogusSpreads), true);

  var tarotOnly = catalogue.getSpreadsForDeck("tarot");
  assert.equal(tarotOnly.length, catalogue.tarotSpreads.length);
  assert.ok(tarotOnly.every(function (s) { return s.id !== "mystagogus-layout"; }));
});

test("Mystagogus layout coordinates follow the zigzag diagram", function () {
  var expected = [
    "2,1", "3,2", "1,2", "2,3", "2,4", "3,5", "1,5", "2,6",
    "3,7", "1,7", "3,8", "1,8", "2,9", "2,10", "3,11", "1,11", "2,12", "2,13"
  ];
  var spread = catalogue.getMystagogusSpread("mystagogus-layout");
  assert.deepEqual(
    spread.positions.map(function (position) { return position.column + "," + position.row; }),
    expected
  );
});
