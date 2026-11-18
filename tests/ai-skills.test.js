"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDivinationEnvironment() {
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
    RegExp,
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
  for (const rel of files) {
    const code = fs.readFileSync(path.join(rootDir, rel), "utf8");
    vm.runInContext(code, context, { filename: rel });
  }
  return context;
}

const env = loadDivinationEnvironment();
const aiSkills = env.DivinationAiSkills;
const aiContext = env.DivinationAiContext;

test("SKILL_MODES exposes the single built-in persona; legacy modes normalize to auto", () => {
  assert.equal(Array.isArray(aiSkills.SKILL_MODES), true);
  assert.deepEqual(
    aiSkills.SKILL_MODES.map((m) => m.id),
    ["auto"]
  );
  for (const mode of aiSkills.SKILL_MODES) {
    assert.ok(mode.labelZh && mode.labelEn && mode.descZh && mode.descEn);
  }

  assert.equal(aiSkills.normalizeSkillMode("auto"), "auto");
  assert.equal(aiSkills.normalizeSkillMode(" DIRECT "), "auto");
  assert.equal(aiSkills.normalizeSkillMode("Deep"), "auto");
  assert.equal(aiSkills.normalizeSkillMode("action"), "auto");
  assert.equal(aiSkills.normalizeSkillMode("invalid-mode"), "auto");
  assert.equal(aiSkills.normalizeSkillMode(null), "auto");
  assert.equal(aiSkills.normalizeSkillMode({}), "auto");
});

test("health circuitry never asserts prevention or dismisses isolated skin findings", () => {
  for (const locale of ["zh-CN", "en"]) {
    const prompt = aiSkills.routeSkills({
      locale,
      resolvedReadings: [{ spreadId: "health", deckType: "tarot", cards: [{ cardId: "major-00", positionNumber: 2 }] }]
    }).promptBlock;
    assert.doesNotMatch(prompt, /及时调养即可阻断|blocks physical onset|仅作表浅排毒|treating isolated \[14 Skin\] as minor/i);
    assert.doesNotMatch(prompt, /clinical care|medical disclaimer|medical boundary|诊疗|临床就医|健康边界护栏|不要由牌面断定|Do not infer whether a disease/i);
    assert.match(prompt, locale === "en" ? /1 Forming.*2 Not Yet Manifest.*14 Skin.*15 Near Future/ : /1正在形成.*2尚未显现.*14皮肤.*15近期未来/);
  }
});

test("incomplete oracle identities cannot claim complete realm or signal coverage", () => {
  for (const locale of ["zh-CN", "en"]) {
    const inspect = (deckType, cards) => aiSkills.analyzeReadingGestalt({ spreadId: "custom-example", deckType, cards }, locale).summaryLines.join("\n");
    const unknown = [{ cardId: "unknown", positionNumber: 1 }];
    const lMissing = inspect("lxxxi", unknown);
    assert.doesNotMatch(lMissing, /Four-Realm distribution|四领域分布/);
    assert.match(lMissing, locale === "en" ? /1.*unknown/i : /1.*未知/);
    const lMixed = inspect("lxxxi", [{ cardId: "lxxxi-01", cardName: "Star Father" }, ...unknown]);
    assert.match(lMixed, locale === "en" ? /1.*unknown/i : /1.*未知/);
    assert.match(lMixed, /Star Father/);
    const mMissing = inspect("mystagogus", unknown);
    assert.doesNotMatch(mMissing, /no hard red-light|未触发极端封堵红灯/);
    assert.match(mMissing, locale === "en" ? /1.*unknown/i : /1.*未知/);
    const mMixed = inspect("mystagogus", [{ cardId: "m-22", cardName: "Dead End", positionNumber: 2 }, ...unknown]);
    assert.match(mMixed, /Dead End/);
    assert.match(mMixed, locale === "en" ? /1.*unknown/i : /1.*未知/);
    const mKnown = inspect("mystagogus", [{ cardId: "m-01" }]);
    assert.match(mKnown, locale === "en" ? /no hard red-light/i : /未触发极端封堵红灯/);
  }
});

test("nonstandard tarot identities use reliable suit or layer metadata", () => {
  assert.equal(aiSkills.parseCardIdentity({ cardId: "legacy-wands", suit: "权杖" }, "tarot").arcana, "minor");
  assert.equal(aiSkills.parseCardIdentity({ cardId: "legacy-major", layer: "major" }, "tarot").arcana, "major");
  assert.equal(aiSkills.parseCardIdentity({ cardId: "legacy-minor", layer: "minor" }, "tarot").arcana, "minor");
  assert.equal(aiSkills.parseCardIdentity({ cardId: "conflict", layer: "major", suit: "wands" }, "tarot").arcana, "");
});

