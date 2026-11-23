(function (global) {
  "use strict";

  var decks = { tarot: tarotDeckFull, mystagogus: mystagogusDeckFull, lxxxi: lxxxiDeckFull };
  var catalog = new Map();
  function key(deck, id) { return deck + "/" + id; }
  Object.keys(decks).forEach(function (deck) {
    decks[deck].forEach(function (card) { catalog.set(key(deck, card.id), card); });
  });

  var store = global.DivinationCardNotesStore.createStore({
    isKnownCard: function (deck, id) { return catalog.has(key(deck, id)); }
  });
  var marked = new Set();
  var libraryNotes = new Map();
  var el = function (id) { return document.getElementById(id); };
  var dialog = el("cardNotesDialog");
  var textarea = el("cardNotesText");
  var list = el("cardNotesList");
  var search = el("cardNotesSearch");
  var back = el("cardNotesBackBtn");
  var libraryOrigin = false;
  var opener = null;
  var libraryScroll = 0;
  var active = null;
  var refreshId = 0;
  var statusKey = "";
  var statusValues;

  function t(id, values) { return global.DivinationI18n.t(id, values); }
  function name(card) { return global.DivinationI18n.field(card, "name"); }
  function status(id, values) {
    statusKey = id;
    statusValues = values;
    el("cardNotesStatus").textContent = id ? t(id, values) : "";
  }

  function updateButton(button) {
    var cardKey = key(button.dataset.noteDeck, button.dataset.noteCard);
    var hasNote = marked.has(cardKey);
    button.classList.toggle("has-note", hasNote);
    var cardName = name(catalog.get(cardKey));
    button.textContent = button.classList.contains("card-note-link") ? t("notes.open") : cardName;
    button.setAttribute("aria-label", t("notes.editFor", { name: cardName }) +
      (hasNote ? " · " + t("notes.hasNote") : ""));
  }

  function noteButton(deck, id, inLibrary) {
    if (!catalog.has(key(deck, id))) return null;
    var button = document.createElement("button");
    button.type = "button";
    button.className = inLibrary ? "card-notes-card" : "card-note-link";
    button.dataset.noteDeck = deck;
    button.dataset.noteCard = id;
    button.setAttribute("aria-haspopup", "dialog");
    updateButton(button);
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      openEditor(deck, id, button, inLibrary);
    });
    return button;
  }

  function markRevealedCard(element, deck, id) {
    element.dataset.noteMarker = key(deck, id);
    element.classList.toggle("has-card-note", marked.has(element.dataset.noteMarker));
  }

  function paintMarkers() {
    document.querySelectorAll("[data-note-marker]").forEach(function (card) {
      card.classList.toggle("has-card-note", marked.has(card.dataset.noteMarker));
    });
    document.querySelectorAll(".card-note-link").forEach(updateButton);
  }

  async function refreshIndex(includeText) {
    var request = ++refreshId;
    if (includeText) {
      var rows = await store.list();
      if (request !== refreshId) return;
      libraryNotes = new Map(rows.map(function (row) { return [key(row.deckType, row.cardId), row.text]; }));
      marked = new Set(libraryNotes.keys());
    } else {
      var keys = await store.keys();
      if (request !== refreshId) return;
      marked = new Set(keys.map(function (pair) { return key(pair[0], pair[1]); }));
    }
    paintMarkers();
  }

  function renderList() {
    var query = search.value.trim().toLowerCase();
    var onlySaved = el("cardNotesOnlySaved").checked;
    var fragment = document.createDocumentFragment();
    Object.keys(decks).forEach(function (deck) {
      var group = document.createElement("section");
      var cards = document.createElement("div");
      cards.className = "card-notes-cards";
      decks[deck].forEach(function (card) {
        var id = key(deck, card.id);
        if (onlySaved && !marked.has(id)) return;
        if (query && ![card.name, card.nameEn, t("deck.name." + deck), libraryNotes.get(id)].some(function (field) {
          return field && field.toLowerCase().includes(query);
        })) return;
        cards.appendChild(noteButton(deck, card.id, true));
      });
      if (!cards.childElementCount) return;
      var heading = document.createElement("h3");
      heading.textContent = t("deck.name." + deck);
      group.append(heading, cards);
      fragment.appendChild(group);
    });
    if (!fragment.childElementCount) {
      var empty = document.createElement("p");
      empty.textContent = t(onlySaved && !marked.size ? "notes.noNotes" : "notes.noMatches");
      fragment.appendChild(empty);
    }
    list.replaceChildren(fragment);
  }

  function renderHeading() {
    el("cardNotesDeck").hidden = !active;
    el("cardNotesTitle").textContent = active ? name(catalog.get(key(active.deck, active.id))) : t("notes.library");
    if (active) el("cardNotesDeck").textContent = t("deck.name." + active.deck);
    el("cardNotesLibrary").hidden = Boolean(active);
    el("cardNotesEditor").hidden = !active;
    textarea.placeholder = t("notes.emptyEditor");
  }

  function recovery(kind) {
    el("cardNotesRecovery").hidden = !kind;
    el("cardNotesDiscard").hidden = kind !== "save";
    el("cardNotesRetry").textContent = t(kind === "conflict" ? "notes.reload" : "notes.retry");
  }

  async function openLibrary(button) {
    opener = button;
    if (global.DivinationMenu && global.DivinationMenu.isOpen()) {
      global.DivinationMenu.close();
      opener = el("menuToggle");
    }
    libraryOrigin = true;
    active = null;
    search.value = "";
    el("cardNotesOnlySaved").checked = false;
    renderHeading();
    recovery("");
    list.replaceChildren();
    status("notes.loading");
    dialog.showModal();
    back.focus({ preventScroll: true });
    await loadLibrary();
  }

  async function loadLibrary() {
    try {
      await refreshIndex(true);
      if (!dialog.open || active) return;
      renderList();
      status("");
      recovery("");
    } catch (_) {
      if (dialog.open && !active) { status("notes.loadFailed"); recovery("load"); }
    }
  }

  async function loadEditor(session) {
    if (session.loading) return session.loading;
    textarea.readOnly = true;
    status("notes.loading");
    recovery("");
    session.loading = store.get(session.deck, session.id).then(function (row) {
      if (active !== session) return;
      session.base = row ? row.text : null;
      textarea.value = session.base || "";
      // Textareas normalize CRLF to LF. Viewing an imported note must preserve the original.
      session.savedInput = textarea.value;
      session.ready = true;
      session.error = "";
      status("notes.autoSave");
    }).catch(function () {
      if (active !== session) return;
      // A failed conflict reload must leave the draft available to copy or retry.
      session.error = session.ready ? "conflict" : "load";
      status(session.ready ? "notes.conflict" : "notes.loadFailed");
      recovery(session.error);
    }).finally(function () {
      session.loading = null;
      if (active === session) textarea.readOnly = !session.ready || session.leaving;
    });
    return session.loading;
  }

  function openEditor(deck, id, button, fromLibrary) {
    if (active) return;
    if (fromLibrary) libraryScroll = list.scrollTop;
    else { opener = button; libraryOrigin = false; }
    active = { deck: deck, id: id, ready: false, pending: null, leaving: false, timer: 0, error: "" };
    textarea.value = "";
    renderHeading();
    if (!dialog.open) dialog.showModal();
    el("cardNotesTitle").focus({ preventScroll: true });
    loadEditor(active);
  }

  function recordSaved(session, row) {
    var id = key(session.deck, session.id);
    ++refreshId;
    if (row) {
      marked.add(id);
      if (libraryOrigin) libraryNotes.set(id, row.text);
    } else {
      marked.delete(id);
      libraryNotes.delete(id);
    }
    paintMarkers();
  }

  async function flush(session) {
    clearTimeout(session.timer);
    if (session.pending) {
      await session.pending;
      return flush(session);
    }
    if (active !== session || !session.ready) return true;
    if (session.error === "conflict" || session.error === "save") return false;
    var value = textarea.value;
    if (session.savedInput === value) return true;
    status("notes.saving");
    session.pending = store.save(session.deck, session.id, value, session.base).then(function (row) {
      session.base = row ? row.text : null;
      session.savedInput = value;
      recordSaved(session, row);
      status(value === textarea.value ? "notes.saved" : "notes.saving");
      recovery("");
    }).catch(function (error) {
      session.error = error.code === "conflict" ? "conflict" : "save";
      status(session.error === "conflict" ? "notes.conflict" : "notes.saveFailed");
      recovery(session.error);
    }).finally(function () { session.pending = null; });
    await session.pending;
    return !session.error;
  }

  function closeDialog() {
    dialog.close();
    libraryNotes.clear();
    var target = opener;
    opener = null;
    if (target && target.isConnected) target.focus({ preventScroll: true });
  }

  function leaveEditor(session) {
    active = null;
    textarea.value = "";
    recovery("");
    status("");
    if (!libraryOrigin) { closeDialog(); return; }
    renderHeading();
    renderList();
    list.scrollTop = libraryScroll;
    var button = Array.from(list.querySelectorAll("button")).find(function (item) {
      return item.dataset.noteDeck === session.deck && item.dataset.noteCard === session.id;
    });
    (button || search).focus({ preventScroll: true });
  }

  async function backFromEditor(session) {
    if (session.leaving) return;
    session.leaving = true;
    textarea.readOnly = true;
    if (session.ready && session.loading) await session.loading;
    if (await flush(session)) { leaveEditor(session); return; }
    session.leaving = false;
    textarea.readOnly = false;
  }

  function handleBack() {
    if (!dialog.open) return false;
    if (active) backFromEditor(active);
    else closeDialog();
    return true;
  }

  textarea.addEventListener("input", function () {
    var session = active;
    if (!session || !session.ready) return;
    clearTimeout(session.timer);
    if (session.error === "conflict") return;
    session.error = "";
    status("notes.saving");
    session.timer = setTimeout(function () { flush(session); }, 350);
  });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (active && active.ready && !active.loading) flush(active);
    } else if (!active) {
      var libraryOpen = dialog.open;
      refreshIndex(libraryOpen).then(function () {
        if (libraryOpen && dialog.open && !active) renderList();
      }).catch(function () { /* The next open will retry. */ });
    }
  });
  el("cardNotesRetry").addEventListener("click", function () {
    if (!active) { loadLibrary(); return; }
    if (active.error === "save") { active.error = ""; flush(active); }
    else loadEditor(active);
  });
  el("cardNotesDiscard").addEventListener("click", function () {
    if (active && active.error === "save") leaveEditor(active);
  });
  back.addEventListener("click", handleBack);
  dialog.addEventListener("cancel", function (event) { event.preventDefault(); handleBack(); });
  dialog.addEventListener("keydown", function (event) {
    event.stopPropagation();
    if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); handleBack(); }
  });
  dialog.addEventListener("pointerdown", function (event) { event.stopPropagation(); });
  dialog.addEventListener("click", function (event) { event.stopPropagation(); });
  search.addEventListener("input", renderList);
  el("cardNotesOnlySaved").addEventListener("change", renderList);
  el("cardNotesOpenBtn").addEventListener("click", function (event) { openLibrary(event.currentTarget); });

  el("cardNotesExportBtn").addEventListener("click", async function () {
    try {
      var content = await store.exportBackup();
      var filename = "card-notes-" + new Date().toISOString().slice(0, 10) + ".json";
      if (global.androidHistoryExport && typeof global.androidHistoryExport.save === "function") {
        status("notes.choosing");
        var started = global.DivinationNativeFileExport.save(content, filename, function (result) {
          status(result && result.ok ? "notes.exported" : result && result.cancelled ? "notes.cancelled" : "notes.exportFailed");
        });
        if (!started) status("history.exportBusy");
      } else {
        var url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
        var link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
        status("notes.exported");
      }
    } catch (_) { status("notes.exportFailed"); }
  });
  var fileInput = el("cardNotesImportInput");
  el("cardNotesImportBtn").addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", async function () {
    var file = fileInput.files[0];
    fileInput.value = "";
    if (!file) return;
    try {
      var counts = await store.importBackup(await file.text());
      await loadLibrary();
      status("notes.imported", counts);
    } catch (_) { status("notes.badBackup"); }
  });

  global.addEventListener("quareia:languagechange", function () {
    renderHeading();
    if (dialog.open && !active) renderList();
    paintMarkers();
    status(statusKey, statusValues);
    if (active && active.error) recovery(active.error);
  });
  refreshIndex(false).catch(function () { /* The editor reports storage errors when opened. */ });
  global.DivinationCardNotes = {
    markRevealedCard: markRevealedCard,
    createButton: function (deck, id) { return noteButton(deck, id, false); },
    isOpen: function () { return dialog.open; },
    handleBack: handleBack
  };
})(globalThis);
