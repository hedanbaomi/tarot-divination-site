"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const rootDir = path.resolve(__dirname, "..");
const androidWwwDir = path.join(rootDir, "android-demo", "app", "src", "main", "assets", "www");
const aiUi = require("../js/ai-ui.js");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createFakeDomDocument() {
  class Node {
    constructor(nodeType, nodeName) {
      this.nodeType = nodeType;
      this.nodeName = nodeName;
      this.childNodes = [];
      this.attributes = Object.create(null);
      this._text = "";
    }
    appendChild(child) {
      if (child.nodeType === 11) {
        for (const grand of child.childNodes) {
          this.childNodes.push(grand);
        }
        child.childNodes = [];
      } else {
        this.childNodes.push(child);
      }
      return child;
    }
    replaceChildren(...nodes) {
      this.childNodes = [];
      for (const n of nodes) {
        this.appendChild(n);
      }
    }
    setAttribute(k, v) {
      this.attributes[k] = String(v);
    }
    set textContent(v) {
      this._text = String(v);
      this.childNodes = [];
    }
    get textContent() {
      if (this.nodeType === 3) return this._text;
      if (this.childNodes.length === 0) return this._text;
      return this.childNodes.map((c) => c.textContent).join("");
    }
  }

  return {
    createElement(tag) {
      const el = new Node(1, tag.toUpperCase());
      el.ownerDocument = this;
      return el;
    },
    createTextNode(text) {
      const tn = new Node(3, "#text");
      tn._text = String(text);
      return tn;
    },
    createDocumentFragment() {
      const frag = new Node(11, "#document-fragment");
      frag.ownerDocument = this;
      return frag;
    }
  };
}

