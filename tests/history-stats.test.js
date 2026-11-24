"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var root = path.join(__dirname, "..");
var statsApi = require("../js/history-stats.js");
var mystagogusData = require("../js/mystagogus-data.js");
var lxxxiData = require("../js/lxxxi-data.js");

function loadTarotDeck() {
  var ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, "js/tarot-data.js"), "utf8"), ctx, { filename: "tarot-data.js" });
  return vm.runInContext("tarotDeckFull", ctx);
}

var decks = {
  tarot: loadTarotDeck(),
  mystagogus: mystagogusData.mystagogusDeckFull,
  lxxxi: lxxxiData.lxxxiDeckFull
};

test("Web and Android history-stats.js and mystagogus-data.js stay identical", function () {
  ["js/history-stats.js", "js/mystagogus-data.js"].forEach(function (rel) {
    assert.equal(
      fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n"),
      fs.readFileSync(path.join(root, "android-demo/app/src/main/assets/www", rel), "utf8").replace(/\r\n/g, "\n"),
      rel + " parity"
    );
  });
});

test("every card across Tarot, Mystagogus, and LXXXI classifies into its official category", function () {
  var tarotCounts = { major: 0, wands: 0, cups: 0, swords: 0, pentacles: 0 };
  decks.tarot.forEach(function (card) {
    var cat = statsApi.classifyCard("tarot", { cardId: card.id }, card);
    assert.ok(Object.prototype.hasOwnProperty.call(tarotCounts, cat), card.id);
    tarotCounts[cat] += 1;
  });
  assert.deepEqual(tarotCounts, { major: 22, wands: 14, cups: 14, swords: 14, pentacles: 14 });

  var mCounts = {
    "core-fate": 0, "magical-path-1": 0, "magical-path-2": 0,
    structures: 0, beings: 0, "dynamics-1": 0, "dynamics-2": 0
  };
  decks.mystagogus.forEach(function (card) {
    var cat = statsApi.classifyCard("mystagogus", { cardId: card.id, cardNumber: card.number }, card);
    assert.ok(Object.prototype.hasOwnProperty.call(mCounts, cat), card.id);
    mCounts[cat] += 1;
  });
  assert.deepEqual(mCounts, {
    "core-fate": 4, "magical-path-1": 13, "magical-path-2": 14,
    structures: 17, beings: 11, "dynamics-1": 9, "dynamics-2": 10
  });
  assert.equal(statsApi.classifyCard("mystagogus", { cardId: "m-01" }, null), "core-fate");
  assert.equal(statsApi.classifyCard("mystagogus", { cardId: "m-04" }, null), "core-fate");
  assert.equal(statsApi.classifyCard("mystagogus", { cardId: "m-05" }, null), "magical-path-1");
  assert.equal(statsApi.classifyCard("mystagogus", { cardId: "m-32" }, null), "structures");
  assert.equal(statsApi.classifyCard("mystagogus", { cardId: "m-49" }, null), "beings");
  assert.equal(statsApi.classifyCard("mystagogus", { cardId: "m-60" }, null), "dynamics-1");
  assert.equal(statsApi.classifyCard("mystagogus", { cardId: "m-69" }, null), "dynamics-2");
  assert.equal(statsApi.classifyCard("mystagogus", { cardId: "m-78" }, null), "dynamics-2");

  var lCounts = { divine: 0, inner: 0, physical: 0, underworld: 0 };
  decks.lxxxi.forEach(function (card) {
    var cat = statsApi.classifyCard("lxxxi", { cardId: card.id, cardNumber: card.number }, card);
    assert.ok(Object.prototype.hasOwnProperty.call(lCounts, cat), card.id);
    lCounts[cat] += 1;
  });
  assert.deepEqual(lCounts, { divine: 4, inner: 22, physical: 51, underworld: 4 });
  assert.equal(statsApi.classifyCard("lxxxi", { cardId: "lxxxi-05" }, null), "inner");
  assert.equal(statsApi.classifyCard("lxxxi", { cardId: "lxxxi-06" }, null), "inner");
  assert.equal(statsApi.classifyCard("lxxxi", { cardId: "lxxxi-22" }, null), "inner");
  assert.equal(statsApi.classifyCard("lxxxi", { cardId: "lxxxi-78" }, null), "underworld");
});

