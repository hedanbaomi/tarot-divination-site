"use strict";

/*
 * 冒烟测试的静态部分：
 * 1) 按 index.html 里的加载顺序把每个脚本都编译一遍，脚本有语法/结构错误会直接失败；
 * 2) 冒烟脚本引用的 id、选择器必须真实存在；
 * 3) 冒烟脚本必须是 ?smoke=1 才加载，正常打开页面不受影响。
 * 浏览器里的实跑见 tests/smoke-runner.js（?smoke=1 打开页面即可）。
 */

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");
var test = require("node:test");

var root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

var html = read("index.html");

var scripts = [];
var pattern = /<script\s+src="([^"?#]+)(?:\?[^"]*)?"/g;
var match = pattern.exec(html);
while (match) {
  scripts.push(match[1]);
  match = pattern.exec(html);
}

test("页面按顺序引用的每个脚本都存在且能编译", function () {
  assert.ok(scripts.length >= 18, "脚本数量看起来不对：" + scripts.length);
  scripts.forEach(function (file) {
    var source = read(file);
    assert.doesNotThrow(function () {
      new vm.Script(source, { filename: file });
    }, file + " 编译失败");
  });
});

test("冒烟脚本引用的元素都真实存在", function () {
  var runner = read("tests/smoke-runner.js");
  var ids = new Set();
  var idPattern = /getElementById\("([^"]+)"\)/g;
  var found = idPattern.exec(runner);
  while (found) {
    ids.add(found[1]);
    found = idPattern.exec(runner);
  }
  assert.ok(ids.size >= 5, "冒烟脚本至少要检查几个关键元素");
  ids.forEach(function (id) {
    if (id === "smoke-badge") return; // 冒烟脚本自己创建
    assert.match(html, new RegExp('id="' + id + '"'), "页面里没有 #" + id);
  });

  var selectors = ["#deckSpread .deck-card", "#spreadGrid .spread-card", "#resultsList .result-card"];
  selectors.forEach(function (selector) {
    assert.ok(selector.split(" ")[0].slice(1), selector);
  });
  assert.match(html, /id="deckSpread"/);
  assert.match(html, /id="spreadGrid"/);
  assert.match(html, /id="resultsList"/);
});

test("冒烟脚本只在 ?smoke=1 时加载", function () {
  assert.match(html, /smoke-runner\.js/);
  assert.match(html, /\[\?&\]smoke=1/);
  assert.match(html, /location\.search/);
  var hookIndex = html.indexOf("smoke-runner.js");
  var guardIndex = html.lastIndexOf("smoke=1", hookIndex);
  assert.ok(guardIndex > 0 && guardIndex < hookIndex, "加载冒烟脚本前必须先判断 smoke=1");
});

test("冒烟脚本覆盖主流程的关键动作", function () {
  var runner = read("tests/smoke-runner.js");
  [
    "step(\"页面框架就位\"",
    "78",
    "revealBtn",
    "cardMeaningPanel",
    "layoutModeSelect",
    "freeUndoBtn",
    "shuffleBtn",
    "skyMoon",
    "settingsOpenBtn",
    "languageToggle"
  ].forEach(function (needle) {
    assert.ok(runner.indexOf(needle) >= 0, "冒烟脚本缺少：" + needle);
  });
});
