const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "js/reading-image.js"), "utf8");
const palette = { background: "#fff", surface: "#eee", text: "#111", muted: "#444", accent: "#333", line: "#999", realms: {
  inner: "#00f", physical: "#0f0", divine: "#f00", underworld: "#000"
} };
function harness(fetch, config = {}) {
  const painted = [], gradients = [], requests = [], sizes = [], transforms = [], events = [];
  const ctx = {
    measureText: text => ({ width: Array.from(text).length * 15 }),
    fillText: (...args) => { painted.push(args[0]); events.push(["text", args[0]]); },
    fillRect() {}, save() {}, restore() {}, scale() {},
    translate: (...args) => transforms.push(["translate", ...args]),
    rotate: (...args) => transforms.push(["rotate", ...args]),
    drawImage: (...args) => { transforms.push(["drawImage", ...args]); events.push(["image", args[0]]); },
    createLinearGradient: (...args) => {
      const gradient = { args, stops: [], addColorStop(...stop) { this.stops.push(stop); } };
      gradients.push(gradient); return gradient;
    }
  };
  const canvas = { getContext: () => ctx, toBlob: callback => { sizes.push([canvas.width, canvas.height]); callback(new Blob(["PNG"], { type: "image/png" })); } };
  const sandbox = {
    document: { createElement: () => canvas }, location: { href: config.location || "https://example.test/classic.html" },
    __qMediaBase: config.mediaBase,
    URL, Blob, AbortController, setTimeout: config.setTimeout || setTimeout, clearTimeout,
    createImageBitmap: config.createImageBitmap || (async () => ({ width: 200, height: 100, close() {} })),
    Image: config.Image,
    fetch: (...args) => { requests.push(args); return fetch ? fetch(...args) : Promise.reject(new Error("offline")); }
  };
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.DivinationReadingImage, painted, gradients, requests, sizes, transforms, events };
}
function base(cards = []) {
  return { title: "Reading", deckName: "Deck", date: "Date", question: "", cards,
    columns: 2, labels: { question: "Question", index: "Index", sources: "Sources" },
    credit: "Artist credit", projectUrl: "https://project.test", officialUrl: "https://official.test" };
}

test("preset coordinates retain spans, offsets, stacking, rotation and bounded extent", () => {
  const t = harness().api._test;
  const layout = t.layoutBoard(base([
    { number: 1, column: 1, row: 1, layer: "major" },
    { number: 1, column: 1, row: 1, layer: "minor" },
    { number: 2, column: 2, row: 1, rowSpan: 2, offsetX: 14, offsetY: 32, rotation: 90 }
  ]));
  assert.equal(layout.cards.length, 3);
  assert.equal(layout.cards[2].card.layer, "minor");
  assert.ok(layout.cards[2].x > layout.cards[0].x);
  assert.ok(layout.cards[2].y > layout.cards[0].y);
  assert.equal(layout.cards[1].rotation, 90);
  for (const entry of layout.cards) {
    assert.ok(entry.x - entry.hw * layout.scale >= 0);
    assert.ok(entry.x + entry.hw * layout.scale <= 1456);
    assert.ok(entry.y - entry.hh * layout.scale >= 0);
    assert.ok(entry.y + entry.hh * layout.scale <= layout.height);
  }
});

test("free board respects z and world coordinates, extreme positions fit, absent coordinates fall back to grid", () => {
  const t = harness().api._test;
  const model = base([
    { number: 1, x: -1000000, y: -1000000, z: 9, boardRotation: -45 },
    { number: 2, x: 1000000, y: 1000000, z: 2, boardRotation: 30 }
  ]);
  model.freeform = true;
  const positioned = t.layoutBoard(model);
  assert.equal(positioned.positioned, true);
  assert.equal(positioned.cards[0].card.number, 2);
  assert.ok(positioned.height <= 1136);
  assert.ok(positioned.scale >= 1);
  for (const entry of positioned.cards) {
    assert.ok(entry.x - entry.hw * positioned.scale >= 0);
    assert.ok(entry.x + entry.hw * positioned.scale <= 1456);
    assert.ok(entry.y - entry.hh * positioned.scale >= 0);
    assert.ok(entry.y + entry.hh * positioned.scale <= positioned.height);
  }
  delete model.cards[1].x;
  const fallback = t.layoutBoard(model);
  assert.equal(fallback.positioned, false);
  assert.notEqual(fallback.cards[0].x, fallback.cards[1].x);
});

