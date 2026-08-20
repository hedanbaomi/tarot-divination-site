(function (global) {
  "use strict";

  var activeController = null;

  function init(options) {
    options = options || {};
    var document = options.document || global.document;
    var core = options.core || global.DivinationCustomSpreads;
    var platform = options.platform === "android" ? "android" : "web";
    if (!document || !core) return null;

    var library = core.createLibrary({ platform: platform, storage: options.storage || null });
    var activateSpread = typeof options.activateSpread === "function"
      ? options.activateSpread
      : function () { return Promise.resolve(true); };
    var onCatalogueChange = typeof options.onCatalogueChange === "function"
      ? options.onCatalogueChange
      : function () {};
    var editingId = null;
    var currentCode = "";
    var draft = emptyDraft();

    var elements = {
      open: document.getElementById("customSpreadOpenBtn"),
      dialog: document.getElementById("customSpreadDialog"),
      close: document.getElementById("customSpreadCloseBtn"),
      privacy: document.getElementById("customSpreadPrivacy"),
      tabs: Array.prototype.slice.call(document.querySelectorAll("[data-custom-spread-tab]")),
      panels: Array.prototype.slice.call(document.querySelectorAll("[data-custom-spread-panel]")),
      library: document.getElementById("customSpreadLibrary"),
      libraryEmpty: document.getElementById("customSpreadLibraryEmpty"),
      newButton: document.getElementById("customSpreadNewBtn"),
      name: document.getElementById("customSpreadName"),
      description: document.getElementById("customSpreadDescription"),
      columns: document.getElementById("customSpreadColumns"),
      rows: document.getElementById("customSpreadRows"),
      preview: document.getElementById("customSpreadPreview"),
      positions: document.getElementById("customSpreadPositions"),
      addPosition: document.getElementById("customSpreadAddPositionBtn"),
      generate: document.getElementById("customSpreadGenerateBtn"),
      saveUse: document.getElementById("customSpreadSaveUseBtn"),
      shareCode: document.getElementById("customSpreadShareCode"),
      copy: document.getElementById("customSpreadCopyBtn"),
      download: document.getElementById("customSpreadDownloadBtn"),
      importCode: document.getElementById("customSpreadImportCode"),
      importUse: document.getElementById("customSpreadImportUseBtn"),
      status: document.getElementById("customSpreadStatus")
    };
    if (!elements.open || !elements.dialog) return null;

    function t(key, values) {
      return global.DivinationI18n ? global.DivinationI18n.t(key, values) : key;
    }

    function emptyPosition(index) {
      return { name: "", meaning: "", column: (index % 3) + 1, row: Math.floor(index / 3) + 1 };
    }

    function emptyDraft() {
      return {
        name: "",
        description: "",
        columns: 3,
        rows: 3,
        positions: [emptyPosition(0), emptyPosition(1), emptyPosition(2)]
      };
    }

    function cleanDefinition(source) {
      return {
        name: source.name,
        description: source.description || "",
        columns: Number(source.columns),
        rows: Number(source.rows),
        positions: (source.positions || []).map(function (position) {
          return {
            name: position.name,
            meaning: position.meaning || "",
            column: Number(position.column),
            row: Number(position.row)
          };
        })
      };
    }

    function setStatus(key, values, kind) {
      elements.status.textContent = key ? t(key, values) : "";
      elements.status.dataset.kind = kind || "info";
    }

    function setOperationError(error, fallbackKey) {
      setStatus(error && error.code === "CUSTOM_SPREAD_STORAGE"
        ? "customSpread.storageFailed"
        : fallbackKey, null, "error");
    }

    function showPanel(name) {
      elements.tabs.forEach(function (tab) {
        var selected = tab.dataset.customSpreadTab === name;
        tab.setAttribute("aria-selected", selected ? "true" : "false");
        tab.tabIndex = selected ? 0 : -1;
        tab.classList.toggle("is-active", selected);
      });
      elements.panels.forEach(function (panel) {
        panel.hidden = panel.dataset.customSpreadPanel !== name;
      });
      setStatus("");
    }

    function openDialog(panel) {
      renderLibrary();
      showPanel(panel || "library");
      elements.dialog.showModal();
      elements.dialog.setAttribute("aria-hidden", "false");
    }

    function closeDialog() {
      elements.dialog.close();
      elements.dialog.setAttribute("aria-hidden", "true");
      elements.open.focus();
    }

    function handleBack() {
      if (!elements.dialog.open) return false;
      closeDialog();
      return true;
    }

    function syncDraftFromFields() {
      draft.name = elements.name.value;
      draft.description = elements.description.value;
      draft.columns = Number(elements.columns.value);
      draft.rows = Number(elements.rows.value);
      draft.positions.forEach(function (position) {
        position.column = Math.max(1, Math.min(draft.columns, Number(position.column) || 1));
        position.row = Math.max(1, Math.min(draft.rows, Number(position.row) || 1));
      });
    }

    function syncFieldsFromDraft() {
      elements.name.value = draft.name;
      elements.description.value = draft.description;
      elements.columns.value = String(draft.columns);
      elements.rows.value = String(draft.rows);
      elements.saveUse.textContent = platform === "android"
        ? t("customSpread.saveAndUse")
        : t("customSpread.useThisSession");
      elements.privacy.textContent = platform === "android"
        ? t("customSpread.androidPrivacy")
        : t("customSpread.webPrivacy");
      renderPositions();
      renderPreview();
    }

    function makeButton(labelKey, className, handler) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = className || "btn btn-secondary";
      button.textContent = t(labelKey);
      button.addEventListener("click", handler);
      return button;
    }

    function renderLibrary() {
      var spreads = library.list();
      var cards = spreads.map(function (spreadDefinition) {
        var card = document.createElement("article");
        card.className = "custom-spread-library-card";
        var heading = document.createElement("h3");
        heading.textContent = spreadDefinition.name;
        var meta = document.createElement("p");
        meta.className = "custom-spread-library-meta";
        meta.textContent = t("customSpread.cardCount", { count: spreadDefinition.positions.length }) +
          " · " + spreadDefinition.columns + " × " + spreadDefinition.rows;
        var description = document.createElement("p");
        description.textContent = spreadDefinition.description || t("customSpread.noDescription");
        var actions = document.createElement("div");
        actions.className = "custom-spread-card-actions";
        actions.appendChild(makeButton("customSpread.use", "btn btn-accent", function () {
          useSpread(spreadDefinition);
        }));
        actions.appendChild(makeButton("customSpread.edit", "btn btn-secondary", function () {
          beginEdit(spreadDefinition);
        }));
        actions.appendChild(makeButton("customSpread.copyCode", "btn btn-secondary", function () {
          currentCode = library.exportCode(spreadDefinition.id);
          elements.shareCode.value = currentCode;
          copyCode();
        }));
        actions.appendChild(makeButton("customSpread.delete", "btn history-danger-btn", function () {
          removeSpread(spreadDefinition);
        }));
        card.appendChild(heading);
        card.appendChild(meta);
        card.appendChild(description);
        card.appendChild(actions);
        return card;
      });
      elements.library.replaceChildren.apply(elements.library, cards);
      elements.libraryEmpty.hidden = spreads.length !== 0;
    }

    function beginNew() {
      editingId = null;
      currentCode = "";
      draft = emptyDraft();
      elements.shareCode.value = "";
      syncFieldsFromDraft();
      showPanel("designer");
      elements.name.focus();
    }

    function beginEdit(spreadDefinition) {
      editingId = spreadDefinition.id;
      currentCode = library.exportCode(editingId);
      draft = cleanDefinition(spreadDefinition);
      elements.shareCode.value = currentCode;
      syncFieldsFromDraft();
      showPanel("designer");
      elements.name.focus();
    }

    function positionInput(type, value, label, maxLength, handler) {
      var wrapper = document.createElement("label");
      wrapper.className = "custom-spread-position-field";
      var caption = document.createElement("span");
      caption.textContent = label;
      var input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
      if (type !== "textarea") input.type = type;
      input.value = value;
      if (maxLength) input.maxLength = maxLength;
      input.addEventListener("input", function () { handler(input.value); });
      wrapper.appendChild(caption);
      wrapper.appendChild(input);
      return { wrapper: wrapper, input: input };
    }

    function renderPositions() {
      var rows = draft.positions.map(function (position, index) {
        var item = document.createElement("li");
        item.className = "custom-spread-position-item";
        item.dataset.positionIndex = String(index);
        var title = document.createElement("strong");
        title.textContent = t("customSpread.positionNumber", { number: index + 1 });
        var nameField = positionInput("text", position.name, t("customSpread.positionName"), 80, function (value) {
          position.name = value;
          renderPreview();
        });
        var meaningField = positionInput("textarea", position.meaning, t("customSpread.positionMeaning"), 300, function (value) {
          position.meaning = value;
        });
        var coordinateFields = document.createElement("div");
        coordinateFields.className = "custom-spread-coordinate-fields";
        var columnField = positionInput("number", String(position.column), t("customSpread.column"), 0, function (value) {
          position.column = Math.max(1, Math.min(draft.columns, Number(value) || 1));
          renderPreview();
        });
        columnField.input.min = "1";
        columnField.input.max = String(draft.columns);
        var rowField = positionInput("number", String(position.row), t("customSpread.row"), 0, function (value) {
          position.row = Math.max(1, Math.min(draft.rows, Number(value) || 1));
          renderPreview();
        });
        rowField.input.min = "1";
        rowField.input.max = String(draft.rows);
        coordinateFields.appendChild(columnField.wrapper);
        coordinateFields.appendChild(rowField.wrapper);
        var actions = document.createElement("div");
        actions.className = "custom-spread-position-actions";
        var up = makeButton("customSpread.moveUp", "btn btn-secondary", function () { movePosition(index, -1); });
        var down = makeButton("customSpread.moveDown", "btn btn-secondary", function () { movePosition(index, 1); });
        var remove = makeButton("customSpread.removePosition", "btn history-danger-btn", function () {
          draft.positions.splice(index, 1);
          renderPositions();
          renderPreview();
        });
        up.disabled = index === 0;
        down.disabled = index === draft.positions.length - 1;
        actions.appendChild(up);
        actions.appendChild(down);
        actions.appendChild(remove);
        item.appendChild(title);
        item.appendChild(nameField.wrapper);
        item.appendChild(meaningField.wrapper);
        item.appendChild(coordinateFields);
        item.appendChild(actions);
        return item;
      });
      elements.positions.replaceChildren.apply(elements.positions, rows);
      elements.addPosition.disabled = draft.positions.length >= core.MAX_POSITIONS;
    }

    function movePosition(index, delta) {
      var target = index + delta;
      if (target < 0 || target >= draft.positions.length) return;
      var item = draft.positions[index];
      draft.positions.splice(index, 1);
      draft.positions.splice(target, 0, item);
      renderPositions();
      renderPreview();
    }

    function renderPreview() {
      var columns = Math.max(1, Math.min(7, Number(draft.columns) || 1));
      var rows = Math.max(1, Math.min(10, Number(draft.rows) || 1));
      elements.preview.style.setProperty("--custom-columns", columns);
      elements.preview.style.setProperty("--custom-rows", rows);
      var cells = [];
      for (var row = 1; row <= rows; row++) {
        for (var column = 1; column <= columns; column++) {
          var cell = document.createElement("span");
          cell.className = "custom-spread-preview-cell";
          cell.style.gridColumn = String(column);
          cell.style.gridRow = String(row);
          cell.setAttribute("aria-hidden", "true");
          cells.push(cell);
        }
      }
      var collisionCounts = {};
      draft.positions.forEach(function (position, index) {
        var key = position.column + ":" + position.row;
        var layer = collisionCounts[key] || 0;
        collisionCounts[key] = layer + 1;
        var marker = document.createElement("button");
        marker.type = "button";
        marker.className = "custom-spread-preview-position";
        marker.style.gridColumn = String(Math.max(1, Math.min(columns, Number(position.column) || 1)));
        marker.style.gridRow = String(Math.max(1, Math.min(rows, Number(position.row) || 1)));
        marker.style.setProperty("--preview-offset-x", Math.min(layer, 2) * 10 + "%");
        marker.style.setProperty("--preview-offset-y", Math.min(layer, 2) * 14 + "%");
        marker.style.zIndex = String(index + 1);
        marker.textContent = String(index + 1);
        marker.setAttribute("aria-label", t("customSpread.previewPosition", {
          number: index + 1,
          name: position.name || t("customSpread.unnamedPosition")
        }));
        marker.addEventListener("click", function () {
          var item = elements.positions.querySelector('[data-position-index="' + index + '"] input[type="text"]');
          if (item) item.focus();
        });
        cells.push(marker);
      });
      elements.preview.replaceChildren.apply(elements.preview, cells);
    }

    function normalizedDraft() {
      syncDraftFromFields();
      return core.normalizeDefinition(cleanDefinition(draft));
    }

    function generateCode() {
      try {
        currentCode = core.encode(normalizedDraft());
        elements.shareCode.value = currentCode;
        setStatus("customSpread.codeReady", null, "success");
        return currentCode;
      } catch (_error) {
        currentCode = "";
        elements.shareCode.value = "";
        setStatus("customSpread.invalidDefinition", null, "error");
        return "";
      }
    }

    async function saveAndUse() {
      try {
        var normalized = normalizedDraft();
        var previousId = editingId;
        var saved = library.upsert(normalized);
        currentCode = library.exportCode(saved.id);
        elements.shareCode.value = currentCode;
        renderLibrary();
        if (await activateSpread(saved)) {
          if (previousId && previousId !== saved.id) {
            library.remove(previousId);
          }
          onCatalogueChange(saved.id, previousId && previousId !== saved.id ? previousId : null);
          editingId = saved.id;
          renderLibrary();
          setStatus(platform === "android" ? "customSpread.savedAndroid" : "customSpread.savedWeb", null, "success");
          closeDialog();
        } else {
          onCatalogueChange();
        }
      } catch (error) {
        setOperationError(error, "customSpread.invalidDefinition");
      }
    }

    async function useSpread(spreadDefinition) {
      if (await activateSpread(spreadDefinition)) closeDialog();
    }

    async function importAndUse() {
      try {
        var imported = library.importCode(elements.importCode.value.trim());
        renderLibrary();
        elements.importCode.value = "";
        setStatus(platform === "android" ? "customSpread.importedAndroid" : "customSpread.importedWeb", null, "success");
        if (await activateSpread(imported)) {
          onCatalogueChange(imported.id);
          closeDialog();
        } else {
          onCatalogueChange();
        }
      } catch (error) {
        setOperationError(error, "customSpread.invalidCode");
      }
    }

    async function requestRemoval(spreadDefinition) {
      if (!global.DivinationDialog || typeof global.DivinationDialog.request !== "function") return false;
      return global.DivinationDialog.request({
        kicker: t("customSpread.deleteKicker"),
        title: t("customSpread.deleteTitle"),
        message: t("customSpread.deleteMessage", { name: spreadDefinition.name }),
        cancelLabel: t("customSpread.keep"),
        proceedLabel: t("customSpread.delete")
      });
    }

    async function removeSpread(spreadDefinition) {
      if (!(await requestRemoval(spreadDefinition))) return;
      try {
        library.remove(spreadDefinition.id);
        onCatalogueChange(null, spreadDefinition.id);
        renderLibrary();
        setStatus("customSpread.deleted", null, "success");
      } catch (error) {
        setOperationError(error, "customSpread.invalidDefinition");
      }
    }

    async function copyCode() {
      var code = currentCode || generateCode();
      if (!code) return;
      try {
        if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
          await global.navigator.clipboard.writeText(code);
        } else {
          elements.shareCode.focus();
          elements.shareCode.select();
          if (!document.execCommand || !document.execCommand("copy")) throw new Error("copy unavailable");
        }
        setStatus("customSpread.copied", null, "success");
      } catch (_error) {
        setStatus("customSpread.copyFailed", null, "error");
      }
    }

    function downloadCode() {
      var code = currentCode || generateCode();
      if (!code || !global.Blob || !global.URL || !global.URL.createObjectURL) {
        setStatus("customSpread.downloadFailed", null, "error");
        return;
      }
      var blob = new global.Blob([code + "\n"], { type: "text/plain;charset=utf-8" });
      var url = global.URL.createObjectURL(blob);
      var anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "quareia-spread-code.txt";
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 0);
      setStatus("customSpread.downloaded", null, "success");
    }

    function refreshLanguage() {
      elements.privacy.textContent = platform === "android"
        ? t("customSpread.androidPrivacy")
        : t("customSpread.webPrivacy");
      elements.saveUse.textContent = platform === "android"
        ? t("customSpread.saveAndUse")
        : t("customSpread.useThisSession");
      renderLibrary();
      renderPositions();
      renderPreview();
    }

    elements.open.addEventListener("click", function () { openDialog("library"); });
    elements.close.addEventListener("click", closeDialog);
    elements.dialog.addEventListener("cancel", function (event) { event.preventDefault(); closeDialog(); });
    elements.tabs.forEach(function (tab) {
      tab.addEventListener("click", function () { showPanel(tab.dataset.customSpreadTab); });
      tab.addEventListener("keydown", function (event) {
        var currentIndex = elements.tabs.indexOf(tab);
        var nextIndex = currentIndex;
        if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % elements.tabs.length;
        else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + elements.tabs.length) % elements.tabs.length;
        else if (event.key === "Home") nextIndex = 0;
        else if (event.key === "End") nextIndex = elements.tabs.length - 1;
        else return;
        event.preventDefault();
        var nextTab = elements.tabs[nextIndex];
        showPanel(nextTab.dataset.customSpreadTab);
        nextTab.focus();
      });
    });
    elements.newButton.addEventListener("click", beginNew);
    elements.columns.addEventListener("input", function () {
      syncDraftFromFields();
      renderPositions();
      renderPreview();
    });
    elements.rows.addEventListener("input", function () {
      syncDraftFromFields();
      renderPositions();
      renderPreview();
    });
    elements.addPosition.addEventListener("click", function () {
      if (draft.positions.length >= core.MAX_POSITIONS) return;
      var next = emptyPosition(draft.positions.length);
      next.column = Math.min(draft.columns, next.column);
      next.row = Math.min(draft.rows, next.row);
      draft.positions.push(next);
      renderPositions();
      renderPreview();
    });
    elements.generate.addEventListener("click", generateCode);
    elements.saveUse.addEventListener("click", saveAndUse);
    elements.copy.addEventListener("click", copyCode);
    elements.download.addEventListener("click", downloadCode);
    elements.importUse.addEventListener("click", importAndUse);
    global.addEventListener("quareia:languagechange", refreshLanguage);

    syncFieldsFromDraft();
    renderLibrary();

    activeController = {
      list: library.list,
      getById: library.getById,
      open: openDialog,
      refreshLanguage: refreshLanguage,
      handleBack: handleBack
    };
    return activeController;
  }

  global.DivinationCustomSpreadUi = {
    init: init,
    handleBack: function () {
      return activeController ? activeController.handleBack() : false;
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = global.DivinationCustomSpreadUi;
})(typeof globalThis !== "undefined" ? globalThis : this);
