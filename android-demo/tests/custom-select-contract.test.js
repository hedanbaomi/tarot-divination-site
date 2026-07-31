"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var demoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(demoRoot, relativePath), "utf8");
}

test("Android demo replaces every native select surface with the themed picker", function () {
  var html = read("app/src/main/assets/www/index.html");
  var css = read("app/src/main/assets/www/css/styles.css");
  var picker = read("app/src/main/assets/www/js/custom-selects.js");

  [
    "deckSelect",
    "modeSelect",
    "arcanaFilter",
    "overviewMethod",
    "spreadSelect",
    "historyDeckFilter"
  ].forEach(function (id) {
    assert.match(html, new RegExp('<select[^>]*id="' + id + '"'));
  });

  assert.match(html, /id="choiceDialog"/);
  assert.match(html, /src="js\/custom-selects\.js\?v=20260727-card-picker"/);
  assert.match(css, /\.custom-select-native\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.themed-select-trigger/);
  assert.match(css, /\.choice-option\.selected/);
  assert.match(picker, /document\.querySelectorAll\("select"\)/);
  assert.match(picker, /select\.dispatchEvent\(new Event\("change"/);
  assert.doesNotMatch(html, /星图选择|CELESTIAL PICKER/);
  assert.doesNotMatch(picker, /\b(?:alert|confirm|prompt)\s*\(/);
});

test("themed picker resynchronizes after custom confirmation settles", function () {
  var picker = read("app/src/main/assets/www/js/custom-selects.js");
  var dialogs = read("app/src/main/assets/www/js/dialogs.js");
  assert.match(picker, /quareia:dialogsettled/);
  assert.match(dialogs, /quareia:dialogsettled/);
});

test("Android settings collapse to one bounded column on narrow screens", function () {
  var css = read("app/src/main/assets/www/css/styles.css");
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.setting-group\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.themed-select-trigger\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
  assert.match(
    css,
    /@media\s*\(max-width:\s*480px\)[\s\S]*?\.settings-body\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/
  );
});

test("homepage uses a localized first-launch dialog instead of a native bottom banner", function () {
  var html = read("app/src/main/assets/www/index.html");
  var i18n = read("app/src/main/assets/www/js/i18n.js");
  var notice = read("app/src/main/assets/www/js/telemetry-notice.js");
  var mainActivity = read("app/src/main/java/com/example/quareiadivination/MainActivity.kt");

  assert.match(html, /id="telemetryDialog"/);
  assert.match(html, /id="telemetryNoticeManage"/);
  assert.match(html, /data-i18n="telemetry\.firstLaunchNotice"/);
  assert.match(i18n, /"telemetry\.firstLaunchNotice": "本应用默认启用匿名使用统计/);
  assert.match(i18n, /"telemetry\.firstLaunchNotice": "This app enables anonymous usage statistics/);
  assert.match(i18n, /function tForLocale\(requestedLocale, key, values\)/);
  assert.match(i18n, /function detectSystemLocale\(\)/);
  assert.match(i18n, /return supported\.indexOf\(value\) !== -1 \? value : detectSystemLocale\(\)/);
  assert.match(notice, /localStorage\.setItem\(STORAGE_KEY, "1"\)/);
  assert.match(notice, /function systemLocale\(\)/);
  assert.match(notice, /tForLocale\(systemLocale\(\), key\)/);
  assert.doesNotMatch(mainActivity, /showFirstLaunchNoticeIfNeeded|Gravity\.BOTTOM|telemetry_first_launch_notice/);
});

test("homepage menu is a right-side sliding drawer and keeps the author quote on the page", function () {
  var html = read("app/src/main/assets/www/index.html");
  var css = read("app/src/main/assets/www/css/styles.css");
  var menu = read("app/src/main/assets/www/js/menu.js");
  var mainActivity = read("app/src/main/java/com/example/quareiadivination/MainActivity.kt");

  assert.match(html, /id="menuToggle"/);
  assert.match(html, /id="appMenu"/);
  assert.match(html, /id="menuBackdrop"/);
  assert.match(html, /class="author-note"/);
  assert.match(html, /data-i18n="home\.quote"/);
  assert.ok(html.indexOf('class="settings"') < html.indexOf('class="app-menu"'));
  assert.ok(html.indexOf('class="author-note"') > html.indexOf('id="resultsSection"'));
  assert.match(css, /\.app-menu\s*\{[\s\S]*transform:\s*translateX\(104%\)/);
  assert.match(css, /\.app-menu\.is-open\s*\{[\s\S]*transform:\s*translateX\(0\)/);
  assert.match(css, /\.menu-backdrop\.is-visible/);
  assert.match(css, /\.telemetry-actions \.btn\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(menu, /androidAbout\.open/);
  assert.match(mainActivity, /addJavascriptInterface\(AboutBridge/);
  assert.match(mainActivity, /removeJavascriptInterface\("androidAbout"\)/);
});
