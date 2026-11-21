(function (global) {
  "use strict";

  function load(name) {
    var exposed = global["DivinationAiUi" + name];
    if (exposed) return exposed;
    if (typeof module !== "undefined" && module.exports) return require("./ai-ui-" + name.toLowerCase() + ".js");
    throw new Error("Missing AI UI module: " + name);
  }

  var markdown = load("Markdown");
  var helpers = load("Helpers");
  var Readings = load("Readings");
  var Context = load("Context");
  var Settings = load("Settings");
  var Messages = load("Messages");
  var Conversations = load("Conversations");
  var Backup = load("Backup");
  var Bindings = load("Bindings");

  function createLifetime() {
    var disposed = false;
    var timers = new Set();
    var cleanups = [];
    function listen(target, type, handler) {
      target.addEventListener(type, handler);
      cleanups.push(function () { target.removeEventListener(type, handler); });
    }
    function later(callback, delay) {
      if (disposed) return null;
      var id = setTimeout(function () {
        timers.delete(id);
        callback();
      }, delay);
      timers.add(id);
      return id;
    }
    function cancel(id) {
      timers.delete(id);
      clearTimeout(id);
    }
    function dispose() {
      disposed = true;
      timers.forEach(cancel);
      cleanups.forEach(function (fn) { fn(); });
      cleanups = [];
    }
    return { listen: listen, later: later, cancel: cancel, dispose: dispose };
  }

  function initAiPage() {
    if (typeof document === "undefined" || !helpers.byId("aiChatList") || !global.DivinationAiProviders || !global.DivinationAiContext || !global.DivinationAiChatStore) {
      return null;
    }

    var providers = global.DivinationAiProviders;
    var contextApi = global.DivinationAiContext;
    var chatStoreApi = global.DivinationAiChatStore;
    var historyStoreApi = global.DivinationHistoryStore;

    var els = Bindings.collectElements(document);
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
      editingQuestionReadingId: "",
      settingsDraft: null,
      keyVisible: false,
      lastFocusedBeforeModal: null,
      lastRenderedConvId: "",
      toastTimer: null
    };

    var life = createLifetime();
    var page = {
      providers: providers,
      contextApi: contextApi,
      chatStoreApi: chatStoreApi,
      configStore: configStore,
      chatStore: chatStore,
      historyStore: historyStore,
      customLibrary: customLibrary,
      state: state,
      els: els,
      document: document,
      life: life
    };
    // Views report user intents to the page; none loads its caller.
    var actions = {
      refreshConversationsList: function (preferredId, expectedActiveId) { return conversations.refreshConversationsList(preferredId, expectedActiveId); },
      updateStreamingUi: updateStreamingUi,
      openModal: openModal,
      closeModal: closeModal,
      sendUserPrompt: sendUserPrompt,
      commitEditAndResend: commitEditAndResend,
      regenerateFromIndex: regenerateFromIndex,
      deleteMessageWithConfirm: function (msgId) { return conversations.deleteMessageWithConfirm(msgId); },
      setSidebarOpen: setSidebarOpen,
      setThemePopoverOpen: setThemePopoverOpen,
      isConfirmDialogOpen: isConfirmDialogOpen,
      isChoiceDialogOpen: isChoiceDialogOpen,
      getOpenModal: getOpenModal
    };
    var readings = Readings.create(page, helpers);
    var context = Context.create(page, helpers, readings, actions);
    var settings = Settings.create(page, helpers, actions, context);
    var messages = Messages.create(page, helpers, actions, markdown);
    var conversations = Conversations.create(page, helpers, actions, context, messages, readings);
    var backup = Backup.create(page, helpers, conversations);
    var bindings = Bindings.create(page, helpers, actions, settings, context, conversations, backup, messages);
    var previousExportResult = global.__quareiaHistoryExportResult;
    global.__quareiaHistoryExportResult = backup.onExportResult;
    bindings.bind();
    settings.bindSettings();

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
        life.later(function () { focusEl.focus(); }, 0);
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

    function updateStreamingUi() {
      if (state.disposed) return;
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

    function startStreamingUi() {
      state.streaming = true;
      state.editingQuestionReadingId = "";
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
      if (state.disposed) return;
      finishStreamingUi();
      if (draft && els.promptInput && !els.promptInput.value) els.promptInput.value = draft;
      var conflict = err && err.code === "conversation_conflict";
      if (conflict) conversations.refreshConversationsList();
      if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
        global.DivinationDialog.request({
          title: conflict
            ? helpers.tr("ai.chatChangedTitle", null, "对话已更新", "Conversation Updated")
            : helpers.tr("ai.saveFailedTitle", null, "保存失败", "Save Failed"),
          message: conflict
            ? helpers.tr("ai.chatChangedMsg", null, "其他标签页已修改此对话，已载入最新内容。请确认后重试。", "Another tab changed this conversation. The latest messages have been loaded; review them and retry.")
            : helpers.tr("ai.saveFailedMsg", null, "无法保存对话，请检查存储空间后重试。", "Could not save the conversation. Check available storage and retry."),
          cancelLabel: helpers.tr("ai.close", null, "关闭", "Close"),
          proceedLabel: helpers.tr("ai.ok", null, "确定", "OK")
        });
      }
    }

    function aiUsageObserver(model, kind) {
      return global.DivinationAiTelemetry && typeof global.DivinationAiTelemetry.createObserver === "function"
        ? global.DivinationAiTelemetry.createObserver(model, kind) : {};
    }

    // Streaming chat pipeline
    function runGeneration(conversationSnapshot, assistantMsgIndex) {
      if (state.disposed) return Promise.resolve();
      var profile = configStore.getActiveProfile();
      var check = profile ? providers.validateProfile(profile) : { ok: false, errors: ["missing_api_key"] };
      if (!check.ok) {
        finishStreamingUi();
        settings.openSettingsModal();
        return Promise.resolve();
      }

      var conv = conversationSnapshot;
      var hardCap = providers.inputTokenBudget(profile, providers.resolveContextWindow(profile).contextWindow);
      var payload = readings.buildFittedPayload(conv, assistantMsgIndex, hardCap);

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

      var requestRecords = (payload.resolvedReadings || []).map(function (reading) {
        return { id: reading.id, names: Readings.collectRecordCardTokens(null, reading) };
      });
      var prepPromise = Promise.resolve(payload);
      if (
        profile.autoCompress !== false
        && payload.estimatedTokens >= hardCap
        && contextApi.estimateConversationTokens({ systemPrompt: payload.systemPrompt, messages: payload.apiMessages.slice(-1) }) < hardCap
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
          context.renderContextMeter();
          prepPromise = providers.compressMessages(profile, Object.assign(aiUsageObserver(profile.model, "compression"), {
            previousSummary: payload.summaryText,
            messages: toCompress,
            estimateTokens: contextApi.estimateConversationTokens,
            locale: helpers.currentLocale(),
            signal: state.abortController ? state.abortController.signal : undefined
          })).catch(function (compErr) {
            if (compErr && compErr.code === "aborted") {
              throw compErr;
            }
            return {
              summaryText: helpers.buildFallbackSummaryDigest(payload.summaryText, toCompress, helpers.isEnglishLocale()),
              usage: null
            };
          }).then(function (compRes) {
            var nextSummaryText = compRes && compRes.summaryText ? compRes.summaryText.trim() : "";
            if (!nextSummaryText) {
              nextSummaryText = helpers.buildFallbackSummaryDigest(payload.summaryText, toCompress, helpers.isEnglishLocale());
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
              return readings.buildFittedPayload(conv, assistantMsgIndex, hardCap);
            }
            return payload;
          }).finally(function () {
            state.compressing = false;
            context.renderContextMeter();
          });
        }
      }

      var pendingFrame = null;
      function scheduleRender() {
        if (pendingFrame) return;
        pendingFrame = life.later(function () {
          pendingFrame = null;
          messages.patchStreamingMessageDom(conv, assistantMsgIndex);
        }, 60);
      }

      return prepPromise.then(function (fitted) {
        var finalMessages = helpers.truncateMessagesToBudget(
          fitted.apiMessages,
          fitted.systemPrompt,
          hardCap,
          contextApi.estimateConversationTokens
        );
        if (
          finalMessages.length > 0
          && contextApi.estimateConversationTokens({
            systemPrompt: fitted.systemPrompt,
            messages: finalMessages
          }) >= hardCap
        ) {
          var tooSmall = new Error("prompt_too_large");
          tooSmall.code = "context_too_small";
          throw tooSmall;
        }
        if (state.disposed) throw Object.assign(new Error("Aborted"), { code: "aborted" });
        return providers.streamChat(profile, Object.assign(aiUsageObserver(profile.model, "conversation"), {
          systemPrompt: fitted.systemPrompt,
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
          life.cancel(pendingFrame);
          pendingFrame = null;
        }
        var targetMsg = conv.messages[assistantMsgIndex];
        if (targetMsg) {
          targetMsg.content = result.text || "";
          targetMsg.interpretedReadingIds = Readings.interpretedRecordIds(targetMsg.content, requestRecords, true);
          targetMsg.reasoning = result.reasoning || "";
          targetMsg.error = result.completionStatus === "truncated"
            ? helpers.formatProviderError({ code: result.finishReason === "stream_closed" ? "response_incomplete" : "output_truncated" })
            : (result.completionStatus === "blocked" ? helpers.formatProviderError({ code: "content_blocked" }) : "");
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
          life.cancel(pendingFrame);
          pendingFrame = null;
        }
        var targetMsg = conv.messages[assistantMsgIndex];
        if (targetMsg) {
          targetMsg.interpretedReadingIds = [];
          if (err && err.code === "aborted") {
            if (!targetMsg.content) {
              targetMsg.error = helpers.tr("ai.stoppedEmpty", null, "已停止生成。", "Generation stopped.");
            }
          } else {
            targetMsg.error = helpers.formatProviderError(err);
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
          return conversations.refreshConversationsList(saved ? saved.id : "");
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
        settings.openSettingsModal();
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
          title: readings.deriveAutoTitle([], text),
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
        var nextTitle = targetConv.title || readings.deriveAutoTitle(targetConv.readingIds, text);
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
        conversations.renderSidebar();
        context.renderContextHeader();
        messages.renderMessages({ forceScroll: true });
        return runGeneration(saved, saved.messages.length - 1);
      }).catch(function (err) { handleConversationWriteError(err, text); });
    }

    function regenerateFromIndex(assistantIndex) {
      if (state.streaming) return;
      var conv = state.activeConversation;
      if (!conv || !conv.messages || assistantIndex < 0 || assistantIndex >= conv.messages.length) return;
      if (!conv.messages[assistantIndex] || conv.messages[assistantIndex].role !== "assistant") return;
      if (!helpers.hasPrecedingUserTurn(conv.messages, assistantIndex)) return;
      var profile = configStore.getActiveProfile();
      if (!profile || !providers.validateProfile(profile).ok) {
        settings.openSettingsModal();
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
        messages.renderMessages({ forceScroll: true });
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
        settings.openSettingsModal();
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
        messages.renderMessages({ forceScroll: true });
        return runGeneration(saved, saved.messages.length - 1);
      }).catch(function (err) { handleConversationWriteError(err); });
    }

    function isConfirmDialogOpen() {
      var dlg = helpers.byId("confirmDialog");
      if (!dlg) return false;
      return Boolean(
        dlg.open
        || (typeof dlg.hasAttribute === "function" && dlg.hasAttribute("open"))
        || (dlg.classList && dlg.classList.contains("is-open"))
      );
    }

    function isChoiceDialogOpen() {
      var dlg = helpers.byId("choiceDialog");
      if (!dlg) return false;
      return Boolean(
        dlg.open
        || (typeof dlg.hasAttribute === "function" && dlg.hasAttribute("open"))
        || (document.body && document.body.classList && document.body.classList.contains("choice-open"))
      );
    }

    bindings.updateBackLink();
    bindings.applyAiLocalizedAttributes();
    settings.ensureProfileFormatOptions();
    helpers.syncCustomSelects();
    settings.maybeProbeActiveProfileContextWindow();

    // Handle optional ?readingId=... deep link from reading/history pages.
    var urlParams = typeof URLSearchParams === "function" ? new URLSearchParams(global.location.search || "") : null;
    var deepLinkReadingId = urlParams ? urlParams.get("readingId") : "";

    readings.loadSelectableReadings().then(function () {
      if (state.disposed) return;
      if (deepLinkReadingId) {
        if (global.history && typeof global.history.replaceState === "function") {
          try {
            global.history.replaceState(null, "", global.location.pathname || "ai.html");
          } catch (_err) {
            // Ignore replaceState failures in restricted contexts
          }
        }
        if (state.readingsById[deepLinkReadingId]) {
          return conversations.createFreshConversation([deepLinkReadingId]);
        }
      }
      return conversations.refreshConversationsList();
    });

    return {
      dispose: function () {
        if (state.disposed) return;
        state.disposed = true;
        life.dispose();
        if (state.abortController) state.abortController.abort();
        if (global.__quareiaHistoryExportResult === backup.onExportResult) {
          if (previousExportResult === undefined) delete global.__quareiaHistoryExportResult;
          else global.__quareiaHistoryExportResult = previousExportResult;
        }
        // Rendered controls own their node-local listeners. Release the old trees,
        // including hidden pickers and profile tabs that aren't drawn at startup.
        [els.chatList, els.messages, els.attachedChips, els.pickerList, els.profileList].forEach(function (el) {
          if (el) el.replaceChildren();
        });
        [els.pickerModal, els.renameModal, els.settingsModal].forEach(function (el) {
          if (el) el.hidden = true;
        });
        setSidebarOpen(false);
        setThemePopoverOpen(false);
        if (els.themeToast) els.themeToast.classList.remove("is-on", "is-error");
        if (els.testConnectionBtn) els.testConnectionBtn.disabled = false;
        if (els.detectContextBtn) els.detectContextBtn.disabled = false;
      },
      handleBack: function () {
        if (state.disposed) return false;
        if (global.DivinationDialog && typeof global.DivinationDialog.handleBack === "function") {
          if (global.DivinationDialog.handleBack()) {
            return true;
          }
        } else if (isConfirmDialogOpen()) {
          var cancelBtn = helpers.byId("confirmCancelBtn");
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
          var choiceCancel = helpers.byId("choiceCancelBtn");
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
        if (state.themePopoverOpen) {
          setThemePopoverOpen(false);
          return true;
        }
        if (state.sidebarOpen) {
          setSidebarOpen(false);
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
        if (state.editingQuestionReadingId) {
          state.editingQuestionReadingId = "";
          context.renderContextHeader();
          return true;
        }
        if (state.editingMessageId) {
          state.editingMessageId = "";
          messages.renderMessages();
          return true;
        }
        return false;
      }
    };
  }

  var controller = null;
  function bootstrap(opts) {
    if (controller && !(opts && opts.reset === true)) return controller;
    if (controller) controller.dispose();
    controller = initAiPage();
    return controller;
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
    } else {
      bootstrap();
    }
  }

  var api = {
    renderMarkdownInto: markdown.renderMarkdownInto,
    normalizeConversationMessagesForApi: helpers.normalizeConversationMessagesForApi,
    truncateMessagesToBudget: helpers.truncateMessagesToBudget,
    hasPrecedingUserTurn: helpers.hasPrecedingUserTurn,
    assistantMessageShowsReading: Readings.assistantMessageShowsReading,
    interpretedRecordIds: Readings.interpretedRecordIds,
    computeHasUninterpretedReading: Readings.computeHasUninterpretedReading,
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
