"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const chatStore = require("../js/ai-chat-store.js");

function createFakeIndexedDb() {
  const databases = new Map();

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

        function createStoreWrapper(storeName, txRef, snapshotMap) {
          const map = entry.stores.get(storeName);

          function makeStoreReq(executor) {
            const r = {
              result: undefined,
              error: null,
              onsuccess: null,
              onerror: null,
              transaction: txRef || null,
              listeners: Object.create(null),
              addEventListener(type, fn) {
                if (!this.listeners[type]) this.listeners[type] = [];
                this.listeners[type].push(fn);
              }
            };
            queueMicrotask(() => {
              if (txRef && txRef._aborted) return;
              try {
                executor(r);
                if (txRef && txRef._aborted) return;
                if (typeof r.onsuccess === "function") {
                  r.onsuccess({ target: r });
                }
                for (const fn of r.listeners.success || []) {
                  fn({ target: r });
                }
              } catch (err) {
                r.error = err;
                if (typeof r.onerror === "function") {
                  r.onerror({ target: r });
                }
              }
            });
            return r;
          }

          return {
            transaction: txRef || null,
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
              return makeStoreReq((r) => {
                r.result = map.has(key) ? structuredClone(map.get(key)) : undefined;
              });
            },
            getAll() {
              return makeStoreReq((r) => {
                r.result = Array.from(map.values()).map((v) => structuredClone(v));
              });
            },
            put(value) {
              return makeStoreReq((r) => {
                if (snapshotMap && !snapshotMap.has(storeName)) {
                  snapshotMap.set(storeName, new Map(map));
                }
                map.set(value.id, structuredClone(value));
                r.result = value.id;
              });
            },
            delete(key) {
              return makeStoreReq((r) => {
                if (snapshotMap && !snapshotMap.has(storeName)) {
                  snapshotMap.set(storeName, new Map(map));
                }
                map.delete(key);
                r.result = undefined;
              });
            },
            clear() {
              return makeStoreReq((r) => {
                if (snapshotMap && !snapshotMap.has(storeName)) {
                  snapshotMap.set(storeName, new Map(map));
                }
                map.clear();
                r.result = undefined;
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
            return createStoreWrapper(s, null, null);
          },
          transaction(storeNames) {
            const snapshotMap = new Map();
            const tx = {
              _aborted: false,
              onabort: null,
              onerror: null,
              oncomplete: null,
              error: null,
              abort() {
                if (this._aborted) return;
                this._aborted = true;
                for (const [sName, prev] of snapshotMap.entries()) {
                  entry.stores.set(sName, prev);
                }
                this.error = new Error("AbortError");
                setTimeout(() => {
                  if (typeof this.onabort === "function") {
                    this.onabort({ target: this });
                  }
                }, 0);
              },
              objectStore(s) {
                if (!storeNames.includes(s) || !entry.stores.has(s)) {
                  throw new Error("Missing object store: " + s);
                }
                return createStoreWrapper(s, tx, snapshotMap);
              }
            };
            setTimeout(() => {
              if (!tx._aborted && typeof tx.oncomplete === "function") {
                tx.oncomplete();
              }
            }, 0);
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

test("memory fallback announces nonpersistent storage and stays on the same adapter", async () => {
  let attempts = 0;
  const persistentIdb = createFakeIndexedDb();
  const modes = [];
  const store = chatStore.createStore({
    memoryFallback: true,
    onStorageModeChange: mode => modes.push(mode),
    indexedDB: {
      open(...args) {
        attempts += 1;
        if (attempts > 1) return persistentIdb.open(...args);
        const request = {};
        queueMicrotask(() => request.onerror({ target: { error: new Error("unavailable") } }));
        return request;
      }
    }
  });
  await store.createConversation({ id: "temporary", messages: [{ role: "user", content: "keep for export" }] });
  assert.deepEqual(modes, ["memory"]);
  assert.equal((await store.open()).__memory, true);
  assert.equal((await store.exportBackup()).conversations[0].messages[0].content, "keep for export");
  assert.equal(attempts, 1, "A recovered database must not silently hide in-memory conversations");
});

test("a failed synchronous database open can be retried without a memory fallback", async () => {
  const idb = createFakeIndexedDb();
  let attempts = 0;
  const modes = [];
  const store = chatStore.createStore({
    indexedDB: {
      open(...args) {
        if (++attempts === 1) throw new Error("temporary open failure");
        return idb.open(...args);
      }
    },
    onStorageModeChange: mode => modes.push(mode)
  });
  await assert.rejects(store.open(), /temporary open failure/);
  await store.createConversation({ id: "retry" });
  assert.equal((await store.getConversation("retry")).id, "retry");
  assert.deepEqual(modes, ["persistent"]);
});

test("backup import rejects oversized UTF-8 data before parsing or replacing existing chats", async () => {
  const store = chatStore.createStore({ indexedDB: null, memoryFallback: true });
  await store.createConversation({ id: "keep" });
  for (const raw of [
    " ".repeat(chatStore.MAX_BACKUP_BYTES + 1),
    "汉".repeat(Math.floor(chatStore.MAX_BACKUP_BYTES / 3) + 1),
    { conversations: [{ id: "too-large", messages: [{ content: "😀".repeat(chatStore.MAX_BACKUP_BYTES / 4) }] }] }
  ]) {
    await assert.rejects(store.importBackup(raw, { mode: "replace" }), { code: "backup_too_large" });
    assert.equal((await store.getConversation("keep")).id, "keep");
  }
  const small = JSON.stringify({ format: chatStore.BACKUP_FORMAT, version: 1, conversations: [{ id: "boundary" }] });
  const exactLimit = small + " ".repeat(chatStore.MAX_BACKUP_BYTES - Buffer.byteLength(small));
  assert.equal(Buffer.byteLength(exactLimit), chatStore.MAX_BACKUP_BYTES);
  const result = await store.importBackup(exactLimit);
  assert.equal(result.importedCount, 1);
  assert.equal(result.totalCount, 2);
});

test("Markdown exports preserve notices on incomplete responses", () => {
  const markdown = chatStore.formatConversationMarkdown({
    messages: [{ role: "assistant", content: "Partial answer", error: "Output was truncated" }]
  }, { locale: "en" });
  assert.match(markdown, /Partial answer/);
  assert.match(markdown, /Response notice:.*Output was truncated/);
});

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
          { slotIndex: 0, positionNumber: 1, positionName: "第一宫", cardId: "major-00", cardName: "愚者", orientation: "upright", layer: "major" }
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
  assert.equal(conv.readingSnapshots[0].cards[0].cardId, "major-00");

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

test("importBackup validates schema strictly, preserves newer local chats on merge, and refuses destructive invalid replace", async () => {
  const store = chatStore.createStore({ indexedDB: createFakeIndexedDb() });

  await store.createConversation({
    id: "local-newer",
    title: "本地最新修改",
    createdAt: 1000,
    updatedAt: 5000,
    messages: [
      { id: "m1", role: "user", content: "本地第一问", createdAt: 1001 },
      { id: "m2", role: "assistant", content: "本地最新回答", createdAt: 4999 }
    ]
  });
  await store.createConversation({
    id: "local-older",
    title: "本地旧标题",
    createdAt: 1000,
    updatedAt: 1500,
    messages: [
      { id: "m3", role: "user", content: "旧问题", createdAt: 1200 }
    ]
  });

  // Malformed payloads must reject in replace mode BEFORE touching existing IndexedDB records.
  const badPayloads = [
    "[1, 2, 3]",
    "[[], []]",
    "[{}]",
    '[{"foo":"bar"}]',
    "[]",
    JSON.stringify({ format: chatStore.BACKUP_FORMAT, version: 99, conversations: [] }),
    JSON.stringify({ format: chatStore.BACKUP_FORMAT, version: 0, conversations: [] }),
    JSON.stringify({ format: chatStore.BACKUP_FORMAT, version: 1, conversations: [null, 42, [], { foo: 1 }] })
  ];
  for (const raw of badPayloads) {
    await assert.rejects(
      () => store.importBackup(raw, { mode: "replace" }),
      { code: "invalid_backup" },
      `Expected malformed backup to reject: ${raw}`
    );
  }
  assert.equal((await store.listConversations({ archived: "all" })).length, 2, "Existing chats must remain untouched after rejected replace");

  // Merge mode keeps newer local chat, updates older local chat, imports brand-new chat, and deduplicates incoming IDs.
  const mergePayload = {
    format: chatStore.BACKUP_FORMAT,
    version: chatStore.BACKUP_VERSION,
    conversations: [
      {
        id: "local-newer",
        title: "备份里的旧版本",
        createdAt: 1000,
        updatedAt: 2000,
        messages: [{ id: "m1", role: "user", content: "旧内容", createdAt: 1001 }]
      },
      {
        id: "local-older",
        title: "备份里更新后的标题",
        createdAt: 1000,
        updatedAt: 3500,
        messages: [
          { id: "m3", role: "user", content: "旧问题", createdAt: 1200 },
          { id: "m4", role: "assistant", content: "新补充解答", createdAt: 3400 }
        ]
      },
      {
        id: "dup-incoming",
        title: "重复旧条目",
        createdAt: 2000,
        updatedAt: 2100,
        messages: [{ id: "d1", role: "user", content: "v1", createdAt: 2100 }]
      },
      {
        id: "dup-incoming",
        title: "重复新条目",
        createdAt: 2000,
        updatedAt: 4200,
        messages: [{ id: "d1", role: "user", content: "v2", createdAt: 4200 }]
      }
    ]
  };

  const mergeRes = await store.importBackup(JSON.stringify(mergePayload), { mode: "merge" });
  assert.equal(mergeRes.importedCount, 2, "Only local-older and deduplicated dup-incoming should be written");
  assert.equal(mergeRes.totalCount, 3);

  const keptNewer = await store.getConversation("local-newer");
  assert.equal(keptNewer.title, "本地最新修改");
  assert.equal(keptNewer.updatedAt, 5000);
  assert.equal(keptNewer.messages.length, 2);

  const updatedOlder = await store.getConversation("local-older");
  assert.equal(updatedOlder.title, "备份里更新后的标题");
  assert.equal(updatedOlder.messages.length, 2);

  const dedupedIncoming = await store.getConversation("dup-incoming");
  assert.equal(dedupedIncoming.title, "重复新条目");
  assert.equal(dedupedIncoming.messages[0].content, "v2");

  // Verified envelope with empty conversations in replace mode intentionally clears store.
  const emptyVerified = await store.importBackup(JSON.stringify({
    format: chatStore.BACKUP_FORMAT,
    version: chatStore.BACKUP_VERSION,
    conversations: []
  }), { mode: "replace" });
  assert.equal(emptyVerified.importedCount, 0);
  assert.equal(emptyVerified.totalCount, 0);
});

test("normalizeConversation guards null/empty slotIndex, deduplicates snapshot/message IDs, and resists prototype pollution", async () => {
  const normalized = chatStore.normalizeConversation({
    id: "norm-edge",
    title: "边界归一化",
    readingIds: ["snap-1", "snap-1"],
    readingSnapshots: [
      {
        id: "snap-1",
        layoutMode: "preset",
        deckType: "tarot",
        spreadName: "三张牌",
        cards: [
          { slotIndex: null, positionNumber: null, cardId: "major-00", cardName: "愚者" },
          { slotIndex: "", positionNumber: "", cardId: "major-01", cardName: "魔法师" },
          { slotIndex: false, positionNumber: "  ", cardId: "major-02", cardName: "女祭司" }
        ]
      },
      {
        id: "snap-1",
        layoutMode: "preset",
        deckType: "tarot",
        spreadName: "重复快照应忽略",
        cards: []
      }
    ],
    messages: [
      { id: "dup-msg", role: "user", content: "第一条" },
      { id: "dup-msg", role: "assistant", content: "第二条同 ID" }
    ]
  });

  assert.equal(normalized.readingSnapshots.length, 1);
  assert.deepEqual(
    normalized.readingSnapshots[0].cards.map((c) => [c.slotIndex, c.positionNumber]),
    [[0, 1], [1, 2], [2, 3]],
    "null/empty/boolean slotIndex & positionNumber must fall back to index instead of coercing to 0"
  );
  assert.equal(normalized.messages.length, 2);
  assert.notEqual(normalized.messages[0].id, normalized.messages[1].id, "Colliding message IDs must be made unique");

  const store = chatStore.createStore({ memoryFallback: true });
  const protoJson = `{"format":"${chatStore.BACKUP_FORMAT}","version":1,"conversations":[{"id":"proto-chat","title":"Safe","__proto__":{"pollutedFlag":true},"messages":[{"id":"m1","role":"user","content":"hi"}]}]}`;
  await store.importBackup(protoJson, { mode: "merge" });
  assert.equal(({}).pollutedFlag, undefined, "Object.prototype must never be polluted by backup import");
});

test("IndexedDB transaction abort rolls back cleanly and rejects promise", async () => {
  const fakeIdb = createFakeIndexedDb();
  const store = chatStore.createStore({ indexedDB: fakeIdb });
  await store.createConversation({ id: "abort-check", title: "Initial", pinned: false });

  const realOpen = fakeIdb.open.bind(fakeIdb);
  let abortNextPut = true;
  fakeIdb.open = function (name, version) {
    const req = realOpen(name, version);
    const origSuccess = Object.getOwnPropertyDescriptor(req, "onsuccess");
    let handler = null;
    Object.defineProperty(req, "onsuccess", {
      configurable: true,
      get() { return handler; },
      set(fn) {
        handler = function (ev) {
          const db = req.result;
          const origTx = db.transaction.bind(db);
          db.transaction = function (names, mode) {
            const tx = origTx(names, mode);
            const origStore = tx.objectStore.bind(tx);
            tx.objectStore = function (s) {
              const os = origStore(s);
              const origPut = os.put.bind(os);
              os.put = function (val) {
                const putReq = origPut(val);
                if (abortNextPut) {
                  abortNextPut = false;
                  putReq.addEventListener("success", () => tx.abort());
                }
                return putReq;
              };
              return os;
            };
            return tx;
          };
          if (origSuccess && origSuccess.set) origSuccess.set.call(req, fn);
          return fn.call(this, ev);
        };
      }
    });
    return req;
  };

  const failingStore = chatStore.createStore({ indexedDB: fakeIdb });
  await assert.rejects(() => failingStore.setPinned("abort-check", true));
  const after = await store.getConversation("abort-check");
  assert.equal(after.pinned, false, "Aborted transaction must not persist pinned=true");
});
