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

test("the admin page has exactly three named dashboard sections", () => {
  const sections = [...ADMIN_PAGE_HTML.matchAll(/<section\b[^>]*\bid="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(sections, ["announcementsView", "currentStatsView", "historyView"]);
  assert.match(ADMIN_PAGE_HTML, /1\. 公告管理/);
  assert.match(ADMIN_PAGE_HTML, /2\. 当前活跃版本（D1）/);
  assert.match(ADMIN_PAGE_HTML, /3\. 历史遥测（Analytics Engine）/);
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