test("crossed and exact custom cells retain offsets and expose underlying labels", async () => {
  const h = harness(async () => ({ ok: true, type: "basic", blob: async () => new Blob(["image"]) }));
  const crossed = base([
    { number: 1, column: 2, row: 2, name: "A", image: "assets/cards/major-00.jpeg" },
    { number: 2, column: 2, row: 2, name: "B", offsetX: 14, offsetY: 32, rotation: 90, image: "assets/cards/major-01.jpeg" }
  ]);
  const layout = h.api._test.layoutBoard(crossed);
  assert.equal(layout.cards[0].underCard, true);
  assert.ok(Math.abs((layout.cards[1].cx - layout.cards[0].cx) - 104 * 0.14) < 1e-9);
  assert.ok(Math.abs((layout.cards[1].cy - layout.cards[0].cy) - 158 * 0.32) < 1e-9);
  assert.equal(layout.cards[1].rotation, 90);
  await h.api.render(crossed, palette);
  const lastImage = h.events.findLastIndex(event => event[0] === "image");
  assert.ok(h.events.slice(lastImage + 1).some(event => event[0] === "text" && event[1] === "A"));

  const exact = base([
    { number: 1, column: 1, row: 1, name: "A" },
    { number: 2, column: 1, row: 1, name: "B", rotation: 45 },
    { number: 3, column: 1, row: 1, name: "C" }
  ]);
  const stacked = h.api._test.layoutBoard(exact).cards;
  assert.equal(stacked[0].underCard, true);
  assert.equal(stacked[1].underCard, true);
  assert.equal(stacked[1].rotation, 45);
  assert.ok(stacked[1].cy - stacked[0].cy >= 38);
  assert.ok(stacked[2].cy - stacked[1].cy >= 38);

  const free = { ...exact, freeform: true, cards: exact.cards.map((card, i) => ({ ...card, x: 0, y: 0, z: i })) };
  const freeLayout = h.api._test.layoutBoard(free).cards;
  assert.ok(freeLayout.every(entry => entry.cx === freeLayout[0].cx && entry.cy === freeLayout[0].cy));
  assert.ok(freeLayout.every(entry => !entry.underCard));
});

test("pixel budget stays below bridge and browser limits for tall layouts", () => {
  const t = harness().api._test;
  for (const height of [500, 2500, 10000, 50000]) {
    const size = t.pixelSize(height);
    assert.ok(size.width * size.height <= 3500000);
    assert.ok(size.width <= 8192 && size.height <= 8192);
    assert.ok(size.width * size.height * 4 < 16 * 1024 * 1024);
  }
});

test("realm gradients reproduce left-right and top-bottom border direction", () => {
  const h = harness();
  const ctx = { fillRect() {}, createLinearGradient: (...args) => {
    const g = { args, stops: [], addColorStop(...s) { this.stops.push(s); } };
    h.gradients.push(g); return g;
  } };
  h.api._test.border(ctx, { realmBorder: "inner-underworld" }, palette, 100, 160);
  h.api._test.border(ctx, { realmBorder: "inner-physical" }, palette, 100, 160);
  assert.deepEqual(h.gradients[0].args, [-50, 0, 50, 0]);
  assert.deepEqual(h.gradients[1].args, [0, -80, 0, 80]);
  assert.deepEqual(h.gradients[0].stops.map(s => s[1]), ["#00f", "#00f", "#000", "#000"]);
  assert.deepEqual(h.gradients[1].stops.map(s => s[1]), ["#00f", "#00f", "#0f0", "#0f0"]);
});

