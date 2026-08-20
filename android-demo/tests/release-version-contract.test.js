"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const projectRoot = path.resolve(__dirname, "..");

test("Android v1.4.0 uses the next installable version identity", function () {
  const gradle = fs.readFileSync(path.join(projectRoot, "app", "build.gradle.kts"), "utf8");

  assert.match(gradle, /versionCode\s*=\s*8\b/);
  assert.match(gradle, /versionName\s*=\s*"1\.4\.0"/);
});
