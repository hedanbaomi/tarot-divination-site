(function (root) {
  "use strict";

  var dialog = document.getElementById("readingImageDialog");
  var preview = document.getElementById("readingImagePreview");
  var appearance = document.getElementById("readingImageAppearance");
  var status = document.getElementById("readingImageStatus");
  var save = document.getElementById("readingImageSave");
  var retry = document.getElementById("readingImageRetry");
  var session = null;

  function t(key, values) { return root.DivinationI18n.t(key, values); }

  function themePalette(paper) {
    var css = getComputedStyle(document.documentElement);
    function token(name) { return css.getPropertyValue(name).trim(); }
    var palette = paper ? {
      background: "#f1e8d7", surface: "#fbf5e8", text: "#241f17", muted: "#5d5545", accent: "#8a6428", line: "#cbbfa9"
    } : {
      background: token("--bg-primary"), surface: token("--bg-card"), text: token("--text-primary"),
      muted: token("--text-secondary"), accent: token("--accent"), line: token("--border")
    };
    palette.realms = {};
    ["divine", "inner", "physical", "underworld"].forEach(function (key) {
      palette.realms[key] = token("--lxxxi-" + key);
    });
    return palette;
  }

  function releaseImage(current) {
    if (current.controller) current.controller.abort();
    preview.hidden = true;
    preview.removeAttribute("src");
    if (current.url) URL.revokeObjectURL(current.url);
    current.url = null;
    current.blob = null;
  }

  async function renderPreview() {
    var current = session;
    if (!current || current.saving) return;
    releaseImage(current);
    var controller = new AbortController();
    current.controller = controller;
    var paper = appearance.querySelector("input:checked").value === "parchment";
    save.disabled = true;
    retry.hidden = true;
    status.textContent = t("image.rendering");
    try {
      var blob = await root.DivinationReadingImage.render(current.model, themePalette(paper), { signal: controller.signal });
      if (controller.signal.aborted) return;
      current.blob = blob;
      current.url = URL.createObjectURL(blob);
      preview.src = current.url;
      preview.alt = t("image.alt");
      preview.hidden = false;
      save.disabled = false;
      status.textContent = "";
    } catch (_error) {
      if (!controller.signal.aborted) {
        status.textContent = t("image.failed");
        retry.hidden = false;
      }
    }
  }

  function open(model, createdAt) {
    if (session) return;
    var fileName = "reading-" + new Date(createdAt).toISOString().replace(/[:.]/g, "-") + ".png";
    session = { model: model, fileName: fileName, opener: document.activeElement, saving: false };
    appearance.querySelector('input[value="current"]').checked = true;
    appearance.disabled = false;
    dialog.showModal();
    document.getElementById("readingImageClose").focus();
    renderPreview();
  }

  function clearSession() {
    if (!session) return;
    var opener = session.opener;
    releaseImage(session);
    session = null;
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
  }

  function close() {
    if (!dialog.open) return false;
    dialog.close();
    clearSession();
    return true;
  }

  function base64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result.slice(reader.result.indexOf(",") + 1)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  async function saveImage() {
    var current = session;
    if (!current || current.saving || !current.blob) return;
    current.saving = true;
    save.disabled = true;
    appearance.disabled = true;

    function finish(key, name) {
      if (session !== current) return;
      current.saving = false;
      save.disabled = false;
      appearance.disabled = false;
      status.textContent = t(key, { fileName: name || current.fileName });
    }
    try {
      if (root.androidHistoryExport) {
        if (typeof root.androidHistoryExport.savePng !== "function") {
          finish("image.saveFailed");
          return;
        }
        var bytes = await base64(current.blob);
        if (session !== current) return;
        status.textContent = t("history.exportChoosing", { fileName: current.fileName });
        var accepted = root.DivinationNativeFileExport.savePng(bytes, current.fileName, function (result) {
          if (result && result.cancelled) finish("image.cancelled");
          else if (result && result.ok) finish("history.fileSaved", result.fileName);
          else finish("image.saveFailed");
        });
        if (!accepted) finish("history.exportBusy");
        return;
      }

      var url = URL.createObjectURL(current.blob);
      var link = document.createElement("a");
      try {
        link.href = url;
        link.download = current.fileName;
        document.body.appendChild(link);
        link.click();
      } finally {
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 0);
      }
      finish("history.fileDownloaded");
    } catch (_error) {
      finish("image.saveFailed");
    }
  }

  appearance.addEventListener("change", renderPreview);
  retry.addEventListener("click", renderPreview);
  save.addEventListener("click", saveImage);
  document.getElementById("readingImageClose").addEventListener("click", close);
  dialog.addEventListener("cancel", function (event) { event.preventDefault(); close(); });
  dialog.addEventListener("close", function () { if (!dialog.open) clearSession(); });
  dialog.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  });
  root.addEventListener("pagehide", close);
  root.DivinationReadingImageUi = { open: open, handleBack: close };
})(globalThis);
