"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBrowserContext() {
  const rootDir = path.resolve(__dirname, "..");
  const context = {
    console,
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    JSON,
    Intl,
    encodeURIComponent
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);

  const files = [
    "js/tarot-data.js",
    "js/mystagogus-data.js",
    "js/lxxxi-data.js",
    "js/spreads.js",
    "js/i18n-data-en.js",
    "js/custom-spreads.js",
    "js/ai-context.js"
  ];
  for (const rel of files) {
    const code = fs.readFileSync(path.join(rootDir, rel), "utf8");
    vm.runInContext(code, context, { filename: rel });
  }
  return context;
}

const browserEnv = loadBrowserContext();
const aiContext = browserEnv.DivinationAiContext;

test("filterSelectableHistoryRecords excludes freeform boards and invalid entries", () => {
  const records = [
    {
      id: "free-v2",
      schemaVersion: 2,
      createdAt: 300,
      layoutMode: "freeform",
      deckType: "tarot",
      spreadId: "",
      cards: [{ cardId: "major-0" }]
    },
    {
      id: "free-v3",
      schemaVersion: 3,
      createdAt: 400,
      layoutMode: "freeform",
      deckType: "lxxxi",
      cards: [{ cardId: "lxxxi-01" }]
    },
    {
      id: "preset-v1",
      schemaVersion: 1,
      createdAt: 100,
      deckType: "tarot",
      spreadId: "three-card-horizontal",
      cards: [{ cardId: "major-0", positionNumber: 1, orientation: "upright" }]
    },
    {
      id: "preset-v2",
      schemaVersion: 2,
      createdAt: 200,
      layoutMode: "preset",
      deckType: "mystagogus",
      spreadId: "mystagogus-layout",
      cards: [{ cardId: "m-01", positionNumber: 1, orientation: "upright" }]
    }
  ];

  const selectable = aiContext.filterSelectableHistoryRecords(records);
  assert.deepEqual(selectable.map((r) => r.id), ["preset-v2", "preset-v1"]);
});

test("resolveReadingDetails handles Tarot reversed meaning, Mystagogus upright-only, and LXXXI in ZH/EN", () => {
  const tarotMixedRecord = {
    id: "tarot-rec-1",
    createdAt: 1730000000000,
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "three-card-horizontal",
    spreadNameSnapshot: "三张横向牌阵",
    question: "未来三个月的发展方向",
    orientationMode: "mixed",
    cards: [
      { cardId: "major-16", orientation: "reversed", positionNumber: 1, positionNameSnapshot: "位置 1" },
      { cardId: "minor-cups-three", orientation: "upright", positionNumber: 2, positionNameSnapshot: "位置 2" }
    ]
  };

  const zhTarot = aiContext.resolveReadingDetails(tarotMixedRecord, { locale: "zh-CN" });
  assert.equal(zhTarot.spreadFound, true);
  assert.equal(zhTarot.cards[0].orientation, "reversed");
  assert.equal(zhTarot.cards[0].cardName, "塔");
  assert.ok(zhTarot.cards[0].positionMeaning.length > 5);
  assert.ok(zhTarot.cards[0].meaning.length > 10);

  const enTarot = aiContext.resolveReadingDetails(tarotMixedRecord, { locale: "en" });
  assert.equal(enTarot.cards[0].cardName, "The Tower");
  assert.equal(enTarot.cards[0].orientationLabel, "Reversed");
  assert.equal(enTarot.cards[1].cardName, "Three of Cups");
  assert.ok(enTarot.cards[0].meaning.toLowerCase().includes("tower"));

  // Mystagogus must stay strictly upright even if entry says reversed.
  const mystagogusRecord = {
    id: "myst-rec-1",
    createdAt: 1730000001000,
    layoutMode: "preset",
    deckType: "mystagogus",
    spreadId: "mystagogus-layout",
    question: "Test Mystagogus",
    orientationMode: "upright",
    cards: [
      { cardId: "m-01", orientation: "reversed", positionNumber: 1 }
    ]
  };
  const resolvedMyst = aiContext.resolveReadingDetails(mystagogusRecord, { locale: "zh-CN" });
  assert.equal(resolvedMyst.spreadFound, true);
  assert.equal(resolvedMyst.cards[0].orientation, "upright");
  assert.equal(resolvedMyst.cards[0].cardName, "始源者");

  // LXXXI reading in English
  const lxxxiRecord = {
    id: "lxxxi-rec-1",
    createdAt: 1730000002000,
    layoutMode: "preset",
    deckType: "lxxxi",
    spreadId: "lxxxi-four-directions",
    question: "Guidance",
    orientationMode: "upright",
    cards: [
      { cardId: "lxxxi-01", orientation: "upright", positionNumber: 1 }
    ]
  };
  const resolvedLxxxi = aiContext.resolveReadingDetails(lxxxiRecord, { locale: "en" });
  assert.equal(resolvedLxxxi.spreadFound, true);
  assert.equal(resolvedLxxxi.cards[0].cardName, "The Star Father");
  assert.ok(resolvedLxxxi.cards[0].keywords.includes("new potential"));
  assert.ok(resolvedLxxxi.cards[0].meaning.includes("new but not yet formed"));
});

