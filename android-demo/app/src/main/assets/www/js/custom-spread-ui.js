(function (global) {
  "use strict";

  var activeController = null;
  var DRAW_RULE_KEYS = ["following", "major-only", "minor-only", "wands", "cups", "swords", "pentacles"];
  var DRAW_RULE_LABELS = {
    following: "customSpread.drawRuleFollowing",
    "major-only": "customSpread.drawRuleMajor",
    "minor-only": "customSpread.drawRuleMinor",
    wands: "customSpread.drawRuleWands",
    cups: "customSpread.drawRuleCups",
    swords: "customSpread.drawRuleSwords",
    pentacles: "customSpread.drawRulePentacles"
  };
  var SUIT_RULES = {
    "权杖": "wands",
    "圣杯": "cups",
    "宝剑": "swords",
    "星币": "pentacles",
    wands: "wands",
    cups: "cups",
    swords: "swords",
    pentacles: "pentacles"
  };

  function numberOr(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function canonicalDeckScope(value) {
    return value === "tarot-only" || value === "non-tarot-only" ? value : "any";
  }

  function canonicalTarotMode(value) {
    return value === "major-only" || value === "minor-only" ? value : "mixed";
  }

  function canonicalStackingMode(value) {
    return value === "major-minor" ? value : "single";
  }

  function canonicalDrawRule(value) {
    if (!value) return "following";
    if (typeof value === "object") {
      if (value.arcana === "major") return "major-only";
      if (value.arcana === "minor") return "minor-only";
      if (value.suit && SUIT_RULES[value.suit]) return SUIT_RULES[value.suit];
      if (value.value) return canonicalDrawRule(value.value);
      if (value.id) return canonicalDrawRule(value.id);
      return "following";
    }
    if (value === "none" || value === "any" || value === "mixed" || value === "follow") return "following";
    if (value === "major") return "major-only";
    if (value === "minor") return "minor-only";
    if (SUIT_RULES[value]) return SUIT_RULES[value];
    return DRAW_RULE_KEYS.indexOf(value) === -1 ? "following" : value;
  }

  function drawRuleForCore(value) {
    var rule = canonicalDrawRule(value);
    if (rule === "following") return null;
    if (rule === "major-only") return { arcana: "major" };
    if (rule === "minor-only") return { arcana: "minor" };
    return { suit: rule };
  }

  function stackTargetNumber(value) {
    if (value === null || value === undefined || value === "" || value === false) return null;
    if (typeof value === "object") value = value.number || value.position || value.index;
    var number = Number(value);
    if (!Number.isFinite(number) || number < 1) return null;
    return Math.floor(number);
  }

  function init(options) {
    options = options || {};
    var document = options.document || global.document;
    var core = options.core || global.DivinationCustomSpreads;
    var platform = options.platform === "android" ? "android" : "web";
    if (!document || !core) return null;

    var maxColumns = 10;
    var maxRows = Math.max(1, numberOr(core.MAX_ROWS, 10));
    var maxPositions = Math.max(1, numberOr(core.MAX_POSITIONS, 24));
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
    var dragging = null;
    var effectNormalized = null;
    var effectRuntime = null;

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
      deckScope: document.getElementById("customSpreadDeckScope"),
      tarotMode: document.getElementById("customSpreadTarotMode"),
      stackingMode: document.getElementById("customSpreadStackingMode"),
      preview: document.getElementById("customSpreadPreview"),
      previewEffect: document.getElementById("customSpreadPreviewEffectBtn"),
      effectPanel: document.getElementById("customSpreadEffectPreview"),
      effectClose: document.getElementById("customSpreadEffectPreviewCloseBtn"),
      effectContent: document.getElementById("customSpreadEffectPreviewContent"),
      positions: document.getElementById("customSpreadPositions"),
      dragHint: document.getElementById("customSpreadDragHint"),
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
      return {
        name: "",
        meaning: "",
        column: (index % 3) + 1,
        row: Math.floor(index / 3) + 1,
        drawRule: null,
        stackOn: null
      };
    }

    function emptyDraft() {
      return {
        name: "",
        description: "",
        columns: 3,
        rows: 3,
        deckScope: "any",
        tarotMode: "mixed",
        stackingMode: "single",
        positions: [emptyPosition(0), emptyPosition(1), emptyPosition(2)]
      };
    }

    function cleanDefinition(source) {
      source = source || {};
      var sourcePositions = Array.isArray(source.positions) ? source.positions : [];
      var cleaned = {
        name: source.name || "",
        description: source.description || "",
        columns: numberOr(source.columns, 3),
        rows: numberOr(source.rows, 3),
        deckScope: canonicalDeckScope(source.deckScope),
        tarotMode: canonicalTarotMode(source.tarotMode),
        stackingMode: canonicalStackingMode(source.stackingMode),
        positions: sourcePositions.map(function (position, index) {
          return {
            name: position.name || "",
            meaning: position.meaning || "",
            column: numberOr(position.column, (index % 3) + 1),
            row: numberOr(position.row, Math.floor(index / 3) + 1),
            drawRule: drawRuleForCore(position.drawRule),
            stackOn: stackTargetNumber(position.stackOn)
          };
        })
      };
      applyModeConstraints(cleaned);
      sanitizeStackReferences(cleaned.positions);
      return cleaned;
    }

    function applyModeConstraints(target) {
      target.deckScope = canonicalDeckScope(target.deckScope);
      target.tarotMode = canonicalTarotMode(target.tarotMode);
      target.stackingMode = canonicalStackingMode(target.stackingMode);
      if (target.stackingMode === "major-minor") {
        target.deckScope = "tarot-only";
        target.tarotMode = "mixed";
        (target.positions || []).forEach(function (position) { position.drawRule = null; });
      }
      if (target.deckScope === "non-tarot-only") {
        target.tarotMode = "mixed";
        target.stackingMode = "single";
        (target.positions || []).forEach(function (position) { position.drawRule = null; });
      } else if (target.tarotMode === "major-only") {
        (target.positions || []).forEach(function (position) {
          var rule = canonicalDrawRule(position.drawRule);
          if (rule !== "following" && rule !== "major-only") position.drawRule = null;
        });
      } else if (target.tarotMode === "minor-only") {
        (target.positions || []).forEach(function (position) {
          if (canonicalDrawRule(position.drawRule) === "major-only") position.drawRule = null;
        });
      }
      return target;
    }

    function sanitizeStackReferences(positions) {
      (positions || []).forEach(function (position, index) {
        var target = stackTargetNumber(position.stackOn);
        position.stackOn = target && target <= index ? target : null;
      });
      return positions;
    }

    function syncStackedCoordinates() {
      var changed = [];
      draft.positions.forEach(function (position, index) {
        var target = stackTargetNumber(position.stackOn);
        if (!target || target > index) return;
        var targetPosition = draft.positions[target - 1];
        if (!targetPosition) return;
        if (position.column !== targetPosition.column || position.row !== targetPosition.row) {
          position.column = targetPosition.column;
          position.row = targetPosition.row;
          changed.push(index);
        }
      });
      return changed;
    }

    function remapStackReferences(mutator) {
      var before = draft.positions.slice();
      var targets = before.map(function (position, index) {
        var target = stackTargetNumber(position.stackOn);
        return target && target <= index ? before[target - 1] : null;
      });
      mutator();
      draft.positions.forEach(function (position, index) {
        var oldIndex = before.indexOf(position);
        var target = oldIndex === -1 ? null : targets[oldIndex];
        var targetIndex = target ? draft.positions.indexOf(target) : -1;
        position.stackOn = targetIndex >= 0 && targetIndex < index ? targetIndex + 1 : null;
      });
      sanitizeStackReferences(draft.positions);
      syncStackedCoordinates();
    }

    function setStatus(key, values, kind) {
      if (elements.status) elements.status.textContent = key ? t(key, values) : "";
      if (elements.status) elements.status.dataset.kind = kind || "info";
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
      closeEffectPreview(false);
      renderLibrary();
      showPanel(panel || "library");
      elements.dialog.showModal();
      elements.dialog.setAttribute("aria-hidden", "false");
    }

    function closeDialog() {
      closeEffectPreview(false);
      elements.dialog.close();
      elements.dialog.setAttribute("aria-hidden", "true");
      elements.open.focus();
    }

    function handleBack() {
      if (elements.effectPanel && !elements.effectPanel.hidden) {
        closeEffectPreview(true);
        return true;
      }
      if (!elements.dialog.open) return false;
      closeDialog();
      return true;
    }

    function syncDraftFromFields() {
      draft.name = elements.name.value;
      draft.description = elements.description.value;
      draft.columns = clamp(Math.round(numberOr(elements.columns.value, 1)), 1, maxColumns);
      draft.rows = clamp(Math.round(numberOr(elements.rows.value, 1)), 1, maxRows);
      if (elements.deckScope) draft.deckScope = elements.deckScope.value;
      if (elements.tarotMode) draft.tarotMode = elements.tarotMode.value;
      if (elements.stackingMode) draft.stackingMode = elements.stackingMode.value;
      applyModeConstraints(draft);
      elements.columns.value = String(draft.columns);
      elements.rows.value = String(draft.rows);
      if (elements.deckScope) elements.deckScope.value = draft.deckScope;
      if (elements.tarotMode) elements.tarotMode.value = draft.tarotMode;
      if (elements.stackingMode) elements.stackingMode.value = draft.stackingMode;
      draft.positions.forEach(function (position) {
        position.column = clamp(Math.round(numberOr(position.column, 1)), 1, draft.columns);
        position.row = clamp(Math.round(numberOr(position.row, 1)), 1, draft.rows);
        position.drawRule = canonicalDrawRule(position.drawRule);
      });
      sanitizeStackReferences(draft.positions);
      syncStackedCoordinates();
    }

    function syncModeControls() {
      applyModeConstraints(draft);
      if (elements.deckScope) {
        elements.deckScope.value = draft.deckScope;
        elements.deckScope.disabled = draft.stackingMode === "major-minor";
      }
      if (elements.tarotMode) {
        elements.tarotMode.value = draft.tarotMode;
        elements.tarotMode.disabled = draft.stackingMode === "major-minor" || draft.deckScope === "non-tarot-only";
      }
      if (elements.stackingMode) {
        elements.stackingMode.value = draft.stackingMode;
        elements.stackingMode.disabled = draft.deckScope === "non-tarot-only";
      }
      if (elements.dragHint) elements.dragHint.textContent = t("customSpread.dragHint");
    }

    function syncFieldsFromDraft() {
      syncModeControls();
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
        actions.appendChild(makeButton("customSpread.use", "btn btn-accent", function () { useSpread(spreadDefinition); }));
        actions.appendChild(makeButton("customSpread.edit", "btn btn-secondary", function () { beginEdit(spreadDefinition); }));
        actions.appendChild(makeButton("customSpread.copyCode", "btn btn-secondary", function () {
          currentCode = library.exportCode(spreadDefinition.id);
          elements.shareCode.value = currentCode;
          copyCode();
        }));
        actions.appendChild(makeButton("customSpread.delete", "btn history-danger-btn", function () { removeSpread(spreadDefinition); }));
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

    function positionSelect(labelKey, value, options, handler, disabled) {
      var wrapper = document.createElement("label");
      wrapper.className = "custom-spread-position-field";
      var caption = document.createElement("span");
      caption.textContent = t(labelKey);
      var select = document.createElement("select");
      options.forEach(function (option) {
        var element = document.createElement("option");
        element.value = option.value;
        element.textContent = t(option.label, { number: option.number });
        select.appendChild(element);
      });
      select.value = value === null || value === undefined ? "" : String(value);
      select.disabled = Boolean(disabled);
      select.addEventListener("change", function () { handler(select.value); });
      wrapper.appendChild(caption);
      wrapper.appendChild(select);
      return { wrapper: wrapper, input: select };
    }

    function drawRuleOptions() {
      var keys = DRAW_RULE_KEYS;
      if (draft.deckScope === "non-tarot-only" || draft.stackingMode === "major-minor") {
        keys = ["following"];
      } else if (draft.tarotMode === "major-only") {
        keys = ["following", "major-only"];
      } else if (draft.tarotMode === "minor-only") {
        keys = ["following", "minor-only", "wands", "cups", "swords", "pentacles"];
      }
      return keys.map(function (key) { return { value: key, label: DRAW_RULE_LABELS[key] }; });
    }

    function stackOptions(index) {
      var options = [{ value: "", label: "customSpread.stackOnNone" }];
      for (var target = 0; target < index; target++) {
        options.push({ value: String(target + 1), label: "customSpread.stackOnPrevious", number: target + 1 });
      }
      return options;
    }

    function focusPosition(index) {
      var item = elements.positions.querySelector('[data-position-index="' + index + '"] input[type="text"]');
      if (item) item.focus();
    }

    function renderPositions() {
      syncModeControls();
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
          position.column = clamp(Math.round(numberOr(value, 1)), 1, draft.columns);
          position.stackOn = null;
          syncStackedCoordinates().forEach(syncCoordinateFields);
          renderPreview();
        });
        columnField.input.min = "1";
        columnField.input.max = String(draft.columns);
        var rowField = positionInput("number", String(position.row), t("customSpread.row"), 0, function (value) {
          position.row = clamp(Math.round(numberOr(value, 1)), 1, draft.rows);
          position.stackOn = null;
          syncStackedCoordinates().forEach(syncCoordinateFields);
          renderPreview();
        });
        rowField.input.min = "1";
        rowField.input.max = String(draft.rows);
        coordinateFields.appendChild(columnField.wrapper);
        coordinateFields.appendChild(rowField.wrapper);
        var ruleField = positionSelect("customSpread.drawRule", canonicalDrawRule(position.drawRule), drawRuleOptions(), function (value) {
          position.drawRule = canonicalDrawRule(value);
          if (draft.deckScope === "non-tarot-only") position.drawRule = "following";
          renderPositions();
          renderPreview();
        }, draft.deckScope === "non-tarot-only" || draft.stackingMode === "major-minor");
        var stackField = positionSelect("customSpread.stackOn", position.stackOn, stackOptions(index), function (value) {
          var target = stackTargetNumber(value);
          position.stackOn = target && target <= index ? target : null;
          if (position.stackOn) {
            var targetPosition = draft.positions[position.stackOn - 1];
            position.column = targetPosition.column;
            position.row = targetPosition.row;
          }
          sanitizeStackReferences(draft.positions);
          syncStackedCoordinates();
          renderPositions();
          renderPreview();
        });
        var actions = document.createElement("div");
        actions.className = "custom-spread-position-actions";
        var up = makeButton("customSpread.moveUp", "btn btn-secondary", function () { movePosition(index, -1); });
        var down = makeButton("customSpread.moveDown", "btn btn-secondary", function () { movePosition(index, 1); });
        var remove = makeButton("customSpread.removePosition", "btn history-danger-btn", function () {
          remapStackReferences(function () { draft.positions.splice(index, 1); });
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
        item.appendChild(ruleField.wrapper);
        item.appendChild(stackField.wrapper);
        item.appendChild(actions);
        return item;
      });
      elements.positions.replaceChildren.apply(elements.positions, rows);
      elements.addPosition.disabled = draft.positions.length >= maxPositions;
    }

    function movePosition(index, delta) {
      var target = index + delta;
      if (target < 0 || target >= draft.positions.length) return;
      remapStackReferences(function () {
        var item = draft.positions[index];
        draft.positions.splice(index, 1);
        draft.positions.splice(target, 0, item);
      });
      renderPositions();
      renderPreview();
    }

    function cellFromPointer(event, columns, rows) {
      var rect = elements.preview.getBoundingClientRect();
      var width = Math.max(1, rect.width);
      var height = Math.max(1, rect.height);
      var x = clamp(numberOr(event.clientX, rect.left) - rect.left, 0, width - 1);
      var y = clamp(numberOr(event.clientY, rect.top) - rect.top, 0, height - 1);
      return {
        column: clamp(Math.floor(x / width * columns) + 1, 1, columns),
        row: clamp(Math.floor(y / height * rows) + 1, 1, rows)
      };
    }

    function findPositionAt(column, row, exceptIndex) {
      for (var index = 0; index < draft.positions.length; index++) {
        if (index === exceptIndex) continue;
        if (draft.positions[index].column === column && draft.positions[index].row === row) return index;
      }
      return -1;
    }

    function syncCoordinateFields(index) {
      var item = elements.positions.querySelector('[data-position-index="' + index + '"]');
      if (!item) return;
      var fields = item.querySelectorAll('input[type="number"]');
      if (fields[0]) fields[0].value = String(draft.positions[index].column);
      if (fields[1]) fields[1].value = String(draft.positions[index].row);
    }

    function updateMarker(marker, index) {
      var position = draft.positions[index];
      if (!position) return;
      marker.style.gridColumn = String(position.column);
      marker.style.gridRow = String(position.row);
      marker.textContent = String(index + 1);
      syncCoordinateFields(index);
    }

    function applyDraggedCell(index, cell) {
      var position = draft.positions[index];
      if (!position) return;
      position.column = cell.column;
      position.row = cell.row;
      var targetIndex = findPositionAt(cell.column, cell.row, index);
      position.stackOn = targetIndex >= 0 && targetIndex < index ? targetIndex + 1 : null;
      sanitizeStackReferences(draft.positions);
      syncStackedCoordinates();
    }

    function beginPointerDrag(event, index, marker) {
      if (event.pointerType === "mouse" && event.button !== undefined && event.button !== 0) return;
      dragging = {
        index: index,
        marker: marker,
        pointerId: event.pointerId,
        originalColumn: draft.positions[index].column,
        originalRow: draft.positions[index].row,
        originalStackOn: draft.positions[index].stackOn,
        moved: false
      };
      marker.classList.add("is-dragging");
      var item = elements.positions.querySelector('[data-position-index="' + index + '"]');
      if (item) item.classList.add("is-dragging");
      if (typeof marker.setPointerCapture === "function" && event.pointerId !== undefined) {
        try { marker.setPointerCapture(event.pointerId); } catch (_error) {}
      }
      if (event.preventDefault) event.preventDefault();
    }

    function movePointerDrag(event, index, marker) {
      if (!dragging || dragging.index !== index || dragging.pointerId !== event.pointerId) return;
      var cell = cellFromPointer(event, draft.columns, draft.rows);
      if (cell.column !== draft.positions[index].column || cell.row !== draft.positions[index].row) {
        dragging.moved = true;
        applyDraggedCell(index, cell);
        updateMarker(marker, index);
        renderPreviewCellsOnly();
      }
      if (event.preventDefault) event.preventDefault();
    }

    function finishPointerDrag(event, index, marker, cancelled) {
      if (!dragging || dragging.index !== index || dragging.pointerId !== event.pointerId) return;
      if (cancelled) {
        draft.positions[index].column = dragging.originalColumn;
        draft.positions[index].row = dragging.originalRow;
        draft.positions[index].stackOn = dragging.originalStackOn;
        syncStackedCoordinates();
      }
      var didMove = dragging.moved;
      marker.classList.remove("is-dragging");
      var item = elements.positions.querySelector('[data-position-index="' + index + '"]');
      if (item) item.classList.remove("is-dragging");
      if (typeof marker.releasePointerCapture === "function" && event.pointerId !== undefined) {
        try { marker.releasePointerCapture(event.pointerId); } catch (_error) {}
      }
      dragging = null;
      if (didMove) marker.dataset.dragged = "true";
      renderPositions();
      renderPreview();
      if (event.preventDefault) event.preventDefault();
    }

    function attachPointerHandlers(marker, index) {
      marker.addEventListener("pointerdown", function (event) { beginPointerDrag(event, index, marker); });
      marker.addEventListener("pointermove", function (event) { movePointerDrag(event, index, marker); });
      marker.addEventListener("pointerup", function (event) { finishPointerDrag(event, index, marker, false); });
      marker.addEventListener("pointercancel", function (event) { finishPointerDrag(event, index, marker, true); });
      marker.addEventListener("click", function () {
        if (marker.dataset.dragged === "true") {
          marker.dataset.dragged = "false";
          return;
        }
        focusPosition(index);
      });
    }

    function renderPreviewCellsOnly() {
      var markers = elements.preview.querySelectorAll(".custom-spread-preview-position");
      for (var index = 0; index < markers.length; index++) {
        updateMarker(markers[index], Number(markers[index].dataset.positionIndex));
      }
    }

    function renderPreview() {
      var columns = clamp(Math.round(numberOr(draft.columns, 1)), 1, maxColumns);
      var rows = clamp(Math.round(numberOr(draft.rows, 1)), 1, maxRows);
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
        marker.dataset.positionIndex = String(index);
        marker.style.gridColumn = String(clamp(Number(position.column) || 1, 1, columns));
        marker.style.gridRow = String(clamp(Number(position.row) || 1, 1, rows));
        marker.style.setProperty("--preview-offset-x", Math.min(layer, 2) * 10 + "%");
        marker.style.setProperty("--preview-offset-y", Math.min(layer, 2) * 14 + "%");
        marker.style.zIndex = String(index + 1);
        marker.textContent = String(index + 1);
        marker.setAttribute("aria-label", t("customSpread.previewPosition", {
          number: index + 1,
          name: position.name || t("customSpread.unnamedPosition")
        }));
        attachPointerHandlers(marker, index);
        cells.push(marker);
      });
      elements.preview.replaceChildren.apply(elements.preview, cells);
    }

    function normalizedDraft() {
      syncDraftFromFields();
      return core.normalizeDefinition(cleanDefinition(draft));
    }

    function ruleLabel(rule) {
      return t(DRAW_RULE_LABELS[canonicalDrawRule(rule)] || DRAW_RULE_LABELS.following);
    }

    function createEffectCard(position, index, layerName, offsetX, offsetY, zIndex) {
      var card = document.createElement("article");
      var layered = layerName === "major" || layerName === "minor";
      var layerLabel = layerName === "major" ? t("customSpread.previewMajorLayer")
        : layerName === "minor" ? t("customSpread.previewMinorLayer") : t("customSpread.previewCardLayer");
      var positionName = position.name || t("customSpread.unnamedPosition");
      var drawRuleLabel = ruleLabel(position.drawRule);
      card.className = "custom-spread-effect-card spread-card is-new" +
        (layered ? " overview-stack-card stack-layer-" + layerName : "");
      card.setAttribute("role", "listitem");
      card.setAttribute("data-preview-card-state", "face-down");
      if (layered) card.setAttribute("data-layer", layerName);
      card.setAttribute("aria-label", [
        t("customSpread.positionNumber", { number: index + 1 }),
        positionName,
        drawRuleLabel,
        layerLabel
      ].join(" · "));
      card.style.gridColumn = String(position.column);
      card.style.gridRow = String(position.row);
      card.style.zIndex = String(zIndex);
      card.style.setProperty("--effect-offset-x", String(offsetX) + "%");
      card.style.setProperty("--effect-offset-y", String(offsetY) + "%");
      card.style.setProperty("--position-offset-x", String(offsetX) + "%");
      card.style.setProperty("--position-offset-y", String(offsetY) + "%");

      var inner = document.createElement("div");
      inner.className = "spread-card-inner";
      inner.setAttribute("aria-hidden", "true");
      var back = document.createElement("div");
      back.className = "spread-card-face spread-card-back";
      var backArt = document.createElement("div");
      backArt.className = "spread-card-back-art";
      var number = document.createElement("span");
      number.className = "pos-num";
      number.textContent = String(index + 1);
      backArt.appendChild(number);
      if (position.drawRule) {
        var rule = document.createElement("span");
        rule.className = "draw-rule-badge";
        rule.textContent = drawRuleLabel;
        backArt.appendChild(rule);
      }
      if (layered) {
        var layer = document.createElement("span");
        layer.className = "stack-layer-badge";
        layer.textContent = layerLabel;
        backArt.appendChild(layer);
      }
      var title = document.createElement("span");
      title.className = "pos-name";
      var titleText = document.createElement("span");
      titleText.className = "pos-name-zh";
      titleText.textContent = positionName;
      title.appendChild(titleText);
      backArt.appendChild(title);
      back.appendChild(backArt);
      inner.appendChild(back);
      card.appendChild(inner);
      return card;
    }

    function renderEffectPreview(normalized, runtime) {
      if (!elements.effectContent) return;
      var columns = clamp(Math.round(numberOr(runtime.columns, normalized.columns)), 1, maxColumns);
      var rows = clamp(Math.round(numberOr(runtime.rows, normalized.rows)), 1, maxRows);
      elements.effectContent.replaceChildren();
      elements.effectContent.style.setProperty("--custom-columns", columns);
      elements.effectContent.style.setProperty("--custom-rows", rows);
      var runtimePositions = Array.isArray(runtime.positions) ? runtime.positions : normalized.positions;
      var positions = normalized.positions;
      runtimePositions.forEach(function (runtimePosition, index) {
        var position = positions[index] || runtimePosition;
        var layers = normalized.stackingMode === "major-minor" ? ["major", "minor"] : ["card"];
        layers.forEach(function (layerName) {
          var layered = normalized.stackingMode === "major-minor";
          var offsetX = layered ? (layerName === "major" ? -8 : 8) : numberOr(runtimePosition.offsetX, 0);
          var offsetY = layered ? (layerName === "major" ? -10 : 12) : numberOr(runtimePosition.offsetY, 0);
          var zIndex = index + 1 + (layerName === "minor" ? 100 : 0);
          var card = createEffectCard({
            name: position.name || runtimePosition.name,
            column: clamp(numberOr(runtimePosition.column, numberOr(position.column, 1)), 1, columns),
            row: clamp(numberOr(runtimePosition.row, numberOr(position.row, 1)), 1, rows),
            drawRule: position.drawRule
          }, index, layerName, offsetX, offsetY, zIndex);
          elements.effectContent.appendChild(card);
        });
      });
    }

    function closeEffectPreview(restoreFocus) {
      if (!elements.effectPanel) return;
      elements.effectPanel.hidden = true;
      elements.effectPanel.setAttribute("aria-hidden", "true");
      effectNormalized = null;
      effectRuntime = null;
      if (restoreFocus && elements.previewEffect) elements.previewEffect.focus();
    }

    function openEffectPreview() {
      try {
        effectNormalized = normalizedDraft();
        effectRuntime = core.toRuntimeSpread(effectNormalized);
        renderEffectPreview(effectNormalized, effectRuntime);
        if (elements.effectPanel) {
          elements.effectPanel.hidden = false;
          elements.effectPanel.setAttribute("aria-hidden", "false");
          if (elements.effectClose) elements.effectClose.focus();
        }
      } catch (_error) {
        setStatus("customSpread.invalidDefinition", null, "error");
      }
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
          if (previousId && previousId !== saved.id) library.remove(previousId);
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
      syncModeControls();
      elements.privacy.textContent = platform === "android"
        ? t("customSpread.androidPrivacy")
        : t("customSpread.webPrivacy");
      elements.saveUse.textContent = platform === "android"
        ? t("customSpread.saveAndUse")
        : t("customSpread.useThisSession");
      renderLibrary();
      renderPositions();
      renderPreview();
      if (effectNormalized && effectRuntime) renderEffectPreview(effectNormalized, effectRuntime);
    }

    elements.open.addEventListener("click", function () { openDialog("library"); });
    if (elements.close) elements.close.addEventListener("click", closeDialog);
    elements.dialog.addEventListener("cancel", function (event) { event.preventDefault(); handleBack(); });
    if (elements.effectClose) elements.effectClose.addEventListener("click", function () { closeEffectPreview(true); });
    if (elements.previewEffect) elements.previewEffect.addEventListener("click", openEffectPreview);
    global.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && elements.effectPanel && !elements.effectPanel.hidden) {
        event.preventDefault();
        closeEffectPreview(true);
      }
    });
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
    elements.columns.addEventListener("change", function () {
      syncDraftFromFields();
      renderPositions();
      renderPreview();
    });
    elements.rows.addEventListener("change", function () {
      syncDraftFromFields();
      renderPositions();
      renderPreview();
    });
    if (elements.deckScope) elements.deckScope.addEventListener("change", function () {
      syncDraftFromFields();
      renderPositions();
      renderPreview();
    });
    if (elements.tarotMode) elements.tarotMode.addEventListener("change", function () {
      syncDraftFromFields();
      renderPositions();
      renderPreview();
    });
    if (elements.stackingMode) elements.stackingMode.addEventListener("change", function () {
      syncDraftFromFields();
      renderPositions();
      renderPreview();
    });
    elements.addPosition.addEventListener("click", function () {
      if (draft.positions.length >= maxPositions) return;
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
