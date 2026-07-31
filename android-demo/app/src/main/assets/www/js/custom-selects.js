(function (root) {
  "use strict";

  var controls = [];
  var activeControl = null;
  var previousFocus = null;
  var choiceDialog = document.getElementById("choiceDialog");
  var choiceKicker = document.getElementById("choiceDialogKicker");
  var choiceTitle = document.getElementById("choiceDialogTitle");
  var choiceOptions = document.getElementById("choiceOptions");
  var choiceCancel = document.getElementById("choiceCancelBtn");

  function t(key, values) {
    return root.DivinationI18n ? root.DivinationI18n.t(key, values) : key;
  }

  function selectedOption(select) {
    return select.options[select.selectedIndex] || null;
  }

  function controlLabel(select) {
    return select.id
      ? document.querySelector('label[for="' + select.id + '"]')
      : null;
  }

  function syncControl(control) {
    var option = selectedOption(control.select);
    var label = control.label;
    var labelText = label ? label.textContent.trim() : "";
    var valueText = option ? option.textContent.trim() : t("choice.none");
    control.value.textContent = valueText;
    control.trigger.disabled = Boolean(control.select.disabled);
    control.trigger.setAttribute("aria-label", t("choice.openAria", {
      label: labelText,
      value: valueText
    }));
  }

  function syncAll() {
    controls.forEach(syncControl);
  }

  function closeChoice(restoreFocus) {
    if (!choiceDialog || !choiceDialog.open) return;
    choiceDialog.close();
    choiceDialog.setAttribute("aria-hidden", "true");
    document.body.classList.remove("choice-open");
    activeControl = null;
    if (restoreFocus !== false && previousFocus &&
        typeof previousFocus.focus === "function") {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  function handleBack() {
    if (!choiceDialog || !choiceDialog.open) return false;
    closeChoice(true);
    return true;
  }

  function chooseValue(value) {
    if (!activeControl) return;
    var control = activeControl;
    var oldValue = control.select.value;
    closeChoice(true);
    if (oldValue === value) return;
    control.select.value = value;
    syncControl(control);
    control.select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function appendOption(control, option) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "choice-option";
    button.disabled = option.disabled;
    button.dataset.value = option.value;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(option.selected));
    if (option.selected) button.classList.add("selected");

    var text = document.createElement("span");
    text.className = "choice-option-text";
    text.textContent = option.textContent.trim();
    var mark = document.createElement("span");
    mark.className = "choice-option-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = option.selected ? "✦" : "";
    button.appendChild(text);
    button.appendChild(mark);
    button.addEventListener("click", function () {
      if (!option.disabled) chooseValue(option.value);
    });
    choiceOptions.appendChild(button);
    if (option.selected) control.selectedButton = button;
  }

  function buildOptions(control) {
    choiceOptions.innerHTML = "";
    control.selectedButton = null;
    Array.prototype.forEach.call(control.select.children, function (child) {
      if (child.tagName === "OPTGROUP") {
        var group = document.createElement("p");
        group.className = "choice-option-group";
        group.textContent = child.label;
        choiceOptions.appendChild(group);
        Array.prototype.forEach.call(child.children, function (option) {
          appendOption(control, option);
        });
        return;
      }
      if (child.tagName === "OPTION") appendOption(control, child);
    });
  }

  function openChoice(control) {
    if (!choiceDialog || choiceDialog.open || control.trigger.disabled) return;
    activeControl = control;
    previousFocus = document.activeElement;
    var label = control.label;
    choiceKicker.textContent = t("choice.kicker");
    choiceTitle.textContent = label ? label.textContent.trim() : t("choice.title");
    choiceCancel.textContent = t("choice.cancel");
    buildOptions(control);
    choiceDialog.showModal();
    choiceDialog.setAttribute("aria-hidden", "false");
    document.body.classList.add("choice-open");
    requestAnimationFrame(function () {
      (control.selectedButton || choiceCancel).focus();
    });
  }

  function enhanceSelect(select, index) {
    if (select.dataset.customSelectReady === "true") return;
    select.dataset.customSelectReady = "true";
    select.classList.add("custom-select-native");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;

    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "themed-select-trigger";
    trigger.id = (select.id || "customSelect" + index) + "Trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-controls", "choiceDialog");

    var value = document.createElement("span");
    value.className = "themed-select-value";
    var chevron = document.createElement("span");
    chevron.className = "themed-select-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "⌄";
    trigger.appendChild(value);
    trigger.appendChild(chevron);
    select.insertAdjacentElement("afterend", trigger);

    var label = controlLabel(select);
    if (label) {
      if (!label.id) label.id = select.id + "Label";
      label.htmlFor = trigger.id;
    }

    var control = { select: select, trigger: trigger, value: value, label: label };
    controls.push(control);
    trigger.addEventListener("click", function () { openChoice(control); });
    select.addEventListener("change", function () { syncControl(control); });
    new MutationObserver(function () { syncControl(control); }).observe(select, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true
    });
    syncControl(control);
  }

  function init() {
    if (!choiceDialog) return;
    Array.prototype.forEach.call(document.querySelectorAll("select"), enhanceSelect);
    document.documentElement.classList.add("custom-selects-ready");

    choiceCancel.addEventListener("click", function () { closeChoice(true); });
    choiceDialog.addEventListener("click", function (event) {
      if (event.target === choiceDialog) closeChoice(true);
    });
    choiceDialog.addEventListener("cancel", function (event) {
      event.preventDefault();
      closeChoice(true);
    });
    root.addEventListener("quareia:languagechange", function () {
      setTimeout(syncAll, 0);
    });
    root.addEventListener("quareia:dialogsettled", function () {
      setTimeout(syncAll, 0);
    });
  }

  init();
  root.DivinationCustomSelects = { sync: syncAll, handleBack: handleBack };
})(typeof globalThis !== "undefined" ? globalThis : this);
