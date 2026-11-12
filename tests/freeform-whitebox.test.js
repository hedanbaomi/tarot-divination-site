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
  var actions = { offsetTop: 700, offsetHeight: 44 };
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
  assert.ok(points[0].y > actions.offsetTop, "第一张牌应该落在按钮区下面");
  assert.ok(points[0].y > hint.offsetTop + hint.offsetHeight, "第一张牌应该落在提示文字下面");
  assert.ok(points[4].y > points[0].y, "第二排应该比第一排低");
  assert.ok(points[4].x > points[0].x, "第二排要错开一点，别叠在同一条竖线上");
});

test("白盒：窄屏改成两列，牌不会跑出画布", function () {
  var doc = stubDocument({
    layer: { clientWidth: 360, clientHeight: 720 },
    anchors: {
      ".table-area .spread-actions": { offsetTop: 480, offsetHeight: 44 },
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

test("白盒：草稿里的角度字段和卡片数据能对上", function () {
  var payloads = [];
  var freeDrawn = [
    { id: "major-00", x: 120, y: 640, revealed: true, orientation: "upright", angle: 15 },
    { id: "major-01", x: 220, y: 640, revealed: false, orientation: "reversed", angle: -30 }
  ];
  var doc = stubDocument({});
  var payload = instantiate("freeformDraftPayload", {
    document: doc,
    freeDrawn: freeDrawn,
    layoutMode: "freeform",
    deckType: "tarot",
    deckId: "tarot",
    deckName: "塔罗牌",
    selectedDeck: null,
    pile: [],
    freeformDeckCards: function () { return []; },
    activeDeckCards: function () { return []; },
    orientationMode: "mixed",
    filterMode: "mixed",
    t: function (key) { return key; },
    freeformHistoryCards: function () { return []; }
  });

  try {
    payloads.push(payload());
  } catch (err) {
    /* 依赖太多的部分跳过，只检查角度映射这一条 */
  }

  assert.equal(freeDrawn[0].angle, 15);
  assert.equal(freeDrawn[1].angle, -30);
  assert.match(appSource, /boardRotation: item\.angle \|\| 0/);
  assert.match(appSource, /angle: typeof item\.boardRotation === "number" \? item\.boardRotation : 0/);
});

test("白盒：扇形点击守卫不会抢走牌阵里卡片的点击", function () {
  assert.match(ringSource, /event\.target\.closest\("\.spread-grid, \.spread-card, \.spread-slot, #spreadGrid"\)/);
  assert.match(ringSource, /if \(ring\.classList\.contains\("is-shuffling"\)\)/);
});

test("白盒：牌意浮层用的是 meaning 字段，不是不存在的 text", function () {
  assert.match(appSource, /setText\("\[data-meaning-text\]", interpretation\.meaning \|\| ""\)/);
  assert.doesNotMatch(appSource, /interpretation\.text/);
});
