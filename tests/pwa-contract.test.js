"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const android = "android-demo/app/src/main/assets/www";
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const scope = "https://host.example/tarot-divination-site/";
const source = read("sw.js");

test("manifest and PNGs install at the current subpath; all three entry points are Web-only", () => {
  const manifest = JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.name && manifest.short_name);
  for (const color of [manifest.background_color, manifest.theme_color]) assert.match(color, /^#[0-9a-f]{6}$/i);
  const expected = [
    ["assets/icons/pwa-icon-192.png", 192, "any"],
    ["assets/icons/pwa-icon-512.png", 512, "any"],
    ["assets/icons/pwa-icon-maskable-512.png", 512, "maskable"]
  ];
  assert.equal(manifest.icons.length, expected.length);
  for (const [file, size, purpose] of expected) {
    assert.deepEqual(manifest.icons.find(icon => icon.src === file), {
      src: file, sizes: size + "x" + size, type: "image/png", purpose
    });
    assert.equal(new URL(file, scope).href, scope + file);
  }
  for (const [file, size] of [...expected, ["assets/icons/apple-touch-icon.png", 180]]) {
    const png = fs.readFileSync(path.join(root, file));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  for (const file of ["index.html", "classic.html", "ai.html"]) {
    const html = read(file);
    const head = html.slice(0, html.indexOf("</head>"));
    assert.match(head, /rel="manifest" href="manifest\.webmanifest"/);
    assert.match(head, /rel="apple-touch-icon" href="assets\/icons\/apple-touch-icon\.png"/);
    assert.match(head, /name="apple-mobile-web-app-capable" content="yes"/);
    assert.match(head, /name="apple-mobile-web-app-status-bar-style" content="default"/);
    assert.match(html, /src="js\/pwa-register\.js\?v=[0-9a-f]{8}"[^>]*><\/script>\s*<\/body>/);
    assert.doesNotMatch(read(path.join(android, file)), /rel="manifest"|pwa-register\.js/);
  }
  for (const file of ["sw.js", "manifest.webmanifest", "js/pwa-register.js", ...expected.map(x => x[0]), "assets/icons/apple-touch-icon.png"]) {
    assert.equal(fs.existsSync(path.join(root, android, file)), false, file);
  }
});

test("registration only runs on HTTPS or HTTP loopback, with no Android bridge", () => {
  function registrations(url, extras = {}, supported = true) {
    const calls = [];
    const navigator = supported ? { serviceWorker: { register(file, opts) {
      calls.push([file, opts.scope]);
      return Promise.resolve();
    } } } : {};
    vm.runInNewContext(read("js/pwa-register.js"), { navigator, window: {location: new URL(url), ...extras} });
    return calls;
  }
  for (const url of [scope, "http://localhost:8000/", "http://127.0.0.1:8123/project/"]) {
    assert.deepEqual(registrations(url), [["./sw.js", "./"]]);
  }
  for (const url of ["file:///site/index.html", "file://localhost/test", "http://host.example/", "http://localhost.example/"]) {
    assert.deepEqual(registrations(url), []);
  }
  for (const name of ["androidAbout", "androidHistoryExport", "androidAiConfig"]) {
    assert.deepEqual(registrations(scope, { [name]: null }), []);
  }
  assert.deepEqual(registrations(scope, {}, false), []);
});

// Exercise the actual fetch listener. An undefined result means the request was
// never claimed by respondWith, which is stronger than checking cache keys.
function worker(fetchImpl = async request => {
  const response = new Response(request.url, { headers: { "content-type": "image/jpeg" } });
  Object.defineProperties(response, { type: {value: "basic"}, url: {value: request.url} });
  return response;
}) {
  const listeners = {}, stores = new Map(), installed = [];
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name),
    match: async (key, {cacheName}) => stores.get(cacheName)?.get(key)?.clone(),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const files = stores.get(name);
      return {
        addAll: async requests => installed.push(...requests),
        put: async (key, response) => files.set(key, response),
        keys: async () => [...files.keys()],
        delete: async key => files.delete(key)
      };
    }
  };
  const self = {
    registration: {scope}, location: new URL(scope), navigator: {onLine: true},
    clients: {claim: async () => {}}, addEventListener: (name, fn) => { listeners[name] = fn; }
  };
  vm.runInNewContext(source, { self, URL, Response, Request, AbortController, TextEncoder, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout, caches, fetch: fetchImpl });
  return {
    stores, installed, self,
    lifecycle(name) {
      let pending;
      listeners[name]({ waitUntil(task) { pending = task; } });
      return pending;
    },
    dispatch(url, init) {
      let handled;
      listeners.fetch({ request: new Request(new URL(url, scope), init), respondWith(task) { handled = task; } });
      return handled;
    }
  };
}

test("install saves all three pages and their versioned dependencies atomically, without card art", async () => {
  const w = worker();
  await w.lifecycle("install");
  const paths = new Set(w.installed.map(request => {
    assert.ok(request.url.startsWith(scope));
    assert.equal(request.redirect, "error");
    assert.ok(!request.url.includes("assets/cards/") && !request.url.endsWith(".webp"));
    return request.url.slice(scope.length);
  }));
  for (const page of ["index.html", "classic.html", "ai.html"]) {
    assert.ok(paths.has(page));
    for (const match of read(page).matchAll(/(?:src|href)="((?:css|js)\/[^"]+\?v=[0-9a-f]{8})"/g)) {
      assert.ok(paths.has(match[1]), match[1]);
    }
  }
  const current = [...w.stores.keys()][0];
  const old = current.replace(/shell-[\da-f]+$/, "shell-old");
  const sibling = "quareia-pwa:" + encodeURIComponent(scope + "sibling/") + ":shell-other";
  w.stores.set(old, new Map());
  w.stores.set(sibling, new Map());
  await w.lifecycle("activate");
  assert.deepEqual([...w.stores.keys()], [current, sibling]);
});

