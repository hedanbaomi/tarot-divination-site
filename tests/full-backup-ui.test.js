"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const android = "android-demo/app/src/main/assets/www";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("full-backup UI and CSS stay byte-identical between Web and Android with zero forbidden APIs", () => {
  for (const rel of ["js/full-backup-ui.js", "css/full-backup.css", "js/custom-spread-ui.js", "js/card-notes.js"]) {
    const webSrc = read(rel);
    const androidSrc = read(path.join(android, rel));
    assert.equal(webSrc, androidSrc, rel + " must match byte-for-byte between Web and Android");
  }

  for (const tree of ["", android]) {
    const uiSrc = read(path.join(tree, "js/full-backup-ui.js"));
    assert.doesNotMatch(
      uiSrc,
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML|fetch|XMLHttpRequest|sendBeacon|WebSocket|DivinationWebTelemetry|androidTelemetry|quareia-ai-config|androidAiConfig)\b/
    );
    assert.doesNotMatch(uiSrc, /\b(?:alert|confirm|prompt)\s*\(/);
  }
});

test("all four HTML surfaces wire full-backup dialog, entry points, and scripts cleanly", () => {
  for (const page of ["index.html", "classic.html"]) {
    const webHtml = read(page);
    const androidHtml = read(path.join(android, page));

    for (const [label, html] of [["web " + page, webHtml], ["android " + page, androidHtml]]) {
      const dialogMatch = html.match(/<dialog class="full-backup-dialog" id="fullBackupDialog"[\s\S]+?<\/dialog>/);
      assert.ok(dialogMatch, label + " must contain #fullBackupDialog");
      const dialog = dialogMatch[0];
      assert.doesNotMatch(dialog, /<select\b/i, label + " fullBackupDialog must not contain native <select>");
      assert.match(dialog, /id="fullBackupExportBtn"/);
      assert.match(dialog, /id="fullBackupChooseBtn"/);
      assert.match(dialog, /id="fullBackupImportInput"[^>]*type="file"/);
      assert.match(dialog, /id="fullBackupPreview"[^>]*hidden/);
      assert.match(dialog, /id="fullBackupConfirmBtn"/);
      assert.match(dialog, /id="fullBackupCancelBtn"/);
      assert.match(dialog, /id="fullBackupSummary"[^>]*hidden/);

      assert.match(html, /href="css\/full-backup\.css(?:\?v=[0-9a-f]{8})?"/);
      assert.match(html, /src="js\/ai-chat-store\.js(?:\?v=[0-9a-f]{8})?"/);
      assert.match(html, /src="js\/full-backup\.js(?:\?v=[0-9a-f]{8})?"/);
      assert.match(html, /src="js\/full-backup-ui\.js(?:\?v=[0-9a-f]{8})?"/);
      assert.ok(html.indexOf("js/ai-chat-store.js") < html.indexOf("js/full-backup.js"), label);
      assert.ok(html.indexOf("js/full-backup.js") < html.indexOf("js/full-backup-ui.js"), label);

      // Existing single-module backup buttons remain intact.
      assert.match(html, /id="historyExportBtn"/);
      assert.match(html, /id="historyImportInput"/);
      assert.match(html, /id="cardNotesExportBtn"/);
      assert.match(html, /id="cardNotesImportInput"/);
    }

    // Web puts entry button in settings; Android puts entry button in #appMenu drawer without PWA tags.
    const webSettings = webHtml.slice(webHtml.indexOf('id="settings"'), webHtml.indexOf('id="positionGuide"'));
    assert.match(webSettings, /id="fullBackupOpenBtn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="fullBackupDialog"/);

    const androidMenu = androidHtml.slice(androidHtml.indexOf('id="appMenu"'), androidHtml.indexOf('id="menuBackdrop"'));
    assert.match(androidMenu, /id="fullBackupOpenBtn"[^>]*aria-haspopup="dialog"[^>]*aria-controls="fullBackupDialog"/);
    assert.doesNotMatch(androidHtml, /rel="manifest"|pwa-register\.js/);
  }
});

test("buildFileName produces quareia-full-backup-YYYYMMDD-HHMM.json", () => {
  const ui = require("../js/full-backup-ui.js");
  const stamp = new Date(2026, 10, 28, 6, 5, 0);
  assert.equal(ui.buildFileName(stamp), "quareia-full-backup-20261128-0605.json");
});

test("full-backup UI preview, cancel, selective restore, and Android native export callbacks", async () => {
  function FakeElement(tag) {
    this.tagName = tag.toUpperCase();
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.type = "";
    this.value = "";
    this.open = false;
    this.isConnected = true;
    this.offsetParent = {};
    this.dataset = {};
    this.children = [];
    this.listeners = Object.create(null);
    this.attributes = Object.create(null);
    const self = this;
    this.classList = {
      contains: function (c) { return self.className.split(/\s+/).filter(Boolean).includes(c); },
      add: function (c) { if (!this.contains(c)) self.className = (self.className + " " + c).trim(); },
      remove: function (c) { self.className = self.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(" "); },
      toggle: function (c, force) {
        var on = typeof force === "boolean" ? force : !this.contains(c);
        if (on) this.add(c); else this.remove(c);
        return on;
      }
    };
  }
  FakeElement.prototype.appendChild = function (child) {
    if (child && child.isFragment) {
      child.children.forEach(c => this.children.push(c));
      child.children = [];
      return child;
    }
    this.children.push(child);
    return child;
  };
  FakeElement.prototype.replaceChildren = function (...nodes) {
    this.children = [];
    nodes.forEach(n => this.appendChild(n));
  };
  FakeElement.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
  FakeElement.prototype.getAttribute = function (k) { return this.attributes[k] || null; };
  FakeElement.prototype.removeAttribute = function (k) { delete this.attributes[k]; };
  FakeElement.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); };
  FakeElement.prototype.addEventListener = function (type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  };
  FakeElement.prototype.dispatch = function (type, event = {}) {
    event.currentTarget = this;
    event.target = event.target || this;
    event.preventDefault = event.preventDefault || (() => {});
    event.stopPropagation = event.stopPropagation || (() => {});
    (this.listeners[type] || []).slice().forEach(fn => fn(event));
  };
  FakeElement.prototype.click = function () { this.dispatch("click"); };
  FakeElement.prototype.focus = function () {};
  FakeElement.prototype.remove = function () {};
  FakeElement.prototype.showModal = function () { this.open = true; };
  FakeElement.prototype.close = function () { this.open = false; };
  Object.defineProperty(FakeElement.prototype, "childElementCount", {
    get() { return this.children.length; }
  });

  const ids = [
    "fullBackupOpenBtn", "fullBackupDialog", "fullBackupCloseBtn", "fullBackupDialogTitle",
    "fullBackupStatus", "fullBackupRefreshBtn", "fullBackupLocalCounts", "fullBackupUnavailable",
    "fullBackupExportBtn", "fullBackupChooseBtn", "fullBackupImportInput", "fullBackupPreview",
    "fullBackupPreviewFile", "fullBackupPreviewTime", "fullBackupPreviewList",
    "fullBackupConfirmBtn", "fullBackupCancelBtn", "fullBackupSummary", "fullBackupSummaryList"
  ];
  const byId = Object.create(null);
  ids.forEach(id => { byId[id] = new FakeElement("div"); });
  byId.fullBackupPreview.hidden = true;
  byId.fullBackupSummary.hidden = true;
  byId.fullBackupUnavailable.hidden = true;

  const doc = {
    readyState: "complete",
    body: new FakeElement("body"),
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => Object.assign(new FakeElement("fragment"), { isFragment: true }),
    addEventListener: () => {}
  };

  let restoreCalls = [];
  let nativeExportCallback = null;
  let nativeSaveBusy = false;
  const fakeCore = {
    SECTION_KEYS: ["history", "cardNotes", "customSpreads", "aiChats", "preferences"],
    MAX_BACKUP_BYTES: 16 * 1024 * 1024,
    async inspectLocalCounts() {
      return { history: 2, cardNotes: 1, customSpreads: 0, aiChats: 1, preferences: 2, unavailable: [] };
    },
    async collectBackup() {
      return {
        json: '{"format":"quareia-full-backup","version":1}',
        counts: { history: 2, cardNotes: 1, customSpreads: 0, aiChats: 1, preferences: 2 },
        unavailable: []
      };
    },
    parseBackup(raw) {
      if (raw.includes("apiKey")) throw new Error("Forbidden key apiKey");
      return {
        format: "quareia-full-backup",
        version: 1,
        exportedAt: "2026-11-28T06:00:00.000Z",
        sections: {
          history: { records: [{}] },
          cardNotes: { notes: [{}] },
          preferences: { theme: "parchment", locale: "en" }
        },
        counts: { history: 1, cardNotes: 1, customSpreads: 0, aiChats: 0, preferences: 2 },
        availableSections: ["history", "cardNotes", "preferences"]
      };
    },
    async restoreBackup(parsed, selected) {
      restoreCalls.push(selected);
      return {
        restored: {
          history: { imported: 1, remapped: 0 },
          cardNotes: { imported: 1, skipped: 0 }
        },
        appliedPreferences: selected.includes("preferences") ? { theme: "parchment" } : {},
        warnings: []
      };
    }
  };

  const context = {
    document: doc,
    setTimeout,
    addEventListener: () => {},
    dispatchEvent: () => {},
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    DivinationI18n: require("../js/i18n.js"),
    DivinationTheme: { getTheme: () => "celestial" },
    DivinationFullBackup: fakeCore,
    androidHistoryExport: { save: () => true },
    DivinationNativeFileExport: {
      save(_json, _name, cb) {
        if (nativeSaveBusy) return false;
        nativeExportCallback = cb;
        return true;
      }
    }
  };
  context.DivinationI18n.setLocale("zh-CN");
  vm.runInNewContext(read("js/full-backup-ui.js"), context, { filename: "full-backup-ui.js" });

  const ui = context.DivinationFullBackupUi;
  const settle = () => new Promise(r => setImmediate(r));

  byId.fullBackupOpenBtn.click();
  await settle();
  assert.equal(ui.isOpen(), true);
  assert.equal(byId.fullBackupLocalCounts.children.length, 5);

  // Android native export: busy, cancelled, saved, failed.
  nativeSaveBusy = true;
  byId.fullBackupExportBtn.click();
  await settle();
  assert.equal(byId.fullBackupStatus.textContent, context.DivinationI18n.t("fullBackup.exportBusy"));

  nativeSaveBusy = false;
  byId.fullBackupExportBtn.click();
  await settle();
  nativeExportCallback({ cancelled: true });
  assert.equal(byId.fullBackupStatus.textContent, context.DivinationI18n.t("fullBackup.exportCancelled"));

  byId.fullBackupExportBtn.click();
  await settle();
  nativeExportCallback({ ok: true, fileName: "saved.json" });
  assert.match(byId.fullBackupStatus.textContent, /saved\.json/);

  // Forbidden key rejected without opening preview or calling restore.
  byId.fullBackupImportInput.files = [{ name: "bad.json", size: 20, text: async () => '{"apiKey":"sk-x"}' }];
  byId.fullBackupImportInput.dispatch("change");
  await settle();
  assert.equal(byId.fullBackupPreview.hidden, true);
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.equal(restoreCalls.length, 0);

  // Valid file shows preview without restoring yet; cancel leaves stores untouched.
  byId.fullBackupImportInput.files = [{ name: "good.json", size: 100, text: async () => '{"ok":true}' }];
  byId.fullBackupImportInput.dispatch("change");
  await settle();
  assert.equal(byId.fullBackupPreview.hidden, false);
  assert.equal(byId.fullBackupPreviewList.children.length, 3);
  assert.equal(restoreCalls.length, 0);

  byId.fullBackupCancelBtn.click();
  assert.equal(byId.fullBackupPreview.hidden, true);
  assert.equal(restoreCalls.length, 0);

  // Re-open preview, uncheck preferences, confirm restore.
  byId.fullBackupImportInput.files = [{ name: "good.json", size: 100, text: async () => '{"ok":true}' }];
  byId.fullBackupImportInput.dispatch("change");
  await settle();
  const prefCheckbox = byId.fullBackupPreviewList.children[2].children[0].children[0];
  assert.equal(prefCheckbox.dataset.backupSection, "preferences");
  prefCheckbox.checked = false;
  prefCheckbox.dispatch("change");

  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.deepEqual(restoreCalls, [["history", "cardNotes"]]);
  assert.equal(byId.fullBackupPreview.hidden, true);
  assert.equal(byId.fullBackupSummary.hidden, false);
  assert.equal(byId.fullBackupSummaryList.children.length, 2);

  // Back closes dialog synchronously.
  assert.equal(ui.handleBack(), true);
  assert.equal(ui.isOpen(), false);
  assert.equal(ui.handleBack(), false);
});

