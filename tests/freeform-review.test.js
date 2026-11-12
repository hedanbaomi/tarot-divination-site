"use strict";

/*
 * Regression tests for the free board review round:
 * independent pool, orientation, draft round-trip, history, card layout,
 * accessibility and the deck backs of the non-tarot decks.
 */

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

var app = read("js/app.js");
var css = read("css/redesign.css");
var i18n = read("js/i18n.js");
var history = read("js/history-ui.js");

test("进入自由画板用独立的整副牌池，而不是预设牌阵剩下的牌", function () {
  assert.match(app, /function freeformDeckCards\(\)/);
  assert.match(app, /freeBoardCardsForDeck\(deckType, deckType === "tarot" \? arcanaFilter : "not-applicable"\)/);
  assert.match(app, /if \(isFreeform\(\)\) \{\r?\n\s*pile = shuffle\(freeformDeckCards\(\)\);/);
  assert.match(app, /handleLayoutModeChange/);
  assert.match(app, /buildPile\(\);\r?\n\s*renderFreeformFan\(\);\r?\n\s*scheduleFreeformDraft\(\);/);
});

test("抽牌时就决定正逆位，翻面、撤销和重做都用同一个结果", function () {
  assert.match(app, /orientation: orientationFor\(\)/);
  assert.match(app, /function orientationFor\(/);
  assert.match(app, /createCardImage\(card, "card-image", item\.orientation \|\| "upright"\)/);
  assert.match(app, /freeDrawn\.push\(\{/);
  assert.match(app, /function undoFreeDraw\(/);
  assert.match(app, /function redoFreeDraw\(/);
});

test("自由画板的草稿可以刷新后恢复，并兼容旧画板的存档", function () {
  assert.match(app, /quareia-divination-free-board-draft-v1/);
  assert.match(app, /function freeformDraftPayload\(/);
  assert.match(app, /schema: "free-board\/v1"/);
  assert.match(app, /function restoreFreeformDraft\(/);
  assert.match(app, /layoutMode !== "freeform"/);
  assert.match(app, /function scheduleFreeformDraft\(/);
  assert.match(app, /function clearFreeformDraft\(/);
});

test("自由画板开完牌会写一条历史记录", function () {
  assert.match(app, /function saveFreeformHistory\(/);
  assert.match(app, /historyUiController\.saveFreeformReading/);
  assert.match(history, /function saveFreeformReading\(input\)/);
  assert.match(history, /buildFreeformLayoutRecord\(/);
  assert.match(history, /kind: "freeform"/);
});

test("抽出来的牌按列自动排布，第 13 张不会压住第 1 张", function () {
  var start = app.indexOf("function freeDefaultPoint(index)");
  var end = app.indexOf("function buildFreeTableCard(", start);
  var fn = app.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(fn, /var row = Math\.floor\(index \/ cols\)/);
  assert.doesNotMatch(fn, /row = Math\.floor\(index \/ cols\) %/);
  assert.match(fn, /var cols = narrow \? 2 : 4/);
  assert.match(fn, /var stepY = narrow \? 144 : 150/);
});

test("未翻开的牌不向辅助技术暴露牌名，可以用键盘翻面", function () {
  assert.match(app, /setAttribute\("role", "button"\)/);
  assert.match(app, /setAttribute\("tabindex", "0"\)/);
  assert.match(app, /t\("freeBoard\.cardHiddenAria"/);
  assert.match(app, /t\("freeBoard\.cardAria"/);
  assert.match(app, /item\.revealed = true/);
  assert.match(app, /"Enter"/);
  assert.match(app, /card\.setAttribute\("aria-hidden", "true"\)|aria-hidden/);
  ["freeBoard.cardHiddenAria", "freeBoard.cardAria", "freeBoard.slotName"].forEach(function (key) {
    assert.ok(i18n.indexOf('"' + key + '"') !== -1, "missing i18n key " + key);
  });
});

test("M 牌和 LXXXI 在自由桌面上也使用自己的牌背", function () {
  assert.match(app, /createBackArtImage\("spread-card-back-img"\)/);
  assert.match(app, /MYSTAGOGUS_BACK/);
  assert.match(app, /LXXXI_BACK/);
  assert.match(app, /spread-card-back-m/);
  assert.match(app, /spread-card-back-lxxxi/);
});

test("洗牌动画进行时不会误抽牌", function () {
  assert.match(app, /function isShuffleRunning\(\)/);
  assert.match(app, /is-shuffling/);
  assert.match(app, /if \(isShuffleRunning\(\)\) return;/);
});

test("自由桌面给牌留出足够的空白，卡片比预设牌阵小", function () {
  assert.match(css, /\.table-area\.is-freeform[\s\S]{0,120}padding-bottom:\s*min\(62vh, 640px\)/);
  assert.match(css, /\.free-table-card \{[\s\S]{0,200}width:\s*84px;[\s\S]{0,80}height:\s*126px/);
});
