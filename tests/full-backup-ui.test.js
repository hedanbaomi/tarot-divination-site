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
  for (const rel of ["js/full-backup-ui.js", "css/full-backup.css", "js/custom-spread-ui.js", "js/card-notes.js", "js/history-store.js"]) {
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

test("full-backup UI keeps preview open on all-failed/partial restore, supports retry, and blocks oversize exports with section details", async () => {
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
  ids.forEach(id => { byId[id] = new FakeElement("div", id); });
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

  let blobCalls = 0;
  let nativeSaveCalls = 0;
  let cardNotesRefreshCount = 0;
  let restoreMode = "allFailed";
  const restoreLog = [];
  const dispatchedEvents = [];

  const fakeCore = {
    SECTION_KEYS: ["history", "cardNotes", "customSpreads", "aiChats", "preferences"],
    MAX_BACKUP_BYTES: 16 * 1024 * 1024,
    async inspectLocalCounts() {
      return { history: 0, cardNotes: 0, customSpreads: 0, aiChats: 0, preferences: 2, unavailable: [] };
    },
    async collectBackup() {
      const err = new Error("history exceeds 5 MiB limit");
      err.code = "export_too_large";
      err.totalBytes = 6.2 * 1024 * 1024;
      err.maxBytes = 16 * 1024 * 1024;
      err.oversizedSections = [
        { section: "history", bytes: Math.round(6.2 * 1024 * 1024), maxBytes: 5 * 1024 * 1024 }
      ];
      throw err;
    },
    parseBackup() {
      return {
        format: "quareia-full-backup",
        version: 1,
        exportedAt: "2026-11-28T06:00:00.000Z",
        sections: {
          history: { records: [{}] },
          cardNotes: { notes: [{}] }
        },
        counts: { history: 1, cardNotes: 1, customSpreads: 0, aiChats: 0, preferences: 0 },
        availableSections: ["history", "cardNotes"]
      };
    },
    async restoreBackup(_parsed, selected) {
      restoreLog.push(selected.slice());
      if (restoreMode === "allFailed") {
        return {
          status: "failed",
          succeededSections: [],
          failedSections: [{ section: "cardNotes", code: "storage_error", message: "cardNotes: IndexedDB refused open" }],
          restored: { cardNotes: { imported: 0, skipped: 0 } },
          appliedPreferences: {},
          warnings: ["cardNotes: IndexedDB refused open"]
        };
      }
      if (restoreMode === "partial") {
        return {
          status: "partial",
          succeededSections: ["history"],
          failedSections: [{ section: "cardNotes", code: "storage_error", message: "cardNotes: Quota exceeded" }],
          restored: {
            history: { imported: 1, remapped: 0, skipped: 0 },
            cardNotes: { imported: 0, skipped: 0 }
          },
          appliedPreferences: {},
          warnings: ["cardNotes: Quota exceeded"]
        };
      }
      return {
        status: "ok",
        succeededSections: selected.slice(),
        failedSections: [],
        restored: {
          history: { imported: 1, remapped: 0, skipped: 0 },
          cardNotes: { imported: 1, skipped: 0 }
        },
        appliedPreferences: {},
        warnings: []
      };
    }
  };

  const i18n = require("../js/i18n.js");
  i18n.setLocale("zh-CN");

  const context = {
    document: doc,
    setTimeout,
    addEventListener: () => {},
    dispatchEvent: (ev) => { dispatchedEvents.push(ev); },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    Blob: function () { blobCalls += 1; },
    URL: { createObjectURL: () => { blobCalls += 1; return "blob:x"; }, revokeObjectURL: () => {} },
    DivinationI18n: i18n,
    DivinationTheme: { getTheme: () => "celestial" },
    DivinationCardNotes: { refresh: async () => { cardNotesRefreshCount += 1; } },
    DivinationFullBackup: fakeCore,
    androidHistoryExport: { save: () => { nativeSaveCalls += 1; return true; } },
    DivinationNativeFileExport: { save: () => { nativeSaveCalls += 1; return true; } }
  };
  vm.runInNewContext(read("js/full-backup-ui.js"), context, { filename: "full-backup-ui.js" });

  const ui = context.DivinationFullBackupUi;
  const settle = () => new Promise(r => setImmediate(r));
  const getCheckboxes = () => byId.fullBackupPreviewList.children.map(li => li.children[0].children[0]);

  byId.fullBackupOpenBtn.click();
  await settle();

  // 1. export_too_large blocks both Web Blob download and Android native picker, naming the oversized module.
  byId.fullBackupExportBtn.click();
  await settle();
  assert.equal(blobCalls, 0);
  assert.equal(nativeSaveCalls, 0);
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.equal(byId.fullBackupStatus.classList.contains("is-success"), false);
  assert.match(byId.fullBackupStatus.textContent, /占卜历史/);
  assert.match(byId.fullBackupStatus.textContent, /6\.20 MiB/);
  assert.match(byId.fullBackupStatus.textContent, /5\.00 MiB/);
  // Switching language re-localizes the oversize error message cleanly.
  i18n.setLocale("en");
  ui.refreshLanguage();
  assert.match(byId.fullBackupStatus.textContent, /Reading History/);
  assert.match(byId.fullBackupStatus.textContent, /6\.20 MiB/);
  i18n.setLocale("zh-CN");
  ui.refreshLanguage();

  // 2. All-failed restore: select only cardNotes -> error style, preview stays open & retryable.
  byId.fullBackupImportInput.files = [{ name: "backup.json", size: 120, text: async () => "{}" }];
  byId.fullBackupImportInput.dispatch("change");
  await settle();
  let boxes = getCheckboxes();
  assert.equal(boxes.length, 2);
  boxes[0].checked = false;
  boxes[0].dispatch("change");
  assert.equal(boxes[1].dataset.backupSection, "cardNotes");

  restoreMode = "allFailed";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.deepEqual(restoreLog, [["cardNotes"]]);
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.equal(byId.fullBackupStatus.classList.contains("is-success"), false);
  assert.equal(byId.fullBackupPreview.hidden, false, "preview must stay open on all-failed restore");
  assert.equal(byId.fullBackupConfirmBtn.disabled, false, "confirm button must stay enabled for retry");
  assert.equal(byId.fullBackupSummary.hidden, false);
  assert.equal(byId.fullBackupSummary.classList.contains("is-error"), true);
  assert.equal(byId.fullBackupSummaryList.children.length, 1, "no duplicate warning line when failure already shown");
  assert.match(byId.fullBackupSummaryList.children[0].textContent, /卡牌笔记：恢复失败.*IndexedDB refused open/);
  assert.equal(cardNotesRefreshCount, 0, "failed cardNotes must not trigger refresh");
  assert.equal(dispatchedEvents.length, 0, "all-failed restore must not emit restored event");

  // Retry succeeds without re-picking file.
  restoreMode = "ok";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.deepEqual(restoreLog, [["cardNotes"], ["cardNotes"]]);
  assert.equal(byId.fullBackupStatus.classList.contains("is-success"), true);
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), false);
  assert.equal(byId.fullBackupPreview.hidden, true);
  assert.equal(byId.fullBackupSummary.classList.contains("is-error"), false);
  assert.equal(cardNotesRefreshCount, 1);

  // 3. Partial-failed restore: history succeeds, cardNotes fails -> ONLY cardNotes stays checked!
  byId.fullBackupImportInput.files = [{ name: "backup.json", size: 120, text: async () => "{}" }];
  byId.fullBackupImportInput.dispatch("change");
  await settle();
  restoreMode = "partial";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.deepEqual(restoreLog[2], ["history", "cardNotes"]);
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.equal(byId.fullBackupStatus.classList.contains("is-success"), false);
  assert.match(byId.fullBackupStatus.textContent, /部分恢复完成.*1.*1.*卡牌笔记/);
  assert.equal(byId.fullBackupPreview.hidden, false, "preview must stay open on partial restore");
  assert.equal(byId.fullBackupSummary.classList.contains("is-error"), true);
  assert.equal(byId.fullBackupSummaryList.children.length, 2);
  assert.match(byId.fullBackupSummaryList.children[0].textContent, /占卜历史：导入 1 条/);
  assert.match(byId.fullBackupSummaryList.children[1].textContent, /卡牌笔记：恢复失败.*Quota exceeded/);

  boxes = getCheckboxes();
  assert.equal(boxes[0].dataset.backupSection, "history");
  assert.equal(boxes[0].checked, false, "succeeded section must be unchecked after partial restore");
  assert.equal(boxes[1].dataset.backupSection, "cardNotes");
  assert.equal(boxes[1].checked, true, "failed section must stay checked for one-click retry");

  // One-click retry only retries cardNotes and clears preview once complete.
  restoreMode = "ok";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.deepEqual(restoreLog[3], ["cardNotes"]);
  assert.equal(byId.fullBackupStatus.classList.contains("is-success"), true);
  assert.equal(byId.fullBackupPreview.hidden, true);
  assert.equal(byId.fullBackupSummary.classList.contains("is-error"), false);
});