test("full-backup UI delegates custom spreads to live controller, refreshes card notes, formats locale separator, and avoids #appMenu focus trap", async () => {
  function FakeElement(tag, id) {
    this.tagName = tag.toUpperCase();
    this.id = id || "";
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.type = "";
    this.value = "";
    this.open = false;
    this.isConnected = true;
    this.offsetParent = {};
    this.parentElement = null;
    this.dataset = {};
    this.children = [];
    this.listeners = Object.create(null);
    this.attributes = Object.create(null);
    this.focusedCount = 0;
    const self = this;
    this.classList = {
      contains: function (c) { return self.className.split(/\s+/).filter(Boolean).includes(c); },
      add: function (c) { if (!this.contains(c)) self.className = (self.className + " " + c).trim(); },
      remove: function (c) { self.className = self.className.split(/\s+/).filter(function (x) { return x && x !== c; }).join(" "); },
      toggle: function (c, force) {
        var on = typeof force === "boolean" ? force : !this.contains(c);
        if (on) this.add(c); else this.remove(c);
        return on;
      }
    };
  }
  FakeElement.prototype.appendChild = function (child) {
    if (child && child.isFragment) {
      child.children.forEach(c => { c.parentElement = this; this.children.push(c); });
      child.children = [];
      return child;
    }
    child.parentElement = this;
    this.children.push(child);
    return child;
  };
  FakeElement.prototype.replaceChildren = function (...nodes) {
    this.children = [];
    nodes.forEach(n => this.appendChild(n));
  };
  FakeElement.prototype.setAttribute = function (k, v) { this.attributes[k] = String(v); };
  FakeElement.prototype.getAttribute = function (k) { return this.attributes[k] || null; };
  FakeElement.prototype.removeAttribute = function (k) { delete this.attributes[k]; };
  FakeElement.prototype.hasAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attributes, k); };
  FakeElement.prototype.closest = function (selector) {
    let cur = this;
    while (cur) {
      if (selector === "#appMenu" && cur.id === "appMenu") return cur;
      if (selector === '[aria-hidden="true"]' && cur.attributes["aria-hidden"] === "true") return cur;
      cur = cur.parentElement;
    }
    return null;
  };
  FakeElement.prototype.addEventListener = function (type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  };
  FakeElement.prototype.dispatch = function (type, event = {}) {
    event.currentTarget = this;
    event.target = event.target || this;
    event.preventDefault = event.preventDefault || (() => {});
    event.stopPropagation = event.stopPropagation || (() => {});
    (this.listeners[type] || []).slice().forEach(fn => fn(event));
  };
  FakeElement.prototype.click = function () { this.dispatch("click"); };
  FakeElement.prototype.focus = function () { this.focusedCount += 1; };
  FakeElement.prototype.remove = function () {};
  FakeElement.prototype.showModal = function () { this.open = true; };
  FakeElement.prototype.close = function () { this.open = false; };
  Object.defineProperty(FakeElement.prototype, "childElementCount", {
    get() { return this.children.length; }
  });

  const ids = [
    "appMenu", "menuToggle",
    "fullBackupOpenBtn", "fullBackupDialog", "fullBackupCloseBtn", "fullBackupDialogTitle",
    "fullBackupStatus", "fullBackupRefreshBtn", "fullBackupLocalCounts", "fullBackupUnavailable",
    "fullBackupExportBtn", "fullBackupChooseBtn", "fullBackupImportInput", "fullBackupPreview",
    "fullBackupPreviewFile", "fullBackupPreviewTime", "fullBackupPreviewList",
    "fullBackupConfirmBtn", "fullBackupCancelBtn", "fullBackupSummary", "fullBackupSummaryList"
  ];
  const byId = Object.create(null);
  ids.forEach(id => { byId[id] = new FakeElement("div", id); });
  byId.appMenu.setAttribute("aria-hidden", "true");
  byId.appMenu.appendChild(byId.fullBackupOpenBtn);
  byId.fullBackupPreview.hidden = true;
  byId.fullBackupSummary.hidden = true;
  byId.fullBackupUnavailable.hidden = true;

  const doc = {
    readyState: "complete",
    body: new FakeElement("body"),
    getElementById: (id) => byId[id] || null,
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => Object.assign(new FakeElement("fragment"), { isFragment: true }),
    addEventListener: () => {}
  };

  let createLibraryFallbackCalled = false;
  const importedCodes = [];
  let cardNotesRefreshCount = 0;
  const dispatchedEvents = [];

  const liveCustomUi = {
    hasActiveController: () => true,
    list: () => [{ id: "custom-1" }],
    getById: (id) => id === "custom-1" ? { id: "custom-1" } : null,
    exportCode: () => "QSP1-LIVE",
    importCode: (code) => { importedCodes.push(code); return { id: "custom-2" }; }
  };

  const fakeCore = {
    SECTION_KEYS: ["history", "cardNotes", "customSpreads", "aiChats", "preferences"],
    MAX_BACKUP_BYTES: 16 * 1024 * 1024,
    async inspectLocalCounts(adapters) {
      assert.equal(adapters.customSpreadsLibrary.list().length, 1);
      assert.equal(adapters.customSpreadsLibrary.exportCode("custom-1"), "QSP1-LIVE");
      return { history: 0, cardNotes: 0, customSpreads: 1, aiChats: 0, preferences: 2, unavailable: ["history", "aiChats"] };
    },
    parseBackup() {
      return {
        format: "quareia-full-backup",
        version: 1,
        exportedAt: "2026-11-28T06:00:00.000Z",
        sections: {
          cardNotes: { notes: [{}] },
          customSpreads: { codes: ["QSP1-IMPORTED"] }
        },
        counts: { history: 0, cardNotes: 1, customSpreads: 1, aiChats: 0, preferences: 0 },
        availableSections: ["cardNotes", "customSpreads"]
      };
    },
    async restoreBackup(_parsed, _selected, adapters) {
      adapters.customSpreadsLibrary.importCode("QSP1-IMPORTED");
      return {
        restored: {
          cardNotes: { imported: 1, skipped: 0 },
          customSpreads: { imported: 1, skipped: 0 }
        },
        appliedPreferences: {},
        warnings: []
      };
    }
  };

  const i18n = require("../js/i18n.js");
  i18n.setLocale("en");

  const context = {
    document: doc,
    setTimeout,
    addEventListener: () => {},
    dispatchEvent: (ev) => { dispatchedEvents.push(ev); },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    DivinationI18n: i18n,
    DivinationTheme: { getTheme: () => "celestial" },
    DivinationMenu: { isOpen: () => false, close: () => {} },
    DivinationCustomSpreads: { createLibrary: () => { createLibraryFallbackCalled = true; return null; } },
    DivinationCustomSpreadUi: liveCustomUi,
    DivinationCardNotes: { refresh: async () => { cardNotesRefreshCount += 1; } },
    DivinationFullBackup: fakeCore
  };
  vm.runInNewContext(read("js/full-backup-ui.js"), context, { filename: "full-backup-ui.js" });

  const ui = context.DivinationFullBackupUi;
  const settle = () => new Promise(r => setImmediate(r));

  // Trigger from inside #appMenu even after DivinationMenu.isOpen() is already false.
  byId.fullBackupOpenBtn.click();
  await settle();
  assert.equal(createLibraryFallbackCalled, false);
  // English locale uses ", " separator (not Chinese "、") for unavailable modules.
  assert.match(byId.fullBackupUnavailable.textContent, /Reading History, AI Chats/);
  assert.doesNotMatch(byId.fullBackupUnavailable.textContent, /、/);

  // Chinese locale uses "、" separator.
  i18n.setLocale("zh-CN");
  ui.refreshLanguage();
  assert.match(byId.fullBackupUnavailable.textContent, /占卜历史、AI 对话记录/);

  // Restoring cardNotes + customSpreads calls live customSpreads UI & DivinationCardNotes.refresh().
  byId.fullBackupImportInput.files = [{ name: "backup.json", size: 64, text: async () => "{}" }];
  byId.fullBackupImportInput.dispatch("change");
  await settle();
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.deepEqual(importedCodes, ["QSP1-IMPORTED"]);
  assert.equal(cardNotesRefreshCount, 1);
  assert.equal(dispatchedEvents.length, 1);
  assert.equal(dispatchedEvents[0].type, "quareia:fullbackuprestored");
  assert.equal(dispatchedEvents[0].detail.cardNotesRefreshed, true);

  // Closing returns focus to #menuToggle, NEVER to #fullBackupOpenBtn inside #appMenu[aria-hidden="true"].
  assert.equal(ui.handleBack(), true);
  assert.equal(byId.menuToggle.focusedCount, 1);
  assert.equal(byId.fullBackupOpenBtn.focusedCount, 0);
});
