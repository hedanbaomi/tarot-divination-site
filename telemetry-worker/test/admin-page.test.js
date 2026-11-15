import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

import { ADMIN_PAGE_HTML } from "../src/admin-page.js";

/**
 * The admin page ships its UI as an inline <script> inside a JavaScript
 * template literal. Any unescaped backslash (for example a bare "\n" that the
 * template turns into a real newline inside a string literal) breaks the
 * inline script with "Invalid or unexpected token". This suite extracts the
 * inline script and parses it for real with node:vm, so the regression is
 * caught at the JavaScript grammar level, not by string matching.
 */

function extractInlineScripts(html) {
  const scripts = [];
  const pattern = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    scripts.push(match[1]);
  }
  return scripts;
}

test("the admin page contains exactly one inline script", () => {
  const scripts = extractInlineScripts(ADMIN_PAGE_HTML);
  assert.equal(scripts.length, 1);
});

test("the admin page has five named dashboard sections", () => {
  const sections = [...ADMIN_PAGE_HTML.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(sections, [
    "announcementsView",
    "currentStatsView",
    "historyView",
    "webHistoryView",
    "aiUsageView"
  ]);
  assert.match(ADMIN_PAGE_HTML, /1\. 公告管理/);
  assert.match(ADMIN_PAGE_HTML, /2\. 当前活跃版本（D1）/);
  assert.match(ADMIN_PAGE_HTML, /3\. 历史遥测（Analytics Engine）/);
  assert.match(ADMIN_PAGE_HTML, /4\. 网页历史访问（Cloudflare）/);
  assert.match(ADMIN_PAGE_HTML, /5\. AI 解读统计（D1）/);
});

test("the history UI uses the authenticated analytics endpoint and fixed windows", () => {
  assert.match(ADMIN_PAGE_HTML, /\/admin\/api\/analytics\?window=/);
  assert.match(ADMIN_PAGE_HTML, /\/admin\/api\/stats/);
  for (const window of ["24h", "7d", "30d"]) {
    assert.match(ADMIN_PAGE_HTML, new RegExp(`\\\"${window}\\\"`));
  }
  assert.match(ADMIN_PAGE_HTML, /active_estimate_meta/);
  assert.match(ADMIN_PAGE_HTML, /distributions/);
  assert.match(ADMIN_PAGE_HTML, /daily_trend/);
  assert.match(ADMIN_PAGE_HTML, /failed_sections/);
  assert.match(ADMIN_PAGE_HTML, /首次上报快照/);
  assert.match(ADMIN_PAGE_HTML, /Authorization|authorization/);
  assert.match(ADMIN_PAGE_HTML, /sessionStorage/);
});

test("the admin page exposes Mini Game as an announcement target and analytics filter", () => {
  assert.match(ADMIN_PAGE_HTML, /value="minigame">minigame · 微信小游戏端<\/option>/);
  assert.match(ADMIN_PAGE_HTML, /value="minigame">微信小游戏端<\/option>/);
  assert.match(ADMIN_PAGE_HTML, /if \(value === "minigame"\) return "微信小游戏端"/);
  assert.match(ADMIN_PAGE_HTML, /按平台与微信运行环境分组/);
  assert.match(ADMIN_PAGE_HTML, /platform === "android" && row\.version_code === 0/);
  assert.match(ADMIN_PAGE_HTML, /微信版本/);
});

test("selecting web in the real platform change handler reloads web statistics", () => {
  const [script] = extractInlineScripts(ADMIN_PAGE_HTML);
  const start = script.indexOf('$("historyPlatform").addEventListener("change"');
  const end = script.indexOf('$("refreshHistory")', start);
  assert.ok(start >= 0 && end > start);
  let change;
  let reloads = 0;
  const select = { value: "web", addEventListener(name, fn) { assert.equal(name, "change"); change = fn; } };
  const state = { historyPlatform: "all" };
  vm.runInNewContext(script.slice(start, end), {
    $: () => select, state, loadAnalytics: () => { reloads++; }
  });
  change();
  assert.equal(state.historyPlatform, "web");
  assert.equal(reloads, 1);
  select.value = "unknown";
  change();
  assert.equal(state.historyPlatform, "web");
  assert.equal(reloads, 1);
});

test("the admin page stays DOM-only and has no external page resources", () => {
  assert.doesNotMatch(ADMIN_PAGE_HTML, /innerHTML/i);
  assert.doesNotMatch(ADMIN_PAGE_HTML, /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\bhref\s*=/i);
  assert.doesNotMatch(ADMIN_PAGE_HTML, /<iframe\b/i);
  assert.match(ADMIN_PAGE_HTML, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg"/);
});

test("the history UI shows partial data with per-item fallbacks instead of hiding the section", () => {
  assert.match(ADMIN_PAGE_HTML, /平均牌数暂不可用/);
  assert.match(ADMIN_PAGE_HTML, /部分历史区段暂不可用/);
  assert.match(ADMIN_PAGE_HTML, /\$\("historyContent"\)\.style\.display = "block"/);
  assert.match(ADMIN_PAGE_HTML, /data\.available !== true/);
  assert.match(ADMIN_PAGE_HTML, /data\.failed_sections/);
  assert.match(ADMIN_PAGE_HTML, /renderFailedSections\(data\.failed_sections\)/);
});

test("the inline script parses as valid JavaScript", () => {
  const [code] = extractInlineScripts(ADMIN_PAGE_HTML);
  assert.doesNotThrow(() => new vm.Script(code), "inline script must compile");
});

test("the preview code keeps escaped newline sequences inside string literals", () => {
  const [code] = extractInlineScripts(ADMIN_PAGE_HTML);
  assert.ok(
    code.includes('"\\n"'),
    'preview must contain the escaped \\n sequence inside quotes'
  );
  // A real newline inside a quoted string literal would break the parser;
  // this double-checks that the template did not materialize one.
  const preview = code.slice(code.indexOf("function preview"));
  const quoted = /"[^"]*"/g;
  let match;
  while ((match = quoted.exec(preview)) !== null) {
    assert.ok(
      !match[0].includes("\n"),
      "no string literal in preview() may contain a raw newline"
    );
  }
});

test("the whole page contains no unescaped backslashes in string literals", () => {
  const [code] = extractInlineScripts(ADMIN_PAGE_HTML);
  // Every backslash inside a double-quoted string literal must be part of a
  // recognized escape sequence; the only one allowed here is "\n".
  const quoted = /"[^"]*"/g;
  let match;
  while ((match = quoted.exec(code)) !== null) {
    const value = match[0];
    const backslashIndex = value.indexOf("\\");
    if (backslashIndex === -1) continue;
    for (let i = backslashIndex; i < value.length - 1; i += 1) {
      if (value[i] === "\\") {
        assert.ok(
          value[i + 1] === "n",
          "the only escaped sequence allowed is \\n"
        );
      }
    }
  }
});