test("the worker passes protected art, APIs, other scopes, authenticated and non-GET requests through", () => {
  const w = worker();
  for (const url of ["https://assets.luotianyi.fun/tarot-divination-site/lxxxi/v1/cards/lxxxi-01.webp",
    "https://telemetry.example/v1/events", "https://provider.example/v1/models", "/other/assets/cards/major-00.jpeg",
    "api/chat", "assets/cards/LXXXI_SOURCE.md", "assets/cards/lxxxi/face.jpeg", "assets/cards/m/m-01.jpeg?secret=1"]) {
    assert.equal(w.dispatch(url), undefined, url);
  }
  for (const init of [{method: "POST"}, {method: "HEAD"}, {headers: {Authorization: "fixture"}},
    {headers: {Range: "bytes=0-1"}}, {cache: "no-store"}]) assert.equal(w.dispatch("index.html", init), undefined);
  assert.doesNotMatch(source, /luotianyi\.fun/i);
});

test("network-first serves changed content and falls back offline without caching a readingId", async () => {
  let body = "first";
  const w = worker(async (request, options) => {
    assert.equal(options.mode, "same-origin");
    if (body === null) throw new Error("offline");
    const response = new Response(body);
    Object.defineProperties(response, { type: {value: "basic"}, url: {value: request.url} });
    return response;
  });
  const script = read("ai.html").match(/src="(js\/pwa-register\.js\?v=[a-f0-9]+)"/)[1];
  const art = "assets/icons/sky-face-ember.webp";
  assert.equal(await (await w.dispatch(art)).text(), "first");
  body = "updated";
  assert.equal(await (await w.dispatch(art)).text(), "updated");
  body = read("js/pwa-register.js");
  await w.dispatch(script);
  body = "new release fetched under the old URL";
  assert.equal(await (await w.dispatch(script)).text(), read("js/pwa-register.js"));
  body = read("ai.html");
  await w.dispatch("ai.html");
  body = "<html>the next release</html>";
  assert.equal(await (await w.dispatch("ai.html")).text(), body);
  await w.dispatch("ai.html?readingId=private-id");
  body = null;
  assert.equal(await (await w.dispatch(art)).text(), "updated");
  await assert.rejects(w.dispatch(script.replace(/v=.+/, "v=new-version")), /offline/);
  assert.equal(await (await w.dispatch("ai.html?readingId=another-id")).text(), read("ai.html"));
  assert.deepEqual([...w.stores.values()].flatMap(m => [...m.keys()]), [scope + art, scope + script, scope + "ai.html"]);
});

test("an interrupted response body falls back even after successful HTTP headers", async () => {
  let interrupted = false;
  const w = worker(async request => {
    const body = interrupted ? new ReadableStream({
      start(controller) { controller.error(new TypeError("connection reset")); }
    }) : read("ai.html");
    const response = new Response(body);
    Object.defineProperties(response, {type: {value: "basic"}, url: {value: request.url}});
    return response;
  });
  await w.dispatch("ai.html");
  interrupted = true;
  assert.equal(await (await w.dispatch("ai.html")).text(), read("ai.html"));
});

test("redirected, cross-origin, private and non-image responses cannot enter the card cache", async () => {
  const card = "assets/cards/m/m-01.jpeg";
  for (const [url, redirected, policy, type] of [
    [scope + card, true, "public", "image/jpeg"],
    ["https://other.example/face.jpeg", false, "public", "image/jpeg"],
    [scope + card, false, "private, no-store", "image/jpeg"],
    [scope + card, false, "public", "text/html"]
  ]) {
    const w = worker(async (_request, options) => {
      assert.equal(options.mode, "same-origin");
      const response = new Response("online", {headers: { "Cache-Control": policy, "Content-Type": type }});
      Object.defineProperties(response, {url: {value: url}, redirected: {value: redirected}, type: {value: "basic"}});
      return response;
    });
    assert.equal(await (await w.dispatch(card)).text(), "online");
    assert.equal(w.stores.size, 0);
  }
});

test("card cache is lazy, bounded after parallel writes and never stores a placeholder", async () => {
  const w = worker();
  const paths = Array.from({length: 78}, (_, i) => "assets/cards/m/m-" + String(i + 1).padStart(2, "0") + ".jpeg");
  for (let i = 0; i < 22; i++) paths.push("assets/cards/major-" + String(i).padStart(2, "0") + ".jpeg");
  await Promise.all(paths.map(file => w.dispatch(file)));
  const cache = [...w.stores.values()][0];
  assert.equal(cache.size, 96);
  assert.ok(!cache.has(scope + paths[0]));
  w.self.navigator.onLine = false;
  assert.equal(await (await w.dispatch(paths.at(-1))).text(), scope + paths.at(-1));
  assert.equal((await w.dispatch(paths[0])).headers.get("Content-Type"), "image/svg+xml");
  assert.equal(cache.size, 96);
});