test("LXXXI 38 does not promise a guaranteed outcome", () => {
  const cue = aiSkills.compileCardCue({ cardId: "lxxxi-38", meaning: "这张牌" }, { locale: "zh-CN", deckType: "lxxxi" }).coreCue;
  assert.doesNotMatch(cue, /原典保证|保证结局/);
  assert.match(cue, /考验|逆境/);
});

test("follow-ups do not invent an outcome slot for resource or custom spreads", () => {
  for (const locale of ["zh-CN", "en"]) {
    for (const spreadId of ["resources", "custom-example"]) {
      const result = aiSkills.routeSkills({
        locale,
        resolvedReadings: [{ spreadId, deckType: "tarot", cards: [{ cardId: "major-01", positionNumber: 1 }] }],
        messages: [{ role: "user", content: "请解读" }, { role: "assistant", content: "已解读" }, { role: "user", content: "怎么解决？" }]
      });
      assert.equal(result.isFollowUp, true);
      assert.doesNotMatch(result.promptBlock, /总出口|overall outcome hub|final outcome hubs|anchored to the global outcome|spread's overall outcome/i);
    }
  }
});

test("custom spread circuitry does not invent anchor and outcome roles", () => {
  const reading = {
    spreadId: "custom-example", deckType: "tarot",
    cards: [
      { cardId: "major-01", positionNumber: 1, positionName: "Advice / 建议" },
      { cardId: "major-02", positionNumber: 2, positionName: "Obstacles / 障碍" }
    ]
  };
  for (const locale of ["zh-CN", "en"]) {
    const result = aiSkills.routeSkills({ locale, resolvedReadings: [reading] });
    assert.doesNotMatch(result.promptBlock, /第1位核心锚点|末位结果出口|Pos 1 \(anchor\)|final outcome slot/i);
    assert.match(result.promptBlock, locale === "en" ? /position roles/i : /牌位职能/);
  }
});

test("unknown tarot identities do not produce invented arcana or suit statistics", () => {
  const unknown = Array.from({ length: 4 }, (_, i) => ({ cardId: `unknown-${i}`, positionNumber: i + 1 }));
  for (const locale of ["zh-CN", "en"]) {
    const inspect = cards => aiSkills.analyzeReadingGestalt({ spreadId: "custom-example", deckType: "tarot", cards }, locale).summaryLines.join("\n");
    const missing = inspect(unknown);
    assert.doesNotMatch(missing, /All Minor Arcana|全盘皆为小阿卡那|Elemental distribution|花色与四元素分布/i);
    assert.match(missing, locale === "en" ? /4.*unknown/i : /4.*未知/);

    const mixed = inspect([{ cardId: "major-01", positionNumber: 1 }, ...unknown.slice(0, 3)]);
    assert.doesNotMatch(mixed, /High Major Arcana density|大阿卡那密度偏高|All Minor Arcana|全盘皆为小阿卡那/i);
    assert.match(mixed, locale === "en" ? /1 Major.*0 Minor.*3.*unknown/i : /1 张大阿卡那.*0 张小阿卡那.*3.*未知/);

    const partialSuit = inspect([
      ...Array.from({ length: 4 }, (_, i) => ({ cardId: `minor-wands-${["ace", "two", "three", "four"][i]}` })),
      { cardId: "unknown-minor", arcana: "minor" }
    ]);
    assert.doesNotMatch(partialSuit, /absent:|缺席元素|dominant climate|元素主导/i);

    const known = inspect([
      { cardId: "major-01" }, { cardId: "major-02" }, { cardId: "minor-wands-ace" }
    ]);
    assert.match(known, locale === "en" ? /High Major Arcana density \(2\/3\)/ : /大阿卡那密度偏高（2\/3）/);

    const knownSuits = inspect(["ace", "two", "three", "four"].map(rank => ({ cardId: `minor-wands-${rank}` })));
    assert.match(knownSuits, locale === "en" ? /Wands\(Fire\):4/ : /权杖\(火\)×4/);
  }
});

test("compileCardCue strips PDF artifacts, translator notes, and repetitive EN boilerplate while preserving Quareia anchors", () => {
  // 1. LXXXI card with (cid:1) artifact in raw data (lxxxi-09)
  const lxxxiResolvedZh = aiContext.resolveReadingDetails({
    id: "cue-lxxxi-zh",
    layoutMode: "preset",
    deckType: "lxxxi",
    spreadId: "lxxxi-four-directions",
    cards: [
      { cardId: "lxxxi-09", positionNumber: 1 },
      { cardId: "lxxxi-79", positionNumber: 2 }
    ]
  }, { locale: "zh-CN" });

  const cue09Zh = aiSkills.compileCardCue(lxxxiResolvedZh.cards[0], {
    locale: "zh-CN",
    deckType: "lxxxi",
    orientationMode: "upright"
  });
  assert.equal(cue09Zh.coreCue.includes("(cid:1)"), false, "Must remove (cid:1) artifact");
  assert.equal(cue09Zh.coreCue.includes("译注"), false, "Must strip translator notes");
  assert.equal(cue09Zh.coreCue.includes("在占卜中"), false, "Must strip textbook meta-prefix");
  assert.ok(cue09Zh.coreCue.length > 8 && cue09Zh.coreCue.length <= 220);

  // Verify LXXXI keywordsClean uses curated compact anchors without raw manual fragments or OCR typos
  const lxxxiKwCheck = aiContext.resolveReadingDetails({
    id: "cue-lxxxi-kw",
    layoutMode: "preset",
    deckType: "lxxxi",
    spreadId: "lxxxi-occult-map",
    cards: [
      { cardId: "lxxxi-17", positionNumber: 1 },
      { cardId: "lxxxi-23", positionNumber: 2 },
      { cardId: "lxxxi-34", positionNumber: 3 },
      { cardId: "lxxxi-37", positionNumber: 4 },
      { cardId: "lxxxi-44", positionNumber: 5 }
    ]
  }, { locale: "zh-CN" });
  const badLxxxiFragments = ["依字面表示", "无论轮子", "上下牌的脉络", "继承的系动", "倾听你的内心"];
  for (const card of lxxxiKwCheck.cards) {
    const cCue = aiSkills.compileCardCue(card, { locale: "zh-CN", deckType: "lxxxi" });
    const joinedKw = cCue.keywordsClean.join("、");
    for (const bad of badLxxxiFragments) {
      assert.equal(joinedKw.includes(bad), false, `${card.cardId} keywordsClean leaked manual fragment: ${bad}`);
    }
  }

  // Verify Chinese Tarot minor reversed uprightAnchor preserves upright keywords and never leaks reversed keywords
  const zhMinorRev = aiContext.resolveReadingDetails({
    id: "cue-zh-minor-rev",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "yes-no",
    orientationMode: "mixed",
    cards: [
      { cardId: "minor-swords-eight", positionNumber: 1, orientation: "reversed" },
      { cardId: "minor-pentacles-four", positionNumber: 2, orientation: "upright" }
    ]
  }, { locale: "zh-CN" });
  const swords8RevCue = aiSkills.compileCardCue(zhMinorRev.cards[0], {
    locale: "zh-CN",
    deckType: "tarot",
    orientationMode: "mixed"
  });
  assert.ok(swords8RevCue.uprightAnchor.includes("被困"), "Eight of Swords reversed uprightAnchor must retain upright core '被困'");
  const noRefRevCue = aiSkills.compileCardCue({
    cardId: "minor-swords-eight",
    cardName: "宝剑八",
    orientation: "reversed",
    keywords: ["自我松绑", "走出困局"],
    meaning: "逐渐走出束缚",
    uprightMeaningRef: "",
    uprightKeywordsRef: []
  }, { locale: "zh-CN", deckType: "tarot", orientationMode: "mixed" });
  assert.equal(noRefRevCue.uprightAnchor.includes("自我松绑"), false, "uprightAnchor must never fall back to reversed keywords");

  const pent4UpCue = aiSkills.compileCardCue(zhMinorRev.cards[1], {
    locale: "zh-CN",
    deckType: "tarot",
    orientationMode: "mixed"
  });
  assert.equal(/\]\s*持有。$/.test(pent4UpCue.coreCue), false, "Chinese minor upright coreCue must not degenerate to 2-char stub with trailing period");

  // 2. English Tarot minor reversed card with repetitive template shell in i18n-data-en.js
  const tarotResolvedEn = aiContext.resolveReadingDetails({
    id: "cue-tarot-en",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "solution",
    orientationMode: "mixed",
    cards: [
      { cardId: "major-00", positionNumber: 1, orientation: "upright" },
      { cardId: "minor-swords-five", positionNumber: 2, orientation: "reversed" }
    ]
  }, { locale: "en" });

  const foolCueEn = aiSkills.compileCardCue(tarotResolvedEn.cards[0], {
    locale: "en",
    deckType: "tarot",
    orientationMode: "mixed",
    spreadId: "direction",
    isFilterSpread: true
  });
  assert.equal(foolCueEn.coreCue.includes("Read this as the active pattern shaping the situation"), false);
  assert.ok(foolCueEn.filterSlotHint.length > 5, "Zero-point Fool on direction filter spread retains objective zero-point hint");

  // Non-zero cards on manifestation-cause / solution must NEVER be statically marked as excluded
  const justiceCauseCue = aiSkills.compileCardCue({
    cardId: "major-11",
    cardName: "正义",
    positionNumber: 10,
    positionName: "正义的天秤",
    orientation: "upright",
    keywords: ["法律", "因果"],
    meaning: "法律与天秤裁决"
  }, { locale: "zh-CN", deckType: "tarot", spreadId: "manifestation-cause", isFilterSpread: true });
  assert.equal(justiceCauseCue.filterSlotHint, "", "Justice in Scales of Justice must never receive static exclusion hint");

  const swordsAceCauseCue = aiSkills.compileCardCue({
    cardId: "minor-swords-ace",
    cardName: "宝剑王牌",
    positionNumber: 10,
    positionName: "正义的天秤",
    orientation: "upright",
    keywords: ["法律", "冲突"],
    meaning: "法律冲突与开端"
  }, { locale: "zh-CN", deckType: "tarot", spreadId: "manifestation-cause", isFilterSpread: true });
  assert.equal(swordsAceCauseCue.filterSlotHint, "", "Ace of Swords in Scales of Justice must never receive static exclusion hint");

  for (const solCard of [
    { cardId: "minor-swords-four", deckType: "tarot", cardName: "宝剑四", positionNumber: 2, positionName: "被动／顺其自然", keywords: ["休养"], meaning: "退守休养" },
    { cardId: "m-59", deckType: "mystagogus", cardName: "砍伐者", positionNumber: 6, positionName: "承担责任", keywords: ["切割"], meaning: "果断切割" },
    { cardId: "lxxxi-54", deckType: "lxxxi", cardName: "执行官", positionNumber: 10, positionName: "偿还", keywords: ["清偿"], meaning: "清偿债务" }
  ]) {
    const solCue = aiSkills.compileCardCue(solCard, { locale: "zh-CN", deckType: solCard.deckType, spreadId: "solution", isFilterSpread: true });
    assert.equal(solCue.filterSlotHint, "", `${solCard.cardId} in solution spread must not be statically excluded`);
  }

  const revMinorCueEn = aiSkills.compileCardCue(tarotResolvedEn.cards[1], {
    locale: "en",
    deckType: "tarot",
    orientationMode: "mixed",
    spreadId: "solution",
    isFilterSpread: true
  });
  assert.equal(revMinorCueEn.reversalVector.includes("Pause, check the facts"), false, "Must strip repetitive reversed boilerplate");
  assert.ok(revMinorCueEn.uprightAnchor.length > 0, "Reversed Tarot card must retain concise Quareia upright core anchor");
  assert.ok(revMinorCueEn.reversalVector.length > 0, "Reversed Tarot card must compile concise reversal vector");

  // 3. Snapshot-only fallback when raw meaning/keywords are empty
  const snapFallbackCue = aiSkills.compileCardCue({
    cardId: "minor-pentacles-ten",
    cardName: "星币十",
    orientation: "upright",
    keywords: "",
    meaning: ""
  }, { locale: "zh-CN", deckType: "tarot" });
  assert.ok(snapFallbackCue.coreCue.length > 4, "Snapshot-only cardId should still derive structural/elemental cue");
});