test("complete question, card index and credits render with no hidden identity or request", async () => {
  const h = harness();
  const question = "问题".repeat(1000);
  const model = base([
    { number: 1, positionName: "First", name: "Secret identity", orientationLabel: "Reversed", hidden: true, image: "assets/cards/major-00.jpeg", realmLabel: "Secret realm" },
    { number: 2, positionName: "Second", name: "Visible identity", orientationLabel: "Upright", image: "assets/cards/major-01.jpeg" }
  ]);
  model.question = question;
  model.labels.hidden = "Face down";
  const blob = await h.api.render(model, palette);
  assert.equal(blob.type, "image/png");
  assert.equal(h.painted.filter(s => s.includes("问题")).join(""), question);
  assert.ok(h.painted.some(s => s.includes("Visible identity")));
  assert.ok(h.painted.some(s => s.includes("Face down")));
  assert.ok(!h.painted.some(s => s.includes("Secret")));
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0][0], /major-01\.jpeg$/);
  assert.equal(h.requests[0][1].credentials, "omit");
  assert.equal(h.requests[0][1].mode, "cors");
  assert.equal(h.requests[0][1].redirect, "error");
  assert.ok(h.painted.some(s => s.includes("Artist credit")));
  assert.ok(h.painted.includes("https://project.test"));
  assert.ok(h.painted.includes("https://official.test"));
  assert.ok(!h.painted.some(s => /^\d+\. ·/.test(s)));
  assert.ok(h.sizes[0][0] * h.sizes[0][1] <= 3500000);
});

test("only known image paths are accepted", () => {
  const t = harness().api._test;
  assert.ok(t.trustedUrl("assets/cards/m/m-01.jpeg"));
  assert.ok(t.trustedUrl("https://assets.luotianyi.fun/tarot-divination-site/lxxxi/v1/cards/lxxxi-06.webp"));
  for (const url of ["https://evil.test/assets/cards/major-00.jpeg", "assets/cards/major-00.jpeg?q=private", "https://assets.luotianyi.fun/other.webp", "https://assets.luotianyi.fun/tarot-divination-site/lxxxi/v1/cards/lxxxi-82.webp", "data:image/png;base64,AA"]) {
    assert.equal(t.trustedUrl(url), "");
  }
});

test("image decode falls back to a fresh object-URL image", async () => {
  class FreshImage {
    constructor() { this.naturalWidth = 100; this.naturalHeight = 200; }
    set src(src) { if (src) queueMicrotask(() => this.onload()); }
  }
  const h = harness(async () => ({ ok: true, type: "basic", blob: async () => new Blob(["x"]) }), {
    createImageBitmap: async () => { throw new Error("unsupported"); }, Image: FreshImage
  });
  await h.api.render(base([{ number: 1, image: "assets/cards/major-00.jpeg" }]), palette);
  assert.equal(h.transforms.filter(op => op[0] === "drawImage").length, 1);
});

test("timed out images become placeholders while rendering continues", async () => {
  const h = harness((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
  }), { setTimeout: fn => setTimeout(fn, 0) });
  const result = await h.api.render(base([{ number: 1, name: "Visible title", image: "assets/cards/major-00.jpeg" }]), palette);
  assert.equal(result.type, "image/png");
  assert.ok(h.painted.some(s => s.includes("Visible title")));
  assert.equal(h.transforms.filter(op => op[0] === "drawImage").length, 0);
});

test("native protected images only allow the exact session base and card keys", () => {
  const t = harness(null, { location: "https://appassets.androidplatform.net/assets/www/index.html",
    mediaBase: "https://appassets.androidplatform.net/_m/example-session" }).api._test;
  assert.ok(t.trustedUrl("https://appassets.androidplatform.net/_m/example-session/lxxxi-81"));
  for (const url of ["https://appassets.androidplatform.net/_m/another-session/lxxxi-01",
    "https://appassets.androidplatform.net/_m/example-session/lxxxi-00",
    "https://appassets.androidplatform.net/_m/example-session/lxxxi-82",
    "https://appassets.androidplatform.net/_m/example-session/lxxxi-01?x=private"]) {
    assert.equal(t.trustedUrl(url), "");
  }
});

test("word wrapping preserves English words and breaks long unspaced text", () => {
  const t = harness().api._test;
  const measure = { measureText: text => ({ width: text.length }) };
  assert.deepEqual(Array.from(t.wrap(measure, "reading cards today", 9)), ["reading ", "cards ", "today"]);
  assert.deepEqual(Array.from(t.wrap(measure, "abcdefghijk", 5)), ["abcde", "fghij", "k"]);
});

