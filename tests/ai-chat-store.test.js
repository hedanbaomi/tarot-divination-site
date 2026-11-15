"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const chatStore = require("../js/ai-chat-store.js");

function createFakeIndexedDb() {
  const databases = new Map();

  function makeReq(executor) {
    const req = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      onupgradeneeded: null
    };
    queueMicrotask(() => {
      try {
        executor(req);
      } catch (err) {
        req.error = err;
        if (typeof req.onerror === "function") {
          req.onerror({ target: req });
        }
      }
    });
    return req;
  }

  return {
    open(name, version) {
      const req = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        transaction: null
      };
      queueMicrotask(() => {
        let entry = databases.get(name);
        const needsUpgrade = !entry || entry.version < version;
        if (!entry) {
          entry = {
            version,
            stores: new Map(),
            indexes: new Map()
          };
          databases.set(name, entry);
        }

        function createStoreWrapper(storeName) {
          const map = entry.stores.get(storeName);
          return {
            indexNames: {
              contains: (idxName) => (entry.indexes.get(storeName) || new Set()).has(idxName)
            },
            createIndex(idxName) {
              let set = entry.indexes.get(storeName);
              if (!set) {
                set = new Set();
                entry.indexes.set(storeName, set);
              }
              set.add(idxName);
            },
            get(key) {
              return makeReq((r) => {
                r.result = map.has(key) ? structuredClone(map.get(key)) : undefined;
                if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
              });
            },
            getAll() {
              return makeReq((r) => {
                r.result = Array.from(map.values()).map((v) => structuredClone(v));
                if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
              });
            },
            put(value) {
              return makeReq((r) => {
                map.set(value.id, structuredClone(value));
                r.result = value.id;
                if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
              });
            },
            delete(key) {
              return makeReq((r) => {
                map.delete(key);
                r.result = undefined;
                if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
              });
            },
            clear() {
              return makeReq((r) => {
                map.clear();
                r.result = undefined;
                if (typeof r.onsuccess === "function") r.onsuccess({ target: r });
              });
            }
          };
        }

        const dbObj = {
          onversionchange: null,
          objectStoreNames: {
            contains: (s) => entry.stores.has(s)
          },
          createObjectStore(s) {
            if (!entry.stores.has(s)) {
              entry.stores.set(s, new Map());
            }
            return createStoreWrapper(s);
          },
          transaction(storeNames) {
            const tx = {
              onabort: null,
              onerror: null,
              error: null,
              objectStore(s) {
                if (!storeNames.includes(s) || !entry.stores.has(s)) {
                  throw new Error("Missing object store: " + s);
                }
                return createStoreWrapper(s);
              }
            };
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          },
          close() {}
        };

        req.result = dbObj;
        if (needsUpgrade && typeof req.onupgradeneeded === "function") {
          entry.version = version;
          req.onupgradeneeded({ target: req });
        }
        if (typeof req.onsuccess === "function") {
          req.onsuccess({ target: req });
        }
      });
      return req;
    }
  };
}

