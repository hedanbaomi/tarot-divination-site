(function (global) {
  "use strict";

  function create(page, helpers, readings, actions) {
    var configStore = page.configStore;
    var providers = page.providers;
    var els = page.els;
    var state = page.state;
    var contextApi = page.contextApi;
    var customLibrary = page.customLibrary;
    var document = page.document;
    var chatStore = page.chatStore;
    var life = page.life;

    function updateProfileIndicator() {
      var profile = configStore.getActiveProfile();
      var valid = profile ? providers.validateProfile(profile).ok : false;
      if (els.profileDot) els.profileDot.classList.toggle("is-ready", valid);
      if (els.activeProfileName) {
        if (profile && valid) {
          els.activeProfileName.textContent = (profile.name || profile.model) + " (" + profile.model + ")";
        } else {
          els.activeProfileName.textContent = helpers.tr("ai.profileUnconfigured", null, "未配置 API Key", "API Key not set");
        }
      }
      updateSetupBanner(valid);
    }

    function updateSetupBanner(hasValidProfile) {
      if (!els.setupBanner) return;
      var conv = state.activeConversation;
      var hasReading = Boolean(conv && conv.readingIds && conv.readingIds.length > 0);
      var needsProfile = !hasValidProfile;
      if (!needsProfile && hasReading) {
        els.setupBanner.hidden = true;
        return;
      }
      els.setupBanner.hidden = false;
      if (els.setupBannerText) {
        if (needsProfile && !hasReading) {
          els.setupBannerText.textContent = helpers.tr("ai.banner.needBoth", null,
            "请先配置大模型 API Key；如需辅助解牌，可从非自由画板占卜历史中选择一条或多条记录作为上下文，也可直接自由对话。",
            "Configure an API key first. Optionally attach non-freeboard readings for interpretation, or chat freely on any topic.");
        } else if (needsProfile) {
          els.setupBannerText.textContent = helpers.tr("ai.banner.needKey", null,
            "尚未配置可用的模型 API Key。点击「API 设置」填写密钥并测试连接后即可开始对话。",
            "No active API key configured yet. Open API Settings to add your key and test the connection.");
        } else {
          els.setupBannerText.textContent = helpers.tr("ai.banner.needReading", null,
            "当前对话尚未附加占卜记录：可直接进行常规 AI 对话，或点击「选择占卜历史」传入固定/自定义牌阵与应用内牌意。",
            "No readings attached: you can chat normally on any topic, or attach non-freeboard readings for in-app card interpretation.");
        }
      }
      if (els.bannerSettingsBtn) els.bannerSettingsBtn.hidden = !needsProfile;
      if (els.bannerPickBtn) els.bannerPickBtn.hidden = hasReading;
    }

    function skillModeFallbackLabel(modeId) {
      return helpers.tr("ai.skillMode.auto", null, "奥莉薇娅", "Olivia");
    }

    function skillModeFallbackHint(modeId) {
      return helpers.tr("ai.skillModeHint.auto", null,
        "内置人格包：塔罗咨询师 · 非暴力沟通 · 牌面镜像",
        "Built-in persona: tarot counselor with an NVC backbone");
    }

    function renderSkillsBar() {
      var conv = state.activeConversation;
      var activeMode = readings.resolveConversationSkillMode(conv);
      if (els.skillModeGroup && typeof els.skillModeGroup.querySelectorAll === "function") {
        var pills = els.skillModeGroup.querySelectorAll("[data-skill-mode]");
        Array.prototype.forEach.call(pills, function (pill) {
          var mId = pill.getAttribute("data-skill-mode") || "auto";
          var isOn = mId === activeMode;
          pill.classList.toggle("is-active", isOn);
          pill.setAttribute("aria-pressed", isOn ? "true" : "false");
          pill.dataset.streamLock = "true";
          pill.disabled = state.streaming || !conv;
          pill.textContent = skillModeFallbackLabel(mId);
          pill.title = skillModeFallbackHint(mId);
        });
      }

      if (!els.activeSkillsList) return;
      var records = readings.getAttachedRecordsForConversation(conv);
      var rawMsgs = conv && Array.isArray(conv.messages) ? conv.messages : [];
      var previewMsgs = helpers.normalizeConversationMessagesForApi(rawMsgs, 0, rawMsgs.length).map(function (m) {
        return { role: m.role, content: m.content };
      });
      var draftPrompt = els.promptInput && typeof els.promptInput.value === "string"
        ? els.promptInput.value.trim()
        : "";
      if (draftPrompt) {
        previewMsgs.push({ role: "user", content: draftPrompt });
      }
      var resolvedReadings = contextApi.resolveOrderedReadings(records, { locale: helpers.currentLocale(), customLibrary: customLibrary });
      var hasUninterpretedReading = readings.computeHasUninterpretedReading(conv, rawMsgs.length, resolvedReadings);
      var preview = typeof contextApi.previewActiveSkills === "function"
        ? contextApi.previewActiveSkills({
            locale: helpers.currentLocale(),
            records: records,
            resolvedReadings: resolvedReadings,
            messages: previewMsgs,
            skillMode: activeMode,
            hasUninterpretedReading: hasUninterpretedReading,
            customLibrary: customLibrary
          })
        : null;

      var activeSkills = preview && Array.isArray(preview.activeSkills) ? preview.activeSkills : [];
      if (activeSkills.length === 0) {
        var idleSpan = document.createElement("span");
        idleSpan.className = "ai-skill-badge-idle";
        idleSpan.textContent = helpers.tr("ai.activeSkillsNone", null,
          "自由对话（附加排盘后自动挂载专属占卜技法）",
          "Free chat (attach a reading to auto-mount Quareia skills)");
        els.activeSkillsList.replaceChildren(idleSpan);
        return;
      }

      var frag = document.createDocumentFragment();
      activeSkills.forEach(function (skill) {
        if (!skill || !skill.name) return;
        var badge = document.createElement("span");
        badge.className = "ai-skill-badge";
        badge.textContent = "✦ " + skill.name;
        badge.title = skill.reason ? (skill.name + " — " + skill.reason) : skill.name;
        frag.appendChild(badge);
      });
      els.activeSkillsList.replaceChildren(frag);
    }

    function selectSkillMode(modeId) {
      var conv = state.activeConversation;
      if (!conv || state.streaming) return Promise.resolve();
      var nextMode = readings.resolveConversationSkillMode({ skillMode: modeId });
      if (readings.resolveConversationSkillMode(conv) === nextMode) return Promise.resolve();
      var persistPromise = typeof chatStore.setSkillMode === "function"
        ? chatStore.setSkillMode(conv.id, nextMode)
        : chatStore.updateConversation(conv.id, { skillMode: nextMode }, { touchUpdatedAt: false });
      return persistPromise.then(function (updated) {
        if (updated) {
          state.activeConversation = updated;
        }
        renderSkillsBar();
        renderContextMeter();
      });
    }

    function saveAttachedReadingQuestion(readingId, rawQuestion) {
      var conv = state.activeConversation;
      if (!conv || state.streaming) return Promise.resolve();
      var cleanQuestion = String(rawQuestion || "").trim().slice(0, 240);
      state.editingQuestionReadingId = "";
      return chatStore.updateConversation(conv.id, function (latest) {
        // Only replace the target snapshot, using the latest record in the transaction.
        // Another tab may have edited a different question, renamed, or detached it.
        var ids = latest.readingIds || [];
        if (ids.indexOf(readingId) === -1) return null;
        var snapshots = latest.readingSnapshots || [];
        var targetIndex = snapshots.findIndex(function (snapshot) { return snapshot.id === readingId; });
        var target = snapshots[targetIndex];
        if (!target) target = readings.buildReadingSnapshots([readingId], snapshots)[0];
        if (!target) return null;
        var replacement = Object.assign({}, target, { question: cleanQuestion });
        var nextSnaps = snapshots.map(function (snapshot) {
          return snapshot.id === readingId ? replacement : snapshot;
        });
        if (targetIndex === -1) nextSnaps.push(replacement);
        var previousInfo = readings.deriveReadingBaseAndQuestion(ids, snapshots);
        var previousAutoTitle = readings.deriveAutoTitle(ids, "", snapshots);
        var previousBaseTitle = previousInfo ? previousInfo.base : "";
        var currentTitle = typeof latest.title === "string" ? latest.title.trim() : "";
        var next = Object.assign({}, latest, { readingSnapshots: nextSnaps });
        if (!currentTitle || currentTitle === previousAutoTitle ||
            (previousBaseTitle && currentTitle === previousBaseTitle)) {
          next.title = readings.deriveAutoTitle(ids, "", nextSnaps);
        }
        return next;
      }, { touchUpdatedAt: false }).then(function (updated) {
        if (!state.activeConversation || state.activeConversation.id !== conv.id) return;
        if (updated) {
          state.activeConversation = updated;
        }
        return actions.refreshConversationsList(updated ? updated.id : conv.id, conv.id);
      });
    }

    function renderContextMeter() {
      if (state.disposed) return;
      if (!els.contextMeter) return;
      if (state.compressing) {
        els.contextMeter.classList.add("is-compressing");
        els.contextMeter.classList.remove("is-compressed");
        els.contextMeter.textContent = helpers.tr("ai.compressingStatus", null,
          "正在压缩早期对话上下文以保持完整牌意…",
          "Compressing earlier messages to preserve context…");
        return;
      }
      els.contextMeter.classList.remove("is-compressing");
      var profile = configStore.getActiveProfile();
      var ctxResolved = providers.resolveContextWindow(profile || {});
      var conv = state.activeConversation;
      var payload = readings.buildFittedPayload(conv, undefined, providers.inputTokenBudget(profile, ctxResolved.contextWindow));
      var compressedCount = payload.compressedCount || 0;
      els.contextMeter.classList.toggle("is-compressed", compressedCount > 0);

      var baseText = helpers.tr("ai.contextMeter", {
        used: helpers.formatTokenCount(payload.estimatedTokens),
        limit: helpers.formatTokenCount(ctxResolved.contextWindow),
        source: helpers.contextSourceLabel(ctxResolved.source)
      },
      "上下文约 " + helpers.formatTokenCount(payload.estimatedTokens) + " / " + helpers.formatTokenCount(ctxResolved.contextWindow) + " tokens（" + helpers.contextSourceLabel(ctxResolved.source) + "）",
      "Context ~" + helpers.formatTokenCount(payload.estimatedTokens) + " / " + helpers.formatTokenCount(ctxResolved.contextWindow) + " tokens (" + helpers.contextSourceLabel(ctxResolved.source) + ")");

      if (compressedCount > 0) {
        baseText += helpers.tr("ai.contextMeterCompressed", { count: compressedCount },
          " · 已压缩早期 " + compressedCount + " 条",
          " · " + compressedCount + " earlier compressed");
      }
      els.contextMeter.textContent = baseText;
    }

    function renderContextHeader() {
      if (state.disposed) return;
      var conv = state.activeConversation;
      if (!conv) {
        if (els.activeChatTitle) {
          els.activeChatTitle.textContent = helpers.tr("ai.untitledChat", null, "新解牌对话", "Untitled Chat");
        }
        if (els.archivedBadge) {
          els.archivedBadge.hidden = true;
        }
        if (els.archiveChatBtn) {
          els.archiveChatBtn.textContent = helpers.tr("ai.archive", null, "归档", "Archive");
        }
        if (els.attachedChips) {
          var emptyHint = document.createElement("span");
          emptyHint.className = "ai-no-reading-hint";
          emptyHint.textContent = helpers.tr("ai.noAttachedReadings", null,
            "未附加占卜记录（已自动过滤自由画板记录）",
            "No readings attached (freeform records excluded)");
          els.attachedChips.replaceChildren(emptyHint);
        }
        actions.updateStreamingUi();
        updateProfileIndicator();
        renderSkillsBar();
        renderContextMeter();
        return;
      }

      if (els.activeChatTitle) {
        els.activeChatTitle.textContent = conv.title || helpers.tr("ai.untitledChat", null, "新解牌对话", "Untitled Chat");
      }
      if (els.archivedBadge) {
        els.archivedBadge.hidden = !conv.archived;
      }
      if (els.archiveChatBtn) {
        els.archiveChatBtn.textContent = conv.archived
          ? helpers.tr("ai.unarchive", null, "取消归档", "Unarchive")
          : helpers.tr("ai.archive", null, "归档", "Archive");
      }

      if (els.attachedChips) {
        var ids = conv.readingIds || [];
        if (ids.length === 0) {
          var hint = document.createElement("span");
          hint.className = "ai-no-reading-hint";
          hint.textContent = helpers.tr("ai.noAttachedReadings", null,
            "未附加占卜记录（已自动过滤自由画板记录）",
            "No readings attached (freeform records excluded)");
          els.attachedChips.replaceChildren(hint);
        } else {
          var chipFrag = document.createDocumentFragment();
          var snapById = Object.create(null);
          (conv.readingSnapshots || []).forEach(function (s) { snapById[s.id] = s; });

          ids.forEach(function (rid) {
            var live = state.readingsById[rid];
            var snap = snapById[rid];
            var hasSnapQuestion = Boolean(snap && typeof snap.question === "string");
            var effectiveQuestion = hasSnapQuestion ? snap.question : ((live && live.question) || "");
            var sourceRec = live
              ? Object.assign({}, live, { question: effectiveQuestion })
              : (snap || null);
            var summary = sourceRec
              ? contextApi.buildReadingCardSummary(sourceRec, {
                  locale: helpers.currentLocale(),
                  customLibrary: customLibrary
                })
              : null;

            var card = document.createElement("article");
            card.className = "ai-reading-card";
            card.dataset.readingId = rid;

            var top = document.createElement("div");
            top.className = "ai-reading-card-top";

            var deckTag = summary ? summary.deckLabel : helpers.deckShortLabel(snap ? snap.deckType : "");
            if (deckTag) {
              var tagEl = document.createElement("span");
              tagEl.className = "ai-reading-card-deck";
              tagEl.textContent = deckTag;
              top.appendChild(tagEl);
            }

            var titleEl = document.createElement("span");
            titleEl.className = "ai-reading-card-title";
            var titleText = summary ? summary.spreadName : ((snap && snap.spreadName) || rid);
            if (!live && (!snap || !Array.isArray(snap.cards) || snap.cards.length === 0)) {
              titleText += " [" + helpers.tr("ai.readingDeleted", null, "原记录已不在本地历史中", "Removed from local history") + "]";
            }
            titleEl.textContent = titleText;
            titleEl.title = titleText;
            top.appendChild(titleEl);

            var rmBtn = document.createElement("button");
            rmBtn.type = "button";
            rmBtn.className = "ai-chip-remove";
            rmBtn.dataset.streamLock = "true";
            rmBtn.disabled = state.streaming;
            rmBtn.textContent = "×";
            rmBtn.setAttribute("aria-label", helpers.tr("ai.removeReading", null, "移除此占卜记录", "Remove reading"));
            rmBtn.addEventListener("click", function () { removeAttachedReading(rid); });
            top.appendChild(rmBtn);
            card.appendChild(top);

            var metaParts = [];
            if (summary && summary.modeBadge) metaParts.push(summary.modeBadge);
            if (summary && summary.createdText) metaParts.push(summary.createdText);
            if (!live && snap && Array.isArray(snap.cards) && snap.cards.length > 0) {
              metaParts.push(helpers.tr("ai.readingSnapshotSaved", null, "已使用对话内保存的牌阵快照", "Saved snapshot"));
            }
            if (metaParts.length > 0) {
              var metaEl = document.createElement("div");
              metaEl.className = "ai-reading-card-meta";
              metaEl.textContent = metaParts.join(" · ");
              metaEl.title = metaEl.textContent;
              card.appendChild(metaEl);
            }

            if (summary && summary.cardsPreview) {
              var previewEl = document.createElement("div");
              previewEl.className = "ai-reading-card-preview";
              previewEl.textContent = summary.cardsPreview;
              previewEl.title = summary.cardsPreview;
              card.appendChild(previewEl);
            }

            var canEditQuestion = Boolean(live || (snap && Array.isArray(snap.cards) && snap.cards.length > 0));
            if (canEditQuestion && state.editingQuestionReadingId === rid) {
              var qEditor = document.createElement("div");
              qEditor.className = "ai-reading-question-editor";

              var qInput = document.createElement("input");
              qInput.type = "text";
              qInput.className = "ai-input ai-reading-question-input";
              qInput.maxLength = 240;
              qInput.value = effectiveQuestion;
              qInput.placeholder = helpers.tr("ai.questionPlaceholder", null,
                "补充当时抽牌的具体问题与时间范围（如：未来三个月跳槽是否合适）",
                "Add what you asked and the timeframe (e.g. Changing jobs in the next 3 months)");

              var qActions = document.createElement("div");
              qActions.className = "ai-reading-question-actions";

              var qSaveBtn = document.createElement("button");
              qSaveBtn.type = "button";
              qSaveBtn.className = "ai-mini-action";
              qSaveBtn.textContent = helpers.tr("ai.save", null, "保存", "Save");
              qSaveBtn.addEventListener("click", function () {
                saveAttachedReadingQuestion(rid, qInput.value);
              });

              var qCancelBtn = document.createElement("button");
              qCancelBtn.type = "button";
              qCancelBtn.className = "ai-mini-action";
              qCancelBtn.textContent = helpers.tr("ai.cancel", null, "取消", "Cancel");
              qCancelBtn.addEventListener("click", function () {
                state.editingQuestionReadingId = "";
                renderContextHeader();
              });

              qInput.addEventListener("keydown", function (e) {
                if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) {
                  e.preventDefault();
                  saveAttachedReadingQuestion(rid, qInput.value);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  state.editingQuestionReadingId = "";
                  renderContextHeader();
                }
              });

              qActions.appendChild(qSaveBtn);
              qActions.appendChild(qCancelBtn);
              qEditor.appendChild(qInput);
              qEditor.appendChild(qActions);
              card.appendChild(qEditor);
              life.later(function () {
                if (typeof qInput.focus === "function") qInput.focus();
              }, 0);
            } else if (canEditQuestion) {
              var qRow = document.createElement("div");
              qRow.className = "ai-reading-card-question-row";
              if (effectiveQuestion) {
                var qText = document.createElement("span");
                qText.className = "ai-reading-card-question-text";
                qText.textContent = helpers.tr("ai.questionPrefix", null, "所问：", "Question: ") + effectiveQuestion;
                qText.title = qText.textContent;
                qRow.appendChild(qText);

                var qEditBtn = document.createElement("button");
                qEditBtn.type = "button";
                qEditBtn.className = "ai-mini-action ai-reading-question-edit-btn";
                qEditBtn.dataset.streamLock = "true";
                qEditBtn.disabled = state.streaming;
                qEditBtn.textContent = helpers.tr("ai.questionEdit", null, "修改问题", "Edit question");
                qEditBtn.addEventListener("click", function () {
                  if (state.streaming) return;
                  state.editingQuestionReadingId = rid;
                  renderContextHeader();
                });
                qRow.appendChild(qEditBtn);
              } else {
                var qAddBtn = document.createElement("button");
                qAddBtn.type = "button";
                qAddBtn.className = "ai-reading-question-add-btn";
                qAddBtn.dataset.streamLock = "true";
                qAddBtn.disabled = state.streaming;
                qAddBtn.textContent = helpers.tr("ai.questionAdd", null, "+ 补充当时所问之事", "+ Add question context");
                qAddBtn.addEventListener("click", function () {
                  if (state.streaming) return;
                  state.editingQuestionReadingId = rid;
                  renderContextHeader();
                });
                qRow.appendChild(qAddBtn);
              }
              card.appendChild(qRow);
            }

            chipFrag.appendChild(card);
          });
          els.attachedChips.replaceChildren(chipFrag);
        }
      }

      updateProfileIndicator();
      renderSkillsBar();
      renderContextMeter();
    }

    function removeAttachedReading(readingId) {
      var conv = state.activeConversation;
      if (!conv || state.streaming) return;
      if (state.editingQuestionReadingId === readingId) {
        state.editingQuestionReadingId = "";
      }
      chatStore.updateConversation(conv.id, function (latest) {
        return Object.assign({}, latest, {
          readingIds: (latest.readingIds || []).filter(function (id) { return id !== readingId; }),
          readingSnapshots: (latest.readingSnapshots || []).filter(function (snapshot) { return snapshot.id !== readingId; })
        });
      }).then(function (updated) {
        if (!state.activeConversation || state.activeConversation.id !== conv.id) return;
        state.activeConversation = updated;
        return actions.refreshConversationsList(updated ? updated.id : "", updated ? updated.id : "");
      });
    }

    function openReadingsPicker() {
      if (state.streaming || !els.pickerModal) return;
      readings.loadSelectableReadings().then(function () {
        if (state.disposed) return;
        var conv = state.activeConversation;
        state.pickerDraftIds = conv && Array.isArray(conv.readingIds) ? conv.readingIds.slice() : [];
        if (els.pickerSearchInput) els.pickerSearchInput.value = "";
        if (els.pickerDeckFilter) {
          els.pickerDeckFilter.value = "all";
          helpers.syncCustomSelects(els.pickerDeckFilter);
        }
        renderPickerList();
        actions.openModal(els.pickerModal, els.pickerSearchInput);
      });
    }

    function renderPickerList() {
      if (!els.pickerList) return;
      var query = els.pickerSearchInput ? els.pickerSearchInput.value.trim().toLowerCase() : "";
      var deckFilter = els.pickerDeckFilter ? els.pickerDeckFilter.value : "all";
      var filtered = state.selectableReadings.filter(function (rec) {
        if (deckFilter !== "all" && rec.deckType !== deckFilter) return false;
        if (!query) return true;
        var resolved = contextApi.resolveReadingDetails(rec, {
          locale: helpers.currentLocale(),
          customLibrary: customLibrary
        });
        var hay = [
          rec.question || "",
          resolved ? resolved.spreadName : (rec.spreadNameSnapshot || ""),
          resolved ? resolved.cards.map(function (c) { return c.cardName; }).join(" ") : ""
        ].join(" ").toLowerCase();
        return hay.indexOf(query) !== -1;
      });

      if (els.pickerApplyBtn) {
        els.pickerApplyBtn.textContent = helpers.tr("ai.pickerApplyCount", { count: state.pickerDraftIds.length },
          "确定附加 (" + state.pickerDraftIds.length + ")",
          "Attach Selected (" + state.pickerDraftIds.length + ")");
      }

      if (filtered.length === 0) {
        var empty = document.createElement("p");
        empty.className = "ai-hint";
        empty.textContent = helpers.tr("ai.pickerEmpty", null,
          "没有找到可选的非自由画板占卜记录。请先在首页使用固定牌阵或自定义牌阵完成一次占卜并保存历史。",
          "No matching preset/custom reading found. Complete a non-freeboard reading first to attach it here.");
        els.pickerList.replaceChildren(empty);
        return;
      }

      var frag = document.createDocumentFragment();
      filtered.forEach(function (rec) {
        var resolved = contextApi.resolveReadingDetails(rec, {
          locale: helpers.currentLocale(),
          customLibrary: customLibrary
        });
        var summary = contextApi.buildReadingCardSummary(rec, {
          locale: helpers.currentLocale(),
          customLibrary: customLibrary
        });
        var checked = state.pickerDraftIds.indexOf(rec.id) !== -1;

        var label = document.createElement("label");
        label.className = "ai-picker-item" + (checked ? " is-checked" : "");

        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = checked;
        checkbox.addEventListener("change", function () {
          var idx = state.pickerDraftIds.indexOf(rec.id);
          if (checkbox.checked && idx === -1) {
            state.pickerDraftIds.push(rec.id);
          } else if (!checkbox.checked && idx !== -1) {
            state.pickerDraftIds.splice(idx, 1);
          }
          label.classList.toggle("is-checked", checkbox.checked);
          if (els.pickerApplyBtn) {
            els.pickerApplyBtn.textContent = helpers.tr("ai.pickerApplyCount", { count: state.pickerDraftIds.length },
              "确定附加 (" + state.pickerDraftIds.length + ")",
              "Attach Selected (" + state.pickerDraftIds.length + ")");
          }
        });

        var body = document.createElement("div");
        body.className = "ai-picker-item-body";

        var title = document.createElement("div");
        title.className = "ai-picker-item-title";
        var baseTitle = (summary ? summary.spreadName : (resolved ? resolved.spreadName : (rec.spreadNameSnapshot || rec.spreadId)))
          + " · " + (summary ? summary.deckLabel : helpers.deckShortLabel(rec.deckType));
        if (summary && summary.modeBadge) {
          baseTitle += " (" + summary.modeBadge + ")";
        }
        title.textContent = baseTitle;

        var meta = document.createElement("div");
        meta.className = "ai-picker-item-meta";
        meta.textContent = ((summary && summary.createdText) || (resolved ? resolved.formattedTime : helpers.formatShortTime(rec.createdAt)))
          + (rec.question ? (" · " + rec.question) : "");

        var cards = document.createElement("div");
        cards.className = "ai-picker-item-cards";
        if (summary && summary.cardsPreview) {
          cards.textContent = summary.cardsPreview;
        } else if (resolved && resolved.cards.length > 0) {
          cards.textContent = resolved.cards.map(function (c) {
            return c.positionNumber + ". " + c.cardName + (c.orientation === "reversed" ? (helpers.isEnglishLocale() ? " (R)" : "(逆)") : "");
          }).join(" · ");
        }

        body.appendChild(title);
        body.appendChild(meta);
        body.appendChild(cards);
        label.appendChild(checkbox);
        label.appendChild(body);
        frag.appendChild(label);
      });

      els.pickerList.replaceChildren(frag);
    }

    function applyPickerSelection() {
      var conv = state.activeConversation;
      actions.closeModal(els.pickerModal);
      if (!conv) return;
      var nextIds = state.pickerDraftIds.slice();
      var nextSnaps = readings.buildReadingSnapshots(nextIds, conv.readingSnapshots);
      var prevAuto = readings.deriveAutoTitle(conv.readingIds || [], "", conv.readingSnapshots);
      var curTitle = typeof conv.title === "string" ? conv.title.trim() : "";
      var nextTitle = (!curTitle || curTitle === prevAuto)
        ? readings.deriveAutoTitle(nextIds, "", nextSnaps)
        : conv.title;
      var persistPromise = typeof chatStore.setAttachedReadings === "function"
        ? chatStore.setAttachedReadings(conv.id, nextIds, nextSnaps, { title: nextTitle, expectedTitle: conv.title })
        : chatStore.updateConversation(conv.id, {
            title: nextTitle,
            readingIds: nextIds,
            readingSnapshots: nextSnaps
          });
      persistPromise.then(function (updated) {
        if (!state.activeConversation || state.activeConversation.id !== conv.id) return;
        state.activeConversation = updated;
        return actions.refreshConversationsList(updated ? updated.id : "", updated ? updated.id : "");
      });
    }

    return {
      renderContextMeter: renderContextMeter,
      updateProfileIndicator: updateProfileIndicator,
      renderContextHeader: renderContextHeader,
      openReadingsPicker: openReadingsPicker,
      selectSkillMode: selectSkillMode,
      renderSkillsBar: renderSkillsBar,
      renderPickerList: renderPickerList,
      applyPickerSelection: applyPickerSelection
    };
  }

  var api = {
    create: create
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiContext = api;
})(typeof window !== "undefined" ? window : globalThis);