test("analyzeReadingGestalt covers all 21 preset spreads, elemental/realm statistics, and displacement circuits", () => {
  const allPresetSpreads = [
    ...(env.tarotSpreads || []).map((s) => ({ spread: s, deckType: "tarot" })),
    ...(env.mystagogusSpreads || []).map((s) => ({ spread: s, deckType: "mystagogus" })),
    ...(env.lxxxiSpreads || []).map((s) => ({ spread: s, deckType: "lxxxi" }))
  ];
  assert.equal(allPresetSpreads.length, 21, "Workspace must define 21 preset spreads across 3 decks");

  const validFamilies = new Set([
    "axial-triad",
    "matrix-orbits",
    "balance-ledger",
    "signal-filter",
    "body-circuit",
    "sacred-map"
  ]);

  for (const { spread, deckType } of allPresetSpreads) {
    const sampleCardId = deckType === "lxxxi" ? "lxxxi-01" : deckType === "mystagogus" ? "m-01" : "major-00";
    const resolved = aiContext.resolveReadingDetails({
      id: "check-" + spread.id,
      layoutMode: "preset",
      deckType,
      spreadId: spread.id,
      cards: [{ cardId: sampleCardId, positionNumber: 1, orientation: "upright" }]
    }, { locale: "zh-CN" });
    const gestalt = aiSkills.analyzeReadingGestalt(resolved, "zh-CN");
    assert.ok(validFamilies.has(gestalt.topologyFamily), `Unexpected topologyFamily ${gestalt.topologyFamily} for ${spread.id}`);
    assert.ok(gestalt.readingCircuitHint.length > 10, `Missing readingCircuitHint for ${spread.id}`);
  }

  // Filter spread flag verification
  for (const filterId of ["manifestation-cause", "solution", "direction", "timing"]) {
    const meta = aiSkills.getSpreadTopologyMeta(filterId, null, false);
    assert.equal(meta.isFilterSpread, true, `${filterId} must set isFilterSpread=true`);
    assert.equal(meta.topologyFamily, "signal-filter");
  }

  // Custom spread falls back to custom-grid
  const customGestalt = aiSkills.analyzeReadingGestalt({
    spreadId: "custom-user-grid",
    deckType: "tarot",
    spreadColumns: 3,
    spreadRows: 2,
    cards: [
      { cardId: "major-00", positionNumber: 1, orientation: "upright" },
      { cardId: "major-16", positionNumber: 2, orientation: "upright" },
      { cardId: "major-19", positionNumber: 3, orientation: "upright" }
    ]
  }, "zh-CN");
  assert.equal(customGestalt.topologyFamily, "custom-grid");
  assert.ok(customGestalt.summaryLines.length > 0);

  // LXXXI Position-Card Displacement detection:
  // lxxxi-34 ("梦境之河" / River of Dreams) belongs natively to Position 15 of lxxxi-occult-map; place it in Position 1.
  const lxxxiDisplaced = aiContext.resolveReadingDetails({
    id: "lxxxi-disp-test",
    layoutMode: "preset",
    deckType: "lxxxi",
    spreadId: "lxxxi-occult-map",
    cards: [
      { cardId: "lxxxi-34", positionNumber: 1 },
      { cardId: "lxxxi-01", positionNumber: 15 }
    ]
  }, { locale: "zh-CN" });
  const lxxxiGestalt = aiSkills.analyzeReadingGestalt(lxxxiDisplaced, "zh-CN");
  assert.ok(lxxxiGestalt.displacements.length >= 1, "Must detect displaced LXXXI position-named card");
  assert.equal(lxxxiGestalt.displacements[0].landedPositionNumber, 1);
  assert.equal(lxxxiGestalt.displacements[0].homePositionNumber, 15);

  // Mystagogus Position-Card Displacement + traffic-light road-sign detection:
  // m-69 ("解开者" / Unraveller) belongs natively to Position 3 ("解开" / Unravelling) of mystagogus-layout; place it in Position 1 alongside m-78 (Dead End).
  const mystDisplaced = aiContext.resolveReadingDetails({
    id: "myst-disp-test",
    layoutMode: "preset",
    deckType: "mystagogus",
    spreadId: "mystagogus-layout",
    cards: [
      { cardId: "m-69", positionNumber: 1 },
      { cardId: "m-78", positionNumber: 5 },
      { cardId: "m-17", positionNumber: 3 }
    ]
  }, { locale: "en" });
  const mystGestalt = aiSkills.analyzeReadingGestalt(mystDisplaced, "en");
  assert.ok(mystGestalt.displacements.some((d) => d.cardId === "m-69" && d.homePositionNumber === 3));
  assert.ok(mystGestalt.summaryLines.some((line) => /Dead End|road-sign|signal/i.test(line)));
});