test("ai-chat-store persists, archives, pins, searches, exports and imports conversations", async () => {
  const store = chatStore.createStore({ indexedDB: createFakeIndexedDb() });

  const c1 = await store.createConversation({
    id: "chat-1",
    title: "工作变动解析",
    createdAt: 1000,
    updatedAt: 1000,
    readingIds: ["r1"],
    readingSnapshots: [{ id: "r1", spreadName: "圣三角牌阵", question: "换工作时机" }],
    messages: [
      { id: "m1", role: "user", content: "请帮我分析第一张牌", createdAt: 1001 },
      { id: "m2", role: "assistant", content: "高塔在过去位提示结构重构", createdAt: 1002 }
    ]
  });

  await store.createConversation({
    id: "chat-2",
    title: "健康恢复参考",
    createdAt: 2000,
    updatedAt: 2000,
    messages: [{ id: "m3", role: "user", content: "圣杯四代表什么", createdAt: 2001 }]
  });

  // Pin chat-1 so it comes before newer chat-2.
  await store.setPinned(c1.id, true);
  let active = await store.listConversations({ archived: false });
  assert.deepEqual(active.map((c) => c.id), ["chat-1", "chat-2"]);

  // Archive chat-2 -> leaves only chat-1 in active tab and chat-2 in archived tab.
  await store.setArchived("chat-2", true);
  active = await store.listConversations({ archived: false });
  let archived = await store.listConversations({ archived: true });
  assert.deepEqual(active.map((c) => c.id), ["chat-1"]);
  assert.deepEqual(archived.map((c) => c.id), ["chat-2"]);

  // Search matches across title, reading snapshots, and message content.
  const searchMsg = await store.listConversations({ archived: "all", query: "结构重构" });
  assert.deepEqual(searchMsg.map((c) => c.id), ["chat-1"]);
  const searchRead = await store.listConversations({ archived: "all", query: "圣杯四" });
  assert.deepEqual(searchRead.map((c) => c.id), ["chat-2"]);

  // Clear archived only leaves active conversations intact.
  const clearedCount = await store.clearConversations({ archivedOnly: true });
  assert.equal(clearedCount, 1);
  assert.equal((await store.listConversations({ archived: "all" })).length, 1);

  // Export backup, delete all, then re-import via replace & merge.
  const backup = await store.exportBackup();
  assert.equal(backup.format, chatStore.BACKUP_FORMAT);
  assert.equal(backup.conversations.length, 1);

  await store.deleteConversation("chat-1");
  assert.equal((await store.getConversation("chat-1")), null);

  const importRes = await store.importBackup(JSON.stringify(backup), { mode: "merge" });
  assert.equal(importRes.importedCount, 1);
  assert.equal(importRes.totalCount, 1);
  assert.equal((await store.getConversation("chat-1")).title, "工作变动解析");

  await assert.rejects(() => store.importBackup('{"format":"wrong","conversations":[]}'));

  const md = chatStore.formatConversationMarkdown(await store.getConversation("chat-1"), { locale: "zh-CN" });
  assert.ok(md.includes("# 工作变动解析"));
  assert.ok(md.includes("圣三角牌阵"));
  assert.ok(md.includes("高塔在过去位提示结构重构"));
});

test("ai-chat-store preserves self-contained snapshots, rejects freeform, and invalidates contextSummary cleanly", async () => {
  const store = chatStore.createStore({ memoryFallback: true });
  const conv = await store.createConversation({
    id: "chat-snap",
    title: "叠牌追踪",
    readingIds: ["r-preset", "r-freeform"],
    readingSnapshots: [
      {
        id: "r-preset",
        layoutMode: "preset",
        deckType: "tarot",
        spreadId: "overview",
        spreadName: "总览牌阵",
        overviewMethod: "stacked",
        createdAt: "2026-06-15T10:00:00.000Z",
        question: "年运",
        cards: [
          { slotIndex: 0, positionNumber: 1, positionName: "第一宫", cardId: "major-0", cardName: "愚者", orientation: "upright", layer: "major" }
        ]
      },
      {
        id: "r-freeform",
        layoutMode: "freeform",
        deckType: "tarot",
        spreadName: "自由画板",
        cards: []
      }
    ],
    messages: [
      { id: "m1", role: "user", content: "第一问", createdAt: 10 },
      { id: "m2", role: "assistant", content: "第一答", createdAt: 20 },
      { id: "m3", role: "user", content: "第二问", createdAt: 30 },
      { id: "m4", role: "assistant", content: "第二答", createdAt: 40 }
    ]
  });

  assert.deepEqual(conv.readingIds, ["r-preset"]);
  assert.equal(conv.readingSnapshots.length, 1);
  assert.equal(conv.readingSnapshots[0].createdAt, Date.parse("2026-06-15T10:00:00.000Z"));
  assert.equal(conv.readingSnapshots[0].overviewMethod, "stacked");
  assert.equal(conv.readingSnapshots[0].cards[0].cardId, "major-0");

  await store.setContextSummary("chat-snap", {
    text: "已摘要 m1-m2",
    coveredUntilId: "m2",
    compressedCount: 2,
    updatedAt: 50
  });
  await store.setLastUsage("chat-snap", {
    inputTokens: 400,
    outputTokens: 120,
    totalTokens: 520,
    updatedAt: 55
  });

  // Deleting message m4 (after coveredUntilId m2) keeps contextSummary intact.
  const afterDeleteLate = await store.deleteMessage("chat-snap", "m4");
  assert.equal(afterDeleteLate.contextSummary.coveredUntilId, "m2");
  assert.equal(afterDeleteLate.lastUsage.totalTokens, 520);

  // Deleting message m1 (before coveredUntilId m2) invalidates contextSummary.
  const afterDeleteCovered = await store.deleteMessage("chat-snap", "m1");
  assert.equal(afterDeleteCovered.contextSummary, null);

  // Re-attach summary, then editMessageAndTruncate at coveredUntilId invalidates it.
  await store.setContextSummary("chat-snap", {
    text: "已摘要 m2",
    coveredUntilId: "m2",
    compressedCount: 1,
    updatedAt: 60
  });
  const afterEditCovered = await store.editMessageAndTruncate("chat-snap", "m2", "修改后的回复");
  assert.equal(afterEditCovered.contextSummary, null);

  const summaryMd = chatStore.formatConversationMarkdown(afterEditCovered, { locale: "zh-CN" });
  assert.ok(summaryMd.includes("总览牌阵 (塔罗 · 叠牌法) — 年运"));
});

