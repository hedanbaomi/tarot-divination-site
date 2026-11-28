"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBrowserContext(extraFiles) {
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
    "js/ai-skills.js",
    "js/ai-context.js"
  ];
  if (Array.isArray(extraFiles)) {
    files.push.apply(files, extraFiles);
  }
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
      cards: [{ cardId: "major-00" }]
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
      cards: [{ cardId: "major-00", positionNumber: 1, orientation: "upright" }]
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
      { cardId: "major-00", orientation: "upright", positionNumber: 1, layer: "major" },
      { cardId: "minor-wands-ace", orientation: "upright", positionNumber: 1, layer: "minor" }
    ]
  };
  const promptText = aiContext.formatReadingsForPrompt([stackedRecord], { locale: "zh-CN" });
  assert.ok(promptText.includes("大阿卡那 · 底牌／因"));
  assert.ok(promptText.includes("小阿卡那 · 叠牌／果"));
  assert.equal(promptText.includes("仅保留牌名快照"), false);

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
    cards: [{ cardId: "major-01", positionNumber: 1, positionNameSnapshot: "快照1" }]
  }, { locale: "zh-CN", customLibrary: fakeLibrary });
  assert.equal(savedCustom.spreadFound, true);
  assert.equal(savedCustom.spreadName, "个人双星阵");
  assert.equal(savedCustom.cards[0].positionMeaning, "内在动力");
  assert.ok(savedCustom.cards[0].meaning.length > 10);

  const deletedCustom = aiContext.resolveReadingDetails({
    id: "cust-deleted",
    createdAt: 1730000005000,
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "custom-missing-999",
    spreadNameSnapshot: "已删自定义阵",
    orientationMode: "upright",
    cards: [{ cardId: "major-01", positionNumber: 1, positionNameSnapshot: "自定义位1" }]
  }, { locale: "zh-CN", customLibrary: fakeLibrary });
  assert.equal(deletedCustom.spreadFound, false);
  assert.equal(deletedCustom.spreadName, "已删自定义阵");
  assert.equal(deletedCustom.cards[0].positionName, "自定义位1");
  assert.equal(deletedCustom.cards[0].positionMeaning, "");
  assert.ok(deletedCustom.cards[0].meaning.length > 10);

  const fullSysPrompt = aiContext.buildSystemPrompt("zh-CN", promptText, "此前用户已询问第1张愚者的含义。");
  assert.ok(fullSysPrompt.includes("## 当前对话已关联的非自由画板占卜记录"));
  assert.ok(fullSysPrompt.includes("## 当前激活的内置占卜解读 Skills 协议"));
  assert.ok(fullSysPrompt.includes("## 早期对话压缩摘要（已自动浓缩保留关键脉络）"));
  assert.equal(fullSysPrompt.includes("再落到逐位解析"), false);
  assert.ok(fullSysPrompt.includes("底牌"));
  assert.ok(fullSysPrompt.includes("叠牌"));
  assert.ok(fullSysPrompt.includes("绝不拒绝、说教或强行拉回占卜"));

  const emptySysPrompt = aiContext.buildSystemPrompt("en", "");
  assert.ok(emptySysPrompt.includes("No non-freeboard reading is attached to this chat right now"));
  assert.ok(emptySysPrompt.includes("NEVER refuse, block, scold, or force-redirect benign non-divination topics"));
  assert.equal(emptySysPrompt.includes("## Active Quareia Reading Craft Skills"), false);
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
        cardId: "major-00",
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
    cards: [{ slotIndex: 0, positionNumber: 1, positionName: "核心主轴", cardId: "major-00", orientation: "upright", layer: "major" }]
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
      { cardId: "major-01", positionNumber: 1, orientation: "upright" },
      { cardId: "minor-wands-two", positionNumber: 6, orientation: "upright" }
    ]
  }], { locale: "zh-CN" });
  assert.ok(crossingPrompt.includes("交叉叠放于第 1 位之上"));
  assert.equal(crossingPrompt.includes("未匹配到完整牌义"), false);

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

