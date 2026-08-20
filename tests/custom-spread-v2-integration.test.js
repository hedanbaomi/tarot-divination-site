"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");

var root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

var apps = [
  read("js/app.js"),
  read("android-demo/app/src/main/assets/www/js/app.js")
];

test("both drawing surfaces enforce custom spread deck compatibility", function () {
  apps.forEach(function (app) {
    assert.match(app, /function customSpreadSupportsDeck\(/);
    assert.match(app, /DivinationCustomSpreads\.supportsDeck/);
    assert.match(app, /customCatalogue\.filter\(function \(spreadDefinition\)/);
    assert.match(app, /customSpreadSupportsDeck\(spreadDefinition, deckType\)/);
    assert.match(app, /function preferredDeckForCustomSpread\(/);
    assert.match(app, /function activateCustomSpread\([\s\S]*preferredDeckForCustomSpread/);
    assert.match(app, /function handleDeckChange\([\s\S]*customSpreadSupportsDeck\(currentCustomSpread, newDeck\)/);
  });
});

test("both drawing surfaces apply designer-owned Tarot modes", function () {
  apps.forEach(function (app) {
    assert.match(app, /function customSpreadTarotFilter\(/);
    assert.match(app, /DivinationCustomSpreads\.requiredTarotMode/);
    assert.match(app, /function resolveCustomSpreadFilter\([\s\S]*customSpreadTarotFilter/);
    assert.match(app, /function applyDeckUi\([\s\S]*hasCustomTarotMode/);
    assert.match(app, /function handleArcanaChange\([\s\S]*resolveCustomSpreadFilter\(selectedSpread\(\), deckType, newFilter\)/);
  });
});

test("custom major-minor mode reuses the complete layered drawing pipeline", function () {
  apps.forEach(function (app) {
    assert.match(app, /function isOverviewStacking\([\s\S]*DivinationCustomSpreads\.isMajorMinorStacking/);
    assert.match(app, /getOverviewStackingState\(spread, selectedSpread\(\)\.positions\.length\)/);
    assert.match(app, /getNextOverviewStackingSlot\(spread, selectedSpread\(\)\.positions\.length, currentPhase\)/);
    assert.match(app, /layer: isOverviewStacking\(\) \? currentPhase : null/);
    assert.match(app, /renderOverviewStackingResults\(\)/);
    assert.match(app, /isOverviewStacking\(\)\s*\?\s*"stacked"/);
  });
});

test("custom restrictions stay isolated from account, cloud and network code", function () {
  apps.forEach(function (app) {
    var start = app.indexOf("function customSpreadSupportsDeck(");
    var end = app.indexOf("function selectedSpread", start);
    var integration = app.slice(start, end);
    assert.doesNotMatch(integration, /fetch\s*\(|XMLHttpRequest|WebSocket|Account|Cloud|sync/i);
  });
});
