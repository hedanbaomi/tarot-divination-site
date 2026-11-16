"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const rootDir = path.resolve(__dirname, "..");
const androidWwwDir = path.join(rootDir, "android-demo", "app", "src", "main", "assets", "www");
const aiUi = require("../js/ai-ui.js");
const chatStoreModule = require("../js/ai-chat-store.js");
const contextModule = require("../js/ai-context.js");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function toCamelDatasetKey(attrName) {
  return attrName
    .slice(5)
    .replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

function createFakeDomEnvironment() {
  function matchesSimpleSelector(node, selector) {
    if (!node || node.nodeType !== 1) return false;
    const sel = selector.trim();
    if (!sel) return false;
    if (sel.startsWith("#")) {
      return node.id === sel.slice(1);
    }
    if (sel.startsWith(".")) {
      return node.classList.contains(sel.slice(1));
    }
    if (sel.startsWith("[") && sel.endsWith("]")) {
      const inner = sel.slice(1, -1);
      const eqIdx = inner.indexOf("=");
      if (eqIdx === -1) {
        return node.hasAttribute(inner);
      }
      const attr = inner.slice(0, eqIdx).trim();
      const val = inner.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      return node.getAttribute(attr) === val;
    }
    const attrBracket = sel.indexOf("[");
    if (attrBracket !== -1 && sel.endsWith("]")) {
      const tag = sel.slice(0, attrBracket).toUpperCase();
      return node.nodeName === tag && matchesSimpleSelector(node, sel.slice(attrBracket));
    }
    const dotIdx = sel.indexOf(".");
    if (dotIdx > 0) {
      const tag = sel.slice(0, dotIdx).toUpperCase();
      const cls = sel.slice(dotIdx + 1);
      return node.nodeName === tag && node.classList.contains(cls);
    }
    return node.nodeName === sel.toUpperCase();
  }

  class FakeClassList {
    constructor(owner) {
      this.owner = owner;
      this._set = new Set();
    }
    _syncFromString(str) {
      this._set.clear();
      for (const token of String(str || "").split(/\s+/)) {
        if (token) this._set.add(token);
      }
    }
    _syncToAttr() {
      this.owner.attributes.class = Array.from(this._set).join(" ");
    }
    add(...tokens) {
      for (const t of tokens) {
        if (t) this._set.add(t);
      }
      this._syncToAttr();
    }
    remove(...tokens) {
      for (const t of tokens) {
        this._set.delete(t);
      }
      this._syncToAttr();
    }
    toggle(token, force) {
      const shouldHave = force === undefined ? !this._set.has(token) : Boolean(force);
      if (shouldHave) this._set.add(token);
      else this._set.delete(token);
      this._syncToAttr();
      return shouldHave;
    }
    contains(token) {
      return this._set.has(token);
    }
  }

  class FakeNode {
    constructor(nodeType, nodeName, ownerDocument) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.tagName = nodeType === 1 ? nodeName : undefined;
      this.ownerDocument = ownerDocument || null;
      this.parentNode = null;
      this.childNodes = [];
      this.attributes = Object.create(null);
      this.dataset = Object.create(null);
      this.style = Object.create(null);
      this.classList = new FakeClassList(this);
      this.listeners = Object.create(null);
      this._id = "";
      this._text = "";
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this.open = false;
      this.value = "";
      this.type = "";
      this.placeholder = "";
      this.href = "";
      this.title = "";
      this.scrollTop = 0;
      this.scrollHeight = 200;
      this.clientHeight = 200;
    }

    get id() {
      return this._id;
    }
    set id(val) {
      this._id = String(val || "");
      this.attributes.id = this._id;
      if (this.ownerDocument && this._id) {
        this.ownerDocument._byId.set(this._id, this);
      }
    }

    get className() {
      return this.attributes.class || "";
    }
    set className(val) {
      this.classList._syncFromString(val);
      this.classList._syncToAttr();
    }

    get children() {
      return this.childNodes.filter((n) => n.nodeType === 1);
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get lastChild() {
      return this.childNodes[this.childNodes.length - 1] || null;
    }
    get options() {
      return this.childNodes.filter((n) => n.nodeType === 1 && n.nodeName === "OPTION");
    }

    appendChild(child) {
      if (child.nodeType === 11) {
        const items = child.childNodes.slice();
        child.childNodes = [];
        for (const grand of items) {
          this.appendChild(grand);
        }
        return child;
      }
      if (child.parentNode) {
        const idx = child.parentNode.childNodes.indexOf(child);
        if (idx !== -1) child.parentNode.childNodes.splice(idx, 1);
      }
      child.parentNode = this;
      this.childNodes.push(child);
      return child;
    }

    insertBefore(newNode, refNode) {
      if (!refNode) return this.appendChild(newNode);
      if (newNode.parentNode) {
        const prevIdx = newNode.parentNode.childNodes.indexOf(newNode);
        if (prevIdx !== -1) newNode.parentNode.childNodes.splice(prevIdx, 1);
      }
      const idx = this.childNodes.indexOf(refNode);
      newNode.parentNode = this;
      if (idx === -1) {
        this.childNodes.push(newNode);
      } else {
        this.childNodes.splice(idx, 0, newNode);
      }
      return newNode;
    }

    replaceChildren(...nodes) {
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
      this._text = "";
      for (const n of nodes) {
        this.appendChild(n);
      }
    }

    setAttribute(k, v) {
      const str = String(v);
      this.attributes[k] = str;
      if (k === "id") this.id = str;
      else if (k === "class") this.className = str;
      else if (k === "href") this.href = str;
      else if (k === "placeholder") this.placeholder = str;
      else if (k === "open") this.open = true;
      else if (k.startsWith("data-")) this.dataset[toCamelDatasetKey(k)] = str;
    }

    getAttribute(k) {
      if (k.startsWith("data-")) {
        const camel = toCamelDatasetKey(k);
        if (camel in this.dataset) return this.dataset[camel];
      }
      return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null;
    }

    hasAttribute(k) {
      return this.getAttribute(k) !== null;
    }

    removeAttribute(k) {
      delete this.attributes[k];
      if (k === "open") this.open = false;
      if (k.startsWith("data-")) delete this.dataset[toCamelDatasetKey(k)];
    }

    set textContent(v) {
      this._text = String(v);
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
    }

    get textContent() {
      if (this.nodeType === 3) return this._text;
      if (this.childNodes.length === 0) return this._text;
      return this.childNodes.map((c) => c.textContent).join("");
    }

    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    }

    removeEventListener(type, fn) {
      if (!this.listeners[type]) return;
      this.listeners[type] = this.listeners[type].filter((h) => h !== fn);
    }

    dispatchEvent(ev) {
      const eventObj = Object.assign({
        target: this,
        currentTarget: this,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {}
      }, ev);
      for (const fn of (this.listeners[eventObj.type] || []).slice()) {
        fn.call(this, eventObj);
      }
      return !eventObj.defaultPrevented;
    }

    click() {
      if (this.disabled) return;
      this.dispatchEvent({ type: "click", target: this });
    }

    focus() {
      if (this.ownerDocument) this.ownerDocument.activeElement = this;
    }

    closest(selector) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (matchesSimpleSelector(cur, selector)) return cur;
        cur = cur.parentNode;
      }
      return null;
    }

    querySelectorAll(selector) {
      const results = [];
      function visit(n) {
        for (const child of n.childNodes || []) {
          if (child.nodeType === 1) {
            if (matchesSimpleSelector(child, selector)) results.push(child);
            visit(child);
          }
        }
      }
      visit(this);
      return results;
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
  }

  const doc = {
    readyState: "complete",
    title: "",
    activeElement: null,
    _byId: new Map(),
    listeners: Object.create(null),
    documentElement: null,
    head: null,
    body: null,
    createElement(tag) {
      return new FakeNode(1, String(tag).toUpperCase(), this);
    },
    createTextNode(text) {
      const tn = new FakeNode(3, "#text", this);
      tn._text = String(text);
      return tn;
    },
    createDocumentFragment() {
      return new FakeNode(11, "#document-fragment", this);
    },
    getElementById(id) {
      const found = this.documentElement ? this.documentElement.querySelector("#" + id) : null;
      return found || this._byId.get(id) || null;
    },
    querySelectorAll(selector) {
      return this.documentElement ? this.documentElement.querySelectorAll(selector) : [];
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    },
    dispatchEvent(ev) {
      const eventObj = Object.assign({
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {}
      }, ev);
      for (const fn of (this.listeners[eventObj.type] || []).slice()) {
        fn.call(this, eventObj);
      }
      return !eventObj.defaultPrevented;
    }
  };

  doc.documentElement = doc.createElement("html");
  doc.head = doc.createElement("head");
  doc.body = doc.createElement("body");
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return doc;
}