test("custom spread context survives snapshot storage and backup after its definition is removed", async () => {
  const storeApi = require("../js/ai-chat-store.js");
  const record = {
    id: "custom-crossing-reading", layoutMode: "preset", deckType: "tarot",
    spreadId: "custom-crossing", orientationMode: "mixed", createdAt: 1700000000000,
    question: "What crosses the cause?",
    cards: [
      { cardId: "major-00", positionNumber: 1, orientation: "upright" },
      { cardId: "major-01", positionNumber: 2, orientation: "reversed" }
    ]
  };
  const definition = {
    id: record.spreadId, name: "自定义交叉阵", description: "因与影响", source: "个人牌阵",
    positions: [
      { number: 1, name: "原因", meaning: "当前的内因" },
      { number: 2, name: "影响", meaning: "外来的影响", stackOn: 1 }
    ]
  };
  const present = { locale: "zh-CN", customLibrary: { getById: () => definition } };
  const missing = { locale: "zh-CN", customLibrary: { getById: () => null } };
  const before = aiContext.resolveReadingDetails(record, present);
  assert.ok(before.cards[0].meaning.length > 10);
  assert.ok(before.cards[1].meaning.length > 10);
  const snapshot = aiContext.buildReadingSnapshot(record, present);
  const store = storeApi.createStore({ indexedDB: null, memoryFallback: true });
  await store.createConversation({ id: "saved", readingIds: [record.id], readingSnapshots: [snapshot] });
  const backup = await store.exportBackup();
  const restored = storeApi.createStore({ indexedDB: null, memoryFallback: true });
  await restored.importBackup(JSON.stringify(backup));
  const saved = (await restored.getConversation("saved")).readingSnapshots[0];
  const after = aiContext.resolveReadingDetails(saved, missing);
  assert.equal(after.spreadFound, false);
  for (const key of ["spreadName", "spreadDescription", "spreadSource"]) assert.equal(after[key], before[key]);
  for (let i = 0; i < 2; i++) {
    assert.ok(after.cards[i].meaning.length > 10);
    for (const key of ["positionName", "positionMeaning", "stackOn", "orientation", "meaning"]) {
      assert.equal(after.cards[i][key], before.cards[i][key], key);
    }
  }
  const prompt = aiContext.formatReadingsForPrompt([saved], missing);
  assert.ok(prompt.includes("当前的内因") && prompt.includes("外来的影响"));
  assert.ok(prompt.includes("交叉叠放于第 1 位之上"));
  assert.equal(prompt.includes("未匹配到完整牌义"), false);
  // Old backup files remain readable without invented missing semantics.
  const legacy = JSON.parse(JSON.stringify(snapshot));
  delete legacy.spreadDescription; delete legacy.spreadSource;
  legacy.cards.forEach(c => { delete c.positionMeaning; delete c.stackOn; });
  const legacyDetails = aiContext.resolveReadingDetails(legacy, missing);
  assert.equal(legacyDetails.cards[1].stackOn, null);
  assert.equal(legacyDetails.cards[0].positionMeaning, "");
});

