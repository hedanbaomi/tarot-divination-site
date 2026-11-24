"use strict";

var assert = require("node:assert/strict");
var test = require("node:test");
var fs = require("node:fs");
var path = require("node:path");
var deck = require("../js/mystagogus-data.js");

test("Mystagogus deck has 78 unique numbered cards", function () {
  assert.equal(deck.mystagogusDeckFull.length, 78);
  var numbers = deck.mystagogusDeckFull.map(function (card) { return card.number; }).sort(function (a, b) { return a - b; });
  assert.deepEqual(numbers, Array.from({ length: 78 }, function (_, i) { return i + 1; }));

  var ids = {};
  deck.mystagogusDeckFull.forEach(function (card) {
    assert.ok(card.name && card.name.length > 0, "name " + card.number);
    assert.ok(card.nameEn && card.nameEn.length > 0, "nameEn " + card.number);
    assert.ok(card.uprightKeywords && card.uprightKeywords.length > 0, "keywords " + card.number);
    assert.ok(card.uprightMeaning && card.uprightMeaning.length > 0, "meaning " + card.number);
    assert.ok(card.reversedMeaning && card.reversedMeaning.length > 0, "reversed " + card.number);
    assert.equal(card.deck, "mystagogus");
    assert.ok(!ids[card.id], "unique id " + card.id);
    ids[card.id] = true;
  });
});

test("every Mystagogus card image file exists", function () {
  var root = path.join(__dirname, "..");
  deck.mystagogusDeckFull.forEach(function (card) {
    var file = path.join(root, card.image);
    assert.ok(fs.existsSync(file), card.image);
  });
  assert.ok(fs.existsSync(path.join(root, "assets/cards/m/m-back.jpeg")), "m-back");
});

test("Mystagogus cards carry the 7 official guidebook chapters on Web and Android", function () {
  var android = require("../android-demo/app/src/main/assets/www/js/mystagogus-data.js");
  var expectedIds = [
    ...Array(4).fill("core-fate"),
    ...Array(13).fill("magical-path-1"),
    ...Array(14).fill("magical-path-2"),
    ...Array(17).fill("structures"),
    ...Array(11).fill("beings"),
    ...Array(9).fill("dynamics-1"),
    ...Array(10).fill("dynamics-2")
  ];
  [deck, android].forEach(function (bundle) {
    var cards = bundle.mystagogusDeckFull.slice().sort(function (a, b) { return a.number - b.number; });
    assert.deepEqual(cards.map(function (card) { return card.chapter.id; }), expectedIds);
    cards.forEach(function (card) {
      assert.match(card.chapter.name, /[一-龥]/);
      assert.match(card.chapter.nameEn, /^[IVX]+ · [A-Za-z]/);
    });
  });
});
