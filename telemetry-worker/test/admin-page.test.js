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