function createFakeDomDocument() {
  return createFakeDomEnvironment();
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); }
  };
}

const REQUIRED_HTML_IDS = [
  "aiChatList", "aiMessages", "aiPromptInput", "aiSendBtn", "aiStopBtn",
  "aiPickReadingsBtn", "aiPickerModal", "aiPickerDeckFilter", "aiRenameModal",
  "aiSettingsModal", "aiProfileFormat", "aiProfileApiKey", "aiVertexGroup",
  "aiLockedPromptNote", "aiPresetRow", "aiFieldContextWindow", "aiDetectContextBtn",
  "aiContextWindowHint", "aiFieldAutoCompress", "aiContextMeter",
  "aiClearConfigBtn",
  "themeSwatches", "themeToast", "confirmDialog",
  "choiceDialog", "choiceDialogKicker", "choiceDialogTitle", "choiceOptions", "choiceCancelBtn",
  "languageToggle"
];

const FORBIDDEN_HTML_IDS = [
  "aiInspectContextBtn", "aiContextModal", "aiContextPre", "aiFieldSystemPrompt"
];

const THEME_IDS = [
  "celestial", "parchment", "ember", "grove", "grove-light", "jade", "dusk", "ash"
];

const REQUIRED_I18N_KEYS = [
  "ai.open", "ai.pageTitle", "ai.pageDescription", "ai.contextBarAria", "ai.deckTarot",
  "ai.settingsTitle", "history.openInAi", "privacy.ai",
  "ai.lockedPromptNote", "ai.fieldContextWindow", "ai.fieldAutoCompress", "ai.contextMeter",
  "ai.presetLabel", "ai.preset.deepseek", "ai.preset.deepseekReasoner", "ai.presetApplied",
  "ai.clearConfig", "ai.clearConfigTitle", "ai.clearConfigMsg", "ai.clearConfigConfirm", "ai.configCleared",
  "ai.exportedTo", "ai.exportCancelled", "ai.exportFailed",
  "ai.chatChangedTitle", "ai.saveFailedTitle"
];

