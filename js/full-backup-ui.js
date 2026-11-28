(function (global) {
  "use strict";

  var SECTION_KEYS = ["history", "cardNotes", "customSpreads", "aiChats", "preferences"];
  var SPREAD_SELECTION_KEY = "quareia-spread-selection-v1";
  var THEME_I18N_KEYS = {
    celestial: "theme.celestial",
    parchment: "theme.parchment",
    ember: "theme.ember",
    grove: "theme.grove",
    "grove-light": "theme.groveLight",
    jade: "theme.jade",
    dusk: "theme.dusk",
    ash: "theme.ash"
  };

  function buildFileName(date) {
    var d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    function pad(value) {
      return String(value).padStart(2, "0");
    }
    return "quareia-full-backup-" +
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
      pad(d.getHours()) + pad(d.getMinutes()) + ".json";
  }

  function isAndroidSurface() {
    if (global.androidAbout || global.androidHistoryExport) {
      return true;
    }
    if (global.document) {
      var customDialog = global.document.getElementById("customSpreadDialog");
      if (customDialog && customDialog.dataset && customDialog.dataset.platform === "android") {
        return true;
      }
      if (global.document.getElementById("appMenu")) {
        return true;
      }
    }
    return false;
  }

  function readDeckBinding(getter, globalKey) {
    try {
      var value = getter();
      if (Array.isArray(value)) return value;
    } catch (_error) {}
    if (global && Array.isArray(global[globalKey])) return global[globalKey];
    return [];
  }

  function buildKnownCardChecker() {
    var catalog = new Set();
    var decks = {
      tarot: readDeckBinding(function () { return typeof tarotDeckFull !== "undefined" ? tarotDeckFull : null; }, "tarotDeckFull"),
      mystagogus: readDeckBinding(function () { return typeof mystagogusDeckFull !== "undefined" ? mystagogusDeckFull : null; }, "mystagogusDeckFull"),
      lxxxi: readDeckBinding(function () { return typeof lxxxiDeckFull !== "undefined" ? lxxxiDeckFull : null; }, "lxxxiDeckFull")
    };
    Object.keys(decks).forEach(function (deck) {
      var list = decks[deck];
      if (!Array.isArray(list)) return;
      list.forEach(function (card) {
        if (card && card.id != null) {
          catalog.add(deck + "/" + String(card.id));
        }
      });
    });
    return function isKnownCard(deckType, cardId) {
      return catalog.has(String(deckType) + "/" + String(cardId));
    };
  }

  function getLocalStorageSafe() {
    try {
      return global.localStorage || null;
    } catch (_error) {
      return null;
    }
  }

  function createCustomSpreadsAdapter(core) {
    if (!core || typeof core.createLibrary !== "function") return null;
    var storage = getLocalStorageSafe();
    if (isAndroidSurface()) {
      return core.createLibrary({ platform: "android", storage: storage });
    }

    // On Web, custom spreads are session-only except for the persisted active
    // spread code in quareia-spread-selection-v1 and any backup-restored items
    // stored in quareia-custom-spreads-v1. Combine both cleanly.
    var persisted = null;
    if (storage) {
      try {
        persisted = core.createLibrary({ platform: "android", storage: storage });
      } catch (_error) {
        persisted = null;
      }
    }
    var mem = core.createLibrary({ platform: "web", storage: null });
    if (persisted) {
      persisted.list().forEach(function (spread) {
        var code = persisted.exportCode(spread.id);
        if (code) {
          try { mem.importCode(code); } catch (_err) {}
        }
      });
    }
    if (storage) {
      try {
        var rawSel = storage.getItem(SPREAD_SELECTION_KEY);
        if (rawSel) {
          var sel = JSON.parse(rawSel);
          if (sel && typeof sel.customSpreadCode === "string" && sel.customSpreadCode) {
            mem.importCode(sel.customSpreadCode);
          }
        }
      } catch (_err) {}
    }

    return {
      list: function () { return mem.list(); },
      getById: function (id) { return mem.getById(id); },
      exportCode: function (id) { return mem.exportCode(id); },
      upsert: function (def) {
        var saved = mem.upsert(def);
        if (persisted) {
          try { persisted.upsert(def); } catch (_err) {}
        }
        return saved;
      },
      importCode: function (code) {
        var imported = mem.importCode(code);
        if (persisted) {
          try { persisted.importCode(code); } catch (_err) {}
        }
        return imported;
      },
      remove: function (id) {
        var removed = mem.remove(id);
        if (persisted) {
          try { persisted.remove(id); } catch (_err) {}
        }
        return removed;
      }
    };
  }

  function createRuntimeAdapters(isKnownCard) {
    var historyStore = null;
    if (global.DivinationHistoryStore && global.DivinationHistoryRecords) {
      try {
        historyStore = global.DivinationHistoryStore.createStore({
          recordsApi: global.DivinationHistoryRecords
        });
      } catch (_error) {
        historyStore = null;
      }
    }

    var cardNotesStore = null;
    if (global.DivinationCardNotesStore && typeof global.DivinationCardNotesStore.createStore === "function") {
      try {
        cardNotesStore = global.DivinationCardNotesStore.createStore({
          isKnownCard: isKnownCard
        });
      } catch (_error) {
        cardNotesStore = null;
      }
    }

    var customSpreadsLibrary = null;
    if (global.DivinationCustomSpreads) {
      try {
        customSpreadsLibrary = createCustomSpreadsAdapter(global.DivinationCustomSpreads);
      } catch (_error) {
        customSpreadsLibrary = null;
      }
    }

    var aiChatStore = null;
    if (global.DivinationAiChatStore && typeof global.DivinationAiChatStore.createStore === "function") {
      try {
        aiChatStore = global.DivinationAiChatStore.createStore();
      } catch (_error) {
        aiChatStore = null;
      }
    }

    return {
      historyStore: historyStore,
      historyRecords: global.DivinationHistoryRecords || null,
      cardNotesStore: cardNotesStore,
      isKnownCard: isKnownCard,
      customSpreads: global.DivinationCustomSpreads || null,
      customSpreadsLibrary: customSpreadsLibrary,
      aiChatStore: aiChatStore,
      aiChatStoreApi: global.DivinationAiChatStore || null,
      themeApi: global.DivinationTheme || null,
      i18nApi: global.DivinationI18n || null
    };
  }

  function createValidators(isKnownCard) {
    return {
      historyRecords: global.DivinationHistoryRecords || null,
      isKnownCard: isKnownCard,
      customSpreads: global.DivinationCustomSpreads || null,
      aiChatStoreApi: global.DivinationAiChatStore || null
    };
  }

  function init(options) {
    options = options || {};
    var doc = options.document || global.document;
    if (!doc) return null;

    var el = function (id) { return doc.getElementById(id); };
    var openBtn = el("fullBackupOpenBtn");
    var dialog = el("fullBackupDialog");
    var closeBtn = el("fullBackupCloseBtn");
    var titleEl = el("fullBackupDialogTitle");
    var statusEl = el("fullBackupStatus");
    var refreshBtn = el("fullBackupRefreshBtn");
    var localCountsEl = el("fullBackupLocalCounts");
    var unavailableEl = el("fullBackupUnavailable");
    var exportBtn = el("fullBackupExportBtn");
    var chooseBtn = el("fullBackupChooseBtn");
    var importInput = el("fullBackupImportInput");
    var previewEl = el("fullBackupPreview");
    var previewFileEl = el("fullBackupPreviewFile");
    var previewTimeEl = el("fullBackupPreviewTime");
    var previewListEl = el("fullBackupPreviewList");
    var confirmBtn = el("fullBackupConfirmBtn");
    var cancelBtn = el("fullBackupCancelBtn");
    var summaryEl = el("fullBackupSummary");
    var summaryListEl = el("fullBackupSummaryList");

    if (!dialog) return null;

    var isKnownCard = typeof options.isKnownCard === "function"
      ? options.isKnownCard
      : buildKnownCardChecker();

    function getCore() {
      return options.core || global.DivinationFullBackup || null;
    }

    function getAdapters() {
      if (typeof options.getAdapters === "function") return options.getAdapters();
      return createRuntimeAdapters(isKnownCard);
    }

    function getValidators() {
      if (typeof options.getValidators === "function") return options.getValidators();
      return createValidators(isKnownCard);
    }

    function t(key, values) {
      return global.DivinationI18n ? global.DivinationI18n.t(key, values) : key;
    }

    function getLocale() {
      return global.DivinationI18n && typeof global.DivinationI18n.getLocale === "function"
        ? global.DivinationI18n.getLocale()
        : "zh-CN";
    }

    var opener = null;
    var busy = false;
    var statusState = { key: "", values: null, tone: "" };
    var lastLocalCounts = null;
    var pendingBackup = null;
    var pendingFileName = "";
    var selectedMap = Object.create(null);
    var lastRestoreState = null;

    function setStatus(key, values, tone) {
      statusState = { key: key || "", values: values || null, tone: tone || "" };
      if (!statusEl) return;
      statusEl.textContent = key ? t(key, values) : "";
      statusEl.classList.toggle("is-success", tone === "success");
      statusEl.classList.toggle("is-error", tone === "error");
    }

    function setBusy(nextBusy) {
      busy = Boolean(nextBusy);
      if (exportBtn) exportBtn.disabled = busy;
      if (refreshBtn) refreshBtn.disabled = busy;
      if (chooseBtn) chooseBtn.disabled = busy;
      if (cancelBtn) cancelBtn.disabled = busy;
      updateConfirmButtonState();
    }

    function updateConfirmButtonState() {
      if (!confirmBtn) return;
      if (busy || !pendingBackup) {
        confirmBtn.disabled = true;
        return;
      }
      var anyChecked = getSelectedSections().length > 0;
      confirmBtn.disabled = !anyChecked;
    }

    function formatTimestamp(iso) {
      if (!iso) return "";
      var date = new Date(iso);
      if (Number.isNaN(date.getTime())) return String(iso);
      try {
        return new Intl.DateTimeFormat(getLocale(), {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit"
        }).format(date);
      } catch (_error) {
        return date.toISOString().replace("T", " ").slice(0, 16);
      }
    }

    function themeLabel(themeId) {
      var key = THEME_I18N_KEYS[themeId];
      return key ? t(key) : String(themeId || "");
    }

    function localeLabel(localeId) {
      if (localeId === "zh-CN") return t("fullBackup.locale.zh-CN");
      if (localeId === "en") return t("fullBackup.locale.en");
      return String(localeId || "");
    }

    function formatPreferencesSummary(prefs) {
      if (!prefs || typeof prefs !== "object") return "";
      var parts = [];
      if (prefs.theme) {
        parts.push(t("fullBackup.prefTheme", { theme: themeLabel(prefs.theme) }));
      }
      if (prefs.locale) {
        parts.push(t("fullBackup.prefLocale", { locale: localeLabel(prefs.locale) }));
      }
      return parts.join(" · ");
    }

    function currentLocalPreferences() {
      var out = {};
      if (global.DivinationTheme && typeof global.DivinationTheme.getTheme === "function") {
        out.theme = global.DivinationTheme.getTheme();
      }
      if (global.DivinationI18n && typeof global.DivinationI18n.getLocale === "function") {
        out.locale = global.DivinationI18n.getLocale();
      }
      return out;
    }

    function sectionOrder(core) {
      return core && Array.isArray(core.SECTION_KEYS) ? core.SECTION_KEYS : SECTION_KEYS;
    }

    function sectionCountText(key, countsObj, sectionData, isUnavailable) {
      if (isUnavailable) return t("fullBackup.count.unavailable");
      if (key === "preferences") {
        var summary = formatPreferencesSummary(sectionData);
        return summary
          ? t("fullBackup.count.preferences", { summary: summary })
          : t("fullBackup.count.preferencesEmpty");
      }
      var num = countsObj && typeof countsObj[key] === "number" ? countsObj[key] : 0;
      return t("fullBackup.count." + key, { count: num });
    }

    function renderLocalCounts() {
      if (!localCountsEl) return;
      var counts = lastLocalCounts;
      if (!counts) {
        localCountsEl.replaceChildren();
        if (unavailableEl) unavailableEl.hidden = true;
        return;
      }
      var unavailableList = Array.isArray(counts.unavailable) ? counts.unavailable : [];
      var unavailableSet = new Set(unavailableList);
      var localPrefs = currentLocalPreferences();
      var fragment = doc.createDocumentFragment();
      sectionOrder(getCore()).forEach(function (key) {
        var li = doc.createElement("li");
        li.className = "full-backup-count-row" + (key === "preferences" ? " full-backup-count-row-wide" : "");
        li.dataset.backupCountSection = key;

        var label = doc.createElement("span");
        label.className = "full-backup-count-label";
        label.textContent = t("fullBackup.section." + key);

        var isUnavail = unavailableSet.has(key);
        var value = doc.createElement("span");
        value.className = "full-backup-count-value" + (isUnavail ? " is-unavailable" : "");
        value.textContent = sectionCountText(
          key,
          counts,
          key === "preferences" ? localPrefs : null,
          isUnavail
        );

        li.appendChild(label);
        li.appendChild(value);
        fragment.appendChild(li);
      });
      localCountsEl.replaceChildren(fragment);

      if (unavailableEl) {
        if (unavailableList.length > 0) {
          var names = unavailableList.map(function (key) { return t("fullBackup.section." + key); });
          unavailableEl.textContent = t("fullBackup.unavailableNotice", { modules: names.join("、") });
          unavailableEl.hidden = false;
        } else {
          unavailableEl.textContent = "";
          unavailableEl.hidden = true;
        }
      }
    }

    async function refreshCounts() {
      var core = getCore();
      if (!core || typeof core.inspectLocalCounts !== "function") return null;
      if (!statusState.key) setStatus("fullBackup.loadingCounts", null, "");
      try {
        lastLocalCounts = await core.inspectLocalCounts(getAdapters());
        renderLocalCounts();
        if (statusState.key === "fullBackup.loadingCounts") setStatus("", null, "");
        return lastLocalCounts;
      } catch (_error) {
        setStatus("fullBackup.countsFailed", null, "error");
        return null;
      }
    }

    function getSelectedSections() {
      if (!pendingBackup) return [];
      var available = Array.isArray(pendingBackup.availableSections)
        ? pendingBackup.availableSections
        : [];
      return available.filter(function (key) { return Boolean(selectedMap[key]); });
    }

    function sectionHasItems(parsed, key) {
      if (!parsed || !parsed.sections || !Object.prototype.hasOwnProperty.call(parsed.sections, key)) {
        return false;
      }
      if (key === "preferences") {
        var prefs = parsed.sections.preferences;
        return Boolean(prefs && (prefs.theme || prefs.locale));
      }
      var count = parsed.counts && typeof parsed.counts[key] === "number" ? parsed.counts[key] : 0;
      return count > 0;
    }

    function renderPreview() {
      if (!previewEl || !previewListEl) return;
      if (!pendingBackup) {
        previewEl.hidden = true;
        previewListEl.replaceChildren();
        updateConfirmButtonState();
        return;
      }
      if (previewFileEl) {
        previewFileEl.textContent = t("fullBackup.previewFile", { fileName: pendingFileName });
      }
      if (previewTimeEl) {
        previewTimeEl.textContent = t("fullBackup.previewTime", {
          time: formatTimestamp(pendingBackup.exportedAt)
        });
      }

      var available = Array.isArray(pendingBackup.availableSections)
        ? pendingBackup.availableSections
        : [];
      var fragment = doc.createDocumentFragment();
      if (available.length === 0) {
        var emptyLi = doc.createElement("li");
        emptyLi.className = "full-backup-check-meta";
        emptyLi.textContent = t("fullBackup.previewEmpty");
        fragment.appendChild(emptyLi);
      } else {
        sectionOrder(getCore()).forEach(function (key) {
          if (available.indexOf(key) === -1) return;
          var hasItems = sectionHasItems(pendingBackup, key);
          var li = doc.createElement("li");
          var label = doc.createElement("label");
          label.className = "full-backup-check-item" + (hasItems ? "" : " is-empty");

          var checkbox = doc.createElement("input");
          checkbox.type = "checkbox";
          checkbox.dataset.backupSection = key;
          checkbox.checked = Boolean(selectedMap[key]);
          checkbox.addEventListener("change", function () {
            selectedMap[key] = checkbox.checked;
            updateConfirmButtonState();
          });

          var copy = doc.createElement("span");
          copy.className = "full-backup-check-copy";
          var titleSpan = doc.createElement("span");
          titleSpan.className = "full-backup-check-title";
          titleSpan.textContent = t("fullBackup.section." + key);
          var metaSpan = doc.createElement("span");
          metaSpan.className = "full-backup-check-meta";
          metaSpan.textContent = sectionCountText(
            key,
            pendingBackup.counts,
            pendingBackup.sections ? pendingBackup.sections[key] : null,
            false
          );
          copy.appendChild(titleSpan);
          copy.appendChild(metaSpan);

          label.appendChild(checkbox);
          label.appendChild(copy);
          li.appendChild(label);
          fragment.appendChild(li);
        });
      }
      previewListEl.replaceChildren(fragment);
      previewEl.hidden = false;
      updateConfirmButtonState();
    }

    function clearPreview() {
      pendingBackup = null;
      pendingFileName = "";
      selectedMap = Object.create(null);
      renderPreview();
    }

    function formatSectionSummaryLine(key, restoredEntry, appliedPreferences) {
      if (key === "history") {
        var hImported = (restoredEntry && (restoredEntry.imported != null ? restoredEntry.imported : restoredEntry.importedCount)) || 0;
        var hRemapped = (restoredEntry && (restoredEntry.remapped != null ? restoredEntry.remapped : restoredEntry.remappedCount)) || 0;
        var hSkipped = (restoredEntry && restoredEntry.skipped) || 0;
        if (hRemapped > 0 && hSkipped > 0) {
          return t("fullBackup.summary.historyFull", { imported: hImported, remapped: hRemapped, skipped: hSkipped });
        }
        if (hRemapped > 0) {
          return t("fullBackup.summary.historyRemapped", { imported: hImported, remapped: hRemapped });
        }
        if (hSkipped > 0) {
          return t("fullBackup.summary.historySkipped", { imported: hImported, skipped: hSkipped });
        }
        return t("fullBackup.summary.history", { imported: hImported });
      }
      if (key === "cardNotes") {
        var nImported = (restoredEntry && restoredEntry.imported) || 0;
        var nSkipped = (restoredEntry && restoredEntry.skipped) || 0;
        return t("fullBackup.summary.cardNotes", { imported: nImported, skipped: nSkipped });
      }
      if (key === "customSpreads") {
        var sImported = (restoredEntry && restoredEntry.imported) || 0;
        var sSkipped = (restoredEntry && restoredEntry.skipped) || 0;
        return t("fullBackup.summary.customSpreads", { imported: sImported, skipped: sSkipped });
      }
      if (key === "aiChats") {
        var aImported = (restoredEntry && (restoredEntry.imported != null ? restoredEntry.imported : restoredEntry.importedCount)) || 0;
        var aUpdated = restoredEntry && typeof restoredEntry.updated === "number" ? restoredEntry.updated : null;
        var aSkipped = (restoredEntry && (restoredEntry.skipped != null ? restoredEntry.skipped : restoredEntry.skippedCount)) || 0;
        if (aUpdated !== null) {
          return t("fullBackup.summary.aiChatsDetailed", {
            imported: aImported,
            updated: aUpdated,
            skipped: aSkipped
          });
        }
        return t("fullBackup.summary.aiChats", { imported: aImported, skipped: aSkipped });
      }
      if (key === "preferences") {
        var prefSummary = formatPreferencesSummary(appliedPreferences);
        return prefSummary
          ? t("fullBackup.summary.preferences", { summary: prefSummary })
          : t("fullBackup.summary.preferencesUnchanged");
      }
      return "";
    }

    function renderRestoreSummary() {
      if (!summaryEl || !summaryListEl) return;
      if (!lastRestoreState) {
        summaryEl.hidden = true;
        summaryListEl.replaceChildren();
        return;
      }
      var selected = lastRestoreState.selectedSections || [];
      var outcome = lastRestoreState.outcome || {};
      var restored = outcome.restored || {};
      var appliedPreferences = outcome.appliedPreferences || {};
      var warnings = Array.isArray(outcome.warnings) ? outcome.warnings : [];

      var fragment = doc.createDocumentFragment();
      selected.forEach(function (key) {
        var text = formatSectionSummaryLine(key, restored[key], appliedPreferences);
        if (!text) return;
        var li = doc.createElement("li");
        li.dataset.backupSummarySection = key;
        li.textContent = text;
        fragment.appendChild(li);
      });
      warnings.forEach(function (warning) {
        var li = doc.createElement("li");
        li.className = "full-backup-summary-warning";
        li.textContent = t("fullBackup.summary.warning", { message: String(warning) });
        fragment.appendChild(li);
      });

      summaryListEl.replaceChildren(fragment);
      summaryEl.hidden = summaryListEl.childElementCount === 0;
    }

    function saveExportFile(jsonText, fileName) {
      var nativeBridge = global.androidHistoryExport;
      if (nativeBridge && typeof nativeBridge.save === "function" &&
          global.DivinationNativeFileExport &&
          typeof global.DivinationNativeFileExport.save === "function") {
        setStatus("fullBackup.exportChoosing", { fileName: fileName }, "");
        var started = false;
        try {
          started = global.DivinationNativeFileExport.save(jsonText, fileName, function (result) {
            if (result && result.ok) {
              setStatus("fullBackup.exportedAndroid", { fileName: result.fileName || fileName }, "success");
            } else if (result && result.cancelled) {
              setStatus("fullBackup.exportCancelled", null, "");
            } else {
              setStatus("fullBackup.exportFailed", null, "error");
            }
          });
        } catch (_error) {
          setStatus("fullBackup.exportFailed", null, "error");
          return;
        }
        if (!started) {
          setStatus("fullBackup.exportBusy", null, "error");
        }
        return;
      }

      var blob = new global.Blob([jsonText], { type: "application/json;charset=utf-8" });
      var url = global.URL.createObjectURL(blob);
      var link = doc.createElement("a");
      link.href = url;
      link.download = fileName;
      doc.body.appendChild(link);
      link.click();
      link.remove();
      global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 0);
      setStatus("fullBackup.exportedWeb", { fileName: fileName }, "success");
    }

    async function handleExport() {
      var core = getCore();
      if (busy || !core || typeof core.collectBackup !== "function") return;
      setBusy(true);
      setStatus("fullBackup.exporting", null, "");
      try {
        var bundle = await core.collectBackup(getAdapters());
        lastLocalCounts = Object.assign({}, bundle.counts, { unavailable: bundle.unavailable || [] });
        renderLocalCounts();
        var fileName = buildFileName(new Date());
        saveExportFile(bundle.json, fileName);
      } catch (_error) {
        setStatus("fullBackup.exportFailed", null, "error");
      } finally {
        setBusy(false);
      }
    }

    async function handleFileSelected() {
      var core = getCore();
      var file = importInput && importInput.files && importInput.files[0];
      if (importInput) importInput.value = "";
      if (!file || busy || !core || typeof core.parseBackup !== "function") return;

      lastRestoreState = null;
      renderRestoreSummary();
      var maxBytes = typeof core.MAX_BACKUP_BYTES === "number" ? core.MAX_BACKUP_BYTES : 16 * 1024 * 1024;
      if (typeof file.size === "number" && file.size > maxBytes) {
        clearPreview();
        setStatus("fullBackup.fileTooLarge", null, "error");
        return;
      }

      setBusy(true);
      setStatus("fullBackup.parsing", null, "");
      try {
        var rawText = await file.text();
        var parsed = core.parseBackup(rawText, getValidators());
        pendingBackup = parsed;
        pendingFileName = file.name || "backup.json";
        selectedMap = Object.create(null);
        var available = Array.isArray(parsed.availableSections) ? parsed.availableSections : [];
        available.forEach(function (key) {
          selectedMap[key] = sectionHasItems(parsed, key);
        });
        renderPreview();
        setStatus("", null, "");
        if (confirmBtn && !confirmBtn.disabled) {
          confirmBtn.focus({ preventScroll: true });
        }
      } catch (error) {
        clearPreview();
        var msg = error && error.message ? String(error.message) : "";
        if ((error && error.code === "backup_too_large") || /byte|size|limit|16\s*MiB|too large/i.test(msg)) {
          setStatus("fullBackup.fileTooLarge", null, "error");
        } else {
          setStatus("fullBackup.parseFailed", null, "error");
        }
      } finally {
        setBusy(false);
      }
    }

    async function handleConfirmRestore() {
      var core = getCore();
      if (busy || !pendingBackup || !core || typeof core.restoreBackup !== "function") return;
      var selectedSections = getSelectedSections();
      if (selectedSections.length === 0) {
        setStatus("fullBackup.selectAtLeastOne", null, "error");
        return;
      }

      setBusy(true);
      setStatus("fullBackup.restoring", null, "");
      try {
        var outcome = await core.restoreBackup(pendingBackup, selectedSections, getAdapters());
        clearPreview();
        lastRestoreState = {
          selectedSections: selectedSections.slice(),
          outcome: outcome
        };
        renderRestoreSummary();
        setStatus("fullBackup.restoreDone", null, "success");
        await refreshCounts();
        if (typeof global.dispatchEvent === "function" && typeof global.CustomEvent === "function") {
          global.dispatchEvent(new global.CustomEvent("quareia:fullbackuprestored", {
            detail: { selectedSections: selectedSections.slice(), outcome: outcome }
          }));
        }
      } catch (_error) {
        setStatus("fullBackup.restoreFailed", null, "error");
      } finally {
        setBusy(false);
      }
    }

    function handleCancelPreview() {
      if (busy) return;
      clearPreview();
      setStatus("fullBackup.restoreCancelled", null, "");
      if (chooseBtn) chooseBtn.focus({ preventScroll: true });
    }

    function isOpen() {
      return Boolean(dialog && (dialog.open || (typeof dialog.hasAttribute === "function" && dialog.hasAttribute("open"))));
    }

    function openDialog(trigger) {
      opener = trigger || doc.activeElement;
      if (global.DivinationMenu && typeof global.DivinationMenu.isOpen === "function" && global.DivinationMenu.isOpen()) {
        global.DivinationMenu.close();
        opener = el("menuToggle") || opener;
      }
      var settingsPanel = el("settingsPanel");
      var settingsOpenBtn = el("settingsOpenBtn");
      if (settingsPanel && !settingsPanel.hidden && settingsOpenBtn) {
        settingsOpenBtn.click();
        opener = settingsOpenBtn;
      }
      clearPreview();
      lastRestoreState = null;
      renderRestoreSummary();
      setStatus("", null, "");
      if (typeof dialog.showModal === "function") {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      if (closeBtn && typeof closeBtn.focus === "function") {
        closeBtn.focus({ preventScroll: true });
      } else if (titleEl && typeof titleEl.focus === "function") {
        titleEl.focus({ preventScroll: true });
      }
      refreshCounts();
    }

    function closeDialog() {
      if (!isOpen()) return false;
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      var target = opener;
      opener = null;
      if (target && target.isConnected && target.offsetParent !== null && typeof target.focus === "function") {
        target.focus({ preventScroll: true });
      } else {
        var fallback = el("menuToggle") || el("settingsOpenBtn");
        if (fallback && fallback.offsetParent !== null && typeof fallback.focus === "function") {
          fallback.focus({ preventScroll: true });
        }
      }
      return true;
    }

    function handleBack() {
      if (!isOpen()) return false;
      closeDialog();
      return true;
    }

    function refreshLanguage() {
      renderLocalCounts();
      renderPreview();
      renderRestoreSummary();
      if (statusState.key) {
        setStatus(statusState.key, statusState.values, statusState.tone);
      }
    }

    if (openBtn) {
      openBtn.addEventListener("click", function (event) {
        openDialog(event.currentTarget);
      });
    }
    if (closeBtn) closeBtn.addEventListener("click", closeDialog);
    if (refreshBtn) refreshBtn.addEventListener("click", function () { if (!busy) refreshCounts(); });
    if (exportBtn) exportBtn.addEventListener("click", handleExport);
    if (chooseBtn && importInput) {
      chooseBtn.addEventListener("click", function () {
        if (!busy) importInput.click();
      });
    }
    if (importInput) importInput.addEventListener("change", handleFileSelected);
    if (confirmBtn) confirmBtn.addEventListener("click", handleConfirmRestore);
    if (cancelBtn) cancelBtn.addEventListener("click", handleCancelPreview);

    dialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeDialog();
    });
    dialog.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        closeDialog();
      }
    });
    dialog.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
    dialog.addEventListener("click", function (event) { event.stopPropagation(); });

    if (typeof global.addEventListener === "function") {
      global.addEventListener("quareia:languagechange", refreshLanguage);
      global.addEventListener("quareia:themechange", function () {
        if (isOpen()) renderLocalCounts();
      });
    }

    return {
      open: openDialog,
      close: closeDialog,
      isOpen: isOpen,
      handleBack: handleBack,
      refreshCounts: refreshCounts,
      refreshLanguage: refreshLanguage,
      buildFileName: buildFileName
    };
  }

  var controller = null;

  function boot() {
    if (controller || !global.document) return;
    controller = init();
  }

  if (global.document) {
    if (global.document.readyState === "loading") {
      global.document.addEventListener("DOMContentLoaded", boot);
    } else {
      boot();
    }
  }

  var api = {
    init: init,
    buildFileName: buildFileName,
    open: function (trigger) { if (!controller) boot(); if (controller) controller.open(trigger); },
    close: function () { return controller ? controller.close() : false; },
    isOpen: function () { return controller ? controller.isOpen() : false; },
    handleBack: function () { return controller ? controller.handleBack() : false; },
    refreshCounts: function () { return controller ? controller.refreshCounts() : Promise.resolve(null); },
    refreshLanguage: function () { if (controller) controller.refreshLanguage(); }
  };

  global.DivinationFullBackupUi = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