test("null/empty slotIndex values never coerce to 0, and unknown card IDs degrade gracefully to snapshot names", () => {
  const nullSlotRecord = {
    id: "slot-null-test",
    createdAt: 1730000010000,
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "three-card-horizontal",
    orientationMode: "upright",
    cards: [
      { cardId: "major-00", slotIndex: 0, orientation: "upright" },
      { cardId: "major-01", slotIndex: null, orientation: "upright" },
      { cardId: "custom-unknown-id", cardNameSnapshot: "自定义秘牌", slotIndex: "", positionNumber: 3, orientation: "upright" }
    ]
  };

  const resolved = aiContext.resolveReadingDetails(nullSlotRecord, { locale: "zh-CN" });
  assert.equal(resolved.cards[0].slotIndex, 0);
  assert.equal(resolved.cards[0].positionNumber, 1);
  // Card at array index 1 with slotIndex: null and no positionNumber must resolve to spread.positions[1] (number 2), not positions[0]
  assert.equal(resolved.cards[1].positionNumber, 2);
  assert.equal(resolved.cards[1].slotIndex, 1);
  // Card with slotIndex: "" and positionNumber: 3 must compute slotIndex 2, not 0
  assert.equal(resolved.cards[2].positionNumber, 3);
  assert.equal(resolved.cards[2].slotIndex, 2);
  assert.equal(resolved.cards[2].cardName, "自定义秘牌");
  assert.equal(resolved.cards[2].meaning, "");

  const snap = aiContext.buildReadingSnapshot(nullSlotRecord, { locale: "zh-CN" });
  assert.deepEqual(snap.cards.map((c) => c.slotIndex), [0, 1, 2]);
});