test("summarize aggregates Tarot major/minor, suits, orientations, and most-drawn ranking", function () {
  var records = [
    {
      id: "r1",
      deckType: "tarot",
      layoutMode: "preset",
      orientationMode: "mixed",
      createdAt: "2026-11-20T10:00:00Z",
      cards: [
        { cardId: "major-00", cardName: "愚者", orientation: "upright" },
        { cardId: "minor-wands-1", cardName: "权杖王牌", orientation: "reversed" },
        { cardId: "minor-cups-2", cardName: "圣杯二", orientation: "upright" }
      ]
    },
    {
      id: "r2",
      deckType: "tarot",
      layoutMode: "preset",
      orientationMode: "mixed",
      createdAt: "2026-11-22T10:00:00Z",
      cards: [
        { cardId: "major-00", cardName: "愚者", orientation: "reversed" },
        { cardId: "minor-wands-1", cardName: "权杖王牌", orientation: "upright" },
        { cardId: "minor-swords-3", cardName: "宝剑三", orientation: "upright" }
      ]
    },
    {
      id: "r3",
      deckType: "tarot",
      layoutMode: "freeform",
      orientationMode: "upright-only",
      createdAt: "2026-11-23T10:00:00Z",
      cards: [
        { cardId: "major-00", cardName: "愚者", orientation: "upright", revealed: true },
        { cardId: "minor-pentacles-10", cardName: "星币十", orientation: "upright", revealed: false }
      ]
    }
  ];

  var summary = statsApi.summarize(records, {
    deckType: "tarot",
    period: "all",
    decks: decks
  });

  assert.equal(summary.readingCount, 3);
  assert.equal(summary.totalDraws, 7); // unrevealed freeform card excluded
  assert.equal(summary.uniqueCards, 4);
  assert.equal(summary.arcana.major.count, 3);
  assert.equal(summary.arcana.minor.count, 4);
  assert.equal(summary.orientation.upright.count, 5);
  assert.equal(summary.orientation.reversed.count, 2);
  assert.equal(summary.orientation.hasReversed, true);

  var byId = Object.fromEntries(summary.categories.map(function (c) { return [c.id, c.count]; }));
  assert.deepEqual(byId, { major: 3, wands: 2, cups: 1, swords: 1, pentacles: 0 });
  assert.equal(summary.topCategory.id, "major");

  assert.equal(summary.cards[0].cardId, "major-00");
  assert.equal(summary.cards[0].count, 3);
  assert.equal(summary.cards[0].uprightCount, 2);
  assert.equal(summary.cards[0].reversedCount, 1);
  assert.equal(summary.cards[1].cardId, "minor-wands-1");
  assert.equal(summary.cards[1].count, 2);
  // Tie between minor-swords-3 (Nov 22) and minor-cups-2 (Nov 20) breaks by most recent draw
  assert.equal(summary.cards[2].cardId, "minor-swords-3");
  assert.equal(summary.cards[3].cardId, "minor-cups-2");
});

test("summarize filters by time period and computes Mystagogus chapters & LXXXI realms", function () {
  var now = Date.parse("2026-11-24T12:00:00Z");
  var records = [
    {
      id: "m-recent",
      deckType: "mystagogus",
      layoutMode: "preset",
      createdAt: "2026-11-10T12:00:00Z", // 14d ago
      cards: [
        { cardId: "m-01", cardName: "始源者", cardNumber: 1 },
        { cardId: "m-33", cardName: "东门", cardNumber: 33 },
        { cardId: "m-49", cardName: "古者", cardNumber: 49 }
      ]
    },
    {
      id: "m-old",
      deckType: "mystagogus",
      layoutMode: "preset",
      createdAt: "2026-08-01T12:00:00Z", // >90d ago
      cards: [
        { cardId: "m-78", cardName: "空容器", cardNumber: 78 }
      ]
    },
    {
      id: "l-recent",
      deckType: "lxxxi",
      layoutMode: "preset",
      createdAt: "2026-11-20T12:00:00Z",
      cards: [
        { cardId: "lxxxi-01", cardName: "星辰之父 I", cardNumber: 1 },
        { cardId: "lxxxi-05", cardName: "深渊", cardNumber: 5 },
        { cardId: "lxxxi-06", cardName: "深渊守卫", cardNumber: 6 },
        { cardId: "lxxxi-22", cardName: "战车", cardNumber: 22 },
        { cardId: "lxxxi-78", cardName: "地下世界森林", cardNumber: 78 }
      ]
    }
  ];

  var m30 = statsApi.summarize(records, { deckType: "mystagogus", period: "30d", now: now, decks: decks });
  assert.equal(m30.readingCount, 1);
  assert.equal(m30.totalDraws, 3);
  assert.equal(m30.arcana, null);
  assert.equal(m30.orientation, null);

  var mAll = statsApi.summarize(records, { deckType: "mystagogus", period: "all", now: now, decks: decks });
  assert.equal(mAll.readingCount, 2);
  assert.equal(mAll.totalDraws, 4);
  var mCatCounts = Object.fromEntries(mAll.categories.map(function (c) { return [c.id, c.count]; }));
  assert.deepEqual(mCatCounts, {
    "core-fate": 1, "magical-path-1": 0, "magical-path-2": 0,
    structures: 1, beings: 1, "dynamics-1": 0, "dynamics-2": 1
  });

  var lAll = statsApi.summarize(records, { deckType: "lxxxi", period: "all", now: now, decks: decks });
  assert.equal(lAll.totalDraws, 5);
  var lCatCounts = Object.fromEntries(lAll.categories.map(function (c) { return [c.id, c.count]; }));
  assert.deepEqual(lCatCounts, { divine: 1, inner: 3, physical: 0, underworld: 1 });
  assert.equal(lAll.categories[0].swatch, "divine");
  assert.equal(lAll.categories[3].swatch, "underworld");
});

