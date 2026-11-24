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

test("history edits only a reading-level question and retains the JSON backup controls on every surface", function () {
  for (const assets of ["", "android-demo/app/src/main/assets/www"]) {
    for (const page of ["index.html", "classic.html"]) {
      const source = fs.readFileSync(path.join(root, assets, page), "utf8");
      const dialog = source.match(/<dialog class="history-dialog"[\s\S]+?<\/dialog>/)[0];
      assert.doesNotMatch(dialog, /\bcontenteditable\b/i);
      assert.deepEqual(Array.from(dialog.matchAll(/<textarea\b[^>]* id="([^"]+)"/gi), m => m[1]), ["historyQuestionInput"]);
      assert.match(dialog, /id="historySearch" type="search"/);
      assert.match(dialog, /id="historyImportInput" type="file"/);
      const limit = require("../js/history-records.js").MAX_QUESTION_LENGTH;
      for (const id of ["readingQuestion", "historyQuestionInput"]) {
        assert.ok(source.match(new RegExp('<textarea[^>]+id="' + id + '"[^>]*>'))[0].includes('maxlength="' + limit + '"'));
      }
      assert.ok(source.indexOf("js/history-markdown.js") < source.indexOf("js/history-ui.js"));
      assert.ok(source.indexOf("js/history-stats.js") < source.indexOf("js/history-ui.js"));
    }
  }
});

test("question editors and exports have no network or telemetry side effects", function () {
  for (const assets of ["", "android-demo/app/src/main/assets/www"]) {
    for (const name of ["history-ui", "history-markdown", "history-stats", "history-store", "history-records"]) {
      const source = fs.readFileSync(path.join(root, assets, "js", name + ".js"), "utf8");
      assert.doesNotMatch(source, /\b(?:fetch|sendBeacon|XMLHttpRequest|alert|confirm|prompt)\s*\(|\binnerHTML\b|DivinationWebTelemetry|androidTelemetry/);
    }
  }
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

  assert.match(html, /href="css\/free-board\.css\?v=/);
  assert.ok(freeBoardModelIndex < freeBoardDraftIndex);
  assert.ok(freeBoardDraftIndex < recordsIndex);
  assert.ok(recordsIndex < historyUiIndex);
  assert.ok(historyUiIndex < freeBoardUiIndex);
  assert.ok(freeBoardUiIndex < appIndex);
  assert.match(html, /id="layoutModeSelect"/);
  assert.match(html, /value="freeform"[^>]*data-i18n="layout\.freeform"/);
  assert.match(html, /id="freeDrawCards"/);
  assert.doesNotMatch(html, /id="freeBoardArea"/);
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
  assert.match(androidHistoryUi, /DivinationNativeFileExport\.save\(content, fileName, onHistoryExportResult\)/);

  assert.match(androidHistoryUi, /history\.exportChoosing/);
  assert.match(androidHistoryUi, /history\.fileSaved/);
  assert.match(androidMainActivity, /ActivityResultContracts\.CreateDocument\("application\/json"\)/);
  assert.match(androidMainActivity, /resolver\.openOutputStream\(uri, "w"\)/);
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

function historyDom() {
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
    "historyClearBtn", "readingQuestion", "readingQuestionToggle", "readingQuestionCaption",
    "readingQuestionPanel", "readingQuestionSummary", "historySearch", "historySelectBtn",
    "historyExportSelectedBtn", "historyMarkdownBtn", "historyQuestionText", "historyEditQuestionBtn",
    "historyQuestionEditor", "historyQuestionInput", "historySaveQuestionBtn", "historyCancelQuestionBtn"
  ];
  var byIdMap = {};
  ids.forEach(function (id) { byIdMap[id] = new FakeElement("div"); });

  byIdMap.historySearch.value = "";
  byIdMap.readingQuestion.value = "";

  var document = {
    activeElement: null,
    documentElement: {},
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    getElementById: function (id) { return byIdMap[id] || null; },
    createElement: function (tag) { return new FakeElement(tag); }
  };
  return { document: document, elements: byIdMap };
}

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

  const dom = historyDom();
  const byIdMap = dom.elements;
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

  const prevDocument = globalThis.document;
  globalThis.document = dom.document;
  try {
    var controller = historyUiApi.init({
      store: {
        open: function () { return Promise.resolve(); },
        listRecords: function () { return Promise.resolve(records); },
        updateQuestion: async function (id, value) {
          var record = records.find(item => item.id === id);
          record.question = value.trim();
          return record;
        }
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
    // An older question-less record can be annotated, then found without reopening the dialog.
    byIdMap.historyEditQuestionBtn.click();
    byIdMap.historyQuestionInput.value = "  How to begin?  ";
    byIdMap.historySaveQuestionBtn.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(byIdMap.historyQuestionText.textContent, "How to begin?");
    byIdMap.historyEditQuestionBtn.click();
    byIdMap.historyQuestionInput.value = "discarded edit";
    byIdMap.historyCancelQuestionBtn.click();
    assert.equal(byIdMap.historyQuestionText.textContent, "How to begin?");
    await controller.refresh();
    byIdMap.historySearch.value = "BEGIN";
    byIdMap.historySearch.listeners.input[0]();
    assert.equal(byIdMap.historyList.children.length, 1);
    assert.equal(byIdMap.historyList.querySelector(".history-question-preview").textContent, "How to begin?");
  } finally {
    globalThis.document = prevDocument;
    i18n.setLocale("zh-CN");
  }
});

test("queued autosaves capture the original question and preserve a newer board or an unsaved edit", async function () {
  const previousDocument = globalThis.document;
  const dom = historyDom();
  globalThis.document = dom.document;
  const recordsApi = require("../js/history-records.js");
  const stored = [];
  let release;
  let failSave = false;
  try {
    const controller = historyUiApi.init({
      recordsApi: recordsApi,
      store: {
        open: async () => {},
        saveRecord: async record => {
          await new Promise(resolve => { release = resolve; });
          if (failSave) throw new Error("Simulated storage failure");
          stored.push(record);
          return { saved: true, duplicate: false, record: record };
        }
      }
    });
    const input = dom.elements.readingQuestion;
    input.value = "  First question  ";
    let pending = controller.saveRecord({});
    await new Promise(resolve => setImmediate(resolve));
    controller.resetQuestion();
    input.value = "  First question  ";  // Same text, different board.
    release();
    await pending;
    assert.equal(stored[0].question, "First question");
    assert.equal(input.value, "  First question  ");

    pending = controller.saveRecord({});
    await new Promise(resolve => setImmediate(resolve));
    input.value = "Edited while saving";
    release();
    await pending;
    assert.equal(input.value, "Edited while saving");
    failSave = true;
    pending = controller.saveRecord({});
    await new Promise(resolve => setImmediate(resolve));
    release();
    assert.equal(await pending, null);
    assert.equal(input.value, "Edited while saving");
    failSave = false;
    pending = controller.saveRecord({});
    await new Promise(resolve => setImmediate(resolve));
    release();
    await pending;
    assert.equal(stored.at(-1).question, "Edited while saving");
    assert.equal(input.value, "");
    assert.equal(dom.elements.readingQuestionToggle.getAttribute("aria-expanded"), "false");
  } finally {
    globalThis.document = previousDocument;
  }
});

test("History Actual Layout stays contained, centered, and flippable on Web and Android", function () {
  var surfaces = [
    {
      label: "web",
      styles: fs.readFileSync(path.join(root, "css", "styles.css"), "utf8"),
      redesign: fs.readFileSync(path.join(root, "css", "redesign.css"), "utf8")
    },
    {
      label: "android",
      styles: fs.readFileSync(path.join(root, "android-demo/app/src/main/assets/www/css/styles.css"), "utf8"),
      redesign: fs.readFileSync(path.join(root, "android-demo/app/src/main/assets/www/css/redesign.css"), "utf8")
    }
  ];

  surfaces.forEach(function (entry) {
    assert.match(entry.styles, /\.history-detail-body\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/, entry.label + " styles.css bounds history detail grid");
    assert.match(entry.styles, /\.history-actual-layout\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;/, entry.label + " styles.css contains history actual layout");
    assert.match(entry.styles, /\.history-spread-grid:not\(\.custom-spread-layout\)\s*\{[\s\S]*?justify-content:\s*center;/, entry.label + " styles.css centers history spread grid");
    assert.match(entry.redesign, /html\.ui2 \.table-center \.spread-board-scroll\s*\{[\s\S]*?margin:\s*-10px 0 -2px;/, entry.label + " redesign.css keeps live spread scroll symmetric");
    assert.match(entry.redesign, /html\.ui2 \.history-spread-grid:not\(\.custom-spread-layout\)\s*\{[\s\S]*?justify-content:\s*center;/, entry.label + " redesign.css centers history spread grid");
    assert.match(entry.redesign, /html\.ui2 \.history-spread-card\.revealed\.meaning-visible \.spread-card-inner\s*\{\s*transform:\s*rotateY\(360deg\);/, entry.label + " redesign.css allows history card flip to meaning");
    assert.match(entry.redesign, /html\.ui2 \.history-spread-card\.meaning-visible \.spread-card-meaning\s*\{\s*display:\s*flex !important;/, entry.label + " redesign.css displays flipped history card meaning");
  });
});
