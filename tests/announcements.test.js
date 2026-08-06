"use strict";

var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.resolve(__dirname, "..");
var html = fs.readFileSync(path.join(root, "index.html"), "utf8");
var source = fs.readFileSync(path.join(root, "js", "announcements.js"), "utf8");
var announcements = require("../js/announcements.js");

function FakeElement(tagName) {
  this.tagName = tagName.toUpperCase();
  this.children = [];
  this.parentNode = null;
  this.listeners = Object.create(null);
  this.attributes = Object.create(null);
  this.className = "";
  this.hidden = false;
  this.open = false;
  this._textContent = "";
}

Object.defineProperty(FakeElement.prototype, "firstChild", {
  get: function () { return this.children[0] || null; }
});

Object.defineProperty(FakeElement.prototype, "textContent", {
  get: function () {
    return this._textContent + this.children.map(function (child) {
      return child.textContent;
    }).join("");
  },
  set: function (value) {
    this._textContent = String(value);
    this.children = [];
  }
});

FakeElement.prototype.setAttribute = function (name, value) {
  this.attributes[name] = String(value);
};

FakeElement.prototype.getAttribute = function (name) {
  return Object.prototype.hasOwnProperty.call(this.attributes, name)
    ? this.attributes[name]
    : null;
};

FakeElement.prototype.appendChild = function (child) {
  this.children.push(child);
  child.parentNode = this;
  return child;
};

FakeElement.prototype.removeChild = function (child) {
  var index = this.children.indexOf(child);
  if (index !== -1) this.children.splice(index, 1);
  child.parentNode = null;
  return child;
};

FakeElement.prototype.addEventListener = function (type, listener) {
  (this.listeners[type] || (this.listeners[type] = [])).push(listener);
};

FakeElement.prototype.dispatchEvent = function (event) {
  (this.listeners[event.type] || []).slice().forEach(function (listener) {
    listener(event);
  });
};

FakeElement.prototype.showModal = function () { this.open = true; };
FakeElement.prototype.close = function () { this.open = false; };