test("pickDefaultDeck defaults to all unless a specific recorded deck is preferred", function () {
  var onlyLxxxi = [
    { deckType: "lxxxi" },
    { deckType: "lxxxi" }
  ];
  assert.equal(statsApi.pickDefaultDeck(onlyLxxxi, "all"), "all");
  assert.equal(statsApi.pickDefaultDeck(onlyLxxxi, "tarot"), "all");
  assert.equal(statsApi.pickDefaultDeck(onlyLxxxi, "lxxxi"), "lxxxi");

  var mixed = [
    { deckType: "tarot" },
    { deckType: "mystagogus" },
    { deckType: "mystagogus" }
  ];
  assert.equal(statsApi.pickDefaultDeck(mixed, "tarot"), "tarot");
  assert.equal(statsApi.pickDefaultDeck(mixed, "lxxxi"), "all");
  assert.equal(statsApi.pickDefaultDeck([], "mystagogus"), "mystagogus");
  assert.equal(statsApi.pickDefaultDeck([], "all"), "all");
});

test("summarize supports all-decks combined statistics without merging cross-deck identities", function () {
  var records = [
    {
      id: "t1",
      deckType: "tarot",
      layoutMode: "preset",
      orientationMode: "mixed",
      createdAt: "2026-11-20T10:00:00Z",
      cards: [
        { cardId: "major-00", cardName: "愚者", orientation: "reversed" },
        { cardId: "minor-wands-ace", cardName: "权杖王牌", orientation: "upright" }
      ]
    },
    {
      id: "m1",
      deckType: "mystagogus",
      layoutMode: "freeform",
      createdAt: "2026-11-21T10:00:00Z",
      cards: [
        { cardId: "m-01", cardName: "始源者", cardNumber: 1, revealed: true },
        { cardId: "m-78", cardName: "空容器", cardNumber: 78, revealed: false }
      ]
    },
    {
      id: "l1",
      deckType: "lxxxi",
      layoutMode: "preset",
      createdAt: "2026-11-22T10:00:00Z",
      cards: [
        { cardId: "lxxxi-06", cardName: "深渊守卫", cardNumber: 6 },
        { cardId: "lxxxi-78", cardName: "地下世界森林", cardNumber: 78 }
      ]
    },
    {
      id: "l2",
      deckType: "lxxxi",
      layoutMode: "preset",
      createdAt: "2026-11-23T10:00:00Z",
      cards: [
        { cardId: "lxxxi-78", cardName: "地下世界森林", cardNumber: 78 }
      ]
    }
  ];

  var all = statsApi.summarize(records, { deckType: "all", period: "all", decks: decks });
  assert.equal(all.deckType, "all");
  assert.equal(all.deckSize, 237);
  assert.equal(all.readingCount, 4);
  assert.equal(all.totalDraws, 6); // excludes unrevealed m-78
  assert.equal(all.uniqueCards, 5);
  assert.equal(all.arcana, null);
  assert.equal(all.orientation, null);

  var byDeck = Object.fromEntries(all.categories.map(function (c) { return [c.id, c.count]; }));
  assert.deepEqual(byDeck, { tarot: 2, mystagogus: 1, lxxxi: 3 });
  assert.equal(all.cards[0].deckType, "lxxxi");
  assert.equal(all.cards[0].cardId, "lxxxi-78");
  assert.equal(all.cards[0].subCategoryId, "underworld");
  assert.equal(all.cards[0].count, 2);
});