test("detectRegister and routeSkills handle mundane/esoteric switching, all 5 intents, follow-ups, and everyday chat sleep", () => {
  // 1. Everyday non-divination chat without readings must keep skills asleep
  const casualRoute = aiSkills.routeSkills({
    locale: "zh-CN",
    skillMode: "auto",
    resolvedReadings: [],
    messages: [{ role: "user", content: "今天晚饭吃什么比较好？顺便写个番茄炒蛋做法。" }]
  });
  assert.equal(casualRoute.hasReadings, false);
  assert.equal(casualRoute.activeSkills.length, 0);
  assert.equal(casualRoute.promptBlock, "");

  // 2. Questionless reading + Starter 1 triggers open-snapshot blind reading protocol
  const blindReading = aiContext.resolveReadingDetails({
    id: "blind-1",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "landscape",
    question: "",
    cards: [
      { cardId: "major-16", positionNumber: 1, orientation: "upright" },
      { cardId: "minor-cups-nine", positionNumber: 11, orientation: "upright" }
    ]
  }, { locale: "zh-CN" });

  const blindRouteZh = aiSkills.routeSkills({
    locale: "zh-CN",
    skillMode: "auto",
    resolvedReadings: [blindReading],
    messages: [{ role: "user", content: "直说核心结论：这副牌眼下最核心的矛盾卡在哪？牌势正往哪边推？" }]
  });
  assert.equal(blindRouteZh.intent, "open-snapshot");
  assert.equal(blindRouteZh.register, "dual", "Landscape blind reading preserves dual mundane+esoteric bridge register");
  assert.equal(blindRouteZh.isFollowUp, false);
  assert.ok(blindRouteZh.promptBlock.includes("盲解破局"));
  assert.ok(blindRouteZh.promptBlock.includes("禁按号点名报菜名"));

  const blindRouteEn = aiSkills.routeSkills({
    locale: "en",
    skillMode: "direct",
    resolvedReadings: [blindReading],
    messages: [{ role: "user", content: "Give me the straight verdict: what is the most central tension and momentum here?" }]
  });
  assert.equal(blindRouteEn.intent, "open-snapshot");
  assert.equal(blindRouteEn.skillMode, "auto", "legacy direct collapses onto the single persona mode");
  assert.ok(blindRouteEn.promptBlock.includes("Blind Reading / No-Question Protocol"));

  // Starters 2 (both updated & legacy wording) & 3 on questionless spreads must also trigger open-snapshot
  for (const starterMsg of [
    "先一句话交代稳固的基本盘，再重点深挖我没意识到的盲点与破局抓手。",
    "跳过平淡牌位，只抓我还没意识到的盲点、必须放手的执念，以及眼下最管用的一步行动。",
    "若关联了多条记录，请对比局势在时间线上的真实演变，看看哪些隐患正在缓解或加剧。"
  ]) {
    const r = aiSkills.routeSkills({
      locale: "zh-CN",
      resolvedReadings: [blindReading],
      messages: [{ role: "user", content: starterMsg }]
    });
    assert.equal(r.intent, "open-snapshot", `Starter should route to open-snapshot when question is empty: ${starterMsg}`);
  }

  // 3. Dual register on esoteric/hybrid spread + career question vs mundane brand-word safety vs pure esoteric query
  const esotericSpreadRec = aiContext.resolveReadingDetails({
    id: "myst-job-1",
    layoutMode: "preset",
    deckType: "mystagogus",
    spreadId: "mystagogus-layout",
    question: "今年年底我该不该辞职换一份薪资更高的软件开发工作？",
    cards: [{ cardId: "m-17", positionNumber: 1 }]
  }, { locale: "zh-CN" });

  const jobOnMystRoute = aiSkills.routeSkills({
    locale: "zh-CN",
    resolvedReadings: [esotericSpreadRec],
    messages: [{ role: "user", content: "重点帮我看看跳槽利弊" }]
  });
  assert.equal(jobOnMystRoute.register, "dual", "Mystagogus spread + career question must trigger 'dual' register without amputating esoteric slots");
  assert.equal(jobOnMystRoute.intent, "decision");

  // Brand name "奎瑞亚" / "Quareia" in a mundane interview question on a mundane spread must NOT falsely trigger 'esoteric'
  const brandMundaneRec = aiContext.resolveReadingDetails({
    id: "brand-job-1",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "three-card-horizontal",
    question: "下周去奎瑞亚文化工作室参加前端岗位面试能不能过？",
    cards: [{ cardId: "major-06", positionNumber: 1 }]
  }, { locale: "zh-CN" });
  assert.equal(
    aiSkills.detectRegister({ locale: "zh-CN", resolvedReadings: [brandMundaneRec], messages: [{ role: "user", content: "Quareia interview prep" }] }),
    "mundane",
    "Brand word '奎瑞亚/Quareia' alone must not falsely switch mundane spread into esoteric register"
  );

  const innerWorkRec = aiContext.resolveReadingDetails({
    id: "inner-esoteric-1",
    layoutMode: "preset",
    deckType: "lxxxi",
    spreadId: "lxxxi-occult-map",
    question: "近期冥想与内在圣殿实修的阻力在哪里？",
    cards: [{ cardId: "lxxxi-05", positionNumber: 1 }]
  }, { locale: "zh-CN" });

  const esoRoute = aiSkills.routeSkills({
    locale: "zh-CN",
    resolvedReadings: [innerWorkRec],
    messages: [{ role: "user", content: "请深入分析内在接触状态" }]
  });
  assert.equal(esoRoute.register, "esoteric");
  assert.equal(esoRoute.intent, "predicament");
  assert.ok(esoRoute.promptBlock.includes("神秘学实修语域激活"));

  // 4. Relationship + health layout + multi-turn follow-up drilldown
  const healthRelRec = aiContext.resolveReadingDetails({
    id: "health-rel-1",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "health",
    question: "最近因为伴侣冷战导致长期失眠精力透支",
    cards: [{ cardId: "minor-swords-nine", positionNumber: 1 }]
  }, { locale: "zh-CN" });

  const followUpRoute = aiSkills.routeSkills({
    locale: "zh-CN",
    skillMode: "action",
    resolvedReadings: [healthRelRec],
    messages: [
      { role: "user", content: "帮我看下目前状态" },
      { role: "assistant", content: "你目前主要是关系消耗引发神经紧绷。" },
      { role: "user", content: "那我们这段感情接下来还会继续冷战吗？具体哪天能缓和？" }
    ]
  });
  assert.equal(followUpRoute.intent, "relationship");
  assert.equal(followUpRoute.isFollowUp, true);
  assert.ok(followUpRoute.activeSkills.some((s) => s.id === "skill-followup-drilldown"));
  assert.ok(followUpRoute.promptBlock.includes("14皮肤"));
  assert.ok(followUpRoute.promptBlock.includes("严禁重背全盘"));
  assert.ok(followUpRoute.promptBlock.includes("时机布局"));
});

