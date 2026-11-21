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

  function contextSourceLabel(source) {
    if (source === "manual") return tr("ai.contextSource.manual", null, "手动指定", "Manual");
    if (source === "api") return tr("ai.contextSource.api", null, "接口实时获取", "Fetched from API");
    if (source === "catalog") return tr("ai.contextSource.catalog", null, "模型目录识别", "Matched from catalog");
    return tr("ai.contextSource.default", null, "默认保守估计", "Default estimate");
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

  function formatProviderError(err) {
    if (!err) return tr("ai.err.unknown", null, "请求失败", "Request failed");
    if (err.code === "output_truncated") {
      return tr("ai.err.truncated", null, "已达到模型输出上限，回答可能不完整。可以继续追问，或在 API 设置中提高最大输出 Token。", "The model reached its output limit, so the answer may be incomplete. Ask it to continue or increase the output token limit in API settings.");
    }
    if (err.code === "response_incomplete") {
      return tr("ai.err.incomplete", null, "连接在回答完成前结束，已保留收到的内容。请重试或继续追问。", "The connection ended before the response finished. Any received text has been kept. Retry or ask it to continue.");
    }
    if (err.code === "context_too_small") {
      return tr("ai.err.contextTooSmall", null,
        "这段对话放不进当前上下文窗口了，连最简提示词加这个问题都超了。可以把问题改短一点，或在 API 设置里调大上下文窗口 / 换一个窗口更大的模型。",
        "This conversation no longer fits the context window, even with the shortest prompt and just your question. Shorten the question, raise the context window in API settings, or switch to a model with a larger window.");
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

  var api = {
    tr: tr,
    isEnglishLocale: isEnglishLocale,
    currentLocale: currentLocale,
    copyTextToClipboard: copyTextToClipboard,
    fallbackCopy: fallbackCopy,
    triggerFileDownload: triggerFileDownload,
    parseTimeMs: parseTimeMs,
    formatShortTime: formatShortTime,
    formatTokenCount: formatTokenCount,
    buildFallbackSummaryDigest: buildFallbackSummaryDigest,
    deckShortLabel: deckShortLabel,
    confirmAction: confirmAction,
    normalizeConversationMessagesForApi: normalizeConversationMessagesForApi,
    truncateMessagesToBudget: truncateMessagesToBudget,
    hasPrecedingUserTurn: hasPrecedingUserTurn,
    byId: byId,
    contextSourceLabel: contextSourceLabel,
    syncCustomSelects: syncCustomSelects,
    formatProviderError: formatProviderError
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiHelpers = api;
})(typeof window !== "undefined" ? window : globalThis);
