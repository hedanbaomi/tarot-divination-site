"use strict";

/*
 * 白盒测试：把 js/app.js 里的自由画板函数抽出来，在受控的环境里直接跑，
 * 检查落点排布、角度归一、动作按钮状态和草稿序列化这些内部逻辑。
 */

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var appSource = fs.readFileSync(path.join(root, "js/app.js"), "utf8");
var ringSource = fs.readFileSync(path.join(root, "js/deck-ring.js"), "utf8");

/* 按函数名从源码里取出一个完整的函数声明（花括号配对） */
function grab(name) {
  var start = appSource.indexOf("function " + name + "(");
  assert.notEqual(start, -1, "源码里找不到函数 " + name);
  var brace = appSource.indexOf("{", start);
  var depth = 0;
  for (var i = brace; i < appSource.length; i += 1) {
    var ch = appSource[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return appSource.slice(start, i + 1);
    }
  }
  throw new Error("函数 " + name + " 的花括号没有配平");
}

/* 在给定的依赖里实例化一个函数 */
function instantiate(name, deps) {
  var source = grab(name);
  var keys = Object.keys(deps);
  var factory = new Function(keys.join(", "), source + "\nreturn " + name + ";");
  return factory.apply(null, keys.map(function (k) { return deps[k]; }));
}

function stubDocument(options) {
  var layer = options.layer || { clientWidth: 1180, clientHeight: 1046 };
  if (typeof layer.getBoundingClientRect !== "function") {
    layer.getBoundingClientRect = function () {
      return { top: 0, left: 0, bottom: layer.clientHeight, right: layer.clientWidth, height: layer.clientHeight, width: layer.clientWidth };
    };
  }
  var anchors = options.anchors || {};
  return {
    getElementById: function (id) {
      if (id === "freeDrawCards") return layer;
      return anchors.byId ? anchors.byId[id] : null;
    },
    querySelector: function (selector) {
      return anchors[selector] || null;
    }
  };
}

test("白盒：连抽十三张牌，每张落在不同位置，且按四列排开", function () {
  var hint = { offsetTop: 640, offsetHeight: 24 };
  var actions = {
    offsetTop: 700,
    offsetHeight: 44,
    getBoundingClientRect: function () { return { top: 700, bottom: 744, height: 44 }; }
  };
  var doc = stubDocument({
    anchors: {
      ".table-area .spread-actions": actions,
      ".table-hint": hint
    }
  });

  var point = instantiate("freeDefaultPoint", { document: doc });

  var seen = Object.create(null);
  var points = [];
  for (var i = 0; i < 13; i += 1) {
    var p = point(i);
    points.push(p);
    var key = p.x + "," + p.y;
    assert.equal(seen[key], undefined, "第 " + (i + 1) + " 张和第 " + (i + 1) + " 之前的牌落在了同一个点");
    seen[key] = true;
  }

  assert.equal(points.length, 13);
  assert.ok(points[0].y > 0, "第一张牌应该落在牌层内部（牌层本身已经在按钮下方）");
  assert.ok(points[0].y < 200, "第一张牌靠牌层顶部，别飘到中间");
  assert.ok(points[4].y > points[0].y, "第二排应该比第一排低");
  assert.ok(points[4].x > points[0].x, "第二排要错开一点，别叠在同一条竖线上");
});

test("白盒：窄屏改成两列，牌不会跑出画布", function () {
  var doc = stubDocument({
    layer: { clientWidth: 360, clientHeight: 720 },
    anchors: {
      ".table-area .spread-actions": {
        offsetTop: 480,
        offsetHeight: 44,
        getBoundingClientRect: function () { return { top: 480, bottom: 524, height: 44 }; }
      },
      ".table-hint": { offsetTop: 430, offsetHeight: 40 }
    }
  });
  var point = instantiate("freeDefaultPoint", { document: doc });

  for (var i = 0; i < 8; i += 1) {
    var p = point(i);
    assert.ok(p.x > 0 && p.x <= 360 - 56, "第 " + (i + 1) + " 张牌横向跑出画布：" + p.x);
    assert.ok(p.y > 0 && p.y <= 720 - 90, "第 " + (i + 1) + " 张牌纵向跑出画布：" + p.y);
  }
  /* 两列：第二张往右挪一列，第三张回到第一列、只错开一点点 */
  assert.notEqual(point(0).x, point(1).x);
  assert.equal(point(2).x - point(0).x, 14);
});