test("resolveReadingDetails handles 26-card stacked Overview and deleted custom spreads safely", () => {
  const stackedRecord = {
    id: "overview-1",
    createdAt: 1730000003000,
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "overview",
    question: "年度总览",
    orientationMode: "upright",
    cards: [
      { cardId: "major-0", orientation: "upright", positionNumber: 1, layer: "major" },
      { cardId: "minor-wands-ace", orientation: "upright", positionNumber: 1, layer: "minor" }
    ]
  };
  const promptText = aiContext.formatReadingsForPrompt([stackedRecord], { locale: "zh-CN" });
  assert.ok(promptText.includes("大阿卡那 · 底牌／因"));
  assert.ok(promptText.includes("小阿卡那 · 叠牌／果"));

  // Custom spread present vs missing: missing custom spread must NOT silently fall back to tarotSpreads[0].
  const fakeLibrary = {
    getById(id) {
      if (id === "custom-saved-1") {
        return {
          id: "custom-saved-1",
          name: "个人双星阵",
          description: "自定义两张牌",
          positions: [
            { number: 1, name: "内因", meaning: "内在动力" },
            { number: 2, name: "外缘", meaning: "外部条件" }
          ]
        };
      }
      return null;
    }
  };

  const savedCustom = aiContext.resolveReadingDetails({
    id: "cust-1",
    createdAt: 1730000004000,
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "custom-saved-1",
    spreadNameSnapshot: "旧名",
    orientationMode: "upright",
    cards: [{ cardId: "major-1", positionNumber: 1, positionNameSnapshot: "快照1" }]
  }, { locale: "zh-CN", customLibrary: fakeLibrary });
  assert.equal(savedCustom.spreadFound, true);
  assert.equal(savedCustom.spreadName, "个人双星阵");
  assert.equal(savedCustom.cards[0].positionMeaning, "内在动力");

  const deletedCustom = aiContext.resolveReadingDetails({
    id: "cust-deleted",
    createdAt: 1730000005000,
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "custom-missing-999",
    spreadNameSnapshot: "已删自定义阵",
    orientationMode: "upright",
    cards: [{ cardId: "major-1", positionNumber: 1, positionNameSnapshot: "自定义位1" }]
  }, { locale: "zh-CN", customLibrary: fakeLibrary });
  assert.equal(deletedCustom.spreadFound, false);
  assert.equal(deletedCustom.spreadName, "已删自定义阵");
  assert.equal(deletedCustom.cards[0].positionName, "自定义位1");
  assert.equal(deletedCustom.cards[0].positionMeaning, "");

  const fullSysPrompt = aiContext.buildSystemPrompt("zh-CN", promptText, "此前用户已询问第1张愚者的含义。");
  assert.ok(fullSysPrompt.includes("## 当前对话已关联的非自由画板占卜记录（含牌位与应用内牌意）"));
  assert.ok(fullSysPrompt.includes("## 早期对话压缩摘要（已自动浓缩保留关键脉络）"));
  assert.ok(fullSysPrompt.includes("底牌"));
  assert.ok(fullSysPrompt.includes("叠牌"));
  assert.ok(fullSysPrompt.includes("绝不拒绝、说教或强行拉回占卜"));

  const emptySysPrompt = aiContext.buildSystemPrompt("en", "");
  assert.ok(emptySysPrompt.includes("No non-freeboard reading is attached to this chat right now"));
  assert.ok(emptySysPrompt.includes("NEVER refuse, block, scold, or force-redirect benign non-divination topics"));
});

