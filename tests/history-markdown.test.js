const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const scripts = ["tarot-data", "mystagogus-data", "lxxxi-data", "spreads", "i18n-data-en", "i18n", "history-markdown", "history-ui"];
function load(assets = root) {
  const context = vm.createContext({});
  scripts.forEach((name) => vm.runInContext(fs.readFileSync(path.join(assets, "js", name + ".js"), "utf8"), context));
  return context;
}
function record(deckType, cardId, extra = {}) {
  return {
    deckType, deckName: deckType, spreadId: "missing", spreadName: "Snapshot",
    createdAt: "2026-11-23T08:30:00.000Z", orientationMode: "mixed",
    cards: [{ cardId, cardName: "Snapshot card", slotIndex: 0, positionNumber: 1,
      positionName: "Snapshot position", orientation: "upright", layer: null }], ...extra
  };
}

test("exports complete localized built-in meanings and keywords from all three decks", () => {
  const context = load();
  const decks = vm.runInContext("[tarotDeckFull, mystagogusDeckFull, lxxxiDeckFull]", context);
  const records = [record("tarot", decks[0][0].id), record("mystagogus", decks[1][0].id), record("lxxxi", decks[2][0].id)];
  const api = context.DivinationHistoryUi;
  for (const locale of ["zh-CN", "en"]) {
    context.DivinationI18n.setLocale(locale);
    const text = api.formatMarkdown(records);
    for (const deck of decks) {
      const card = deck[0];
      const suffix = locale === "en" ? "En" : "";
      assert.ok(text.includes(card["name" + suffix]), locale);
      assert.ok(text.includes(card["uprightKeywords" + suffix].join(" · ")), locale);
      assert.ok(text.includes(card["uprightMeaning" + suffix]), locale);
    }
    assert.ok(decks[2][0]["uprightMeaning" + (locale === "en" ? "En" : "")].length > 100);
  }
});

test("uses spread positions, stacked layers, reversed meaning and stable freeform order", () => {
  const context = load();
  context.DivinationI18n.setLocale("en");
  const first = vm.runInContext("tarotDeckFull[0]", context);
  const second = vm.runInContext("tarotDeckFull[22]", context);
  const stacked = record("tarot", first.id, { spreadId: "custom-test", overviewMethod: "stacked" });
  stacked.cards[0].layer = "major";
  stacked.cards[0].orientation = "reversed";
  stacked.cards.unshift({ ...stacked.cards[0], cardId: second.id, layer: "minor", orientation: "upright" });
  const free = record("tarot", first.id, { layoutMode: "freeform", cards: [
    { cardId: second.id, cardName: "two", orientation: "upright", drawOrder: 2, revealed: false, x: 15, y: -3, boardRotation: 45, z: 7 },
    { cardId: first.id, cardName: "one", orientation: "upright", drawOrder: 1, revealed: true }
  ] });
  const text = context.DivinationHistoryUi.formatMarkdown([stacked, free], () => ({
    id: "custom-test", name: "Custom", nameEn: "Custom English", positions: [{ name: "位置", nameEn: "Position English" }]
  }));
  assert.match(text, /Custom English/);
  assert.match(text, /Position English/);
  assert.ok(text.includes(first.reversedMeaningEn));
  assert.ok(text.includes("Major layer") && text.indexOf("Major layer") < text.indexOf("Minor layer"));
  assert.match(text, /Free Board/);
  assert.match(text, /Face down/);
  assert.match(text, /15, -3/);
  const freePart = text.slice(text.indexOf("## Free Board"));
  assert.ok(freePart.indexOf(first.nameEn) < freePart.indexOf(second.nameEn));
});

test("escapes hostile imported text and reports missing source data", () => {
  const context = load();
  context.DivinationI18n.setLocale("en");
  const payload = "<img src=x onerror=alert(1)>\n# injected\n[click](https://evil.test) & **bold**";
  const item = record("unknown", "missing", {
    deckName: payload, spreadName: payload, question: payload,
    cards: [{ cardId: "missing", cardName: payload, positionName: payload, positionNumber: 1, slotIndex: 0, orientation: payload }]
  });
  const text = context.DivinationHistoryUi.formatMarkdown([item]);
  assert.ok(text.includes("> &lt;img src=x onerror=alert(1)&gt;\n> \\# injected\n> \\[click\\]"));
  assert.ok(!text.includes("<img"));
  assert.ok(!text.includes("\n# injected"));
  assert.ok(!text.includes("[click](https://evil.test)"));
  assert.match(text, /Card meaning unavailable/);
});

test("Android formatter mirrors the web formatter", () => {
  assert.equal(fs.readFileSync(path.join(root, "js/history-markdown.js"), "utf8"),
    fs.readFileSync(path.join(root, "android-demo/app/src/main/assets/www/js/history-markdown.js"), "utf8"));
});

test("single and batch Markdown exports credit only the decks in the file, once per deck", () => {
  const guidebooks = {
    tarot: "https://www.quareia.com/s/tarotbook-for-Q-website-g5at.pdf",
    mystagogus: "https://www.quareia.com/s/mystagogus-online.pdf",
    lxxxi: "https://www.quareia.com/s/deckbook-web.pdf"
  };
  const records = { tarot: record("tarot", "major-00"), mystagogus: record("mystagogus", "m-01"), lxxxi: record("lxxxi", "lxxxi-01") };
  for (const assets of [root, path.join(root, "android-demo/app/src/main/assets/www")]) {
    const context = load(assets);
    for (const [locale, heading] of [["zh-CN", "来源与致谢"], ["en", "Sources and credits"]]) {
      context.DivinationI18n.setLocale(locale);
      for (const selection of [["tarot"], ["mystagogus"], ["lxxxi"], ["lxxxi", "tarot", "lxxxi", "mystagogus"]]) {
        const markdown = context.DivinationHistoryUi.formatMarkdown(selection.map(deck => records[deck]));
        const sections = markdown.split("\n## " + heading + "\n");
        assert.equal(sections.length, 2);
        const credits = sections[1].trim().split("\n");
        assert.equal(credits.length, new Set(selection).size);
        for (const [deck, url] of Object.entries(guidebooks)) {
          const matches = credits.filter(line => line.includes("](" + url + ")"));
          assert.equal(matches.length, selection.includes(deck) ? 1 : 0);
          if (!matches.length) continue;
          assert.ok(matches[0].startsWith("- **" + context.DivinationI18n.t("deck.name." + deck) + "**"));
          assert.match(matches[0], /Josephine McCarthy/);
          if (deck === "tarot") {
            assert.match(matches[0], /21世纪的塔罗技能|Tarot Skills for the 21st Century/);
            assert.match(matches[0], /Quareia 训练教材|Quareia training materials/);
          }
        }
      }
    }
  }
});