test("白盒：角度归一化到 -180..180，并且写回卡片的 transform", function () {
  var angleValue = { textContent: "" };
  var panel = {
    querySelector: function (selector) {
      return selector === "[data-angle-value]" ? angleValue : null;
    }
  };
  var doc = stubDocument({ anchors: { byId: { freeAnglePanel: panel } } });
  var scheduled = 0;
  var setFreeAngle = instantiate("setFreeAngle", {
    document: doc,
    scheduleFreeformDraft: function () { scheduled += 1; }
  });

  var item = { angle: 0 };
  var el = { style: { transform: "" } };

  setFreeAngle(item, el, 45);
  assert.equal(item.angle, 45);
  assert.match(el.style.transform, /rotate\(45deg\)/);

  setFreeAngle(item, el, 200);
  assert.equal(item.angle, -160, "200 度应该折算成 -160 度");

  setFreeAngle(item, el, -200);
  assert.equal(item.angle, 160, "-200 度应该折算成 160 度");

  setFreeAngle(item, el, 360);
  assert.equal(item.angle, 0, "转一整圈应该回到 0 度");

  setFreeAngle(item, el, 540);
  assert.equal(item.angle, 180, "540 度应该折算成 180 度");

  assert.equal(scheduled, 5, "每次改角度都要排一次草稿保存");
  assert.equal(angleValue.textContent, "180°");
});

test("白盒：角度函数遇到空参数直接返回，不抛错", function () {
  var doc = stubDocument({});
  var setFreeAngle = instantiate("setFreeAngle", {
    document: doc,
    scheduleFreeformDraft: function () {}
  });
  assert.doesNotThrow(function () { setFreeAngle(null, null, 30); });
  assert.doesNotThrow(function () { setFreeAngle({ angle: 0 }, null, 30); });
});

test("白盒：一键开牌在自由画板里跟着已抽出的牌走", function () {
  var button = { disabled: false, textContent: "" };
  var state = { freeform: true, drawn: [] };
  var dictionary = {
    "spread.reveal": "一键开牌",
    "app.revealedAll": "已全部开牌"
  };

  var syncFreeActions = instantiate("syncFreeActions", {
    isFreeform: function () { return state.freeform; },
    el: { revealBtn: button },
    freeDrawn: state.drawn,
    t: function (key) { return dictionary[key] || key; }
  });

  /* 还没抽牌：按钮禁用 */
  syncFreeActions();
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "一键开牌");

  /* 抽了一张没翻开的：可以点 */
  state.drawn.push({ id: "major-00", revealed: false });
  syncFreeActions();
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "一键开牌");

  /* 抽了两张都翻开了：禁用并换文案 */
  state.drawn.push({ id: "major-01", revealed: true });
  state.drawn[0].revealed = true;
  syncFreeActions();
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "已全部开牌");

  /* 回到预设牌阵：这个函数什么都不做 */
  state.freeform = false;
  state.drawn[0].revealed = false;
  button.disabled = false;
  syncFreeActions();
  assert.equal(button.disabled, false, "预设牌阵下不应该改自由画板的按钮");
});