test("ISO timestamps, real history-records schema, snapshots, summary cards, crossings, and token estimation", () => {
  const realV2Record = {
    schemaVersion: 2,
    id: "hist-iso-1",
    createdAt: "2026-06-15T14:30:00.000Z",
    deckType: "tarot",
    layoutMode: "preset",
    spreadId: "overview",
    spreadName: "总览牌阵",
    positionCount: 4,
    orientationMode: "mixed",
    filterMode: "stacked",
    overviewMethod: "stacked",
    question: "未来三个月功课",
    cards: [
      {
        slotIndex: 0,
        positionNumber: 1,
        positionName: "家庭",
        cardId: "major-0",
        cardName: "愚者",
        orientation: "upright",
        arcana: "major",
        suit: "major",
        layer: "major"
      },
      {
        slotIndex: 1,
        positionNumber: 1,
        positionName: "家庭",
        cardId: "minor-swords-ace",
        cardName: "宝剑王牌",
        orientation: "reversed",
        arcana: "minor",
        suit: "swords",
        layer: "minor"
      },
      {
        slotIndex: 2,
        positionNumber: 3,
        positionName: "创造力",
        cardId: "major-15",
        cardName: "恶魔",
        orientation: "upright",
        arcana: "major",
        suit: "major",
        layer: "major"
      }
    ]
  };

  assert.equal(aiContext.parseTimestampMs("2026-06-15T14:30:00.000Z"), Date.parse("2026-06-15T14:30:00.000Z"));
  const resolved = aiContext.resolveReadingDetails(realV2Record, { locale: "zh-CN" });
  assert.equal(resolved.formattedTime.includes("NaN"), false);
  assert.equal(resolved.isSplitDeckStacked, true);
  assert.equal(resolved.cards[1].orientation, "reversed");
  assert.ok(resolved.cards[1].uprightMeaningRef.length > 0);

  const md = aiContext.formatReadingsForPrompt([realV2Record], { locale: "zh-CN" });
  assert.equal(md.includes("NaN"), false);
  assert.ok(md.includes("**第 1 位 · "));
  assert.ok(md.includes("【叠牌组合：大牌为因 · 小牌为果】"));
  assert.ok(md.includes("Quareia 正位内核参考"));
  assert.ok(md.includes("第 3 位 · "));

  // Snapshot fallback for custom spread retains real history-records `positionName` when definition is absent.
  const customSnapPrompt = aiContext.formatReadingsForPrompt([{
    id: "cust-v2-snap",
    createdAt: "2026-06-15T14:30:00.000Z",
    deckType: "tarot",
    layoutMode: "preset",
    spreadId: "custom-absent-99",
    spreadName: "已删自定义叠牌阵",
    overviewMethod: "stacked",
    cards: [{ slotIndex: 0, positionNumber: 1, positionName: "核心主轴", cardId: "major-0", orientation: "upright", layer: "major" }]
  }], { locale: "zh-CN" });
  assert.ok(customSnapPrompt.includes("**第 1 位 · 核心主轴**【叠牌组合：大牌为因 · 小牌为果】"));

  const snap = aiContext.buildReadingSnapshot(realV2Record, { locale: "zh-CN" });
  assert.equal(snap.layoutMode, "preset");
  assert.equal(snap.cards.length, 3);
  assert.equal(snap.overviewMethod, "stacked");

  // Single-card crossing overlay via built-in yes-no spread (pos 6 crosses pos 1)
  const crossingPrompt = aiContext.formatReadingsForPrompt([{
    id: "yn-1",
    createdAt: "2026-06-15T14:30:00.000Z",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "yes-no",
    cards: [
      { cardId: "major-1", positionNumber: 1, orientation: "upright" },
      { cardId: "minor-wands-2", positionNumber: 6, orientation: "upright" }
    ]
  }], { locale: "zh-CN" });
  assert.ok(crossingPrompt.includes("交叉叠放于第 1 位之上"));

  const cardSummary = aiContext.buildReadingCardSummary(snap, { locale: "zh-CN" });
  assert.equal(cardSummary.isStacked, true);
  assert.ok(cardSummary.modeBadge.includes("叠牌法"));
  assert.ok(cardSummary.cardsPreview.includes("愚者"));
  assert.equal(cardSummary.cardsPreview.length < md.length, true);

  const convTokens = aiContext.estimateConversationTokens({
    systemPrompt: "Quareia 塔罗牌意系统提示词",
    messages: [{ role: "user", content: "Hello world!" }]
  });
  assert.ok(convTokens > 10);
});