test("full-backup UI renders localized copy and retry state for history_dependency_required, history_dependency_failed, and preferences_persist_failed", async () => {
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
  ids.forEach(id => { byId[id] = new FakeElement("div", id); });
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

  let mode = "depRequired";
  const fakeCore = {
    SECTION_KEYS: ["history", "cardNotes", "customSpreads", "aiChats", "preferences"],
    MAX_BACKUP_BYTES: 16 * 1024 * 1024,
    async inspectLocalCounts() {
      return { history: 1, cardNotes: 0, customSpreads: 0, aiChats: 0, preferences: 2, unavailable: [] };
    },
    parseBackup() {
      return {
        format: "quareia-full-backup",
        version: 1,
        exportedAt: "2026-11-28T06:00:00.000Z",
        sections: {
          history: { records: [{}] },
          aiChats: { conversations: [{}] },
          preferences: { theme: "parchment", locale: "en" }
        },
        counts: { history: 1, cardNotes: 0, customSpreads: 0, aiChats: 1, preferences: 2 },
        availableSections: ["history", "aiChats", "preferences"]
      };
    },
    async restoreBackup() {
      if (mode === "depRequired") {
        return {
          status: "failed",
          succeededSections: [],
          failedSections: [{ section: "aiChats", code: "history_dependency_required", message: "aiChats: colliding history required first" }],
          restored: { aiChats: { imported: 0, updated: 0, skipped: 0 } },
          appliedPreferences: {},
          warnings: ["aiChats: colliding history required first"]
        };
      }
      if (mode === "depFailed") {
        return {
          status: "failed",
          succeededSections: [],
          failedSections: [
            { section: "history", code: "storage_limit", message: "history: max 5000 records reached" },
            { section: "aiChats", code: "history_dependency_failed", message: "aiChats: deferred after history failure" }
          ],
          restored: {
            history: { imported: 0, remapped: 0, skipped: 0 },
            aiChats: { imported: 0, updated: 0, skipped: 0 }
          },
          appliedPreferences: {},
          warnings: ["history: max 5000 records reached", "aiChats: deferred after history failure"]
        };
      }
      if (mode === "checkFailed") {
        return {
          status: "failed",
          succeededSections: [],
          failedSections: [{ section: "aiChats", code: "history_check_failed", message: "aiChats: historyStore listRecords failed" }],
          restored: { aiChats: { imported: 0, updated: 0, skipped: 0 } },
          appliedPreferences: {},
          warnings: ["aiChats: historyStore listRecords failed"]
        };
      }
      if (mode === "conflictUnresolved") {
        return {
          status: "failed",
          succeededSections: [],
          failedSections: [{ section: "aiChats", code: "history_conflict_unresolved", message: "aiChats: colliding ID has no snapshot" }],
          restored: { aiChats: { imported: 0, updated: 0, skipped: 0 } },
          appliedPreferences: {},
          warnings: ["aiChats: colliding ID has no snapshot"]
        };
      }
      return {
        status: "failed",
        succeededSections: [],
        failedSections: [{ section: "preferences", code: "preferences_persist_failed", message: "preferences: QuotaExceededError" }],
        restored: { preferences: { theme: null, locale: null, applied: 0 } },
        appliedPreferences: {},
        warnings: ["preferences: QuotaExceededError"]
      };
    }
  };

  const i18n = require("../js/i18n.js");
  i18n.setLocale("zh-CN");
  const context = {
    document: doc,
    setTimeout,
    addEventListener: () => {},
    dispatchEvent: () => {},
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    DivinationI18n: i18n,
    DivinationTheme: { getTheme: () => "celestial" },
    DivinationFullBackup: fakeCore
  };
  vm.runInNewContext(read("js/full-backup-ui.js"), context, { filename: "full-backup-ui.js" });

  const ui = context.DivinationFullBackupUi;
  const settle = () => new Promise(r => setImmediate(r));
  const getBox = (sec) => byId.fullBackupPreviewList.children
    .map(li => li.children[0].children[0])
    .find(box => box.dataset.backupSection === sec);

  byId.fullBackupOpenBtn.click();
  await settle();
  byId.fullBackupImportInput.files = [{ name: "dep.json", size: 100, text: async () => "{}" }];
  byId.fullBackupImportInput.dispatch("change");
  await settle();

  // 1) history_dependency_required (aiChats only)
  getBox("history").checked = false; getBox("history").dispatch("change");
  getBox("preferences").checked = false; getBox("preferences").dispatch("change");
  mode = "depRequired";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.match(byId.fullBackupStatus.textContent, /需要先恢复占卜历史/);
  assert.equal(byId.fullBackupPreview.hidden, false);
  assert.equal(byId.fullBackupSummaryList.children.length, 1);
  assert.equal(byId.fullBackupSummaryList.children[0].dataset.backupFailureCode, "history_dependency_required");
  assert.match(byId.fullBackupSummaryList.children[0].textContent, /需要先恢复占卜历史/);
  i18n.setLocale("en");
  ui.refreshLanguage();
  assert.match(byId.fullBackupStatus.textContent, /Reading History required first/);
  assert.match(byId.fullBackupSummaryList.children[0].textContent, /Reading History required first/);

  // 2) history_dependency_failed (history + aiChats both fail)
  getBox("history").checked = true; getBox("history").dispatch("change");
  mode = "depFailed";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.equal(byId.fullBackupPreview.hidden, false);
  assert.equal(byId.fullBackupSummaryList.children.length, 2);
  assert.equal(byId.fullBackupSummaryList.children[1].dataset.backupFailureCode, "history_dependency_failed");
  assert.match(byId.fullBackupSummaryList.children[1].textContent, /Deferred: colliding Reading History/);
  i18n.setLocale("zh-CN");
  ui.refreshLanguage();
  assert.match(byId.fullBackupSummaryList.children[1].textContent, /已暂缓恢复：关联的冲突占卜历史/);

  // 3) preferences_persist_failed
  getBox("history").checked = false; getBox("history").dispatch("change");
  getBox("aiChats").checked = false; getBox("aiChats").dispatch("change");
  getBox("preferences").checked = true; getBox("preferences").dispatch("change");
  mode = "prefsFailed";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.match(byId.fullBackupStatus.textContent, /无法将主题或语言偏好写入本机存储/);
  assert.equal(byId.fullBackupPreview.hidden, false);
  assert.equal(getBox("preferences").checked, true);
  assert.equal(byId.fullBackupSummaryList.children.length, 1);
  assert.equal(byId.fullBackupSummaryList.children[0].dataset.backupFailureCode, "preferences_persist_failed");
  i18n.setLocale("en");
  ui.refreshLanguage();
  assert.match(byId.fullBackupStatus.textContent, /Could not save Theme\/Language preferences/);

  // 4) history_check_failed & history_conflict_unresolved
  getBox("preferences").checked = false; getBox("preferences").dispatch("change");
  getBox("aiChats").checked = true; getBox("aiChats").dispatch("change");
  mode = "checkFailed";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.match(byId.fullBackupStatus.textContent, /Could not read local reading history/);
  assert.equal(byId.fullBackupSummaryList.children[0].dataset.backupFailureCode, "history_check_failed");
  i18n.setLocale("zh-CN");
  ui.refreshLanguage();
  assert.match(byId.fullBackupStatus.textContent, /无法读取本机占卜历史/);

  mode = "conflictUnresolved";
  byId.fullBackupConfirmBtn.click();
  await settle();
  assert.equal(byId.fullBackupStatus.classList.contains("is-error"), true);
  assert.match(byId.fullBackupStatus.textContent, /缺少牌面快照以安全分离/);
  assert.equal(byId.fullBackupSummaryList.children[0].dataset.backupFailureCode, "history_conflict_unresolved");
  i18n.setLocale("en");
  ui.refreshLanguage();
  assert.match(byId.fullBackupStatus.textContent, /without a card snapshot to safely detach/);
});