test("ai-chat-store persists skillMode and inline reading question across updates and backups", async () => {
  const chatStoreApi = require("../js/ai-chat-store.js");
  assert.deepEqual(chatStoreApi.VALID_SKILL_MODES, ["auto", "direct", "deep", "action"]);
  assert.equal(chatStoreApi.normalizeSkillMode("deep"), "deep");
  assert.equal(chatStoreApi.normalizeSkillMode("bogus"), "auto");

  const store = chatStoreApi.createStore({ indexedDB: null, memoryFallback: true });
  const snap = aiContext.buildReadingSnapshot({
    id: "snap-q-1",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "three-card-horizontal",
    cards: [{ cardId: "major-00", positionNumber: 1, orientation: "upright" }]
  }, { locale: "zh-CN" });

  const created = await store.createConversation({
    id: "conv-skill-1",
    readingIds: ["snap-q-1"],
    readingSnapshots: [snap]
  });
  assert.equal(created.skillMode, "auto");

  const modeUpdated = await store.setSkillMode("conv-skill-1", "action");
  assert.equal(modeUpdated.skillMode, "action");

  const qUpdated = await store.setReadingQuestion("conv-skill-1", "snap-q-1", "未来三个月搬家是否顺利？");
  assert.equal(qUpdated.readingSnapshots[0].question, "未来三个月搬家是否顺利？");

  const backup = await store.exportBackup();
  const store2 = chatStoreApi.createStore({ indexedDB: null, memoryFallback: true });
  await store2.importBackup(JSON.stringify(backup));
  const restored = await store2.getConversation("conv-skill-1");
  assert.equal(restored.skillMode, "action");
  assert.equal(restored.readingSnapshots[0].question, "未来三个月搬家是否顺利？");

  // setAttachedReadings stamps attachedAt on newly attached readings and preserves prior attachedAt
  await store.appendMessages("conv-skill-1", [
    { id: "m-u1", role: "user", content: "先看第一盘", createdAt: 2000 },
    { id: "m-a1", role: "assistant", content: "第一盘结论明确。", createdAt: 2050 }
  ]);
  const snap2 = aiContext.buildReadingSnapshot({
    id: "snap-q-2",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "yes-no",
    cards: [{ cardId: "major-19", positionNumber: 1, orientation: "upright" }]
  }, { locale: "zh-CN" });
  const afterAttach2 = await store.setAttachedReadings("conv-skill-1", ["snap-q-1", "snap-q-2"], [qUpdated.readingSnapshots[0], snap2]);
  const s2Saved = afterAttach2.readingSnapshots.find((s) => s.id === "snap-q-2");
  assert.ok(s2Saved && s2Saved.attachedAt > 2050, "Newly attached 2nd reading must carry attachedAt > lastAssistantAt");
});

