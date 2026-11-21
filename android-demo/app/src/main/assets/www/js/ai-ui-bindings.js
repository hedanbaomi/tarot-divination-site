(function (global) {
  "use strict";

  function collectElements(doc) {
    function byId(id) { return doc.getElementById(id); }
    return {
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
      skillsBar: byId("aiSkillsBar"),
      skillModeGroup: byId("aiSkillModeGroup"),
      activeSkillsList: byId("aiActiveSkillsList"),
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
  }

  function create(page, helpers, actions, settings, context, conversations, backup, messages) {
    var els = page.els;
    var document = page.document;
    var life = page.life;
    var state = page.state;
    var providers = page.providers;
    var chatStore = page.chatStore;

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
      var menuBack = helpers.byId("aiMenuBackToReading");
      if (menuBack) {
        menuBack.setAttribute("href", target);
      }
    }

    function applyAiLocalizedAttributes() {
      if (typeof document === "undefined") return;
      document.title = helpers.tr("ai.pageTitle", null, "AI 辅助解牌 · Quareia 占卜", "AI Assisted Reading · Quareia Divination");
      Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-placeholder]"), function (el) {
        var key = el.getAttribute("data-i18n-placeholder");
        if (!key) return;
        el.placeholder = helpers.tr(key, null, el.placeholder || "", el.placeholder || "");
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-content]"), function (el) {
        var key = el.getAttribute("data-i18n-content");
        if (!key) return;
        var prev = el.getAttribute("content") || "";
        el.setAttribute("content", helpers.tr(key, null, prev, prev));
      });
      Array.prototype.forEach.call(document.querySelectorAll("[data-i18n-aria-label]"), function (el) {
        var key = el.getAttribute("data-i18n-aria-label");
        if (!key) return;
        var prev = el.getAttribute("aria-label") || "";
        el.setAttribute("aria-label", helpers.tr(key, null, prev, prev));
      });
    }

    function bind() {
      // Event Bindings
      if (els.sidebarToggle) {
        life.listen(els.sidebarToggle, "click", function () { actions.setSidebarOpen(!state.sidebarOpen); });
      }
      if (els.sidebarClose) {
        life.listen(els.sidebarClose, "click", function () { actions.setSidebarOpen(false); });
      }
      if (els.sidebarBackdrop) {
        life.listen(els.sidebarBackdrop, "click", function () { actions.setSidebarOpen(false); });
      }
      if (els.activeProfileBtn) life.listen(els.activeProfileBtn, "click", settings.openSettingsModal);
      if (els.settingsBtn) life.listen(els.settingsBtn, "click", settings.openSettingsModal);
      if (els.bannerSettingsBtn) life.listen(els.bannerSettingsBtn, "click", settings.openSettingsModal);
      if (els.bannerPickBtn) life.listen(els.bannerPickBtn, "click", context.openReadingsPicker);
      if (els.newChatBtn) life.listen(els.newChatBtn, "click", conversations.handleNewChatClick);

      if (els.chatSearchInput) {
        life.listen(els.chatSearchInput, "input", function () {
          state.searchQuery = els.chatSearchInput.value.trim();
          conversations.refreshConversationsList(state.activeConversation ? state.activeConversation.id : "");
        });
      }
      if (els.tabActive) {
        life.listen(els.tabActive, "click", function () {
          state.activeTab = "active";
          conversations.refreshConversationsList(state.activeConversation ? state.activeConversation.id : "");
        });
      }
      if (els.tabArchived) {
        life.listen(els.tabArchived, "click", function () {
          state.activeTab = "archived";
          conversations.refreshConversationsList(state.activeConversation ? state.activeConversation.id : "");
        });
      }

      if (els.exportBackupBtn) life.listen(els.exportBackupBtn, "click", backup.exportAllChatsBackup);
      if (els.storageExportBtn) life.listen(els.storageExportBtn, "click", backup.exportAllChatsBackup);
      if (els.importBackupBtn && els.importFileInput) {
        life.listen(els.importBackupBtn, "click", function () {
          if (state.streaming) return;
          els.importFileInput.click();
        });
        life.listen(els.importFileInput, "change", backup.importChatsBackup);
      }
      if (els.clearChatsBtn) life.listen(els.clearChatsBtn, "click", conversations.clearTabChatsWithConfirm);

      if (els.themeBtn && els.themePopover) {
        life.listen(els.themeBtn, "click", function (e) {
          e.stopPropagation();
          actions.setThemePopoverOpen(!state.themePopoverOpen);
        });
        life.listen(els.themePopover, "click", function (e) {
          if (e.target && typeof e.target.closest === "function" && e.target.closest(".theme-swatch")) {
            actions.setThemePopoverOpen(false);
          }
        });
        life.listen(document, "click", function (e) {
          if (!state.themePopoverOpen) return;
          if (e.target && typeof e.target.closest === "function" && e.target.closest(".ai-theme-wrap")) {
            return;
          }
          actions.setThemePopoverOpen(false);
        });
      }

      if (els.pickReadingsBtn) life.listen(els.pickReadingsBtn, "click", context.openReadingsPicker);
      if (els.renameChatBtn) {
        life.listen(els.renameChatBtn, "click", function () {
          if (state.activeConversation) conversations.openRenameDialog(state.activeConversation);
        });
      }
      if (els.exportMdBtn) life.listen(els.exportMdBtn, "click", backup.exportActiveConversationMarkdown);
      if (els.archiveChatBtn) {
        life.listen(els.archiveChatBtn, "click", function () {
          if (state.activeConversation) {
            conversations.toggleArchive(state.activeConversation.id, !state.activeConversation.archived);
          }
        });
      }
      if (els.deleteChatBtn) {
        life.listen(els.deleteChatBtn, "click", function () {
          if (state.activeConversation) conversations.deleteChatWithConfirm(state.activeConversation);
        });
      }

      if (els.skillModeGroup && typeof els.skillModeGroup.querySelectorAll === "function") {
        Array.prototype.forEach.call(els.skillModeGroup.querySelectorAll("[data-skill-mode]"), function (pill) {
          life.listen(pill, "click", function () {
            var targetMode = pill.getAttribute("data-skill-mode");
            if (targetMode) context.selectSkillMode(targetMode);
          });
        });
      }

      if (els.sendBtn) life.listen(els.sendBtn, "click", actions.sendUserPrompt);
      if (els.stopBtn) {
        life.listen(els.stopBtn, "click", function () {
          if (state.abortController) state.abortController.abort();
        });
      }
      if (els.promptInput) {
        life.listen(els.promptInput, "input", function () {
          context.renderSkillsBar();
        });
        life.listen(els.promptInput, "keydown", function (e) {
          if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            actions.sendUserPrompt();
          }
        });
      }

      // Picker Modal bindings
      if (els.pickerCloseBtn) life.listen(els.pickerCloseBtn, "click", function () { actions.closeModal(els.pickerModal); });
      if (els.pickerSearchInput) life.listen(els.pickerSearchInput, "input", context.renderPickerList);
      if (els.pickerDeckFilter) life.listen(els.pickerDeckFilter, "change", context.renderPickerList);
      if (els.pickerClearBtn) {
        life.listen(els.pickerClearBtn, "click", function () {
          state.pickerDraftIds = [];
          context.renderPickerList();
        });
      }
      if (els.pickerApplyBtn) life.listen(els.pickerApplyBtn, "click", context.applyPickerSelection);

      // Rename Modal bindings
      if (els.renameCloseBtn) life.listen(els.renameCloseBtn, "click", function () { actions.closeModal(els.renameModal); });
      if (els.renameCancelBtn) life.listen(els.renameCancelBtn, "click", function () { actions.closeModal(els.renameModal); });
      if (els.renameSaveBtn) life.listen(els.renameSaveBtn, "click", conversations.commitRenameDialog);
      if (els.renameInput) {
        life.listen(els.renameInput, "keydown", function (e) {
          if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            conversations.commitRenameDialog();
          }
        });
      }

      // Backdrop click / Escape handling
      [els.pickerModal, els.renameModal, els.settingsModal].forEach(function (modal) {
        if (!modal) return;
        life.listen(modal, "click", function (e) {
          if (e.target === modal) actions.closeModal(modal);
        });
      });

      life.listen(document, "keydown", function (e) {
        if (e.key !== "Escape" || e.defaultPrevented) return;
        if (actions.isConfirmDialogOpen() || actions.isChoiceDialogOpen()) return;
        var openM = actions.getOpenModal();
        if (openM) {
          actions.closeModal(openM);
        } else if (state.themePopoverOpen) {
          actions.setThemePopoverOpen(false);
        } else if (state.sidebarOpen) {
          actions.setSidebarOpen(false);
        } else if (state.editingQuestionReadingId) {
          state.editingQuestionReadingId = "";
          context.renderContextHeader();
        } else if (state.editingMessageId) {
          state.editingMessageId = "";
          messages.renderMessages();
        }
      });

      life.listen(global, "quareia:languagechange", function () {
        applyAiLocalizedAttributes();
        settings.ensureProfileFormatOptions();
        helpers.syncCustomSelects();
        conversations.renderSidebar();
        context.renderContextHeader();
        messages.renderMessages();
        if (els.settingsModal && !els.settingsModal.hidden) {
          settings.renderSettingsModal();
        }
        if (els.pickerModal && !els.pickerModal.hidden) {
          context.renderPickerList();
        }
      });

      life.listen(global, "pageshow", function () {
        updateBackLink();
        context.updateProfileIndicator();
      });

      life.listen(global, "storage", function (e) {
        var key = e ? e.key : "";
        if (!key || key === "quareia-page-version" || key === "quareia-page-version-v1") {
          updateBackLink();
        }
        if (!key || key === providers.STORAGE_KEY) {
          context.updateProfileIndicator();
          context.renderContextMeter();
        }
      });

      life.listen(global, "pagehide", function () {
        if (!state.streaming) return;
        var ctx = state.activeStreamContext;
        state.activeStreamContext = null;
        if (ctx && ctx.conv && ctx.conv.messages && ctx.conv.messages[ctx.assistantMsgIndex]) {
          var partialMsg = ctx.conv.messages[ctx.assistantMsgIndex];
          if (!partialMsg.content && !partialMsg.error) {
            partialMsg.error = helpers.tr("ai.stoppedEmpty", null, "已停止生成。", "Generation stopped.");
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
    }

    return {
      updateBackLink: updateBackLink,
      applyAiLocalizedAttributes: applyAiLocalizedAttributes,
      bind: bind
    };
  }

  var api = {
    create: create,
    collectElements: collectElements
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiBindings = api;
})(typeof window !== "undefined" ? window : globalThis);
