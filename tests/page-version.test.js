"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const root = path.join(__dirname, "..");
const script = fs.readFileSync(path.join(root, "js/page-version.js"), "utf8");
const preference = "quareia-page-version";
const draft = "quareia-divination-free-board-draft-v1";
const site = "https://example.test/tarot-divination-site/";

function visit(page, data, blocked = false) {
  let url = new URL(page, site).href;
  const classic = new URL(url).pathname.endsWith("/classic.html");
  const storage = {
    getItem(key) { if (blocked) throw new Error("unavailable"); return data.get(key) ?? null; },
    setItem(key, value) { data.set(key, value); }
  };
  vm.runInNewContext(script, {
    URL, document: { documentElement: { dataset: classic ? { pageVersion: "classic" } : {} } },
    localStorage: storage, window: { location: { href: url, replace(next) { url = next; } } },
    history: { state: null, replaceState(_state, _title, next) { url = next; } }
  });
  return url;
}

test("classic preference respects the Pages subpath and an explicit switch back", () => {
  const data = new Map();
  assert.equal(visit("", data), site);
  visit("classic.html", data);
  assert.equal(data.get(preference), "classic");
  assert.equal(visit("?lang=en#settings", data), site + "classic.html?lang=en#settings");
  assert.equal(visit("index.html?view=modern&lang=en", data), site + "index.html?lang=en");
  assert.equal(visit("", data), site);
  assert.equal(data.get(preference), "modern");
  assert.equal(visit("classic.html", data, true), site + "classic.html");
  assert.equal(visit("index.html?view=modern", data, true), site + "index.html");
});

test("the original draft seeds classic once, without changing the modern draft", () => {
  const raw = JSON.stringify({ schema: "free-board/v1", cards: [] });
  const data = new Map([[draft, raw]]);
  visit("", data);
  assert.equal(data.get(draft), raw);
  assert.equal(data.get(draft + "-classic"), raw);
  data.delete(draft + "-classic");
  visit("classic.html", data);
  assert.equal(data.has(draft + "-classic"), false);
  const newer = new Map([[draft, JSON.stringify({ schema: "free-board/v1", layout: 3 })]]);
  visit("classic.html", newer);
  assert.equal(newer.has(draft + "-classic"), false);
});

test("both versions have working local assets and a switch inside their settings form", () => {
  for (const [file, href] of [["index.html", "classic.html"], ["classic.html", "index.html?view=modern"]]) {
    const html = fs.readFileSync(path.join(root, file), "utf8");
    const settings = html.slice(html.indexOf('id="settingsBody"'), html.indexOf("</section>", html.indexOf('id="settingsBody"')));
    assert.ok(settings.includes('id="switchPageVersion" href="' + href + '"'));
    for (const m of html.matchAll(/<script\s+src="([^"?]+)(?:\?[^"]*)?"/g)) {
      new vm.Script(fs.readFileSync(path.join(root, m[1]), "utf8"), { filename: m[1] });
    }
    if (file === "classic.html") {
      assert.match(html, /id="freeBoardViewport"/);
      assert.doesNotMatch(html, /css\/redesign\.css|js\/deck-ring\.js/);
    }
  }
});
