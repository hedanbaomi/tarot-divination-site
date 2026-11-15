(function (global) {
  "use strict";

  var STORAGE_KEY = "quareia-ai-config-v1";

  var FORMAT_IDS = [
    "openai-chat",
    "openai-responses",
    "anthropic-messages",
    "gemini-aistudio",
    "gemini-vertex"
  ];

  var DEFAULT_BASE_URLS = {
    "openai-chat": "https://api.openai.com/v1",
    "openai-responses": "https://api.openai.com/v1",
    "anthropic-messages": "https://api.anthropic.com/v1",
    "gemini-aistudio": "https://generativelanguage.googleapis.com/v1beta",
    "gemini-vertex": "https://aiplatform.googleapis.com/v1"
  };

  var DEFAULT_MODELS = {
    "openai-chat": "gpt-4o-mini",
    "openai-responses": "gpt-4o-mini",
    "anthropic-messages": "claude-sonnet-4-20250514",
    "gemini-aistudio": "gemini-2.5-flash",
    "gemini-vertex": "gemini-2.5-flash"
  };

  var ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;
  var DEFAULT_TEST_TIMEOUT_MS = 15000;
  var OPENAI_REASONING_MODEL_RE = /^(?:.*\/)?(o[134](?:[-_]|$)|gpt-5)/i;

  function isOpenAiReasoningModel(model) {
    return OPENAI_REASONING_MODEL_RE.test(trimString(model));
  }

  function AiProviderError(code, message, options) {
    var opts = options && typeof options === "object" ? options : {};
    var err = new Error(message || code || "AI provider error");
    err.name = "AiProviderError";
    err.code = code || "unknown_error";
    err.status = typeof opts.status === "number" ? opts.status : 0;
    err.format = opts.format || "";
    err.detail = opts.detail || "";
    if (opts.cause) {
      err.cause = opts.cause;
    }
    return err;
  }

  function trimString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function stripTrailingSlashes(url) {
    return trimString(url).replace(/\/+$/, "");
  }

  function isValidFormat(format) {
    return FORMAT_IDS.indexOf(format) !== -1;
  }

  function generateProfileId() {
    return "prof_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function toOptionalNumber(value, isInteger) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    var num = Number(value);
    if (!Number.isFinite(num)) {
      return null;
    }
    return isInteger ? Math.round(num) : num;
  }

  function normalizePositiveInt(value, minimum) {
    var num = toOptionalNumber(value, true);
    if (num === null || num < (minimum || 1)) {
      return 0;
    }
    return num;
  }

  function createDefaultProfile(format, overrides) {
    var safeFormat = isValidFormat(format) ? format : "openai-chat";
    var extra = overrides && typeof overrides === "object" ? overrides : {};
    return normalizeProfile({
      id: trimString(extra.id) || generateProfileId(),
      name: trimString(extra.name) || "",
      format: safeFormat,
      baseUrl: trimString(extra.baseUrl) || DEFAULT_BASE_URLS[safeFormat],
      apiKey: trimString(extra.apiKey) || "",
      model: trimString(extra.model) || DEFAULT_MODELS[safeFormat],
      vertexProject: trimString(extra.vertexProject) || "",
      vertexLocation: trimString(extra.vertexLocation) || "",
      temperature: extra.temperature !== undefined ? extra.temperature : null,
      maxTokens: extra.maxTokens !== undefined ? extra.maxTokens : null,
      contextWindow: extra.contextWindow !== undefined ? extra.contextWindow : 0,
      detectedContextWindow: extra.detectedContextWindow !== undefined ? extra.detectedContextWindow : 0,
      contextWindowSource: extra.contextWindowSource || "",
      autoCompress: extra.autoCompress !== undefined ? extra.autoCompress : true,
      updatedAt: Number(extra.updatedAt) || Date.now()
    });
  }

  function normalizeProfile(raw) {
    var input = raw && typeof raw === "object" ? raw : {};
    var format = isValidFormat(input.format) ? input.format : "openai-chat";
    var baseUrl = stripTrailingSlashes(input.baseUrl) || DEFAULT_BASE_URLS[format];
    var temp = toOptionalNumber(input.temperature, false);
    if (temp !== null && (temp < 0 || temp > 2)) {
      temp = Math.max(0, Math.min(2, temp));
    }
    var maxTokens = toOptionalNumber(input.maxTokens, true);
    if (maxTokens !== null && maxTokens <= 0) {
      maxTokens = null;
    }
    var contextWindow = normalizePositiveInt(input.contextWindow, 1024);
    var detectedContextWindow = normalizePositiveInt(input.detectedContextWindow, 1024);
    var rawSource = trimString(input.contextWindowSource);
    var contextWindowSource = "";
    if (contextWindow >= 1024) {
      contextWindowSource = "manual";
      if (rawSource !== "api" && rawSource !== "manual") {
        detectedContextWindow = 0;
      }
    } else if (rawSource === "api" && detectedContextWindow >= 1024) {
      contextWindowSource = "api";
    } else {
      detectedContextWindow = 0;
      if (rawSource === "catalog" || rawSource === "default" || rawSource === "auto") {
        contextWindowSource = "auto";
      }
    }
    // Intentionally omit any user-supplied systemPrompt field: system prompt is code-locked.
    return {
      id: trimString(input.id) || generateProfileId(),
      name: trimString(input.name),
      format: format,
      baseUrl: baseUrl,
      apiKey: trimString(input.apiKey),
      model: trimString(input.model),
      vertexProject: trimString(input.vertexProject),
      vertexLocation: trimString(input.vertexLocation),
      temperature: temp,
      maxTokens: maxTokens,
      contextWindow: contextWindow,
      detectedContextWindow: detectedContextWindow,
      contextWindowSource: contextWindowSource,
      autoCompress: input.autoCompress !== false,
      updatedAt: Number(input.updatedAt) || Date.now()
    };
  }

  function normalizeConfig(raw) {
    var input = raw && typeof raw === "object" ? raw : {};
    var rawProfiles = Array.isArray(input.profiles) ? input.profiles : [];
    var seen = Object.create(null);
    var profiles = [];
    for (var i = 0; i < rawProfiles.length; i += 1) {
      var normalized = normalizeProfile(rawProfiles[i]);
      if (seen[normalized.id]) {
        normalized.id = generateProfileId();
      }
      seen[normalized.id] = true;
      profiles.push(normalized);
    }
    var activeId = trimString(input.activeProfileId);
    if (profiles.length > 0 && !seen[activeId]) {
      activeId = profiles[0].id;
    } else if (profiles.length === 0) {
      activeId = "";
    }
    return {
      version: 1,
      activeProfileId: activeId,
      profiles: profiles
    };
  }

  function validateHttpUrl(rawUrl) {
    var candidate = trimString(rawUrl);
    if (!candidate) {
      return { ok: false, reason: "missing_base_url" };
    }
    try {
      var parsed = new URL(candidate);
      if (parsed.protocol === "https:") {
        return { ok: true, parsed: parsed };
      }
      if (parsed.protocol === "http:") {
        var host = (parsed.hostname || "").toLowerCase();
        if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
          return { ok: true, parsed: parsed };
        }
        return { ok: false, reason: "insecure_http_url" };
      }
      return { ok: false, reason: "invalid_base_url" };
    } catch (_err) {
      return { ok: false, reason: "invalid_base_url" };
    }
  }

  function validateProfile(profile) {
    var errors = [];
    if (!profile || typeof profile !== "object") {
      return { ok: false, errors: ["invalid_profile"] };
    }
    if (!isValidFormat(profile.format)) {
      errors.push("invalid_format");
    }
    var urlCheck = validateHttpUrl(profile.baseUrl);
    if (!urlCheck.ok) {
      errors.push(urlCheck.reason);
    }
    if (!trimString(profile.apiKey)) {
      errors.push("missing_api_key");
    }
    if (!trimString(profile.model)) {
      errors.push("missing_model");
    }
    return {
      ok: errors.length === 0,
      errors: errors
    };
  }

  function redactApiKey(apiKey) {
    var key = trimString(apiKey);
    if (!key) {
      return "";
    }
    if (key.length <= 8) {
      return "****";
    }
    return key.slice(0, 4) + "..." + key.slice(-4);
  }

  function sanitizeSecretText(text, apiKey) {
    var output = typeof text === "string" ? text : String(text || "");
    if (!output) {
      return "";
    }
    output = output.replace(/([?&](?:key|api_key|access_token|x-goog-api-key)=)[^&\s"'<>]+/gi, "$1****");
    var key = trimString(apiKey);
    if (!key) {
      return output;
    }
    var mask = redactApiKey(key);
    if (output.indexOf("Bearer " + key) !== -1) {
      output = output.split("Bearer " + key).join("Bearer " + mask);
    }
    var shouldRedactBareKey = key.length >= 6 || (key.length >= 4 && !/^[a-z]+$/i.test(key));
    if (shouldRedactBareKey) {
      if (output.indexOf(key) !== -1) {
        output = output.split(key).join(mask);
      }
      var encodedKey = "";
      try {
        encodedKey = encodeURIComponent(key);
      } catch (_err) {
        encodedKey = "";
      }
      if (encodedKey && encodedKey !== key && output.indexOf(encodedKey) !== -1) {
        output = output.split(encodedKey).join(mask);
      }
      var lowerEncoded = encodedKey ? encodedKey.toLowerCase() : "";
      if (lowerEncoded && lowerEncoded !== encodedKey && output.toLowerCase().indexOf(lowerEncoded) !== -1) {
        var escaped = lowerEncoded.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        output = output.replace(new RegExp(escaped, "gi"), mask);
      }
    }
    return output;
  }

  function safeReadStorage(storage, key) {
    if (!storage || typeof storage.getItem !== "function") {
      return "";
    }
    try {
      return storage.getItem(key) || "";
    } catch (_err) {
      return "";
    }
  }

  function safeWriteStorage(storage, key, value) {
    if (!storage || typeof storage.setItem !== "function") {
      return false;
    }
    try {
      storage.setItem(key, value);
      return true;
    } catch (_err) {
      return false;
    }
  }

  function safeRemoveStorage(storage, key) {
    if (!storage || typeof storage.removeItem !== "function") {
      return false;
    }
    try {
      storage.removeItem(key);
      return true;
    } catch (_err) {
      return false;
    }
  }

  function safeReadBridge(bridge) {
    if (!bridge || typeof bridge.read !== "function") {
      return "";
    }
    try {
      var val = bridge.read();
      return typeof val === "string" ? val : "";
    } catch (_err) {
      return "";
    }
  }

  function safeWriteBridge(bridge, json) {
    if (!bridge || typeof bridge.write !== "function") {
      return false;
    }
    try {
      var res = bridge.write(json);
      return res !== false;
    } catch (_err) {
      return false;
    }
  }

  function safeClearBridge(bridge) {
    if (!bridge || typeof bridge.clear !== "function") {
      return false;
    }
    try {
      bridge.clear();
      return true;
    } catch (_err) {
      return false;
    }
  }

  function parseConfigJson(rawJson) {
    var text = trimString(rawJson);
    if (!text) {
      return null;
    }
    try {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      return normalizeConfig(parsed);
    } catch (_err) {
      return null;
    }
  }

  function createConfigStore(options) {
    var opts = options && typeof options === "object" ? options : {};
    var storageKey = trimString(opts.storageKey) || STORAGE_KEY;
    var storage = opts.storage !== undefined
      ? opts.storage
      : (typeof global.localStorage !== "undefined" ? global.localStorage : null);
    var nativeBridge = opts.nativeBridge !== undefined
      ? opts.nativeBridge
      : (typeof global.androidAiConfig !== "undefined" ? global.androidAiConfig : null);

    function load() {
      var fromStorage = parseConfigJson(safeReadStorage(storage, storageKey));
      if (fromStorage) {
        return fromStorage;
      }
      var fromBridge = parseConfigJson(safeReadBridge(nativeBridge));
      if (fromBridge) {
        safeWriteStorage(storage, storageKey, JSON.stringify(fromBridge));
        return fromBridge;
      }
      return normalizeConfig(null);
    }

    function save(nextConfig) {
      var normalized = normalizeConfig(nextConfig);
      var serialized = JSON.stringify(normalized);
      safeWriteStorage(storage, storageKey, serialized);
      safeWriteBridge(nativeBridge, serialized);
      return normalized;
    }

    function clear() {
      safeRemoveStorage(storage, storageKey);
      safeClearBridge(nativeBridge);
      return normalizeConfig(null);
    }

    function getActiveProfile() {
      var cfg = load();
      for (var i = 0; i < cfg.profiles.length; i += 1) {
        if (cfg.profiles[i].id === cfg.activeProfileId) {
          return cfg.profiles[i];
        }
      }
      return cfg.profiles[0] || null;
    }

    function upsertProfile(profileInput, setActive) {
      var cfg = load();
      var normalized = normalizeProfile(profileInput);
      normalized.updatedAt = Date.now();
      var replaced = false;
      for (var i = 0; i < cfg.profiles.length; i += 1) {
        if (cfg.profiles[i].id === normalized.id) {
          cfg.profiles[i] = normalized;
          replaced = true;
          break;
        }
      }
      if (!replaced) {
        cfg.profiles.push(normalized);
      }
      if (setActive || !cfg.activeProfileId) {
        cfg.activeProfileId = normalized.id;
      }
      return save(cfg);
    }

    function deleteProfile(profileId) {
      var cfg = load();
      cfg.profiles = cfg.profiles.filter(function (p) {
        return p.id !== profileId;
      });
      if (cfg.activeProfileId === profileId) {
        cfg.activeProfileId = cfg.profiles[0] ? cfg.profiles[0].id : "";
      }
      return save(cfg);
    }

    function setActiveProfile(profileId) {
      var cfg = load();
      cfg.activeProfileId = trimString(profileId);
      return save(cfg);
    }

    return {
      load: load,
      save: save,
      clear: clear,
      getActiveProfile: getActiveProfile,
      upsertProfile: upsertProfile,
      deleteProfile: deleteProfile,
      setActiveProfile: setActiveProfile
    };
  }

  function cleanGeminiModelName(model) {
    return trimString(model).replace(/^models\//, "");
  }

  function appendAltSse(url) {
    if (/[?&]alt=/i.test(url)) {
      return url;
    }
    return url + (url.indexOf("?") === -1 ? "?alt=sse" : "&alt=sse");
  }

  function normalizeUrlPathname(pathname) {
    return String(pathname || "").replace(/\/+$/, "");
  }

  function stripQuerySecrets(parsed) {
    if (!parsed || !parsed.searchParams) {
      return;
    }
    var keys = [];
    parsed.searchParams.forEach(function (_value, key) {
      var lower = String(key || "").toLowerCase();
      if (lower === "key" || lower === "api_key" || lower === "access_token" || lower === "x-goog-api-key") {
        keys.push(key);
      }
    });
    for (var i = 0; i < keys.length; i += 1) {
      parsed.searchParams.delete(keys[i]);
    }
  }

  function stripGeminiEndpointSuffix(pathname) {
    var cleanPath = normalizeUrlPathname(pathname);
    cleanPath = cleanPath.replace(/\/models\/(?!v\d+(?:alpha|beta)?$)[^/]+(?::(?:streamGenerateContent|generateContent))?$/i, "");
    cleanPath = cleanPath.replace(/:(?:streamGenerateContent|generateContent)$/i, "");
    return normalizeUrlPathname(cleanPath);
  }

  function applyGeminiStreamQuery(parsed, stream) {
    if (stream) {
      if (!parsed.searchParams.has("alt")) {
        parsed.searchParams.set("alt", "sse");
      }
    } else if ((parsed.searchParams.get("alt") || "").toLowerCase() === "sse") {
      parsed.searchParams.delete("alt");
    }
  }

  function buildOpenAiUrl(baseUrl, suffixPath, defaultHostPath) {
    var clean = stripTrailingSlashes(baseUrl);
    try {
      var parsed = new URL(clean);
      stripQuerySecrets(parsed);
      var pathname = normalizeUrlPathname(parsed.pathname);
      if (pathname.slice(-suffixPath.length) !== suffixPath) {
        if (parsed.hostname.toLowerCase() === "api.openai.com" && pathname === "") {
          pathname = defaultHostPath + suffixPath;
        } else {
          pathname = pathname + suffixPath;
        }
      }
      parsed.pathname = pathname;
      return parsed.toString();
    } catch (_err) {
      // Ignore malformed URL here; validateProfile reports it separately.
    }
    if (clean.slice(-suffixPath.length) === suffixPath) {
      return clean;
    }
    return clean + suffixPath;
  }

  function buildAnthropicUrl(baseUrl) {
    var clean = stripTrailingSlashes(baseUrl);
    try {
      var parsed = new URL(clean);
      stripQuerySecrets(parsed);
      var pathname = normalizeUrlPathname(parsed.pathname);
      if (pathname.slice(-9) !== "/messages") {
        if (parsed.hostname.toLowerCase() === "api.anthropic.com" && pathname === "") {
          pathname = "/v1/messages";
        } else {
          pathname = pathname + "/messages";
        }
      }
      parsed.pathname = pathname;
      return parsed.toString();
    } catch (_err) {
      // Ignore
    }
    if (clean.slice(-9) === "/messages") {
      return clean;
    }
    return clean + "/messages";
  }

  function buildAiStudioUrl(baseUrl, model, stream) {
    var clean = stripTrailingSlashes(baseUrl);
    var method = stream ? "streamGenerateContent" : "generateContent";
    var safeModel = encodeURIComponent(cleanGeminiModelName(model));
    try {
      var parsed = new URL(clean);
      stripQuerySecrets(parsed);
      var pathname = stripGeminiEndpointSuffix(parsed.pathname);
      if (parsed.hostname.toLowerCase() === "generativelanguage.googleapis.com" && pathname === "") {
        pathname = "/v1beta";
      }
      parsed.pathname = pathname + "/models/" + safeModel + ":" + method;
      applyGeminiStreamQuery(parsed, stream);
      return parsed.toString();
    } catch (_err) {
      // Ignore
    }
    var base = clean.replace(/\/models\/[^/]+(?::(?:streamGenerateContent|generateContent))?$/i, "")
      .replace(/:(?:streamGenerateContent|generateContent)$/i, "");
    var url = base + "/models/" + safeModel + ":" + method;
    return stream ? appendAltSse(url) : url;
  }

  function buildVertexUrl(profile, stream) {
    var clean = stripTrailingSlashes(profile.baseUrl || DEFAULT_BASE_URLS["gemini-vertex"]);
    var method = stream ? "streamGenerateContent" : "generateContent";
    var safeModel = encodeURIComponent(cleanGeminiModelName(profile.model));
    var project = trimString(profile.vertexProject);
    var rawLocation = trimString(profile.vertexLocation);

    try {
      var parsed = new URL(clean);
      stripQuerySecrets(parsed);
      var host = parsed.hostname.toLowerCase();
      var regionalMatch = host.match(/^([a-z0-9-]+)-aiplatform\.googleapis\.com$/i);
      var isVertexGoogleHost = host === "aiplatform.googleapis.com" || Boolean(regionalMatch);
      var effLocation = rawLocation || (regionalMatch ? regionalMatch[1] : "us-central1");

      if (project && host === "aiplatform.googleapis.com" && effLocation.toLowerCase() !== "global") {
        parsed.hostname = effLocation + "-aiplatform.googleapis.com";
      }

      var pathname = stripGeminiEndpointSuffix(parsed.pathname);
      if (isVertexGoogleHost && pathname === "") {
        pathname = "/v1";
      }

      if (pathname.indexOf("/publishers/") !== -1) {
        pathname += "/models/" + safeModel + ":" + method;
      } else if (project) {
        pathname += "/projects/" + encodeURIComponent(project)
          + "/locations/" + encodeURIComponent(effLocation)
          + "/publishers/google/models/" + safeModel + ":" + method;
      } else {
        pathname += "/publishers/google/models/" + safeModel + ":" + method;
      }

      parsed.pathname = pathname;
      applyGeminiStreamQuery(parsed, stream);
      return parsed.toString();
    } catch (_err) {
      // Ignore
    }

    var fallbackEffLocation = rawLocation || "us-central1";
    var base = clean.replace(/\/models\/[^/]+(?::(?:streamGenerateContent|generateContent))?$/i, "")
      .replace(/:(?:streamGenerateContent|generateContent)$/i, "");
    var url;
    if (base.indexOf("/publishers/") !== -1) {
      url = base + "/models/" + safeModel + ":" + method;
    } else if (project) {
      url = base
        + "/projects/" + encodeURIComponent(project)
        + "/locations/" + encodeURIComponent(fallbackEffLocation)
        + "/publishers/google/models/" + safeModel + ":" + method;
    } else {
      url = base + "/publishers/google/models/" + safeModel + ":" + method;
    }
    return stream ? appendAltSse(url) : url;
  }

  function sanitizeMessages(messages) {
    if (!Array.isArray(messages)) {
      return [];
    }
    var out = [];
    var seenUser = false;
    for (var i = 0; i < messages.length; i += 1) {
      var msg = messages[i];
      if (!msg || typeof msg !== "object") {
        continue;
      }
      var role = msg.role === "assistant" ? "assistant" : (msg.role === "system" ? "system" : "user");
      var content = typeof msg.content === "string" ? msg.content : String(msg.content || "");
      if (!content.trim()) {
        continue;
      }
      if (role === "assistant" && !seenUser) {
        continue;
      }
      if (role === "user") {
        seenUser = true;
      }
      if (out.length > 0 && out[out.length - 1].role === role) {
        out[out.length - 1].content += "\n\n" + content;
      } else {
        out.push({
          role: role,
          content: content
        });
      }
    }
    return out;
  }

  function extractConversationTurns(messages) {
    var turns = [];
    var extraSystem = [];
    var seenUser = false;
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i];
      if (!m) {
        continue;
      }
      if (m.role === "system") {
        if (trimString(m.content)) {
          extraSystem.push(m.content);
        }
        continue;
      }
      var role = m.role === "assistant" ? "assistant" : "user";
      if (role === "assistant" && !seenUser) {
        continue;
      }
      if (role === "user") {
        seenUser = true;
      }
      if (turns.length > 0 && turns[turns.length - 1].role === role) {
        turns[turns.length - 1].content += "\n\n" + m.content;
      } else {
        turns.push({
          role: role,
          content: m.content
        });
      }
    }
    return {
      turns: turns,
      extraSystem: extraSystem
    };
  }

  function buildGeminiPayload(profile, systemPrompt, turns) {
    var contents = [];
    for (var i = 0; i < turns.length; i += 1) {
      var m = turns[i];
      var gemRole = m.role === "assistant" ? "model" : "user";
      if (contents.length > 0 && contents[contents.length - 1].role === gemRole) {
        contents[contents.length - 1].parts[0].text += "\n\n" + m.content;
      } else {
        contents.push({
          role: gemRole,
          parts: [{ text: m.content }]
        });
      }
    }
    var body = {
      contents: contents
    };
    if (trimString(systemPrompt)) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }]
      };
    }
    var genConfig = {};
    if (typeof profile.temperature === "number" && Number.isFinite(profile.temperature)) {
      genConfig.temperature = profile.temperature;
    }
    if (typeof profile.maxTokens === "number" && Number.isFinite(profile.maxTokens) && profile.maxTokens > 0) {
      genConfig.maxOutputTokens = profile.maxTokens;
    }
    if (Object.keys(genConfig).length > 0) {
      body.generationConfig = genConfig;
    }
    return body;
  }

  function buildRequest(profileInput, payload) {
    var profile = normalizeProfile(profileInput);
    var check = validateProfile(profile);
    if (!check.ok) {
      throw AiProviderError("invalid_config", "Invalid AI provider configuration: " + check.errors.join(", "), {
        format: profile.format,
        detail: check.errors.join(", ")
      });
    }

    var opts = payload && typeof payload === "object" ? payload : {};
    var rawSystemPrompt = typeof opts.systemPrompt === "string" ? opts.systemPrompt : "";
    var sanitized = sanitizeMessages(opts.messages);
    var normalizedConv = extractConversationTurns(sanitized);
    var turns = normalizedConv.turns;
    if (turns.length === 0) {
      throw AiProviderError("empty_messages", "At least one non-empty user message is required", {
        format: profile.format,
        detail: "empty_messages"
      });
    }
    var systemParts = [];
    if (trimString(rawSystemPrompt)) {
      systemParts.push(rawSystemPrompt);
    }
    for (var sIdx = 0; sIdx < normalizedConv.extraSystem.length; sIdx += 1) {
      systemParts.push(normalizedConv.extraSystem[sIdx]);
    }
    var systemPrompt = systemParts.join("\n\n");
    var stream = opts.stream !== false;
    var format = profile.format;
    var isReasoningModel = isOpenAiReasoningModel(profile.model);
    var url;
    var headers;
    var body;

    if (format === "openai-chat") {
      url = buildOpenAiUrl(profile.baseUrl, "/chat/completions", "/v1");
      // Strictly isolate headers per provider so proxies/CORS preflight stay clean.
      headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + profile.apiKey
      };
      var chatMessages = [];
      if (trimString(systemPrompt)) {
        chatMessages.push({ role: "system", content: systemPrompt });
      }
      for (var i = 0; i < turns.length; i += 1) {
        chatMessages.push(turns[i]);
      }
      body = {
        model: profile.model,
        messages: chatMessages,
        stream: stream
      };
      // Official Chat Completions needs this flag for its final usage chunk.
      // Unknown compatible gateways keep their existing request shape.
      if (stream && new URL(profile.baseUrl).hostname === "api.openai.com") body.stream_options = { include_usage: true };
      if (typeof profile.temperature === "number" && Number.isFinite(profile.temperature)) {
        if (!isReasoningModel || profile.temperature === 1) {
          body.temperature = profile.temperature;
        }
      }
      if (typeof profile.maxTokens === "number" && Number.isFinite(profile.maxTokens) && profile.maxTokens > 0) {
        if (isReasoningModel) {
          body.max_completion_tokens = profile.maxTokens;
        } else {
          body.max_tokens = profile.maxTokens;
        }
      }
    } else if (format === "openai-responses") {
      url = buildOpenAiUrl(profile.baseUrl, "/responses", "/v1");
      headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + profile.apiKey
      };
      var respInput = [];
      for (var j = 0; j < turns.length; j += 1) {
        respInput.push({
          role: turns[j].role,
          content: turns[j].content
        });
      }
      body = {
        model: profile.model,
        input: respInput,
        stream: stream
      };
      if (trimString(systemPrompt)) {
        body.instructions = systemPrompt;
      }
      if (typeof profile.temperature === "number" && Number.isFinite(profile.temperature)) {
        if (!isReasoningModel || profile.temperature === 1) {
          body.temperature = profile.temperature;
        }
      }
      if (typeof profile.maxTokens === "number" && Number.isFinite(profile.maxTokens) && profile.maxTokens > 0) {
        body.max_output_tokens = profile.maxTokens;
      }
    } else if (format === "anthropic-messages") {
      url = buildAnthropicUrl(profile.baseUrl);
      headers = {
        "content-type": "application/json",
        "x-api-key": profile.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      };
      var anthMessages = [];
      for (var k = 0; k < turns.length; k += 1) {
        anthMessages.push({
          role: turns[k].role,
          content: turns[k].content
        });
      }
      body = {
        model: profile.model,
        max_tokens: (typeof profile.maxTokens === "number" && profile.maxTokens > 0)
          ? profile.maxTokens
          : ANTHROPIC_DEFAULT_MAX_TOKENS,
        messages: anthMessages,
        stream: stream
      };
      if (trimString(systemPrompt)) {
        body.system = systemPrompt;
      }
      if (typeof profile.temperature === "number" && Number.isFinite(profile.temperature)) {
        body.temperature = profile.temperature;
      }
    } else if (format === "gemini-aistudio") {
      url = buildAiStudioUrl(profile.baseUrl, profile.model, stream);
      // Google GFE rejects OPTIONS preflight with 403 if non-whitelisted headers are present.
      headers = {
        "content-type": "application/json",
        "x-goog-api-key": profile.apiKey
      };
      body = buildGeminiPayload(profile, systemPrompt, turns);
    } else if (format === "gemini-vertex") {
      url = buildVertexUrl(profile, stream);
      // Vertex AI static API key mode only; strictly no OAuth Bearer header.
      headers = {
        "content-type": "application/json",
        "x-goog-api-key": profile.apiKey
      };
      body = buildGeminiPayload(profile, systemPrompt, turns);
    } else {
      throw AiProviderError("invalid_format", "Unsupported AI format: " + format, {
        format: format
      });
    }

    return {
      format: format,
      url: url,
      method: "POST",
      headers: headers,
      body: body,
      bodyJson: JSON.stringify(body)
    };
  }

  function extractErrorMessageFromJson(parsed) {
    if (!parsed) {
      return "";
    }
    if (Array.isArray(parsed) && parsed.length > 0) {
      return extractErrorMessageFromJson(parsed[0]);
    }
    if (typeof parsed !== "object") {
      return "";
    }
    if (parsed.error && typeof parsed.error === "object") {
      if (typeof parsed.error.message === "string" && parsed.error.message) {
        return parsed.error.message;
      }
      if (typeof parsed.error.type === "string" && parsed.error.type) {
        return parsed.error.type;
      }
    }
    if (typeof parsed.message === "string" && parsed.message) {
      return parsed.message;
    }
    if (typeof parsed.detail === "string" && parsed.detail) {
      return parsed.detail;
    }
    return "";
  }

  function buildHttpError(status, bodyText, format, apiKey) {
    var cleanText = trimString(bodyText);
    var detail = "";
    if (cleanText) {
      try {
        var parsed = JSON.parse(cleanText);
        var extracted = extractErrorMessageFromJson(parsed);
        detail = sanitizeSecretText(extracted || cleanText, apiKey).slice(0, 400);
      } catch (_err) {
        detail = sanitizeSecretText(cleanText, apiKey).slice(0, 400);
      }
    }
    var code = "http_error";
    if (status === 401 || status === 403) {
      code = "auth_error";
    } else if (status === 429) {
      code = "rate_limit";
    }
    var msg = "HTTP " + status + (detail ? ": " + detail : "");
    return AiProviderError(code, msg, {
      status: status,
      format: format,
      detail: detail
    });
  }

  function extractContentString(content) {
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return "";
    }
    var out = "";
    for (var i = 0; i < content.length; i += 1) {
      var part = content[i];
      if (typeof part === "string") {
        out += part;
      } else if (part && typeof part.text === "string") {
        out += part.text;
      } else if (part && part.text && typeof part.text.value === "string") {
        out += part.text.value;
      }
    }
    return out;
  }

  function usageCount(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1000000000 ? value : null;
  }

  function firstUsageCount(obj, names) {
    for (var i = 0; obj && i < names.length; i += 1) {
      var count = usageCount(obj[names[i]]);
      if (count !== null) return count;
    }
    return null;
  }

  function extractUsageObject(format, dataObj) {
    if (!dataObj || typeof dataObj !== "object") return null;
    var inputTokens = null, outputTokens = null, totalTokens = null;
    var usage;
    if (format === "openai-chat" || format === "openai-responses") {
      usage = (dataObj.response && dataObj.response.usage) || dataObj.usage;
      if (!usage || typeof usage !== "object") return null;
      inputTokens = firstUsageCount(usage, ["input_tokens", "prompt_tokens"]);
      outputTokens = firstUsageCount(usage, ["output_tokens", "completion_tokens"]);
      totalTokens = firstUsageCount(usage, ["total_tokens"]);
    } else if (format === "anthropic-messages") {
      usage = (dataObj.message && dataObj.message.usage) || dataObj.usage;
      if (!usage || typeof usage !== "object") return null;
      inputTokens = usageCount(usage.input_tokens);
      if (inputTokens !== null) {
        var cacheCreate = usage.cache_creation_input_tokens === undefined ? 0 : usageCount(usage.cache_creation_input_tokens);
        var cacheRead = usage.cache_read_input_tokens === undefined ? 0 : usageCount(usage.cache_read_input_tokens);
        inputTokens = cacheCreate === null || cacheRead === null ? null : usageCount(inputTokens + cacheCreate + cacheRead);
      }
      outputTokens = usageCount(usage.output_tokens);
    } else if (format === "gemini-aistudio" || format === "gemini-vertex") {
      usage = dataObj.usageMetadata;
      if (!usage || typeof usage !== "object") return null;
      inputTokens = usageCount(usage.promptTokenCount);
      var candidates = usageCount(usage.candidatesTokenCount);
      var thoughts = usage.thoughtsTokenCount === undefined ? 0 : usageCount(usage.thoughtsTokenCount);
      outputTokens = candidates === null || thoughts === null ? null : usageCount(candidates + thoughts);
      totalTokens = usageCount(usage.totalTokenCount);
    }
    if (inputTokens === null && outputTokens === null && totalTokens === null) return null;
    if (totalTokens === null && inputTokens !== null && outputTokens !== null) totalTokens = usageCount(inputTokens + outputTokens);
    return { inputTokens: inputTokens, outputTokens: outputTokens, totalTokens: totalTokens };
  }

  function normalizeFinishReason(reason, apiKey) {
    var safeReason = sanitizeSecretText(trimString(reason), apiKey);
    return safeReason
      .replace(/[^A-Za-z0-9_.:-]/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 64);
  }

  function completionStatusForReason(format, reason, forcedStatus) {
    if (forcedStatus === "blocked" || forcedStatus === "truncated") {
      return forcedStatus;
    }
    var key = trimString(reason).toLowerCase().replace(/[\s.-]+/g, "_");
    if (format === "openai-chat") {
      if (key === "length") {
        return "truncated";
      }
      if (key === "content_filter") {
        return "blocked";
      }
    } else if (format === "openai-responses") {
      if (key === "max_output_tokens") {
        return "truncated";
      }
      if (key === "content_filter") {
        return "blocked";
      }
    } else if (format === "anthropic-messages") {
      if (key === "max_tokens") {
        return "truncated";
      }
      if (key === "refusal") {
        return "blocked";
      }
    } else if (format === "gemini-aistudio" || format === "gemini-vertex") {
      if (key === "max_tokens") {
        return "truncated";
      }
      if (["safety", "recitation", "blocklist", "prohibited_content", "spii"].indexOf(key) !== -1) {
        return "blocked";
      }
    }
    return "complete";
  }

  function sanitizeResponseDetail(rawText, apiKey) {
    var safeDetail = sanitizeSecretText(typeof rawText === "string" ? rawText : String(rawText || ""), apiKey);
    return safeDetail.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  }

  function invalidResponseError(rawText, format, apiKey) {
    var detail = sanitizeResponseDetail(rawText, apiKey);
    return AiProviderError("invalid_response", "Invalid provider response" + (detail ? ": " + detail : ""), {
      format: format,
      detail: detail
    });
  }

  function extractFromChunk(format, eventName, dataObj, apiKey) {
    var text = "";
    var reasoning = "";
    var done = false;
    var errMessage = "";
    var terminal = false;
    var finishReason = "";
    var completionStatus = "complete";
    var usage = extractUsageObject(format, dataObj);
    var hasMeta = Boolean(usage);

    function setCompletionReason(reason, forcedStatus) {
      var normalized = normalizeFinishReason(reason, apiKey);
      if (normalized) {
        finishReason = normalized;
      }
      var status = completionStatusForReason(format, reason, forcedStatus);
      if (status === "blocked" || (status === "truncated" && completionStatus !== "blocked")) {
        completionStatus = status;
      }
    }

    if (!dataObj || typeof dataObj !== "object") {
      return { text: text, reasoning: reasoning, done: done, error: errMessage, usage: null, hasMeta: false, terminal: terminal, finishReason: finishReason, completionStatus: completionStatus };
    }

    if (dataObj.error) {
      errMessage = extractErrorMessageFromJson(dataObj) || "Stream error";
      return { text: "", reasoning: "", done: false, error: errMessage, usage: usage, hasMeta: false, terminal: terminal, finishReason: finishReason, completionStatus: completionStatus };
    }

    if (format === "openai-chat") {
      var choices = Array.isArray(dataObj.choices) ? dataObj.choices : [];
      var choice = choices[0];
      if (choice && typeof choice === "object") {
        if (typeof choice.finish_reason === "string" && choice.finish_reason) {
          hasMeta = true;
          terminal = true;
          setCompletionReason(choice.finish_reason);
        }
        var delta = choice.delta;
        if (delta && typeof delta === "object") {
          if (delta.role === "assistant") {
            hasMeta = true;
          }
          if (typeof delta.reasoning_content === "string") {
            reasoning += delta.reasoning_content;
          } else if (typeof delta.reasoning === "string") {
            reasoning += delta.reasoning;
          }
          if (typeof delta.content === "string") {
            text += delta.content;
          } else if (Array.isArray(delta.content)) {
            text += extractContentString(delta.content);
          }
        }
        var msg = choice.message;
        if (msg && typeof msg === "object") {
          if (msg.role === "assistant") {
            hasMeta = true;
          }
          if (typeof msg.reasoning_content === "string") {
            reasoning += msg.reasoning_content;
          } else if (typeof msg.reasoning === "string") {
            reasoning += msg.reasoning;
          }
          if (typeof msg.content === "string" || Array.isArray(msg.content)) {
            text += extractContentString(msg.content);
          }
        }
      }
      return { text: text, reasoning: reasoning, done: done, error: "", usage: usage, hasMeta: hasMeta, terminal: terminal, finishReason: finishReason, completionStatus: completionStatus };
    }

    if (format === "openai-responses") {
      var evType = trimString(dataObj.type) || trimString(eventName);
      var responseObj = dataObj.response && typeof dataObj.response === "object" ? dataObj.response : dataObj;
      var incompleteDetails = responseObj.incomplete_details && typeof responseObj.incomplete_details === "object"
        ? responseObj.incomplete_details
        : null;
      if (evType === "response.incomplete" || responseObj.status === "incomplete") {
        terminal = true;
        var incompleteReason = incompleteDetails && typeof incompleteDetails.reason === "string"
          ? incompleteDetails.reason
          : "incomplete";
        var incompleteStatus = completionStatusForReason(format, incompleteReason);
        setCompletionReason(incompleteReason, incompleteStatus === "blocked" ? "blocked" : "truncated");
      }
      if (evType === "response.completed" || evType === "response.incomplete") {
        hasMeta = true;
        terminal = true;
      }
      if (dataObj.object === "response" && (dataObj.status === "completed" || dataObj.status === "incomplete")) {
        hasMeta = true;
        terminal = true;
      }
      if (evType === "response.output_text.delta" && typeof dataObj.delta === "string") {
        text += dataObj.delta;
      } else if (
        (evType === "response.reasoning_summary_text.delta" || evType === "response.reasoning_text.delta")
        && typeof dataObj.delta === "string"
      ) {
        reasoning += dataObj.delta;
      } else if (evType === "response.failed" || evType === "error") {
        errMessage = (dataObj.response && extractErrorMessageFromJson(dataObj.response))
          || extractErrorMessageFromJson(dataObj)
          || trimString(dataObj.message)
          || "Responses API failed";
      } else if (evType === "response.completed") {
        done = true;
      } else if (typeof dataObj.output_text === "string" && dataObj.output_text) {
        text += dataObj.output_text;
      } else if (Array.isArray(dataObj.output)) {
        for (var r = 0; r < dataObj.output.length; r += 1) {
          var item = dataObj.output[r];
          if (!item || typeof item !== "object") {
            continue;
          }
          if (item.type === "reasoning" || item.type === "message") {
            hasMeta = true;
          }
          if (item.type === "reasoning" && Array.isArray(item.summary)) {
            for (var s = 0; s < item.summary.length; s += 1) {
              if (item.summary[s] && typeof item.summary[s].text === "string") {
                reasoning += item.summary[s].text;
              }
            }
          }
          if (Array.isArray(item.content)) {
            for (var c = 0; c < item.content.length; c += 1) {
              var cPart = item.content[c];
              if (cPart && typeof cPart.text === "string") {
                text += cPart.text;
              }
            }
          }
        }
      }
      return { text: text, reasoning: reasoning, done: done, error: errMessage, usage: usage, hasMeta: hasMeta, terminal: terminal, finishReason: finishReason, completionStatus: completionStatus };
    }

    if (format === "anthropic-messages") {
      var aType = trimString(dataObj.type) || trimString(eventName);
      if (
        aType === "message_stop"
        || aType === "message_start"
        || (aType === "message_delta" && dataObj.delta && typeof dataObj.delta.stop_reason === "string")
        || (dataObj.type === "message" && dataObj.role === "assistant")
      ) {
        hasMeta = true;
      }
      var stopReason = aType === "message_delta" && dataObj.delta && typeof dataObj.delta.stop_reason === "string"
        ? dataObj.delta.stop_reason
        : (typeof dataObj.stop_reason === "string" ? dataObj.stop_reason : "");
      if (stopReason) {
        terminal = true;
        setCompletionReason(stopReason);
      }
      if (aType === "content_block_delta" && dataObj.delta && typeof dataObj.delta === "object") {
        if (dataObj.delta.type === "text_delta" && typeof dataObj.delta.text === "string") {
          text += dataObj.delta.text;
        } else if (dataObj.delta.type === "thinking_delta" && typeof dataObj.delta.thinking === "string") {
          reasoning += dataObj.delta.thinking;
        }
      } else if (aType === "message_stop") {
        done = true;
        terminal = true;
      } else if (aType === "error") {
        errMessage = extractErrorMessageFromJson(dataObj) || "Anthropic stream error";
      } else if (Array.isArray(dataObj.content)) {
        for (var a = 0; a < dataObj.content.length; a += 1) {
          var block = dataObj.content[a];
          if (!block || typeof block !== "object") {
            continue;
          }
          if (block.type === "thinking" || block.type === "redacted_thinking" || block.type === "text") {
            hasMeta = true;
          }
          if (block.type === "text" && typeof block.text === "string") {
            text += block.text;
          } else if (block.type === "thinking" && typeof block.thinking === "string") {
            reasoning += block.thinking;
          }
        }
      }
      return { text: text, reasoning: reasoning, done: done, error: errMessage, usage: usage, hasMeta: hasMeta, terminal: terminal, finishReason: finishReason, completionStatus: completionStatus };
    }

    if (format === "gemini-aistudio" || format === "gemini-vertex") {
      var candidates = Array.isArray(dataObj.candidates) ? dataObj.candidates : [];
      var candidate = candidates[0];
      var promptFeedback = dataObj.promptFeedback && typeof dataObj.promptFeedback === "object" ? dataObj.promptFeedback : null;
      var promptBlockReason = promptFeedback && typeof promptFeedback.blockReason === "string"
        ? promptFeedback.blockReason
        : "";
      var hasPromptBlockReason = Boolean(promptBlockReason && promptBlockReason !== "BLOCK_REASON_UNSPECIFIED");
      if (hasPromptBlockReason) {
        hasMeta = true;
        terminal = true;
        setCompletionReason(promptBlockReason, "blocked");
      }
      if (candidate && typeof candidate === "object") {
        if ((typeof candidate.finishReason === "string" && candidate.finishReason)
          || (candidate.content && candidate.content.role === "model")) {
          hasMeta = true;
        }
        if (!hasPromptBlockReason && typeof candidate.finishReason === "string" && candidate.finishReason) {
          terminal = true;
          setCompletionReason(candidate.finishReason);
        }
      }
      if (candidate && candidate.content && Array.isArray(candidate.content.parts)) {
        var parts = candidate.content.parts;
        for (var g = 0; g < parts.length; g += 1) {
          var part = parts[g];
          if (!part || typeof part.text !== "string") {
            continue;
          }
          if (part.thought === true) {
            reasoning += part.text;
          } else {
            text += part.text;
          }
        }
      }
      return { text: text, reasoning: reasoning, done: done, error: errMessage, usage: usage, hasMeta: hasMeta, terminal: terminal, finishReason: finishReason, completionStatus: completionStatus };
    }

    return { text: text, reasoning: reasoning, done: done, error: "", usage: usage, hasMeta: hasMeta, terminal: terminal, finishReason: finishReason, completionStatus: completionStatus };
  }

  function looksLikeSsePayload(rawText) {
    return /^(?:data|event|id|retry):|^:/m.test(typeof rawText === "string" ? rawText : "");
  }

  function parseSseEventBlock(block) {
    var lines = block.split("\n");
    var eventName = "";
    var dataLines = [];
    for (var i = 0; i < lines.length; i += 1) {
      var line = lines[i];
      if (!line || line.charAt(0) === ":") {
        continue;
      }
      if (line.indexOf("event:") === 0) {
        eventName = line.slice(6).trim();
      } else if (line.indexOf("data:") === 0) {
        var val = line.slice(5);
        if (val.charAt(0) === " ") {
          val = val.slice(1);
        }
        dataLines.push(val);
      }
    }
    return {
      eventName: eventName,
      data: dataLines.join("\n")
    };
  }

  function applyNonSsePayload(rawText, format, apiKey, callbacks) {
    var trimmed = trimString(rawText);
    if (!trimmed) {
      return;
    }
    var parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (_err) {
      throw invalidResponseError(trimmed, format, apiKey);
    }
    var items = Array.isArray(parsed) ? parsed : [parsed];
    for (var i = 0; i < items.length; i += 1) {
      if (typeof callbacks.onPayload === "function") {
        callbacks.onPayload();
      }
      var extracted = extractFromChunk(format, "", items[i], apiKey);
      if (extracted.error) {
        throw AiProviderError("http_error", sanitizeSecretText(extracted.error, apiKey), {
          format: format,
          detail: sanitizeSecretText(extracted.error, apiKey)
        });
      }
      if (extracted.hasMeta && typeof callbacks.onMeta === "function") {
        callbacks.onMeta();
      }
      if (extracted.usage && typeof callbacks.onUsage === "function") {
        callbacks.onUsage(extracted.usage);
      }
      if ((extracted.finishReason || extracted.completionStatus !== "complete") && typeof callbacks.onCompletion === "function") {
        callbacks.onCompletion(extracted.completionStatus, extracted.finishReason);
      }
      if (extracted.reasoning) {
        callbacks.onReasoning(extracted.reasoning);
      }
      if (extracted.text) {
        callbacks.onText(extracted.text);
      }
    }
  }

  function consumeSseEvents(bufferObj, isFinal, format, apiKey, callbacks) {
    // A trailing CR may be the first half of a CRLF split across reads.
    var pendingCr = !isFinal && bufferObj.raw.slice(-1) === "\r";
    var raw = pendingCr ? bufferObj.raw.slice(0, -1) : bufferObj.raw;
    var normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    var blocks = normalized.split("\n\n");
    if (isFinal) {
      bufferObj.raw = "";
    } else {
      bufferObj.raw = (blocks.pop() || "") + (pendingCr ? "\r" : "");
    }

    for (var i = 0; i < blocks.length; i += 1) {
      var block = blocks[i];
      if (!block || !block.trim()) {
        continue;
      }
      if (typeof callbacks.onSseFrame === "function") {
        callbacks.onSseFrame();
      }
      var parsedEvent = parseSseEventBlock(block);
      if (!parsedEvent.data) {
        // SSE ignores unknown field names, including extension-only blocks.
        // Keep a bounded diagnostic only if the entire response has no data.
        if (!looksLikeSsePayload(block) && typeof callbacks.onIgnoredBlock === "function") {
          callbacks.onIgnoredBlock(block);
        }
        continue;
      }
      var trimmedData = parsedEvent.data.trim();
      if (trimmedData === "[DONE]") {
        if (typeof callbacks.onTerminal === "function") {
          callbacks.onTerminal();
        }
        return true;
      }
      var dataObj;
      try {
        dataObj = JSON.parse(trimmedData);
      } catch (_err) {
        throw invalidResponseError(trimmedData, format, apiKey);
      }
      if (typeof callbacks.onPayload === "function") {
        callbacks.onPayload();
      }
      var extracted = extractFromChunk(format, parsedEvent.eventName, dataObj, apiKey);
      if (extracted.error) {
        throw AiProviderError("http_error", sanitizeSecretText(extracted.error, apiKey), {
          format: format,
          detail: sanitizeSecretText(extracted.error, apiKey)
        });
      }
      if (extracted.hasMeta && typeof callbacks.onMeta === "function") {
        callbacks.onMeta();
      }
      if (extracted.terminal && typeof callbacks.onTerminal === "function") {
        callbacks.onTerminal();
      }
      if (extracted.usage && typeof callbacks.onUsage === "function") {
        callbacks.onUsage(extracted.usage);
      }
      if ((extracted.finishReason || extracted.completionStatus !== "complete") && typeof callbacks.onCompletion === "function") {
        callbacks.onCompletion(extracted.completionStatus, extracted.finishReason);
      }
      if (extracted.reasoning) {
        callbacks.onReasoning(extracted.reasoning);
      }
      if (extracted.text) {
        callbacks.onText(extracted.text);
      }
      if (extracted.done) {
        return true;
      }
    }
    return false;
  }

  function mergeUsage(prev, usage) {
    if (!usage || typeof usage !== "object") return prev;
    var next = { inputTokens: null, outputTokens: null, totalTokens: null };
    Object.keys(next).forEach(function (key) {
      var oldValue = prev ? usageCount(prev[key]) : null;
      var value = usageCount(usage[key]);
      next[key] = value === null ? oldValue : (oldValue === null ? value : Math.max(value, oldValue));
    });
    if (next.inputTokens !== null && next.outputTokens !== null) {
      var sum = usageCount(next.inputTokens + next.outputTokens);
      if (sum !== null) next.totalTokens = next.totalTokens === null ? sum : Math.max(next.totalTokens, sum);
    }
    return next;
  }

  function cancelReaderSafely(reader) {
    if (!reader || typeof reader.cancel !== "function") {
      return;
    }
    try {
      Promise.resolve(reader.cancel()).catch(function () {});
    } catch (_err) {
      // Ignore synchronous cancel error
    }
  }

  function isAbortError(err, signal) {
    if (signal && signal.aborted) {
      return true;
    }
    if (!err) {
      return false;
    }
    return err.name === "AbortError" || err.code === "aborted";
  }

  function streamChat(profileInput, payload) {
    var profile = normalizeProfile(profileInput);
    var opts = payload && typeof payload === "object" ? payload : {};
    var fetchImpl = opts.fetchImpl || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    if (typeof fetchImpl !== "function") {
      return Promise.reject(AiProviderError("network_error", "Fetch API is unavailable in this environment", {
        format: profile.format
      }));
    }

    var reqSpec;
    try {
      reqSpec = buildRequest(profile, opts);
    } catch (err) {
      return Promise.reject(err);
    }

    var signal = opts.signal;
    if (signal && signal.aborted) {
      return Promise.reject(AiProviderError("aborted", "Request aborted", { format: profile.format }));
    }

    var fullText = "";
    var fullReasoning = "";
    var latestUsage = null;
    var sawCompletionMeta = false;
    var sawSseStream = false;
    var sawSseFrame = false;
    var sawNonSsePayload = false;
    var sawTerminalCompletion = false;
    var sawParsedPayload = false;
    var ignoredBlockDetail = "";
    var completionStatus = "complete";
    var finishReason = "";
    var callbacks = {
      onMeta: function () {
        sawCompletionMeta = true;
      },
      onPayload: function () {
        sawParsedPayload = true;
        if (!sawSseFrame) {
          sawNonSsePayload = true;
        }
      },
      onIgnoredBlock: function (rawText) {
        if (!ignoredBlockDetail) ignoredBlockDetail = sanitizeResponseDetail(rawText, profile.apiKey);
      },
      onSseFrame: function () {
        sawSseStream = true;
        sawSseFrame = true;
      },
      onTerminal: function () {
        sawTerminalCompletion = true;
      },
      onCompletion: function (status, reason) {
        if (reason) {
          finishReason = reason;
        }
        if (status === "blocked" || (status === "truncated" && completionStatus !== "blocked")) {
          completionStatus = status;
        }
      },
      onText: function (delta) {
        if (!delta) {
          return;
        }
        fullText += delta;
        if (typeof opts.onDelta === "function") {
          opts.onDelta(delta, fullText);
        }
      },
      onReasoning: function (delta) {
        if (!delta) {
          return;
        }
        fullReasoning += delta;
        if (typeof opts.onReasoning === "function") {
          opts.onReasoning(delta, fullReasoning);
        }
      },
      onUsage: function (u) {
        latestUsage = mergeUsage(latestUsage, u);
      }
    };

    function notifyObserver(name, value) {
      try { if (typeof opts[name] === "function") opts[name](value); } catch (_ignored) { /* Optional statistics never affect requests. */ }
    }
    return Promise.resolve().then(function () {
      if (signal && signal.aborted) throw AiProviderError("aborted", "Request aborted", { format: profile.format });
      notifyObserver("onRequestStart");
      return fetchImpl(reqSpec.url, {
      method: reqSpec.method,
      headers: reqSpec.headers,
      body: reqSpec.bodyJson,
      signal: signal
      });
    }).then(function (response) {
      if (!response) {
        throw AiProviderError("network_error", "Empty response from network request", {
          format: profile.format
        });
      }

      if (!response.ok) {
        return response.text().then(function (errText) {
          throw buildHttpError(response.status, errText, profile.format, profile.apiKey);
        }, function () {
          throw buildHttpError(response.status, "", profile.format, profile.apiKey);
        });
      }

      var contentType = response.headers && typeof response.headers.get === "function"
        ? (response.headers.get("content-type") || "").toLowerCase()
        : "";
      if (contentType.indexOf("event-stream") !== -1) {
        sawSseStream = true;
      }
      var forceJsonFallback = opts.stream === false
        || (contentType.indexOf("application/json") !== -1 && contentType.indexOf("event-stream") === -1)
        || !response.body
        || typeof response.body.getReader !== "function";

      if (forceJsonFallback) {
        return response.text().then(function (rawText) {
          var trimmedRaw = rawText.trim();
          if (looksLikeSsePayload(rawText) && trimmedRaw.charAt(0) !== "{" && trimmedRaw.charAt(0) !== "[") {
            consumeSseEvents({ raw: rawText }, true, profile.format, profile.apiKey, callbacks);
          } else {
            applyNonSsePayload(rawText, profile.format, profile.apiKey, callbacks);
          }
          return finalizeStreamResult();
        });
      }

      var reader = response.body.getReader();
      var decoder = new TextDecoder("utf-8");
      var bufferObj = { raw: "" };
      var onAbortCancel = function () {
        cancelReaderSafely(reader);
      };
      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onAbortCancel, { once: true });
      }

      function cleanupAbortListener() {
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbortCancel);
        }
      }

      function pump() {
        return reader.read().then(function (step) {
          if (signal && signal.aborted) {
            cancelReaderSafely(reader);
            throw AiProviderError("aborted", "Generation aborted", { format: profile.format });
          }
          if (step.done) {
            bufferObj.raw += decoder.decode();
            var trimmedBuf = bufferObj.raw.trim();
            if (trimmedBuf && (trimmedBuf.charAt(0) === "{" || trimmedBuf.charAt(0) === "[") && !looksLikeSsePayload(trimmedBuf)) {
              applyNonSsePayload(trimmedBuf, profile.format, profile.apiKey, callbacks);
            } else if (trimmedBuf && !looksLikeSsePayload(trimmedBuf) && !sawSseFrame) {
              throw invalidResponseError(trimmedBuf, profile.format, profile.apiKey);
            } else {
              consumeSseEvents(bufferObj, true, profile.format, profile.apiKey, callbacks);
            }
            return finalizeStreamResult();
          }

          bufferObj.raw += decoder.decode(step.value, { stream: true });
          var pendingText = bufferObj.raw.replace(/^\s+/, "");
          if (!sawSseFrame && contentType.indexOf("event-stream") === -1 && /^(?:\{|\[)/.test(pendingText)) {
            return pump();
          }
          var stopped = consumeSseEvents(bufferObj, false, profile.format, profile.apiKey, callbacks);
          if (stopped) {
            cancelReaderSafely(reader);
            return finalizeStreamResult();
          }
          return pump();
        });
      }

      function finalizeStreamResult() {
        var allowEmpty = Boolean(opts.allowEmptyOutput) && (sawCompletionMeta || Boolean(latestUsage));
        if (!sawParsedPayload && ignoredBlockDetail) {
          throw invalidResponseError(ignoredBlockDetail, profile.format, profile.apiKey);
        }
        if (sawSseStream && !sawNonSsePayload && !sawTerminalCompletion) {
          if (!fullText && !fullReasoning) {
            throw AiProviderError("response_incomplete", "Provider stream ended before a terminal completion marker", {
              format: profile.format,
              detail: "stream_closed"
            });
          }
          completionStatus = "truncated";
          finishReason = "stream_closed";
        }
        if (!fullText && !fullReasoning && completionStatus === "blocked") {
          throw AiProviderError("content_blocked", "Model output was blocked by a safety policy", {
            format: profile.format,
            detail: finishReason
          });
        }
        if (!fullText && !fullReasoning && completionStatus === "truncated") {
          throw AiProviderError("output_truncated", "Model output was truncated before producing content", {
            format: profile.format,
            detail: finishReason
          });
        }
        if (!fullText && !fullReasoning && !allowEmpty) {
          throw AiProviderError("empty_response", "Model returned an empty response", {
            format: profile.format
          });
        }
        return {
          text: fullText,
          reasoning: fullReasoning,
          usage: latestUsage,
          format: profile.format,
          model: profile.model,
          completionStatus: completionStatus,
          finishReason: finishReason
        };
      }

      return pump().then(function (res) {
        cleanupAbortListener();
        return res;
      }, function (pumpErr) {
        cleanupAbortListener();
        throw pumpErr;
      });
    }).catch(function (err) {
      if (isAbortError(err, signal)) {
        throw AiProviderError("aborted", "Generation stopped", {
          format: profile.format,
          cause: err
        });
      }
      if (err && err.name === "AiProviderError") {
        throw err;
      }
      var safeMsg = sanitizeSecretText(err && err.message ? err.message : "Network request failed", profile.apiKey);
      throw AiProviderError("network_error", safeMsg, {
        format: profile.format,
        detail: safeMsg,
        cause: err
      });
    }).then(function (result) {
      notifyObserver("onRequestEnd", { usage: latestUsage, complete: result.completionStatus === "complete" && !(signal && signal.aborted) && (sawTerminalCompletion || sawNonSsePayload) });
      return result;
    }, function (error) {
      notifyObserver("onRequestEnd", { usage: null, complete: false });
      throw error;
    });
  }

  function normalizeModelCatalogKey(model) {
    var lower = trimString(model).toLowerCase();
    if (!lower) {
      return "";
    }
    var slashIdx = lower.lastIndexOf("/");
    if (slashIdx !== -1 && slashIdx < lower.length - 1) {
      lower = lower.slice(slashIdx + 1);
    }
    var colonIdx = lower.indexOf(":");
    if (colonIdx !== -1 && lower.indexOf(":1m") === -1) {
      lower = lower.slice(0, colonIdx);
    }
    return lower;
  }

  // Verified 2026-11-15 against official model specifications. See docs/ai-model-context.md.
  // Exact IDs keep future variants and specialised models out of broad family guesses.
  var MODEL_CONTEXT_WINDOWS = {
    "gpt-5.6": 1050000,
    "gpt-5.6-sol": 1050000,
    "gpt-5.6-terra": 1050000,
    "gpt-5.6-luna": 1050000,
    "gpt-6-sol": 1050000,
    "gpt-6-astra": 1050000,
    "gpt-6-luna": 1050000,
    "gpt-6.1-sol": 1050000,
    "gpt-6.1-terra": 1050000,
    "claude-fable-5": 1000000,
    "claude-fable-5-1": 1000000,
    "claude-fable-5-2": 1000000,
    "claude-mythos-preview": 1000000,
    "claude-mythos-5": 1000000,
    "claude-mythos-5-1": 1000000,
    "claude-mythos-5-2": 1000000,
    "claude-opus-4-6": 1000000,
    "claude-opus-4-7": 1000000,
    "claude-opus-4-8": 1000000,
    "claude-opus-5": 1000000,
    "claude-opus-5-5": 1000000,
    "claude-sonnet-4-6": 1000000,
    "claude-sonnet-5": 1000000,
    "claude-sonnet-5-5": 1000000,
    "claude-haiku-5-5": 1000000,
    "gemini-4-carbon": 1048576,
    "gemini-4-argon": 1048576,
    "gemini-4-hydrogen": 1048576,
    "gemini-3.8-flash": 1048576,
    "gemini-3.6-flash": 1048576,
    "gemini-3.5-flash-lite": 1048576,
    "gemini-3.1-flash-lite": 1048576,
    "gemini-3.1-flash-lite-preview": 1048576,
    "gemini-3.1-pro-preview": 1048576,
    "gemini-3-flash-preview": 1048576,
    "gemini-3-pro-preview": 1048576,
    "gemini-2.5-pro": 1048576,
    "gemini-2.5-flash": 1048576,
    "gemini-2.5-flash-lite": 1048576
  };

  function inferModelContextWindow(model, format) {
    var key = normalizeModelCatalogKey(model);
    if (Object.prototype.hasOwnProperty.call(MODEL_CONTEXT_WINDOWS, key)) {
      return { contextWindow: MODEL_CONTEXT_WINDOWS[key], source: "catalog" };
    }
    if (key) {
      if (key.indexOf("gemini-1.5-pro") === 0) {
        return { contextWindow: 2097152, source: "catalog" };
      }
      if (/^gemini-(?:2\.0-flash(?:-lite)?(?:-001)?|1\.5-flash(?:-8b)?(?:-00[12])?|flash-latest|flash-lite-latest|pro-latest)$/.test(key)) {
        return { contextWindow: 1048576, source: "catalog" };
      }
      if (/^claude-(?:opus-(?:4|4-1|4-5)|sonnet-(?:4|4-5)|haiku-4-5|3(?:-5|-7)?-(?:opus|sonnet|haiku))(?:-\d{8}|-latest)?$/.test(key)) {
        return { contextWindow: 200000, source: "catalog" };
      }
      if (key.indexOf("gpt-4.1") === 0) {
        return { contextWindow: 1047576, source: "catalog" };
      }
      if (/^gpt-5(?:$|[-_]|\.[0-5](?:$|[-_]))/.test(key)) {
        return { contextWindow: 400000, source: "catalog" };
      }
      if (/^(?:o1|o3|o4)(?:$|[-_])/.test(key)) {
        return { contextWindow: 200000, source: "catalog" };
      }
      if (/^(?:gpt-4o|chatgpt-4o|gpt-4-turbo|gpt-4-1106|gpt-4-0125)/.test(key)) {
        return { contextWindow: 128000, source: "catalog" };
      }
      if (key.indexOf("gpt-4-32k") === 0) {
        return { contextWindow: 32768, source: "catalog" };
      }
      if (key === "gpt-4" || /^gpt-4[-_](?:0314|0613)/.test(key)) {
        return { contextWindow: 8192, source: "catalog" };
      }
      if (key.indexOf("gpt-3.5") === 0) {
        return { contextWindow: 16385, source: "catalog" };
      }
      if (key.indexOf("deepseek") === 0) {
        return { contextWindow: 65536, source: "catalog" };
      }
      if (key.indexOf("qwen-long") === 0) {
        return { contextWindow: 1000000, source: "catalog" };
      }
      if (/^(?:qwen3|qwen2\.5|qwen-max|qwen-plus|qwen-turbo|qwq)/.test(key)) {
        return { contextWindow: 131072, source: "catalog" };
      }
      if (key.indexOf("kimi-k2") === 0 || key.indexOf("moonshot-v1-128k") === 0) {
        return { contextWindow: 131072, source: "catalog" };
      }
      if (key.indexOf("moonshot-v1-32k") === 0) {
        return { contextWindow: 32768, source: "catalog" };
      }
      if (key.indexOf("moonshot-v1-8k") === 0) {
        return { contextWindow: 8192, source: "catalog" };
      }
      if (key.indexOf("glm-4-long") === 0) {
        return { contextWindow: 1000000, source: "catalog" };
      }
      if (key.indexOf("glm-4") === 0 || key.indexOf("glm-z1") === 0) {
        return { contextWindow: 128000, source: "catalog" };
      }
      if (key.indexOf("grok-4") === 0) {
        return { contextWindow: 256000, source: "catalog" };
      }
      if (key.indexOf("grok-3") === 0 || key.indexOf("grok-2") === 0) {
        return { contextWindow: 131072, source: "catalog" };
      }
      if (/^(?:llama-4|llama-3\.[123]|mistral-large|codestral)/.test(key)) {
        return { contextWindow: 128000, source: "catalog" };
      }
    }

    if (format === "gemini-aistudio" || format === "gemini-vertex") {
      return { contextWindow: 1048576, source: "default" };
    }
    if (format === "anthropic-messages") {
      return { contextWindow: 200000, source: "default" };
    }
    return { contextWindow: 32768, source: "default" };
  }

  function resolveContextWindow(profileInput) {
    var profile = normalizeProfile(profileInput);
    if (profile.contextWindowSource === "manual" && profile.contextWindow >= 1024) {
      return { contextWindow: profile.contextWindow, source: "manual" };
    }
    if (profile.contextWindowSource === "api" && profile.detectedContextWindow >= 1024) {
      return { contextWindow: profile.detectedContextWindow, source: "api" };
    }
    if (profile.contextWindow >= 1024) {
      return {
        contextWindow: profile.contextWindow,
        source: profile.contextWindowSource || "manual"
      };
    }
    return inferModelContextWindow(profile.model, profile.format);
  }

  function pickLargestPositiveInt(candidates) {
    for (var i = 0; i < candidates.length; i += 1) {
      var n = normalizePositiveInt(candidates[i], 1024);
      if (n >= 1024) {
        return n;
      }
    }
    return 0;
  }

  function extractContextWindowFromModelObject(obj, targetModel) {
    if (!obj || typeof obj !== "object") {
      return null;
    }

    if (Array.isArray(obj.data) || Array.isArray(obj.models)) {
      var list = Array.isArray(obj.data) ? obj.data : obj.models;
      var normTarget = trimString(targetModel).toLowerCase();
      var shortTarget = normalizeModelCatalogKey(targetModel);
      for (var i = 0; i < list.length; i += 1) {
        var item = list[i];
        if (!item || typeof item !== "object") {
          continue;
        }
        var candId = trimString(item.id || item.name).toLowerCase();
        if (normTarget && candId === normTarget) {
          var exactMatched = extractContextWindowFromModelObject(item, targetModel);
          if (exactMatched) {
            return exactMatched;
          }
        }
      }
      if (shortTarget) {
        for (var j = 0; j < list.length; j += 1) {
          var fallbackItem = list[j];
          if (!fallbackItem || typeof fallbackItem !== "object") {
            continue;
          }
          var candShort = normalizeModelCatalogKey(fallbackItem.id || fallbackItem.name);
          if (candShort === shortTarget) {
            var shortMatched = extractContextWindowFromModelObject(fallbackItem, targetModel);
            if (shortMatched) {
              return shortMatched;
            }
          }
        }
      }
      return null;
    }

    var ctx = pickLargestPositiveInt([
      obj.inputTokenLimit,
      obj.max_input_tokens,
      obj.context_length,
      obj.context_window,
      obj.max_context_length,
      obj.input_token_limit,
      obj.max_model_len,
      obj.n_ctx,
      obj.top_provider && obj.top_provider.context_length,
      obj.limits && obj.limits.context_window,
      obj.limits && obj.limits.max_input_tokens,
      obj.limit && obj.limit.context,
      obj.model_info && obj.model_info.max_input_tokens
    ]);
    if (!ctx) {
      return null;
    }
    var outMax = normalizePositiveInt(
      obj.outputTokenLimit
        || obj.max_output_tokens
        || obj.max_tokens
        || (obj.top_provider && obj.top_provider.max_completion_tokens)
        || (obj.limit && obj.limit.output),
      1
    );
    return {
      contextWindow: ctx,
      maxOutputTokens: outMax > 0 ? outMax : null
    };
  }

  function replaceUrlPathname(rawUrl, replacer) {
    try {
      var parsed = new URL(rawUrl);
      stripQuerySecrets(parsed);
      parsed.pathname = replacer(normalizeUrlPathname(parsed.pathname));
      return parsed.toString();
    } catch (_err) {
      return replacer(rawUrl);
    }
  }

  function buildModelMetadataRequests(profile) {
    var format = profile.format;
    var model = trimString(profile.model);
    if (!model) {
      return [];
    }
    var encodedModel = encodeURIComponent(model);
    if (format === "openai-chat" || format === "openai-responses") {
      var oaEndpoint = format === "openai-responses"
        ? buildOpenAiUrl(profile.baseUrl, "/responses", "/v1")
        : buildOpenAiUrl(profile.baseUrl, "/chat/completions", "/v1");
      var oaSuffixRe = format === "openai-responses" ? /\/responses$/ : /\/chat\/completions$/;
      var oaHeaders = { "Authorization": "Bearer " + profile.apiKey };
      return [
        {
          url: replaceUrlPathname(oaEndpoint, function (p) {
            return p.replace(oaSuffixRe, "") + "/models/" + encodedModel;
          }),
          headers: oaHeaders
        },
        {
          url: replaceUrlPathname(oaEndpoint, function (p) {
            return p.replace(oaSuffixRe, "") + "/models";
          }),
          headers: oaHeaders
        }
      ];
    }
    if (format === "anthropic-messages") {
      var anthEndpoint = buildAnthropicUrl(profile.baseUrl);
      return [{
        url: replaceUrlPathname(anthEndpoint, function (p) {
          return p.replace(/\/messages$/, "") + "/models/" + encodedModel;
        }),
        headers: {
          "x-api-key": profile.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        }
      }];
    }
    if (format === "gemini-aistudio") {
      var studioEndpoint = buildAiStudioUrl(profile.baseUrl, model, false);
      return [{
        url: replaceUrlPathname(studioEndpoint, function (p) {
          return p.replace(/:(?:streamGenerateContent|generateContent)$/i, "");
        }),
        headers: { "x-goog-api-key": profile.apiKey }
      }];
    }
    if (format === "gemini-vertex") {
      var vertexEndpoint = buildVertexUrl(profile, false);
      return [{
        url: replaceUrlPathname(vertexEndpoint, function (p) {
          return p.replace(/:(?:streamGenerateContent|generateContent)$/i, "");
        }),
        headers: { "x-goog-api-key": profile.apiKey }
      }];
    }
    return [];
  }

  function fetchModelContextWindow(profileInput, options) {
    var profile = normalizeProfile(profileInput);
    var opts = options && typeof options === "object" ? options : {};
    var fallback = inferModelContextWindow(profile.model, profile.format);
    var fallbackResult = {
      contextWindow: fallback.contextWindow,
      maxOutputTokens: null,
      source: fallback.source,
      live: false
    };

    var fetchImpl = opts.fetchImpl || (typeof global.fetch === "function" ? global.fetch.bind(global) : null);
    var urlCheck = validateHttpUrl(profile.baseUrl);
    if (typeof fetchImpl !== "function" || !urlCheck.ok || !trimString(profile.apiKey) || !trimString(profile.model)) {
      return Promise.resolve(fallbackResult);
    }

    var candidates = buildModelMetadataRequests(profile);
    if (candidates.length === 0) {
      return Promise.resolve(fallbackResult);
    }

    var timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 8000;
    var controller = !opts.signal && typeof AbortController === "function" ? new AbortController() : null;
    var signal = opts.signal || (controller ? controller.signal : undefined);
    var timerId = controller
      ? setTimeout(function () {
        try {
          controller.abort();
        } catch (_err) {}
      }, timeoutMs)
      : null;

    function tryNext(idx) {
      if (idx >= candidates.length) {
        return Promise.resolve(fallbackResult);
      }
      var req = candidates[idx];
      return fetchImpl(req.url, {
        method: "GET",
        headers: req.headers,
        signal: signal
      }).then(function (resp) {
        if (!resp || !resp.ok) {
          return tryNext(idx + 1);
        }
        return resp.text().then(function (raw) {
          try {
            var parsed = JSON.parse(raw);
            var found = extractContextWindowFromModelObject(parsed, profile.model);
            if (found && found.contextWindow >= 1024) {
              return {
                contextWindow: found.contextWindow,
                maxOutputTokens: found.maxOutputTokens,
                source: "api",
                live: true
              };
            }
          } catch (_err) {
            // Ignore malformed JSON metadata response
          }
          return tryNext(idx + 1);
        });
      }).catch(function () {
        return tryNext(idx + 1);
      });
    }

    return tryNext(0).then(function (result) {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      return result;
    }, function () {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      return fallbackResult;
    });
  }

  function cleanTranscriptMessages(messages) {
    if (!Array.isArray(messages)) {
      return [];
    }
    var out = [];
    for (var i = 0; i < messages.length; i += 1) {
      var msg = messages[i];
      if (!msg || typeof msg !== "object") {
        continue;
      }
      var role = msg.role === "assistant" ? "assistant" : (msg.role === "system" ? "system" : "user");
      var content = typeof msg.content === "string" ? msg.content : String(msg.content || "");
      if (!content.trim()) {
        continue;
      }
      out.push({
        role: role,
        content: content
      });
    }
    return out;
  }

  function compressMessages(profileInput, options) {
    var profile = normalizeProfile(profileInput);
    var opts = options && typeof options === "object" ? options : {};
    var isEnglish = opts.locale === "en";
    var msgs = cleanTranscriptMessages(opts.messages);
    var previousSummary = trimString(opts.previousSummary);

    var transcriptLines = [];
    if (previousSummary) {
      transcriptLines.push(isEnglish
        ? ("[Previous Summary]\n" + previousSummary)
        : ("【此前摘要】\n" + previousSummary));
    }
    for (var i = 0; i < msgs.length; i += 1) {
      var m = msgs[i];
      if (m.role === "system") {
        continue;
      }
      var speaker = m.role === "assistant"
        ? (isEnglish ? "Assistant" : "助手")
        : (isEnglish ? "User" : "用户");
      transcriptLines.push(speaker + ": " + m.content);
    }

    var systemInstruction = isEnglish
      ? "You are a precise conversation memory compressor for a divination & general assistant chat. Condense the earlier transcript into a concise structured summary (under 450 words) that preserves: (1) the user's core questions and practical background, (2) specific cards, spread positions, stacked Cause->Manifestation pairs, and conclusions established so far, and (3) unresolved follow-ups or user preferences. Output only the factual summary in the primary language of the conversation."
      : "你是一个精确的对话记忆浓缩器。请将以下较早的对话记录压缩成简洁、保留重点的结构化摘要（控制在 500 字以内），务必保留：(1) 用户的核心问题与现实背景；(2) 已讨论过的具体牌名、牌位、叠牌法“底牌(因)/叠牌(果)”组合与核心解牌结论；(3) 尚未完结的追问脉络或用户偏好。只输出客观摘要正文，使用对话主要语言，不要寒暄或添加元说明。";

    var skipLowTemperature = isOpenAiReasoningModel(profile.model)
      && (profile.format === "openai-chat" || profile.format === "openai-responses");
    var compressionProfile = Object.assign({}, profile, {
      temperature: skipLowTemperature ? null : 0.2,
      maxTokens: 2048
    });

    return streamChat(compressionProfile, {
      systemPrompt: systemInstruction,
      messages: [{
        role: "user",
        content: transcriptLines.join("\n\n")
      }],
      stream: opts.stream !== undefined ? opts.stream : true,
      signal: opts.signal,
      fetchImpl: opts.fetchImpl,
      onRequestStart: opts.onRequestStart,
      onRequestEnd: opts.onRequestEnd
    }).then(function (res) {
      return {
        summaryText: trimString(res.text),
        usage: res.usage || null
      };
    });
  }

  function testConnection(profileInput, options) {
    var opts = options && typeof options === "object" ? options : {};
    var profile = normalizeProfile(profileInput);
    var callerSignal = opts.signal;
    if (callerSignal && callerSignal.aborted) {
      return Promise.reject(AiProviderError("aborted", "Request aborted", { format: profile.format }));
    }

    var probeProfile = Object.assign({}, profile, {
      maxTokens: 256,
      temperature: null
    });

    var timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TEST_TIMEOUT_MS;
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var effectiveSignal = controller ? controller.signal : callerSignal;
    var timedOut = false;
    var onCallerAbort = null;

    if (callerSignal && controller && typeof callerSignal.addEventListener === "function") {
      onCallerAbort = function () {
        try {
          controller.abort();
        } catch (_err) {}
      };
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }

    var timeoutReject = null;
    var timeoutPromise = new Promise(function (_resolve, reject) {
      timeoutReject = reject;
    });

    var timerId = setTimeout(function () {
      timedOut = true;
      if (controller) {
        try {
          controller.abort();
        } catch (_err) {}
      }
      if (timeoutReject) {
        timeoutReject(AiProviderError("timeout", "Connection test timed out after " + timeoutMs + "ms", {
          format: profile.format,
          detail: "timeout"
        }));
      }
    }, timeoutMs);

    function cleanup() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (callerSignal && onCallerAbort && typeof callerSignal.removeEventListener === "function") {
        callerSignal.removeEventListener("abort", onCallerAbort);
      }
    }

    var streamPromise = streamChat(probeProfile, {
      systemPrompt: "You are a connectivity probe.",
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: opts.stream !== undefined ? opts.stream : true,
      allowEmptyOutput: true,
      signal: effectiveSignal,
      fetchImpl: opts.fetchImpl
    });
    streamPromise.catch(function () {});

    return Promise.race([streamPromise, timeoutPromise]).then(function (result) {
      cleanup();
      return {
        ok: true,
        format: result.format,
        model: result.model,
        reply: result.text || result.reasoning || "OK",
        usage: result.usage || null
      };
    }, function (err) {
      cleanup();
      if (timedOut && !(callerSignal && callerSignal.aborted)) {
        throw AiProviderError("timeout", "Connection test timed out after " + timeoutMs + "ms", {
          format: profile.format,
          detail: "timeout",
          cause: err
        });
      }
      throw err;
    });
  }

  var api = {
    STORAGE_KEY: STORAGE_KEY,
    FORMAT_IDS: FORMAT_IDS.slice(),
    DEFAULT_BASE_URLS: Object.assign({}, DEFAULT_BASE_URLS),
    DEFAULT_MODELS: Object.assign({}, DEFAULT_MODELS),
    AiProviderError: AiProviderError,
    createDefaultProfile: createDefaultProfile,
    normalizeProfile: normalizeProfile,
    normalizeConfig: normalizeConfig,
    validateProfile: validateProfile,
    redactApiKey: redactApiKey,
    createConfigStore: createConfigStore,
    inferModelContextWindow: inferModelContextWindow,
    resolveContextWindow: resolveContextWindow,
    fetchModelContextWindow: fetchModelContextWindow,
    compressMessages: compressMessages,
    buildRequest: buildRequest,
    streamChat: streamChat,
    testConnection: testConnection
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.DivinationAiProviders = api;
})(typeof window !== "undefined" ? window : globalThis);
