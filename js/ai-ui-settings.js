(function (global) {
  "use strict";

  function create(page, helpers, actions, context) {
    var els = page.els;
    var providers = page.providers;
    var document = page.document;
    var configStore = page.configStore;
    var state = page.state;
    var life = page.life;

    function formatDisplayLabel(formatId) {
      var map = {
        "openai-chat": helpers.tr("ai.format.openaiChat", null, "OpenAI Chat Completions (/v1/chat/completions)", "OpenAI Chat Completions (/v1/chat/completions)"),
        "openai-responses": helpers.tr("ai.format.openaiResponses", null, "OpenAI Responses API (/v1/responses)", "OpenAI Responses API (/v1/responses)"),
        "anthropic-messages": helpers.tr("ai.format.anthropic", null, "Anthropic Messages (/v1/messages)", "Anthropic Messages (/v1/messages)"),
        "gemini-aistudio": helpers.tr("ai.format.geminiStudio", null, "Google Gemini AI Studio", "Google Gemini AI Studio"),
        "gemini-vertex": helpers.tr("ai.format.geminiVertex", null, "Google Gemini Vertex AI（仅静态 API Key）", "Google Gemini Vertex AI (Static API Key)")
      };
      return map[formatId] || formatId;
    }

    function formatHintText(formatId) {
      var map = {
        "openai-chat": helpers.tr("ai.hint.openaiChat", null,
          "兼容 OpenAI、DeepSeek、OpenRouter、SiliconFlow 及符合 /v1/chat/completions 规范的代理地址；默认发送 Authorization: Bearer 请求头。",
          "Compatible with OpenAI, DeepSeek, OpenRouter, and /v1/chat/completions proxies using Authorization: Bearer."),
        "openai-responses": helpers.tr("ai.hint.openaiResponses", null,
          "适用于 OpenAI 新版 Responses 接口 (/v1/responses)，请求体使用 instructions 与 input 字段。",
          "Uses OpenAI Responses API (/v1/responses) with instructions and input payload fields."),
        "anthropic-messages": helpers.tr("ai.hint.anthropic", null,
          "适用于 Claude (/v1/messages)，自动附带 x-api-key、anthropic-version 与浏览器直连所需请求头。",
          "Uses Anthropic Messages (/v1/messages) with x-api-key, anthropic-version, and browser direct-access header."),
        "gemini-aistudio": helpers.tr("ai.hint.geminiStudio", null,
          "使用 Google AI Studio API Key，自动请求 generativelanguage.googleapis.com 的 streamGenerateContent?alt=sse 接口。",
          "Uses Google AI Studio API Key via x-goog-api-key against generativelanguage.googleapis.com."),
        "gemini-vertex": helpers.tr("ai.hint.geminiVertex", null,
          "仅使用静态 API Key (x-goog-api-key)，不提供 OAuth 登录。留空 Project ID 可直接用于 Vertex Express Mode；填写 Project ID 与 Location 则构造区域项目静态密钥接口。",
          "Static API key only (x-goog-api-key); no OAuth login. Leave Project ID blank for Express Mode, or set Project ID & Location for regional endpoints.")
      };
      return map[formatId] || "";
    }

    function setStatusText(el, msg, isError) {
      if (!el) return;
      el.textContent = msg || "";
      el.classList.toggle("is-error", Boolean(isError));
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
      actions.openModal(els.settingsModal, els.profileApiKey);
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
        els.fieldContextWindow.placeholder = helpers.tr("ai.contextWindowAutoPlaceholder", {
          count: helpers.formatTokenCount(autoBase)
        },
        "自动识别（当前约 " + helpers.formatTokenCount(autoBase) + " tokens）",
        "Auto (" + helpers.formatTokenCount(autoBase) + " tokens)");
      }
      if (els.contextWindowHint) {
        var resolved = providers.resolveContextWindow(target);
        els.contextWindowHint.textContent = helpers.tr("ai.contextWindowStatus", {
          count: helpers.formatTokenCount(resolved.contextWindow),
          source: helpers.contextSourceLabel(resolved.source)
        },
        "当前生效上限：" + helpers.formatTokenCount(resolved.contextWindow) + " tokens（来源：" + helpers.contextSourceLabel(resolved.source) + "）",
        "Active window: " + helpers.formatTokenCount(resolved.contextWindow) + " tokens (" + helpers.contextSourceLabel(resolved.source) + ")");
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
      return helpers.tr(preset.labelKey, null, preset.model || preset.id, preset.model || preset.id);
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
      // Changing endpoints must never carry a key issued for another service.
      // This only edits the draft; Cancel leaves the saved profile untouched.
      var sameEndpoint = String(active.baseUrl || "").replace(/\/+$/, "") === String(preset.baseUrl || "").replace(/\/+$/, "");
      if (!sameEndpoint) active.apiKey = "";
      active.format = preset.format;
      active.baseUrl = preset.baseUrl;
      active.model = preset.model;
      // Use the verified catalog as the fallback, allowing live metadata to win.
      active.contextWindow = null;
      active.contextWindowSource = "auto";
      active.detectedContextWindow = null;
      renderSettingsModal();
      setStatusText(els.settingsStatus, helpers.tr("ai.presetApplied", { preset: quickPresetLabel(preset) },
        "已填入 " + quickPresetLabel(preset) + "；请确认此接口的 API Key 后保存。",
        "Filled " + quickPresetLabel(preset) + "; confirm the API key for this endpoint, then save."), false);
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
        helpers.syncCustomSelects(els.profileFormat);
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
          ? helpers.tr("ai.hideKey", null, "隐藏", "Hide")
          : helpers.tr("ai.showKey", null, "显示", "Show");
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
        if (code === "missing_api_key") return helpers.tr("ai.err.missingKey", null, "请填写 API Key", "API Key is required");
        if (code === "missing_model") return helpers.tr("ai.err.missingModel", null, "请填写模型名称", "Model name is required");
        if (code === "insecure_http_url") return helpers.tr("ai.err.insecureUrl", null, "除本机 localhost 外 Base URL 必须使用 https://", "Base URL must use https:// (except localhost)");
        return helpers.tr("ai.err.invalidUrl", null, "Base URL 格式无效", "Invalid Base URL");
      });
      return labels.join("；");
    }

    function maybeProbeActiveProfileContextWindow() {
      var active = configStore.getActiveProfile();
      if (!active || !providers.validateProfile(active).ok) return;
      if (Number(active.contextWindow) >= 1024 || active.contextWindowSource === "api") return;
      providers.fetchModelContextWindow(active).then(function (res) {
        if (state.disposed) return;
        if (!res || !res.live || !(res.contextWindow > 0)) return;
        var latest = configStore.getActiveProfile();
        if (!latest || !["id", "format", "baseUrl", "apiKey", "model", "vertexProject", "vertexLocation", "contextWindow", "contextWindowSource", "detectedContextWindow"]
          .every(function (key) { return latest[key] === active[key]; })) return;
        configStore.upsertProfile(Object.assign({}, latest, {
          detectedContextWindow: res.contextWindow,
          contextWindowSource: Number(latest.contextWindow) >= 1024 ? "manual" : "api"
        }), true);
        context.renderContextMeter();
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
      setStatusText(els.settingsStatus, helpers.tr("ai.detectingContext", null, "正在获取模型上下文窗口大小…", "Detecting model context window…"), false);
      if (els.detectContextBtn) els.detectContextBtn.disabled = true;

      providers.fetchModelContextWindow(normalized).then(function (res) {
        // Ignore responses for a profile or form that changed while probing.
        if (state.disposed || state.settingsDraft !== draftAtStart || getDraftActiveProfile() !== active) return;
        syncFormIntoDraft();
        var current = providers.normalizeProfile(active);
        var unchanged = ["format", "baseUrl", "apiKey", "model", "vertexProject", "vertexLocation", "contextWindow"]
          .every(function (key) { return current[key] === normalized[key]; });
        if (!unchanged) {
          setStatusText(els.settingsStatus, helpers.tr("ai.detectContextChanged", null,
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
        var vars = { count: helpers.formatTokenCount(resolved.contextWindow), source: helpers.contextSourceLabel(resolved.source) };
        var status;
        if (!known) {
          status = helpers.tr("ai.detectContextUnknown", vars,
            "未能识别此模型的上下文窗口。当前使用 {count} tokens（{source}）；请按服务商说明手动填写。",
            "Could not identify this model's context window. Using {count} tokens ({source}); enter the provider's limit manually.");
        } else if (res.live === true) {
          status = helpers.tr("ai.detectContextDone", vars,
            "已从接口获取上下文窗口：{count} tokens",
            "Context window fetched from API: {count} tokens");
        } else {
          status = helpers.tr("ai.detectContextCatalog", vars,
            "接口未返回上下文长度，已使用模型目录：{count} tokens。代理限制可能不同，可手动覆盖。",
            "The API did not return a context limit. Using the model catalog: {count} tokens. Proxy limits may differ; you can override this manually.");
        }
        setStatusText(els.settingsStatus, status, !known);
        context.renderContextMeter();
      }).catch(function (err) {
        if (state.disposed) return;
        setStatusText(els.settingsStatus, helpers.formatProviderError(err), true);
      }).finally(function () {
        if (!state.disposed && els.detectContextBtn) els.detectContextBtn.disabled = false;
      });
    }

    function clearSavedConfigWithConfirm() {
      helpers.confirmAction({
        kicker: helpers.tr("ai.confirmKicker", null, "AI 对话", "AI CHAT"),
        title: helpers.tr("ai.clearConfigTitle", null, "清除已保存的 API 密钥？", "Clear saved API keys?"),
        message: helpers.tr("ai.clearConfigMsg", null, "将从当前设备本地存储中移除所有已保存的模型配置与 API Key，聊天记录不受影响。", "This removes all saved model profiles and API keys from local storage on this device. Chat history is preserved."),
        cancelLabel: helpers.tr("ai.cancel", null, "取消", "Cancel"),
        proceedLabel: helpers.tr("ai.clearConfigConfirm", null, "确认清除", "Clear Keys")
      }).then(function (confirmed) {
        if (state.disposed || !confirmed) return;
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
        context.updateProfileIndicator();
        context.renderContextMeter();
        setStatusText(els.settingsStatus, helpers.tr("ai.configCleared", null, "已从本地存储清除所有模型配置与 API Key。", "Cleared all saved model profiles and API keys from local storage."), false);
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
      context.updateProfileIndicator();
      context.renderContextMeter();
      setStatusText(els.settingsStatus, helpers.tr("ai.settingsSaved", null, "配置已持久保存并设为当前启用方案。", "Configuration saved and activated."), false);
      actions.closeModal(els.settingsModal);
      maybeProbeActiveProfileContextWindow();
    }

    function runConnectionTest() {
      syncFormIntoDraft();
      var active = getDraftActiveProfile();
      if (!active) return;
      var draftAtStart = state.settingsDraft;
      var normalized = providers.normalizeProfile(active);
      function isCurrentConnectionTest() {
        if (state.disposed || state.settingsDraft !== draftAtStart || getDraftActiveProfile() !== active) return false;
        syncFormIntoDraft();
        var current = providers.normalizeProfile(active);
        return ["format", "baseUrl", "apiKey", "model", "vertexProject", "vertexLocation", "contextWindow"]
          .every(function (key) { return current[key] === normalized[key]; });
      }
      var check = providers.validateProfile(normalized);
      if (!check.ok) {
        setStatusText(els.settingsStatus, formatValidationError(check.errors), true);
        return;
      }
      setStatusText(els.settingsStatus, helpers.tr("ai.testingConnection", null, "正在测试接口连接…", "Testing connection…"), false);
      if (els.testConnectionBtn) els.testConnectionBtn.disabled = true;

      Promise.all([
        providers.testConnection(normalized),
        providers.fetchModelContextWindow(normalized)
      ]).then(function (results) {
        if (!isCurrentConnectionTest()) return;
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
        setStatusText(els.settingsStatus, helpers.tr("ai.testSuccess", { model: res.model },
          "连接成功（" + res.model + "），可保存使用。",
          "Connection succeeded (" + res.model + "). Ready to save."), false);
      }).catch(function (err) {
        if (!isCurrentConnectionTest()) return;
        setStatusText(els.settingsStatus, helpers.formatProviderError(err), true);
      }).finally(function () {
        if (!state.disposed && els.testConnectionBtn) els.testConnectionBtn.disabled = false;
      });
    }

    function bindSettings() {
      // Settings Modal bindings
      if (els.settingsCloseBtn) life.listen(els.settingsCloseBtn, "click", function () { actions.closeModal(els.settingsModal); });
      if (els.newProfileBtn) {
        life.listen(els.newProfileBtn, "click", function () {
          syncFormIntoDraft();
          var fmt = els.profileFormat ? els.profileFormat.value : "openai-chat";
          var created = providers.createDefaultProfile(fmt, {
            name: helpers.tr("ai.newProfileDefaultName", null, "新模型配置", "New Profile")
          });
          state.settingsDraft.profiles.push(created);
          state.settingsDraft.activeProfileId = created.id;
          renderSettingsModal();
        });
      }
      if (els.profileDeleteBtn) {
        life.listen(els.profileDeleteBtn, "click", function () {
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
          life.listen(chip, "click", function () {
            var preset = findQuickPreset(chip.getAttribute("data-preset"));
            if (preset) applyQuickPreset(preset);
          });
        });
      }
      if (els.profileFormat) {
        life.listen(els.profileFormat, "change", function () {
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
        life.listen(els.profileModel, "input", function () {
          var active = getDraftActiveProfile();
          if (!active) return;
          syncFormIntoDraft();
          active.detectedContextWindow = null;
          if (active.contextWindowSource !== "manual") {
            active.contextWindowSource = "";
          }
          updateContextWindowHintUI(active);
          markActiveQuickPreset(active);
        });
      }
      if (els.profileBaseUrl) {
        life.listen(els.profileBaseUrl, "input", function () {
          syncFormIntoDraft();
          markActiveQuickPreset(getDraftActiveProfile());
        });
      }
      if (els.fieldContextWindow) {
        life.listen(els.fieldContextWindow, "input", function () {
          syncFormIntoDraft();
          updateContextWindowHintUI();
        });
      }
      if (els.detectContextBtn) {
        life.listen(els.detectContextBtn, "click", detectContextWindowFromModal);
      }
      if (els.toggleKeyBtn) {
        life.listen(els.toggleKeyBtn, "click", function () {
          state.keyVisible = !state.keyVisible;
          if (els.profileApiKey) els.profileApiKey.type = state.keyVisible ? "text" : "password";
          els.toggleKeyBtn.textContent = state.keyVisible
            ? helpers.tr("ai.hideKey", null, "隐藏", "Hide")
            : helpers.tr("ai.showKey", null, "显示", "Show");
        });
      }
      if (els.clearConfigBtn) life.listen(els.clearConfigBtn, "click", clearSavedConfigWithConfirm);
      if (els.testConnectionBtn) life.listen(els.testConnectionBtn, "click", runConnectionTest);
      if (els.saveProfileBtn) life.listen(els.saveProfileBtn, "click", saveSettingsFromModal);
    }

    return {
      openSettingsModal: openSettingsModal,
      ensureProfileFormatOptions: ensureProfileFormatOptions,
      renderSettingsModal: renderSettingsModal,
      maybeProbeActiveProfileContextWindow: maybeProbeActiveProfileContextWindow,
      bindSettings: bindSettings
    };
  }

  var api = {
    create: create
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiSettings = api;
})(typeof window !== "undefined" ? window : globalThis);
