"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const requests = [], liveUrls = new Set();
  let nextUrl = 0;
  function element() {
    return Object.assign(new EventTarget(), {
      isConnected: true, focus() { this.focused = true; },
      removeAttribute(key) { delete this[key]; }
    });
  }
  const ids = Object.fromEntries(["Dialog", "Preview", "Appearance", "Status", "Save", "Retry", "Close"]
    .map(id => [id, element()]));
  const opener = element(), appearance = { value: "current" };
  ids.Appearance.querySelector = () => appearance;
  ids.Dialog.showModal = () => { ids.Dialog.open = true; };
  ids.Dialog.close = () => { ids.Dialog.open = false; };
  const window = new EventTarget();
  Object.assign(window, {
    document: { getElementById: key => ids[key.slice("readingImage".length)], activeElement: opener },
    AbortController, Date,
    URL: {
      createObjectURL() { const url = "blob:" + ++nextUrl; liveUrls.add(url); return url; },
      revokeObjectURL(url) { assert.ok(liveUrls.delete(url), url); }
    },
    getComputedStyle: () => ({ getPropertyValue: () => "#112233" }),
    DivinationI18n: { t: key => key },
    DivinationReadingImage: {
      render(model, palette, { signal }) {
        return new Promise((resolve, reject) => requests.push({ resolve, reject, model, palette, signal }));
      }
    }
  });
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../js/reading-image-ui.js"), "utf8"), window);
  const open = () => window.DivinationReadingImageUi.open({}, "2026-11-23T08:00:00Z");
  const change = () => ids.Appearance.dispatchEvent(new Event("change"));
  const ready = async (i) => { requests[i].resolve(new Blob(["PNG"])); await new Promise(resolve => setImmediate(resolve)); };
  return { open, change, ready, requests, ids, liveUrls, opener, appearance, api: window.DivinationReadingImageUi };
}

test("theme changes and closing invalidate unfinished encodes and release each preview URL", async () => {
  const h = setup();
  h.open();
  h.appearance.value = "parchment";
  h.change();
  assert.equal(h.requests[0].signal.aborted, true);
  assert.notEqual(h.requests[0].palette.background, h.requests[1].palette.background);
  await h.ready(1);
  assert.equal(h.ids.Save.disabled, false);
  await h.ready(0);
  assert.equal(h.liveUrls.size, 1);
  h.change();
  assert.equal(h.liveUrls.size, 0);
  assert.equal(h.ids.Save.disabled, true);
  assert.equal(h.api.handleBack(), true);
  assert.equal(h.api.handleBack(), false);
  assert.equal(h.opener.focused, true);
  h.open();
  await h.ready(2);
  assert.equal(h.liveUrls.size, 0);
  await h.ready(3);
  assert.equal(h.liveUrls.size, 1);
  h.ids.Close.dispatchEvent(new Event("click"));
  assert.equal(h.liveUrls.size, 0);
});

test("a failed render offers a local retry before enabling save", async () => {
  const h = setup();
  h.open();
  h.requests[0].reject(new Error("Canvas unavailable"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ids.Retry.hidden, false);
  assert.equal(h.ids.Save.disabled, true);
  assert.equal(h.ids.Status.textContent, "image.failed");
  h.ids.Retry.dispatchEvent(new Event("click"));
  await h.ready(1);
  assert.equal(h.ids.Save.disabled, false);
  assert.equal(h.ids.Retry.hidden, true);
  h.api.handleBack();
});