test("formatReadingsForPrompt and buildSystemPrompt compile distilled cues, strip artifacts, and route skills", () => {
  const lxxxiNoQuestion = {
    id: "lxxxi-clean-1",
    createdAt: 1730000020000,
    layoutMode: "preset",
    deckType: "lxxxi",
    spreadId: "lxxxi-occult-map",
    orientationMode: "upright",
    cards: [
      { cardId: "lxxxi-09", positionNumber: 1, orientation: "upright" },
      { cardId: "lxxxi-34", positionNumber: 5, orientation: "upright" }
    ]
  };

  const zhMd = aiContext.formatReadingsForPrompt([lxxxiNoQuestion], { locale: "zh-CN" });
  assert.equal(zhMd.includes("(cid:1)"), false, "Must strip LXXXI PDF (cid:1) artifact");
  assert.ok(zhMd.includes("未记录具体问题"), "Must flag missing question explicitly");
  assert.ok(zhMd.includes("盘面首印气势与拓扑电路"), "Must inject pre-computed gestalt summary");
  assert.ok(zhMd.includes("本阵解牌动线"), "Must inject spread topology reading circuit");
  assert.ok(zhMd.includes("内部意象底稿"), "Must frame cues as internal scratchpad rather than script to recite");

  const enTarot = {
    id: "tarot-en-clean",
    createdAt: 1730000021000,
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "manifestation-cause",
    question: "Why did our server deployment fail?",
    orientationMode: "mixed",
    cards: [
      { cardId: "minor-swords-five", positionNumber: 1, orientation: "reversed" },
      { cardId: "minor-cups-three", positionNumber: 2, orientation: "upright" }
    ]
  };
  const enMd = aiContext.formatReadingsForPrompt([enTarot], { locale: "en" });
  assert.equal(enMd.includes("Read this as the active pattern shaping the situation"), false, "Must strip repetitive English upright boilerplate");
  assert.equal(enMd.includes("Pause, check the facts, and reopen blocked communication"), false, "Must strip repetitive English reversed boilerplate");
  assert.ok(enMd.includes("Reversal Vector"), "Must compile concise reversal vector cue");
  assert.equal(/rule out|unrecommended|直接排除/i.test(enMd), false, "Must not stamp static exclusion Filter Rule onto non-zero cards");

  const modes = aiContext.getSkillModes();
  assert.deepEqual(modes.map((m) => m.id), ["auto"]);
  assert.equal(modes[0].labelZh, "奥莉薇娅");

  const previewFollowUp = aiContext.previewActiveSkills({
    locale: "zh-CN",
    records: [enTarot],
    skillMode: "action",
    hasUninterpretedReading: false,
    messages: [
      { role: "user", content: "先看整体原因" },
      { role: "assistant", content: "核心卡在沟通断层。" },
      { role: "user", content: "那接下来一周我具体该怎么补救？" }
    ]
  });
  assert.equal(previewFollowUp.skillMode, "auto");
  assert.equal(previewFollowUp.isFollowUp, true);
  assert.equal(previewFollowUp.activeSkills.some((s) => s.id === "skill-mode-action"), false);
  assert.ok(previewFollowUp.activeSkills.some((s) => s.id === "skill-followup-drilldown"));

  // When hasUninterpretedReading is true (e.g., reading attached after prior casual turn, or 2nd spread newly attached), isFollowUp must stay false
  const previewNewSpreadAfterChat = aiContext.previewActiveSkills({
    locale: "zh-CN",
    records: [enTarot],
    skillMode: "auto",
    hasUninterpretedReading: true,
    messages: [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！可以随时发问题或挂盘。" },
      { role: "user", content: "帮我看看刚挂上来的这副牌" }
    ]
  });
  assert.equal(previewNewSpreadAfterChat.isFollowUp, false, "hasUninterpretedReading=true must suppress premature follow-up mode");
  assert.equal(previewNewSpreadAfterChat.activeSkills.some((s) => s.id === "skill-followup-drilldown"), false);

  const sysActionPrompt = aiContext.buildSystemPrompt("zh-CN", zhMd, "", {
    records: [enTarot],
    skillMode: "action",
    messages: [
      { role: "user", content: "先看整体原因" },
      { role: "assistant", content: "核心卡在沟通断层。" },
      { role: "user", content: "那接下来一周我具体该怎么补救？" }
    ]
  });
  assert.ok(sysActionPrompt.includes("奥莉薇娅"));
  assert.equal(sysActionPrompt.includes("现实处方"), false, "Legacy action mode must not leak into the prompt");
  assert.ok(sysActionPrompt.includes("开窗深挖"));
  assert.ok(sysActionPrompt.includes("自然、精准地使用牌位名、牌名及关键概念词"));
  assert.equal(sysActionPrompt.includes("- 本阵解牌动线："), false, "buildSystemPrompt must deduplicate per-reading circuit hint when skill-spread-topology is active");

  const sysThreeArgLxxxi = aiContext.buildSystemPrompt("zh-CN", zhMd, "");
  assert.equal(sysThreeArgLxxxi.includes("- 本阵解牌动线："), false, "3-arg buildSystemPrompt must also strip duplicate circuit hint");
  assert.ok(sysThreeArgLxxxi.includes("【本阵解牌拓扑动线】"), "Spread topology circuitry remains present once in active skills block");

  // 18-card English Mystagogus reading must deduplicate identical keyword-only echoes while preserving enriched fact atoms (e.g., surgery / not yet)
  const myst18Cards = [];
  for (let pos = 1; pos <= 18; pos += 1) {
    const pad = String(pos).padStart(2, "0");
    myst18Cards.push({ cardId: "m-" + pad, positionNumber: pos, orientation: "upright" });
  }
  myst18Cards[2] = { cardId: "m-59", positionNumber: 3, orientation: "upright" }; // Choppers (surgery)
  myst18Cards[5] = { cardId: "m-35", positionNumber: 6, orientation: "upright" }; // West Gate (probably not)
  myst18Cards[9] = { cardId: "m-41", positionNumber: 10, orientation: "upright" }; // Sanctuary (not yet)

  const myst18Rec = {
    id: "myst-18-en",
    createdAt: 1730000022000,
    layoutMode: "preset",
    deckType: "mystagogus",
    spreadId: "mystagogus-layout",
    question: "What pattern is unfolding in my studio this year?",
    orientationMode: "upright",
    cards: myst18Cards
  };
  const myst18Md = aiContext.formatReadingsForPrompt([myst18Rec], { locale: "en", omitCircuitHint: true });
  assert.equal(myst18Md.includes("Reading Circuitry:"), false);
  assert.match(myst18Md, /surgery/i, "Enriched English Mystagogus fact atom 'surgery' on m-59 must never be dropped by splitAndDedupeCue");
  assert.match(myst18Md, /not yet/i, "Enriched English Mystagogus timing atom 'not yet' on m-41 must never be dropped by splitAndDedupeCue");
  const myst18Sys = aiContext.buildSystemPrompt("en", myst18Md, "", {
    locale: "en",
    records: [myst18Rec],
    messages: [{ role: "user", content: "Interpret this spread." }]
  });
  assert.ok(myst18Sys.includes("naturally use accurate position names, card names, and concrete domain/polarity concepts"));
});

