"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var historyUi = fs.readFileSync(path.join(root, "js", "history-ui.js"), "utf8");
var app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
var androidHistoryUi = fs.readFileSync(
  path.join(root, "android-demo/app/src/main/assets/www/js/history-ui.js"),
  "utf8"
);
var historyRecords = fs.readFileSync(path.join(root, "js", "history-records.js"), "utf8");
var androidHistoryRecords = fs.readFileSync(
  path.join(root, "android-demo/app/src/main/assets/www/js/history-records.js"),
  "utf8"
);
var androidMainActivity = fs.readFileSync(
  path.join(root, "android-demo/app/src/main/java/com/quareia/divination/MainActivity.kt"),
  "utf8"
);
var historyUiApi = require("../js/history-ui.js");

test("history UI never renders imported data through innerHTML", function () {
  assert.equal(/\binnerHTML\b/.test(historyUi), false);
  assert.match(historyUi, /textContent/);
  assert.match(historyUi, /replaceChildren/);
});

test("history center has no notes, questions, titles or free-text editing controls", function () {
  var historyStart = html.indexOf('<dialog class="history-dialog" id="historyDialog"');
  var historyEnd = html.indexOf("</dialog>", historyStart);
  assert.ok(historyStart >= 0, "history dialog must exist");
  assert.ok(historyEnd > historyStart, "history dialog must close");
  var historyHtml = html.slice(historyStart, historyEnd);
  assert.equal(/<textarea\b/i.test(historyHtml), false);
  assert.equal(/\bcontenteditable\b/i.test(historyHtml), false);
  var inputs = historyHtml.match(/<input\b[^>]*>/gi) || [];
  assert.deepEqual(inputs.map(function (input) {
    return (input.match(/\btype="([^"]+)"/i) || [null, "text"])[1].toLowerCase();
  }), ["file"]);
});

test("history modules load before the application module", function () {
  var recordsIndex = html.indexOf("js/history-records.js");
  var storeIndex = html.indexOf("js/history-store.js");
  var uiIndex = html.indexOf("js/history-ui.js");
  var appIndex = html.indexOf("js/app.js");
  assert.ok(recordsIndex > 0);
  assert.ok(recordsIndex < storeIndex);
  assert.ok(storeIndex < uiIndex);
  assert.ok(uiIndex < appIndex);
});

