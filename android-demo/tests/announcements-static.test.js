"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var demoRoot = path.resolve(__dirname, "..");
var repoRoot = path.resolve(demoRoot, "..");
var androidWebRoot = path.join(demoRoot, "app", "src", "main", "assets", "www");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("Android receives only the audited public announcement module and CSS rules", function () {
  assert.equal(
    fs.readFileSync(path.join(androidWebRoot, "js", "announcements.js"), "utf8"),
    read("js/announcements.js")
  );
  assert.match(read("css/styles.css"), /\.announcement-dialog\s*\{/);
  assert.match(fs.readFileSync(path.join(androidWebRoot, "css", "styles.css"), "utf8"), /\.announcement-dialog\s*\{/);

  var source = read("js/announcements.js");
  assert.doesNotMatch(source, /lxxxi-data\.js|assets[\\/]qv|LXXXI_SOURCE|LxxxiVault|opaque/i);
  assert.doesNotMatch(source, /UpdateManager|install_hash|innerHTML/);
});

test("Android page loads the guarded web module without sharing native-owned files", function () {
  var html = fs.readFileSync(path.join(androidWebRoot, "index.html"), "utf8");
  var i18n = fs.readFileSync(path.join(androidWebRoot, "js", "i18n.js"), "utf8");
  var syncScript = read("tools/sync-public-announcements.mjs");
  assert.match(html, /src="js\/announcements\.js/);
  assert.doesNotMatch(html, /id="announcementOpenBtn"|id="announcementDialog"/);
  assert.doesNotMatch(i18n, /"announcement\.open"|"announcement\.openAction"/);
  assert.match(syncScript, /EXCLUDED_PATH_PREFIXES/);
  var allowList = syncScript.match(/export const SHARED_FILES = Object\.freeze\(\[[\s\S]*?\]\);/)[0];
  assert.doesNotMatch(allowList, /lxxxi-data\.js|assets\/qv|LXXXI_SOURCE|LxxxiVault|占卜小程序/i);
  assert.match(syncScript, /lxxxi-data\.js/);
  assert.match(syncScript, /占卜小程序/);
});
