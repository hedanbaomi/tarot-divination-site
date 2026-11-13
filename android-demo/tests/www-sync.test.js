"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const projectRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectRoot, "..");
const www = path.join(projectRoot, "app", "src", "main", "assets", "www");
const normalize = (text) => text.replace(/\r\n/g, "\n");

// 牌轮/扇形是纯网页逻辑，App 与网站必须是同一份代码（App 只换了外壳与原生桥）。
test("App 内的牌轮脚本与网站根目录一致", function () {
  const site = normalize(fs.readFileSync(path.join(repoRoot, "js", "deck-ring.js"), "utf8"));
  const bundled = normalize(fs.readFileSync(path.join(www, "js", "deck-ring.js"), "utf8"));
  assert.equal(bundled === site, true, "js/deck-ring.js 需要与网站根目录保持一致");
});

test("App 内的脚本引用都带版本戳，避免 WebView 继续用旧缓存", function () {
  const html = fs.readFileSync(path.join(www, "index.html"), "utf8");
  const srcs = [...html.matchAll(/<script[^>]+src="(js\/[^"]+)"/g)].map((m) => m[1]);
  const missing = srcs.filter((src) => !src.includes("?v=") && !src.includes("-data") && !src.endsWith("history-store.js"));
  assert.deepEqual(missing, [], "脚本缺少 ?v= 版本戳");
});
