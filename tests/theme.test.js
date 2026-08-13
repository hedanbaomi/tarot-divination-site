"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var css = fs.readFileSync(path.join(root, "css", "styles.css"), "utf8");
var i18nSource = fs.readFileSync(path.join(root, "js", "i18n.js"), "utf8");
var themeSource = fs.readFileSync(path.join(root, "js", "theme.js"), "utf8");
var theme = require("../js/theme.js");

var THEMES = ["celestial", "parchment", "ember", "grove"];

function i18nSourceBlock(source, locale) {
  var start = source.indexOf('"' + locale + '": {');
  var nextLocale = locale === "zh-CN"
    ? source.indexOf('"en": {', start)
    : source.indexOf("\n    }\n  };", start);
  return source.slice(start, nextLocale === -1 ? source.length : nextLocale);
}

test("theme boot script applies a closed allow-list before styles load", function () {
  var bootStart = html.indexOf("<script>");
  var bootEnd = html.indexOf("</script>");
  var cssLink = html.indexOf('href="css/styles.css?v=20260813-parchment-chrome"');
  assert.ok(bootStart > 0 && bootEnd > bootStart);
  assert.ok(cssLink > bootEnd, "FOUC boot must run before styles.css");
  var boot = html.slice(bootStart, bootEnd);
  assert.match(boot, /quareia-divination-theme/);
  THEMES.forEach(function (id) {
    assert.match(boot, new RegExp(id + ": 1"));
  });
  assert.match(boot, /setAttribute\("data-theme"/);
  assert.doesNotMatch(boot, /innerHTML/);
});

test("settings expose four theme swatches with bilingual names", function () {
  THEMES.forEach(function (id) {
    assert.match(html, new RegExp('data-theme-id="' + id + '"'));
    assert.match(css, new RegExp('html\\[data-theme="' + id + '"\\]'));
    assert.match(themeSource, new RegExp('"' + id + '"'));
  });
  ["zh-CN", "en"].forEach(function (locale) {
    var block = i18nSourceBlock(i18nSource, locale);
    [
      "settings.theme",
      "settings.themeAria",
      "theme.celestial",
      "theme.parchment",
      "theme.ember",
      "theme.grove"
    ].forEach(function (key) {
      assert.ok(block.indexOf('"' + key + '"') !== -1, locale + " missing " + key);
    });
  });
  assert.match(html, /role="radiogroup"/);
  assert.match(html, /src="js\/theme\.js\?v=20260813-themes"/);
});

test("theme helper persists a valid id and rejects unknown values", function () {
  assert.equal(theme.DEFAULT_THEME, "celestial");
  assert.deepEqual(theme.THEMES, THEMES);
  assert.equal(theme.getTheme(), "celestial");
  assert.equal(theme.setTheme("not-a-theme"), false);
  assert.equal(theme.getTheme(), "celestial");
});

test("theme tokens restyle chrome without filtering protected card faces", function () {
  assert.match(css, /--accent-rgb:/);
  assert.match(css, /--bg-page:/);
  assert.match(css, /--panel-bg:/);
  assert.match(css, /--dialog-bg:/);
  assert.match(css, /\.theme-swatch\.is-active/);
  assert.doesNotMatch(css, /\.deck-card-m\s*\{[^}]*filter:/);
  assert.doesNotMatch(css, /\.deck-card-lxxxi\s*\{[^}]*filter:/);
  assert.match(css, /M 牌 \/ LXXXI 牌堆：真实牌背图，保持中性原样/);
});

test("parchment settings chrome uses light tokens instead of night indigo", function () {
  var parchmentStart = css.indexOf('html[data-theme="parchment"]');
  var emberStart = css.indexOf('html[data-theme="ember"]');
  var parchment = css.slice(parchmentStart, emberStart);
  assert.match(parchment, /--select-trigger-bg:\s*linear-gradient\(180deg, #fffef9/);
  assert.match(parchment, /--choice-option-bg:\s*linear-gradient\(180deg, #fffdf8/);
  assert.match(parchment, /--choice-option-selected-color:\s*#2a2418/);
  assert.doesNotMatch(parchment, /rgba\(24, 28, 55/);
  assert.match(css, /\.themed-select-trigger\s*\{[^}]*background-image:\s*var\(--select-trigger-bg\)/);
  assert.match(css, /\.choice-option\s*\{[^}]*background:\s*var\(--choice-option-bg\)/);
  assert.match(css, /\.choice-option\.selected\s*\{[^}]*color:\s*var\(--choice-option-selected-color\)/);
  assert.doesNotMatch(css, /\.choice-option\s*\{[^}]*background:\s*rgba\(24, 28, 55/);
});

test("parchment theme uses the engraved sun sprite with the same pinball motion as the moon", function () {
  var sky = fs.readFileSync(path.join(root, "js", "celestial-sky.js"), "utf8");
  assert.match(html, /class="sky-sun"/);
  assert.match(html, /src="assets\/icons\/parchment-sun\.png"/);
  assert.match(css, /html\[data-theme="parchment"\] \.sky-sun/);
  assert.match(css, /html\[data-theme="parchment"\] \.sky-moon::before/);
  assert.match(css, /transform: rotate\(var\(--spin/);
  assert.match(sky, /quareia:themechange/);
  assert.match(sky, /var FLOAT_AMP = 5/);
  assert.match(sky, /var BOUNCE = 0\.42/);
  assert.match(sky, /angVel = vx \* SPIN_PER_PX/);
  assert.doesNotMatch(sky, /parchmentTheme/);
  assert.doesNotMatch(sky, /settleForSun/);
});