test("personaLevel shrinks the persona so a small context window keeps recent turns", () => {
  const personaEnv = loadBrowserContext(["js/ai-persona.js"]);
  const personaContext = personaEnv.DivinationAiContext;
  assert.ok(personaEnv.DivinationPersona, "test env must load the persona pack");
  const zhMd = personaContext.formatReadingsForPrompt([], { locale: "zh-CN" });
  const fullZh = personaContext.buildSystemPrompt("zh-CN", zhMd, "", { locale: "zh-CN" });
  const compactZh = personaContext.buildSystemPrompt("zh-CN", zhMd, "", { locale: "zh-CN", personaLevel: "compact" });
  const noneZh = personaContext.buildSystemPrompt("zh-CN", zhMd, "", { locale: "zh-CN", personaLevel: "none" });

  assert.ok(fullZh.includes("奥莉薇娅"), "full zh prompt keeps the persona");
  assert.ok(fullZh.includes("Mystagogus"), "full zh prompt lets the deck decide meanings");
  assert.equal(fullZh.includes("合规的抽牌方式"), false, "persona no longer teaches client-reported numbers as a draw method");
  assert.equal(fullZh.includes("数字奇偶"), false, "persona no longer derives reversals from parity");

  assert.ok(compactZh.length * 2 < fullZh.length, "compact persona is much shorter than the full pack");
  assert.ok(compactZh.includes("奥莉薇娅"), "compact persona still carries identity");
  assert.ok(compactZh.includes("牌组"), "compact persona still says the deck decides meanings");
  assert.equal(compactZh.includes("合规的抽牌方式"), false, "compact persona drops the client-reports-numbers draw path");
  assert.equal(compactZh.includes("## 抽牌"), false, "compact persona is not the full pack");

  assert.ok(noneZh.length < compactZh.length, "no persona is the smallest level");
  assert.equal(noneZh.includes("## 三层模型"), false, "none level drops the persona entirely");
  assert.equal(noneZh.includes("最上方人格设定为准"), false, "none level drops the dangling persona pointer");

  const fullEn = personaContext.buildSystemPrompt("en", "", "", { locale: "en" });
  const compactEn = personaContext.buildSystemPrompt("en", "", "", { locale: "en", personaLevel: "compact" });
  const noneEn = personaContext.buildSystemPrompt("en", "", "", { locale: "en", personaLevel: "none" });
  assert.ok(compactEn.length * 2 < fullEn.length, "compact en persona is much shorter than the full pack");
  assert.ok(compactEn.includes("Olivia"));
  assert.ok(fullEn.includes("Mystagogus") || fullEn.includes("LXXXI"), "full en prompt lets the deck decide meanings");
  assert.equal(compactEn.includes("## The app deals the cards"), false, "compact en persona drops the full pack's draw section");
  assert.equal(noneEn.includes("## Three layers"), false, "none en level drops the persona entirely");
  assert.ok(
    aiContext.estimateConversationTokens({ systemPrompt: compactEn, messages: [] })
      < aiContext.estimateConversationTokens({ systemPrompt: fullEn, messages: [] }),
    "compact prompt estimates fewer tokens"
  );
});