function assertAiHtmlContract(label, html) {
  for (const id of REQUIRED_HTML_IDS) {
    assert.ok(html.includes(`id="${id}"`), `${label} ai.html missing #${id}`);
  }
  for (const badId of FORBIDDEN_HTML_IDS) {
    assert.equal(html.includes(`id="${badId}"`), false, `${label} ai.html must not contain #${badId}`);
  }
  for (const themeId of THEME_IDS) {
    assert.ok(html.includes(`data-theme-id="${themeId}"`), `${label} ai.html missing theme swatch ${themeId}`);
  }
  assert.ok(html.includes('<meta name="theme-color"'), `${label} ai.html missing theme-color meta`);
  assert.ok(html.includes('data-i18n-content="ai.pageDescription"'), `${label} ai.html meta description missing data-i18n-content`);
  assert.ok(html.includes('data-i18n-aria-label="ai.contextBarAria"'), `${label} ai.html context bar missing data-i18n-aria-label`);
  assert.ok(html.includes('data-i18n="ai.deckTarot"'), `${label} ai.html tarot option missing data-i18n`);
  assert.ok(html.includes('src="js/custom-selects.js"'), `${label} ai.html must load js/custom-selects.js to replace native <select> UI`);
  assert.ok(/<label[^>]+for="aiPickerDeckFilter"/i.test(html), `${label} ai.html must bind an explicit <label for="aiPickerDeckFilter">`);
  assert.ok(/<label[^>]+for="aiProfileFormat"/i.test(html), `${label} ai.html must bind an explicit <label for="aiProfileFormat">`);
  assert.ok(html.includes('data-preset="deepseek"'), `${label} ai.html missing the DeepSeek quick preset chip`);
  assert.ok(html.includes('data-preset="deepseek-reasoner"'), `${label} ai.html missing the DeepSeek reasoner quick preset chip`);
  assert.ok(html.includes('id="aiPresetLabel"'), `${label} ai.html quick presets must carry a group label`);
  assert.equal(/<label\b[^>]*>(?:(?!<\/label>)[\s\S])*?<select\b/i.test(html), false, `${label} ai.html must not wrap <select> inside <label> (prevents option-text concatenation in choiceDialogTitle)`);
  assert.ok(html.includes("quareia-divination-theme"), `${label} ai.html missing synchronous head theme boot script`);
  assert.ok(
    html.includes("Object.prototype.hasOwnProperty.call(allowed, stored)"),
    `${label} ai.html theme boot script must guard prototype keys via Object.prototype.hasOwnProperty`
  );
  assert.equal(/<html[^>]+data-theme=/i.test(html), false, `${label} ai.html must not hardcode static data-theme on <html>`);
  assert.equal(html.includes("page-version.js"), false, `${label} ai.html must not load page-version.js redirect`);
  assert.equal(/<script[^>]+src=["']https?:/i.test(html), false, `${label} ai.html must not load external CDN scripts`);
  assert.equal(/type=["']email["']/i.test(html), false, `${label} ai.html must not contain email inputs`);
}

test("web ai.html, css, theme.js, entry pages, and i18n satisfy structure, contrast, localization, and security contracts", (t) => {
  const webHtml = fs.readFileSync(path.join(rootDir, "ai.html"), "utf8");
  const webCss = fs.readFileSync(path.join(rootDir, "css", "ai-chat.css"), "utf8");
  const webThemeSrc = fs.readFileSync(path.join(rootDir, "js", "theme.js"), "utf8");

  assertAiHtmlContract("web", webHtml);
  assert.ok(webHtml.includes('id="aiThemeBtn"'), "Web ai.html must expose #aiThemeBtn");
  assert.ok(webHtml.includes('id="aiThemePopover"'), "Web ai.html must expose #aiThemePopover");
  assert.ok(webHtml.includes('src="js/web-analytics.js"'), "Web ai.html must include web-analytics.js");

  assert.ok(/\.ai-markdown\s+a\b/.test(webCss), "css/ai-chat.css must style .ai-markdown links for accessible contrast");
  assert.ok(webCss.includes(".ai-clear-config-btn"), "css/ai-chat.css must style .ai-clear-config-btn");
  assert.ok(webCss.includes(".themed-select-trigger"), "css/ai-chat.css must theme custom select triggers");
  assert.ok(webCss.includes(".choice-overlay"), "css/ai-chat.css must layer #choiceDialog above AI modals");
  assert.ok(/input\[type="checkbox"\]\s*\{[\s\S]*?appearance:\s*none/.test(webCss), "css/ai-chat.css must replace native checkboxes with custom themed controls");
  assert.ok(webCss.includes("::-webkit-inner-spin-button"), "css/ai-chat.css must hide native number input spin buttons");
  assert.ok(webCss.includes("::-webkit-search-cancel-button"), "css/ai-chat.css must replace native search cancel icon");
  assert.ok(webCss.includes(".ai-reasoning summary::after"), "css/ai-chat.css must replace native <details> disclosure triangle");
  assert.ok(webCss.includes("::-webkit-scrollbar"), "css/ai-chat.css must theme scrollbars across AI containers");

  assert.ok(webThemeSrc.includes("syncFromStorage"), "web theme.js must support cross-tab/pageshow theme sync");
  assert.ok(webThemeSrc.includes('"storage"') || webThemeSrc.includes("'storage'"), "web theme.js must listen to storage events");
  assert.ok(webThemeSrc.includes('"pageshow"') || webThemeSrc.includes("'pageshow'"), "web theme.js must listen to pageshow events");

  for (const file of [path.join(rootDir, "index.html"), path.join(rootDir, "classic.html")]) {
    const html = fs.readFileSync(file, "utf8");
    assert.ok(html.includes('href="ai.html"') && html.includes('id="aiOpenLink"'), `${file} missing #aiOpenLink`);
  }

  const webI18n = require("../js/i18n.js");
  for (const k of REQUIRED_I18N_KEYS) {
    assert.notEqual(webI18n.t(k), k, `Web i18n missing key ${k}`);
  }

  // Verify applyDocument() preserves AI page title & description instead of overwriting with index.html strings.
  const prevDoc = global.document;
  const prevStorage = global.localStorage;
  t.after(() => {
    global.document = prevDoc;
    global.localStorage = prevStorage;
    webI18n.setLocale("zh-CN");
  });

  const doc = createFakeDomEnvironment();
  doc.body.classList.add("ai-chat-page");
  const metaDesc = doc.createElement("meta");
  metaDesc.setAttribute("name", "description");
  metaDesc.setAttribute("data-i18n-content", "ai.pageDescription");
  doc.head.appendChild(metaDesc);
  global.document = doc;
  global.localStorage = createMemoryStorage();

  webI18n.setLocale("en");
  webI18n.applyDocument();
  assert.equal(doc.title, webI18n.t("ai.pageTitle"));
  assert.equal(metaDesc.getAttribute("content"), webI18n.t("ai.pageDescription"));
});

test("android ai.html, i18n, and shared AI assets stay synchronized with web", () => {
  const androidHtml = fs.readFileSync(path.join(androidWwwDir, "ai.html"), "utf8");
  const androidThemeSrc = fs.readFileSync(path.join(androidWwwDir, "js", "theme.js"), "utf8");

  assertAiHtmlContract("android", androidHtml);
  assert.equal(androidHtml.includes("web-analytics.js"), false, "Android ai.html must omit web-analytics.js");
  assert.equal(androidHtml.includes("web-telemetry.js"), false, "Android ai.html must omit web-telemetry.js");
  assert.ok(androidHtml.includes('href="css/android-shell.css"'), "Android ai.html must include android-shell.css");
  assert.ok(androidHtml.includes('src="js/back-handler.js"'), "Android ai.html must load back-handler.js");
  assert.ok(androidHtml.includes('<strong id="languageToggleValue"'), "Android ai.html must keep 2-child #languageToggle");

  assert.ok(androidThemeSrc.includes("syncFromStorage"), "android theme.js must support cross-tab/pageshow theme sync");
  assert.ok(androidThemeSrc.includes('"storage"') || androidThemeSrc.includes("'storage'"), "android theme.js must listen to storage events");
  assert.ok(androidThemeSrc.includes('"pageshow"') || androidThemeSrc.includes("'pageshow'"), "android theme.js must listen to pageshow events");

  for (const file of [path.join(androidWwwDir, "index.html"), path.join(androidWwwDir, "classic.html")]) {
    const html = fs.readFileSync(file, "utf8");
    assert.ok(html.includes('href="ai.html"') && html.includes('id="aiOpenLink"'), `${file} missing #aiOpenLink`);
  }

  const androidI18n = require("../android-demo/app/src/main/assets/www/js/i18n.js");
  for (const k of REQUIRED_I18N_KEYS) {
    assert.notEqual(androidI18n.t(k), k, `Android i18n missing key ${k}`);
  }

  const shared = [
    "css/ai-chat.css",
    "js/ai-providers.js",
    "js/ai-context.js",
    "js/ai-chat-store.js",
    "js/ai-ui.js"
  ];
  for (const rel of shared) {
    const webFile = path.join(rootDir, rel);
    const androidFile = path.join(androidWwwDir, rel);
    assert.equal(sha256(webFile), sha256(androidFile), `${rel} differs between web and android`);
  }
});

test("AI modules avoid unsafe DOM/eval APIs and markdown renderer neutralizes raw HTML, dangerous schemes, and deep quotes", () => {
  const aiScripts = ["js/ai-providers.js", "js/ai-context.js", "js/ai-chat-store.js", "js/ai-ui.js"];
  for (const rel of aiScripts) {
    const src = fs.readFileSync(path.join(rootDir, rel), "utf8");
    assert.equal(/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/.test(src), false,
      `${rel} must not use unsafe DOM/eval APIs`);
    assert.equal(/\b(?:window|global|globalThis)\.(?:alert|confirm|prompt)\s*\(/.test(src), false,
      `${rel} must not use native browser alert/confirm/prompt`);
  }

  const fakeDoc = createFakeDomDocument();
  const container = fakeDoc.createElement("div");
  aiUi.renderMarkdownInto(container, [
    "## Title **Bold** `code`",
    "",
    "- Item with <script>alert(1)</script>",
    "- Safe [link](https://example.com) and bad [xss](javascript:alert(1))",
    "- Bad [data](data:text/html,<script>alert(1)</script>) and [vbs](vbscript:msgbox(1))",
    "",
    "> ".repeat(24) + "deeply nested quote",
    "",
    "| Card | Orientation |",
    "| --- | --- |",
    "| The Fool | Upright |"
  ].join("\n"));

  const tags = [];
  const links = [];
  let maxBlockquoteDepth = 0;
  function walk(node, quoteDepth) {
    let nextDepth = quoteDepth;
    if (node.nodeType === 1) {
      tags.push(node.nodeName);
      if (node.nodeName === "A") links.push(node.href || node.attributes.href);
      if (node.nodeName === "BLOCKQUOTE") {
        nextDepth += 1;
        if (nextDepth > maxBlockquoteDepth) maxBlockquoteDepth = nextDepth;
      }
    }
    for (const c of node.childNodes || []) walk(c, nextDepth);
  }
  walk(container, 0);

  assert.ok(tags.includes("H2"));
  assert.ok(tags.includes("STRONG"));
  assert.ok(tags.includes("CODE"));
  assert.ok(tags.includes("UL"));
  assert.ok(tags.includes("TABLE"));
  assert.equal(tags.includes("SCRIPT"), false, "Raw <script> tag must never become an element");
  assert.equal(links.length, 1, "Only https link should become an anchor element");
  assert.ok(links[0].startsWith("https://example.com"));
  assert.ok(maxBlockquoteDepth > 0 && maxBlockquoteDepth <= 6, "Blockquote recursion must be capped safely");
  assert.ok(container.textContent.includes("<script>alert(1)</script>"));
  assert.ok(container.textContent.includes("deeply nested quote"));
});

test("conversation turn helpers enforce strict user-first alternation and safe token-budget truncation", () => {
  const normalized = aiUi.normalizeConversationMessagesForApi([
    { id: "a0", role: "assistant", content: "Orphan leading assistant after user deleted m1" },
    { id: "u1", role: "user", content: "First question" },
    { id: "a1", role: "assistant", content: "", error: "Generation stopped." },
    { id: "u2", role: "user", content: "Follow-up after aborted turn" },
    { id: "a2", role: "assistant", content: "Model reply" },
    { id: "u3", role: "user", content: "Latest prompt" }
  ]);

  assert.equal(normalized.length, 3);
  assert.equal(normalized[0].role, "user", "Must strip leading orphan assistant turn");
  assert.equal(normalized[0].content, "First question\n\nFollow-up after aborted turn", "Must coalesce consecutive user turns");
  assert.equal(normalized[0].id, "u2");
  assert.equal(normalized[0].rawCount, 2);
  assert.equal(normalized[1].role, "assistant");
  assert.equal(normalized[2].role, "user");

  assert.equal(aiUi.hasPrecedingUserTurn([{ role: "assistant", content: "hi" }], 0), false);
  assert.equal(aiUi.hasPrecedingUserTurn([
    { role: "assistant", content: "orphan" },
    { role: "assistant", content: "second" }
  ], 1), false);
  assert.equal(aiUi.hasPrecedingUserTurn([
    { role: "user", content: "question" },
    { role: "assistant", content: "answer" }
  ], 1), true);

  const longTurnText = "X".repeat(600);
  const apiTurns = [
    { role: "user", content: longTurnText },
    { role: "assistant", content: longTurnText },
    { role: "user", content: "Middle question" },
    { role: "assistant", content: "Middle answer" },
    { role: "user", content: "Final question" }
  ];
  const truncated = aiUi.truncateMessagesToBudget(
    apiTurns,
    "System prompt",
    160,
    contextModule.estimateConversationTokens
  );
  assert.equal(truncated[0].role, "user", "Truncation must never leave a leading assistant message");
  assert.equal(truncated[truncated.length - 1].content, "Final question", "Truncation must preserve final user turn");
});

test("DivinationAiUi controller enforces streaming locks, incremental DOM patching, back-stack priority, clear-keys, and empty-tab behavior", async (t) => {
  const savedGlobals = {
    window: global.window,
    document: global.document,
    localStorage: global.localStorage,
    location: global.location,
    history: global.history,
    DivinationAiProviders: global.DivinationAiProviders,
    DivinationAiContext: global.DivinationAiContext,
    DivinationAiChatStore: global.DivinationAiChatStore,
    DivinationDialog: global.DivinationDialog,
    DivinationCustomSelects: global.DivinationCustomSelects,
    DivinationI18n: global.DivinationI18n,
    exportCb: global.__quareiaHistoryExportResult
  };

  t.after(() => {
    global.window = savedGlobals.window;
    global.document = savedGlobals.document;
    global.localStorage = savedGlobals.localStorage;
    global.location = savedGlobals.location;
    global.history = savedGlobals.history;
    global.DivinationAiProviders = savedGlobals.DivinationAiProviders;
    global.DivinationAiContext = savedGlobals.DivinationAiContext;
    global.DivinationAiChatStore = savedGlobals.DivinationAiChatStore;
    global.DivinationDialog = savedGlobals.DivinationDialog;
    global.DivinationCustomSelects = savedGlobals.DivinationCustomSelects;
    global.DivinationI18n = savedGlobals.DivinationI18n;
    global.__quareiaHistoryExportResult = savedGlobals.exportCb;
  });

  const doc = createFakeDomEnvironment();
  doc.body.classList.add("ai-chat-page");

  function el(tag, id) {
    const node = doc.createElement(tag);
    if (id) node.id = id;
    doc.body.appendChild(node);
    return node;
  }

  // Populate DOM controls referenced by ai-ui.js
  el("aside", "aiSidebar");
  el("div", "aiSidebarBackdrop");
  el("button", "aiSidebarToggle");
  el("button", "aiSidebarClose");
  el("button", "aiNewChatBtn");
  el("input", "aiChatSearchInput");
  el("button", "aiTabActive");
  el("button", "aiTabArchived");
  el("span", "aiActiveCount");
  el("span", "aiArchivedCount");
  el("div", "aiChatList");
  el("button", "aiExportBackupBtn");
  el("button", "aiImportBackupBtn");
  el("input", "aiImportFileInput");
  el("button", "aiClearChatsBtn");
  el("a", "aiBackToReading");
  el("button", "aiActiveProfileBtn");
  el("span", "aiProfileDot");
  el("span", "aiActiveProfileName");
  el("button", "aiSettingsBtn");
  el("button", "aiThemeBtn");
  el("div", "aiThemePopover");
  el("h1", "aiCurrentChatTitle");
  el("span", "aiArchivedBadge");
  el("div", "aiSetupBanner");
  el("p", "aiSetupBannerText");
  el("button", "aiBannerSettingsBtn");
  el("button", "aiBannerPickBtn");
  el("div", "aiContextMeter");
  el("div", "aiContextMeterFill");
  el("span", "aiContextMeterLabel");
  el("div", "aiAttachedReadings");
  el("button", "aiPickReadingsBtn");
  el("button", "aiRenameChatBtn");
  el("button", "aiExportMdBtn");
  el("button", "aiArchiveChatBtn");
  el("button", "aiDeleteChatBtn");
  const messagesEl = el("div", "aiMessages");
  const promptInput = el("textarea", "aiPromptInput");
  el("button", "aiSendBtn");
  el("button", "aiStopBtn");

  const pickerModal = el("div", "aiPickerModal");
  pickerModal.hidden = true;
  el("button", "aiPickerCloseBtn");
  el("input", "aiPickerSearchInput");
  el("select", "aiPickerDeckFilter");
  el("div", "aiPickerList");
  el("button", "aiPickerClearBtn");
  el("button", "aiPickerApplyBtn");

  const renameModal = el("div", "aiRenameModal");
  renameModal.hidden = true;
  el("button", "aiRenameCloseBtn");
  el("input", "aiRenameInput");
  el("button", "aiRenameCancelBtn");
  el("button", "aiRenameSaveBtn");

  const settingsModal = el("div", "aiSettingsModal");
  settingsModal.hidden = true;
  el("button", "aiSettingsCloseBtn");
  el("div", "aiProfileList");
  el("button", "aiNewProfileBtn");
  el("button", "aiProfileDeleteBtn");
  const presetRow = el("div", "aiPresetRow");
  const deepseekChip = doc.createElement("button");
  deepseekChip.setAttribute("data-preset", "deepseek");
  presetRow.appendChild(deepseekChip);
  const reasonerChip = doc.createElement("button");
  reasonerChip.setAttribute("data-preset", "deepseek-reasoner");
  presetRow.appendChild(reasonerChip);
  el("input", "aiProfileName");
  el("select", "aiProfileFormat");
  el("input", "aiProfileBaseUrl");
  el("input", "aiProfileApiKey");
  el("button", "aiToggleKeyVisibilityBtn");
  el("input", "aiProfileModel");
  el("div", "aiVertexGroup");
  el("input", "aiProfileVertexProject");
  el("input", "aiProfileVertexLocation");
  el("input", "aiProfileTemperature");
  el("input", "aiProfileMaxTokens");
  el("input", "aiFieldContextWindow");
  const detectContextBtn = el("button", "aiDetectContextBtn");
  el("p", "aiContextWindowHint");
  el("input", "aiFieldAutoCompress");
  el("p", "aiFormatHint");
  const clearConfigBtn = el("button", "aiClearConfigBtn");
  el("button", "aiTestConnectionBtn");
  const saveProfileBtn = el("button", "aiSaveProfileBtn");
  el("p", "aiSettingsStatus");
  const themeToast = el("div", "themeToast");
  const confirmDialog = el("dialog", "confirmDialog");
  const confirmCancelBtn = el("button", "confirmCancelBtn");
  confirmDialog.appendChild(confirmCancelBtn);
  const choiceDialog = el("dialog", "choiceDialog");
  const choiceCancelBtn = el("button", "choiceCancelBtn");
  choiceDialog.appendChild(choiceCancelBtn);

  const storage = createMemoryStorage();
  const realProviders = require("../js/ai-providers.js");
  storage.setItem(realProviders.STORAGE_KEY, JSON.stringify({
    version: 1,
    activeProfileId: "p1",
    profiles: [{
      id: "p1",
      name: "Test OpenAI",
      format: "openai-chat",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-secret-123456",
      model: "gpt-4o-mini",
      autoCompress: false
    }]
  }));

  let streamHook = null;
  let probeResult = { contextWindow: 128000, source: "catalog", live: false };
  const fakeProviders = Object.assign({}, realProviders, {
    createConfigStore(opts) {
      return realProviders.createConfigStore(Object.assign({ storage }, opts));
    },
    fetchModelContextWindow: async () => probeResult,
    streamChat(profile, opts) {
      if (streamHook) return streamHook(profile, opts);
      return Promise.resolve({ text: "Instant reply", reasoning: "", format: profile.format, model: profile.model });
    }
  });

  const memChatStore = chatStoreModule.createStore({ memoryFallback: true });
  const fakeChatStoreGlobal = Object.assign({}, chatStoreModule, {
    createStore: () => memChatStore
  });

  const dialogCalls = [];
  let confirmNext = true;
  global.DivinationDialog = {
    request(opts) {
      dialogCalls.push(opts);
      return Promise.resolve(confirmNext);
    }
  };
  const customSelectRefreshes = [];
  let customSelectSyncCount = 0;
  global.DivinationCustomSelects = {
    sync() {
      customSelectSyncCount += 1;
    },
    refresh(scope) {
      customSelectRefreshes.push(scope ? scope.id || "scope" : "document");
    },
    handleBack() {
      if (!choiceDialog.open) return false;
      choiceDialog.open = false;
      return true;
    }
  };
  const webI18n = require("../js/i18n.js");
  global.DivinationAiProviders = fakeProviders;
  global.DivinationAiContext = contextModule;
  global.DivinationAiChatStore = fakeChatStoreGlobal;
  global.DivinationI18n = webI18n;
  global.document = doc;
  global.localStorage = storage;
  global.location = { search: "", pathname: "ai.html" };
  global.history = { replaceState() {} };
  global.addEventListener = (type, fn) => doc.addEventListener("window:" + type, fn);

  const flush = () => new Promise((r) => setTimeout(r, 15));

  const ctrl = aiUi.bootstrap({ reset: true });
  await flush();

  // 1. Initial auto-created active chat exists (1 active, 0 archived). Switching to empty Archived tab must NOT spawn blank active chats.
  assert.ok(customSelectSyncCount >= 1, "Bootstrap must synchronize custom selects");
  assert.equal((await memChatStore.listConversations({ archived: "all" })).length, 1);

  // Verify custom select synchronization & choiceDialog Escape / handleBack layering over #aiPickerModal:
  doc.getElementById("aiPickReadingsBtn").click();
  await flush();
  assert.equal(pickerModal.hidden, false, "Readings picker modal should open");
  assert.ok(customSelectRefreshes.includes("aiPickerDeckFilter"), "Opening readings picker must refresh #aiPickerDeckFilter custom select");
  choiceDialog.open = true;
  doc.dispatchEvent({ type: "keydown", key: "Escape", defaultPrevented: false });
  assert.equal(pickerModal.hidden, false, "Escape while #choiceDialog is open must not close underlying #aiPickerModal");
  assert.equal(ctrl.handleBack(), true, "1st handleBack() must dismiss open #choiceDialog");
  assert.equal(choiceDialog.open, false);
  assert.equal(pickerModal.hidden, false, "#aiPickerModal must stay open after dismissing #choiceDialog");
  assert.equal(ctrl.handleBack(), true, "2nd handleBack() closes #aiPickerModal");
  assert.equal(pickerModal.hidden, true);
  doc.getElementById("aiTabArchived").click();
  await flush();
  assert.equal((await memChatStore.listConversations({ archived: "all" })).length, 1, "Viewing empty Archived tab must not create extra blank active chats");

  // Unmatched search in Active tab must also NOT spawn extra blank active chats.
  doc.getElementById("aiTabActive").click();
  await flush();
  const searchInput = doc.getElementById("aiChatSearchInput");
  searchInput.value = "non-existent-keyword";
  searchInput.dispatchEvent({ type: "input" });
  await flush();
  assert.equal((await memChatStore.listConversations({ archived: "all" })).length, 1, "Unmatched search query must not spawn blank active chats");
  searchInput.value = "";
  searchInput.dispatchEvent({ type: "input" });
  await flush();

  // 2. Streaming locks, incremental DOM patching (preserving <details open> and user scroll), and back-stack priority.
  let activeStreamOpts = null;
  let resolveStream = null;
  streamHook = (_profile, opts) => {
    activeStreamOpts = opts;
    opts.signal.addEventListener("abort", () => {
      const err = new Error("Aborted");
      err.code = "aborted";
      resolveStream.reject(err);
    });
    return new Promise((resolve, reject) => {
      resolveStream = { resolve, reject };
    });
  };

  promptInput.value = "测试流式更新";
  doc.getElementById("aiSendBtn").click();
  await flush();

  assert.ok(activeStreamOpts, "streamChat should be active");
  assert.equal(doc.getElementById("aiNewChatBtn").disabled, true);
  assert.equal(doc.getElementById("aiArchiveChatBtn").disabled, true);
  assert.equal(doc.getElementById("aiDeleteChatBtn").disabled, true);
  assert.equal(doc.getElementById("aiExportBackupBtn").disabled, true);
  assert.equal(doc.getElementById("aiImportBackupBtn").disabled, true);
  assert.equal(doc.getElementById("aiClearChatsBtn").disabled, true);

  // Import backup event during streaming must be ignored.
  const importInput = doc.getElementById("aiImportFileInput");
  importInput.files = [{ text: async () => JSON.stringify({ format: chatStoreModule.BACKUP_FORMAT, version: 1, conversations: [{ id: "injected", title: "Injected", messages: [{ id: "x", role: "user", content: "hi" }] }] }) }];
  importInput.dispatchEvent({ type: "change", target: importInput });
  await flush();
  assert.equal(await memChatStore.getConversation("injected"), null, "Backup import must be blocked while streaming");

  // Incremental DOM patch: emit reasoning + delta, open <details>, scroll up, emit second delta, verify node identity & scroll preserved.
  activeStreamOpts.onReasoning("step1", "思考第一段");
  activeStreamOpts.onDelta("Hello", "Hello");
  await new Promise((r) => setTimeout(r, 80));

  const renderedArticlesBefore = messagesEl.querySelectorAll(".ai-msg");
  const assistantArticle = renderedArticlesBefore[renderedArticlesBefore.length - 1];
  const detailsEl = assistantArticle.querySelector("details.ai-reasoning");
  assert.ok(detailsEl, "Reasoning <details> must be created incrementally");
  detailsEl.open = true;

  // Simulate user scrolled away from bottom (scrollHeight=1000, clientHeight=200, scrollTop=20).
  messagesEl.scrollHeight = 1000;
  messagesEl.clientHeight = 200;
  messagesEl.scrollTop = 20;

  activeStreamOpts.onReasoning(" step2", "思考第一段 + 第二段");
  activeStreamOpts.onDelta(" world", "Hello world");
  await new Promise((r) => setTimeout(r, 80));

  const renderedArticlesAfter = messagesEl.querySelectorAll(".ai-msg");
  assert.equal(renderedArticlesAfter[renderedArticlesAfter.length - 1], assistantArticle, "Assistant <article> node must be patched in place");
  assert.equal(detailsEl.open, true, "Expanded <details class='ai-reasoning'> must stay open across streaming deltas");
  assert.equal(messagesEl.scrollTop, 20, "Scroll position must not jump to bottom when user scrolled up");

  // 3. Back-stack priority & Escape defaultPrevented while streaming:
  // Open Settings modal AND open #confirmDialog on top of it.
  doc.getElementById("aiSettingsBtn").click();
  assert.equal(settingsModal.hidden, false);
  confirmDialog.open = true;
  let cancelClicked = false;
  confirmCancelBtn.addEventListener("click", () => {
    cancelClicked = true;
    confirmDialog.open = false;
  });

  // Escape with defaultPrevented=true (already handled by dialog) must NOT close underlying settingsModal.
  doc.dispatchEvent({ type: "keydown", key: "Escape", defaultPrevented: true });
  assert.equal(settingsModal.hidden, false, "defaultPrevented Escape must not close underlying modal");

  // 1st handleBack() closes #confirmDialog.
  assert.equal(ctrl.handleBack(), true);
  assert.equal(cancelClicked, true);
  assert.equal(settingsModal.hidden, false);

  // 2nd handleBack() closes #aiSettingsModal.
  assert.equal(ctrl.handleBack(), true);
  assert.equal(settingsModal.hidden, true);
  assert.equal(activeStreamOpts.signal.aborted, false);

  // 3rd handleBack() aborts active stream instead of exiting page.
  assert.equal(ctrl.handleBack(), true);
  assert.equal(activeStreamOpts.signal.aborted, true);
  await flush();

  // Partial streamed text ("Hello world") must be preserved in store after abort!
  const savedAfterAbort = (await memChatStore.listConversations({ archived: false }))[0];
  assert.equal(savedAfterAbort.messages[savedAfterAbort.messages.length - 1].content, "Hello world");

  // 4. Non-live context window probe (live: false) must NOT persist detectedContextWindow as "api", and Clear Keys wipes storage.
  doc.getElementById("aiSettingsBtn").click();
  detectContextBtn.click();
  await flush();
  saveProfileBtn.click();
  const savedCfgAfterProbe = JSON.parse(storage.getItem(realProviders.STORAGE_KEY));
  assert.equal(Boolean(savedCfgAfterProbe.profiles[0].detectedContextWindow), false, "Catalog fallback (live=false) must not persist detectedContextWindow");
  assert.notEqual(savedCfgAfterProbe.profiles[0].contextWindowSource, "api");

  // Failed detection must preserve manual limits and report an unknown window.
  doc.getElementById("aiSettingsBtn").click();
  const modelField = doc.getElementById("aiProfileModel");
  const contextField = doc.getElementById("aiFieldContextWindow");
  modelField.value = "unknown-context-model";
  modelField.dispatchEvent({ type: "input" });
  contextField.value = "260000";
  contextField.dispatchEvent({ type: "input" });
  probeResult = { contextWindow: 32768, source: "default", live: false };
  detectContextBtn.click();
  await flush();
  assert.equal(contextField.value, "260000");
  assert.match(doc.getElementById("aiSettingsStatus").textContent, /未能识别/);
  assert.doesNotMatch(doc.getElementById("aiSettingsStatus").textContent, /已识别/);
  assert.match(doc.getElementById("aiContextWindowHint").textContent, /260,000/);

  // A response for the old model must not mutate a newly edited form.
  let finishContextProbe;
  probeResult = new Promise(resolve => { finishContextProbe = resolve; });
  detectContextBtn.click();
  modelField.value = "gpt-6.1-terra";
  modelField.dispatchEvent({ type: "input" });
  contextField.value = "300000";
  contextField.dispatchEvent({ type: "input" });
  finishContextProbe({ contextWindow: 8192, source: "api", live: true });
  await flush();
  assert.equal(contextField.value, "300000");
  assert.match(doc.getElementById("aiSettingsStatus").textContent, /配置已更改/);
  assert.match(doc.getElementById("aiContextWindowHint").textContent, /300,000/);

  // Catalog fallback must not be persisted as live API metadata.
  modelField.value = "gpt-6.1-terra";
  modelField.dispatchEvent({ type: "input" });
  probeResult = { contextWindow: 1050000, source: "catalog", live: false };
  detectContextBtn.click();
  await flush();
  assert.equal(contextField.value, "");
  assert.match(doc.getElementById("aiContextWindowHint").textContent, /1,050,000/);
  assert.match(doc.getElementById("aiSettingsStatus").textContent, /模型目录/);
  saveProfileBtn.click();
  const terraProfile = JSON.parse(storage.getItem(realProviders.STORAGE_KEY)).profiles[0];
  assert.equal(terraProfile.detectedContextWindow, 0);
  assert.equal(terraProfile.contextWindowSource, "auto");
  assert.match(doc.getElementById("aiContextMeter").textContent, /1,050,000/);

  // 4b. Quick presets fill the DeepSeek endpoint/model/manual window and never touch the typed key.
  doc.getElementById("aiSettingsBtn").click();
  const baseUrlField = doc.getElementById("aiProfileBaseUrl");
  const apiKeyField = doc.getElementById("aiProfileApiKey");
  const keyBeforePreset = apiKeyField.value;
  assert.ok(keyBeforePreset.length > 0, "fixture must start with a saved API key");
  deepseekChip.click();
  assert.equal(baseUrlField.value, "https://api.deepseek.com/v1");
  assert.equal(modelField.value, "deepseek-chat");
  assert.equal(contextField.value, "131072");
  assert.equal(apiKeyField.value, keyBeforePreset, "presets must not overwrite the API key");
  assert.equal(deepseekChip.classList.contains("is-active"), true);
  assert.equal(reasonerChip.classList.contains("is-active"), false);
  assert.match(doc.getElementById("aiSettingsStatus").textContent, /DeepSeek Chat/);
  reasonerChip.click();
  assert.equal(modelField.value, "deepseek-reasoner");
  assert.equal(reasonerChip.classList.contains("is-active"), true);
  assert.equal(deepseekChip.classList.contains("is-active"), false);
  saveProfileBtn.click();
  const presetSaved = JSON.parse(storage.getItem(realProviders.STORAGE_KEY)).profiles[0];
  assert.equal(presetSaved.format, "openai-chat");
  assert.equal(presetSaved.baseUrl, "https://api.deepseek.com/v1");
  assert.equal(presetSaved.model, "deepseek-reasoner");
  assert.equal(presetSaved.contextWindow, 131072);
  assert.equal(presetSaved.contextWindowSource, "manual");
  assert.equal(presetSaved.apiKey, keyBeforePreset);

  doc.getElementById("aiSettingsBtn").click();
  confirmNext = true;
  clearConfigBtn.click();
  await flush();
  assert.equal(storage.getItem(realProviders.STORAGE_KEY), null, "Clear Saved Keys must remove stored API config from localStorage");
  assert.equal(doc.getElementById("aiActiveProfileName").textContent, webI18n.t("ai.profileUnconfigured"));

  // 5. Native export result failure callback shows error toast and dialog.
  const dialogCountBefore = dialogCalls.length;
  global.__quareiaHistoryExportResult({ ok: false });
  assert.equal(themeToast.classList.contains("is-on"), true);
  assert.equal(themeToast.classList.contains("is-error"), true);
  assert.equal(dialogCalls.length, dialogCountBefore + 1);

  // 6. Restore valid profile, test regenerate summary invalidation & pagehide persistence of partial stream.
  storage.setItem(realProviders.STORAGE_KEY, JSON.stringify({
    version: 1,
    activeProfileId: "p1",
    profiles: [{
      id: "p1",
      name: "Test OpenAI",
      format: "openai-chat",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-secret-123456",
      model: "gpt-4o-mini",
      autoCompress: false
    }]
  }));

  // Attach a summary covering the user prompt in savedAfterAbort, then click Regenerate -> summary must be invalidated and API still receives user prompt.
  await memChatStore.setContextSummary(savedAfterAbort.id, {
    text: "Over-reaching summary",
    coveredUntilId: savedAfterAbort.messages[0].id,
    compressedCount: 1,
    updatedAt: Date.now()
  });
  doc.getElementById("aiTabActive").click();
  await flush();

  let regenMessagesSent = null;
  streamHook = (_profile, opts) => {
    regenMessagesSent = opts.messages;
    activeStreamOpts = opts;
    opts.signal.addEventListener("abort", () => {
      const err = new Error("Aborted");
      err.code = "aborted";
      resolveStream.reject(err);
    });
    return new Promise((resolve, reject) => {
      resolveStream = { resolve, reject };
    });
  };

  const allBtns = messagesEl.querySelectorAll(".ai-mini-action");
  const regenBtn = allBtns.find((b) => b.textContent === webI18n.t("ai.regenerate"));
  assert.ok(regenBtn && !regenBtn.disabled, "Regenerate button should be enabled on valid assistant turn");
  regenBtn.click();
  await flush();

  assert.ok(Array.isArray(regenMessagesSent) && regenMessagesSent.length === 1);
  assert.equal(regenMessagesSent[0].role, "user");
  assert.equal(regenMessagesSent[0].content, "测试流式更新");
  const afterRegenStart = await memChatStore.getConversation(savedAfterAbort.id);
  assert.equal(afterRegenStart.contextSummary, null, "Regenerating a covered turn must invalidate stale contextSummary");

  // Emit partial delta and trigger window pagehide -> partial text must be persisted immediately and stream aborted.
  activeStreamOpts.onDelta("Partial before unload", "Partial before unload");
  doc.dispatchEvent({ type: "window:pagehide" });
  await flush();
  assert.equal(activeStreamOpts.signal.aborted, true, "pagehide must abort active stream");
  const afterPagehide = await memChatStore.getConversation(savedAfterAbort.id);
  assert.equal(afterPagehide.messages[afterPagehide.messages.length - 1].content, "Partial before unload");
});