test("draft round trip preserves card placement, orientation, angle and undo order", function () {
  var deck = ["a", "b", "c"].map(function (id) { return { id: id, deck: "tarot" }; });
  var state = {
    deckType: "tarot", mode: "mixed", arcanaFilter: "mixed", pile: deck.slice(),
    freeDrawn: [{ id: "b", x: 151, y: 123, angle: -30, orientation: "reversed", revealed: true }],
    freeRedo: [], FREEFORM_DRAFT_KEY: "draft", legacyViewport: null,
    parkedDraft: null, selectedSpreadId: "four-seasons",
    freeBoardDeckName: function () { return "Tarot"; },
    allDecksForFreeBoard: function () { return { tarot: deck }; },
    freeformDeckCards: function () { return deck; },
    freeDefaultPoint: function () { return { x: 120, y: 92 }; },
    renderFreeformFan: function () {}, scheduleFreeformDraft: function () {}
  };
  var vm = require("node:vm");
  var definitions = ["freeformDraftPayload", "restoreFreeformDraft", "freeRemainingIds", "undoFreeDraw", "redoFreeDraw"];
  state.isFreeform = function () { return true; };
  vm.runInNewContext(definitions.map(grab).join("\n"), state);
  var draft = state.freeformDraftPayload();
  state.window = { localStorage: { getItem: function () { return JSON.stringify(draft); } } };
  state.pile = [];
  state.freeDrawn = [];
  assert.equal(state.restoreFreeformDraft(), 1);
  assert.deepEqual(Object.assign({}, state.freeDrawn[0]),
    { id: "b", x: 151, y: 123, angle: -30, orientation: "reversed", revealed: true });
  assert.equal(state.legacyViewport, null);
  draft.parked = true;
  assert.equal(state.restoreFreeformDraft(), -1, "reload must stay in preset while a board is parked");
  assert.equal(state.restoreFreeformDraft(true), 1, "reopening the board resumes its cards");
  delete draft.parked;
  assert.deepEqual(Array.from(state.freeRemainingIds()), ["a", "c"]);
  state.undoFreeDraw();
  assert.deepEqual(Array.from(state.freeRemainingIds()), ["a", "b", "c"]);
  state.redoFreeDraw();
  assert.deepEqual(Array.from(state.freeRemainingIds()), ["a", "c"]);

  draft.remainingPile = [];
  draft.deck.cardIds = [];
  assert.equal(state.restoreFreeformDraft(), 1);
  assert.equal(state.freeRemainingIds().length, 0);
  state.undoFreeDraw();
  assert.deepEqual(Array.from(state.freeRemainingIds()), ["b"]);
});

test("bulk and individual reveals save the same validated Tarot reading exactly once", function () {
  var records = require("../js/history-records.js");
  [true, false].forEach(function (bulk) {
    var saved = [], renders = 0;
    var cards = [
      { id: "major-16", arcana: "major", name: "塔", number: 16 },
      { id: "minor-cups-ace", arcana: "minor", suit: "圣杯", name: "圣杯王牌" }
    ];
    var drawn = cards.map(function (card, index) {
      return { id: card.id, x: 100 + index, y: 110, angle: 15, revealed: false, orientation: "reversed" };
    });
    var historyCards = instantiate("freeformHistoryCards", {
      freeDrawn: drawn, localizedCardName: function (c) { return c.name; },
      cardById: function (id) { return cards.find(function (c) { return c.id === id; }); }
    });
    var save = instantiate("saveFreeformHistory", {
      freeformHistoryCards: historyCards, deckType: "tarot", mode: "mixed", arcanaFilter: "mixed",
      freeBoardDeckName: function () { return "Tarot"; },
      historyUiController: { saveFreeformReading: function (input) { saved.push(records.buildFreeformLayoutRecord(input)); } }
    });
    var faces = [];
    var reveal = instantiate("revealFreeCards", {
      freeDrawn: drawn,
      document: { querySelector: function (selector) { faces.push(selector); return null; } },
      applyFreeCardFace: function () {},
      syncFreeActions: function () {},
      renderResults: function () { renders++; },
      saveFreeformDraftNow: function () {}, notifyFreeformReadingCompleted: function () {}, saveFreeformHistory: save
    });
    if (!bulk) { reveal([drawn[0]]); assert.equal(saved.length, 0); }
    reveal(bulk ? drawn : [drawn[1]]);
    reveal(drawn);
    assert.equal(renders, bulk ? 1 : 2);
    assert.equal(saved.length, 1);
    assert.ok(faces.length > 0, "翻牌应当按 data-card-id 找到那张牌并只更新它");
    assert.match(faces[faces.length - 1], /\.free-table-card\[data-card-id="major-16"\]|\.free-table-card\[data-card-id="minor-cups-ace"\]/);
    assert.deepEqual(saved[0].cards.map(function (c) { return [c.arcana, c.cardName, c.orientation, c.boardRotation]; }),
      [["major", "塔", "reversed", 15], ["minor", "圣杯王牌", "reversed", 15]]);
  });
});

