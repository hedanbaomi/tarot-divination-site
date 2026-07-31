"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");
var vm = require("node:vm");

var demoRoot = path.resolve(__dirname, "..");
var i18nSource = fs.readFileSync(
  path.join(demoRoot, "app/src/main/assets/www/js/i18n.js"),
  "utf8"
);

function FakeClassList() {
  this.values = Object.create(null);
}

FakeClassList.prototype.add = function (name) { this.values[name] = true; };
FakeClassList.prototype.remove = function (name) { delete this.values[name]; };
FakeClassList.prototype.contains = function (name) { return Boolean(this.values[name]); };

function FakeElement(options) {
  options = options || {};
  this.id = options.id || "";
  this.attributes = Object.assign({}, options.attributes);
  if (this.id) this.attributes.id = this.id;
  this.children = [];
  this.listeners = Object.create(null);
  this.classList = new FakeClassList();
  this._textContent = options.textContent || "";
  this.open = false;
}

Object.defineProperty(FakeElement.prototype, "textContent", {
  get: function () { return this._textContent; },
  set: function (value) {
    // Setting a real element's textContent removes its child nodes. This is
    // what makes the test catch accidental writes to languageToggle itself.
    this._textContent = String(value);
    this.children = [];
  }
});

FakeElement.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name)
    ? this.attributes[name]
    : null;
};

FakeElement.prototype.setAttribute = function (name, value) {
  this.attributes[name] = String(value);
};

FakeElement.prototype.addEventListener = function (type, listener) {
  (this.listeners[type] || (this.listeners[type] = [])).push(listener);
};

FakeElement.prototype.dispatchEvent = function (event) {
  event.target = this;
  (this.listeners[event.type] || []).slice().forEach(function (listener) {
    listener(event);
  });
};

FakeElement.prototype.appendChild = function (child) {
  this.children.push(child);
  child.parentNode = this;
  return child;
};

function createFixture(systemLanguage) {
  var label = new FakeElement({
    attributes: { "data-i18n": "menu.language" },
    textContent: "语言"
  });
  var value = new FakeElement({
    id: "languageToggleValue",
    attributes: { "data-i18n": "language.switch" },
    textContent: "EN"
  });
  var toggle = new FakeElement({
    id: "languageToggle",
    attributes: {
      "data-i18n-aria-label": "language.switchLabel",
      "aria-label": "切换至英文"
    }
  });
  toggle.appendChild(label);
  toggle.appendChild(value);
  var historyPrivacy = new FakeElement({
    id: "historyPrivacy",
    attributes: { "data-i18n": "history.privacy" }
  });
  var meta = new FakeElement();
  meta.setAttribute("name", "description");

  var byId = {
    languageToggle: toggle,
    languageToggleValue: value,
    historyPrivacy: historyPrivacy
  };
  var allI18n = [label, value, historyPrivacy];
  var allAria = [toggle];
  var listeners = Object.create(null);
  var storage = Object.create(null);
  var document = {
    readyState: "complete",
    title: "",
    documentElement: { lang: "" },
    getElementById: function (id) { return byId[id] || null; },
    querySelector: function (selector) {
      return selector === 'meta[name="description"]' ? meta : null;
    },
    querySelectorAll: function (selector) {
      if (selector === "[data-i18n]") return allI18n;
      if (selector === "[data-i18n-aria-label]") return allAria;
      return [];
    }
  };
  var context = {
    document: document,
    navigator: { language: systemLanguage },
    localStorage: {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
      setItem: function (key, value) { storage[key] = String(value); }
    },
    addEventListener: function (type, listener) {
      (listeners[type] || (listeners[type] = [])).push(listener);
    },
    dispatchEvent: function (event) {
      (listeners[event.type] || []).slice().forEach(function (listener) { listener(event); });
    },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    globalThis: null
  };
  context.globalThis = context;
  vm.runInNewContext(i18nSource, context, { filename: "i18n.js" });
  return {
    api: context.DivinationI18n,
    toggle: toggle,
    label: label,
    value: value,
    historyPrivacy: historyPrivacy
  };
}

function assertLanguageStructure(fixture, labelText, valueText, ariaLabel, buttonLang) {
  assert.equal(fixture.toggle.children.length, 2);
  assert.equal(fixture.toggle.children[0], fixture.label);
  assert.equal(fixture.toggle.children[1], fixture.value);
  assert.equal(fixture.label.textContent, labelText);
  assert.equal(fixture.value.textContent, valueText);
  assert.equal(fixture.toggle.getAttribute("aria-label"), ariaLabel);
  assert.equal(fixture.toggle.getAttribute("lang"), buttonLang);
}

test("language DOM structure survives initialization and repeated locale changes", function () {
  var fixture = createFixture("zh-CN");
  assertLanguageStructure(fixture, "语言", "EN", "Switch to English", "en");

  fixture.toggle.dispatchEvent({ type: "click" });
  assertLanguageStructure(fixture, "Language", "中文", "切换至简体中文", "zh-CN");

  fixture.toggle.dispatchEvent({ type: "click" });
  assertLanguageStructure(fixture, "语言", "EN", "Switch to English", "en");
});

test("history privacy copy distinguishes local history from anonymous statistics", function () {
  var fixture = createFixture("zh-CN");
  var chinese = fixture.historyPrivacy.textContent;
  assert.equal(
    chinese,
    "占卜记录仅保存在本应用的本地存储中。卸载应用、清除应用数据或更换设备可能导致记录丢失；可导出 JSON 自行备份。本应用不会上传、追踪或收集你的占卜历史；匿名使用统计也不包含历史内容。"
  );
  assert.match(chinese, /不会上传、追踪或收集你的占卜历史/);
  assert.match(chinese, /匿名使用统计也不包含历史内容/);
  assert.doesNotMatch(chinese, /不进行遥测|不会上传历史/);

  fixture.toggle.dispatchEvent({ type: "click" });
  var english = fixture.historyPrivacy.textContent;
  assert.match(english, /does not upload, track, or collect your reading history/);
  assert.match(english, /Anonymous usage statistics do not include reading history content/);
  [
    [/stored locally/, /本地存储/],
    [/Export a JSON backup/, /导出 JSON/],
    [/reading history/, /占卜历史/],
    [/Anonymous usage statistics/, /匿名使用统计/]
  ].forEach(function (pair) {
    assert.match(english, pair[0]);
    assert.match(chinese, pair[1]);
  });
});
