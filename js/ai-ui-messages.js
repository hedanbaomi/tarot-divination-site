(function (global) {
  "use strict";

  function create(page, helpers, actions, markdown) {
    var document = page.document;
    var state = page.state;
    var els = page.els;
    var life = page.life;

    function createStarterEmptyState() {
      var box = document.createElement("section");
      box.className = "ai-empty-state";

      var h2 = document.createElement("h2");
      h2.textContent = helpers.tr("ai.emptyHeading", null, "AI 辅助解牌助手", "AI Assisted Reading");
      box.appendChild(h2);

      var p = document.createElement("p");
      p.textContent = helpers.tr("ai.emptyDesc", null,
        "选择一条或多条非自由画板占卜记录后，系统会自动挂载对应的牌阵拓扑与牌组解牌技法（提纯意象底稿、告别照念说明书）。建议在上方卡片补充当时所问之事，或点击下方提问直接开始：",
        "Attach one or more non-freeboard readings to auto-mount Quareia spread topology and deck skills (synthesizing dynamic patterns rather than reciting a manual). Optionally add your question on the card chip above, or pick a starter:");
      box.appendChild(p);

      var starters = [
        helpers.tr("ai.starter.core", null,
          "直说核心结论：这副牌眼下最核心的矛盾卡在哪？牌势正往哪边推？",
          "Give me the straight verdict: what is the most central tension and momentum here?"),
        helpers.tr("ai.starter.action", null,
          "先一句话交代稳固的基本盘，再重点深挖我没意识到的盲点与破局抓手。",
          "Briefly anchor what is stable on the board, then dig into the blind spots and key levers I haven't noticed."),
        helpers.tr("ai.starter.compare", null,
          "若关联了多条记录，请对比局势在时间线上的真实演变，看看哪些隐患正在缓解或加剧。",
          "Across the attached readings, trace how the underlying pattern has shifted and which pressures are easing or intensifying.")
      ];

      var list = document.createElement("div");
      list.className = "ai-starter-list";
      starters.forEach(function (promptText) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ai-starter-btn";
        btn.textContent = promptText;
        btn.addEventListener("click", function () {
          if (state.streaming) return;
          if (els.promptInput) els.promptInput.value = promptText;
          actions.sendUserPrompt();
        });
        list.appendChild(btn);
      });
      box.appendChild(list);
      return box;
    }

    function isMessagesNearBottom() {
      if (!els.messages) return true;
      var distance = (els.messages.scrollHeight || 0) - (els.messages.scrollTop || 0) - (els.messages.clientHeight || 0);
      return !(distance > 72);
    }

    function scrollMessagesToBottom() {
      if (!els.messages) return;
      els.messages.scrollTop = els.messages.scrollHeight;
    }

    function renderMessages(renderOpts) {
      if (state.disposed || !els.messages) return;
      var optsRender = renderOpts && typeof renderOpts === "object" ? renderOpts : {};
      var conv = state.activeConversation;
      var currentConvId = conv ? conv.id : "";
      var switchedConv = currentConvId !== state.lastRenderedConvId;
      var shouldScroll = Boolean(optsRender.forceScroll || switchedConv || isMessagesNearBottom());
      var openReasoningIds = Object.create(null);
      if (!switchedConv && typeof els.messages.querySelectorAll === "function") {
        Array.prototype.forEach.call(els.messages.querySelectorAll(".ai-msg"), function (art) {
          var det = art.querySelector ? art.querySelector("details.ai-reasoning") : null;
          var isOpen = Boolean(det && (det.open || (typeof det.hasAttribute === "function" && det.hasAttribute("open"))));
          if (isOpen && art.dataset && art.dataset.msgId) {
            openReasoningIds[art.dataset.msgId] = true;
          }
        });
      }
      state.lastRenderedConvId = currentConvId;

      if (!conv || !conv.messages || conv.messages.length === 0) {
        els.messages.replaceChildren(createStarterEmptyState());
        return;
      }

      var frag = document.createDocumentFragment();
      var messages = conv.messages;

      messages.forEach(function (msg, index) {
        var article = document.createElement("article");
        article.className = "ai-msg " + (msg.role === "assistant" ? "ai-msg-assistant" : "ai-msg-user");
        article.dataset.msgId = msg.id;

        var head = document.createElement("div");
        head.className = "ai-msg-head";
        var roleLabel = msg.role === "assistant"
          ? (msg.model ? ("AI · " + msg.model) : "AI")
          : helpers.tr("ai.roleUser", null, "你", "You");
        var timeLabel = helpers.formatShortTime(msg.createdAt);
        head.textContent = timeLabel ? (roleLabel + " · " + timeLabel) : roleLabel;
        article.appendChild(head);

        if (msg.role === "assistant" && msg.reasoning) {
          var details = document.createElement("details");
          details.className = "ai-reasoning";
          if (openReasoningIds[msg.id]) {
            details.open = true;
          }
          var summary = document.createElement("summary");
          summary.textContent = helpers.tr("ai.reasoningSummary", null, "思考过程 / 推理摘要", "Reasoning Summary");
          var bodyDiv = document.createElement("div");
          bodyDiv.className = "ai-reasoning-body";
          bodyDiv.textContent = msg.reasoning;
          details.appendChild(summary);
          details.appendChild(bodyDiv);
          article.appendChild(details);
        }

        var bubble = document.createElement("div");
        bubble.className = "ai-msg-bubble";

        if (msg.role === "user" && state.editingMessageId === msg.id) {
          var editArea = document.createElement("textarea");
          editArea.className = "ai-textarea";
          editArea.rows = 3;
          editArea.value = msg.content;
          bubble.appendChild(editArea);

          var editActions = document.createElement("div");
          editActions.className = "ai-msg-actions";
          editActions.style.marginTop = "8px";

          var saveResendBtn = document.createElement("button");
          saveResendBtn.type = "button";
          saveResendBtn.className = "btn btn-accent";
          saveResendBtn.textContent = helpers.tr("ai.saveAndResend", null, "保存并重新发送", "Save & Resend");
          saveResendBtn.addEventListener("click", function () {
            actions.commitEditAndResend(msg.id, editArea.value);
          });

          var cancelEditBtn = document.createElement("button");
          cancelEditBtn.type = "button";
          cancelEditBtn.className = "btn btn-secondary";
          cancelEditBtn.textContent = helpers.tr("ai.cancel", null, "取消", "Cancel");
          cancelEditBtn.addEventListener("click", function () {
            state.editingMessageId = "";
            renderMessages();
          });

          editActions.appendChild(saveResendBtn);
          editActions.appendChild(cancelEditBtn);
          bubble.appendChild(editActions);
          article.appendChild(bubble);
          frag.appendChild(article);
          return;
        }

        var isLiveStreamingTurn = Boolean(state.streaming && index === messages.length - 1);
        if (msg.role === "assistant") {
          var mdContainer = document.createElement("div");
          mdContainer.className = "ai-markdown";
          if (msg.content) {
            markdown.renderMarkdownInto(mdContainer, msg.content);
          } else if (isLiveStreamingTurn) {
            var waiting = document.createElement("span");
            waiting.className = "ai-streaming-cursor";
            mdContainer.appendChild(waiting);
          }
          if (isLiveStreamingTurn && msg.content) {
            var cursor = document.createElement("span");
            cursor.className = "ai-streaming-cursor";
            mdContainer.appendChild(cursor);
          }
          bubble.appendChild(mdContainer);
        } else {
          bubble.textContent = msg.content;
        }

        var canRegenerate = msg.role === "assistant" && helpers.hasPrecedingUserTurn(messages, index);
        var effectiveError = msg.error || (
          msg.role === "assistant" && !isLiveStreamingTurn && !msg.content
            ? helpers.tr("ai.stoppedEmpty", null, "已停止生成。", "Generation stopped.")
            : ""
        );
        if (effectiveError) {
          var errBox = document.createElement("div");
          errBox.className = "ai-msg-error";
          var errText = document.createElement("span");
          errText.textContent = effectiveError;
          errBox.appendChild(errText);
          if (msg.role === "assistant" && !state.streaming && canRegenerate) {
            var retryBtn = document.createElement("button");
            retryBtn.type = "button";
            retryBtn.className = "ai-mini-action";
            retryBtn.textContent = helpers.tr("ai.retry", null, "重试", "Retry");
            retryBtn.addEventListener("click", function () { actions.regenerateFromIndex(index); });
            errBox.appendChild(retryBtn);
          }
          bubble.appendChild(errBox);
        }

        article.appendChild(bubble);

        if (!isLiveStreamingTurn) {
          var msgActions = document.createElement("div");
          msgActions.className = "ai-msg-actions";

          var copyBtn = document.createElement("button");
          copyBtn.type = "button";
          copyBtn.className = "ai-mini-action";
          copyBtn.textContent = helpers.tr("ai.copy", null, "复制", "Copy");
          copyBtn.addEventListener("click", function () {
            helpers.copyTextToClipboard(msg.content || "").then(function (ok) {
              if (ok) {
                copyBtn.textContent = helpers.tr("ai.copied", null, "已复制", "Copied");
                life.later(function () {
                  copyBtn.textContent = helpers.tr("ai.copy", null, "复制", "Copy");
                }, 1400);
              }
            });
          });
          msgActions.appendChild(copyBtn);

          if (msg.role === "user") {
            var editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "ai-mini-action";
            editBtn.textContent = helpers.tr("ai.editResend", null, "编辑并重发", "Edit & Resend");
            editBtn.disabled = state.streaming;
            editBtn.addEventListener("click", function () {
              state.editingMessageId = msg.id;
              renderMessages();
            });
            msgActions.appendChild(editBtn);
          } else {
            var regenBtn = document.createElement("button");
            regenBtn.type = "button";
            regenBtn.className = "ai-mini-action";
            regenBtn.textContent = helpers.tr("ai.regenerate", null, "重新生成", "Regenerate");
            regenBtn.disabled = state.streaming || !canRegenerate;
            regenBtn.addEventListener("click", function () {
              actions.regenerateFromIndex(index);
            });
            msgActions.appendChild(regenBtn);
          }

          var delMsgBtn = document.createElement("button");
          delMsgBtn.type = "button";
          delMsgBtn.className = "ai-mini-action is-danger";
          delMsgBtn.textContent = helpers.tr("ai.delete", null, "删除", "Delete");
          delMsgBtn.disabled = state.streaming;
          delMsgBtn.addEventListener("click", function () {
            actions.deleteMessageWithConfirm(msg.id);
          });
          msgActions.appendChild(delMsgBtn);

          article.appendChild(msgActions);
        }

        frag.appendChild(article);
      });

      els.messages.replaceChildren(frag);
      if (shouldScroll) {
        scrollMessagesToBottom();
      }
    }

    function patchStreamingMessageDom(conv, assistantMsgIndex) {
      if (!els.messages || !conv || !state.activeConversation || state.activeConversation.id !== conv.id) {
        return;
      }
      var msg = conv.messages && conv.messages[assistantMsgIndex];
      if (!msg) return;
      var targetArticle = null;
      if (typeof els.messages.querySelectorAll === "function") {
        var articles = els.messages.querySelectorAll(".ai-msg");
        for (var i = articles.length - 1; i >= 0; i -= 1) {
          if (articles[i].dataset && articles[i].dataset.msgId === msg.id) {
            targetArticle = articles[i];
            break;
          }
        }
      }
      if (!targetArticle) {
        renderMessages({ forceScroll: false });
        return;
      }
      var shouldScroll = isMessagesNearBottom();
      var bubble = targetArticle.querySelector ? targetArticle.querySelector(".ai-msg-bubble") : null;
      if (!bubble) {
        renderMessages({ forceScroll: false });
        return;
      }

      if (msg.reasoning) {
        var details = targetArticle.querySelector ? targetArticle.querySelector("details.ai-reasoning") : null;
        if (!details) {
          details = document.createElement("details");
          details.className = "ai-reasoning";
          var summary = document.createElement("summary");
          summary.textContent = helpers.tr("ai.reasoningSummary", null, "思考过程 / 推理摘要", "Reasoning Summary");
          var bodyDiv = document.createElement("div");
          bodyDiv.className = "ai-reasoning-body";
          details.appendChild(summary);
          details.appendChild(bodyDiv);
          if (typeof targetArticle.insertBefore === "function") {
            targetArticle.insertBefore(details, bubble);
          } else {
            targetArticle.appendChild(details);
          }
        }
        var reasonBody = details.querySelector ? details.querySelector(".ai-reasoning-body") : details.lastChild;
        if (reasonBody) {
          reasonBody.textContent = msg.reasoning;
        }
      }

      var mdContainer = bubble.querySelector ? bubble.querySelector(".ai-markdown") : null;
      if (!mdContainer) {
        mdContainer = document.createElement("div");
        mdContainer.className = "ai-markdown";
        bubble.replaceChildren(mdContainer);
      }
      if (msg.content) {
        markdown.renderMarkdownInto(mdContainer, msg.content);
        if (state.streaming) {
          var cursor = document.createElement("span");
          cursor.className = "ai-streaming-cursor";
          mdContainer.appendChild(cursor);
        }
      } else if (state.streaming) {
        var waiting = document.createElement("span");
        waiting.className = "ai-streaming-cursor";
        mdContainer.replaceChildren(waiting);
      }

      if (shouldScroll) {
        scrollMessagesToBottom();
      }
    }

    return {
      renderMessages: renderMessages,
      patchStreamingMessageDom: patchStreamingMessageDom
    };
  }

  var api = {
    create: create
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiMessages = api;
})(typeof window !== "undefined" ? window : globalThis);
