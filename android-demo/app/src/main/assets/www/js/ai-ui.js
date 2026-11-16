(function (global) {
  "use strict";

  function tr(key, vars, fallbackZh, fallbackEn) {
    var i18n = global.DivinationI18n;
    if (i18n && typeof i18n.t === "function") {
      var translated = i18n.t(key, vars);
      if (translated && translated !== key) {
        return translated;
      }
    }
    var isEn = i18n && typeof i18n.isEnglish === "function" && i18n.isEnglish();
    var text = isEn ? (fallbackEn || fallbackZh || key) : (fallbackZh || fallbackEn || key);
    if (vars && typeof vars === "object") {
      Object.keys(vars).forEach(function (k) {
        text = text.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return text;
  }

  function isEnglishLocale() {
    var i18n = global.DivinationI18n;
    return Boolean(i18n && typeof i18n.isEnglish === "function" && i18n.isEnglish());
  }

  function currentLocale() {
    return isEnglishLocale() ? "en" : "zh-CN";
  }

  function isSafeExternalUrl(rawUrl) {
    try {
      var parsed = new URL(rawUrl);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch (_err) {
      return false;
    }
  }

  function appendInlineMarkdown(parent, text) {
    var doc = parent.ownerDocument || document;
    var source = typeof text === "string" ? text : "";
    var pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
    var lastIndex = 0;
    var match;

    while ((match = pattern.exec(source)) !== null) {
      if (match.index > lastIndex) {
        parent.appendChild(doc.createTextNode(source.slice(lastIndex, match.index)));
      }
      var token = match[0];
      if (token.charAt(0) === "`") {
        var codeEl = doc.createElement("code");
        codeEl.textContent = token.slice(1, -1);
        parent.appendChild(codeEl);
      } else if (token.slice(0, 2) === "**" || token.slice(0, 2) === "__") {
        var strongEl = doc.createElement("strong");
        appendInlineMarkdown(strongEl, token.slice(2, -2));
        parent.appendChild(strongEl);
      } else if (token.slice(0, 2) === "~~") {
        var delEl = doc.createElement("del");
        appendInlineMarkdown(delEl, token.slice(2, -2));
        parent.appendChild(delEl);
      } else if (token.charAt(0) === "*") {
        var emEl = doc.createElement("em");
        appendInlineMarkdown(emEl, token.slice(1, -1));
        parent.appendChild(emEl);
      } else if (token.charAt(0) === "[") {
        var sepIdx = token.indexOf("](");
        var label = token.slice(1, sepIdx);
        var href = token.slice(sepIdx + 2, -1).trim();
        if (isSafeExternalUrl(href)) {
          var link = doc.createElement("a");
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          appendInlineMarkdown(link, label);
          parent.appendChild(link);
        } else {
          parent.appendChild(doc.createTextNode(token));
        }
      } else {
        parent.appendChild(doc.createTextNode(token));
      }
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < source.length) {
      parent.appendChild(doc.createTextNode(source.slice(lastIndex)));
    }
  }

  function isTableSeparatorLine(line) {
    return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(line.trim());
  }

  function splitTableRow(line) {
    var trimmed = line.trim();
    if (trimmed.charAt(0) === "|") trimmed = trimmed.slice(1);
    if (trimmed.charAt(trimmed.length - 1) === "|") trimmed = trimmed.slice(0, -1);
    return trimmed.split("|").map(function (cell) {
      return cell.trim();
    });
  }

  function renderMarkdownInto(container, markdownText, depth) {
    if (!container) return;
    var curDepth = typeof depth === "number" ? depth : 0;
    var doc = container.ownerDocument || document;
    var frag = doc.createDocumentFragment();
    var lines = String(markdownText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      // Fenced code block
      if (trimmed.indexOf("```") === 0) {
        var codeLines = [];
        i += 1;
        while (i < lines.length && lines[i].trim().indexOf("```") !== 0) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        var pre = doc.createElement("pre");
        var code = doc.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.appendChild(code);
        frag.appendChild(pre);
        continue;
      }

      // Horizontal rule
      if (/^([-*_])\s*\1\s*\1[\s\-*_]*$/.test(trimmed)) {
        frag.appendChild(doc.createElement("hr"));
        i += 1;
        continue;
      }

      // Heading (# to ####)
      var headingMatch = /^(#{1,4})\s+(.*)$/.exec(trimmed);
      if (headingMatch) {
        var level = headingMatch[1].length;
        var heading = doc.createElement("h" + level);
        appendInlineMarkdown(heading, headingMatch[2]);
        frag.appendChild(heading);
        i += 1;
        continue;
      }

      // Blockquote
      if (trimmed.charAt(0) === ">") {
        var quoteLines = [];
        while (i < lines.length && lines[i].trim().charAt(0) === ">") {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i += 1;
        }
        var quote = doc.createElement("blockquote");
        if (curDepth + 1 < 6) {
          renderMarkdownInto(quote, quoteLines.join("\n"), curDepth + 1);
        } else {
          var fallbackQuotePara = doc.createElement("p");
          for (var qIdx = 0; qIdx < quoteLines.length; qIdx += 1) {
            if (qIdx > 0) fallbackQuotePara.appendChild(doc.createElement("br"));
            appendInlineMarkdown(fallbackQuotePara, quoteLines[qIdx].replace(/^(?:>\s?)+/, ""));
          }
          quote.appendChild(fallbackQuotePara);
        }
        frag.appendChild(quote);
        continue;
      }

      // Markdown Table
      if (trimmed.indexOf("|") !== -1 && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
        var table = doc.createElement("table");
        var thead = doc.createElement("thead");
        var headRow = doc.createElement("tr");
        var headers = splitTableRow(line);
        for (var h = 0; h < headers.length; h += 1) {
          var th = doc.createElement("th");
          appendInlineMarkdown(th, headers[h]);
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);
        i += 2;
        var tbody = doc.createElement("tbody");
        while (i < lines.length && lines[i].trim().indexOf("|") !== -1) {
          var cells = splitTableRow(lines[i]);
          var trEl = doc.createElement("tr");
          for (var c = 0; c < Math.max(headers.length, cells.length); c += 1) {
            var td = doc.createElement("td");
            appendInlineMarkdown(td, cells[c] || "");
            trEl.appendChild(td);
          }
          tbody.appendChild(trEl);
          i += 1;
        }
        table.appendChild(tbody);
        frag.appendChild(table);
        continue;
      }

      // Unordered / Ordered Lists
      if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        var ordered = /^\d+\.\s+/.test(trimmed);
        var listEl = doc.createElement(ordered ? "ol" : "ul");
        var itemRegex = ordered ? /^\d+\.\s+(.*)$/ : /^[-*+]\s+(.*)$/;
        while (i < lines.length) {
          var itemMatch = itemRegex.exec(lines[i].trim());
          if (!itemMatch) break;
          var li = doc.createElement("li");
          appendInlineMarkdown(li, itemMatch[1]);
          listEl.appendChild(li);
          i += 1;
        }
        frag.appendChild(listEl);
        continue;
      }

      // Paragraph block
      var paraLines = [];
      while (i < lines.length) {
        var cur = lines[i];
        var curTrim = cur.trim();
        if (
          !curTrim
          || curTrim.indexOf("```") === 0
          || /^(#{1,4})\s+/.test(curTrim)
          || curTrim.charAt(0) === ">"
          || /^[-*+]\s+/.test(curTrim)
          || /^\d+\.\s+/.test(curTrim)
          || /^([-*_])\s*\1\s*\1[\s\-*_]*$/.test(curTrim)
          || (curTrim.indexOf("|") !== -1 && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
        ) {
          break;
        }
        paraLines.push(cur);
        i += 1;
      }
      var p = doc.createElement("p");
      for (var pIdx = 0; pIdx < paraLines.length; pIdx += 1) {
        if (pIdx > 0) p.appendChild(doc.createElement("br"));
        appendInlineMarkdown(p, paraLines[pIdx]);
      }
      frag.appendChild(p);
    }

    container.replaceChildren(frag);
  }

  function copyTextToClipboard(text) {
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }, function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      return Boolean(ok);
    } catch (_err) {
      return false;
    }
  }

  function triggerFileDownload(content, fileName, mimeType) {
    var nativeBridge = global.androidHistoryExport;
    if (nativeBridge && typeof nativeBridge.save === "function") {
      nativeBridge.save(content, fileName);
      return "android";
    }
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
    return "web";
  }

  function parseTimeMs(value) {
    if (global.DivinationAiContext && typeof global.DivinationAiContext.parseTimestampMs === "function") {
      return global.DivinationAiContext.parseTimestampMs(value);
    }
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      var num = Number(value.trim());
      if (isFinite(num) && /^\d+(?:\.\d+)?$/.test(value.trim())) return num;
      var parsed = Date.parse(value.trim());
      return isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function formatShortTime(ms) {
    var parsed = parseTimeMs(ms);
    if (!parsed) return "";
    try {
      return new Date(parsed).toLocaleString(isEnglishLocale() ? "en-US" : "zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
    } catch (_err) {
      return "";
    }
  }

  function formatTokenCount(value) {
    var num = Math.max(0, Math.round(Number(value) || 0));
    try {
      return num.toLocaleString(isEnglishLocale() ? "en-US" : "zh-CN");
    } catch (_err) {
      return String(num);
    }
  }

  function buildFallbackSummaryDigest(previousSummary, messages, isEnglish) {
    var lines = [];
    if (previousSummary && previousSummary.trim()) {
      lines.push(previousSummary.trim());
    }
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i];
      if (!m || !m.content) continue;
      var speaker = m.role === "assistant"
        ? (isEnglish ? "Assistant" : "助手")
        : (isEnglish ? "User" : "用户");
      var snippet = String(m.content).replace(/\s+/g, " ").trim().slice(0, 140);
      if (snippet) {
        lines.push("- " + speaker + ": " + snippet);
      }
    }
    var joined = lines.join("\n").trim();
    if (joined.length > 2400) {
      joined = joined.slice(joined.length - 2400);
    }
    return joined;
  }

  function deckShortLabel(deckType) {
    if (deckType === "mystagogus") return "Mystagogus";
    if (deckType === "lxxxi") return "LXXXI";
    return isEnglishLocale() ? "Tarot" : "塔罗";
  }

  function confirmAction(opts) {
    if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
      return global.DivinationDialog.request(opts);
    }
    return Promise.resolve(true);
  }

  function normalizeConversationMessagesForApi(messages, startIndex, limitIdx) {
    var list = Array.isArray(messages) ? messages : [];
    var start = typeof startIndex === "number" ? Math.max(0, startIndex) : 0;
    var end = typeof limitIdx === "number" ? Math.min(list.length, Math.max(0, limitIdx)) : list.length;
    var validMessages = [];

    for (var i = start; i < end; i += 1) {
      var m = list[i];
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      var rawContent = typeof m.content === "string" ? m.content : "";
      if (!rawContent.trim()) continue;
      if (validMessages.length === 0 && m.role !== "user") {
        continue;
      }
      if (validMessages.length > 0 && validMessages[validMessages.length - 1].role === m.role) {
        var prev = validMessages[validMessages.length - 1];
        prev.content = prev.content + "\n\n" + rawContent;
        prev.id = m.id || prev.id;
        prev.rawCount = (prev.rawCount || 1) + 1;
      } else {
        validMessages.push({
          id: m.id,
          role: m.role,
          content: rawContent,
          rawCount: 1
        });
      }
    }
    return validMessages;
  }

  function truncateMessagesToBudget(apiMessages, systemPrompt, hardCap, estimateTokensFn) {
    var finalMessages = Array.isArray(apiMessages) ? apiMessages.slice() : [];
    while (finalMessages.length > 1 && finalMessages[0].role !== "user") {
      finalMessages.shift();
    }
    while (
      finalMessages.length > 1
      && estimateTokensFn({ systemPrompt: systemPrompt, messages: finalMessages }) >= hardCap
    ) {
      finalMessages.shift();
      while (finalMessages.length > 1 && finalMessages[0].role !== "user") {
        finalMessages.shift();
      }
    }
    return finalMessages;
  }

  function hasPrecedingUserTurn(messages, assistantIndex) {
    var list = Array.isArray(messages) ? messages : [];
    for (var i = assistantIndex - 1; i >= 0; i -= 1) {
      var m = list[i];
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      if (typeof m.content === "string" && m.content.trim()) {
        return m.role === "user";
      }
    }
    return false;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function initAiPage() {
    if (!byId("aiChatList") || !global.DivinationAiProviders || !global.DivinationAiContext || !global.DivinationAiChatStore) {
      return null;
    }

    var providers = global.DivinationAiProviders;
    var contextApi = global.DivinationAiContext;
    var chatStoreApi = global.DivinationAiChatStore;
    var historyStoreApi = global.DivinationHistoryStore;

    var configStore = providers.createConfigStore();
    var chatStore = chatStoreApi.createStore({
      memoryFallback: true,
      onStorageModeChange: function (mode) {
        if (els.storageWarning) els.storageWarning.hidden = mode !== "memory";
      }
    });
    var historyStore = historyStoreApi && typeof historyStoreApi.createStore === "function"
      ? historyStoreApi.createStore()
      : null;

    var customLibrary = null;
    if (global.DivinationCustomSpreads && typeof global.DivinationCustomSpreads.createLibrary === "function") {
      try {
        var isAndroid = Boolean(global.androidAbout || global.androidHistoryExport || global.androidAiConfig);
        customLibrary = global.DivinationCustomSpreads.createLibrary({
          platform: isAndroid ? "android" : "web",
          storage: typeof global.localStorage !== "undefined" ? global.localStorage : null
        });
      } catch (_err) {
        customLibrary = null;
      }
    }

    var state = {
      activeTab: "active", // "active" | "archived"
      searchQuery: "",
      conversations: [],
      allCounts: { active: 0, archived: 0 },
      activeConversation: null,
      selectableReadings: [],
      readingsById: Object.create(null),
      pickerDraftIds: [],
      sidebarOpen: false,
      themePopoverOpen: false,
      streaming: false,
      compressing: false,
      abortController: null,
      activeStreamContext: null,
      editingMessageId: "",
      settingsDraft: null,
      keyVisible: false,
      lastFocusedBeforeModal: null,
      lastRenderedConvId: "",
      toastTimer: null
    };

    var els = {
      sidebarToggle: byId("aiSidebarToggle"),
      sidebarClose: byId("aiSidebarClose"),
      sidebarBackdrop: byId("aiSidebarBackdrop"),
      sidebar: byId("aiSidebar"),
      backToReading: byId("aiBackToReading"),
      activeProfileBtn: byId("aiActiveProfileBtn"),
      profileDot: byId("aiProfileDot"),
      activeProfileName: byId("aiActiveProfileName"),
      themeBtn: byId("aiThemeBtn"),
      themePopover: byId("aiThemePopover"),
      settingsBtn: byId("aiSettingsBtn"),
      newChatBtn: byId("aiNewChatBtn"),
      chatSearchInput: byId("aiChatSearchInput"),
      tabActive: byId("aiTabActive"),
      tabArchived: byId("aiTabArchived"),
      chatList: byId("aiChatList"),
      exportBackupBtn: byId("aiExportBackupBtn"),
      importBackupBtn: byId("aiImportBackupBtn"),
      importFileInput: byId("aiImportFileInput"),
      clearChatsBtn: byId("aiClearChatsBtn"),

      activeChatTitle: byId("aiActiveChatTitle"),
      archivedBadge: byId("aiArchivedBadge"),
      pickReadingsBtn: byId("aiPickReadingsBtn"),
      renameChatBtn: byId("aiRenameChatBtn"),
      exportMdBtn: byId("aiExportMdBtn"),
      archiveChatBtn: byId("aiArchiveChatBtn"),
      deleteChatBtn: byId("aiDeleteChatBtn"),
      attachedChips: byId("aiAttachedChips"),
      storageWarning: byId("aiStorageWarning"),
      storageExportBtn: byId("aiStorageExportBtn"),
      setupBanner: byId("aiSetupBanner"),
      setupBannerText: byId("aiSetupBannerText"),
      bannerSettingsBtn: byId("aiBannerSettingsBtn"),
      bannerPickBtn: byId("aiBannerPickBtn"),
      messages: byId("aiMessages"),
      promptInput: byId("aiPromptInput"),
      sendBtn: byId("aiSendBtn"),
      stopBtn: byId("aiStopBtn"),
      contextMeter: byId("aiContextMeter"),

      // Picker Modal
      pickerModal: byId("aiPickerModal"),
      pickerCloseBtn: byId("aiPickerCloseBtn"),
      pickerSearchInput: byId("aiPickerSearchInput"),
      pickerDeckFilter: byId("aiPickerDeckFilter"),
      pickerList: byId("aiPickerList"),
      pickerClearBtn: byId("aiPickerClearBtn"),
      pickerApplyBtn: byId("aiPickerApplyBtn"),

      // Rename Modal
      renameModal: byId("aiRenameModal"),
      renameCloseBtn: byId("aiRenameCloseBtn"),
      renameInput: byId("aiRenameInput"),
      renameCancelBtn: byId("aiRenameCancelBtn"),
      renameSaveBtn: byId("aiRenameSaveBtn"),

      // Settings Modal
      settingsModal: byId("aiSettingsModal"),
      settingsCloseBtn: byId("aiSettingsCloseBtn"),
      profileList: byId("aiProfileList"),
      newProfileBtn: byId("aiNewProfileBtn"),
      profileDeleteBtn: byId("aiProfileDeleteBtn"),
      presetRow: byId("aiPresetRow"),
      profileName: byId("aiProfileName"),
      profileFormat: byId("aiProfileFormat"),
      profileBaseUrl: byId("aiProfileBaseUrl"),
      profileApiKey: byId("aiProfileApiKey"),
      toggleKeyBtn: byId("aiToggleKeyVisibilityBtn"),
      profileModel: byId("aiProfileModel"),
      vertexGroup: byId("aiVertexGroup"),
      profileVertexProject: byId("aiProfileVertexProject"),
      profileVertexLocation: byId("aiProfileVertexLocation"),
      profileTemperature: byId("aiProfileTemperature"),
      profileMaxTokens: byId("aiProfileMaxTokens"),
      fieldContextWindow: byId("aiFieldContextWindow"),
      detectContextBtn: byId("aiDetectContextBtn"),
      contextWindowHint: byId("aiContextWindowHint"),
      fieldAutoCompress: byId("aiFieldAutoCompress"),
      formatHint: byId("aiFormatHint"),
      clearConfigBtn: byId("aiClearConfigBtn"),
      testConnectionBtn: byId("aiTestConnectionBtn"),
      saveProfileBtn: byId("aiSaveProfileBtn"),
      settingsStatus: byId("aiSettingsStatus"),
      themeToast: byId("themeToast")
    };

    function showToast(message, isError) {
      if (!els.themeToast || !message) return;
      if (state.toastTimer) {
        clearTimeout(state.toastTimer);
        state.toastTimer = null;
      }
      els.themeToast.textContent = message;
      els.themeToast.classList.toggle("is-error", Boolean(isError));
      els.themeToast.classList.add("is-on");
      state.toastTimer = setTimeout(function () {
        state.toastTimer = null;
        if (els.themeToast) {
          els.themeToast.classList.remove("is-on");
          els.themeToast.classList.remove("is-error");
        }
      }, 3400);
    }

    global.__quareiaHistoryExportResult = function (result) {
      if (result && result.cancelled) {
        showToast(tr("ai.exportCancelled", null, "已取消导出。", "Export cancelled."), false);
      } else if (result && result.ok) {
        var outName = result.fileName || "quareia-ai-export";
        showToast(tr("ai.exportedTo", { fileName: outName },
          "已导出：" + outName,
          "Exported: " + outName), false);
      } else {
        var failMsg = tr("ai.exportFailed", null, "导出失败，请稍后重试。", "Export failed. Please try again.");
        showToast(failMsg, true);
        if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
          global.DivinationDialog.request({
            kicker: tr("ai.backupKicker", null, "AI 备份", "AI BACKUP"),
            title: tr("ai.exportFailed", null, "导出失败，请稍后重试。", "Export failed. Please try again."),
            message: failMsg,
            cancelLabel: tr("ai.close", null, "关闭", "Close"),
            proceedLabel: tr("ai.ok", null, "确定", "OK")
          });
        }
      }
    };

    function formatDisplayLabel(formatId) {
      var map = {
        "openai-chat": tr("ai.format.openaiChat", null, "OpenAI Chat Completions (/v1/chat/completions)", "OpenAI Chat Completions (/v1/chat/completions)"),
        "openai-responses": tr("ai.format.openaiResponses", null, "OpenAI Responses API (/v1/responses)", "OpenAI Responses API (/v1/responses)"),
        "anthropic-messages": tr("ai.format.anthropic", null, "Anthropic Messages (/v1/messages)", "Anthropic Messages (/v1/messages)"),
        "gemini-aistudio": tr("ai.format.geminiStudio", null, "Google Gemini AI Studio", "Google Gemini AI Studio"),
        "gemini-vertex": tr("ai.format.geminiVertex", null, "Google Gemini Vertex AI（仅静态 API Key）", "Google Gemini Vertex AI (Static API Key)")
      };
      return map[formatId] || formatId;
    }

    function formatHintText(formatId) {
      var map = {
        "openai-chat": tr("ai.hint.openaiChat", null,
          "兼容 OpenAI、DeepSeek、OpenRouter、SiliconFlow 及符合 /v1/chat/completions 规范的代理地址；默认发送 Authorization: Bearer 请求头。",
          "Compatible with OpenAI, DeepSeek, OpenRouter, and /v1/chat/completions proxies using Authorization: Bearer."),
        "openai-responses": tr("ai.hint.openaiResponses", null,
          "适用于 OpenAI 新版 Responses 接口 (/v1/responses)，请求体使用 instructions 与 input 字段。",
          "Uses OpenAI Responses API (/v1/responses) with instructions and input payload fields."),
        "anthropic-messages": tr("ai.hint.anthropic", null,
          "适用于 Claude (/v1/messages)，自动附带 x-api-key、anthropic-version 与浏览器直连所需请求头。",
          "Uses Anthropic Messages (/v1/messages) with x-api-key, anthropic-version, and browser direct-access header."),
        "gemini-aistudio": tr("ai.hint.geminiStudio", null,
          "使用 Google AI Studio API Key，自动请求 generativelanguage.googleapis.com 的 streamGenerateContent?alt=sse 接口。",
          "Uses Google AI Studio API Key via x-goog-api-key against generativelanguage.googleapis.com."),
        "gemini-vertex": tr("ai.hint.geminiVertex", null,
          "仅使用静态 API Key (x-goog-api-key)，不提供 OAuth 登录。留空 Project ID 可直接用于 Vertex Express Mode；填写 Project ID 与 Location 则构造区域项目静态密钥接口。",
          "Static API key only (x-goog-api-key); no OAuth login. Leave Project ID blank for Express Mode, or set Project ID & Location for regional endpoints.")
      };
      return map[formatId] || "";
    }

    function setThemePopoverOpen(nextOpen) {
      state.themePopoverOpen = Boolean(nextOpen);
      if (els.themePopover) {
        els.themePopover.hidden = !state.themePopoverOpen;
      }
      if (els.themeBtn) {
        els.themeBtn.setAttribute("aria-expanded", state.themePopoverOpen ? "true" : "false");
      }
    }

    function setSidebarOpen(nextOpen) {
      state.sidebarOpen = Boolean(nextOpen);
      if (els.sidebar) els.sidebar.classList.toggle("is-open", state.sidebarOpen);
      if (els.sidebarBackdrop) els.sidebarBackdrop.hidden = !state.sidebarOpen;
      if (els.sidebarToggle) els.sidebarToggle.setAttribute("aria-expanded", state.sidebarOpen ? "true" : "false");
    }

    function getOpenModal() {
      var candidates = [els.renameModal, els.pickerModal, els.settingsModal];
      for (var i = 0; i < candidates.length; i += 1) {
        if (candidates[i] && !candidates[i].hidden) {
          return candidates[i];
        }
      }
      return null;
    }

    function openModal(modalEl, focusEl) {
      if (!modalEl) return;
      state.lastFocusedBeforeModal = document.activeElement || null;
      modalEl.hidden = false;
      if (focusEl && typeof focusEl.focus === "function") {
        setTimeout(function () { focusEl.focus(); }, 0);
      }
    }

    function closeModal(modalEl) {
      if (!modalEl) return;
      modalEl.hidden = true;
      if (state.lastFocusedBeforeModal && typeof state.lastFocusedBeforeModal.focus === "function") {
        try {
          state.lastFocusedBeforeModal.focus();
        } catch (_err) {
          // Ignore focus restore failure
        }
      }
      state.lastFocusedBeforeModal = null;
    }

    function setStatusText(el, msg, isError) {
      if (!el) return;
      el.textContent = msg || "";
      el.classList.toggle("is-error", Boolean(isError));
    }

    function loadSelectableReadings() {
      if (!historyStore) {
        state.selectableReadings = [];
        state.readingsById = Object.create(null);
        return Promise.resolve([]);
      }
      return historyStore.listRecords("all").then(function (allRecords) {
        var selectable = contextApi.filterSelectableHistoryRecords(allRecords);
        var map = Object.create(null);
        for (var i = 0; i < selectable.length; i += 1) {
          map[selectable[i].id] = selectable[i];
        }
        state.selectableReadings = selectable;
        state.readingsById = map;
        return selectable;
      }).catch(function () {
        state.selectableReadings = [];
        state.readingsById = Object.create(null);
        return [];
      });
    }

    function getAttachedRecordsForConversation(conv) {
      if (!conv || !Array.isArray(conv.readingIds)) return [];
      var snapById = Object.create(null);
      (conv.readingSnapshots || []).forEach(function (s) {
        if (s && s.id) {
          snapById[s.id] = s;
        }
      });
      var records = [];
      for (var i = 0; i < conv.readingIds.length; i += 1) {
        var rid = conv.readingIds[i];
        var rec = state.readingsById[rid];
        var snap = snapById[rid];
        if (rec && (!snap || contextApi.resolveReadingDetails(rec, { customLibrary: customLibrary }).spreadFound)) {
          records.push(rec);
          continue;
        }
        if (snap && Array.isArray(snap.cards) && snap.cards.length > 0) {
          records.push(snap);
        }
      }
      return records;
    }

    function buildReadingSnapshots(ids, existingSnapshots) {
      var prevById = Object.create(null);
      var prevList = Array.isArray(existingSnapshots)
        ? existingSnapshots
        : ((state.activeConversation && state.activeConversation.readingSnapshots) || []);
      for (var p = 0; p < prevList.length; p += 1) {
        if (prevList[p] && prevList[p].id) {
          prevById[prevList[p].id] = prevList[p];
        }
      }
      var snaps = [];
      for (var i = 0; i < ids.length; i += 1) {
        var rid = ids[i];
        var rec = state.readingsById[rid];
        if (rec && (!prevById[rid] || contextApi.resolveReadingDetails(rec, { customLibrary: customLibrary }).spreadFound)) {
          var built = contextApi.buildReadingSnapshot(rec, {
            locale: currentLocale(),
            customLibrary: customLibrary
          });
          if (built) {
            snaps.push(built);
          }
        } else if (prevById[rid]) {
          snaps.push(prevById[rid]);
        }
      }
      return snaps;
    }

    function deriveAutoTitle(readingIds, firstUserMessage) {
      if (Array.isArray(readingIds) && readingIds.length > 0) {
        var targetId = readingIds[0];
        var firstRec = state.readingsById[targetId] || null;
        if (!firstRec && state.activeConversation && Array.isArray(state.activeConversation.readingSnapshots)) {
          for (var s = 0; s < state.activeConversation.readingSnapshots.length; s += 1) {
            if (state.activeConversation.readingSnapshots[s].id === targetId) {
              firstRec = state.activeConversation.readingSnapshots[s];
              break;
            }
          }
        }
        if (firstRec) {
          var resolved = contextApi.resolveReadingDetails(firstRec, {
            locale: currentLocale(),
            customLibrary: customLibrary
          });
          var base = resolved ? resolved.spreadName : (firstRec.spreadName || firstRec.spreadNameSnapshot || "");
          if (firstRec.question) {
            return (base ? base + " · " : "") + firstRec.question.slice(0, 24);
          }
          if (base) return base;
        }
      }
      if (firstUserMessage && firstUserMessage.trim()) {
        return firstUserMessage.trim().replace(/\s+/g, " ").slice(0, 28);
      }
      return "";
    }

    function updateBackLink() {
      var target = "index.html";
      var isClassic = false;
      if (global.DivinationPageVersion && typeof global.DivinationPageVersion.getVersion === "function") {
        isClassic = global.DivinationPageVersion.getVersion() === "classic";
      } else if (typeof global.localStorage !== "undefined") {
        try {
          isClassic = global.localStorage.getItem("quareia-page-version") === "classic";
        } catch (_err) {
          isClassic = false;
        }
      }
      if (isClassic) {
        target = "classic.html";
      }
      if (els.backToReading) {
        els.backToReading.setAttribute("href", target);
      }
      var menuBack = byId("aiMenuBackToReading");
      if (menuBack) {
        menuBack.setAttribute("href", target);
      }
    }

    function applyAiLocalizedAttributes() {
      if (typeof document === "undefined") return;
      document.title = tr("ai.pageTitle", null, "AI 辅助解牌 · Quareia 占卜", "AI Assisted Reading · Quareia Divination");
      Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-placeholder]"), function (el) {
        var key = el.getAttribute("data-i18n-placeholder");
        if (!key) return;
        el.placeholder = tr(key, null, el.placeholder || "", el.placeholder || "");
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-content]"), function (el) {
        var key = el.getAttribute("data-i18n-content");
        if (!key) return;
        var prev = el.getAttribute("content") || "";
        el.setAttribute("content", tr(key, null, prev, prev));
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria-label]"), function (el) {
        var key = el.getAttribute("data-i18n-aria-label");
        if (!key) return;
        var prev = el.getAttribute("aria-label") || "";
        el.setAttribute("aria-label", tr(key, null, prev, prev));
      });
    }

    function updateProfileIndicator() {
      var profile = configStore.getActiveProfile();
      var valid = profile ? providers.validateProfile(profile).ok : false;
      if (els.profileDot) els.profileDot.classList.toggle("is-ready", valid);
      if (els.activeProfileName) {
        if (profile && valid) {
          els.activeProfileName.textContent = (profile.name || profile.model) + " (" + profile.model + ")";
        } else {
          els.activeProfileName.textContent = tr("ai.profileUnconfigured", null, "未配置 API Key", "API Key not set");
        }
      }
      updateSetupBanner(valid);
    }

    function updateSetupBanner(hasValidProfile) {
      if (!els.setupBanner) return;
      var conv = state.activeConversation;
      var hasReading = Boolean(conv && conv.readingIds && conv.readingIds.length > 0);
      var needsProfile = !hasValidProfile;
      if (!needsProfile && hasReading) {
        els.setupBanner.hidden = true;
        return;
      }
      els.setupBanner.hidden = false;
      if (els.setupBannerText) {
        if (needsProfile && !hasReading) {
          els.setupBannerText.textContent = tr("ai.banner.needBoth", null,
            "请先配置大模型 API Key；如需辅助解牌，可从非自由画板占卜历史中选择一条或多条记录作为上下文，也可直接自由对话。",
            "Configure an API key first. Optionally attach non-freeboard readings for interpretation, or chat freely on any topic.");
        } else if (needsProfile) {
          els.setupBannerText.textContent = tr("ai.banner.needKey", null,
            "尚未配置可用的模型 API Key。点击「API 设置」填写密钥并测试连接后即可开始对话。",
            "No active API key configured yet. Open API Settings to add your key and test the connection.");
        } else {
          els.setupBannerText.textContent = tr("ai.banner.needReading", null,
            "当前对话尚未附加占卜记录：可直接进行常规 AI 对话，或点击「选择占卜历史」传入固定/自定义牌阵与应用内牌意。",
            "No readings attached: you can chat normally on any topic, or attach non-freeboard readings for in-app card interpretation.");
        }
      }
      if (els.bannerSettingsBtn) els.bannerSettingsBtn.hidden = !needsProfile;
      if (els.bannerPickBtn) els.bannerPickBtn.hidden = hasReading;
    }

    function renderSidebar() {
      if (!els.chatList) return;
      if (els.tabActive) {
        els.tabActive.setAttribute("aria-selected", state.activeTab === "active" ? "true" : "false");
        els.tabActive.textContent = tr("ai.tabActiveCount", { count: state.allCounts.active },
          "进行中 (" + state.allCounts.active + ")",
          "Active (" + state.allCounts.active + ")");
      }
      if (els.tabArchived) {
        els.tabArchived.setAttribute("aria-selected", state.activeTab === "archived" ? "true" : "false");
        els.tabArchived.textContent = tr("ai.tabArchivedCount", { count: state.allCounts.archived },
          "已归档 (" + state.allCounts.archived + ")",
          "Archived (" + state.allCounts.archived + ")");
      }
      if (els.clearChatsBtn) {
        els.clearChatsBtn.textContent = state.activeTab === "archived"
          ? tr("ai.clearArchived", null, "清空已归档", "Clear Archived")
          : tr("ai.clearActive", null, "清空进行中", "Clear Active");
      }

      var list = state.conversations;
      if (!list.length) {
        var empty = document.createElement("div");
        empty.className = "ai-chat-empty";
        empty.textContent = state.searchQuery
          ? tr("ai.noMatchingChats", null, "没有匹配的对话记录。", "No matching conversations.")
          : (state.activeTab === "archived"
            ? tr("ai.noArchivedChats", null, "暂无已归档对话。", "No archived conversations.")
            : tr("ai.noActiveChats", null, "暂无对话，点击上方「新建对话」开始。", "No conversations yet. Start a new chat above."));
        els.chatList.replaceChildren(empty);
        return;
      }

      var frag = document.createDocumentFragment();
      var activeId = state.activeConversation ? state.activeConversation.id : "";

      list.forEach(function (conv) {
        var row = document.createElement("div");
        row.className = "ai-chat-item" + (conv.id === activeId ? " is-active" : "");

        var selectBtn = document.createElement("button");
        selectBtn.type = "button";
        selectBtn.className = "ai-chat-item-select";

        var titleRow = document.createElement("div");
        titleRow.className = "ai-chat-item-title-row";
        if (conv.pinned) {
          var pinTag = document.createElement("span");
          pinTag.className = "ai-chat-pin-tag";
          pinTag.textContent = "★";
          pinTag.setAttribute("aria-label", tr("ai.pinned", null, "已置顶", "Pinned"));
          titleRow.appendChild(pinTag);
        }
        var titleSpan = document.createElement("span");
        titleSpan.className = "ai-chat-item-title";
        titleSpan.textContent = conv.title || tr("ai.untitledChat", null, "新解牌对话", "Untitled Chat");
        titleRow.appendChild(titleSpan);

        var metaSpan = document.createElement("span");
        metaSpan.className = "ai-chat-item-meta";
        var msgCount = conv.messages ? conv.messages.length : 0;
        var readCount = conv.readingIds ? conv.readingIds.length : 0;
        metaSpan.textContent = formatShortTime(conv.updatedAt) + " · "
          + tr("ai.chatMetaSummary", { readings: readCount, messages: msgCount },
            readCount + " 条占卜 · " + msgCount + " 条消息",
            readCount + " readings · " + msgCount + " msgs");

        selectBtn.appendChild(titleRow);
        selectBtn.appendChild(metaSpan);
        selectBtn.addEventListener("click", function () {
          selectConversation(conv.id);
          setSidebarOpen(false);
        });

        var actions = document.createElement("div");
        actions.className = "ai-chat-item-actions";

        var pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "ai-mini-action";
        pinBtn.textContent = conv.pinned
          ? tr("ai.unpin", null, "取消置顶", "Unpin")
          : tr("ai.pin", null, "置顶", "Pin");
        pinBtn.addEventListener("click", function () { togglePin(conv.id, !conv.pinned); });

        var renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "ai-mini-action";
        renameBtn.textContent = tr("ai.rename", null, "重命名", "Rename");
        renameBtn.addEventListener("click", function () { openRenameDialog(conv); });

        var archiveBtn = document.createElement("button");
        archiveBtn.type = "button";
        archiveBtn.className = "ai-mini-action";
        archiveBtn.dataset.streamLock = "true";
        archiveBtn.disabled = state.streaming;
        archiveBtn.textContent = conv.archived
          ? tr("ai.unarchive", null, "取消归档", "Unarchive")
          : tr("ai.archive", null, "归档", "Archive");
        archiveBtn.addEventListener("click", function () { toggleArchive(conv.id, !conv.archived); });

        var deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "ai-mini-action is-danger";
        deleteBtn.dataset.streamLock = "true";
        deleteBtn.disabled = state.streaming;
        deleteBtn.textContent = tr("ai.delete", null, "删除", "Delete");
        deleteBtn.addEventListener("click", function () { deleteChatWithConfirm(conv); });

        actions.appendChild(pinBtn);
        actions.appendChild(renameBtn);
        actions.appendChild(archiveBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(selectBtn);
        row.appendChild(actions);
        frag.appendChild(row);
      });

      els.chatList.replaceChildren(frag);
    }

    function contextSourceLabel(source) {
      if (source === "manual") return tr("ai.contextSource.manual", null, "手动指定", "Manual");
      if (source === "api") return tr("ai.contextSource.api", null, "接口实时获取", "Fetched from API");
      if (source === "catalog") return tr("ai.contextSource.catalog", null, "模型目录识别", "Matched from catalog");
      return tr("ai.contextSource.default", null, "默认保守估计", "Default estimate");
    }

    function buildPromptPayloadForConversation(conv, uptoIndex) {
      var targetConv = conv || state.activeConversation;
      var records = getAttachedRecordsForConversation(targetConv);
      var readingsMd = contextApi.formatReadingsForPrompt(records, {
        locale: currentLocale(),
        customLibrary: customLibrary
      });
      var messages = targetConv && Array.isArray(targetConv.messages) ? targetConv.messages : [];
      var limitIdx = typeof uptoIndex === "number" ? Math.min(messages.length, Math.max(0, uptoIndex)) : messages.length;
      var summaryObj = targetConv && targetConv.contextSummary && targetConv.contextSummary.text
        ? targetConv.contextSummary
        : null;
      var summaryText = "";
      var startIndex = 0;
      var compressedCount = 0;

      if (summaryObj && summaryObj.coveredUntilId) {
        var coveredIdx = -1;
        for (var c = 0; c < limitIdx; c += 1) {
          if (messages[c] && messages[c].id === summaryObj.coveredUntilId) {
            coveredIdx = c;
            break;
          }
        }
        if (coveredIdx !== -1) {
          var postSummaryValid = normalizeConversationMessagesForApi(messages, coveredIdx + 1, limitIdx);
          if (postSummaryValid.length > 0) {
            summaryText = summaryObj.text;
            startIndex = coveredIdx + 1;
            compressedCount = summaryObj.compressedCount || (coveredIdx + 1);
          }
        }
      }

      var validMessages = normalizeConversationMessagesForApi(messages, startIndex, limitIdx);

      var systemPrompt = contextApi.buildSystemPrompt(currentLocale(), readingsMd, summaryText);
      var apiMessages = validMessages.map(function (item) {
        return { role: item.role, content: item.content };
      });
      var estimatedTokens = contextApi.estimateConversationTokens({
        systemPrompt: systemPrompt,
        messages: apiMessages
      });

      return {
        readingsMd: readingsMd,
        summaryText: summaryText,
        compressedCount: compressedCount,
        validMessages: validMessages,
        apiMessages: apiMessages,
        systemPrompt: systemPrompt,
        estimatedTokens: estimatedTokens
      };
    }

    function renderContextMeter() {
      if (!els.contextMeter) return;
      if (state.compressing) {
        els.contextMeter.classList.add("is-compressing");
        els.contextMeter.classList.remove("is-compressed");
        els.contextMeter.textContent = tr("ai.compressingStatus", null,
          "正在压缩早期对话上下文以保持完整牌意…",
          "Compressing earlier messages to preserve context…");
        return;
      }
      els.contextMeter.classList.remove("is-compressing");
      var profile = configStore.getActiveProfile();
      var ctxResolved = providers.resolveContextWindow(profile || {});
      var conv = state.activeConversation;
      var payload = buildPromptPayloadForConversation(conv, conv && Array.isArray(conv.messages) ? conv.messages.length : 0);
      var compressedCount = payload.compressedCount || 0;
      els.contextMeter.classList.toggle("is-compressed", compressedCount > 0);

      var baseText = tr("ai.contextMeter", {
        used: formatTokenCount(payload.estimatedTokens),
        limit: formatTokenCount(ctxResolved.contextWindow),
        source: contextSourceLabel(ctxResolved.source)
      },
      "上下文约 " + formatTokenCount(payload.estimatedTokens) + " / " + formatTokenCount(ctxResolved.contextWindow) + " tokens（" + contextSourceLabel(ctxResolved.source) + "）",
      "Context ~" + formatTokenCount(payload.estimatedTokens) + " / " + formatTokenCount(ctxResolved.contextWindow) + " tokens (" + contextSourceLabel(ctxResolved.source) + ")");

      if (compressedCount > 0) {
        baseText += tr("ai.contextMeterCompressed", { count: compressedCount },
          " · 已压缩早期 " + compressedCount + " 条",
          " · " + compressedCount + " earlier compressed");
      }
      els.contextMeter.textContent = baseText;
    }

    function renderContextHeader() {
      var conv = state.activeConversation;
      if (!conv) {
        if (els.activeChatTitle) {
          els.activeChatTitle.textContent = tr("ai.untitledChat", null, "新解牌对话", "Untitled Chat");
        }
        if (els.archivedBadge) {
          els.archivedBadge.hidden = true;
        }
        if (els.archiveChatBtn) {
          els.archiveChatBtn.textContent = tr("ai.archive", null, "归档", "Archive");
        }
        if (els.attachedChips) {
          var emptyHint = document.createElement("span");
          emptyHint.className = "ai-no-reading-hint";
          emptyHint.textContent = tr("ai.noAttachedReadings", null,
            "未附加占卜记录（已自动过滤自由画板记录）",
            "No readings attached (freeform records excluded)");
          els.attachedChips.replaceChildren(emptyHint);
        }
        updateStreamingUi();
        updateProfileIndicator();
        renderContextMeter();
        return;
      }

      if (els.activeChatTitle) {
        els.activeChatTitle.textContent = conv.title || tr("ai.untitledChat", null, "新解牌对话", "Untitled Chat");
      }
      if (els.archivedBadge) {
        els.archivedBadge.hidden = !conv.archived;
      }
      if (els.archiveChatBtn) {
        els.archiveChatBtn.textContent = conv.archived
          ? tr("ai.unarchive", null, "取消归档", "Unarchive")
          : tr("ai.archive", null, "归档", "Archive");
      }

      if (els.attachedChips) {
        var ids = conv.readingIds || [];
        if (ids.length === 0) {
          var hint = document.createElement("span");
          hint.className = "ai-no-reading-hint";
          hint.textContent = tr("ai.noAttachedReadings", null,
            "未附加占卜记录（已自动过滤自由画板记录）",
            "No readings attached (freeform records excluded)");
          els.attachedChips.replaceChildren(hint);
        } else {
          var chipFrag = document.createDocumentFragment();
          var snapById = Object.create(null);
          (conv.readingSnapshots || []).forEach(function (s) { snapById[s.id] = s; });

          ids.forEach(function (rid) {
            var live = state.readingsById[rid];
            var snap = snapById[rid];
            var sourceRec = live || snap || null;
            var summary = sourceRec
              ? contextApi.buildReadingCardSummary(sourceRec, {
                  locale: currentLocale(),
                  customLibrary: customLibrary
                })
              : null;

            var card = document.createElement("article");
            card.className = "ai-reading-card";

            var top = document.createElement("div");
            top.className = "ai-reading-card-top";

            var deckTag = summary ? summary.deckLabel : deckShortLabel(snap ? snap.deckType : "");
            if (deckTag) {
              var tagEl = document.createElement("span");
              tagEl.className = "ai-reading-card-deck";
              tagEl.textContent = deckTag;
              top.appendChild(tagEl);
            }

            var titleEl = document.createElement("span");
            titleEl.className = "ai-reading-card-title";
            var titleText = summary ? summary.spreadName : ((snap && snap.spreadName) || rid);
            if (!live && (!snap || !Array.isArray(snap.cards) || snap.cards.length === 0)) {
              titleText += " [" + tr("ai.readingDeleted", null, "原记录已不在本地历史中", "Removed from local history") + "]";
            }
            titleEl.textContent = titleText;
            titleEl.title = titleText;
            top.appendChild(titleEl);

            var rmBtn = document.createElement("button");
            rmBtn.type = "button";
            rmBtn.className = "ai-chip-remove";
            rmBtn.dataset.streamLock = "true";
            rmBtn.disabled = state.streaming;
            rmBtn.textContent = "×";
            rmBtn.setAttribute("aria-label", tr("ai.removeReading", null, "移除此占卜记录", "Remove reading"));
            rmBtn.addEventListener("click", function () { removeAttachedReading(rid); });
            top.appendChild(rmBtn);
            card.appendChild(top);

            var metaParts = [];
            if (summary && summary.modeBadge) metaParts.push(summary.modeBadge);
            if (summary && summary.createdText) metaParts.push(summary.createdText);
            if (summary && summary.question) metaParts.push(summary.question);
            if (!live && snap && Array.isArray(snap.cards) && snap.cards.length > 0) {
              metaParts.push(tr("ai.readingSnapshotSaved", null, "已使用对话内保存的牌阵快照", "Saved snapshot"));
            }
            if (metaParts.length > 0) {
              var metaEl = document.createElement("div");
              metaEl.className = "ai-reading-card-meta";
              metaEl.textContent = metaParts.join(" · ");
              metaEl.title = metaEl.textContent;
              card.appendChild(metaEl);
            }

            if (summary && summary.cardsPreview) {
              var previewEl = document.createElement("div");
              previewEl.className = "ai-reading-card-preview";
              previewEl.textContent = summary.cardsPreview;
              previewEl.title = summary.cardsPreview;
              card.appendChild(previewEl);
            }

            chipFrag.appendChild(card);
          });
          els.attachedChips.replaceChildren(chipFrag);
        }
      }

      updateProfileIndicator();
      renderContextMeter();
    }

    function createStarterEmptyState() {
      var box = document.createElement("section");
      box.className = "ai-empty-state";

      var h2 = document.createElement("h2");
      h2.textContent = tr("ai.emptyHeading", null, "AI 辅助解牌助手", "AI Assisted Reading");
      box.appendChild(h2);

      var p = document.createElement("p");
      p.textContent = tr("ai.emptyDesc", null,
        "选择一条或多条非自由画板占卜记录后，系统会将对应牌阵的牌位定义、应用内关键词与完整牌意整理发送给大模型。你可以输入自己的背景疑问，点击下方示例快速开始：",
        "Attach one or more non-freeboard readings to provide spread positions, keywords, and in-app card meanings to your chosen LLM, then ask a question or pick a starter prompt:");
      box.appendChild(p);

      var starters = isEnglishLocale()
        ? [
            "Synthesize the overall pattern across all positions for my question.",
            "Focus on tensions, warnings, and practical next steps shown in this reading.",
            "Compare how the attached readings relate to one another over time."
          ]
        : [
            "请结合所附牌阵的牌位含义与应用内牌意，为我整体梳理和解读这次占卜。",
            "请重点分析当前牌面中的阻力、警示以及可行的现实应对方向。",
            "如果附加了多条占卜记录，请对比它们之间的关联与演变趋势。"
          ];

      var list = document.createElement("div");
      list.className = "ai-starter-list";
      starters.forEach(function (promptText) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-starter-btn";
        btn.textContent = promptText;
        btn.addEventListener("click", function () {
          if (state.streaming) return;
          if (els.promptInput) els.promptInput.value = promptText;
          sendUserPrompt();
        });
        list.appendChild(btn);
      });
      box.appendChild(list);
      return box;
    }

    function isMessagesNearBottom() {
      if (!els.messages) return true;
      var distance = (els.messages.scrollHeight || 0) - (els.messages.scrollTop || 0) - (els.messages.clientHeight || 0);
      return !(distance > 72);
    }

    function scrollMessagesToBottom() {
      if (!els.messages) return;
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    function renderMessages(renderOpts) {
      if (!els.messages) return;
      var optsRender = renderOpts && typeof renderOpts === "object" ? renderOpts : {};
      var conv = state.activeConversation;
      var currentConvId = conv ? conv.id : "";
      var switchedConv = currentConvId !== state.lastRenderedConvId;
      var shouldScroll = Boolean(optsRender.forceScroll || switchedConv || isMessagesNearBottom());
      var openReasoningIds = Object.create(null);
      if (!switchedConv && typeof els.messages.querySelectorAll === "function") {
        Array.prototype.forEach.call(els.messages.querySelectorAll(".ai-msg"), function (art) {
          var det = art.querySelector ? art.querySelector("details.ai-reasoning") : null;
          var isOpen = Boolean(det && (det.open || (typeof det.hasAttribute === "function" && det.hasAttribute("open"))));
          if (isOpen && art.dataset && art.dataset.msgId) {
            openReasoningIds[art.dataset.msgId] = true;
          }
        });
      }
      state.lastRenderedConvId = currentConvId;

      if (!conv || !conv.messages || conv.messages.length === 0) {
        els.messages.replaceChildren(createStarterEmptyState());
        return;
      }

      var frag = document.createDocumentFragment();
      var messages = conv.messages;

      messages.forEach(function (msg, index) {
        var article = document.createElement("article");
        article.className = "ai-msg " + (msg.role === "assistant" ? "ai-msg-assistant" : "ai-msg-user");
        article.dataset.msgId = msg.id;

        var head = document.createElement("div");
        head.className = "ai-msg-head";
        var roleLabel = msg.role === "assistant"
          ? (msg.model ? ("AI · " + msg.model) : "AI")
          : tr("ai.roleUser", null, "你", "You");
        var timeLabel = formatShortTime(msg.createdAt);
        head.textContent = timeLabel ? (roleLabel + " · " + timeLabel) : roleLabel;
        article.appendChild(head);

        if (msg.role === "assistant" && msg.reasoning) {
          var details = document.createElement("details");
          details.className = "ai-reasoning";
          if (openReasoningIds[msg.id]) {
            details.open = true;
          }
          var summary = document.createElement("summary");
          summary.textContent = tr("ai.reasoningSummary", null, "思考过程 / 推理摘要", "Reasoning Summary");
          var bodyDiv = document.createElement("div");
          bodyDiv.className = "ai-reasoning-body";
          bodyDiv.textContent = msg.reasoning;
          details.appendChild(summary);
          details.appendChild(bodyDiv);
          article.appendChild(details);
        }

        var bubble = document.createElement("div");
        bubble.className = "ai-msg-bubble";

        if (msg.role === "user" && state.editingMessageId === msg.id) {
          var editArea = document.createElement("textarea");
          editArea.className = "ai-textarea";
          editArea.rows = 3;
          editArea.value = msg.content;
          bubble.appendChild(editArea);

          var editActions = document.createElement("div");
          editActions.className = "ai-msg-actions";
          editActions.style.marginTop = "8px";

          var saveResendBtn = document.createElement("button");
          saveResendBtn.type = "button";
          saveResendBtn.className = "btn btn-accent";
          saveResendBtn.textContent = tr("ai.saveAndResend", null, "保存并重新发送", "Save & Resend");
          saveResendBtn.addEventListener("click", function () {
            commitEditAndResend(msg.id, editArea.value);
          });

          var cancelEditBtn = document.createElement("button");
          cancelEditBtn.type = "button";
          cancelEditBtn.className = "btn btn-secondary";
          cancelEditBtn.textContent = tr("ai.cancel", null, "取消", "Cancel");
          cancelEditBtn.addEventListener("click", function () {
            state.editingMessageId = "";
            renderMessages();
          });

          editActions.appendChild(saveResendBtn);
          editActions.appendChild(cancelEditBtn);
          bubble.appendChild(editActions);
          article.appendChild(bubble);
          frag.appendChild(article);
          return;
        }

        var isLiveStreamingTurn = Boolean(state.streaming && index === messages.length - 1);
        if (msg.role === "assistant") {
          var mdContainer = document.createElement("div");
          mdContainer.className = "ai-markdown";
          if (msg.content) {
            renderMarkdownInto(mdContainer, msg.content);
          } else if (isLiveStreamingTurn) {
            var waiting = document.createElement("span");
            waiting.className = "ai-streaming-cursor";
            mdContainer.appendChild(waiting);
          }
          if (isLiveStreamingTurn && msg.content) {
            var cursor = document.createElement("span");
            cursor.className = "ai-streaming-cursor";
            mdContainer.appendChild(cursor);
          }
          bubble.appendChild(mdContainer);
        } else {
          bubble.textContent = msg.content;
        }

        var canRegenerate = msg.role === "assistant" && hasPrecedingUserTurn(messages, index);
        var effectiveError = msg.error || (
          msg.role === "assistant" && !isLiveStreamingTurn && !msg.content
            ? tr("ai.stoppedEmpty", null, "已停止生成。", "Generation stopped.")
            : ""
        );
        if (effectiveError) {
          var errBox = document.createElement("div");
          errBox.className = "ai-msg-error";
          var errText = document.createElement("span");
          errText.textContent = effectiveError;
          errBox.appendChild(errText);
          if (msg.role === "assistant" && !state.streaming && canRegenerate) {
            var retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "ai-mini-action";
            retryBtn.textContent = tr("ai.retry", null, "重试", "Retry");
            retryBtn.addEventListener("click", function () { regenerateFromIndex(index); });
            errBox.appendChild(retryBtn);
          }
          bubble.appendChild(errBox);
        }

        article.appendChild(bubble);

        if (!isLiveStreamingTurn) {
          var msgActions = document.createElement("div");
          msgActions.className = "ai-msg-actions";

          var copyBtn = document.createElement("button");
          copyBtn.type = "button";
          copyBtn.className = "ai-mini-action";
          copyBtn.textContent = tr("ai.copy", null, "复制", "Copy");
          copyBtn.addEventListener("click", function () {
            copyTextToClipboard(msg.content || "").then(function (ok) {
              if (ok) {
                copyBtn.textContent = tr("ai.copied", null, "已复制", "Copied");
                setTimeout(function () {
                  copyBtn.textContent = tr("ai.copy", null, "复制", "Copy");
                }, 1400);
              }
            });
          });
          msgActions.appendChild(copyBtn);

          if (msg.role === "user") {
            var editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "ai-mini-action";
            editBtn.textContent = tr("ai.editResend", null, "编辑并重发", "Edit & Resend");
            editBtn.disabled = state.streaming;
            editBtn.addEventListener("click", function () {
              state.editingMessageId = msg.id;
              renderMessages();
            });
            msgActions.appendChild(editBtn);
          } else {
            var regenBtn = document.createElement("button");
            regenBtn.type = "button";
            regenBtn.className = "ai-mini-action";
            regenBtn.textContent = tr("ai.regenerate", null, "重新生成", "Regenerate");
            regenBtn.disabled = state.streaming || !canRegenerate;
            regenBtn.addEventListener("click", function () {
              regenerateFromIndex(index);
            });
            msgActions.appendChild(regenBtn);
          }

          var delMsgBtn = document.createElement("button");
          delMsgBtn.type = "button";
          delMsgBtn.className = "ai-mini-action is-danger";
          delMsgBtn.textContent = tr("ai.delete", null, "删除", "Delete");
          delMsgBtn.disabled = state.streaming;
          delMsgBtn.addEventListener("click", function () {
            deleteMessageWithConfirm(msg.id);
          });
          msgActions.appendChild(delMsgBtn);

          article.appendChild(msgActions);
        }

        frag.appendChild(article);
      });

      els.messages.replaceChildren(frag);
      if (shouldScroll) {
        scrollMessagesToBottom();
      }
    }

    function patchStreamingMessageDom(conv, assistantMsgIndex) {
      if (!els.messages || !conv || !state.activeConversation || state.activeConversation.id !== conv.id) {
        return;
      }
      var msg = conv.messages && conv.messages[assistantMsgIndex];
      if (!msg) return;
      var targetArticle = null;
      if (typeof els.messages.querySelectorAll === "function") {
        var articles = els.messages.querySelectorAll(".ai-msg");
        for (var i = articles.length - 1; i >= 0; i -= 1) {
          if (articles[i].dataset && articles[i].dataset.msgId === msg.id) {
            targetArticle = articles[i];
            break;
          }
        }
      }
      if (!targetArticle) {
        renderMessages({ forceScroll: false });
        return;
      }
      var shouldScroll = isMessagesNearBottom();
      var bubble = targetArticle.querySelector ? targetArticle.querySelector(".ai-msg-bubble") : null;
      if (!bubble) {
        renderMessages({ forceScroll: false });
        return;
      }

      if (msg.reasoning) {
        var details = targetArticle.querySelector ? targetArticle.querySelector("details.ai-reasoning") : null;
        if (!details) {
          details = document.createElement("details");
          details.className = "ai-reasoning";
          var summary = document.createElement("summary");
          summary.textContent = tr("ai.reasoningSummary", null, "思考过程 / 推理摘要", "Reasoning Summary");
          var bodyDiv = document.createElement("div");
          bodyDiv.className = "ai-reasoning-body";
          details.appendChild(summary);
          details.appendChild(bodyDiv);
          if (typeof targetArticle.insertBefore === "function") {
            targetArticle.insertBefore(details, bubble);
          } else {
            targetArticle.appendChild(details);
          }
        }
        var reasonBody = details.querySelector ? details.querySelector(".ai-reasoning-body") : details.lastChild;
        if (reasonBody) {
          reasonBody.textContent = msg.reasoning;
        }
      }

      var mdContainer = bubble.querySelector ? bubble.querySelector(".ai-markdown") : null;
      if (!mdContainer) {
        mdContainer = document.createElement("div");
        mdContainer.className = "ai-markdown";
        bubble.replaceChildren(mdContainer);
      }
      if (msg.content) {
        renderMarkdownInto(mdContainer, msg.content);
        if (state.streaming) {
          var cursor = document.createElement("span");
          cursor.className = "ai-streaming-cursor";
          mdContainer.appendChild(cursor);
        }
      } else if (state.streaming) {
        var waiting = document.createElement("span");
        waiting.className = "ai-streaming-cursor";
        mdContainer.replaceChildren(waiting);
      }

      if (shouldScroll) {
        scrollMessagesToBottom();
      }
    }

    function updateStreamingUi() {
      var hasConv = Boolean(state.activeConversation);
      if (els.sendBtn) els.sendBtn.hidden = state.streaming;
      if (els.stopBtn) els.stopBtn.hidden = !state.streaming;
      if (els.promptInput) els.promptInput.disabled = state.streaming;
      if (els.newChatBtn) els.newChatBtn.disabled = state.streaming;
      if (els.exportBackupBtn) els.exportBackupBtn.disabled = state.streaming;
      if (els.storageExportBtn) els.storageExportBtn.disabled = state.streaming;
      if (els.importBackupBtn) els.importBackupBtn.disabled = state.streaming;
      if (els.clearChatsBtn) els.clearChatsBtn.disabled = state.streaming;
      if (els.pickReadingsBtn) els.pickReadingsBtn.disabled = state.streaming || !hasConv;
      if (els.bannerPickBtn) els.bannerPickBtn.disabled = state.streaming;
      if (els.archiveChatBtn) els.archiveChatBtn.disabled = state.streaming || !hasConv;
      if (els.deleteChatBtn) els.deleteChatBtn.disabled = state.streaming || !hasConv;
      if (els.renameChatBtn) els.renameChatBtn.disabled = !hasConv;
      if (els.exportMdBtn) els.exportMdBtn.disabled = !hasConv;
      if (typeof document !== "undefined" && typeof document.querySelectorAll === "function") {
        Array.prototype.forEach.call(document.querySelectorAll("[data-stream-lock]"), function (btn) {
          btn.disabled = state.streaming;
        });
      }
    }

    function adoptConversation(refetched) {
      var live = state.activeConversation;
      if (state.streaming && live && refetched && live.id === refetched.id) {
        // The request callbacks own this object until the response is saved.
        Object.assign(live, refetched, {
          messages: live.messages,
          contextSummary: live.contextSummary,
          lastUsage: live.lastUsage
        });
        return live;
      }
      return refetched;
    }

    function startStreamingUi() {
      state.streaming = true;
      state.abortController = typeof AbortController === "function" ? new AbortController() : null;
      updateStreamingUi();
    }

    function finishStreamingUi() {
      state.streaming = false;
      state.compressing = false;
      state.abortController = null;
      state.activeStreamContext = null;
      updateStreamingUi();
    }

    function handleConversationWriteError(err, draft) {
      finishStreamingUi();
      if (draft && els.promptInput && !els.promptInput.value) els.promptInput.value = draft;
      var conflict = err && err.code === "conversation_conflict";
      if (conflict) refreshConversationsList();
      if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
        global.DivinationDialog.request({
          title: conflict
            ? tr("ai.chatChangedTitle", null, "对话已更新", "Conversation Updated")
            : tr("ai.saveFailedTitle", null, "保存失败", "Save Failed"),
          message: conflict
            ? tr("ai.chatChangedMsg", null, "其他标签页已修改此对话，已载入最新内容。请确认后重试。", "Another tab changed this conversation. The latest messages have been loaded; review them and retry.")
            : tr("ai.saveFailedMsg", null, "无法保存对话，请检查存储空间后重试。", "Could not save the conversation. Check available storage and retry."),
          cancelLabel: tr("ai.close", null, "关闭", "Close"),
          proceedLabel: tr("ai.ok", null, "确定", "OK")
        });
      }
    }

    function resolveFallbackConversation(allActive, allArchived) {
      if (state.conversations.length > 0) {
        return state.conversations[0];
      }
      if (state.activeTab === "archived") {
        return allArchived[0] || allActive[0] || null;
      }
      return allActive[0] || null;
    }

    function refreshConversationsList(preferredId) {
      return Promise.all([
        chatStore.listConversations({ archived: false, query: state.searchQuery }),
        chatStore.listConversations({ archived: true, query: state.searchQuery }),
        chatStore.listConversations({ archived: false }),
        chatStore.listConversations({ archived: true })
      ]).then(function (results) {
        var activeFiltered = results[0];
        var archivedFiltered = results[1];
        var allActive = results[2];
        var allArchived = results[3];
        state.allCounts.active = allActive.length;
        state.allCounts.archived = allArchived.length;
        state.conversations = state.activeTab === "archived" ? archivedFiltered : activeFiltered;
        var shouldAutoCreate = state.activeTab === "active" && !state.searchQuery && allActive.length === 0;

        function finalizeSelection(candidate) {
          state.activeConversation = candidate || resolveFallbackConversation(allActive, allArchived);
          if (!state.activeConversation && shouldAutoCreate) {
            return createFreshConversation();
          }
          updateStreamingUi();
          renderSidebar();
          renderContextHeader();
          renderMessages();
          return null;
        }

        if (preferredId) {
          return chatStore.getConversation(preferredId).then(function (found) {
            return finalizeSelection(found ? adoptConversation(found) : null);
          });
        }

        if (state.activeConversation) {
          return chatStore.getConversation(state.activeConversation.id).then(function (refetched) {
            return finalizeSelection(refetched ? adoptConversation(refetched) : null);
          });
        }

        return finalizeSelection(null);
      });
    }

    function createFreshConversation(initialReadings) {
      var ids = Array.isArray(initialReadings) ? initialReadings : [];
      var snaps = buildReadingSnapshots(ids);
      var title = deriveAutoTitle(ids, "");
      return chatStore.createConversation({
        title: title,
        archived: false,
        readingIds: ids,
        readingSnapshots: snaps,
        messages: []
      }).then(function (created) {
        state.activeTab = "active";
        state.activeConversation = created;
        return refreshConversationsList(created.id);
      });
    }

    function selectConversation(chatId) {
      if (state.streaming) return Promise.resolve();
      state.editingMessageId = "";
      return chatStore.getConversation(chatId).then(function (conv) {
        if (!conv) return;
        state.activeConversation = conv;
        updateStreamingUi();
        renderSidebar();
        renderContextHeader();
        renderMessages({ forceScroll: true });
      });
    }

    function handleNewChatClick() {
      if (state.streaming) return;
      var conv = state.activeConversation;
      if (
        conv
        && !conv.archived
        && (!conv.messages || conv.messages.length === 0)
        && (!conv.readingIds || conv.readingIds.length === 0)
      ) {
        setSidebarOpen(false);
        if (els.promptInput) els.promptInput.focus();
        return;
      }
      createFreshConversation([]).then(function () {
        setSidebarOpen(false);
        if (els.promptInput) els.promptInput.focus();
      });
    }

    function togglePin(chatId, nextPinned) {
      chatStore.setPinned(chatId, nextPinned).then(function () {
        return refreshConversationsList(state.activeConversation ? state.activeConversation.id : chatId);
      });
    }

    function toggleArchive(chatId, nextArchived) {
      if (state.streaming) return;
      chatStore.setArchived(chatId, nextArchived).then(function () {
        var remainingId = state.activeConversation && state.activeConversation.id === chatId
          ? ""
          : (state.activeConversation ? state.activeConversation.id : "");
        if (!remainingId) {
          state.activeConversation = null;
        }
        return refreshConversationsList(remainingId);
      });
    }

    function deleteChatWithConfirm(conv) {
      if (state.streaming || !conv) return;
      confirmAction({
        kicker: tr("ai.confirmKicker", null, "AI CHAT", "AI CHAT"),
        title: tr("ai.deleteChatTitle", null, "确认删除该对话？", "Delete this conversation?"),
        message: tr("ai.deleteChatMsg", { title: conv.title || tr("ai.untitledChat", null, "新解牌对话", "Untitled Chat") },
          "将永久移除「" + (conv.title || "新解牌对话") + "」中的所有提问与解牌记录，无法恢复。",
          "All messages in \"" + (conv.title || "Untitled Chat") + "\" will be permanently removed."),
        cancelLabel: tr("ai.cancel", null, "取消", "Cancel"),
        proceedLabel: tr("ai.delete", null, "删除", "Delete")
      }).then(function (confirmed) {
        if (!confirmed) return;
        chatStore.deleteConversation(conv.id).then(function () {
          if (state.activeConversation && state.activeConversation.id === conv.id) {
            state.activeConversation = null;
          }
          return refreshConversationsList();
        });
      });
    }

    function clearTabChatsWithConfirm() {
      if (state.streaming) return;
      var archivedOnly = state.activeTab === "archived";
      if (!archivedOnly && state.allCounts.active === 0) return;
      if (archivedOnly && state.allCounts.archived === 0) return;

      confirmAction({
        kicker: tr("ai.confirmKicker", null, "AI CHAT", "AI CHAT"),
        title: archivedOnly
          ? tr("ai.clearArchivedTitle", null, "清空所有已归档对话？", "Clear all archived chats?")
          : tr("ai.clearAllTitle", null, "清空当前进行中的对话？", "Clear all active chats?"),
        message: archivedOnly
          ? tr("ai.clearArchivedMsg", null, "此操作将删除所有已归档的 AI 对话，进行中的对话会保留。", "This permanently deletes all archived chats while keeping active ones.")
          : tr("ai.clearAllMsg", null, "此操作将清空所有进行中（非归档）对话，或建议先导出备份。", "This deletes all active conversations. Consider exporting a JSON backup first."),
        cancelLabel: tr("ai.cancel", null, "取消", "Cancel"),
        proceedLabel: tr("ai.clearConfirm", null, "确认清空", "Clear")
      }).then(function (confirmed) {
        if (!confirmed) return;
        if (archivedOnly) {
          return chatStore.clearConversations({ archivedOnly: true }).then(function () {
            if (state.activeConversation && state.activeConversation.archived) {
              state.activeConversation = null;
            }
            return refreshConversationsList();
          });
        }
        return chatStore.listConversations({ archived: false }).then(function (activeItems) {
          return Promise.all(activeItems.map(function (c) {
            return chatStore.deleteConversation(c.id);
          }));
        }).then(function () {
          state.activeConversation = null;
          return refreshConversationsList();
        });
      });
    }

    function openRenameDialog(conv) {
      if (!conv || !els.renameModal || !els.renameInput) return;
      els.renameModal.dataset.targetChatId = conv.id;
      els.renameInput.value = conv.title || "";
      openModal(els.renameModal, els.renameInput);
    }

    function commitRenameDialog() {
      if (!els.renameModal || !els.renameInput) return;
      var targetId = els.renameModal.dataset.targetChatId || "";
      var nextTitle = els.renameInput.value.trim();
      closeModal(els.renameModal);
      if (!targetId) return;
      chatStore.updateConversation(targetId, { title: nextTitle }, { touchUpdatedAt: false }).then(function () {
        return refreshConversationsList(state.activeConversation ? state.activeConversation.id : targetId);
      });
    }

    function removeAttachedReading(readingId) {
      var conv = state.activeConversation;
      if (!conv || state.streaming) return;
      var nextIds = (conv.readingIds || []).filter(function (id) { return id !== readingId; });
      var nextSnaps = (conv.readingSnapshots || []).filter(function (s) { return s.id !== readingId; });
      chatStore.updateConversation(conv.id, {
        readingIds: nextIds,
        readingSnapshots: nextSnaps
      }).then(function (updated) {
        state.activeConversation = updated;
        return refreshConversationsList(updated.id);
      });
    }

    function syncCustomSelects(scope) {
      var cs = global.DivinationCustomSelects;
      if (!cs) return;
      if (scope && typeof cs.refresh === "function") {
        cs.refresh(scope);
      } else if (typeof cs.sync === "function") {
        cs.sync();
      }
    }

    function ensureProfileFormatOptions() {
      if (!els.profileFormat) return;
      if (!els.profileFormat.options.length) {
        providers.FORMAT_IDS.forEach(function (fmt) {
          var opt = document.createElement("option");
          opt.value = fmt;
          opt.textContent = formatDisplayLabel(fmt);
          els.profileFormat.appendChild(opt);
        });
      } else {
        Array.prototype.forEach.call(els.profileFormat.options, function (opt) {
          opt.textContent = formatDisplayLabel(opt.value);
        });
      }
    }

    function openReadingsPicker() {
      if (state.streaming || !els.pickerModal) return;
      loadSelectableReadings().then(function () {
        var conv = state.activeConversation;
        state.pickerDraftIds = conv && Array.isArray(conv.readingIds) ? conv.readingIds.slice() : [];
        if (els.pickerSearchInput) els.pickerSearchInput.value = "";
        if (els.pickerDeckFilter) {
          els.pickerDeckFilter.value = "all";
          syncCustomSelects(els.pickerDeckFilter);
        }
        renderPickerList();
        openModal(els.pickerModal, els.pickerSearchInput);
      });
    }

    function renderPickerList() {
      if (!els.pickerList) return;
      var query = els.pickerSearchInput ? els.pickerSearchInput.value.trim().toLowerCase() : "";
      var deckFilter = els.pickerDeckFilter ? els.pickerDeckFilter.value : "all";
      var filtered = state.selectableReadings.filter(function (rec) {
        if (deckFilter !== "all" && rec.deckType !== deckFilter) return false;
        if (!query) return true;
        var resolved = contextApi.resolveReadingDetails(rec, {
          locale: currentLocale(),
          customLibrary: customLibrary
        });
        var hay = [
          rec.question || "",
          resolved ? resolved.spreadName : (rec.spreadNameSnapshot || ""),
          resolved ? resolved.cards.map(function (c) { return c.cardName; }).join(" ") : ""
        ].join(" ").toLowerCase();
        return hay.indexOf(query) !== -1;
      });

      if (els.pickerApplyBtn) {
        els.pickerApplyBtn.textContent = tr("ai.pickerApplyCount", { count: state.pickerDraftIds.length },
          "确定附加 (" + state.pickerDraftIds.length + ")",
          "Attach Selected (" + state.pickerDraftIds.length + ")");
      }

      if (filtered.length === 0) {
        var empty = document.createElement("p");
        empty.className = "ai-hint";
        empty.textContent = tr("ai.pickerEmpty", null,
          "没有找到可选的非自由画板占卜记录。请先在首页使用固定牌阵或自定义牌阵完成一次占卜并保存历史。",
          "No matching preset/custom reading found. Complete a non-freeboard reading first to attach it here.");
        els.pickerList.replaceChildren(empty);
        return;
      }

      var frag = document.createDocumentFragment();
      filtered.forEach(function (rec) {
        var resolved = contextApi.resolveReadingDetails(rec, {
          locale: currentLocale(),
          customLibrary: customLibrary
        });
        var summary = contextApi.buildReadingCardSummary(rec, {
          locale: currentLocale(),
          customLibrary: customLibrary
        });
        var checked = state.pickerDraftIds.indexOf(rec.id) !== -1;

        var label = document.createElement("label");
        label.className = "ai-picker-item" + (checked ? " is-checked" : "");

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.addEventListener("change", function () {
          var idx = state.pickerDraftIds.indexOf(rec.id);
          if (checkbox.checked && idx === -1) {
            state.pickerDraftIds.push(rec.id);
          } else if (!checkbox.checked && idx !== -1) {
            state.pickerDraftIds.splice(idx, 1);
          }
          label.classList.toggle("is-checked", checkbox.checked);
          if (els.pickerApplyBtn) {
            els.pickerApplyBtn.textContent = tr("ai.pickerApplyCount", { count: state.pickerDraftIds.length },
              "确定附加 (" + state.pickerDraftIds.length + ")",
              "Attach Selected (" + state.pickerDraftIds.length + ")");
          }
        });

        var body = document.createElement("div");
        body.className = "ai-picker-item-body";

        var title = document.createElement("div");
        title.className = "ai-picker-item-title";
        var baseTitle = (summary ? summary.spreadName : (resolved ? resolved.spreadName : (rec.spreadNameSnapshot || rec.spreadId)))
          + " · " + (summary ? summary.deckLabel : deckShortLabel(rec.deckType));
        if (summary && summary.modeBadge) {
          baseTitle += " (" + summary.modeBadge + ")";
        }
        title.textContent = baseTitle;

        var meta = document.createElement("div");
        meta.className = "ai-picker-item-meta";
        meta.textContent = ((summary && summary.createdText) || (resolved ? resolved.formattedTime : formatShortTime(rec.createdAt)))
          + (rec.question ? (" · " + rec.question) : "");

        var cards = document.createElement("div");
        cards.className = "ai-picker-item-cards";
        if (summary && summary.cardsPreview) {
          cards.textContent = summary.cardsPreview;
        } else if (resolved && resolved.cards.length > 0) {
          cards.textContent = resolved.cards.map(function (c) {
            return c.positionNumber + ". " + c.cardName + (c.orientation === "reversed" ? (isEnglishLocale() ? " (R)" : "(逆)") : "");
          }).join(" · ");
        }

        body.appendChild(title);
        body.appendChild(meta);
        body.appendChild(cards);
        label.appendChild(checkbox);
        label.appendChild(body);
        frag.appendChild(label);
      });

      els.pickerList.replaceChildren(frag);
    }

    function applyPickerSelection() {
      var conv = state.activeConversation;
      closeModal(els.pickerModal);
      if (!conv) return;
      var nextIds = state.pickerDraftIds.slice();
      var nextSnaps = buildReadingSnapshots(nextIds, conv.readingSnapshots);
      var nextTitle = conv.title || deriveAutoTitle(nextIds, "");
      chatStore.updateConversation(conv.id, {
        title: nextTitle,
        readingIds: nextIds,
        readingSnapshots: nextSnaps
      }).then(function (updated) {
        state.activeConversation = updated;
        return refreshConversationsList(updated.id);
      });
    }

    // Settings Modal
    function openSettingsModal() {
      if (!els.settingsModal) return;
      var cfg = configStore.load();
      state.settingsDraft = {
        activeProfileId: cfg.activeProfileId,
        profiles: cfg.profiles.map(function (p) { return Object.assign({}, p); })
      };
      if (state.settingsDraft.profiles.length === 0) {
        var starter = providers.createDefaultProfile("openai-chat", {
          name: "OpenAI"
        });
        state.settingsDraft.profiles.push(starter);
        state.settingsDraft.activeProfileId = starter.id;
      }
      state.keyVisible = false;
      setStatusText(els.settingsStatus, "", false);
      renderSettingsModal();
      openModal(els.settingsModal, els.profileApiKey);
    }

    function getDraftActiveProfile() {
      var draft = state.settingsDraft;
      if (!draft || !draft.profiles.length) return null;
      for (var i = 0; i < draft.profiles.length; i += 1) {
        if (draft.profiles[i].id === draft.activeProfileId) {
          return draft.profiles[i];
        }
      }
      draft.activeProfileId = draft.profiles[0].id;
      return draft.profiles[0];
    }

    function updateContextWindowHintUI(profileObj) {
      var target = profileObj || getDraftActiveProfile();
      if (!target) return;
      var inferred = providers.inferModelContextWindow(target.model, target.format);
      if (els.fieldContextWindow) {
        var autoBase = Number(target.detectedContextWindow) > 0
          ? Number(target.detectedContextWindow)
          : inferred.contextWindow;
        els.fieldContextWindow.placeholder = tr("ai.contextWindowAutoPlaceholder", {
          count: formatTokenCount(autoBase)
        },
        "自动识别（当前约 " + formatTokenCount(autoBase) + " tokens）",
        "Auto (" + formatTokenCount(autoBase) + " tokens)");
      }
      if (els.contextWindowHint) {
        var resolved = providers.resolveContextWindow(target);
        els.contextWindowHint.textContent = tr("ai.contextWindowStatus", {
          count: formatTokenCount(resolved.contextWindow),
          source: contextSourceLabel(resolved.source)
        },
        "当前生效上限：" + formatTokenCount(resolved.contextWindow) + " tokens（来源：" + contextSourceLabel(resolved.source) + "）",
        "Active window: " + formatTokenCount(resolved.contextWindow) + " tokens (" + contextSourceLabel(resolved.source) + ")");
      }
    }

    function findQuickPreset(id) {
      var list = providers && Array.isArray(providers.QUICK_PRESETS) ? providers.QUICK_PRESETS : [];
      for (var i = 0; i < list.length; i++) {
        if (list[i] && list[i].id === id) return list[i];
      }
      return null;
    }

    function quickPresetLabel(preset) {
      if (!preset) return "";
      return tr(preset.labelKey, null, preset.model || preset.id, preset.model || preset.id);
    }

    function markActiveQuickPreset(profileObj) {
      if (!els.presetRow) return;
      var chips = els.presetRow.querySelectorAll("[data-preset]");
      Array.prototype.forEach.call(chips, function (chip) {
        var preset = findQuickPreset(chip.getAttribute("data-preset"));
        var isActive = Boolean(preset && profileObj
          && profileObj.format === preset.format
          && (profileObj.baseUrl || "") === preset.baseUrl
          && (profileObj.model || "") === preset.model);
        chip.classList.toggle("is-active", isActive);
        chip.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
    }

    function applyQuickPreset(preset) {
      var active = getDraftActiveProfile();
      if (!active || !preset) return false;
      syncFormIntoDraft();
      active.name = quickPresetLabel(preset);
      active.format = preset.format;
      active.baseUrl = preset.baseUrl;
      active.model = preset.model;
      if (Number(preset.contextWindow) >= 1024) {
        active.contextWindow = Number(preset.contextWindow);
        active.contextWindowSource = "manual";
      }
      active.detectedContextWindow = null;
      renderSettingsModal();
      // renderSettingsModal() fills the inputs, but write the two fields the
      // preset is responsible for once more so a future render path can never
      // leave a stale name or context window behind.
      if (els.profileName) els.profileName.value = active.name;
      if (els.fieldContextWindow && Number(active.contextWindow) >= 1024) {
        els.fieldContextWindow.value = String(active.contextWindow);
      }
      setStatusText(els.settingsStatus, tr("ai.presetApplied", { preset: quickPresetLabel(preset) },
        "已填入 " + quickPresetLabel(preset) + " 预设，填写 API Key 后点保存即可。",
        "Filled the " + quickPresetLabel(preset) + " preset — add your API key, then save."), false);
      return true;
    }

    function syncFormIntoDraft() {
      var p = getDraftActiveProfile();
      if (!p) return;
      p.name = els.profileName ? els.profileName.value.trim() : p.name;
      p.format = els.profileFormat ? els.profileFormat.value : p.format;
      p.baseUrl = els.profileBaseUrl ? els.profileBaseUrl.value.trim() : p.baseUrl;
      p.apiKey = els.profileApiKey ? els.profileApiKey.value.trim() : p.apiKey;
      p.model = els.profileModel ? els.profileModel.value.trim() : p.model;
      p.vertexProject = els.profileVertexProject ? els.profileVertexProject.value.trim() : p.vertexProject;
      p.vertexLocation = els.profileVertexLocation ? els.profileVertexLocation.value.trim() : p.vertexLocation;
      p.temperature = els.profileTemperature && els.profileTemperature.value !== "" ? Number(els.profileTemperature.value) : null;
      p.maxTokens = els.profileMaxTokens && els.profileMaxTokens.value !== "" ? Math.round(Number(els.profileMaxTokens.value)) : null;
      if (els.fieldContextWindow) {
        var rawCtx = els.fieldContextWindow.value.trim();
        var numCtx = rawCtx !== "" ? Math.round(Number(rawCtx)) : 0;
        if (isFinite(numCtx) && numCtx >= 1024) {
          p.contextWindow = numCtx;
          p.contextWindowSource = "manual";
        } else {
          p.contextWindow = null;
          if (p.contextWindowSource === "manual") {
            p.contextWindowSource = p.detectedContextWindow > 0 ? "api" : "";
          }
        }
      }
      if (els.fieldAutoCompress) {
        p.autoCompress = Boolean(els.fieldAutoCompress.checked);
      }
    }

    function renderSettingsModal() {
      var draft = state.settingsDraft;
      if (!draft) return;
      var active = getDraftActiveProfile();

      if (els.profileList) {
        var frag = document.createDocumentFragment();
        draft.profiles.forEach(function (prof) {
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "ai-profile-tab" + (active && prof.id === active.id ? " is-selected" : "");
          btn.textContent = prof.name || prof.model || formatDisplayLabel(prof.format);
          btn.addEventListener("click", function () {
            syncFormIntoDraft();
            draft.activeProfileId = prof.id;
            renderSettingsModal();
          });
          frag.appendChild(btn);
        });
        els.profileList.replaceChildren(frag);
      }

      if (!active) return;

      if (els.profileName) els.profileName.value = active.name || "";
      if (els.profileFormat) {
        ensureProfileFormatOptions();
        els.profileFormat.value = active.format;
        syncCustomSelects(els.profileFormat);
      }
      if (els.profileBaseUrl) {
        els.profileBaseUrl.value = active.baseUrl || providers.DEFAULT_BASE_URLS[active.format] || "";
        els.profileBaseUrl.placeholder = providers.DEFAULT_BASE_URLS[active.format] || "";
      }
      if (els.profileApiKey) {
        els.profileApiKey.type = state.keyVisible ? "text" : "password";
        els.profileApiKey.value = active.apiKey || "";
      }
      if (els.toggleKeyBtn) {
        els.toggleKeyBtn.textContent = state.keyVisible
          ? tr("ai.hideKey", null, "隐藏", "Hide")
          : tr("ai.showKey", null, "显示", "Show");
      }
      if (els.profileModel) {
        els.profileModel.value = active.model || providers.DEFAULT_MODELS[active.format] || "";
        els.profileModel.placeholder = providers.DEFAULT_MODELS[active.format] || "";
      }
      if (els.vertexGroup) {
        els.vertexGroup.hidden = active.format !== "gemini-vertex";
      }
      if (els.profileVertexProject) els.profileVertexProject.value = active.vertexProject || "";
      if (els.profileVertexLocation) els.profileVertexLocation.value = active.vertexLocation || "";
      if (els.profileTemperature) els.profileTemperature.value = active.temperature !== null && active.temperature !== undefined ? String(active.temperature) : "";
      if (els.profileMaxTokens) els.profileMaxTokens.value = active.maxTokens !== null && active.maxTokens !== undefined ? String(active.maxTokens) : "";
      if (els.fieldContextWindow) {
        els.fieldContextWindow.value = Number(active.contextWindow) >= 1024 ? String(active.contextWindow) : "";
      }
      if (els.fieldAutoCompress) {
        els.fieldAutoCompress.checked = active.autoCompress !== false;
      }
      updateContextWindowHintUI(active);
      if (els.formatHint) els.formatHint.textContent = formatHintText(active.format);
      markActiveQuickPreset(active);
      if (els.profileDeleteBtn) els.profileDeleteBtn.disabled = draft.profiles.length <= 1;
    }

    function formatValidationError(errors) {
      var labels = errors.map(function (code) {
        if (code === "missing_api_key") return tr("ai.err.missingKey", null, "请填写 API Key", "API Key is required");
        if (code === "missing_model") return tr("ai.err.missingModel", null, "请填写模型名称", "Model name is required");
        if (code === "insecure_http_url") return tr("ai.err.insecureUrl", null, "除本机 localhost 外 Base URL 必须使用 https://", "Base URL must use https:// (except localhost)");
        return tr("ai.err.invalidUrl", null, "Base URL 格式无效", "Invalid Base URL");
      });
      return labels.join("；");
    }

    function maybeProbeActiveProfileContextWindow() {
      var active = configStore.getActiveProfile();
      if (!active || !providers.validateProfile(active).ok) return;
      if (Number(active.contextWindow) >= 1024 || active.contextWindowSource === "api") return;
      providers.fetchModelContextWindow(active).then(function (res) {
        if (!res || !res.live || !(res.contextWindow > 0)) return;
        var latest = configStore.getActiveProfile();
        if (!latest || latest.id !== active.id || latest.model !== active.model) return;
        configStore.upsertProfile(Object.assign({}, latest, {
          detectedContextWindow: res.contextWindow,
          contextWindowSource: Number(latest.contextWindow) >= 1024 ? "manual" : "api"
        }), true);
        renderContextMeter();
      }).catch(function () {
        // Best-effort probe; catalog estimate stays active
      });
    }

    function detectContextWindowFromModal() {
      syncFormIntoDraft();
      var active = getDraftActiveProfile();
      if (!active) return;
      var draftAtStart = state.settingsDraft;
      var normalized = providers.normalizeProfile(active);
      setStatusText(els.settingsStatus, tr("ai.detectingContext", null, "正在获取模型上下文窗口大小…", "Detecting model context window…"), false);
      if (els.detectContextBtn) els.detectContextBtn.disabled = true;

      providers.fetchModelContextWindow(normalized).then(function (res) {
        // Ignore responses for a profile or form that changed while probing.
        if (state.settingsDraft !== draftAtStart || getDraftActiveProfile() !== active) return;
        syncFormIntoDraft();
        var current = providers.normalizeProfile(active);
        var unchanged = ["format", "baseUrl", "apiKey", "model", "vertexProject", "vertexLocation", "contextWindow"]
          .every(function (key) { return current[key] === normalized[key]; });
        if (!unchanged) {
          setStatusText(els.settingsStatus, tr("ai.detectContextChanged", null,
            "配置已更改，请重新获取上下文窗口。",
            "Configuration changed. Detect the context window again."), false);
          return;
        }
        var known = res && res.contextWindow > 0 && (res.live === true || res.source === "catalog");
        if (known) {
          active.contextWindow = null;
          if (els.fieldContextWindow) els.fieldContextWindow.value = "";
          active.detectedContextWindow = res.live === true ? res.contextWindow : null;
          active.contextWindowSource = res.live === true ? "api" : "auto";
        }
        // An unknown-model fallback must never erase a manual or API limit.
        updateContextWindowHintUI(active);
        var resolved = providers.resolveContextWindow(active);
        var vars = { count: formatTokenCount(resolved.contextWindow), source: contextSourceLabel(resolved.source) };
        var status;
        if (!known) {
          status = tr("ai.detectContextUnknown", vars,
            "未能识别此模型的上下文窗口。当前使用 {count} tokens（{source}）；请按服务商说明手动填写。",
            "Could not identify this model's context window. Using {count} tokens ({source}); enter the provider's limit manually.");
        } else if (res.live === true) {
          status = tr("ai.detectContextDone", vars,
            "已从接口获取上下文窗口：{count} tokens",
            "Context window fetched from API: {count} tokens");
        } else {
          status = tr("ai.detectContextCatalog", vars,
            "接口未返回上下文长度，已使用模型目录：{count} tokens。代理限制可能不同，可手动覆盖。",
            "The API did not return a context limit. Using the model catalog: {count} tokens. Proxy limits may differ; you can override this manually.");
        }
        setStatusText(els.settingsStatus, status, !known);
        renderContextMeter();
      }).catch(function (err) {
        setStatusText(els.settingsStatus, formatProviderError(err), true);
      }).finally(function () {
        if (els.detectContextBtn) els.detectContextBtn.disabled = false;
      });
    }

    function clearSavedConfigWithConfirm() {
      confirmAction({
        kicker: tr("ai.confirmKicker", null, "AI 对话", "AI CHAT"),
        title: tr("ai.clearConfigTitle", null, "清除已保存的 API 密钥？", "Clear saved API keys?"),
        message: tr("ai.clearConfigMsg", null, "将从当前设备本地存储中移除所有已保存的模型配置与 API Key，聊天记录不受影响。", "This removes all saved model profiles and API keys from local storage on this device. Chat history is preserved."),
        cancelLabel: tr("ai.cancel", null, "取消", "Cancel"),
        proceedLabel: tr("ai.clearConfigConfirm", null, "确认清除", "Clear Keys")
      }).then(function (confirmed) {
        if (!confirmed) return;
        configStore.clear();
        var starter = providers.createDefaultProfile("openai-chat", {
          name: "OpenAI"
        });
        state.settingsDraft = {
          activeProfileId: starter.id,
          profiles: [starter]
        };
        state.keyVisible = false;
        renderSettingsModal();
        updateProfileIndicator();
        renderContextMeter();
        setStatusText(els.settingsStatus, tr("ai.configCleared", null, "已从本地存储清除所有模型配置与 API Key。", "Cleared all saved model profiles and API keys from local storage."), false);
      });
    }

    function saveSettingsFromModal() {
      syncFormIntoDraft();
      var active = getDraftActiveProfile();
      if (!active) return;
      var normalized = providers.normalizeProfile(active);
      var check = providers.validateProfile(normalized);
      if (!check.ok) {
        setStatusText(els.settingsStatus, formatValidationError(check.errors), true);
        return;
      }
      var nextProfiles = state.settingsDraft.profiles.map(function (p) {
        return providers.normalizeProfile(p);
      });
      configStore.save({
        version: 1,
        activeProfileId: normalized.id,
        profiles: nextProfiles
      });
      updateProfileIndicator();
      renderContextMeter();
      setStatusText(els.settingsStatus, tr("ai.settingsSaved", null, "配置已持久保存并设为当前启用方案。", "Configuration saved and activated."), false);
      closeModal(els.settingsModal);
      maybeProbeActiveProfileContextWindow();
    }

    function runConnectionTest() {
      syncFormIntoDraft();
      var active = getDraftActiveProfile();
      if (!active) return;
      var normalized = providers.normalizeProfile(active);
      var check = providers.validateProfile(normalized);
      if (!check.ok) {
        setStatusText(els.settingsStatus, formatValidationError(check.errors), true);
        return;
      }
      setStatusText(els.settingsStatus, tr("ai.testingConnection", null, "正在测试接口连接…", "Testing connection…"), false);
      if (els.testConnectionBtn) els.testConnectionBtn.disabled = true;

      Promise.all([
        providers.testConnection(normalized),
        providers.fetchModelContextWindow(normalized)
      ]).then(function (results) {
        var res = results[0];
        var ctxRes = results[1];
        if (ctxRes && ctxRes.contextWindow > 0) {
          if (ctxRes.live === true) {
            active.detectedContextWindow = ctxRes.contextWindow;
            if (!active.contextWindow) {
              active.contextWindowSource = "api";
            }
          } else {
            active.detectedContextWindow = null;
            if (!active.contextWindow) {
              active.contextWindowSource = ctxRes.source || "";
            }
          }
          updateContextWindowHintUI(active);
        }
        setStatusText(els.settingsStatus, tr("ai.testSuccess", { model: res.model },
          "连接成功（" + res.model + "），可保存使用。",
          "Connection succeeded (" + res.model + "). Ready to save."), false);
      }).catch(function (err) {
        setStatusText(els.settingsStatus, formatProviderError(err), true);
      }).finally(function () {
        if (els.testConnectionBtn) els.testConnectionBtn.disabled = false;
      });
    }

    function formatProviderError(err) {
      if (!err) return tr("ai.err.unknown", null, "请求失败", "Request failed");
      if (err.code === "output_truncated") {
        return tr("ai.err.truncated", null, "已达到模型输出上限，回答可能不完整。可以继续追问，或在 API 设置中提高最大输出 Token。", "The model reached its output limit, so the answer may be incomplete. Ask it to continue or increase the output token limit in API settings.");
      }
      if (err.code === "response_incomplete") {
        return tr("ai.err.incomplete", null, "连接在回答完成前结束，已保留收到的内容。请重试或继续追问。", "The connection ended before the response finished. Any received text has been kept. Retry or ask it to continue.");
      }
      if (err.code === "content_blocked") {
        return tr("ai.err.blocked", null, "模型的内容策略拦截了本次回答，已保留收到的内容。请调整问题后重试。", "The provider blocked this response under its content policy. Any received text has been kept. Revise your question and retry.");
      }
      if (err.code === "invalid_response") {
        return tr("ai.err.invalidResponse", { detail: err.message },
          "接口返回了无法识别的响应，请检查接口地址或中转服务：" + err.message,
          "The endpoint returned an invalid response. Check its URL or proxy service: " + err.message);
      }
      if (err.code === "auth_error") {
        return tr("ai.err.auth", { detail: err.message },
          "鉴权失败，请检查 API Key、模型权限或 Vertex 接口设置：" + err.message,
          "Authentication failed. Verify your API key and endpoint permissions: " + err.message);
      }
      if (err.code === "rate_limit") {
        return tr("ai.err.rateLimit", { detail: err.message },
          "触发频率或配额限制，请稍后重试：" + err.message,
          "Rate limit or quota reached: " + err.message);
      }
      if (err.code === "network_error") {
        return tr("ai.err.network", { detail: err.message },
          "网络或跨域请求失败，请检查网络、Base URL（HTTPS）或中转站 CORS 配置：" + err.message,
          "Network or CORS error. Check connectivity, HTTPS Base URL, or proxy CORS headers: " + err.message);
      }
      return err.message || String(err);
    }

    function aiUsageObserver(model, kind) {
      return global.DivinationAiTelemetry && typeof global.DivinationAiTelemetry.createObserver === "function"
        ? global.DivinationAiTelemetry.createObserver(model, kind) : {};
    }

    // Streaming chat pipeline
    function runGeneration(conversationSnapshot, assistantMsgIndex) {
      var profile = configStore.getActiveProfile();
      var check = profile ? providers.validateProfile(profile) : { ok: false, errors: ["missing_api_key"] };
      if (!check.ok) {
        finishStreamingUi();
        openSettingsModal();
        return Promise.resolve();
      }

      var conv = conversationSnapshot;
      var payload = buildPromptPayloadForConversation(conv, assistantMsgIndex);
      var ctxResolved = providers.resolveContextWindow(profile);
      var reserveOut = Number(profile.maxTokens) > 0
        ? Math.min(Number(profile.maxTokens), Math.floor(ctxResolved.contextWindow * 0.5))
        : Math.min(4096, Math.floor(ctxResolved.contextWindow * 0.2));
      var inputBudget = Math.max(2048, ctxResolved.contextWindow - reserveOut);

      state.streaming = true;
      state.compressing = false;
      state.editingMessageId = "";
      state.abortController = state.abortController
        || (typeof AbortController === "function" ? new AbortController() : null);
      state.activeStreamContext = {
        conv: conv,
        assistantMsgIndex: assistantMsgIndex,
        profileId: profile.id
      };
      updateStreamingUi();

      var prepPromise = Promise.resolve(payload);
      if (
        profile.autoCompress !== false
        && payload.estimatedTokens >= Math.floor(inputBudget * 0.75)
        && payload.validMessages.length > 4
      ) {
        var keepCount = Math.min(4, Math.max(2, payload.validMessages.length - 2));
        var splitAt = payload.validMessages.length - keepCount;
        if (payload.validMessages[splitAt] && payload.validMessages[splitAt].role !== "user") {
          if (splitAt + 1 <= payload.validMessages.length - 2 && payload.validMessages[splitAt + 1].role === "user") {
            splitAt += 1;
          } else if (splitAt - 1 >= 2 && payload.validMessages[splitAt - 1].role === "user") {
            splitAt -= 1;
          }
        }
        var toCompress = payload.validMessages.slice(0, splitAt);
        var prevCompressedCount = conv.contextSummary ? (Number(conv.contextSummary.compressedCount) || 0) : 0;
        var prevCoveredId = conv.contextSummary ? conv.contextSummary.coveredUntilId : "";
        var coveredCountBefore = payload.summaryText ? prevCompressedCount : 0;

        if (toCompress.length > 0) {
          state.compressing = true;
          renderContextMeter();
          prepPromise = providers.compressMessages(profile, Object.assign(aiUsageObserver(profile.model, "compression"), {
            previousSummary: payload.summaryText,
            messages: toCompress,
            locale: currentLocale(),
            signal: state.abortController ? state.abortController.signal : undefined
          })).catch(function (compErr) {
            if (compErr && compErr.code === "aborted") {
              throw compErr;
            }
            return {
              summaryText: buildFallbackSummaryDigest(payload.summaryText, toCompress, isEnglishLocale()),
              usage: null
            };
          }).then(function (compRes) {
            var nextSummaryText = compRes && compRes.summaryText ? compRes.summaryText.trim() : "";
            if (!nextSummaryText) {
              nextSummaryText = buildFallbackSummaryDigest(payload.summaryText, toCompress, isEnglishLocale());
            }
            var coveredUntilId = toCompress[toCompress.length - 1].id || prevCoveredId;
            if (nextSummaryText) {
              var addedRawCount = 0;
              for (var tc = 0; tc < toCompress.length; tc += 1) {
                addedRawCount += Number(toCompress[tc].rawCount) > 0 ? Number(toCompress[tc].rawCount) : 1;
              }
              conv.contextSummary = {
                text: nextSummaryText,
                coveredUntilId: coveredUntilId,
                compressedCount: coveredCountBefore + addedRawCount,
                updatedAt: Date.now()
              };
              return buildPromptPayloadForConversation(conv, assistantMsgIndex);
            }
            return payload;
          }).finally(function () {
            state.compressing = false;
            renderContextMeter();
          });
        }
      }

      var pendingFrame = null;
      function scheduleRender() {
        if (pendingFrame) return;
        pendingFrame = setTimeout(function () {
          pendingFrame = null;
          patchStreamingMessageDom(conv, assistantMsgIndex);
        }, 60);
      }

      return prepPromise.then(function (readyPayload) {
        var hardCap = Math.floor(inputBudget * 0.94);
        var finalMessages = truncateMessagesToBudget(
          readyPayload.apiMessages,
          readyPayload.systemPrompt,
          hardCap,
          contextApi.estimateConversationTokens
        );
        return providers.streamChat(profile, Object.assign(aiUsageObserver(profile.model, "conversation"), {
          systemPrompt: readyPayload.systemPrompt,
          messages: finalMessages,
          signal: state.abortController ? state.abortController.signal : undefined,
          onDelta: function (_delta, fullText) {
            var targetMsg = conv.messages[assistantMsgIndex];
            if (targetMsg) {
              targetMsg.content = fullText;
              scheduleRender();
            }
          },
          onReasoning: function (_delta, fullReasoning) {
            var targetMsg = conv.messages[assistantMsgIndex];
            if (targetMsg) {
              targetMsg.reasoning = fullReasoning;
              scheduleRender();
            }
          }
        }));
      }).then(function (result) {
        if (pendingFrame) {
          clearTimeout(pendingFrame);
          pendingFrame = null;
        }
        var targetMsg = conv.messages[assistantMsgIndex];
        if (targetMsg) {
          targetMsg.content = result.text || "";
          targetMsg.reasoning = result.reasoning || "";
          targetMsg.error = result.completionStatus === "truncated"
            ? formatProviderError({ code: result.finishReason === "stream_closed" ? "response_incomplete" : "output_truncated" })
            : (result.completionStatus === "blocked" ? formatProviderError({ code: "content_blocked" }) : "");
          targetMsg.model = profile.model;
          targetMsg.format = profile.format;
        }
        if (result && result.usage) {
          conv.lastUsage = {
            inputTokens: result.usage.inputTokens || 0,
            outputTokens: result.usage.outputTokens || 0,
            totalTokens: result.usage.totalTokens || 0,
            updatedAt: Date.now()
          };
        }
      }).catch(function (err) {
        if (pendingFrame) {
          clearTimeout(pendingFrame);
          pendingFrame = null;
        }
        var targetMsg = conv.messages[assistantMsgIndex];
        if (targetMsg) {
          if (err && err.code === "aborted") {
            if (!targetMsg.content) {
              targetMsg.error = tr("ai.stoppedEmpty", null, "已停止生成。", "Generation stopped.");
            }
          } else {
            targetMsg.error = formatProviderError(err);
          }
        }
      }).finally(function () {
        state.activeStreamContext = null;
        var coveredIndex = conv.contextSummary
          ? conv.messages.findIndex(function (m) { return m.id === conv.contextSummary.coveredUntilId; }) : -1;
        return chatStore.completeMessage(conv.id, conv.messages[assistantMsgIndex], {
          profileId: profile.id,
          contextSummary: conv.contextSummary || null,
          summaryMessages: coveredIndex >= 0 ? conv.messages.slice(0, coveredIndex + 1) : null,
          lastUsage: conv.lastUsage || null
        }).then(function (saved) {
          finishStreamingUi();
          state.activeConversation = saved;
          return refreshConversationsList(saved ? saved.id : "");
        }, function (err) {
          handleConversationWriteError(err);
        });
      });
    }

    function sendUserPrompt() {
      if (state.streaming) return;
      var text = els.promptInput ? els.promptInput.value.trim() : "";
      if (!text) return;

      var profile = configStore.getActiveProfile();
      if (!profile || !providers.validateProfile(profile).ok) {
        openSettingsModal();
        return;
      }

      if (els.promptInput) els.promptInput.value = "";
      var now = Date.now();
      var userMsg = chatStoreApi.normalizeMessage({ role: "user", content: text, createdAt: now });
      var assistantMsg = chatStoreApi.normalizeMessage({
        role: "assistant",
        content: "",
        reasoning: "",
        model: profile.model,
        format: profile.format,
        createdAt: now + 1
      });
      var conv = state.activeConversation;
      startStreamingUi();

      var ensureConvPromise = conv
        ? Promise.resolve(conv)
        : chatStore.createConversation({
          title: deriveAutoTitle([], text),
          archived: false,
          readingIds: [],
          readingSnapshots: [],
          messages: []
        }).then(function (created) {
          state.activeTab = "active";
          state.searchQuery = "";
          if (els.chatSearchInput) els.chatSearchInput.value = "";
          state.activeConversation = created;
          return created;
        });

      ensureConvPromise.then(function (targetConv) {
        var nextTitle = targetConv.title || deriveAutoTitle(targetConv.readingIds, text);
        return chatStore.appendMessages(targetConv.id, [userMsg, assistantMsg], {
          title: nextTitle,
          profileId: profile.id
        });
      }).then(function (saved) {
        if (!saved) {
          var missing = new Error("Conversation was deleted");
          missing.code = "conversation_conflict";
          throw missing;
        }
        state.activeConversation = saved;
        renderSidebar();
        renderContextHeader();
        renderMessages({ forceScroll: true });
        return runGeneration(saved, saved.messages.length - 1);
      }).catch(function (err) { handleConversationWriteError(err, text); });
    }

    function regenerateFromIndex(assistantIndex) {
      if (state.streaming) return;
      var conv = state.activeConversation;
      if (!conv || !conv.messages || assistantIndex < 0 || assistantIndex >= conv.messages.length) return;
      if (!conv.messages[assistantIndex] || conv.messages[assistantIndex].role !== "assistant") return;
      if (!hasPrecedingUserTurn(conv.messages, assistantIndex)) return;
      var profile = configStore.getActiveProfile();
      if (!profile || !providers.validateProfile(profile).ok) {
        openSettingsModal();
        return;
      }

      var lastUserIdx = -1;
      for (var u = assistantIndex - 1; u >= 0; u -= 1) {
        if (conv.messages[u] && conv.messages[u].role === "user" && conv.messages[u].content) {
          lastUserIdx = u;
          break;
        }
      }
      if (lastUserIdx === -1) return;

      var nextSummary = conv.contextSummary || null;
      if (nextSummary) {
        var coveredIdx = -1;
        for (var c = 0; c < assistantIndex; c += 1) {
          if (conv.messages[c].id === nextSummary.coveredUntilId) {
            coveredIdx = c;
            break;
          }
        }
        if (!nextSummary.coveredUntilId || coveredIdx === -1 || coveredIdx >= lastUserIdx) {
          nextSummary = null;
        }
      }

      var kept = conv.messages.slice(0, assistantIndex);
      var newAssistant = chatStoreApi.normalizeMessage({
        role: "assistant",
        content: "",
        reasoning: "",
        model: profile.model,
        format: profile.format,
        createdAt: Date.now()
      });
      kept.push(newAssistant);

      startStreamingUi();
      chatStore.updateConversation(conv.id, {
        messages: kept,
        contextSummary: nextSummary,
        profileId: profile.id
      }, { expectedMessages: conv.messages }).then(function (saved) {
        if (!saved) {
          var missing = new Error("Conversation was deleted");
          missing.code = "conversation_conflict";
          throw missing;
        }
        state.activeConversation = saved;
        renderMessages({ forceScroll: true });
        return runGeneration(saved, saved.messages.length - 1);
      }).catch(function (err) { handleConversationWriteError(err); });
    }

    function commitEditAndResend(msgId, newContent) {
      if (state.streaming) return;
      var conv = state.activeConversation;
      var clean = String(newContent || "").trim();
      if (!conv || !clean) return;

      var idx = -1;
      for (var i = 0; i < conv.messages.length; i += 1) {
        if (conv.messages[i].id === msgId) {
          idx = i;
          break;
        }
      }
      if (idx === -1) return;

      var profile = configStore.getActiveProfile();
      if (!profile || !providers.validateProfile(profile).ok) {
        openSettingsModal();
        return;
      }

      var nextSummary = conv.contextSummary || null;
      if (nextSummary) {
        var coveredIdx = -1;
        for (var c = 0; c < conv.messages.length; c += 1) {
          if (conv.messages[c].id === nextSummary.coveredUntilId) {
            coveredIdx = c;
            break;
          }
        }
        if (!nextSummary.coveredUntilId || coveredIdx === -1 || idx <= coveredIdx) {
          nextSummary = null;
        }
      }

      var kept = conv.messages.slice(0, idx);
      kept.push(chatStoreApi.normalizeMessage({
        id: msgId,
        role: "user",
        content: clean,
        createdAt: Date.now()
      }));
      kept.push(chatStoreApi.normalizeMessage({
        role: "assistant",
        content: "",
        reasoning: "",
        model: profile.model,
        format: profile.format,
        createdAt: Date.now() + 1
      }));
      state.editingMessageId = "";

      startStreamingUi();
      chatStore.updateConversation(conv.id, {
        messages: kept,
        contextSummary: nextSummary,
        profileId: profile.id
      }, { expectedMessages: conv.messages }).then(function (saved) {
        if (!saved) {
          var missing = new Error("Conversation was deleted");
          missing.code = "conversation_conflict";
          throw missing;
        }
        state.activeConversation = saved;
        renderMessages({ forceScroll: true });
        return runGeneration(saved, saved.messages.length - 1);
      }).catch(function (err) { handleConversationWriteError(err); });
    }

    function deleteMessageWithConfirm(msgId) {
      if (state.streaming || !state.activeConversation) return;
      confirmAction({
        kicker: tr("ai.confirmKicker", null, "AI CHAT", "AI CHAT"),
        title: tr("ai.deleteMsgTitle", null, "删除这条消息？", "Delete this message?"),
        message: tr("ai.deleteMsgDesc", null, "确认将该条发言从本地聊天记录中移除吗？", "Remove this message from local chat history?"),
        cancelLabel: tr("ai.cancel", null, "取消", "Cancel"),
        proceedLabel: tr("ai.delete", null, "删除", "Delete")
      }).then(function (ok) {
        if (!ok || !state.activeConversation) return;
        chatStore.deleteMessage(state.activeConversation.id, msgId).then(function (saved) {
          if (!saved) return null;
          state.activeConversation = saved;
          return refreshConversationsList(saved.id);
        });
      });
    }

    function exportActiveConversationMarkdown() {
      var conv = state.activeConversation;
      if (!conv) return;
      try {
        var md = chatStoreApi.formatConversationMarkdown(conv, { locale: currentLocale() });
        var stamp = new Date().toISOString().slice(0, 10);
        triggerFileDownload(md, "quareia-ai-reading-" + stamp + ".md", "text/markdown;charset=utf-8");
      } catch (_err) {
        if (typeof global.__quareiaHistoryExportResult === "function") {
          global.__quareiaHistoryExportResult({ ok: false });
        }
      }
    }

    function exportAllChatsBackup() {
      if (state.streaming) return;
      chatStore.exportBackup().then(function (backup) {
        var json = JSON.stringify(backup, null, 2);
        var stamp = new Date().toISOString().slice(0, 10);
        if (new Blob([json]).size > chatStoreApi.MAX_BACKUP_BYTES) {
          return confirmAction({
            kicker: tr("ai.backupKicker", null, "AI BACKUP", "AI BACKUP"),
            title: tr("ai.archiveTooLargeTitle", null, "备份超过导入上限", "Backup exceeds the import limit"),
            message: tr("ai.archiveTooLargeMsg", null,
              "全部对话的 JSON 备份超过 8 MiB，无法通过本页面恢复。可改为导出全部对话的 Markdown 存档，保留聊天正文、回答提示与占卜摘要供阅读。Markdown 存档不能导入聊天列表。",
              "The JSON backup exceeds the 8 MiB import limit and cannot be restored here. You can instead export all transcripts, response notices and reading summaries as a readable Markdown archive. This archive cannot be imported into the chat list."),
            cancelLabel: tr("ai.cancel", null, "取消", "Cancel"),
            proceedLabel: tr("ai.exportArchive", null, "导出 Markdown 存档", "Export Markdown Archive")
          }).then(function (confirmed) {
            if (!confirmed) return;
            var archive = backup.conversations.map(function (conv) {
              return chatStoreApi.formatConversationMarkdown(conv, { locale: currentLocale() });
            }).join("\n---\n\n");
            triggerFileDownload(archive, "quareia-ai-archive-" + stamp + ".md", "text/markdown;charset=utf-8");
          });
        }
        triggerFileDownload(json, "quareia-ai-chats-" + stamp + ".json", "application/json;charset=utf-8");
      }).catch(function () {
        if (typeof global.__quareiaHistoryExportResult === "function") {
          global.__quareiaHistoryExportResult({ ok: false });
        }
      });
    }

    function showBackupImportError(err) {
      if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
        return global.DivinationDialog.request({
          kicker: tr("ai.backupKicker", null, "AI BACKUP", "AI BACKUP"),
          title: tr("ai.importErrTitle", null, "导入失败", "Import Failed"),
          message: err && err.code === "backup_too_large"
            ? tr("ai.importTooLarge", null, "AI 对话备份不能超过 8 MiB。请选择较小的备份文件。", "AI chat backups must be 8 MiB or smaller. Choose a smaller backup file.")
            : tr("ai.importErrMsg", null, "文件格式不匹配，请选择本站导出的 AI 对话 JSON 备份文件。", "Invalid backup file format. Choose an AI chat JSON backup exported from this app."),
          cancelLabel: tr("ai.close", null, "关闭", "Close"),
          proceedLabel: tr("ai.ok", null, "确定", "OK")
        });
      }
      return Promise.resolve();
    }

    function importChatsBackup(event) {
      var file = event.target && event.target.files && event.target.files[0];
      if (event.target) event.target.value = "";
      if (state.streaming || !file) return;
      if (file.size > chatStoreApi.MAX_BACKUP_BYTES) {
        showBackupImportError({ code: "backup_too_large" });
        return;
      }
      file.text().then(function (raw) {
        return chatStore.importBackup(raw, { mode: "merge" });
      }).then(function (res) {
        return refreshConversationsList().then(function () {
          if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
            return global.DivinationDialog.request({
              kicker: tr("ai.backupKicker", null, "AI BACKUP", "AI BACKUP"),
              title: tr("ai.importDoneTitle", null, "导入完成", "Import Complete"),
              message: tr("ai.importDoneMsg", { imported: res.importedCount, total: res.totalCount },
                "已成功合并导入 " + res.importedCount + " 段对话（当前共 " + res.totalCount + " 段）。",
                "Merged " + res.importedCount + " conversations (" + res.totalCount + " total)."),
              cancelLabel: tr("ai.close", null, "关闭", "Close"),
              proceedLabel: tr("ai.ok", null, "知道了", "OK")
            });
          }
          return null;
        });
      }).catch(showBackupImportError);
    }

    // Event Bindings
    if (els.sidebarToggle) {
      els.sidebarToggle.addEventListener("click", function () { setSidebarOpen(!state.sidebarOpen); });
    }
    if (els.sidebarClose) {
      els.sidebarClose.addEventListener("click", function () { setSidebarOpen(false); });
    }
    if (els.sidebarBackdrop) {
      els.sidebarBackdrop.addEventListener("click", function () { setSidebarOpen(false); });
    }
    if (els.activeProfileBtn) els.activeProfileBtn.addEventListener("click", openSettingsModal);
    if (els.settingsBtn) els.settingsBtn.addEventListener("click", openSettingsModal);
    if (els.bannerSettingsBtn) els.bannerSettingsBtn.addEventListener("click", openSettingsModal);
    if (els.bannerPickBtn) els.bannerPickBtn.addEventListener("click", openReadingsPicker);
    if (els.newChatBtn) els.newChatBtn.addEventListener("click", handleNewChatClick);

    if (els.chatSearchInput) {
      els.chatSearchInput.addEventListener("input", function () {
        state.searchQuery = els.chatSearchInput.value.trim();
        refreshConversationsList(state.activeConversation ? state.activeConversation.id : "");
      });
    }
    if (els.tabActive) {
      els.tabActive.addEventListener("click", function () {
        state.activeTab = "active";
        refreshConversationsList(state.activeConversation ? state.activeConversation.id : "");
      });
    }
    if (els.tabArchived) {
      els.tabArchived.addEventListener("click", function () {
        state.activeTab = "archived";
        refreshConversationsList(state.activeConversation ? state.activeConversation.id : "");
      });
    }

    if (els.exportBackupBtn) els.exportBackupBtn.addEventListener("click", exportAllChatsBackup);
    if (els.storageExportBtn) els.storageExportBtn.addEventListener("click", exportAllChatsBackup);
    if (els.importBackupBtn && els.importFileInput) {
      els.importBackupBtn.addEventListener("click", function () {
        if (state.streaming) return;
        els.importFileInput.click();
      });
      els.importFileInput.addEventListener("change", importChatsBackup);
    }
    if (els.clearChatsBtn) els.clearChatsBtn.addEventListener("click", clearTabChatsWithConfirm);

    if (els.themeBtn && els.themePopover) {
      els.themeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        setThemePopoverOpen(!state.themePopoverOpen);
      });
      els.themePopover.addEventListener("click", function (e) {
        if (e.target && typeof e.target.closest === "function" && e.target.closest(".theme-swatch")) {
          setThemePopoverOpen(false);
        }
      });
      document.addEventListener("click", function (e) {
        if (!state.themePopoverOpen) return;
        if (e.target && typeof e.target.closest === "function" && e.target.closest(".ai-theme-wrap")) {
          return;
        }
        setThemePopoverOpen(false);
      });
    }

    if (els.pickReadingsBtn) els.pickReadingsBtn.addEventListener("click", openReadingsPicker);
    if (els.renameChatBtn) {
      els.renameChatBtn.addEventListener("click", function () {
        if (state.activeConversation) openRenameDialog(state.activeConversation);
      });
    }
    if (els.exportMdBtn) els.exportMdBtn.addEventListener("click", exportActiveConversationMarkdown);
    if (els.archiveChatBtn) {
      els.archiveChatBtn.addEventListener("click", function () {
        if (state.activeConversation) {
          toggleArchive(state.activeConversation.id, !state.activeConversation.archived);
        }
      });
    }
    if (els.deleteChatBtn) {
      els.deleteChatBtn.addEventListener("click", function () {
        if (state.activeConversation) deleteChatWithConfirm(state.activeConversation);
      });
    }

    if (els.sendBtn) els.sendBtn.addEventListener("click", sendUserPrompt);
    if (els.stopBtn) {
      els.stopBtn.addEventListener("click", function () {
        if (state.abortController) state.abortController.abort();
      });
    }
    if (els.promptInput) {
      els.promptInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          sendUserPrompt();
        }
      });
    }

    // Picker Modal bindings
    if (els.pickerCloseBtn) els.pickerCloseBtn.addEventListener("click", function () { closeModal(els.pickerModal); });
    if (els.pickerSearchInput) els.pickerSearchInput.addEventListener("input", renderPickerList);
    if (els.pickerDeckFilter) els.pickerDeckFilter.addEventListener("change", renderPickerList);
    if (els.pickerClearBtn) {
      els.pickerClearBtn.addEventListener("click", function () {
        state.pickerDraftIds = [];
        renderPickerList();
      });
    }
    if (els.pickerApplyBtn) els.pickerApplyBtn.addEventListener("click", applyPickerSelection);

    // Rename Modal bindings
    if (els.renameCloseBtn) els.renameCloseBtn.addEventListener("click", function () { closeModal(els.renameModal); });
    if (els.renameCancelBtn) els.renameCancelBtn.addEventListener("click", function () { closeModal(els.renameModal); });
    if (els.renameSaveBtn) els.renameSaveBtn.addEventListener("click", commitRenameDialog);
    if (els.renameInput) {
      els.renameInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
          e.preventDefault();
          commitRenameDialog();
        }
      });
    }

    // Settings Modal bindings
    if (els.settingsCloseBtn) els.settingsCloseBtn.addEventListener("click", function () { closeModal(els.settingsModal); });
    if (els.newProfileBtn) {
      els.newProfileBtn.addEventListener("click", function () {
        syncFormIntoDraft();
        var fmt = els.profileFormat ? els.profileFormat.value : "openai-chat";
        var created = providers.createDefaultProfile(fmt, {
          name: tr("ai.newProfileDefaultName", null, "新模型配置", "New Profile")
        });
        state.settingsDraft.profiles.push(created);
        state.settingsDraft.activeProfileId = created.id;
        renderSettingsModal();
      });
    }
    if (els.profileDeleteBtn) {
      els.profileDeleteBtn.addEventListener("click", function () {
        var draft = state.settingsDraft;
        if (!draft || draft.profiles.length <= 1) return;
        var current = getDraftActiveProfile();
        draft.profiles = draft.profiles.filter(function (p) { return p.id !== current.id; });
        draft.activeProfileId = draft.profiles[0] ? draft.profiles[0].id : "";
        renderSettingsModal();
      });
    }
    if (els.presetRow) {
      Array.prototype.forEach.call(els.presetRow.querySelectorAll("[data-preset]"), function (chip) {
        chip.addEventListener("click", function () {
          var preset = findQuickPreset(chip.getAttribute("data-preset"));
          if (preset) applyQuickPreset(preset);
        });
      });
    }
    if (els.profileFormat) {
      els.profileFormat.addEventListener("change", function () {
        var active = getDraftActiveProfile();
        if (!active) return;
        var prevFmt = active.format;
        var nextFmt = els.profileFormat.value;
        syncFormIntoDraft();
        if (!active.baseUrl || active.baseUrl === providers.DEFAULT_BASE_URLS[prevFmt]) {
          active.baseUrl = providers.DEFAULT_BASE_URLS[nextFmt] || "";
        }
        if (!active.model || active.model === providers.DEFAULT_MODELS[prevFmt]) {
          active.model = providers.DEFAULT_MODELS[nextFmt] || "";
        }
        active.format = nextFmt;
        active.detectedContextWindow = null;
        if (active.contextWindowSource !== "manual") {
          active.contextWindowSource = "";
        }
        renderSettingsModal();
      });
    }
    if (els.profileModel) {
      els.profileModel.addEventListener("input", function () {
        var active = getDraftActiveProfile();
        if (!active) return;
        syncFormIntoDraft();
        active.detectedContextWindow = null;
        if (active.contextWindowSource !== "manual") {
          active.contextWindowSource = "";
        }
        updateContextWindowHintUI(active);
      });
    }
    if (els.fieldContextWindow) {
      els.fieldContextWindow.addEventListener("input", function () {
        syncFormIntoDraft();
        updateContextWindowHintUI();
      });
    }
    if (els.detectContextBtn) {
      els.detectContextBtn.addEventListener("click", detectContextWindowFromModal);
    }
    if (els.toggleKeyBtn) {
      els.toggleKeyBtn.addEventListener("click", function () {
        state.keyVisible = !state.keyVisible;
        if (els.profileApiKey) els.profileApiKey.type = state.keyVisible ? "text" : "password";
        els.toggleKeyBtn.textContent = state.keyVisible
          ? tr("ai.hideKey", null, "隐藏", "Hide")
          : tr("ai.showKey", null, "显示", "Show");
      });
    }
    if (els.clearConfigBtn) els.clearConfigBtn.addEventListener("click", clearSavedConfigWithConfirm);
    if (els.testConnectionBtn) els.testConnectionBtn.addEventListener("click", runConnectionTest);
    if (els.saveProfileBtn) els.saveProfileBtn.addEventListener("click", saveSettingsFromModal);

    function isConfirmDialogOpen() {
      var dlg = byId("confirmDialog");
      if (!dlg) return false;
      return Boolean(
        dlg.open
        || (typeof dlg.hasAttribute === "function" && dlg.hasAttribute("open"))
        || (dlg.classList && dlg.classList.contains("is-open"))
      );
    }

    function isChoiceDialogOpen() {
      var dlg = byId("choiceDialog");
      if (!dlg) return false;
      return Boolean(
        dlg.open
        || (typeof dlg.hasAttribute === "function" && dlg.hasAttribute("open"))
        || (document.body && document.body.classList && document.body.classList.contains("choice-open"))
      );
    }

    // Backdrop click / Escape handling
    [els.pickerModal, els.renameModal, els.settingsModal].forEach(function (modal) {
      if (!modal) return;
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeModal(modal);
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (isConfirmDialogOpen() || isChoiceDialogOpen()) return;
      var openM = getOpenModal();
      if (openM) {
        closeModal(openM);
      } else if (state.sidebarOpen) {
        setSidebarOpen(false);
      } else if (state.themePopoverOpen) {
        setThemePopoverOpen(false);
      } else if (state.editingMessageId) {
        state.editingMessageId = "";
        renderMessages();
      }
    });

    global.addEventListener("quareia:languagechange", function () {
      applyAiLocalizedAttributes();
      ensureProfileFormatOptions();
      syncCustomSelects();
      renderSidebar();
      renderContextHeader();
      renderMessages();
      if (els.settingsModal && !els.settingsModal.hidden) {
        renderSettingsModal();
      }
      if (els.pickerModal && !els.pickerModal.hidden) {
        renderPickerList();
      }
    });

    global.addEventListener("pageshow", function () {
      updateBackLink();
      updateProfileIndicator();
    });

    global.addEventListener("storage", function (e) {
      var key = e ? e.key : "";
      if (!key || key === "quareia-page-version" || key === "quareia-page-version-v1") {
        updateBackLink();
      }
      if (!key || key === providers.STORAGE_KEY) {
        updateProfileIndicator();
        renderContextMeter();
      }
    });

    global.addEventListener("pagehide", function () {
      if (!state.streaming) return;
      var ctx = state.activeStreamContext;
      state.activeStreamContext = null;
      if (ctx && ctx.conv && ctx.conv.messages && ctx.conv.messages[ctx.assistantMsgIndex]) {
        var partialMsg = ctx.conv.messages[ctx.assistantMsgIndex];
        if (!partialMsg.content && !partialMsg.error) {
          partialMsg.error = tr("ai.stoppedEmpty", null, "已停止生成。", "Generation stopped.");
        }
        var covIdx = ctx.conv.contextSummary
          ? ctx.conv.messages.findIndex(function (m) { return m.id === ctx.conv.contextSummary.coveredUntilId; })
          : -1;
        chatStore.completeMessage(ctx.conv.id, partialMsg, {
          profileId: ctx.profileId || "",
          contextSummary: ctx.conv.contextSummary || null,
          summaryMessages: covIdx >= 0 ? ctx.conv.messages.slice(0, covIdx + 1) : null,
          lastUsage: ctx.conv.lastUsage || null
        }).catch(function () {});
      }
      if (state.abortController) {
        try {
          state.abortController.abort();
        } catch (_err) {}
      }
    });

    updateBackLink();
    applyAiLocalizedAttributes();
    ensureProfileFormatOptions();
    syncCustomSelects();
    maybeProbeActiveProfileContextWindow();

    // Handle optional ?readingId=... deep link from reading/history pages.
    var urlParams = typeof URLSearchParams === "function" ? new URLSearchParams(global.location.search || "") : null;
    var deepLinkReadingId = urlParams ? urlParams.get("readingId") : "";

    loadSelectableReadings().then(function () {
      if (deepLinkReadingId) {
        if (global.history && typeof global.history.replaceState === "function") {
          try {
            global.history.replaceState(null, "", global.location.pathname || "ai.html");
          } catch (_err) {
            // Ignore replaceState failures in restricted contexts
          }
        }
        if (state.readingsById[deepLinkReadingId]) {
          return createFreshConversation([deepLinkReadingId]);
        }
      }
      return refreshConversationsList();
    });

    return {
      handleBack: function () {
        if (global.DivinationDialog && typeof global.DivinationDialog.handleBack === "function") {
          if (global.DivinationDialog.handleBack()) {
            return true;
          }
        } else if (isConfirmDialogOpen()) {
          var cancelBtn = byId("confirmCancelBtn");
          if (cancelBtn && typeof cancelBtn.click === "function") {
            cancelBtn.click();
            return true;
          }
        }
        if (global.DivinationCustomSelects && typeof global.DivinationCustomSelects.handleBack === "function") {
          if (global.DivinationCustomSelects.handleBack()) {
            return true;
          }
        } else if (isChoiceDialogOpen()) {
          var choiceCancel = byId("choiceCancelBtn");
          if (choiceCancel && typeof choiceCancel.click === "function") {
            choiceCancel.click();
            return true;
          }
        }
        var openM = getOpenModal();
        if (openM) {
          closeModal(openM);
          return true;
        }
        if (state.sidebarOpen) {
          setSidebarOpen(false);
          return true;
        }
        if (state.themePopoverOpen) {
          setThemePopoverOpen(false);
          return true;
        }
        if (state.streaming) {
          if (state.abortController) {
            state.abortController.abort();
          } else {
            finishStreamingUi();
          }
          return true;
        }
        if (state.editingMessageId) {
          state.editingMessageId = "";
          renderMessages();
          return true;
        }
        return false;
      }
    };
  }

  var controller = null;
  function bootstrap(opts) {
    if (controller && !(opts && opts.reset === true)) return controller;
    controller = initAiPage();
    return controller;
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrap);
    } else {
      bootstrap();
    }
  }

  var api = {
    renderMarkdownInto: renderMarkdownInto,
    normalizeConversationMessagesForApi: normalizeConversationMessagesForApi,
    truncateMessagesToBudget: truncateMessagesToBudget,
    hasPrecedingUserTurn: hasPrecedingUserTurn,
    handleBack: function () {
      return controller ? controller.handleBack() : false;
    },
    bootstrap: bootstrap
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.DivinationAiUi = api;
})(typeof window !== "undefined" ? window : globalThis);
