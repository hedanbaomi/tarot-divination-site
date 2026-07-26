(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DivinationHistoryUi = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DECK_LABELS = {
    tarot: "Tarot",
    mystagogus: "Mystagogus",
    lxxxi: "LXXXI"
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function formatTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function button(text, className) {
    var element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function createDefinition(label, value) {
    var row = document.createElement("div");
    row.className = "history-definition-row";
    var term = document.createElement("dt");
    term.textContent = label;
    var description = document.createElement("dd");
    description.textContent = value;
    row.appendChild(term);
    row.appendChild(description);
    return row;
  }

  function init(options) {
    options = options || {};
    var store = options.store;
    var recordsApi = options.recordsApi || globalThis.DivinationHistoryRecords;
    var createSnapshot = options.createSnapshot;
    var available = false;
    var readingComplete = false;
    var selectedRecordId = null;
    var restoreFocusTo = null;

    var elements = {
      open: byId("historyOpenBtn"),
      save: byId("saveHistoryBtn"),
      saveStatus: byId("historySaveStatus"),
      dialog: byId("historyDialog"),
      close: byId("historyCloseBtn"),
      filter: byId("historyDeckFilter"),
      exportButton: byId("historyExportBtn"),
      importInput: byId("historyImportInput"),
      importLabel: byId("historyImportLabel"),
      actionStatus: byId("historyActionStatus"),
      list: byId("historyList"),
      empty: byId("historyEmpty"),
      detail: byId("historyDetail"),
      detailTitle: byId("historyDetailTitle"),
      detailBody: byId("historyDetailBody"),
      back: byId("historyBackBtn"),
      deleteButton: byId("historyDeleteBtn"),
      clear: byId("historyClearBtn")
    };

    function setStatus(target, message, isError) {
      if (!target) return;
      target.textContent = message;
      target.classList.toggle("is-error", Boolean(isError));
    }

    function setUnavailable() {
      available = false;
      if (elements.save) {
        elements.save.disabled = true;
        elements.save.title = "当前浏览器无法使用本地历史";
      }
      if (elements.importLabel) {
        elements.importLabel.setAttribute("aria-disabled", "true");
        elements.importLabel.classList.add("is-disabled");
      }
      [elements.exportButton, elements.clear, elements.filter].forEach(function (element) {
        if (element) element.disabled = true;
      });
      setStatus(elements.saveStatus, readingComplete ? "当前浏览器无法保存历史；占卜仍可正常使用。" : "", true);
      setStatus(elements.actionStatus, "当前浏览器无法访问 IndexedDB，历史不可用；占卜功能不受影响。", true);
    }

    function showListView() {
      selectedRecordId = null;
      if (elements.list) elements.list.hidden = false;
      if (elements.empty) elements.empty.hidden = true;
      if (elements.detail) elements.detail.hidden = true;
      if (elements.back) elements.back.hidden = true;
      if (elements.deleteButton) elements.deleteButton.hidden = true;
    }

    function renderList(records) {
      showListView();
      elements.list.replaceChildren();
      elements.empty.hidden = records.length !== 0;
      records.forEach(function (record) {
        var item = document.createElement("li");
        item.className = "history-list-item";
        var openButton = button("", "history-record-open");
        openButton.setAttribute("aria-label", "查看 " + record.spreadName + "，" + formatTime(record.createdAt));

        var heading = document.createElement("span");
        heading.className = "history-record-title";
        heading.textContent = record.spreadName;
        var meta = document.createElement("span");
        meta.className = "history-record-meta";
        meta.textContent = formatTime(record.createdAt) + " · " +
          (DECK_LABELS[record.deckType] || record.deckName) + " · " +
          record.cards.length + " 张";
        openButton.appendChild(heading);
        openButton.appendChild(meta);
        openButton.addEventListener("click", function () {
          showDetail(record);
        });
        item.appendChild(openButton);
        elements.list.appendChild(item);
      });
    }

    function renderCard(record, card) {
      var item = document.createElement("li");
      item.className = "history-detail-card";
      var name = document.createElement("h4");
      name.textContent = card.positionNumber + ". " + card.positionName;
      var cardName = document.createElement("p");
      var orientation = card.orientation === "reversed" ? "逆位" : "正位";
      var layer = card.layer === "major" ? " · 大牌层（因）" :
        card.layer === "minor" ? " · 小牌层（果）" : "";
      cardName.textContent = card.cardName + "（" + card.cardNumber + "） · " + orientation + layer;
      item.appendChild(name);
      item.appendChild(cardName);
      return item;
    }

    function showDetail(record) {
      selectedRecordId = record.id;
      elements.list.hidden = true;
      elements.empty.hidden = true;
      elements.detail.hidden = false;
      elements.back.hidden = false;
      elements.deleteButton.hidden = false;
      elements.detailTitle.textContent = record.spreadName;
      elements.detailBody.replaceChildren();

      var definitions = document.createElement("dl");
      definitions.className = "history-definitions";
      definitions.appendChild(createDefinition("时间", formatTime(record.createdAt)));
      definitions.appendChild(createDefinition("牌组", record.deckName));
      definitions.appendChild(createDefinition("牌数", String(record.cards.length)));
      elements.detailBody.appendChild(definitions);

      var cardsHeading = document.createElement("h3");
      cardsHeading.textContent = "完整牌位";
      var cards = document.createElement("ol");
      cards.className = "history-detail-cards";
      record.cards.forEach(function (card) {
        cards.appendChild(renderCard(record, card));
      });
      elements.detailBody.appendChild(cardsHeading);
      elements.detailBody.appendChild(cards);
      elements.back.focus();
    }

    async function refreshList() {
      if (!available) {
        elements.list.replaceChildren();
        elements.empty.hidden = false;
        return;
      }
      try {
        var records = await store.listRecords(elements.filter.value || "all");
        renderList(records);
      } catch (_error) {
        setUnavailable();
      }
    }

    function openDialog() {
      restoreFocusTo = document.activeElement;
      showListView();
      setStatus(elements.actionStatus, "", false);
      if (typeof elements.dialog.showModal === "function") {
        elements.dialog.showModal();
      } else {
        elements.dialog.setAttribute("open", "");
      }
      refreshList();
      elements.close.focus();
    }

    function closeDialog() {
      if (typeof elements.dialog.close === "function") elements.dialog.close();
      else {
        elements.dialog.removeAttribute("open");
        if (restoreFocusTo && typeof restoreFocusTo.focus === "function") restoreFocusTo.focus();
      }
    }

    async function saveCurrentReading() {
      if (!available || !readingComplete) return;
      elements.save.disabled = true;
      try {
        var record = createSnapshot();
        var result = await store.saveRecord(record);
        if (result.duplicate) {
          setStatus(elements.saveStatus, "这次完整占卜刚刚已经保存，无需重复保存。", false);
        } else {
          setStatus(elements.saveStatus, "已保存到当前浏览器的占卜历史。", false);
        }
      } catch (_error) {
        setStatus(elements.saveStatus, "保存失败；占卜结果仍保留在当前页面。", true);
      } finally {
        elements.save.disabled = !available || !readingComplete;
      }
    }

    async function deleteSelected() {
      if (!available || !selectedRecordId) return;
      try {
        await store.deleteRecord(selectedRecordId);
        setStatus(elements.actionStatus, "已删除这条历史记录。", false);
        await refreshList();
        elements.filter.focus();
      } catch (_error) {
        setStatus(elements.actionStatus, "删除失败，请稍后再试。", true);
      }
    }

    async function clearAll() {
      if (!available) return;
      if (!globalThis.confirm("确定清空当前浏览器中的全部占卜历史吗？此操作无法撤销。")) return;
      try {
        await store.clearRecords();
        setStatus(elements.actionStatus, "全部历史记录已清空。", false);
        await refreshList();
        elements.clear.focus();
      } catch (_error) {
        setStatus(elements.actionStatus, "清空失败，请稍后再试。", true);
      }
    }

    async function exportAll() {
      if (!available) return;
      try {
        var records = await store.listRecords("all");
        var json = recordsApi.serializeExport(records);
        var blob = new Blob([json], { type: "application/json;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = "tarot-history-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
        setStatus(elements.actionStatus, "历史已导出为 JSON 备份。", false);
      } catch (_error) {
        setStatus(elements.actionStatus, "导出失败，请稍后再试。", true);
      }
    }

    async function importFile(event) {
      var file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (!available || !file) return;
      try {
        if (file.size > recordsApi.MAX_IMPORT_BYTES) throw new Error("too large");
        var envelope = recordsApi.parseImportJson(await file.text());
        var result = await store.importRecords(envelope.records);
        var message = "已导入 " + result.importedCount + " 条历史记录。";
        if (result.remappedCount) message += " " + result.remappedCount + " 条重复 ID 已安全重编号。";
        setStatus(elements.actionStatus, message, false);
        await refreshList();
      } catch (_error) {
        setStatus(elements.actionStatus, "导入失败：文件格式不正确或内容已损坏。", true);
      }
    }

    function updateSaveAvailability(complete) {
      readingComplete = Boolean(complete);
      elements.save.hidden = !readingComplete;
      elements.save.disabled = !readingComplete || !available;
      if (!readingComplete) setStatus(elements.saveStatus, "", false);
      else if (!available) setStatus(elements.saveStatus, "当前浏览器无法保存历史；占卜仍可正常使用。", true);
    }

    elements.open.addEventListener("click", openDialog);
    elements.close.addEventListener("click", closeDialog);
    elements.dialog.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && typeof elements.dialog.close !== "function") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || typeof elements.dialog.showModal === "function") return;
      var focusable = Array.prototype.slice.call(elements.dialog.querySelectorAll(
        "button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"
      )).filter(function (element) { return !element.hidden; });
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
    elements.dialog.addEventListener("close", function () {
      if (restoreFocusTo && typeof restoreFocusTo.focus === "function") restoreFocusTo.focus();
    });
    elements.filter.addEventListener("change", refreshList);
    elements.save.addEventListener("click", saveCurrentReading);
    elements.back.addEventListener("click", function () {
      refreshList().then(function () { elements.filter.focus(); });
    });
    elements.deleteButton.addEventListener("click", deleteSelected);
    elements.clear.addEventListener("click", clearAll);
    elements.exportButton.addEventListener("click", exportAll);
    elements.importInput.addEventListener("change", importFile);
    elements.importLabel.addEventListener("keydown", function (event) {
      if (!available || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      elements.importInput.click();
    });

    updateSaveAvailability(false);
    Promise.resolve()
      .then(function () { return store.open(); })
      .then(function () {
        available = true;
        elements.save.disabled = !readingComplete;
        elements.save.removeAttribute("title");
        elements.importLabel.removeAttribute("aria-disabled");
        elements.importLabel.classList.remove("is-disabled");
      })
      .catch(setUnavailable);

    return {
      updateSaveAvailability: updateSaveAvailability,
      refresh: refreshList
    };
  }

  return { init: init };
});
