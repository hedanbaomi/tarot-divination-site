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

test("overview stacking is available only for the tarot overview spread", function () {
  var overview = catalogue.getTarotSpread("overview");

  assert.equal(overview.supportsStacking, true);
  assert.equal(overview.source, "第六章，图 6.3-6.4");
  assert.match(overview.description, /先铺大阿卡那、再叠放小阿卡那/);
  assert.equal(catalogue.isOverviewStackingMode("tarot", "overview", "stacked"), true);
  assert.equal(catalogue.isOverviewStackingMode("tarot", "overview", "single"), false);
  assert.equal(catalogue.isOverviewStackingMode("mystagogus", "overview", "stacked"), false);
  assert.equal(catalogue.isOverviewStackingMode("tarot", "event", "stacked"), false);
});

test("overview stacking fills every major layer slot before the minor layer", function () {
  var majors = Array.from({ length: 13 }, function (_, slotIndex) {
    return { slotIndex: slotIndex, layer: "major" };
  });
  var fiveMinors = Array.from({ length: 5 }, function (_, slotIndex) {
    return { slotIndex: slotIndex, layer: "minor" };
  });

  assert.equal(catalogue.getOverviewStackingPhase([], 13), "major");
  assert.equal(catalogue.getNextOverviewStackingSlot([], 13, "major"), 0);
  assert.equal(catalogue.getOverviewStackingPhase(majors, 13), "minor");
  assert.equal(catalogue.getNextOverviewStackingSlot(majors.concat(fiveMinors), 13, "minor"), 5);
  assert.equal(
    catalogue.getOverviewStackingPhase(
      majors.concat(Array.from({ length: 13 }, function (_, slotIndex) {
        return { slotIndex: slotIndex, layer: "minor" };
      })),
      13
    ),
    "complete"
  );
});

test("overview stacking returns to a missing lower-layer slot before continuing", function () {
  var complete = ["major", "minor"].flatMap(function (layer) {
    return Array.from({ length: 13 }, function (_, slotIndex) {
      return { slotIndex: slotIndex, layer: layer };
    });
  });
  var withoutMajorPositionSix = complete.filter(function (entry) {
    return !(entry.layer === "major" && entry.slotIndex === 5);
  });

  assert.equal(catalogue.getOverviewStackingPhase(withoutMajorPositionSix, 13), "major");
  assert.equal(catalogue.getNextOverviewStackingSlot(withoutMajorPositionSix, 13, "major"), 5);
  assert.deepEqual(catalogue.getOverviewStackingState(withoutMajorPositionSix, 13), {
    status: "major",
    activeLayer: "major",
    complete: false,
    targetCount: 26
  });
  assert.deepEqual(catalogue.getOverviewStackingState(complete, 13), {
    status: "complete",
    activeLayer: "minor",
    complete: true,
    targetCount: 26
  });
});

