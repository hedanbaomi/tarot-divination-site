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

test("legacy skill modes stay valid in storage", () => {
  for (const mode of ["auto", "direct", "deep", "action"]) {
    assert.equal(chatStore.normalizeSkillMode(mode), mode);
    assert.ok(chatStore.VALID_SKILL_MODES.includes(mode));
  }
  assert.equal(chatStore.normalizeSkillMode("nonsense"), "auto");
  assert.equal(chatStore.normalizeSkillMode(""), "auto");
});
