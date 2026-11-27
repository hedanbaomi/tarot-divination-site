"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.resolve(__dirname, "..");

function readNormalized(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8").replace(/\r\n/g, "\n");
}

function getSurfaces() {
  return [
    {
      label: "web",
      styles: readNormalized("css/styles.css"),
      redesign: readNormalized("css/redesign.css")
    },
    {
      label: "android",
      styles: readNormalized("android-demo/app/src/main/assets/www/css/styles.css"),
      redesign: readNormalized("android-demo/app/src/main/assets/www/css/redesign.css")
    }
  ];
}

test("Web and Android shared stylesheets stay synchronized", function () {
  var surfaces = getSurfaces();
  assert.equal(surfaces[0].styles, surfaces[1].styles, "styles.css must match between Web and Android");
  assert.equal(surfaces[0].redesign, surfaces[1].redesign, "redesign.css must match between Web and Android");
});

test("Issue #46: mobile viewport, result cards, table glow, and confirm dialog stay horizontally contained", function () {
  getSurfaces().forEach(function (entry) {
    // Root viewport clipping prevents horizontal visualViewport panning on mobile WebView
    assert.match(
      entry.styles,
      /html\s*\{[^}]*overflow-x:\s*clip;/,
      entry.label + " styles.css clips html horizontal overflow"
    );
    assert.match(
      entry.styles,
      /body\s*\{[^}]*overflow-x:\s*hidden;\s*overflow-x:\s*clip;/,
      entry.label + " styles.css clips body horizontal overflow with hidden fallback"
    );

    // .result-card tracks must use minmax(0, 1fr), never bare 1fr
    assert.doesNotMatch(
      entry.styles,
      /\.result-card\s*\{[^}]*grid-template-columns:\s*\d+px\s+1fr\s*;/,
      entry.label + " styles.css must not use unbounded 1fr in .result-card"
    );
    assert.doesNotMatch(
      entry.redesign,
      /\.result-card\s*\{[^}]*grid-template-columns:\s*\d+px\s+1fr\s*;/,
      entry.label + " redesign.css must not use unbounded 1fr in .result-card"
    );
    assert.match(
      entry.styles,
      /\.result-card\s*>\s*\*\s*\{\s*min-width:\s*0;\s*\}/,
      entry.label + " styles.css sets min-width: 0 on .result-card grid items"
    );

    // .result-pos must wrap long English position names instead of forcing nowrap overflow
    assert.match(
      entry.styles,
      /\.result-pos\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/,
      entry.label + " styles.css allows .result-pos to wrap"
    );
    assert.doesNotMatch(
      entry.styles,
      /\.result-pos\s*\{[^}]*white-space:\s*nowrap/,
      entry.label + " styles.css must not force nowrap on .result-pos"
    );
    assert.match(
      entry.redesign,
      /html\.ui2\s+\.result-pos\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/,
      entry.label + " redesign.css allows .result-pos to wrap"
    );

    // Initial table-plane halo must stay within container width before deck-ring.js updates --ring-rx
    assert.match(
      entry.redesign,
      /html\.ui2\s+\.table-plane::after\s*\{[^}]*width:\s*min\(100%,\s*calc\(var\(--ring-rx\)\s*\*\s*2\.1\)\);/,
      entry.label + " redesign.css bounds .table-plane::after width"
    );

    // Narrow confirmation dialog buttons must stay inside 360px screens
    assert.match(
      entry.styles,
      /\.confirm-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
      entry.label + " styles.css bounds .confirm-actions columns"
    );
    assert.match(
      entry.styles,
      /\.confirm-actions\s+\.btn\s*\{[^}]*min-width:\s*0;[^}]*white-space:\s*normal;/,
      entry.label + " styles.css allows .confirm-actions .btn to wrap"
    );
  });
});