test("白盒：翻牌只改这张牌的状态，不重建画板（真正跑一遍 applyFreeCardFace）", function () {
  var makeClassList = function (set) {
    return {
      toggle: function (name, on) { if (on) set.add(name); else set.delete(name); },
      add: function (name) { set.add(name); },
      remove: function (name) { set.delete(name); }
    };
  };
  var cardClasses = new Set();
  var frontClasses = new Set();
  var front = {
    attrs: { "aria-hidden": "true" },
    classList: makeClassList(frontClasses),
    setAttribute: function (k, v) { front.attrs[k] = v; },
    removeAttribute: function (k) { delete front.attrs[k]; }
  };
  var img = { alt: "" };
  var nameEl = { textContent: "" };
  var el = {
    attrs: {},
    classList: makeClassList(cardClasses),
    setAttribute: function (k, v) { el.attrs[k] = v; },
    querySelector: function (selector) {
      if (selector === ".spread-card-front") return front;
      if (selector === ".spread-card-front .card-image") return img;
      if (selector === ".spread-card-caption .name") return nameEl;
      return null;
    }
  };
  var lookups = 0;
  var applyFreeCardFace = instantiate("applyFreeCardFace", {
    cardById: function (id) { lookups += 1; return id === "major-16" ? { id: id, name: "塔" } : null; },
    localizedCardName: function (card) { return card.name; },
    t: function (key, vars) { return vars ? key + " " + JSON.stringify(vars) : key; }
  });

  var item = { id: "major-16", revealed: false, orientation: "reversed" };
  applyFreeCardFace(el, item, 0);
  assert.equal(cardClasses.has("revealed"), false);
  assert.equal(frontClasses.has("reversed"), true, "逆位要落在 front 上，牌面才会真的转 180°");
  assert.equal(front.attrs["aria-hidden"], "true");
  assert.equal(img.alt, "", "没翻开的牌不能把牌名读给读屏软件");
  assert.equal(nameEl.textContent, "");
  assert.match(el.attrs["aria-label"], /freeBoard\.cardHiddenAria/);

  item.revealed = true;
  applyFreeCardFace(el, item, 0);
  assert.equal(cardClasses.has("revealed"), true);
  assert.equal(front.attrs["aria-hidden"], undefined, "翻开后要摘掉 aria-hidden");
  assert.equal(img.alt, "塔");
  assert.equal(nameEl.textContent, "塔");
  assert.match(el.attrs["aria-label"], /freeBoard\.cardAria/);
  assert.match(el.attrs["aria-label"], /reversed/);
  assert.equal(lookups, 2, "没传 card 时每次自己查一次");

  lookups = 0;
  applyFreeCardFace(el, item, 0, { id: "major-16", name: "塔" });
  assert.equal(lookups, 0, "buildFreeTableCard 已经查过牌，不应该再查一次");
});

test("白盒：只有画板变窄才收横向坐标，刷新恢复与纵向位置都不动（真正跑一遍 fitFreeCardsToWidth）", function () {
  var fit = instantiate("fitFreeCardsToWidth", {});

  /* 宽度没变（刷新恢复草稿走的就是这条路）：负 y 和留白区的牌都不许动 */
  var same = [{ x: 184, y: -20 }, { x: 300, y: 480 }];
  assert.equal(fit(same, 354, 354, 44), false);
  assert.deepEqual(same.map(function (item) { return [item.x, item.y]; }), [[184, -20], [300, 480]]);

  /* 变宽：同样不动 */
  assert.equal(fit(same, 640, 354, 44), false);
  assert.equal(same[0].x, 184);

  /* 变窄：x 按宽度比例收进画板，y 原样保留 */
  var shrinking = [{ x: 180, y: -20 }, { x: 354, y: 470 }];
  assert.equal(fit(shrinking, 177, 354, 44), true);
  assert.equal(shrinking[0].x, 90);
  assert.equal(shrinking[0].y, -20, "纵向坐标不能被高度变化改掉");
  assert.equal(shrinking[1].x, 133, "越界只做最小内推，不丢回默认网格");
  assert.equal(shrinking[1].y, 470);

  /* 第一次渲染（刷新恢复草稿）没有上一次的宽度：没有比例可算，只做最小内推 */
  var first = [{ x: 700, y: 300 }, { x: 120, y: 300 }, { x: -30, y: 40 }];
  assert.equal(fit(first, 354, 0, 44), true);
  assert.deepEqual(first.map(function (item) { return [item.x, item.y]; }),
    [[310, 300], [120, 300], [44, 40]],
    "框内的牌不动，只把越界的收回边界");

  /* 收进同一个点时按半个牌宽左右交错，不能叠成一张 */
  var collided = [{ x: 900, y: 100 }, { x: 900, y: 100 }];
  assert.equal(fit(collided, 354, 900, 44), true);
  assert.equal(collided[0].x, 310);
  assert.equal(Math.abs(collided[1].x - collided[0].x), 44, "错开步长要按牌宽，不是 10px");
  assert.ok(collided[1].x >= 44 && collided[1].x <= 310);
});