test("image requests have bounded concurrency and reversed art rotates", async () => {
  let active = 0, max = 0;
  const h = harness(async () => {
    active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return { ok: true, type: "basic", blob: async () => new Blob(["image"]) };
  });
  const cards = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, image: "assets/cards/major-00.jpeg", orientation: i === 0 ? "reversed" : "upright" }));
  await h.api.render(base(cards), palette);
  assert.ok(max <= 4);
  assert.equal(h.requests.length, 12);
  assert.equal(h.transforms.filter(op => op[0] === "drawImage").length, 12);
  assert.ok(h.transforms.some(op => op[0] === "rotate" && op[1] === Math.PI));
  const draw = h.transforms.find(op => op[0] === "drawImage");
  assert.equal(draw[4] / draw[5], 2);
});

test("upright and reversed artwork fit between the number and caption", async () => {
  for (const orientation of ["upright", "reversed"]) {
    const h = harness(async () => ({ ok: true, type: "basic", blob: async () => new Blob(["image"]) }), {
      createImageBitmap: async () => ({ width: 100, height: 200, close() {} })
    });
    const model = base([{ number: 1, name: "Card", orientation, image: "assets/cards/major-00.jpeg" }]);
    const layout = h.api._test.layoutBoard(model);
    await h.api.render(model, palette);
    const draw = h.transforms.find(op => op[0] === "drawImage");
    const scale = layout.scale, edge = Math.max(2, 4 * scale), height = 158 * scale;
    const top = -height / 2 + edge + 22 * scale;
    const bottom = height / 2 - edge - 21 * scale;
    const actualTop = orientation === "reversed" ? -draw[3] - draw[5] : draw[3];
    assert.ok(actualTop >= top - 1e-9);
    assert.ok(actualTop + draw[5] <= bottom + 1e-9);
  }
});

test("81 decoded cards stay within one batch and draw in free-board z order", async () => {
  let live = 0, peak = 0, closed = 0;
  const h = harness(async url => ({ ok: true, type: "basic", blob: async () => new Blob([url]) }), {
    createImageBitmap: async blob => {
      const url = await blob.text();
      live++; peak = Math.max(peak, live);
      return { url, width: 100, height: 200, close() { live--; closed++; } };
    }
  });
  const cards = Array.from({ length: 81 }, (_, i) => ({
    number: i + 1, x: i, y: i, z: 81 - i, image: `assets/cards/major-${String(i).padStart(2, "0")}.jpeg`
  }));
  await h.api.render({ ...base(cards), freeform: true }, palette);
  const order = h.events.filter(event => event[0] === "image").map(event => event[1].url);
  assert.deepEqual(order.map(url => Number(url.match(/major-(\d+)\.jpeg$/)[1])),
    Array.from({ length: 81 }, (_, i) => 80 - i));
  assert.ok(peak <= 4, `peak live decoded images: ${peak}`);
  assert.equal(live, 0);
  assert.equal(closed, 81);
});

test("cancellation releases decoded images in an incomplete batch", async () => {
  let live = 0;
  const controller = new AbortController();
  const h = harness((url, options) => {
    if (url.includes("major-00")) return Promise.resolve({ ok: true, type: "basic", blob: async () => new Blob(["image"]) });
    return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  }, { createImageBitmap: async () => {
    live++;
    return { width: 100, height: 200, close() { live--; } };
  } });
  const pending = h.api.render(base([
    { number: 1, image: "assets/cards/major-00.jpeg" },
    { number: 2, image: "assets/cards/major-01.jpeg" }
  ]), palette, { signal: controller.signal });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(live, 1);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(live, 0);
});

test("abort rejects promptly and never requests a hidden card", async () => {
  const h = harness((url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const controller = new AbortController();
  const pending = h.api.render(base([
    { number: 1, image: "assets/cards/major-00.jpeg" },
    { number: 2, image: "assets/cards/major-01.jpeg", hidden: true }
  ]), palette, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(h.requests.length, 1);
});

test("web and Android renderer are identical", () => {
  assert.equal(source, fs.readFileSync(path.join(root, "android-demo/app/src/main/assets/www/js/reading-image.js"), "utf8"));
});
