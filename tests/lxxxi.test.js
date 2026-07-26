"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var deck = require("../js/lxxxi-data.js");

test("LXXXI deck has 81 unique numbered cards", function () {
  assert.equal(deck.lxxxiDeckFull.length, 81);
  var numbers = deck.lxxxiDeckFull.map(function (card) { return card.number; }).sort(function (a, b) { return a - b; });
  assert.deepEqual(numbers, Array.from({ length: 81 }, function (_, i) { return i + 1; }));

  var ids = {};
  deck.lxxxiDeckFull.forEach(function (card) {
    assert.ok(card.name && card.name.length > 0, "name " + card.number);
    assert.ok(card.nameEn && card.nameEn.length > 0, "nameEn " + card.number);
    assert.ok(card.uprightKeywords && card.uprightKeywords.length > 0, "keywords " + card.number);
    assert.ok(card.uprightMeaning && card.uprightMeaning.length > 0, "meaning " + card.number);
    assert.equal(card.deck, "lxxxi");
    assert.equal(card.arcana, "lxxxi");
    assert.ok(!ids[card.id], "unique id " + card.id);
    ids[card.id] = true;
  });
});

test("every LXXXI card uses the versioned external WebP base", function () {
  assert.equal(
    deck.LXXXI_ASSET_BASE_URL,
    "https://assets.luotianyi.fun/tarot-divination-site/lxxxi/v1"
  );
  deck.lxxxiDeckFull.forEach(function (card) {
    assert.equal(
      card.image,
      deck.LXXXI_ASSET_BASE_URL + "/cards/lxxxi-" +
        String(card.number).padStart(2, "0") + ".webp"
    );
  });
  assert.equal(
    deck.LXXXI_ASSET_BASE_URL + "/backs/lxxxi-back.webp",
    "https://assets.luotianyi.fun/tarot-divination-site/lxxxi/v1/backs/lxxxi-back.webp"
  );
});

test("LXXXI card names use simplified Chinese", function () {
  // A few representative names that would differ between traditional and simplified.
  var byNumber = {};
  deck.lxxxiDeckFull.forEach(function (card) { byNumber[card.number] = card; });
  assert.equal(byNumber[1].name, "星辰之父 I");
  assert.equal(byNumber[5].name, "深渊");
  assert.equal(byNumber[10].name, "砥砺石 VII");
  assert.equal(byNumber[22].name, "战车");
  assert.equal(byNumber[80].name, "死亡");
  assert.equal(byNumber[81].name, "毁灭");
});