test("message appends and late completions preserve concurrent changes and deletions", async () => {
  const store = chatStore.createStore({ indexedDB: null, memoryFallback: true });
  await store.createConversation({ id: "shared" });
  const a = [
    chatStore.normalizeMessage({ id: "ua", role: "user", content: "A" }),
    chatStore.normalizeMessage({ id: "aa", role: "assistant", content: "" })
  ];
  const b = [
    chatStore.normalizeMessage({ id: "ub", role: "user", content: "B" }),
    chatStore.normalizeMessage({ id: "ab", role: "assistant", content: "" })
  ];
  await Promise.all([store.appendMessages("shared", a), store.appendMessages("shared", b), store.setPinned("shared", true)]);
  await store.completeMessage("shared", { ...b[1], content: "answer B" });
  await store.completeMessage("shared", { ...a[1], content: "answer A" });
  let current = await store.getConversation("shared");
  assert.deepEqual(current.messages.map(m => m.content), ["A", "answer A", "B", "answer B"]);
  assert.equal(current.pinned, true);
  await assert.rejects(store.updateConversation("shared", { messages: a }, { expectedMessages: a }), { code: "conversation_conflict" });
  assert.equal((await store.getConversation("shared")).messages.length, 4);
  await store.deleteMessage("shared", "aa");
  await store.completeMessage("shared", { ...a[1], content: "late" });
  assert.equal((await store.getConversation("shared")).messages.some(m => m.id === "aa"), false);
  await store.deleteConversation("shared");
  assert.equal(await store.completeMessage("shared", { ...a[1], content: "later" }), null);
  assert.equal(await store.getConversation("shared"), null);
});

test("late compression does not restore a summary invalidated by another edit", async () => {
  const store = chatStore.createStore({ indexedDB: createFakeIndexedDb() });
  const messages = [
    chatStore.normalizeMessage({ id: "u", role: "user", content: "original" }),
    chatStore.normalizeMessage({ id: "a", role: "assistant", content: "" })
  ];
  await store.createConversation({ id: "summary", messages });
  await store.updateConversation("summary", conv => {
    conv.messages[0].content = "edited";
    conv.contextSummary = null;
    return conv;
  });
  await store.completeMessage("summary", { ...messages[1], content: "answer" }, {
    contextSummary: { text: "stale", coveredUntilId: "u", compressedCount: 1 },
    summaryMessages: messages.slice(0, 1)
  });
  const current = await store.getConversation("summary");
  assert.equal(current.messages[0].content, "edited");
  assert.equal(current.contextSummary, null);
});
