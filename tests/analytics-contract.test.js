"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var root = path.resolve(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var androidHtml = fs.readFileSync(
  path.join(root, "android-demo", "app", "src", "main", "assets", "www", "index.html"),
  "utf8"
);
var i18n = fs.readFileSync(path.join(root, "js", "i18n.js"), "utf8");
var webAnalytics = fs.readFileSync(path.join(root, "js", "web-analytics.js"), "utf8");
var expectedToken = "f5cb15ff0d4d4a44a9eefb32c8fcfdf8";
var beaconSrc = "https://static.cloudflareinsights.com/beacon.min.js";

function createBrowser(location) {
  var appended = [];
  var document = {
    head: {
      appendChild: function (node) {
        appended.push(node);
      }
    },
    body: {
      appendChild: function (node) {
        appended.push(node);
      }
    },
    createElement: function (tagName) {
      return {
        tagName: tagName.toUpperCase(),
        attributes: {},
        setAttribute: function (name, value) {
          this.attributes[name] = String(value);
        },
        getAttribute: function (name) {
          return Object.prototype.hasOwnProperty.call(this.attributes, name)
            ? this.attributes[name]
            : null;
        }
      };
    },
    querySelector: function () {
      return appended.find(function (node) {
        return node.getAttribute("data-cf-beacon") !== null;
      }) || null;
    }
  };
  return {
    context: vm.createContext({
      window: { location: location },
      document: document
    }),
    appended: appended
  };
}

function runAnalytics(location) {
  var browser = createBrowser(location);
  vm.runInContext(webAnalytics, browser.context, { filename: "web-analytics.js" });
  return browser;
}

test("the root page loads the guarded analytics module without an inline beacon", function () {
  assert.equal(/static\.cloudflareinsights\.com\/beacon\.min\.js/.test(html), false);
  assert.match(html, /<script src="js\/web-analytics\.js"><\/script>/);
  assert.equal((html.match(/js\/web-analytics\.js/g) || []).length, 1);
  assert.equal(/\beval\s*\(/.test(webAnalytics), false, "analytics module must not use eval");
  assert.equal(/document\.write\s*\(/.test(webAnalytics), false, "analytics module must not use document.write");
});

test("local, non-HTTPS, and wrong-host environments do not load analytics", function () {
  [
    { name: "localhost", protocol: "https:", hostname: "localhost" },
    { name: "127.0.0.1", protocol: "https:", hostname: "127.0.0.1" },
    { name: "non-HTTPS", protocol: "http:", hostname: "hedanbaomi.github.io" },
    { name: "wrong host", protocol: "https:", hostname: "example.com" },
    {
      name: "wrong path",
      protocol: "https:",
      hostname: "hedanbaomi.github.io",
      pathname: "/other-site/"
    }
  ].forEach(function (caseInfo) {
    var browser = runAnalytics({
      protocol: caseInfo.protocol,
      hostname: caseInfo.hostname,
      pathname: caseInfo.pathname || "/tarot-divination-site/"
    });
    assert.equal(browser.appended.length, 0, caseInfo.name + " must not append a beacon");
  });
});

test("the formal web origin loads one module beacon for the site path and its children", function () {
  var browser = createBrowser({
    protocol: "https:",
    hostname: "hedanbaomi.github.io",
    pathname: "/tarot-divination-site/readings/today"
  });
  vm.runInContext(webAnalytics, browser.context, { filename: "web-analytics.js" });
  vm.runInContext(webAnalytics, browser.context, { filename: "web-analytics.js" });

  assert.equal(browser.appended.length, 1, "the beacon must be appended only once");
  var script = browser.appended[0];
  assert.equal(script.type, "module");
  assert.equal(script.src, beaconSrc);
  assert.deepEqual(JSON.parse(script.getAttribute("data-cf-beacon")), { token: expectedToken });
});

test("Android assets do not load the web analytics module or beacon", function () {
  assert.equal(/js\/web-analytics\.js/.test(androidHtml), false);
  assert.equal(/static\.cloudflareinsights\.com\/beacon\.min\.js/.test(androidHtml), false);
});

test("announcements.js?v=1 remains unchanged on the root and Android asset pages", function () {
  var announcementScript = '<script src="js/announcements.js?v=1"></script>';
  assert.equal((html.match(/js\/announcements\.js\?v=1/g) || []).length, 1);
  assert.equal((androidHtml.match(/js\/announcements\.js\?v=1/g) || []).length, 1);
  assert.ok(html.indexOf(announcementScript) !== -1);
  assert.ok(androidHtml.indexOf(announcementScript) !== -1);
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
  // The beacon is the only external stats script, and it is created by the guarded module.
  var externalScripts = html.match(/<script\b[^>]*\bsrc="https?:\/\/[^"]+"/gi) || [];
  assert.deepEqual(externalScripts, [], "the root page must not inline an external analytics script");
  assert.equal(
    (webAnalytics.match(/static\.cloudflareinsights\.com\/beacon\.min\.js/g) || []).length,
    1,
    "the guarded module must contain one Cloudflare beacon source"
  );
  assert.equal(/type=["']?email["']?/i.test(html), false, "no email input fields");
  // No custom telemetry endpoint or RUM submit beyond the beacon itself.
  assert.equal(/\/cdn-cgi\/rum/i.test(html), false, "no hand-written RUM endpoint in markup");
});