// ---------- AI interpretation usage panel ----------

test("the AI usage panel is independent and uses its own authenticated endpoint", () => {
  assert.match(ADMIN_PAGE_HTML, /\/admin\/api\/ai-usage\?window=/);
  // Only the two documented filters are offered; no free-text model input.
  assert.match(ADMIN_PAGE_HTML, /id="aiUsagePlatform"/);
  assert.match(ADMIN_PAGE_HTML, /<option value="all">全部<\/option>\s*<option value="web">网页版<\/option>\s*<option value="android">Android<\/option>/);
  assert.doesNotMatch(ADMIN_PAGE_HTML, /id="aiUsagePlatform"[^>]*type="text"/);
  for (const window of ["24h", "7d", "30d"]) {
    assert.match(ADMIN_PAGE_HTML, new RegExp(`id="aiUsageWindow${window}"`));
  }
  // Panel state, loader and renderer exist and are wired.
  assert.match(ADMIN_PAGE_HTML, /function loadAiUsage\(/);
  assert.match(ADMIN_PAGE_HTML, /function renderAiUsage\(/);
  assert.match(ADMIN_PAGE_HTML, /function makeAiUsageTable\(/);
  assert.match(ADMIN_PAGE_HTML, /\$\("refreshAiUsage"\)\.addEventListener\("click", loadAiUsage\)/);
  assert.match(ADMIN_PAGE_HTML, /loadAiUsage\(\);/);
  assert.match(ADMIN_PAGE_HTML, /data\.module !== "ai_usage"/);
});

test("the AI usage panel states requests-not-people and unknown-not-zero", () => {
  assert.match(ADMIN_PAGE_HTML, /统计的是 AI 调用的请求次数，不是精确人数/);
  assert.match(ADMIN_PAGE_HTML, /Token 合计（已知用量）/);
  assert.match(ADMIN_PAGE_HTML, /未知用量请求/);
  assert.match(ADMIN_PAGE_HTML, /对话轮数/);
  assert.match(ADMIN_PAGE_HTML, /该表不保存安装标识，无法还原独立用户/);
  assert.match(ADMIN_PAGE_HTML, /未回传用量的请求单列为“未知用量”，它们不是 0/);
  assert.match(ADMIN_PAGE_HTML, /压缩上下文消耗 Token 但不计轮次/);
  assert.match(ADMIN_PAGE_HTML, /测试连接不计入/);
  assert.match(ADMIN_PAGE_HTML, /维度结果已截断/);
  assert.match(ADMIN_PAGE_HTML, /上方汇总卡片仍是完整窗口总量/);
});

test("the AI usage panel renders every field with textContent only", () => {
  const [code] = extractInlineScripts(ADMIN_PAGE_HTML);
  const start = code.indexOf("function makeAiUsageTable(");
  const end = code.indexOf("function loadAnalytics(", start);
  assert.ok(start >= 0 && end > start);
  const section = code.slice(start, end);
  for (const field of [
    "model_id", "platform", "requests", "conversation_rounds",
    "compression_requests", "total_tokens", "unknown_usage_requests",
    "known_usage_requests"
  ]) {
    assert.match(section, new RegExp(`row\\.${field}`));
  }
  // Values reach the DOM through textContent, never markup.
  assert.match(section, /cell\.textContent =/);
  assert.doesNotMatch(section, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(section, /href|src=/);
});

test("the AI usage failure path never renders zeroes for an error", () => {
  const [code] = extractInlineScripts(ADMIN_PAGE_HTML);
  const start = code.indexOf("function loadAiUsage(");
  const end = code.indexOf("function aiUsagePlatformLabel(", start);
  assert.ok(start >= 0 && end > start);
  const section = code.slice(start, end);
  // On a non-2xx response the content block stays hidden and an error shows.
  assert.match(section, /AI 解读统计不可用/);
  assert.match(section, /showAiUsageUnavailable\(/);
  const unavailable = code.slice(
    code.indexOf("function showAiUsageUnavailable("),
    code.indexOf("function aiUsagePlatformLabel(")
  );
  assert.match(unavailable, /\$\("aiUsageContent"\)\.style\.display = "none"/);
  assert.match(unavailable, /\$\("aiUsageUnavailable"\)\.style\.display = "block"/);
});

test("the AI usage table is bounded to its own scroll box and cannot widen the page", () => {
  // Layout regression: the 8-column table has nowrap numeric cells, so without
  // a bounded scroll container its min-content width pushed body.scrollWidth to
  // 601px at a 390px viewport. The table must live inside an overflow-x
  // container that scrolls instead of widening the page.
  assert.match(ADMIN_PAGE_HTML, /\.table-scroll \{ overflow-x: auto;/);
  assert.match(
    ADMIN_PAGE_HTML,
    /<div id="aiUsageTable" class="table-scroll"/
  );
  // Scrolling must not hide or truncate columns. Inspect only the rule block
  // for the table container, not the whole stylesheet (other rules, such as
  // .dialog or .sr-only, legitimately clip unrelated content).
  const styleStart = ADMIN_PAGE_HTML.indexOf(".table-scroll {");
  const styleEnd = ADMIN_PAGE_HTML.indexOf("</style>", styleStart);
  const style = ADMIN_PAGE_HTML.slice(styleStart, styleEnd).split("}")[0] + "}";
  for (const forbidden of ["overflow: hidden", "overflow-x: hidden", "display: none", "text-overflow"]) {
    assert.ok(
      !style.includes(forbidden),
      "the table container must not hide content via " + forbidden
    );
  }
  // The wrapper is a keyboard-reachable, labelled scroll region.
  assert.match(ADMIN_PAGE_HTML, /id="aiUsageTable" class="table-scroll" tabindex="0" role="region"/);
  // All eight columns are still rendered by the builder.
  const [code] = extractInlineScripts(ADMIN_PAGE_HTML);
  const builder = code.slice(
    code.indexOf("function makeAiUsageTable("),
    code.indexOf("function loadAnalytics(")
  );
  for (const header of [
    "模型", "平台", "请求数", "对话轮数", "压缩请求", "Token（已知）", "未知用量", "已知用量"
  ]) {
    assert.ok(builder.includes(`"${header}"`), "column " + header + " must stay rendered");
  }
});