test("白盒：窗口尺寸变化只在宽度变了才重绘，并且合帧（拖动窗口不掉帧）", function () {
  var resize = grab("scheduleFreeformResizeRender");
  assert.match(resize, /requestAnimationFrame/, "resize 重绘要合帧");
  assert.match(resize, /box\.clientWidth === freeformLayerW/, "只是高度变化（地址栏、软键盘）不该重绘");
  assert.match(resize, /renderFreeDraw\(\)/);
  assert.match(appSource, /if \(isFreeform\(\) && freeDrawn\.length\) scheduleFreeformResizeRender\(\);/);
  assert.doesNotMatch(appSource, /if \(isFreeform\(\) && freeDrawn\.length\) renderFreeDraw\(\);/,
    "resize 里不能直接整块重建");
  assert.doesNotMatch(appSource, /freeformLayerH/, "高度不用记，牌根本不按高度排");
});

test("白盒：翻牌与重绘的分工（不整块重绘、不丢回默认网格、不按高度重排）", function () {
  var reveal = grab("revealFreeCards");
  assert.doesNotMatch(reveal, /renderFreeDraw\(/, "翻牌不能再整块重绘");
  assert.match(reveal, /var pending = items\.filter\(function \(item\) \{ return !item\.revealed; \}\)/);
  assert.match(reveal, /if \(pending\.indexOf\(item\) === -1\) return;/);
  assert.match(reveal, /applyFreeCardFace\(cardEl, item, index\)/);
  assert.match(reveal, /syncFreeActions\(\)/);

  var render = grab("renderFreeDraw");
  assert.match(render, /if \(fitFreeCardsToWidth\(freeDrawn, layerW, freeformLayerW, halfW\)\) \{/);
  assert.doesNotMatch(render, /freeDefaultPoint\(/, "重排不能把牌丢回默认网格");
  assert.doesNotMatch(render, /freeformRelayout/, "不再有整块重排开关");
  assert.doesNotMatch(render, /layerH !== freeformLayerH/, "高度变化（地址栏、软键盘）不能触发重排");
  assert.doesNotMatch(grab("restoreFreeformDraft"), /freeformRelayout = true;/);

  var build = grab("buildFreeTableCard");
  assert.match(build, /applyFreeCardFace\(el, item, index, card\)/, "牌面状态只在一处设置");
  assert.doesNotMatch(build, /front\.classList\.add\("reversed"\)/, "逆位不能两处各写一半");
  assert.doesNotMatch(build, /nameEl\.textContent =/, "牌名交给 applyFreeCardFace");
});

test("白盒：扇形点击守卫不会抢走牌阵里卡片的点击", function () {
  assert.match(ringSource, /event\.target\.closest\("\.spread-grid, \.spread-card, \.spread-slot, #spreadGrid"\)/);
  assert.match(ringSource, /if \(ring\.classList\.contains\("is-shuffling"\)\)/);
});

test("白盒：牌意浮层用的是 meaning 字段，不是不存在的 text", function () {
  assert.match(appSource, /setText\("\[data-meaning-text\]", interpretation\.meaning \|\| ""\)/);
  assert.doesNotMatch(appSource, /interpretation\.text/);
});

test("白盒：连续 1px 步长缩窗不量化漂移/坍缩，手动改坐标后按新坐标缩放", function () {
  var fit = instantiate("fitFreeCardsToWidth", {});
  var cards = [
    { x: 200, y: 100 },
    { x: 300, y: 100 },
    { x: 400, y: 100 },
    { x: 500, y: 100 },
    { x: 800, y: 106 }
  ];
  for (var w = 999; w >= 500; w -= 1) {
    fit(cards, w, w + 1, 44);
  }
  assert.deepEqual(
    cards.map(function (c) { return c.x; }),
    [100, 150, 200, 250, 400],
    "连续 1px 缩窗后各牌必须精确落在目标比例坐标，不能漂移或坍缩"
  );

  /* 手动把第一张牌拖到新位置（以及源码里 onMove 会清理 _fit），再缩窗应按新坐标继续缩放 */
  assert.match(grab("bindFreeTableCard"), /if \(item\._fit\) delete item\._fit;/);
  cards[0].x = 200;
  fit(cards, 250, 500, 44);
  assert.equal(cards[0].x, 100, "手动改 x 后应按新坐标 200 * 0.5 = 100 缩放，而不是旧缩放缓存");
});

test("白盒：prevW=0 首帧恢复不拆框内叠牌、保留近邻越界顺序且框内邻牌不重叠", function () {
  var fit = instantiate("fitFreeCardsToWidth", {});

  var stacked = [{ x: 120, y: 92 }, { x: 120, y: 92 }];
  assert.equal(fit(stacked, 354, 0, 44), false);
  assert.deepEqual(stacked, [{ x: 120, y: 92 }, { x: 120, y: 92 }]);

  var nearRows = [{ x: 700, y: 100 }, { x: 900, y: 105 }];
  assert.equal(fit(nearRows, 354, 0, 44), true);
  assert.deepEqual(nearRows, [{ x: 266, y: 100 }, { x: 310, y: 105 }]);

  var mixed = [{ x: 240, y: 120 }, { x: 760, y: 120 }, { x: 820, y: 120 }];
  assert.equal(fit(mixed, 339, 0, 39), true);
  assert.deepEqual(
    mixed.map(function (c) { return c.x; }),
    [222, 261, 300],
    "右侧越界牌左推时应把近距离框内邻牌一并推开，避免重叠"
  );
});

test("白盒：leaveFreeform(true) 隐藏时不清空 freeformLayerW，clearFreeformDraft() 才置 0", function () {
  var vm = require("node:vm");
  var wrap = { hidden: false };
  var box = { innerHTML: "", clientWidth: 0, clientHeight: 0 };
  var removedKeys = [];
  var state = {
    layoutMode: "freeform",
    freeformLayerW: 920,
    freeDrawn: [{ id: "major-00", x: 240, y: 120, revealed: false, angle: 0, orientation: "upright" }],
    freeRedo: [],
    parkedDraft: null,
    freeformDraftTimer: 0,
    legacyViewport: null,
    FREEFORM_DRAFT_KEY: "draft",
    isFreeform: function () { return state.layoutMode === "freeform"; },
    saveFreeformDraftNow: function (park) { state.parkedDraft = { parked: !!park }; },
    scheduleFreeformDraft: function () {},
    syncFreeActions: function () {},
    buildFreeTableCard: function () { return null; },
    bindFreeTableCard: function () {},
    freeIndex: function () { return 0; },
    window: {
      clearTimeout: function () {},
      localStorage: { removeItem: function (k) { removedKeys.push(k); } }
    },
    document: {
      getElementById: function (id) {
        if (id === "freeDraw") return wrap;
        if (id === "freeDrawCards") return box;
        return null;
      }
    }
  };
  var defs = ["fitFreeCardsToWidth", "renderFreeDraw", "clearFreeformDraft", "leaveFreeform"];
  vm.runInNewContext(defs.map(grab).join("\n"), state);

  state.leaveFreeform(true);
  assert.equal(state.layoutMode, "preset");
  assert.equal(wrap.hidden, true);
  assert.equal(state.freeformLayerW, 920, "暂存返回预设时容器隐藏导致 clientWidth=0，不得覆盖旧宽度");

  state.clearFreeformDraft();
  assert.equal(state.freeformLayerW, 0, "清空并放弃草稿时必须重置 freeformLayerW");
  assert.deepEqual(removedKeys, ["draft"]);
});

test("白盒：真实 i18n 无重复 freeBoard.cardAria 键，现代与经典翻牌 aria-label 均完整", function () {
  var vm = require("node:vm");
  var i18nSource = fs.readFileSync(path.join(root, "js/i18n.js"), "utf8");
  var classicSource = fs.readFileSync(path.join(root, "js/classic/messages.js"), "utf8");

  /* 检查 zh-CN 与 en 字典块内不存在重复属性键 */
  ["zh-CN", "en"].forEach(function (locale) {
    var marker = '"' + locale + '": {';
    var start = i18nSource.indexOf(marker);
    assert.notEqual(start, -1, "找不到语言块 " + locale);
    var end = i18nSource.indexOf("\n    }", start);
    assert.notEqual(end, -1, "找不到语言块结束 " + locale);
    var block = i18nSource.slice(start, end);
    var seen = Object.create(null);
    var keyPattern = /"([^"]+)"\s*:/g;
    var match = keyPattern.exec(block);
    while (match) {
      var key = match[1];
      if (key !== locale) {
        assert.equal(seen[key], undefined, locale + " 存在重复键：" + key);
        seen[key] = true;
      }
      match = keyPattern.exec(block);
    }
    assert.ok(seen["freeBoard.cardAria"], locale + " 必须保留 freeBoard.cardAria");
  });

  function loadI18n(withClassic) {
    var sandbox = { globalThis: null, window: {}, navigator: { language: "zh-CN" } };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    if (withClassic) vm.runInNewContext(classicSource, sandbox);
    vm.runInNewContext(i18nSource, sandbox);
    return sandbox.DivinationI18n;
  }

  var modernI18n = loadI18n(false);
  var card = { id: "major-16", name: "塔", nameEn: "The Tower" };
  var makeClassList = function () { return { toggle: function () {}, add: function () {}, remove: function () {} }; };
  var makeCardEl = function () {
    var front = { attrs: {}, classList: makeClassList(), setAttribute: function (k, v) { front.attrs[k] = v; }, removeAttribute: function (k) { delete front.attrs[k]; } };
    var img = { alt: "" };
    var nameEl = { textContent: "" };
    var el = {
      attrs: {},
      classList: makeClassList(),
      setAttribute: function (k, v) { el.attrs[k] = v; },
      querySelector: function (sel) {
        if (sel === ".spread-card-front") return front;
        if (sel === ".spread-card-front .card-image") return img;
        if (sel === ".spread-card-caption .name") return nameEl;
        return null;
      }
    };
    return el;
  };
  var applyModern = instantiate("applyFreeCardFace", {
    cardById: function () { return card; },
    localizedCardName: function (c) { return modernI18n.field(c, "name"); },
    t: function (k, vars) { return modernI18n.t(k, vars); }
  });

  modernI18n.setLocale("zh-CN");
  var elZh = makeCardEl();
  applyModern(elZh, { id: "major-16", revealed: true, orientation: "reversed" }, 0, card);
  assert.equal(elZh.attrs["aria-label"], "第 1 张牌，塔，逆位");

  modernI18n.setLocale("en");
  var elEn = makeCardEl();
  applyModern(elEn, { id: "major-16", revealed: true, orientation: "upright" }, 1, card);
  assert.equal(elEn.attrs["aria-label"], "Card 2, The Tower, Upright");

  var classicI18n = loadI18n(true);
  classicI18n.setLocale("zh-CN");
  assert.equal(
    classicI18n.t("freeBoard.cardAria", { card: "塔", state: "已开牌", orientation: " · 正位" }),
    "塔，已开牌 · 正位。拖动改变位置，轻点选中"
  );
  classicI18n.setLocale("en");
  assert.equal(
    classicI18n.t("freeBoard.cardAria", { card: "The Tower", state: "Revealed", orientation: " · Upright" }),
    "The Tower, Revealed · Upright. Drag to move; tap to select."
  );
});