function storageFixture(initial) {
  var values = Object.assign(Object.create(null), initial || {});
  return {
    getItem: function (key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: function (key, value) { values[key] = String(value); },
    dump: function () { return Object.assign({}, values); }
  };
}

function createFixture(options) {
  options = options || {};
  var ids = {};
  ["announcementOpenBtn", "announcementDialog", "announcementCloseBtn",
    "announcementStatus", "announcementList", "announcementEmpty"].forEach(function (id) {
    ids[id] = new FakeElement(id === "announcementDialog" ? "dialog" : "div");
  });
  var listeners = Object.create(null);
  var document = {
    readyState: "complete",
    documentElement: { lang: options.locale || "zh-CN" },
    getElementById: function (id) { return ids[id] || null; },
    createElement: function (tagName) { return new FakeElement(tagName); }
  };
  var translations = {
    "announcement.cached": "Showing the most recently cached announcements.",
    "announcement.severity.info": "Info",
    "announcement.severity.important": "Important",
    "announcement.severity.update": "Update",
    "announcement.openAction": "Learn more",
    "announcement.updateAction": "View update"
  };
  var rootObject = {
    document: document,
    location: { hostname: options.hostname || "hedanbaomi.github.io" },
    localStorage: options.storage || storageFixture(),
    DivinationI18n: {
      getLocale: function () { return options.locale || "zh-CN"; },
      t: function (key) { return translations[key] || key; }
    },
    addEventListener: function (type, listener) {
      (listeners[type] || (listeners[type] = [])).push(listener);
    },
    dispatchEvent: function (event) {
      (listeners[event.type] || []).slice().forEach(function (listener) { listener(event); });
    }
  };
  return { ids: ids, document: document, root: rootObject };
}

function announcement(overrides) {
  return Object.assign({
    id: 1,
    revision: 1,
    severity: "info",
    title: "中文标题",
    body: "中文正文",
    button: "了解详情",
    action_url: ""
  }, overrides || {});
}

function response(data, status, etag) {
  return {
    status: status || 200,
    ok: (status || 200) >= 200 && (status || 200) < 300,
    headers: { get: function (name) { return name.toLowerCase() === "etag" ? (etag || null) : null; } },
    json: async function () { return data; }
  };
}

test("public web announcement contract has stable version, exact query, and no device identity", function () {
  assert.equal(announcements.WEB_VERSION_CODE, 1);
  assert.equal(
    announcements.__test.buildAnnouncementUrl("zh-CN"),
    "https://telemetry.luotianyi.fun/v1/announcements?platform=web&version_code=1&locale=zh-CN"
  );
  assert.doesNotMatch(source, /install_hash|device[_-]?id|UpdateManager|innerHTML/);
  assert.match(html, /id="announcementOpenBtn"/);
  assert.match(html, /id="announcementDialog"/);
  assert.match(html, /src="js\/announcements\.js/);
});

test("important and update announcements prompt once, while info stays list-only", async function () {
  var fixture = createFixture();
  var storage = fixture.root.localStorage;
  var requestedUrl = "";
  var requestedOptions = null;
  fixture.root.fetch = async function () {
    requestedUrl = arguments[0];
    requestedOptions = arguments[1];
    return response({ announcements: [
      announcement({ id: 1, severity: "info" }),
      announcement({ id: 2, severity: "important", title: "重要" }),
      announcement({ id: 3, severity: "update", title: "更新", action_url: "https://example.com/update" })
    ] });
  };
  var controller = announcements.__test.createController(fixture.root);
  controller.init();
  await controller.refresh();

  assert.equal(
    requestedUrl,
    "https://telemetry.luotianyi.fun/v1/announcements?platform=web&version_code=1&locale=zh-CN"
  );
  assert.equal(requestedOptions.method, "GET");
  assert.equal(requestedOptions.credentials, "omit");
  assert.deepEqual(requestedOptions.headers, { Accept: "application/json" });
  assert.equal(Object.prototype.hasOwnProperty.call(requestedOptions.headers, "install_hash"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requestedOptions.headers, "device_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requestedOptions.headers, "If-None-Match"), false);
  assert.equal(fixture.ids.announcementList.children.length, 3);
  assert.equal(fixture.ids.announcementDialog.open, true);
  var marks = JSON.parse(storage.dump()[announcements.__test.READ_STORAGE_KEY]);
  assert.deepEqual(marks, ["2:1", "3:1"]);

  fixture.ids.announcementDialog.close();
  await controller.refresh();
  assert.equal(fixture.ids.announcementDialog.open, false);
});

test("revision changes create a new bounded read mark and trusted HTTPS actions open safely", async function () {
  var fixture = createFixture();
  var storage = fixture.root.localStorage;
  fixture.root.fetch = async function () {
    return response({ announcements: [
      announcement({ id: 7, revision: 2, severity: "update", action_url: "https://example.com/release" }),
      announcement({ id: 8, revision: 1, severity: "important", action_url: "http://example.com/nope" })
    ] });
  };
  var controller = announcements.__test.createController(fixture.root);
  controller.init();
  await controller.refresh();

  var links = [];
  function collect(element) {
    if (element.tagName === "A") links.push(element);
    element.children.forEach(collect);
  }
  collect(fixture.ids.announcementList);
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("target"), "_blank");
  assert.equal(links[0].getAttribute("rel"), "noopener noreferrer");
  assert.match(links[0].textContent, /View update|Learn more|更新|详情/);
  assert.deepEqual(JSON.parse(storage.dump()[announcements.__test.READ_STORAGE_KEY]), ["7:2", "8:1"]);
});

test("network failure is silent and keeps the most recent successful cache", async function () {
  var storage = storageFixture();
  var first = createFixture({ storage: storage });
  first.root.fetch = async function () {
    return response({ announcements: [announcement({ id: 9, title: "缓存公告" })] }, 200, '"cache-etag"');
  };
  var firstController = announcements.__test.createController(first.root);
  firstController.init();
  await firstController.refresh();

  var second = createFixture({ storage: storage });
  second.root.fetch = async function () { throw new Error("offline"); };
  var secondController = announcements.__test.createController(second.root);
  secondController.init();
  await secondController.refresh();

  assert.equal(second.ids.announcementList.children.length, 1);
  assert.equal(second.ids.announcementStatus.textContent, "Showing the most recently cached announcements.");
});

test("Android WebView host and trusted native bridges prevent initialization and fetch", function () {
  assert.equal(
    announcements.__test.isNativeContainer({ location: { hostname: "appassets.androidplatform.net" } }),
    true
  );
  assert.equal(
    announcements.__test.isNativeContainer({ androidTelemetry: {}, location: { hostname: "example.test" } }),
    true
  );
  var fixture = createFixture({ hostname: "appassets.androidplatform.net" });
  var calls = 0;
  fixture.root.fetch = async function () { calls += 1; return response({ announcements: [] }); };
  var controller = announcements.__test.createController(fixture.root);
  controller.init();
  assert.equal(controller.state().guarded, true);
  assert.equal(calls, 0);
});