test("web and android ai.html include required structure, theme sync, and security hygiene", () => {
  const webHtml = fs.readFileSync(path.join(rootDir, "ai.html"), "utf8");
  const androidHtml = fs.readFileSync(path.join(androidWwwDir, "ai.html"), "utf8");
  const webThemeSrc = fs.readFileSync(path.join(rootDir, "js", "theme.js"), "utf8");
  const androidThemeSrc = fs.readFileSync(path.join(androidWwwDir, "js", "theme.js"), "utf8");

  const requiredIds = [
    "aiChatList", "aiMessages", "aiPromptInput", "aiSendBtn", "aiStopBtn",
    "aiPickReadingsBtn", "aiPickerModal", "aiRenameModal",
    "aiSettingsModal", "aiProfileFormat", "aiProfileApiKey", "aiVertexGroup",
    "aiLockedPromptNote", "aiFieldContextWindow", "aiDetectContextBtn",
    "aiContextWindowHint", "aiFieldAutoCompress", "aiContextMeter",
    "themeSwatches", "themeToast", "confirmDialog", "languageToggle"
  ];
  const forbiddenIds = [
    "aiInspectContextBtn", "aiContextModal", "aiContextPre", "aiFieldSystemPrompt"
  ];
  const themeIds = [
    "celestial", "parchment", "ember", "grove", "grove-light", "jade", "dusk", "ash"
  ];

  for (const [label, html] of [["web", webHtml], ["android", androidHtml]]) {
    for (const id of requiredIds) {
      assert.ok(html.includes(`id="${id}"`), `${label} ai.html missing #${id}`);
    }
    for (const badId of forbiddenIds) {
      assert.equal(html.includes(`id="${badId}"`), false, `${label} ai.html must not contain #${badId}`);
    }
    for (const themeId of themeIds) {
      assert.ok(html.includes(`data-theme-id="${themeId}"`), `${label} ai.html missing theme swatch ${themeId}`);
    }
    assert.ok(html.includes('<meta name="theme-color"'), `${label} ai.html missing theme-color meta`);
    assert.ok(html.includes("quareia-divination-theme"), `${label} ai.html missing synchronous head theme boot script`);
    assert.equal(/<html[^>]+data-theme=/i.test(html), false, `${label} ai.html must not hardcode static data-theme on <html>`);
    assert.equal(html.includes("page-version.js"), false, `${label} ai.html must not load page-version.js redirect`);
    assert.equal(/<script[^>]+src=["']https?:/i.test(html), false, `${label} ai.html must not load external CDN scripts`);
    assert.equal(/type=["']email["']/i.test(html), false, `${label} ai.html must not contain email inputs`);
  }

  assert.ok(webHtml.includes('id="aiThemeBtn"'), "Web ai.html must expose #aiThemeBtn");
  assert.ok(webHtml.includes('id="aiThemePopover"'), "Web ai.html must expose #aiThemePopover");
  assert.ok(webHtml.includes('src="js/web-analytics.js"'), "Web ai.html must include web-analytics.js");
  assert.equal(androidHtml.includes("web-analytics.js"), false, "Android ai.html must omit web-analytics.js");
  assert.equal(androidHtml.includes("web-telemetry.js"), false, "Android ai.html must omit web-telemetry.js");
  assert.ok(androidHtml.includes('href="css/android-shell.css"'), "Android ai.html must include android-shell.css");
  assert.ok(androidHtml.includes('src="js/back-handler.js"'), "Android ai.html must load back-handler.js");
  assert.ok(androidHtml.includes('<strong id="languageToggleValue"'), "Android ai.html must keep 2-child #languageToggle");

  for (const [label, src] of [["web", webThemeSrc], ["android", androidThemeSrc]]) {
    assert.ok(src.includes("syncFromStorage"), `${label} theme.js must support cross-tab/pageshow theme sync`);
    assert.ok(src.includes('"storage"') || src.includes("'storage'"), `${label} theme.js must listen to storage events`);
    assert.ok(src.includes('"pageshow"') || src.includes("'pageshow'"), `${label} theme.js must listen to pageshow events`);
  }
});

test("shared AI assets stay byte-for-byte identical between web and android", () => {
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

test("AI modules avoid unsafe DOM/eval APIs and markdown renderer neutralizes raw HTML & javascript links", () => {
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
    "",
    "| Card | Orientation |",
    "| --- | --- |",
    "| The Fool | Upright |"
  ].join("\n"));

  const tags = [];
  const links = [];
  function walk(node) {
    if (node.nodeType === 1) {
      tags.push(node.nodeName);
      if (node.nodeName === "A") links.push(node.href || node.attributes.href);
    }
    for (const c of node.childNodes || []) walk(c);
  }
  walk(container);

  assert.ok(tags.includes("H2"));
  assert.ok(tags.includes("STRONG"));
  assert.ok(tags.includes("CODE"));
  assert.ok(tags.includes("UL"));
  assert.ok(tags.includes("TABLE"));
  assert.equal(tags.includes("SCRIPT"), false, "Raw <script> tag must never become an element");
  assert.equal(links.length, 1, "Only https link should become an anchor element");
  assert.ok(links[0].startsWith("https://example.com"));
  assert.ok(container.textContent.includes("<script>alert(1)</script>"));
});

test("entry pages include ai.html navigation without altering analytics privacy notice", () => {
  const entryPages = [
    path.join(rootDir, "index.html"),
    path.join(rootDir, "classic.html"),
    path.join(androidWwwDir, "index.html"),
    path.join(androidWwwDir, "classic.html")
  ];
  for (const file of entryPages) {
    const html = fs.readFileSync(file, "utf8");
    assert.ok(html.includes('href="ai.html"') && html.includes('id="aiOpenLink"'), `${file} missing #aiOpenLink`);
  }

  const webI18n = require("../js/i18n.js");
  const androidI18n = require("../android-demo/app/src/main/assets/www/js/i18n.js");
  const requiredKeys = [
    "ai.open", "ai.pageTitle", "ai.settingsTitle", "history.openInAi", "privacy.ai",
    "ai.lockedPromptNote", "ai.fieldContextWindow", "ai.fieldAutoCompress", "ai.contextMeter"
  ];
  for (const k of requiredKeys) {
    assert.notEqual(webI18n.t(k), k, `Web i18n missing key ${k}`);
    assert.notEqual(androidI18n.t(k), k, `Android i18n missing key ${k}`);
  }
});
