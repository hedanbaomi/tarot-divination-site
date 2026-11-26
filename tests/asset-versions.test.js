"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..");
const checker = path.join(root, "scripts", "check-asset-versions.mjs");
const digest = data => createHash("sha256").update(String(data).replace(/\r\n/g, "\n"), "utf8").digest("hex").slice(0, 8);
const run = (...args) => spawnSync(process.execPath, [checker, ...args], { encoding: "utf8" });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asset-versions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, "js"));
  fs.mkdirSync(path.join(dir, "css"));
  fs.writeFileSync(path.join(dir, "js", "app.js"), "const x = 1;\r\n");
  fs.writeFileSync(path.join(dir, "js", "with space.js"), "space\n");
  fs.writeFileSync(path.join(dir, "css", "site.css"), "body { color: red }\n");
  for (const page of ["index.html", "classic.html", "ai.html"]) fs.writeFileSync(path.join(dir, page), "<!doctype html>\n");
  return dir;
}

test("fixture: fixes only static local asset versions, preserving markup and query details", t => {
  const dir = fixture(t);
  const js = digest("const x = 1;\r\n");
  const css = digest("body { color: red }\n");
  const original = [
    "<!doctype html>",
    "<!-- <script src='js/missing.js'></script> -->",
    "<script>const fake = \"<link rel='stylesheet' href='css/missing.css'>\";</script>",
    "<style>.fake { content: '<script src=js/missing.js>'; }</style>",
    "<textarea><script src='js/missing.js'></script></textarea>",
    "<SCRIPT defer SRC = 'js/app.js?lang=en&amp;v=old#part'></SCRIPT>",
    "<script src='js/with%20space.js'></script>",
    "<link rel='stylesheet' href='/css/site.css'>",
    "<link href=./css/site.css?theme=dark#frag rel='alternate stylesheet'>",
    "<script src='https://example.test/js/app.js?v=old'></script>",
    "<script src='//cdn.test/js/app.js'></script>",
    "<script src='js/{{name}}.js'></script>",
    "<script src='js/${name}.js'></script>",
    "<link rel='preload' href='css/missing.css'>",
    "<a href='js/missing.js'>not an asset</a>",
    ""
  ].join("\r\n");
  fs.writeFileSync(path.join(dir, "index.html"), original);
  const check = run("--root", dir);
  assert.equal(check.status, 1, check.stderr);
  assert.match(check.stderr, /stale or duplicate version/);
  assert.match(check.stderr, /missing version/);
  assert.match(check.stderr, /\n  - js\/app\.js\?lang=en&amp;v=old#part\n  \+ js\/app\.js\?lang=en&amp;v=/);
  const fix = run("--root", dir, "--fix");
  assert.equal(fix.status, 0, fix.stderr);
  const expected = original
    .replace("js/app.js?lang=en&amp;v=old#part", `js/app.js?lang=en&amp;v=${js}#part`)
    .replace("js/with%20space.js", `js/with%20space.js?v=${digest("space\n")}`)
    .replace("href='/css/site.css'", `href='/css/site.css?v=${css}'`)
    .replace("./css/site.css?theme=dark#frag", `./css/site.css?theme=dark&v=${css}#frag`);
  assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), expected);
  const second = run("--root", dir, "--fix");
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(path.join(dir, "index.html"), "utf8"), expected);
  assert.equal(run("--root", dir).status, 0);
});

test("fixture: missing assets fail even with --fix and duplicate versions are repaired", t => {
  const dir = fixture(t);
  const page = path.join(dir, "classic.html");
  fs.writeFileSync(page, '<script src="js/app.js?v=bad&x=1&v=bad#p"></script>\n<script src="js/absent.js"></script>\n');
  const result = run("--root", dir, "--fix");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /cannot read asset js\/absent\.js/);
  assert.equal(fs.readFileSync(page, "utf8"), `<script src="js/app.js?v=${digest("const x = 1;\r\n")}&x=1#p"></script>\n<script src="js/absent.js"></script>\n`);
});

test("fixture: CRLF and LF line endings produce the same content hash", t => {
  const dir = fixture(t);
  const expected = digest("const x = 1;\n");
  const page = path.join(dir, "index.html");
  fs.writeFileSync(page, `<script src="js/app.js?v=${expected}"></script>\n`);
  assert.equal(run("--root", dir).status, 0);
  fs.writeFileSync(path.join(dir, "js", "app.js"), "const x = 1;\n");
  assert.equal(run("--root", dir).status, 0);
});

test("repository pages reference existing assets with their current content hashes", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
