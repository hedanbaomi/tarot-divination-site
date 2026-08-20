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
  assert.match(html, /src="js\/custom-selects\.js\?v=20260820-custom-spread-window-final"/);
  assert.match(css, /\.custom-select-native\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /\.themed-select-trigger/);
  assert.match(css, /\.choice-option\.selected/);
  assert.match(picker, /document\.querySelectorAll\("select"\)/);
  assert.match(picker, /function refresh\(/);
  assert.match(picker, /function pruneControls\(/);
  assert.match(picker, /DivinationCustomSelects = \{[^}]*refresh: refresh/);
  assert.match(read("app/src/main/assets/www/js/custom-spread-ui.js"), /DivinationCustomSelects\.refresh\(elements\.positions\)/);
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
  var css = read("app/src/main/assets/www/css/styles.css") +
    read("app/src/main/assets/www/css/android-shell.css");
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
  var mainActivity = read("app/src/main/java/com/quareia/divination/MainActivity.kt");

  assert.match(html, /id="telemetryDialog"/);
  assert.match(html, /id="telemetryNoticeManage"/);
  assert.match(html, /data-i18n="telemetry\.firstLaunchNotice"/);
  assert.match(i18n, /"telemetry\.firstLaunchNotice": "本应用默认启用匿名使用统计/);
  assert.match(i18n, /"telemetry\.firstLaunchNotice": "This app enables anonymous usage statistics/);
  assert.match(i18n, /function tForLocale\(requestedLocale, key, values\)/);
  assert.match(i18n, /function detectSystemLocale\(\)/);
  assert.match(i18n, /return supported\.indexOf\(value\) !== -1 \? value : detectSystemLocale\(\)/);
  assert.match(i18n, /function syncNativeLocale\(\)/);
  assert.match(i18n, /androidAbout\.setLocale\(locale\)/);
  assert.match(notice, /localStorage\.setItem\(STORAGE_KEY, "1"\)/);
  assert.match(notice, /function systemLocale\(\)/);
  assert.match(notice, /tForLocale\(systemLocale\(\), key\)/);
  assert.doesNotMatch(mainActivity, /showFirstLaunchNoticeIfNeeded|Gravity\.BOTTOM|telemetry_first_launch_notice/);
});

test("homepage menu is a right-side sliding drawer and keeps the author quote on the page", function () {
  var html = read("app/src/main/assets/www/index.html");
  var css = read("app/src/main/assets/www/css/styles.css") +
    read("app/src/main/assets/www/css/android-shell.css");
  var menu = read("app/src/main/assets/www/js/menu.js");
  var mainActivity = read("app/src/main/java/com/quareia/divination/MainActivity.kt");

  assert.match(html, /id="menuToggle"/);
  assert.match(html, /id="appMenu"/);
  assert.match(html, /id="menuBackdrop"/);
  assert.match(html, /class="author-note"/);
  assert.match(html, /data-i18n="home\.quote"/);
  assert.ok(html.indexOf('class="settings"') < html.indexOf('class="app-menu"'));
  assert.ok(html.indexOf('class="author-note"') > html.indexOf('id="resultsSection"'));
  assert.match(html, /href="css\/android-shell\.css\?v=20260813-themes"/);
  assert.match(css, /\.app-menu\s*\{[\s\S]*transform:\s*translateX\(104%\)/);
  assert.match(css, /\.app-menu\.is-open\s*\{[\s\S]*transform:\s*translateX\(0\)/);
  assert.match(css, /\.menu-backdrop\.is-visible/);
  assert.match(css, /\.telemetry-actions \.btn\s*\{[\s\S]*white-space:\s*normal/);
  assert.match(menu, /androidAbout\.open/);
  assert.match(mainActivity, /addJavascriptInterface\(AboutBridge/);
  assert.match(mainActivity, /fun setLocale\(locale: String\)/);
  assert.match(mainActivity, /removeJavascriptInterface\("androidAbout"\)/);
});

test("Android keeps theme switching in the hamburger menu, not reading setup", function () {
  var html = read("app/src/main/assets/www/index.html");
  var i18n = read("app/src/main/assets/www/js/i18n.js");
  var theme = read("app/src/main/assets/www/js/theme.js");
  var mainActivity = read("app/src/main/java/com/quareia/divination/MainActivity.kt");
  var settings = html.slice(html.indexOf('id="settings"'), html.indexOf('id="appMenu"'));
  var menu = html.slice(html.indexOf('id="appMenu"'), html.indexOf('id="menuBackdrop"'));

  assert.doesNotMatch(settings, /data-theme-id|setting-group-theme/);
  assert.match(menu, /class="menu-theme"/);
  assert.match(menu, /data-theme-id="celestial"/);
  assert.match(menu, /data-theme-id="parchment"/);
  assert.match(menu, /data-theme-id="ember"/);
  assert.match(menu, /data-theme-id="grove"/);
  assert.match(html, /src="js\/theme\.js\?v=20260813-themes"/);
  assert.match(html, /quareia-divination-theme/);
  assert.match(i18n, /"settings\.theme": "界面主题"/);
  assert.match(i18n, /"theme\.parchment": "羊皮纸晨光"/);
  assert.match(i18n, /"theme\.parchment": "Parchment Dawn"/);
  assert.match(theme, /androidThemeChrome\.set/);
  assert.match(mainActivity, /addJavascriptInterface\(ThemeChromeBridge/);
  assert.match(mainActivity, /removeJavascriptInterface\("androidThemeChrome"\)/);
});

test("Android parchment reading and history panels use theme tokens, not night navy", function () {
  var css = read("app/src/main/assets/www/css/styles.css");
  var freeBoard = read("app/src/main/assets/www/css/free-board.css");
  var html = read("app/src/main/assets/www/index.html");
  assert.match(html, /href="css\/styles\.css\?v=20260820-custom-spread-window-final"/);
  assert.match(css, /\.position-guide\s*\{[^}]*background:\s*var\(--panel-bg\)/);
  assert.match(css, /\.result-card\s*\{[^}]*background:\s*var\(--panel-bg\)/);
  assert.match(css, /\.history-list-item\s*\{[^}]*background:\s*var\(--bg-card\)/);
  assert.match(css, /\.history-detail-card\s*\{[^}]*background:\s*var\(--bg-card\)/);
  assert.doesNotMatch(css, /\.position-guide\s*\{[^}]*background:\s*rgba\(19, 26, 60/);
  assert.doesNotMatch(css, /\.result-card\s*\{[^}]*background:\s*linear-gradient\(180deg, rgba\(24, 31, 68/);
  var parchment = css.slice(css.indexOf('html[data-theme="parchment"]'), css.indexOf('html[data-theme="ember"]'));
  assert.match(parchment, /--neutral-dark:\s*#f3e6c8/);
  assert.match(freeBoard, /\.history-free-board-preview\s*\{[^}]*background:\s*var\(--panel-bg\)/);
  assert.match(html, /class="sky-sun-blank"/);
  assert.match(html, /src="assets\/icons\/parchment-sun-blank\.png"/);
  assert.match(html, /data-theme-face="celestial"/);
  assert.match(html, /celestial-sky\.js\?v=20260813-sun-blank/);
});

test("language toggle keeps its label and value nodes for runtime localization", function () {
  var html = read("app/src/main/assets/www/index.html");
  var i18n = read("app/src/main/assets/www/js/i18n.js");
  var backHandler = read("app/src/main/assets/www/js/back-handler.js");

  assert.match(html, /id="languageToggle"[\s\S]*?<span[^>]*data-i18n="menu\.language"[^>]*>语言<\/span>/);
  assert.match(html, /<strong id="languageToggleValue"[^>]*data-i18n="language\.switch">EN<\/strong>/);
  assert.match(html, /src="js\/back-handler\.js\?v=20260731-overlay-back"/);
  assert.match(i18n, /getElementById\("languageToggleValue"\)/);
  assert.doesNotMatch(i18n, /toggle\.textContent\s*=/);
  assert.match(backHandler, /DivinationUiBack/);
});

test("Android activity gives Web UI overlays priority over WebView history", function () {
  var mainActivity = read("app/src/main/java/com/quareia/divination/MainActivity.kt");
  var backHandler = read("app/src/main/assets/www/js/back-handler.js");

  assert.match(mainActivity, /OnBackPressedCallback/);
  assert.match(mainActivity, /DivinationUiBack/);
  assert.match(mainActivity, /webView\.canGoBack\(\)/);
  assert.match(backHandler, /DivinationDialog/);
  assert.match(backHandler, /DivinationTelemetryNotice/);
  assert.match(backHandler, /DivinationHistoryUi/);
  assert.match(backHandler, /DivinationMenu/);
});

test("preset mode shows an empty spread preview and a settings-adjacent position guide", function () {
  var html = read("app/src/main/assets/www/index.html");
  var app = read("app/src/main/assets/www/js/app.js");
  var i18n = read("app/src/main/assets/www/js/i18n.js");
  var deckStart = html.indexOf('class="deck-area"');
  var guideStart = html.indexOf('id="positionGuide"');
  var spreadArea = html.slice(html.indexOf('id="spreadArea"'), html.indexOf('id="resultsSection"'));

  assert.ok(guideStart > -1 && guideStart < deckStart);
  assert.match(html.slice(guideStart, deckStart), /data-i18n="spread\.guide"/);
  assert.doesNotMatch(spreadArea, /id="positionGuide"/);
  assert.match(app, /el\.spreadArea\.classList\.toggle\("is-empty", spread\.length === 0\)/);
  assert.match(app, /t\("app\.emptySpreadHint"\)/);
  assert.doesNotMatch(app, /if \(spread\.length === 0\) \{\s*el\.spreadArea\.style\.display = "none"/);
  assert.match(html, /src="js\/app\.js\?v=20260820-custom-spread-window-final"/);
  assert.match(html, /src="js\/i18n\.js\?v=20260820-custom-spread-window-final"/);
  ["zh-CN", "en"].forEach(function (locale) {
    var block = i18n.match(new RegExp('"' + locale + '": \\{[\\s\\S]*?\\n    \\}'))[0];
    assert.ok(block.indexOf('"app.emptySpreadHint"') !== -1, locale + " missing app.emptySpreadHint");
  });
});
