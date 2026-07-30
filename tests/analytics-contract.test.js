"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.resolve(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var i18n = fs.readFileSync(path.join(root, "js", "i18n.js"), "utf8");
var expectedToken = "f5cb15ff0d4d4a44a9eefb32c8fcfdf8";

test("the Cloudflare Web Analytics beacon appears exactly once with the agreed token", function () {
  var beaconRefs = html.match(/static\.cloudflareinsights\.com\/beacon\.min\.js/g) || [];
  assert.equal(beaconRefs.length, 1, "beacon.min.js must be referenced exactly once");

  assert.ok(
    html.indexOf('{"token": "' + expectedToken + '"}') !== -1,
    "beacon token must match the public site token"
  );
  assert.ok(
    html.indexOf("<!-- Cloudflare Web Analytics -->") !== -1 &&
      html.indexOf("<!-- End Cloudflare Web Analytics -->") !== -1,
    "beacon marker comments must be present"
  );
});

test("the beacon sits just before the closing body tag", function () {
  var beaconIndex = html.lastIndexOf("beacon.min.js");
  var bodyClose = html.lastIndexOf("</body>");
  assert.ok(beaconIndex > 0 && bodyClose > beaconIndex, "beacon must come before </body>");
  // Nothing script-bearing between the beacon and </body> except whitespace.
  var tail = html.slice(beaconIndex, bodyClose);
  assert.equal(
    /<script\b/i.test(tail.replace(/<\/script>/i, "")),
    false,
    "no extra script follows the analytics beacon"
  );
});

test("the bilingual privacy notice is present in the footer attribution area", function () {
  assert.match(html, /class="attribution-privacy"/);
  assert.match(i18n, /"privacy\.analytics":/);
  // The Chinese and English catalogues each carry a privacy.analytics string.
  var zhBlock = i18n.match(/"zh-CN": \{[\s\S]*?\n    \}/)[0];
  var enBlock = i18n.match(/"en": \{[\s\S]*?\n    \}/)[0];
  assert.ok(zhBlock.indexOf('"privacy.analytics"') !== -1, "zh-CN missing privacy.analytics");
  assert.ok(enBlock.indexOf('"privacy.analytics"') !== -1, "en missing privacy.analytics");

  var zh = zhBlock.match(/"privacy\.analytics": "([^"]*)"/)[1];
  var en = enBlock.match(/"privacy\.analytics": "([^"]*)"/)[1];
  assert.ok(zh.indexOf("Cloudflare Web Analytics") !== -1, "zh privacy mentions Cloudflare Web Analytics");
  assert.ok(zh.indexOf("不收集邮箱") !== -1, "zh privacy states it does not collect email");
  assert.ok(en.indexOf("Cloudflare Web Analytics") !== -1, "en privacy mentions Cloudflare Web Analytics");
  assert.ok(en.indexOf("does not collect email addresses") !== -1, "en privacy states it does not collect email");
});

test("no additional analytics, tracking, email capture, or custom telemetry is wired up", function () {
  assert.equal(/google[\s-]?analytics|googletagmanager|gtag\(/i.test(html), false, "no Google Analytics");
  assert.equal(/facebook\.com\/tr|connect\.facebook\.net/i.test(html), false, "no Facebook pixel");
  assert.equal(/hotjar|mixpanel|segment\.io|amplitude/i.test(html), false, "no other analytics SDKs");
  // Only the single Cloudflare beacon is allowed as an external stats script.
  var externalScripts = html.match(/<script\b[^>]*\bsrc="https?:\/\/[^"]+"/gi) || [];
  var nonCloudflare = externalScripts.filter(function (tag) {
    return !/cloudflareinsights\.com/.test(tag);
  });
  assert.deepEqual(nonCloudflare, [], "no external scripts other than the Cloudflare beacon");
  assert.equal(/type=["']?email["']?/i.test(html), false, "no email input fields");
  // No custom telemetry endpoint or RUM submit beyond the beacon itself.
  assert.equal(/\/cdn-cgi\/rum/i.test(html), false, "no hand-written RUM endpoint in markup");
});
