"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const aiUi = require("../js/ai-ui.js");
const chatStore = require("../js/ai-chat-store.js");

// The built-in persona replies with a short greeting before any cards are read.
// That reply must not be mistaken for "the attached reading was interpreted",
// otherwise the next turn loads follow-up rules and never covers the spread.
function convWith(messages, attachedAt) {
  return {
    readingIds: ["reading-1"],
    readingSnapshots: [{ id: "reading-1", attachedAt: attachedAt }],
    messages: messages
  };
}

test("a greeting-only assistant reply does not count as an interpretation", () => {
  const conv = convWith(
    [
      { role: "user", content: "我想问问工作", createdAt: 400 },
      {
        role: "assistant",
        content: "你好，我是奥莉薇娅。牌先放着，不急。你想从哪儿说起？",
        createdAt: 2000
      }
    ],
    500
  );
  assert.equal(aiUi.assistantMessageShowsReading(conv.messages[1].content), false);
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), true);
});

test("an assistant reply that names cards counts as an interpretation", () => {
  const conv = convWith(
    [
      { role: "user", content: "我想问问工作", createdAt: 400 },
      {
        role: "assistant",
        content: "第一张是正位的权杖三，放在现状位，说的是你已经在等一个回音。",
        createdAt: 2000
      }
    ],
    500
  );
  assert.equal(aiUi.assistantMessageShowsReading(conv.messages[1].content), true);
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), false);
});

test("re-attaching a reading after a reading marks it uninterpreted again", () => {
  const conv = convWith(
    [
      { role: "user", content: "先看看感情", createdAt: 400 },
      { role: "assistant", content: "第一张是逆位的圣杯八。", createdAt: 1000 }
    ],
    3000
  );
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), true);
});

test("no attached reading means nothing to interpret", () => {
  const conv = { readingIds: [], readingSnapshots: [], messages: [] };
  assert.equal(aiUi.computeHasUninterpretedReading(conv, 0), false);
});

test("english card names are recognised too", () => {
  assert.equal(aiUi.assistantMessageShowsReading("The Tower reversed sits in the obstacle slot."), true);
  assert.equal(aiUi.assistantMessageShowsReading("Hi, I'm Olivia. No rush."), false);
});

test("common words that are also arcana names do not fake a reading", () => {
  // These words are ordinary vocabulary AND major-arcana names. Without a card
  // cue they must not flip a greeting/clarification into "already interpreted".
  for (const s of [
    "你好，我是奥莉薇娅。这个世界上有很多事，我们慢慢说。",
    "你说的是恋人之间的关系吗？",
    "太阳出来了，你还好吗？",
    "你觉得正义重要吗？",
    "The world we live in is complicated.",
    "One star is enough to make it through the night.",
  ]) {
    assert.equal(aiUi.assistantMessageShowsReading(s), false, s);
  }
});

function snapWithCards(id, cardNames, attachedAt) {
  return {
    id: id,
    attachedAt: attachedAt,
    cards: cardNames.map((name, i) => ({
      slotIndex: i,
      positionNumber: i + 1,
      cardId: "card-" + i,
      cardName: name,
      orientation: "upright"
    }))
  };
}

test("a clarification that mentions 牌面 does not count as an interpretation", () => {
  // Review case (a): the reader asks what to talk about first, mentioning the
  // cards only as something not yet looked at.
  const conv = {
    readingIds: ["r1"],
    readingSnapshots: [snapWithCards("r1", ["权杖三", "圣杯二", "星币四"], 500)],
    messages: [
      { role: "user", content: "帮我看看这段关系", createdAt: 400 },
      {
        role: "assistant",
        content: "在看牌面之前，你想先聊哪件事？",
        createdAt: 2000
      }
    ]
  };
  assert.equal(
    aiUi.assistantMessageShowsReading(conv.messages[1].content, conv.readingSnapshots[0]),
    false
  );
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), true);
});

test("a reply that names the record's own card counts for that record", () => {
  const conv = {
    readingIds: ["r1"],
    readingSnapshots: [snapWithCards("r1", ["权杖三", "圣杯二", "星币四"], 500)],
    messages: [
      { role: "user", content: "帮我看看这段关系", createdAt: 400 },
      { role: "assistant", content: "权杖三在现状位，说的是等待。", createdAt: 2000 }
    ]
  };
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), false);
});

test("mystagogus cards are matched by their own names, not rider-waite ones", () => {
  // Review case (b): the deck may name a card "Dead End"; a short reply about it
  // is a real interpretation even without 正位/逆位/权杖 wording.
  const conv = {
    readingIds: ["r1"],
    readingSnapshots: [snapWithCards("r1", ["Dead End", "The Hermit"], 500)],
    messages: [
      { role: "user", content: "我该继续追吗", createdAt: 400 },
      {
        role: "assistant",
        content: "Dead End asks you to stop pushing for now.",
        createdAt: 2000
      }
    ]
  };
  assert.equal(
    aiUi.assistantMessageShowsReading(conv.messages[1].content, conv.readingSnapshots[0]),
    true
  );
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), false);
});

test("two attached records track their interpretation separately", () => {
  // Review case (c): a second spread attached mid-conversation keeps its own
  // state; interpreting the first one must not mark the second one read.
  const conv = {
    readingIds: ["r1", "r2"],
    readingSnapshots: [
      snapWithCards("r1", ["愚者", "魔术师"], 500),
      snapWithCards("r2", ["圣杯七", "宝剑五"], 3000)
    ],
    messages: [
      { role: "user", content: "先看第一个盘", createdAt: 400 },
      { role: "assistant", content: "第一张是愚者，落在现状位。", createdAt: 2000 }
    ]
  };
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), true);

  conv.messages.push({
    role: "user",
    content: "再看第二个盘",
    createdAt: 3100
  });
  conv.messages.push({
    role: "assistant",
    content: "圣杯七在障碍位，说的是想象多于行动。",
    createdAt: 4000
  });
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), false);
});

test("a late reply never counts for a record attached after the request began", () => {
  const conv = {
    readingIds: ["r1", "r2"],
    readingSnapshots: [
      snapWithCards("r1", ["愚者"], 500),
      snapWithCards("r2", ["愚者"], 3000)
    ],
    messages: [
      { role: "user", content: "先看第一个盘", createdAt: 400 },
      // Created before r2 was attached, so it can only speak about r1.
      { role: "assistant", content: "第一张是愚者。", createdAt: 2000 }
    ]
  };
  assert.equal(aiUi.computeHasUninterpretedReading(conv, conv.messages.length), true);
});

test("a shared everyday card name needs a card cue before it counts", () => {
  const snap = snapWithCards("r1", ["太阳", "月亮"], 500);
  assert.equal(aiUi.assistantMessageShowsReading("太阳出来了，你还好吗？", snap), false);
  assert.equal(aiUi.assistantMessageShowsReading("太阳在现状位，说的是现在被看见。", snap), true);
});

test("legacy skill modes stay valid in storage", () => {
  for (const mode of ["auto", "direct", "deep", "action"]) {
    assert.equal(chatStore.normalizeSkillMode(mode), mode);
    assert.ok(chatStore.VALID_SKILL_MODES.includes(mode));
  }
  assert.equal(chatStore.normalizeSkillMode("nonsense"), "auto");
  assert.equal(chatStore.normalizeSkillMode(""), "auto");
});