test("Quareia semantic fidelity: LXXXI conditional reversals, single-char polarity keywords, EN Mystagogus atoms, and follow-up intent priority", () => {
  // 1. LXXXI high-risk cards: lxxxi-54 (Bailiff), lxxxi-56 (Fellowship), lxxxi-67 (Idiot), lxxxi-09 (Pure Balance), lxxxi-14 (Weaver)
  const lxxxiFidelity = aiContext.resolveReadingDetails({
    id: "lxxxi-fid-1",
    layoutMode: "preset",
    deckType: "lxxxi",
    spreadId: "lxxxi-occult-map",
    cards: [
      { cardId: "lxxxi-54", positionNumber: 1 },
      { cardId: "lxxxi-56", positionNumber: 2 },
      { cardId: "lxxxi-67", positionNumber: 3 },
      { cardId: "lxxxi-09", positionNumber: 4 },
      { cardId: "lxxxi-14", positionNumber: 5 }
    ]
  }, { locale: "zh-CN" });

  const c54 = aiSkills.compileCardCue(lxxxiFidelity.cards[0], { locale: "zh-CN", deckType: "lxxxi", register: "dual" });
  assert.equal(c54.coreCue.includes("日常校验牌"), false, "lxxxi-54 Bailiff must NOT be downgraded as a minor daily check card");
  assert.match(c54.coreCue, /失窃|被偷/, "lxxxi-54 must preserve literal theft cue");
  assert.match(c54.coreCue, /治疗|就医|重估/, "lxxxi-54 must preserve terminal/death-slot medical treatment re-evaluation warning");

  const c56 = aiSkills.compileCardCue(lxxxiFidelity.cards[1], { locale: "zh-CN", deckType: "lxxxi", register: "dual" });
  assert.match(c56.coreCue, /凶|阻碍|负|危险|冲突/, "lxxxi-56 Fellowship must warn of negative-slot reversal (gang/group danger)");

  const c67 = aiSkills.compileCardCue(lxxxiFidelity.cards[2], { locale: "zh-CN", deckType: "lxxxi", register: "mundane" });
  assert.equal(c67.coreCue.includes("日常校验牌"), false, "lxxxi-67 Idiot must NOT be downgraded as a minor daily check card");
  assert.match(c67.coreCue, /否|零|火|警告|危机/, "lxxxi-67 Idiot must preserve 'no/zero/ignoring imminent fire/danger warning'");

  const c09 = aiSkills.compileCardCue(lxxxiFidelity.cards[3], { locale: "zh-CN", deckType: "lxxxi", register: "mundane" });
  assert.match(c09.coreCue, /缓冲|不必恐慌|不用害怕|平衡过程/, "lxxxi-09 Pure Balance VI must include buffering reassurance for harsh co-drawn cards");

  const c14 = aiSkills.compileCardCue(lxxxiFidelity.cards[4], { locale: "zh-CN", deckType: "lxxxi", register: "mundane" });
  assert.match(c14.coreCue, /怀孕|妊娠/, "lxxxi-14 Weaver of Creation must preserve literal pregnancy cue");

  // 2. Single-character Chinese polarity words ('是', '否') & >4 keywords preserved on Mystagogus; EN Mystagogus surgery/not yet preserved
  const mystZhCheck = aiContext.resolveReadingDetails({
    id: "myst-zh-kw",
    layoutMode: "preset",
    deckType: "mystagogus",
    spreadId: "mystagogus-layout",
    cards: [
      { cardId: "m-16", positionNumber: 1 },
      { cardId: "m-37", positionNumber: 2 }
    ]
  }, { locale: "zh-CN" });
  const m16Zh = aiSkills.compileCardCue(mystZhCheck.cards[0], { locale: "zh-CN", deckType: "mystagogus" });
  const m37Zh = aiSkills.compileCardCue(mystZhCheck.cards[1], { locale: "zh-CN", deckType: "mystagogus" });
  assert.ok(
    m16Zh.keywordsClean.includes("是") || /是/.test(m16Zh.coreCue),
    "Mystagogus Healing (m-16) must preserve single-char affirmative polarity '是'"
  );
  assert.ok(
    m37Zh.keywordsClean.includes("否") || /否/.test(m37Zh.coreCue),
    "Mystagogus Unholy Ground (m-37) must preserve negative polarity '否'"
  );

  const mystEnCheck = aiContext.resolveReadingDetails({
    id: "myst-en-atoms",
    layoutMode: "preset",
    deckType: "mystagogus",
    spreadId: "mystagogus-layout",
    cards: [
      { cardId: "m-59", positionNumber: 1 },
      { cardId: "m-41", positionNumber: 2 },
      { cardId: "m-50", positionNumber: 3 }
    ]
  }, { locale: "en" });
  const m59En = aiSkills.compileCardCue(mystEnCheck.cards[0], { locale: "en", deckType: "mystagogus", register: "dual" });
  const m41En = aiSkills.compileCardCue(mystEnCheck.cards[1], { locale: "en", deckType: "mystagogus", register: "dual" });
  assert.match(m59En.coreCue + " " + m59En.keywordsClean.join(" "), /surgery/i, "EN Choppers (m-59) must include 'surgery'");
  assert.match(m41En.coreCue + " " + m41En.keywordsClean.join(" "), /not yet/i, "EN Sanctuary (m-41) must include 'not yet'");

  // 3. Follow-up turn prioritizes latestUserText intent over original record.question, while hasUninterpretedReading overrides follow-up
  const trendSpreadRec = aiContext.resolveReadingDetails({
    id: "followup-intent-1",
    layoutMode: "preset",
    deckType: "tarot",
    spreadId: "landscape",
    question: "今年下半年整体事业发展趋势如何？",
    cards: [{ cardId: "major-12", positionNumber: 1 }]
  }, { locale: "zh-CN" });

  const turn2Decision = aiSkills.routeSkills({
    locale: "zh-CN",
    resolvedReadings: [trendSpreadRec],
    hasUninterpretedReading: false,
    messages: [
      { role: "user", content: "先帮我看整体趋势" },
      { role: "assistant", content: "下半年整体处于收缩蓄力期。" },
      { role: "user", content: "那我现在到底要不要辞职签那家新公司？" }
    ]
  });
  assert.equal(turn2Decision.isFollowUp, true);
  assert.equal(turn2Decision.intent, "decision", "Follow-up turn must prioritize latestUserText ('decision') over initial record.question ('trend')");

  const turn2ExplicitOverview = aiSkills.routeSkills({
    locale: "zh-CN",
    resolvedReadings: [trendSpreadRec],
    hasUninterpretedReading: false,
    messages: [
      { role: "user", content: "刚聊了两句背景" },
      { role: "assistant", content: "收到，请继续。" },
      { role: "user", content: "请重新完整解读整副牌阵的全盘格局" }
    ]
  });
  assert.equal(turn2ExplicitOverview.isFollowUp, false, "Explicit full-overview request must exit narrow follow-up mode");
});


