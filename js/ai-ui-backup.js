(function (global) {
  "use strict";

  function create(page, helpers, conversations) {
    var els = page.els;
    var state = page.state;
    var life = page.life;
    var chatStoreApi = page.chatStoreApi;
    var chatStore = page.chatStore;

    function showToast(message, isError) {
      if (!els.themeToast || !message) return;
      if (state.toastTimer) {
        life.cancel(state.toastTimer);
        state.toastTimer = null;
      }
      els.themeToast.textContent = message;
      els.themeToast.classList.toggle("is-error", Boolean(isError));
      els.themeToast.classList.add("is-on");
      state.toastTimer = life.later(function () {
        state.toastTimer = null;
        if (els.themeToast) {
          els.themeToast.classList.remove("is-on");
          els.themeToast.classList.remove("is-error");
        }
      }, 3400);
    }

    function onExportResult(result) {
      if (result && result.cancelled) {
        showToast(helpers.tr("ai.exportCancelled", null, "已取消导出。", "Export cancelled."), false);
      } else if (result && result.ok) {
        var outName = result.fileName || "quareia-ai-export";
        showToast(helpers.tr("ai.exportedTo", { fileName: outName },
          "已导出：" + outName,
          "Exported: " + outName), false);
      } else {
        var failMsg = helpers.tr("ai.exportFailed", null, "导出失败，请稍后重试。", "Export failed. Please try again.");
        showToast(failMsg, true);
        if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
          global.DivinationDialog.request({
            kicker: helpers.tr("ai.backupKicker", null, "AI 备份", "AI BACKUP"),
            title: helpers.tr("ai.exportFailed", null, "导出失败，请稍后重试。", "Export failed. Please try again."),
            message: failMsg,
            cancelLabel: helpers.tr("ai.close", null, "关闭", "Close"),
            proceedLabel: helpers.tr("ai.ok", null, "确定", "OK")
          });
        }
      }
    }

    function exportActiveConversationMarkdown() {
      var conv = state.activeConversation;
      if (!conv) return;
      try {
        var md = chatStoreApi.formatConversationMarkdown(conv, { locale: helpers.currentLocale() });
        var stamp = new Date().toISOString().slice(0, 10);
        helpers.triggerFileDownload(md, "quareia-ai-reading-" + stamp + ".md", "text/markdown;charset=utf-8");
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
          return helpers.confirmAction({
            kicker: helpers.tr("ai.backupKicker", null, "AI BACKUP", "AI BACKUP"),
            title: helpers.tr("ai.archiveTooLargeTitle", null, "备份超过导入上限", "Backup exceeds the import limit"),
            message: helpers.tr("ai.archiveTooLargeMsg", null,
              "全部对话的 JSON 备份超过 8 MiB，无法通过本页面恢复。可改为导出全部对话的 Markdown 存档，保留聊天正文、回答提示与占卜摘要供阅读。Markdown 存档不能导入聊天列表。",
              "The JSON backup exceeds the 8 MiB import limit and cannot be restored here. You can instead export all transcripts, response notices and reading summaries as a readable Markdown archive. This archive cannot be imported into the chat list."),
            cancelLabel: helpers.tr("ai.cancel", null, "取消", "Cancel"),
            proceedLabel: helpers.tr("ai.exportArchive", null, "导出 Markdown 存档", "Export Markdown Archive")
          }).then(function (confirmed) {
            if (!confirmed) return;
            var archive = backup.conversations.map(function (conv) {
              return chatStoreApi.formatConversationMarkdown(conv, { locale: helpers.currentLocale() });
            }).join("\n---\n\n");
            helpers.triggerFileDownload(archive, "quareia-ai-archive-" + stamp + ".md", "text/markdown;charset=utf-8");
          });
        }
        helpers.triggerFileDownload(json, "quareia-ai-chats-" + stamp + ".json", "application/json;charset=utf-8");
      }).catch(function () {
        if (typeof global.__quareiaHistoryExportResult === "function") {
          global.__quareiaHistoryExportResult({ ok: false });
        }
      });
    }

    function showBackupImportError(err) {
      if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
        return global.DivinationDialog.request({
          kicker: helpers.tr("ai.backupKicker", null, "AI BACKUP", "AI BACKUP"),
          title: helpers.tr("ai.importErrTitle", null, "导入失败", "Import Failed"),
          message: err && err.code === "backup_too_large"
            ? helpers.tr("ai.importTooLarge", null, "AI 对话备份不能超过 8 MiB。请选择较小的备份文件。", "AI chat backups must be 8 MiB or smaller. Choose a smaller backup file.")
            : helpers.tr("ai.importErrMsg", null, "文件格式不匹配，请选择本站导出的 AI 对话 JSON 备份文件。", "Invalid backup file format. Choose an AI chat JSON backup exported from this app."),
          cancelLabel: helpers.tr("ai.close", null, "关闭", "Close"),
          proceedLabel: helpers.tr("ai.ok", null, "确定", "OK")
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
        return conversations.refreshConversationsList().then(function () {
          if (global.DivinationDialog && typeof global.DivinationDialog.request === "function") {
            return global.DivinationDialog.request({
              kicker: helpers.tr("ai.backupKicker", null, "AI BACKUP", "AI BACKUP"),
              title: helpers.tr("ai.importDoneTitle", null, "导入完成", "Import Complete"),
              message: helpers.tr("ai.importDoneMsg", { imported: res.importedCount, total: res.totalCount },
                "已成功合并导入 " + res.importedCount + " 段对话（当前共 " + res.totalCount + " 段）。",
                "Merged " + res.importedCount + " conversations (" + res.totalCount + " total)."),
              cancelLabel: helpers.tr("ai.close", null, "关闭", "Close"),
              proceedLabel: helpers.tr("ai.ok", null, "知道了", "OK")
            });
          }
          return null;
        });
      }).catch(showBackupImportError);
    }

    return {
      exportAllChatsBackup: exportAllChatsBackup,
      importChatsBackup: importChatsBackup,
      exportActiveConversationMarkdown: exportActiveConversationMarkdown,
      onExportResult: onExportResult
    };
  }

  var api = {
    create: create
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiBackup = api;
})(typeof window !== "undefined" ? window : globalThis);
