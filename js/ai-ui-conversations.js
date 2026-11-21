(function (global) {
  "use strict";

  function create(page, helpers, actions, context, messages, readings) {
    var els = page.els;
    var state = page.state;
    var document = page.document;
    var chatStore = page.chatStore;

    function renderSidebar() {
      if (state.disposed) return;
      if (!els.chatList) return;
      if (els.tabActive) {
        els.tabActive.setAttribute("aria-selected", state.activeTab === "active" ? "true" : "false");
        els.tabActive.textContent = helpers.tr("ai.tabActiveCount", { count: state.allCounts.active },
          "进行中 (" + state.allCounts.active + ")",
          "Active (" + state.allCounts.active + ")");
      }
      if (els.tabArchived) {
        els.tabArchived.setAttribute("aria-selected", state.activeTab === "archived" ? "true" : "false");
        els.tabArchived.textContent = helpers.tr("ai.tabArchivedCount", { count: state.allCounts.archived },
          "已归档 (" + state.allCounts.archived + ")",
          "Archived (" + state.allCounts.archived + ")");
      }
      if (els.clearChatsBtn) {
        els.clearChatsBtn.textContent = state.activeTab === "archived"
          ? helpers.tr("ai.clearArchived", null, "清空已归档", "Clear Archived")
          : helpers.tr("ai.clearActive", null, "清空进行中", "Clear Active");
      }

      var list = state.conversations;
      if (!list.length) {
        var empty = document.createElement("div");
        empty.className = "ai-chat-empty";
        empty.textContent = state.searchQuery
          ? helpers.tr("ai.noMatchingChats", null, "没有匹配的对话记录。", "No matching conversations.")
          : (state.activeTab === "archived"
            ? helpers.tr("ai.noArchivedChats", null, "暂无已归档对话。", "No archived conversations.")
            : helpers.tr("ai.noActiveChats", null, "暂无对话，点击上方「新建对话」开始。", "No conversations yet. Start a new chat above."));
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
          pinTag.setAttribute("aria-label", helpers.tr("ai.pinned", null, "已置顶", "Pinned"));
          titleRow.appendChild(pinTag);
        }
        var titleSpan = document.createElement("span");
        titleSpan.className = "ai-chat-item-title";
        titleSpan.textContent = conv.title || helpers.tr("ai.untitledChat", null, "新解牌对话", "Untitled Chat");
        titleRow.appendChild(titleSpan);

        var metaSpan = document.createElement("span");
        metaSpan.className = "ai-chat-item-meta";
        var msgCount = conv.messages ? conv.messages.length : 0;
        var readCount = conv.readingIds ? conv.readingIds.length : 0;
        metaSpan.textContent = helpers.formatShortTime(conv.updatedAt) + " · "
          + helpers.tr("ai.chatMetaSummary", { readings: readCount, messages: msgCount },
            readCount + " 条占卜 · " + msgCount + " 条消息",
            readCount + " readings · " + msgCount + " msgs");

        selectBtn.appendChild(titleRow);
        selectBtn.appendChild(metaSpan);
        selectBtn.addEventListener("click", function () {
          selectConversation(conv.id);
          actions.setSidebarOpen(false);
        });

        var rowActions = document.createElement("div");
        rowActions.className = "ai-chat-item-actions";

        var pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "ai-mini-action";
        pinBtn.textContent = conv.pinned
          ? helpers.tr("ai.unpin", null, "取消置顶", "Unpin")
          : helpers.tr("ai.pin", null, "置顶", "Pin");
        pinBtn.addEventListener("click", function () { togglePin(conv.id, !conv.pinned); });

        var renameBtn = document.createElement("button");
        renameBtn.type = "button";
        renameBtn.className = "ai-mini-action";
        renameBtn.textContent = helpers.tr("ai.rename", null, "重命名", "Rename");
        renameBtn.addEventListener("click", function () { openRenameDialog(conv); });

        var archiveBtn = document.createElement("button");
        archiveBtn.type = "button";
        archiveBtn.className = "ai-mini-action";
        archiveBtn.dataset.streamLock = "true";
        archiveBtn.disabled = state.streaming;
        archiveBtn.textContent = conv.archived
          ? helpers.tr("ai.unarchive", null, "取消归档", "Unarchive")
          : helpers.tr("ai.archive", null, "归档", "Archive");
        archiveBtn.addEventListener("click", function () { toggleArchive(conv.id, !conv.archived); });

        var deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "ai-mini-action is-danger";
        deleteBtn.dataset.streamLock = "true";
        deleteBtn.disabled = state.streaming;
        deleteBtn.textContent = helpers.tr("ai.delete", null, "删除", "Delete");
        deleteBtn.addEventListener("click", function () { deleteChatWithConfirm(conv); });

        rowActions.appendChild(pinBtn);
        rowActions.appendChild(renameBtn);
        rowActions.appendChild(archiveBtn);
        rowActions.appendChild(deleteBtn);

        row.appendChild(selectBtn);
        row.appendChild(rowActions);
        frag.appendChild(row);
      });

      els.chatList.replaceChildren(frag);
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

    function resolveFallbackConversation(allActive, allArchived) {
      if (state.conversations.length > 0) {
        return state.conversations[0];
      }
      if (state.activeTab === "archived") {
        return allArchived[0] || allActive[0] || null;
      }
      return allActive[0] || null;
    }

    function refreshConversationsList(preferredId, expectedActiveId) {
      if (state.disposed) return Promise.resolve();
      function isCurrentSelection() {
        return expectedActiveId === undefined ||
          (state.activeConversation ? state.activeConversation.id : "") === expectedActiveId;
      }
      return Promise.all([
        chatStore.listConversations({ archived: false, query: state.searchQuery }),
        chatStore.listConversations({ archived: true, query: state.searchQuery }),
        chatStore.listConversations({ archived: false }),
        chatStore.listConversations({ archived: true })
      ]).then(function (results) {
        if (state.disposed || !isCurrentSelection()) return null;
        var activeFiltered = results[0];
        var archivedFiltered = results[1];
        var allActive = results[2];
        var allArchived = results[3];
        state.allCounts.active = allActive.length;
        state.allCounts.archived = allArchived.length;
        state.conversations = state.activeTab === "archived" ? archivedFiltered : activeFiltered;
        var shouldAutoCreate = state.activeTab === "active" && !state.searchQuery && allActive.length === 0;

        function finalizeSelection(candidate) {
          if (state.disposed || !isCurrentSelection()) return null;
          state.activeConversation = candidate || resolveFallbackConversation(allActive, allArchived);
          if (!state.activeConversation && shouldAutoCreate) {
            return createFreshConversation();
          }
          actions.updateStreamingUi();
          renderSidebar();
          context.renderContextHeader();
          messages.renderMessages();
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
      var nowTs = Date.now();
      var snaps = readings.buildReadingSnapshots(ids).map(function (s) {
        return s ? Object.assign({}, s, { attachedAt: nowTs }) : s;
      });
      var title = readings.deriveAutoTitle(ids, "", snaps);
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
      state.editingQuestionReadingId = "";
      return chatStore.getConversation(chatId).then(function (conv) {
        if (!conv) return;
        state.activeConversation = conv;
        actions.updateStreamingUi();
        renderSidebar();
        context.renderContextHeader();
        messages.renderMessages({ forceScroll: true });
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
        actions.setSidebarOpen(false);
        if (els.promptInput) els.promptInput.focus();
        return;
      }
      createFreshConversation([]).then(function () {
        actions.setSidebarOpen(false);
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
      helpers.confirmAction({
        kicker: helpers.tr("ai.confirmKicker", null, "AI CHAT", "AI CHAT"),
        title: helpers.tr("ai.deleteChatTitle", null, "确认删除该对话？", "Delete this conversation?"),
        message: helpers.tr("ai.deleteChatMsg", { title: conv.title || helpers.tr("ai.untitledChat", null, "新解牌对话", "Untitled Chat") },
          "将永久移除「" + (conv.title || "新解牌对话") + "」中的所有提问与解牌记录，无法恢复。",
          "All messages in \"" + (conv.title || "Untitled Chat") + "\" will be permanently removed."),
        cancelLabel: helpers.tr("ai.cancel", null, "取消", "Cancel"),
        proceedLabel: helpers.tr("ai.delete", null, "删除", "Delete")
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

      helpers.confirmAction({
        kicker: helpers.tr("ai.confirmKicker", null, "AI CHAT", "AI CHAT"),
        title: archivedOnly
          ? helpers.tr("ai.clearArchivedTitle", null, "清空所有已归档对话？", "Clear all archived chats?")
          : helpers.tr("ai.clearAllTitle", null, "清空当前进行中的对话？", "Clear all active chats?"),
        message: archivedOnly
          ? helpers.tr("ai.clearArchivedMsg", null, "此操作将删除所有已归档的 AI 对话，进行中的对话会保留。", "This permanently deletes all archived chats while keeping active ones.")
          : helpers.tr("ai.clearAllMsg", null, "此操作将清空所有进行中（非归档）对话，或建议先导出备份。", "This deletes all active conversations. Consider exporting a JSON backup first."),
        cancelLabel: helpers.tr("ai.cancel", null, "取消", "Cancel"),
        proceedLabel: helpers.tr("ai.clearConfirm", null, "确认清空", "Clear")
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
      actions.openModal(els.renameModal, els.renameInput);
    }

    function commitRenameDialog() {
      if (!els.renameModal || !els.renameInput) return;
      var targetId = els.renameModal.dataset.targetChatId || "";
      var nextTitle = els.renameInput.value.trim();
      actions.closeModal(els.renameModal);
      if (!targetId) return;
      chatStore.updateConversation(targetId, { title: nextTitle }, { touchUpdatedAt: false }).then(function () {
        return refreshConversationsList(state.activeConversation ? state.activeConversation.id : targetId);
      });
    }

    function deleteMessageWithConfirm(msgId) {
      if (state.streaming || !state.activeConversation) return;
      helpers.confirmAction({
        kicker: helpers.tr("ai.confirmKicker", null, "AI CHAT", "AI CHAT"),
        title: helpers.tr("ai.deleteMsgTitle", null, "删除这条消息？", "Delete this message?"),
        message: helpers.tr("ai.deleteMsgDesc", null, "确认将该条发言从本地聊天记录中移除吗？", "Remove this message from local chat history?"),
        cancelLabel: helpers.tr("ai.cancel", null, "取消", "Cancel"),
        proceedLabel: helpers.tr("ai.delete", null, "删除", "Delete")
      }).then(function (ok) {
        if (!ok || !state.activeConversation) return;
        chatStore.deleteMessage(state.activeConversation.id, msgId).then(function (saved) {
          if (!saved) return null;
          state.activeConversation = saved;
          return refreshConversationsList(saved.id);
        });
      });
    }

    return {
      refreshConversationsList: refreshConversationsList,
      deleteMessageWithConfirm: deleteMessageWithConfirm,
      handleNewChatClick: handleNewChatClick,
      clearTabChatsWithConfirm: clearTabChatsWithConfirm,
      openRenameDialog: openRenameDialog,
      toggleArchive: toggleArchive,
      deleteChatWithConfirm: deleteChatWithConfirm,
      commitRenameDialog: commitRenameDialog,
      renderSidebar: renderSidebar,
      createFreshConversation: createFreshConversation
    };
  }

  var api = {
    create: create
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiConversations = api;
})(typeof window !== "undefined" ? window : globalThis);
