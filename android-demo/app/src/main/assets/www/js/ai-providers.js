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
    } else if (detectedContextWindow >= 1024) {
      contextWindowSource = "api";
    } else if (rawSource === "catalog" || rawSource === "default") {
      contextWindowSource = rawSource;
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
    var key = trimString(apiKey);
    if (key && key.length >= 6 && output.indexOf(key) !== -1) {
      output = output.split(key).join(redactApiKey(key));
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

  function buildOpenAiUrl(baseUrl, suffixPath, defaultHostPath) {
    var clean = stripTrailingSlashes(baseUrl);
    if (clean.slice(-suffixPath.length) === suffixPath) {
      return clean;
    }
    try {
      var parsed = new URL(clean);
      if (parsed.hostname.toLowerCase() === "api.openai.com" && (parsed.pathname === "" || parsed.pathname === "/")) {
        return clean + defaultHostPath + suffixPath;
      }
    } catch (_err) {
      // Ignore malformed URL here; validateProfile reports it separately.
    }
    return clean + suffixPath;
  }

  function buildAnthropicUrl(baseUrl) {
    var clean = stripTrailingSlashes(baseUrl);
    if (clean.slice(-9) === "/messages") {
      return clean;
    }
    try {
      var parsed = new URL(clean);
      if (parsed.hostname.toLowerCase() === "api.anthropic.com" && (parsed.pathname === "" || parsed.pathname === "/")) {
        return clean + "/v1/messages";
      }
    } catch (_err) {
      // Ignore
    }
    return clean + "/messages";
  }

  function buildAiStudioUrl(baseUrl, model, stream) {
    var clean = stripTrailingSlashes(baseUrl);
    var method = stream ? "streamGenerateContent" : "generateContent";
    if (clean.indexOf(":streamGenerateContent") !== -1 || clean.indexOf(":generateContent") !== -1) {
      return stream ? appendAltSse(clean) : clean;
    }
    try {
      var parsed = new URL(clean);
      if (parsed.hostname.toLowerCase() === "generativelanguage.googleapis.com" && (parsed.pathname === "" || parsed.pathname === "/")) {
        clean += "/v1beta";
      }
    } catch (_err) {
      // Ignore
    }
    var safeModel = encodeURIComponent(cleanGeminiModelName(model));
    var url = clean + "/models/" + safeModel + ":" + method;
    return stream ? appendAltSse(url) : url;
  }

  function buildVertexUrl(profile, stream) {
    var clean = stripTrailingSlashes(profile.baseUrl || DEFAULT_BASE_URLS["gemini-vertex"]);
    var method = stream ? "streamGenerateContent" : "generateContent";
    if (clean.indexOf(":streamGenerateContent") !== -1 || clean.indexOf(":generateContent") !== -1) {
      return stream ? appendAltSse(clean) : clean;
    }
    var safeModel = encodeURIComponent(cleanGeminiModelName(profile.model));
    var project = trimString(profile.vertexProject);
    var location = trimString(profile.vertexLocation);

    try {
      var parsed = new URL(clean);
      var host = parsed.hostname.toLowerCase();
      if (host === "aiplatform.googleapis.com" && (parsed.pathname === "" || parsed.pathname === "/")) {
        clean += "/v1";
        parsed = new URL(clean);
      }
      if (project && host === "aiplatform.googleapis.com" && location && location.toLowerCase() !== "global") {
        parsed.hostname = location + "-aiplatform.googleapis.com";
        clean = stripTrailingSlashes(parsed.toString());
      }
    } catch (_err) {
      // Ignore
    }

    var url;
    if (clean.indexOf("/publishers/") !== -1) {
      url = clean + "/models/" + safeModel + ":" + method;
    } else if (project) {
      var effLocation = location || "us-central1";
      url = clean
        + "/projects/" + encodeURIComponent(project)
        + "/locations/" + encodeURIComponent(effLocation)
        + "/publishers/google/models/" + safeModel + ":" + method;
    } else {
      url = clean + "/publishers/google/models/" + safeModel + ":" + method;
    }
    return stream ? appendAltSse(url) : url;
  }

  function sanitizeMessages(messages) {
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

  function buildGeminiPayload(profile, systemPrompt, messages) {
    var contents = [];
    for (var i = 0; i < messages.length; i += 1) {
      var m = messages[i];
      if (m.role === "system") {
        continue;
      }
      contents.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      });
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
    var systemPrompt = typeof opts.systemPrompt === "string" ? opts.systemPrompt : "";
    var messages = sanitizeMessages(opts.messages);
    var stream = opts.stream !== false;
    var format = profile.format;
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
      for (var i = 0; i < messages.length; i += 1) {
        chatMessages.push(messages[i]);
      }
      body = {
        model: profile.model,
        messages: chatMessages,
        stream: stream
      };
      if (typeof profile.temperature === "number" && Number.isFinite(profile.temperature)) {
        body.temperature = profile.temperature;
      }
      if (typeof profile.maxTokens === "number" && Number.isFinite(profile.maxTokens) && profile.maxTokens > 0) {
        body.max_tokens = profile.maxTokens;
      }
    } else if (format === "openai-responses") {
      url = buildOpenAiUrl(profile.baseUrl, "/responses", "/v1");
      headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + profile.apiKey
      };
      var respInput = [];
      for (var j = 0; j < messages.length; j += 1) {
        if (messages[j].role === "system") {
          continue;
        }
        respInput.push({
          role: messages[j].role,
          content: messages[j].content
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
        body.temperature = profile.temperature;
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
      for (var k = 0; k < messages.length; k += 1) {
        if (messages[k].role === "system") {
          continue;
        }
        anthMessages.push({
          role: messages[k].role,
          content: messages[k].content
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
      body = buildGeminiPayload(profile, systemPrompt, messages);
    } else if (format === "gemini-vertex") {
      url = buildVertexUrl(profile, stream);
      // Vertex AI static API key mode only; strictly no OAuth Bearer header.
      headers = {
        "content-type": "application/json",
        "x-goog-api-key": profile.apiKey
      };
      body = buildGeminiPayload(profile, systemPrompt, messages);
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
    var detail = cleanText;
    if (cleanText) {
      try {
        var parsed = JSON.parse(cleanText);
        var extracted = extractErrorMessageFromJson(parsed);
        if (extracted) {
          detail = extracted;
        }
      } catch (_err) {
        detail = cleanText.slice(0, 400);
      }
    }
    detail = sanitizeSecretText(detail, apiKey);
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

  function extractUsageObject(format, dataObj) {
    if (!dataObj || typeof dataObj !== "object") {
      return null;
    }
    var inputTokens = 0;
    var outputTokens = 0;
    var totalTokens = 0;
    var found = false;

    if (format === "openai-chat" && dataObj.usage && typeof dataObj.usage === "object") {
      var uChat = dataObj.usage;
      inputTokens = Number(uChat.prompt_tokens) || Number(uChat.input_tokens) || 0;
      outputTokens = Number(uChat.completion_tokens) || Number(uChat.output_tokens) || 0;
      totalTokens = Number(uChat.total_tokens) || (inputTokens + outputTokens);
      found = inputTokens > 0 || outputTokens > 0 || totalTokens > 0;
    } else if (format === "openai-responses") {
      var uResp = (dataObj.response && dataObj.response.usage) || dataObj.usage;
      if (uResp && typeof uResp === "object") {
        inputTokens = Number(uResp.input_tokens) || Number(uResp.prompt_tokens) || 0;
        outputTokens = Number(uResp.output_tokens) || Number(uResp.completion_tokens) || 0;
        totalTokens = Number(uResp.total_tokens) || (inputTokens + outputTokens);
        found = inputTokens > 0 || outputTokens > 0 || totalTokens > 0;
      }
    } else if (format === "anthropic-messages") {
      var uMsg = dataObj.message && dataObj.message.usage;
      var uDelta = dataObj.usage;
      if (uMsg && typeof uMsg === "object") {
        inputTokens += (Number(uMsg.input_tokens) || 0)
          + (Number(uMsg.cache_creation_input_tokens) || 0)
          + (Number(uMsg.cache_read_input_tokens) || 0);
        outputTokens += Number(uMsg.output_tokens) || 0;
        found = true;
      }
      if (uDelta && typeof uDelta === "object") {
        var deltaIn = (Number(uDelta.input_tokens) || 0)
          + (Number(uDelta.cache_creation_input_tokens) || 0)
          + (Number(uDelta.cache_read_input_tokens) || 0);
        if (deltaIn > inputTokens) {
          inputTokens = deltaIn;
        }
        if ((Number(uDelta.output_tokens) || 0) > outputTokens) {
          outputTokens = Number(uDelta.output_tokens) || 0;
        }
        found = true;
      }
      totalTokens = inputTokens + outputTokens;
      found = found && (totalTokens > 0);
    } else if ((format === "gemini-aistudio" || format === "gemini-vertex")
      && dataObj.usageMetadata && typeof dataObj.usageMetadata === "object") {
      var uGem = dataObj.usageMetadata;
      inputTokens = Number(uGem.promptTokenCount) || 0;
      outputTokens = Number(uGem.candidatesTokenCount) || 0;
      totalTokens = Number(uGem.totalTokenCount) || (inputTokens + outputTokens);
      if (!outputTokens && totalTokens > inputTokens) {
        outputTokens = totalTokens - inputTokens;
      }
      found = inputTokens > 0 || outputTokens > 0 || totalTokens > 0;
    }

    if (!found) {
      return null;
    }
    return {
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      totalTokens: totalTokens || (inputTokens + outputTokens)
    };
  }

  function extractFromChunk(format, eventName, dataObj) {
    var text = "";
    var reasoning = "";
    var done = false;
    var errMessage = "";
    var usage = extractUsageObject(format, dataObj);

    if (!dataObj || typeof dataObj !== "object") {
      return { text: text, reasoning: reasoning, done: done, error: errMessage, usage: null };
    }

    if (dataObj.error) {
      errMessage = extractErrorMessageFromJson(dataObj) || "Stream error";
      return { text: "", reasoning: "", done: false, error: errMessage, usage: usage };
    }

    if (format === "openai-chat") {
      var choices = Array.isArray(dataObj.choices) ? dataObj.choices : [];
      var choice = choices[0];
      if (choice && typeof choice === "object") {
        var delta = choice.delta;
        if (delta && typeof delta === "object") {
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
      return { text: text, reasoning: reasoning, done: done, error: "", usage: usage };
    }

    if (format === "openai-responses") {
      var evType = trimString(dataObj.type) || trimString(eventName);
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
      return { text: text, reasoning: reasoning, done: done, error: errMessage, usage: usage };
    }

    if (format === "anthropic-messages") {
      var aType = trimString(dataObj.type) || trimString(eventName);
      if (aType === "content_block_delta" && dataObj.delta && typeof dataObj.delta === "object") {
        if (dataObj.delta.type === "text_delta" && typeof dataObj.delta.text === "string") {
          text += dataObj.delta.text;
        } else if (dataObj.delta.type === "thinking_delta" && typeof dataObj.delta.thinking === "string") {
          reasoning += dataObj.delta.thinking;
        }
      } else if (aType === "message_stop") {
        done = true;
      } else if (aType === "error") {
        errMessage = extractErrorMessageFromJson(dataObj) || "Anthropic stream error";
      } else if (Array.isArray(dataObj.content)) {
        for (var a = 0; a < dataObj.content.length; a += 1) {
          var block = dataObj.content[a];
          if (!block || typeof block !== "object") {
            continue;
          }
          if (block.type === "text" && typeof block.text === "string") {
            text += block.text;
          } else if (block.type === "thinking" && typeof block.thinking === "string") {
            reasoning += block.thinking;
          }
        }
      }
      return { text: text, reasoning: reasoning, done: done, error: errMessage, usage: usage };
    }

    if (format === "gemini-aistudio" || format === "gemini-vertex") {
      var candidates = Array.isArray(dataObj.candidates) ? dataObj.candidates : [];
      var candidate = candidates[0];
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
      return { text: text, reasoning: reasoning, done: done, error: errMessage, usage: usage };
    }

    return { text: text, reasoning: reasoning, done: done, error: "", usage: usage };
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
    } catch (err) {
      throw AiProviderError("parse_error", "Failed to parse provider JSON response", {
        format: format,
        detail: err && err.message ? err.message : "",
        cause: err
      });
    }
    var items = Array.isArray(parsed) ? parsed : [parsed];
    for (var i = 0; i < items.length; i += 1) {
      var extracted = extractFromChunk(format, "", items[i]);
      if (extracted.error) {
        throw AiProviderError("http_error", sanitizeSecretText(extracted.error, apiKey), {
          format: format,
          detail: sanitizeSecretText(extracted.error, apiKey)
        });
      }
      if (extracted.usage && typeof callbacks.onUsage === "function") {
        callbacks.onUsage(extracted.usage);
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
      var parsedEvent = parseSseEventBlock(block);
      if (!parsedEvent.data) {
        continue;
      }
      var trimmedData = parsedEvent.data.trim();
      if (trimmedData === "[DONE]") {
        return true;
      }
      var dataObj;
      try {
        dataObj = JSON.parse(trimmedData);
      } catch (_err) {
        continue;
      }
      var extracted = extractFromChunk(format, parsedEvent.eventName, dataObj);
      if (extracted.error) {
        throw AiProviderError("http_error", sanitizeSecretText(extracted.error, apiKey), {
          format: format,
          detail: sanitizeSecretText(extracted.error, apiKey)
        });
      }
      if (extracted.usage && typeof callbacks.onUsage === "function") {
        callbacks.onUsage(extracted.usage);
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
    var callbacks = {
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
        if (!u || typeof u !== "object") {
          return;
        }
        if (!latestUsage) {
          latestUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
        }
        if (u.inputTokens > 0) {
          latestUsage.inputTokens = u.inputTokens;
        }
        if (u.outputTokens > 0) {
          latestUsage.outputTokens = u.outputTokens;
        }
        if (u.totalTokens > 0) {
          latestUsage.totalTokens = u.totalTokens;
        } else {
          latestUsage.totalTokens = latestUsage.inputTokens + latestUsage.outputTokens;
        }
      }
    };

    return fetchImpl(reqSpec.url, {
      method: reqSpec.method,
      headers: reqSpec.headers,
      body: reqSpec.bodyJson,
      signal: signal
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
      var forceJsonFallback = opts.stream === false
        || (contentType.indexOf("application/json") !== -1 && contentType.indexOf("event-stream") === -1)
        || !response.body
        || typeof response.body.getReader !== "function";

      if (forceJsonFallback) {
        return response.text().then(function (rawText) {
          if (rawText.indexOf("data:") !== -1 && rawText.trim().charAt(0) !== "{" && rawText.trim().charAt(0) !== "[") {
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

      function pump() {
        return reader.read().then(function (step) {
          if (signal && signal.aborted) {
            throw AiProviderError("aborted", "Generation aborted", { format: profile.format });
          }
          if (step.done) {
            bufferObj.raw += decoder.decode();
            var trimmedBuf = bufferObj.raw.trim();
            if (trimmedBuf && (trimmedBuf.charAt(0) === "{" || trimmedBuf.charAt(0) === "[") && trimmedBuf.indexOf("data:") === -1) {
              applyNonSsePayload(trimmedBuf, profile.format, profile.apiKey, callbacks);
            } else {
              consumeSseEvents(bufferObj, true, profile.format, profile.apiKey, callbacks);
            }
            return finalizeStreamResult();
          }

          bufferObj.raw += decoder.decode(step.value, { stream: true });
          var stopped = consumeSseEvents(bufferObj, false, profile.format, profile.apiKey, callbacks);
          if (stopped) {
            if (typeof reader.cancel === "function") {
              try {
                reader.cancel();
              } catch (_err) {
                // Ignore cancel errors after SSE stop signal
              }
            }
            return finalizeStreamResult();
          }
          return pump();
        });
      }

      function finalizeStreamResult() {
        if (!fullText && !fullReasoning) {
          throw AiProviderError("empty_response", "Model returned an empty response", {
            format: profile.format
          });
        }
        return {
          text: fullText,
          reasoning: fullReasoning,
          usage: latestUsage,
          format: profile.format,
          model: profile.model
        };
      }

      return pump();
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

  function inferModelContextWindow(model, format) {
    var key = normalizeModelCatalogKey(model);
    if (key) {
      if (key.indexOf("gemini-1.5-pro") === 0) {
        return { contextWindow: 2097152, source: "catalog" };
      }
      if (/^gemini-(?:3|2\.5|2\.0|1\.5-flash|flash|pro-latest|exp)/.test(key)) {
        return { contextWindow: 1048576, source: "catalog" };
      }
      if (key.indexOf("claude-") === 0) {
        if (key.indexOf("1m") !== -1 || key.indexOf("1000k") !== -1) {
          return { contextWindow: 1000000, source: "catalog" };
        }
        return { contextWindow: 200000, source: "catalog" };
      }
      if (key.indexOf("gpt-4.1") === 0) {
        return { contextWindow: 1047576, source: "catalog" };
      }
      if (key.indexOf("gpt-5") === 0) {
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
    if (profile.detectedContextWindow >= 1024) {
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
        var candShort = normalizeModelCatalogKey(item.id || item.name);
        if (candId === normTarget || (shortTarget && candShort === shortTarget)) {
          var matched = extractContextWindowFromModelObject(item, targetModel);
          if (matched) {
            return matched;
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

  function buildModelMetadataRequests(profile) {
    var format = profile.format;
    var model = trimString(profile.model);
    if (!model) {
      return [];
    }
    if (format === "openai-chat" || format === "openai-responses") {
      var chatEndpoint = buildOpenAiUrl(profile.baseUrl, "/chat/completions", "/v1");
      var respEndpoint = buildOpenAiUrl(profile.baseUrl, "/responses", "/v1");
      var apiRoot = format === "openai-responses"
        ? respEndpoint.replace(/\/responses$/, "")
        : chatEndpoint.replace(/\/chat\/completions$/, "");
      var oaHeaders = { "Authorization": "Bearer " + profile.apiKey };
      return [
        { url: apiRoot + "/models/" + encodeURIComponent(model), headers: oaHeaders },
        { url: apiRoot + "/models", headers: oaHeaders }
      ];
    }
    if (format === "anthropic-messages") {
      var anthRoot = buildAnthropicUrl(profile.baseUrl).replace(/\/messages$/, "");
      return [{
        url: anthRoot + "/models/" + encodeURIComponent(model),
        headers: {
          "x-api-key": profile.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        }
      }];
    }
    if (format === "gemini-aistudio") {
      var studioModelUrl = buildAiStudioUrl(profile.baseUrl, model, false).replace(/:generateContent$/, "");
      return [{
        url: studioModelUrl,
        headers: { "x-goog-api-key": profile.apiKey }
      }];
    }
    if (format === "gemini-vertex") {
      var vertexModelUrl = buildVertexUrl(profile, false).replace(/:generateContent$/, "");
      return [{
        url: vertexModelUrl,
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

  function compressMessages(profileInput, options) {
    var profile = normalizeProfile(profileInput);
    var opts = options && typeof options === "object" ? options : {};
    var isEnglish = opts.locale === "en";
    var msgs = sanitizeMessages(opts.messages);
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

    var compressionProfile = Object.assign({}, profile, {
      temperature: 0.2,
      maxTokens: 1024
    });

    return streamChat(compressionProfile, {
      systemPrompt: systemInstruction,
      messages: [{
        role: "user",
        content: transcriptLines.join("\n\n")
      }],
      stream: opts.stream !== undefined ? opts.stream : true,
      signal: opts.signal,
      fetchImpl: opts.fetchImpl
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
    var probeProfile = Object.assign({}, profile, {
      maxTokens: 24,
      temperature: 0
    });
    return streamChat(probeProfile, {
      systemPrompt: "You are a connectivity probe.",
      messages: [{ role: "user", content: "Reply with OK." }],
      stream: opts.stream !== undefined ? opts.stream : true,
      signal: opts.signal,
      fetchImpl: opts.fetchImpl
    }).then(function (result) {
      return {
        ok: true,
        format: result.format,
        model: result.model,
        reply: result.text || result.reasoning || "OK"
      };
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