test("Free Board resources load after their model and before the application", function () {
  var freeBoardModelIndex = html.indexOf("js/free-board-model.js");
  var freeBoardDraftIndex = html.indexOf("js/free-board-draft.js");
  var recordsIndex = html.indexOf("js/history-records.js");
  var historyUiIndex = html.indexOf("js/history-ui.js");
  var freeBoardUiIndex = html.indexOf("js/free-board-ui.js");
  var appIndex = html.indexOf("js/app.js");
  var freeBoardUi = fs.readFileSync(path.join(root, "js", "free-board-ui.js"), "utf8");
  var freeBoardCss = fs.readFileSync(path.join(root, "css", "free-board.css"), "utf8");

  assert.match(html, /href="css\/free-board\.css\?v=20260813-parchment-panels"/);
  assert.ok(freeBoardModelIndex < freeBoardDraftIndex);
  assert.ok(freeBoardDraftIndex < recordsIndex);
  assert.ok(recordsIndex < historyUiIndex);
  assert.ok(historyUiIndex < freeBoardUiIndex);
  assert.ok(freeBoardUiIndex < appIndex);
  assert.match(html, /id="layoutModeSelect"/);
  assert.match(html, /value="freeform"[^>]*data-i18n="layout\.freeform"/);
  assert.match(html, /id="freeBoardViewport"/);
  assert.doesNotMatch(freeBoardUi, /<canvas|createElement\(["']canvas/);
  assert.match(freeBoardUi, /boardRotation/);
  assert.match(freeBoardUi, /data-orientation/);
  assert.match(freeBoardCss, /\.free-board-viewport[\s\S]*touch-action: none/);
  assert.match(freeBoardCss, /\.free-board-viewport[\s\S]*overscroll-behavior: contain/);
});

test("opening a completed reading saves automatically without a manual save control", function () {
  assert.equal(/id="saveHistoryBtn"/.test(html), false);
  assert.equal(/getElementById\("saveHistoryBtn"\)/.test(historyUi), false);
  assert.match(app, /historyUiController\.saveCompletedReading\(\)/);
  assert.match(historyUi, /saveCompletedReading:\s*saveCurrentReading/);
});

test("automatic saves are queued without dropping a different reading", async function () {
  var enqueue = historyUiApi.createSerialTaskQueue();
  var events = [];
  var releaseFirst;
  var firstGate = new Promise(function (resolve) { releaseFirst = resolve; });
  var first = enqueue(async function () {
    events.push("first:start");
    await firstGate;
    events.push("first:end");
  });
  var second = enqueue(async function () {
    events.push("second:start");
    events.push("second:end");
  });

  await Promise.resolve();
  assert.deepEqual(events, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});

test("extreme Free Board history coordinates keep cards readable", function () {
  var layout = historyUiApi.calculateFreeformPreviewLayout([
    { x: -1000000, y: -1000000 },
    { x: 1000000, y: 1000000 }
  ]);

  assert.equal(layout.cardScale, 0.5);
  assert.ok(layout.cardWidth * layout.cardScale >= 52);
  assert.ok(layout.cardHeight * layout.cardScale >= 79);
  assert.ok(layout.stageWidth <= 596);
  assert.ok(layout.stageHeight <= 376);
});

test("Free Board history details show order only and keep spatial rendering dormant", function () {
  var freeformCardRenderer = historyUi.slice(
    historyUi.indexOf("function renderFreeformCard"),
    historyUi.indexOf("function renderFreeformBoard")
  );
  var androidFreeformCardRenderer = androidHistoryUi.slice(
    androidHistoryUi.indexOf("function renderFreeformCard"),
    androidHistoryUi.indexOf("function renderFreeformBoard")
  );
  var detailRenderer = historyUi.slice(
    historyUi.indexOf("function showDetail"),
    historyUi.indexOf("async function refreshList")
  );
  var androidDetailRenderer = androidHistoryUi.slice(
    androidHistoryUi.indexOf("function showDetail"),
    androidHistoryUi.indexOf("async function refreshList")
  );

  assert.ok(freeformCardRenderer.length > 0);
  assert.doesNotMatch(freeformCardRenderer, /\b(?:x|y|boardRotation|z)\b/);
  assert.match(freeformCardRenderer, /t\("freeBoard\.drawOrder", \{ order: positionNumber \}\)/);
  assert.match(androidFreeformCardRenderer, /t\("freeBoard\.drawOrder", \{ order: positionNumber \}\)/);
  assert.doesNotMatch(detailRenderer, /renderFreeformBoard\(record\)/);
  assert.doesNotMatch(detailRenderer, /\.sort\(function \(a, b\) \{ return a\.z/);
  assert.match(detailRenderer, /forEach\(function \(card, index\)/);
  assert.match(detailRenderer, /renderFreeformCard\(record, card, index \+ 1\)/);
  assert.doesNotMatch(androidDetailRenderer, /renderFreeformBoard\(record\)/);
  assert.match(androidDetailRenderer, /renderFreeformCard\(record, card, index \+ 1\)/);
  assert.match(detailRenderer, /drawOrder/);
  assert.match(androidDetailRenderer, /drawOrder/);
  assert.equal(historyRecords, androidHistoryRecords);
});

test("Android history export uses the system save picker and reports completion", function () {
  assert.match(androidHistoryUi, /androidHistoryExport/);
  assert.match(androidHistoryUi, /nativeBridge\.save\(json, fileName\)/);
  assert.match(androidHistoryUi, /__quareiaHistoryExportResult/);
  assert.match(androidHistoryUi, /history\.exportChoosing/);
  assert.match(androidHistoryUi, /history\.exportedTo/);
  assert.match(androidMainActivity, /ActivityResultContracts\.CreateDocument\("application\/json"\)/);
  assert.match(androidMainActivity, /contentResolver\.openOutputStream\(uri, "w"\)/);
  assert.match(androidMainActivity, /OpenableColumns\.DISPLAY_NAME/);
  assert.equal(typeof historyUiApi.canRenderActualSpread, "function");

  var spreads = require("../js/spreads.js");
  var threeCard = spreads.getSpreadById("tarot", "three-card-horizontal");
  var presetRecord = {
    id: "rec-preset-1",
    createdAt: "2026-08-20T10:00:00.000Z",
    deckType: "tarot",
    deckName: "RWS 塔罗",
    spreadId: "three-card-horizontal",
    spreadName: "三张横排牌阵",
    orientationMode: "mixed",
    cards: [
      { cardId: "major-00", cardNumber: 0, cardName: "愚者", orientation: "upright", slotIndex: 0, positionNumber: 1, positionName: "过去" },
      { cardId: "major-01", cardNumber: 1, cardName: "魔术师", orientation: "reversed", slotIndex: 1, positionNumber: 2, positionName: "现在" },
      { cardId: "major-02", cardNumber: 2, cardName: "女祭司", orientation: "upright", slotIndex: 2, positionNumber: 3, positionName: "未来" }
    ]
  };
  var freeformRecord = {
    id: "rec-free-1",
    createdAt: "2026-08-20T10:05:00.000Z",
    layoutMode: "freeform",
    deckType: "tarot",
    deckName: "RWS 塔罗",
    spreadId: "free-board",
    spreadName: "自由画板",
    orientationMode: "upright-only",
    cards: [
      { cardId: "major-00", cardNumber: 0, cardName: "愚者", orientation: "upright", drawOrder: 1, x: 10, y: 20, z: 1, boardRotation: 0, revealed: true }
    ]
  };

  assert.equal(historyUiApi.canRenderActualSpread(presetRecord, threeCard), true);
  assert.equal(historyUiApi.canRenderActualSpread(freeformRecord, threeCard), false);
  assert.equal(historyUiApi.canRenderActualSpread(presetRecord, null), false);
  assert.match(historyUi, /history-actual-layout-btn/);
  assert.match(historyUi, /renderActualSpreadBoard\(record, spread\)/);
  assert.match(historyUi, /classList\.toggle\("meaning-visible"\)/);
  assert.match(androidHistoryUi, /history-actual-layout-btn/);
  assert.match(androidHistoryUi, /renderActualSpreadBoard\(record, spread\)/);
  assert.match(androidHistoryUi, /classList\.toggle\("meaning-visible"\)/);
});

test("Actual Layout board reconstructs coordinates, flips to card meaning, preserves state across locale switch, and skips Free Board", async function () {
  var spreads = require("../js/spreads.js");
  var tarotData = require("../js/tarot-data.js");
  var i18nDataEn = require("../js/i18n-data-en.js");
  var i18n = require("../js/i18n.js");
  globalThis.getSpreadById = spreads.getSpreadById;
  globalThis.tarotDeckFull = tarotData.tarotDeckFull;
  if (i18nDataEn && typeof i18nDataEn.enrichTarot === "function") {
    i18nDataEn.enrichTarot(globalThis.tarotDeckFull);
  }
  globalThis.DivinationI18n = i18n;
  i18n.setLocale("zh-CN");

  function FakeElement(tag) {
    this.tagName = tag.toUpperCase();
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "all";
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {
      props: {},
      setProperty: function (k, v) { this.props[k] = v; }
    };
    var self = this;
    this.classList = {
      contains: function (cls) {
        return self.className.split(/\s+/).filter(Boolean).indexOf(cls) !== -1;
      },
      add: function (cls) {
        if (!this.contains(cls)) self.className = (self.className + " " + cls).trim();
      },
      remove: function (cls) {
        self.className = self.className.split(/\s+/).filter(function (c) { return c && c !== cls; }).join(" ");
      },
      toggle: function (cls, force) {
        var shouldAdd = typeof force === "boolean" ? force : !this.contains(cls);
        if (shouldAdd) this.add(cls);
        else this.remove(cls);
        return shouldAdd;
      }
    };
  }
  FakeElement.prototype.appendChild = function (child) {
    this.children.push(child);
    return child;
  };
  FakeElement.prototype.replaceChildren = function () {
    this.children = [];
  };
  FakeElement.prototype.setAttribute = function (k, v) {
    this.attributes[k] = String(v);
  };
  FakeElement.prototype.getAttribute = function (k) {
    return this.attributes[k] || null;
  };
  FakeElement.prototype.removeAttribute = function (k) {
    delete this.attributes[k];
  };
  FakeElement.prototype.addEventListener = function (type, fn) {
    (this.listeners[type] || (this.listeners[type] = [])).push(fn);
  };
  FakeElement.prototype.click = function () {
    (this.listeners.click || []).slice().forEach(function (fn) {
      fn({ preventDefault: function () {}, target: {} });
    });
  };
  FakeElement.prototype.focus = function () {};
  FakeElement.prototype.querySelector = function (selector) {
    return this.querySelectorAll(selector)[0] || null;
  };
  FakeElement.prototype.querySelectorAll = function (selector) {
    var out = [];
    function visit(node) {
      node.children.forEach(function (child) {
        if (selector.charAt(0) === "." && child.classList.contains(selector.slice(1))) {
          out.push(child);
        }
        visit(child);
      });
    }
    visit(this);
    return out;
  };

  var ids = [
    "historyOpenBtn", "historySaveStatus", "historyDialog", "historyCloseBtn",
    "historyDeckFilter", "historyExportBtn", "historyImportInput", "historyImportLabel",
    "historyActionStatus", "historyList", "historyEmpty", "historyDetail",
    "historyDetailTitle", "historyDetailBody", "historyBackBtn", "historyDeleteBtn",
    "historyClearBtn"
  ];
  var byIdMap = {};
  ids.forEach(function (id) { byIdMap[id] = new FakeElement("div"); });

  var records = [
    {
      id: "rec-preset-cross",
      createdAt: "2026-08-20T10:00:00.000Z",
      deckType: "tarot",
      deckName: "RWS 塔罗",
      spreadId: "three-card-horizontal",
      spreadName: "简易十字牌阵",
      orientationMode: "mixed",
      cards: [
        { cardId: "major-00", cardNumber: 0, cardName: "愚者", orientation: "upright", slotIndex: 0, positionNumber: 1, positionName: "核心" },
        { cardId: "major-01", cardNumber: 1, cardName: "魔术师", orientation: "reversed", slotIndex: 1, positionNumber: 2, positionName: "阻碍" },
        { cardId: "major-02", cardNumber: 2, cardName: "女祭司", orientation: "upright", slotIndex: 2, positionNumber: 3, positionName: "未来" }

      ]
    },
    {
      id: "rec-freeform",
      createdAt: "2026-08-20T10:05:00.000Z",
      layoutMode: "freeform",
      deckType: "tarot",
      deckName: "RWS 塔罗",
      spreadId: "free-board",
      spreadName: "自由画板",
      orientationMode: "upright-only",
      cards: [
        { cardId: "major-00", cardNumber: 0, cardName: "愚者", orientation: "upright", drawOrder: 1, x: 10, y: 20, z: 1, boardRotation: 0, revealed: true }
      ]
    }
  ];

  var prevDocument = globalThis.document;
  globalThis.document = {
    activeElement: null,
    documentElement: {},
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    getElementById: function (id) { return byIdMap[id] || null; },
    createElement: function (tag) { return new FakeElement(tag); }
  };

  try {
    var controller = historyUiApi.init({
      store: {
        open: function () { return Promise.resolve(); },
        listRecords: function () { return Promise.resolve(records); }
      }
    });
    await new Promise(function (resolve) { setImmediate(resolve); });
    await controller.refresh();

    var openPresetBtn = byIdMap.historyList.children[0].children[0];
    openPresetBtn.click();

    var toggleBtn = byIdMap.historyDetailBody.querySelector(".history-actual-layout-btn");
    var layoutSection = byIdMap.historyDetailBody.querySelector(".history-actual-layout");
    assert.ok(toggleBtn, "preset record must render Actual Layout toggle button");
    assert.ok(layoutSection, "preset record must render Actual Layout section");
    assert.equal(layoutSection.hidden, true);
    assert.equal(toggleBtn.textContent, "实际摆放");
    assert.equal(toggleBtn.getAttribute("aria-expanded"), "false");

    toggleBtn.click();
    assert.equal(layoutSection.hidden, false);
    assert.equal(toggleBtn.textContent, "收起实际摆放");
    assert.equal(toggleBtn.getAttribute("aria-expanded"), "true");

    var boardCards = layoutSection.querySelectorAll(".history-spread-card");
    assert.equal(boardCards.length, 3);
    assert.equal(boardCards[1].style.gridColumn, "2 / span 1");
    assert.equal(boardCards[1].style.gridRow, "1 / span 1");

    var firstFlip = boardCards[0].querySelector(".spread-card-flip");
    assert.equal(boardCards[0].classList.contains("meaning-visible"), false);
    assert.equal(firstFlip.getAttribute("aria-pressed"), "false");
    firstFlip.click();
    assert.equal(boardCards[0].classList.contains("meaning-visible"), true);
    assert.equal(firstFlip.getAttribute("aria-pressed"), "true");

    i18n.setLocale("en");
    await controller.refreshLanguage();
    var toggleBtnEn = byIdMap.historyDetailBody.querySelector(".history-actual-layout-btn");
    var layoutSectionEn = byIdMap.historyDetailBody.querySelector(".history-actual-layout");
    assert.equal(layoutSectionEn.hidden, false);
    assert.equal(toggleBtnEn.textContent, "Hide Actual Layout");

    i18n.setLocale("zh-CN");
    await controller.refresh();
    var openFreeformBtn = byIdMap.historyList.children[1].children[0];
    openFreeformBtn.click();
    assert.equal(byIdMap.historyDetailBody.querySelector(".history-actual-layout-btn"), null);
    assert.equal(byIdMap.historyDetailBody.querySelector(".history-actual-layout"), null);
  } finally {
    globalThis.document = prevDocument;
    i18n.setLocale("zh-CN");
  }
});
