const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const scripts = [
  "js/tarot-data.js",
  "js/mystagogus-data.js",
  "js/lxxxi-data.js",
  "js/spreads.js"
];

function load(context, relativePath) {
  vm.runInContext(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    context,
    { filename: relativePath }
  );
}

test("English data enriches every supported object without replacing it", () => {
  const context = vm.createContext({});
  scripts.forEach((script) => load(context, script));

  const before = vm.runInContext(`({
    tarot: tarotDeckFull,
    mystagogus: mystagogusDeckFull,
    lxxxi: lxxxiDeckFull,
    spreads: tarotSpreads,
    card: tarotDeckFull[0],
    spread: tarotSpreads[0],
    position: tarotSpreads[0].positions[0]
  })`, context);

  load(context, "js/i18n-data-en.js");

  const after = vm.runInContext(`({
    tarot: tarotDeckFull,
    mystagogus: mystagogusDeckFull,
    lxxxi: lxxxiDeckFull,
    spreads: tarotSpreads,
    card: tarotDeckFull[0],
    spread: tarotSpreads[0],
    position: tarotSpreads[0].positions[0],
    report: DivinationEnglishData.validate()
  })`, context);

  assert.equal(after.tarot, before.tarot);
  assert.equal(after.mystagogus, before.mystagogus);
  assert.equal(after.lxxxi, before.lxxxi);
  assert.equal(after.spreads, before.spreads);
  assert.equal(after.card, before.card);
  assert.equal(after.spread, before.spread);
  assert.equal(after.position, before.position);
  assert.equal(after.position.nameEn, "Past");
  assert.equal(
    after.position.meaningEn,
    "Past events and influences that shape the present question."
  );

  assert.equal(after.report.valid, true, after.report.errors.join("\n"));
  assert.deepEqual(
    JSON.parse(JSON.stringify(after.report.counts)),
    {
      tarotCards: 78,
      mystagogusCards: 78,
      lxxxiCards: 81,
      tarotSpreads: 16,
      mystagogusSpreads: 1,
      lxxxiSpreads: 4,
      positions: 214,
      drawRules: 5
    }
  );
});

test("English fields, sources, and source-grounded meanings are complete", () => {
  const context = vm.createContext({});
  scripts.forEach((script) => load(context, script));
  load(context, "js/i18n-data-en.js");

  const result = vm.runInContext(`({
    tarotName: tarotDeckFull[0].nameEn,
    originalName: tarotDeckFull[0].name,
    rule: tarotSpreads[1].positions[0].drawRule.labelEn,
    lastMystagogus: mystagogusDeckFull[77].nameEn,
    lastLxxxi: lxxxiDeckFull[80].nameEn,
    sources: [
      tarotDeckFull[0].sourceEn,
      mystagogusDeckFull[0].sourceEn,
      lxxxiDeckFull[0].sourceEn
    ],
    lxxxiMeanings: [
      lxxxiDeckFull.find(function (card) { return card.id === "lxxxi-01"; }).uprightMeaningEn,
      lxxxiDeckFull.find(function (card) { return card.id === "lxxxi-61"; }).uprightMeaningEn
    ],
    genericLxxxiMeanings: lxxxiDeckFull.filter(function (card) {
      return card.uprightMeaningEn.indexOf(card.nameEn + " points to ") === 0;
    }).length,
    genericPositions: tarotSpreads.concat(mystagogusSpreads, lxxxiSpreads)
      .flatMap(function (spread) { return spread.positions; })
      .filter(function (position) {
        return /^Position \\d+$/.test(position.nameEn) ||
          /^Shows position \\d+/.test(position.meaningEn);
      }).length,
    apiKeys: Object.keys(DivinationEnglishData).sort()
  })`, context);

  assert.equal(result.tarotName, "The Fool");
  assert.equal(result.originalName, "愚者");
  assert.equal(result.rule, "Wands only");
  assert.equal(result.lastMystagogus, "Empty Vessel");
  assert.equal(result.lastLxxxi, "Destruction");
  assert.deepEqual(JSON.parse(JSON.stringify(result.apiKeys)), ["validate"]);
  assert.equal(result.genericPositions, 0);
  assert.equal(result.genericLxxxiMeanings, 0);
  assert.equal(
    result.lxxxiMeanings[0],
    "A new but not yet formed possibility is beginning to appear: an idea, first step, or change of direction."
  );
  assert.equal(
    result.lxxxiMeanings[1],
    "The restorative water current supports healing, emotional renewal, replenishment, and regeneration."
  );
  assert.equal(result.sources.length, 3);
  result.sources.forEach((source) => assert.ok(source.length > 20));
});

test("Mystagogus ships bounded English keyword summaries", () => {
  const context = vm.createContext({});
  scripts.forEach((script) => load(context, script));
  load(context, "js/i18n-data-en.js");

  const keywordCounts = vm.runInContext(
    "mystagogusDeckFull.map(function (card) { return card.uprightKeywordsEn.length; })",
    context
  );

  assert.equal(keywordCounts.length, 78);
  keywordCounts.forEach((count) => assert.ok(count >= 1 && count <= 4));
});

test("original-deck enrichment follows card IDs rather than array order", () => {
  const context = vm.createContext({});
  scripts.forEach((script) => load(context, script));
  vm.runInContext("mystagogusDeckFull.reverse(); lxxxiDeckFull.reverse();", context);
  load(context, "js/i18n-data-en.js");

  const result = vm.runInContext(`({
    mystagogusFirst: mystagogusDeckFull.find(function (card) { return card.id === "m-01"; }).nameEn,
    mystagogusLast: mystagogusDeckFull.find(function (card) { return card.id === "m-78"; }).nameEn,
    lxxxiFirst: lxxxiDeckFull.find(function (card) { return card.id === "lxxxi-01"; }).nameEn,
    lxxxiLast: lxxxiDeckFull.find(function (card) { return card.id === "lxxxi-81"; }).nameEn,
    report: DivinationEnglishData.validate()
  })`, context);

  assert.equal(result.mystagogusFirst, "Progenitor");
  assert.equal(result.mystagogusLast, "Empty Vessel");
  assert.equal(result.lxxxiFirst, "The Star Father");
  assert.equal(result.lxxxiLast, "Destruction");
  assert.equal(result.report.valid, true, result.report.errors.join("\n"));
});

test("validation rejects truncated catalogues and generic position fallbacks", () => {
  const context = vm.createContext({});
  scripts.forEach((script) => load(context, script));
  load(context, "js/i18n-data-en.js");

  const report = vm.runInContext(`(() => {
    tarotDeckFull.pop();
    tarotSpreads[0].positions[0].nameEn = "Position 1";
    tarotSpreads[0].positions[0].meaningEn = "Shows position 1 in the reading.";
    tarotSpreads[1].positions = [];
    return DivinationEnglishData.validate();
  })()`, context);

  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => error.includes("expected 78 cards")));
  assert.ok(report.errors.some((error) => error.includes("nameEn is generic")));
  assert.ok(report.errors.some((error) => error.includes(".positions")));
});
