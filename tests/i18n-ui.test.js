"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
var historyUi = fs.readFileSync(path.join(root, "js", "history-ui.js"), "utf8");
var i18nSource = fs.readFileSync(path.join(root, "js", "i18n.js"), "utf8");
var i18n = require("../js/i18n.js");

test("language switch and localization scripts load before interactive modules", function () {
  var dataIndex = html.indexOf("js/i18n-data-en.js");
  var i18nIndex = html.indexOf("js/i18n.js");
  var historyIndex = html.indexOf("js/history-ui.js");
  var appIndex = html.indexOf("js/app.js");

  assert.match(html, /id="languageToggle"/);
  assert.match(html, /data-i18n="site\.title"/);
  assert.ok(dataIndex > 0);
  assert.ok(dataIndex < i18nIndex);
  assert.ok(i18nIndex < historyIndex);
  assert.ok(historyIndex < appIndex);
});

test("locale helper switches complete messages and localized object fields", function () {
  i18n.setLocale("en");
  assert.equal(i18n.getLocale(), "en");
  assert.equal(i18n.t("spread.reveal"), "Reveal & Interpret");
  assert.equal(i18n.t("app.remaining", { count: 12 }), "12 remaining");
  assert.equal(i18n.field({ name: "愚者", nameEn: "The Fool" }, "name"), "The Fool");

  i18n.setLocale("zh-CN");
  assert.equal(i18n.t("spread.reveal"), "开牌解读");
  assert.equal(i18n.field({ name: "愚者", nameEn: "The Fool" }, "name"), "愚者");
});

test("runtime surfaces rerender on locale changes without resetting the reading", function () {
  assert.match(app, /quareia:languagechange/);
  assert.match(app, /function handleLanguageChange\(\)/);
  assert.doesNotMatch(
    app.match(/function handleLanguageChange\(\) \{[\s\S]*?\n  \}/)[0],
    /resetDeck\(\)/
  );
  assert.match(app, /localizedCardName\(card\)/);
  assert.match(app, /localizedPositionMeaning\(position\)/);
  assert.match(historyUi, /refreshLanguage: refreshLanguage/);
  assert.match(historyUi, /displayCardName\(record, card\)/);
  assert.match(historyUi, /setTranslatedStatus/);
  assert.match(historyUi, /refreshStatus\(elements\.saveStatus\)/);
  assert.match(historyUi, /refreshStatus\(elements\.actionStatus\)/);
});

test("Free Board controls, statuses, confirmations, and accessibility labels are bilingual", function () {
  var freeBoardUi = fs.readFileSync(path.join(root, "js", "free-board-ui.js"), "utf8");
  ["zh-CN", "en"].forEach(function (locale) {
    var start = i18nSourceBlock(i18nSource, locale);
    [
      "settings.layoutMode",
      "layout.freeform",
      "freeBoard.undoAria",
      "freeBoard.redoAria",
      "freeBoard.cardAria",
      "freeBoard.showMeaning",
      "freeBoard.clearAndDiscard",
      "freeBoard.drawOrder",
      "freeBoard.saveFailed",
      "confirm.layout",
      "confirm.freeBoardDiscard",
      "history.freeBoard",
      "history.freeBoardPreview"
    ].forEach(function (key) {
      assert.ok(start.indexOf('"' + key + '"') !== -1, locale + " missing " + key);
    });
  });
  assert.match(html, /freeBoard\.rotateMinus15Aria/);
  assert.match(freeBoardUi, /freeBoard\.showMeaning/);
  assert.match(html, /freeBoard\.removeAria/);
  assert.doesNotMatch(freeBoardUi, /freeBoard\.saveAria/);
});

function i18nSourceBlock(source, locale) {
  var start = source.indexOf('"' + locale + '": {');
  var nextLocale = locale === "zh-CN" ? source.indexOf('"en": {', start) : source.indexOf("\n    }\n  };", start);
  return source.slice(start, nextLocale === -1 ? source.length : nextLocale);
}