test("personal notes are opt-in, scoped by deck and position, bounded, and absent from snapshots", () => {
  const map = new Map();
  const records = ["tarot", "mystagogus", "lxxxi"].map(deckType => ({
    id: deckType, layoutMode: "preset", deckType, spreadId: "custom-notes", createdAt: 1234,
    cards: [{ cardId: "shared-id", positionNumber: 1 }, { cardId: "unmatched", positionNumber: 2 }]
  }));
  for (const record of records) map.set(record.deckType + ":shared-id", record.deckType + " note " + "🌙".repeat(700));
  map.set("tarot:unattached", "unattached private text");
  for (const record of records) {
    const off = { locale: "en", cardNotesMap: map };
    const on = { ...off, includeCardNotes: true };
    const plain = aiContext.formatReadingsForPrompt([record], off);
    const optedIn = aiContext.formatReadingsForPrompt([record], on);
    const details = aiContext.resolveReadingDetails(record, on);
    assert.equal(aiContext.resolveReadingDetails(record, off).cards[0].personalNote, undefined);
    assert.equal(details.cards[1].personalNote, undefined);
    const note = details.cards[0].personalNote;
    assert.equal([...note].length, 600);
    assert.ok(note.startsWith(record.deckType + " note ") && note.endsWith("🌙…"));
    assert.ok(optedIn.includes(JSON.stringify(note)));
    assert.match(optedIn, /subjective, not official source text/);
    assert.doesNotMatch(optedIn, /unattached private text/);
    assert.doesNotMatch(plain, /personal card note|🌙/i);
    const inherited = { ...off, includeCardNotes: false, resolvedReadings: [details] };
    assert.equal(aiContext.formatReadingsForPrompt([record], inherited), plain);
    assert.deepEqual(aiContext.buildReadingSnapshot(record, on), aiContext.buildReadingSnapshot(record, off));
    const cost = text => aiContext.estimateConversationTokens({ systemPrompt: text, messages: [] });
    assert.ok(cost(optedIn) > cost(plain));
  }
  const missingDeck = { ...records[0], deckType: "" };
  assert.doesNotMatch(aiContext.formatReadingsForPrompt([missingDeck], {
    locale: "en", includeCardNotes: true, cardNotesMap: map
  }), /personal card note|🌙/i);
  const stacked = { ...records[0], overviewMethod: "stacked" };
  const stackedMd = aiContext.formatReadingsForPrompt([stacked], {locale: "en", includeCardNotes: true, cardNotesMap: map});
  assert.equal(stackedMd.match(/Personal card note/g).length, 1);
  assert.match(stackedMd, /tarot note/);
  assert.equal(aiContext.truncateCardNote("🌙".repeat(600)), "🌙".repeat(600));
  const zh = aiContext.formatReadingsForPrompt([records[0]], {locale:"zh-CN", includeCardNotes:true, cardNotesMap:map});
  assert.match(zh, /用户个人卡牌笔记（主观笔记，非官方教材原文）/);
});

test("reading distinct card notes ignores unavailable storage and mismatched return keys", async () => {
  const { readAttachedCardNotes } = require("../js/ai-ui.js");
  const records = [{ deckType: "tarot", cards: ["a", "a", "b", "c"].map(cardId => ({ cardId })) }];
  const requested = [];
  const fake = { get: async (deckType, cardId) => {
    requested.push([deckType, cardId]);
    if (cardId === "c") throw new Error("IndexedDB unavailable");
    return { deckType: cardId === "b" ? "lxxxi" : deckType, cardId, text: "local fixture" };
  }};
  const read = store => readAttachedCardNotes(store, records, aiContext.truncateCardNote);
  assert.deepEqual([...await read(null)], []);
  assert.deepEqual([...await read(fake)], [["tarot:a", "local fixture"]]);
  assert.equal(requested.length, 3);
  const unavailable = require("../js/card-notes-store.js").createStore({ indexedDB: null, readOnly: true, isKnownCard: () => true });
  assert.deepEqual(Object.keys(unavailable), ["get"]);
  assert.deepEqual([...await read(unavailable)], []);
  assert.deepEqual([...await read({ get: () => new Promise(() => {}) })], []);
});