test("overview stacking rebuilds a layer without offering cards already on the table", function () {
  var cards = [
    { id: "major-1" },
    { id: "major-2" },
    { id: "major-3" }
  ];
  var entries = [
    { layer: "major", card: { id: "major-1" } },
    { layer: "minor", card: { id: "minor-1" } }
  ];

  assert.deepEqual(
    catalogue.getAvailableOverviewStackingCards(cards, entries, "major").map(function (card) {
      return card.id;
    }),
    ["major-2", "major-3"]
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

test("all decks can use each other's spreads with origin labels", function () {
  var total =
    catalogue.mystagogusSpreads.length +
    catalogue.tarotSpreads.length +
    catalogue.lxxxiSpreads.length;

  var mSpreads = catalogue.getSpreadsForDeck("mystagogus");
  assert.equal(mSpreads.length, total);
  assert.equal(mSpreads[0].id, "mystagogus-layout");
  assert.ok(mSpreads.some(function (s) { return s.id === "three-card-horizontal"; }));
  assert.ok(mSpreads.some(function (s) { return s.id === "lxxxi-occult-map"; }));
  assert.equal(catalogue.validateTarotSpreads(catalogue.mystagogusSpreads), true);

  var tarotCatalogue = catalogue.getSpreadsForDeck("tarot");
  assert.equal(tarotCatalogue.length, total);
  assert.equal(tarotCatalogue[0].id, catalogue.tarotSpreads[0].id);
  assert.ok(tarotCatalogue.some(function (s) { return s.id === "mystagogus-layout"; }));
  assert.ok(tarotCatalogue.some(function (s) { return s.id === "lxxxi-four-directions"; }));

  var lxxxiCatalogue = catalogue.getSpreadsForDeck("lxxxi");
  assert.equal(lxxxiCatalogue.length, total);
  assert.equal(lxxxiCatalogue[0].id, "lxxxi-occult-map");
  assert.ok(lxxxiCatalogue.some(function (s) { return s.id === "tree-of-life"; }));

  assert.equal(catalogue.getSpreadById("mystagogus", "mystagogus-layout").id, "mystagogus-layout");
  assert.equal(catalogue.getSpreadById("mystagogus", "yes-no").id, "yes-no");
  assert.equal(catalogue.getSpreadById("tarot", "mystagogus-layout").id, "mystagogus-layout");
  assert.equal(catalogue.getSpreadById("tarot", "yes-no").id, "yes-no");
  assert.equal(catalogue.getSpreadById("tarot", "lxxxi-tree-of-life-simple").id, "lxxxi-tree-of-life-simple");
  assert.equal(catalogue.getSpreadById("lxxxi", "lxxxi-occult-map").id, "lxxxi-occult-map");

  assert.equal(catalogue.getSpreadOriginLabel(catalogue.mystagogusSpreads[0]), "出自 M 牌");
  assert.equal(catalogue.getSpreadOriginLabel(catalogue.tarotSpreads[0]), "出自塔罗牌");
  assert.equal(catalogue.getSpreadOriginLabel(catalogue.lxxxiSpreads[0]), "出自 LXXXI 牌");
  assert.equal(catalogue.getSpreadOriginLabel(null), "出自塔罗牌");
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

test("LXXXI catalogue validates and matches expected counts and coordinates", function () {
  assert.equal(catalogue.validateTarotSpreads(catalogue.lxxxiSpreads), true);
  assert.deepEqual(
    catalogue.lxxxiSpreads.map(function (spread) { return spread.id; }).sort(),
    [
      "lxxxi-four-directions",
      "lxxxi-occult-map",
      "lxxxi-tree-of-life-occult",
      "lxxxi-tree-of-life-simple"
    ]
  );

  var expectedCounts = {
    "lxxxi-occult-map": 16,
    "lxxxi-tree-of-life-occult": 10,
    "lxxxi-tree-of-life-simple": 10,
    "lxxxi-four-directions": 6
  };
  var expectedCoordinates = {
    "lxxxi-occult-map": [
      "3,4", "3,4", "3,1", "3,7", "1,4", "2,2", "4,2", "5,6",
      "1,6", "2,3", "3,3", "4,3", "4,5", "3,5", "2,5", "5,4"
    ],
    "lxxxi-tree-of-life-occult": [
      "2,1", "3,2", "1,2", "3,3", "1,3", "2,4", "3,5", "1,5", "2,6", "2,7"
    ],
    "lxxxi-tree-of-life-simple": [
      "2,1", "3,2", "1,2", "3,3", "1,3", "2,4", "3,5", "1,5", "2,6", "2,7"
    ],
    "lxxxi-four-directions": ["2,2", "3,2", "2,3", "1,2", "2,1", "2,2"]
  };

  catalogue.lxxxiSpreads.forEach(function (spread) {
    assert.equal(spread.deck, "lxxxi");
    assert.equal(spread.positions.length, expectedCounts[spread.id], spread.id);
    assert.deepEqual(
      spread.positions.map(function (position) { return position.column + "," + position.row; }),
      expectedCoordinates[spread.id],
      spread.id
    );
  });

  // Crossing cards: occult map 1+2, four directions 1+6
  [
    ["lxxxi-occult-map", 1, 2],
    ["lxxxi-four-directions", 1, 6]
  ].forEach(function (example) {
    var spread = catalogue.getLxxxiSpread(example[0]);
    var base = spread.positions[example[1] - 1];
    var crossing = spread.positions[example[2] - 1];
    assert.equal(base.column, crossing.column, example[0] + " cross col");
    assert.equal(base.row, crossing.row, example[0] + " cross row");
    assert.ok(crossing.offsetX || crossing.offsetY, example[0] + " crossing offset");
  });

  // 景色牌阵与塔罗景观布局重复，不应单独收录
  assert.ok(!catalogue.lxxxiSpreads.some(function (s) {
    return /景色/.test(s.name) || s.id === "lxxxi-landscape";
  }));
});
