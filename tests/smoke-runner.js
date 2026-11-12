/*
 * 浏览器冒烟测试：在真实页面里跑一遍主要流程，结果写进右上角的角标和 document.title。
 * 只在 index.html?smoke=1 时由 index.html 末尾的一段条件脚本加载。
 * 用 ?smoke=1 打开页面 → 角标显示 PASS n/n 或 FAIL 的具体步骤。
 */
(function () {
  "use strict";

  var steps = [];
  var results = [];

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function q(selector) {
    return document.querySelector(selector);
  }

  function qa(selector) {
    return Array.prototype.slice.call(document.querySelectorAll(selector));
  }

  function wait(desc, check, timeout) {
    var limit = timeout || 1500;
    var started = Date.now();
    return new Promise(function (resolve, reject) {
      function poll() {
        var ok = false;
        try { ok = check(); } catch (e) { ok = false; }
        if (ok) return resolve(true);
        if (Date.now() - started > limit) return reject(new Error(desc + " 超时"));
        setTimeout(poll, 40);
      }
      poll();
    });
  }

  function step(name, fn) {
    steps.push({ name: name, fn: fn });
  }

  function badge() {
    var node = document.getElementById("smoke-badge");
    if (!node) {
      node = document.createElement("div");
      node.id = "smoke-badge";
      node.style.cssText = [
        "position:fixed", "left:12px", "top:12px", "z-index:99999",
        "padding:8px 12px", "border-radius:6px", "font:12px/1.5 monospace",
        "background:#101014", "color:#e7d5ac", "border:1px solid #cba86b",
        "max-width:min(520px, calc(100vw - 24px))", "white-space:pre-wrap"
      ].join(";");
      document.body.appendChild(node);
    }
    return node;
  }

  function report(passed, failed, failure) {
    var node = badge();
    node.textContent = failed
      ? "FAIL " + passed + "/" + steps.length + "\n" + failure
      : "PASS " + passed + "/" + steps.length;
    node.style.borderColor = failed ? "#cf958c" : "#8fd6ae";
    node.style.color = failed ? "#cf958c" : "#8fd6ae";
    document.title = (failed ? "SMOKE FAIL " : "SMOKE PASS ") +
      passed + "/" + steps.length + (failure ? " " + failure : "");
    try { sessionStorage.setItem("smoke-last", node.textContent); } catch (e) {}
  }

  /* ---------- 主要流程 ---------- */

  step("准备干净状态", function () {
    try { localStorage.removeItem("quareia-divination-free-board-draft-v1"); } catch (e) {}
    var select = document.getElementById("layoutModeSelect");
    if (select && select.value === "freeform") {
      select.value = "preset";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return sleep(120).then(function () {
      var deck = document.getElementById("deckSelect");
      if (deck && deck.value !== "tarot") {
        deck.value = "tarot";
        deck.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return sleep(120);
    });
  });

  step("页面框架就位", function () {

    var ids = ["deckSpread", "spreadGrid", "revealBtn", "shuffleBtn", "settingsOpenBtn", "skyMoon"];
    ids.forEach(function (id) {
      if (!document.getElementById(id)) throw new Error("缺少 #" + id);
    });
  });

  step("牌堆渲染出 78 张", function () {
    var cards = qa("#deckSpread .deck-card");
    if (cards.length !== 78) throw new Error("抽牌按钮数量 " + cards.length);
  });

  step("扇形排布完成", function () {
    var card = q("#deckSpread .deck-card");
    if (!card) throw new Error("没有牌");
    var style = getComputedStyle(card);
    if (!style.transform || style.transform === "none") throw new Error("牌没有定位");
  });

  step("抽一张牌进入第一个牌位", function () {
    var card = q("#deckSpread .deck-card");
    card.click();
    return wait("牌位出现正面/背面", function () {
      return qa("#spreadGrid .spread-card").length === 1;
    }).then(function () {
      return sleep(120);
    });
  });

  step("一键开牌后解读结果出现", function () {
    var reveal = document.getElementById("revealBtn");
    if (reveal.disabled) throw new Error("一键开牌按钮是禁用的");
    reveal.click();
    return wait("解读条目", function () {
      return qa("#resultsList .result-card").length >= 1;
    }).then(function () {
      var name = q("#resultsList .result-name");
      if (!name || !name.textContent.trim()) throw new Error("解读里没有牌名");
      if (!/正位|逆位/.test(q("#resultsList").textContent)) throw new Error("解读里没有正逆位");
    });
  });

  step("翻面后能看到牌意", function () {
    var flip = q("#spreadGrid .spread-card-flip");
    if (!flip) throw new Error("没有可点的牌");
    flip.click(); // 上一步已经开牌，再点一次打开牌意。
    return wait("牌意面板", function () {
      var panel = document.getElementById("cardMeaningPanel");
      return panel && !panel.hidden && panel.textContent.trim().length > 8;
    });
  });

  step("切到自由画板", function () {
    var panel = document.getElementById("cardMeaningPanel");
    if (panel) {
      var close = document.getElementById("cardMeaningClose");
      if (close) close.click();
    }
    var select = document.getElementById("layoutModeSelect");
    if (!select) throw new Error("找不到布局选择");
    select.value = "freeform";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return wait("切换布局确认", function () {
      return q("#confirmDialog[open]");
    }).then(function () {
      q("#confirmProceedBtn").click();
      return wait("自由画板状态", function () {
        return document.querySelector(".table-area.is-freeform");
      });
    }).then(function () {
      return sleep(120);
    });
  });

  step("自由画板抽牌、翻面、撤销", function () {
    var card = q("#deckSpread .deck-card");
    if (!card) throw new Error("自由画板没有牌堆");
    card.click();
    return wait("抽出来的牌", function () {
      return qa(".free-table-card").length >= 1;
    }).then(function () {
      var drawn = q(".free-table-card");
      drawn.click();
      return wait("自由画板解读和历史保存", function () {
        return qa("#resultsList .result-card").length === 1 &&
          q("#historySaveStatus").textContent === window.DivinationI18n.t("history.savedFreeBoard");
      });
    }).then(function () {
      if (!q(".free-table-card.revealed")) throw new Error("翻面没有生效");
      var undo = document.getElementById("freeUndoBtn");
      if (!undo || undo.disabled) throw new Error("撤销按钮不可用");
      undo.click();
      return wait("牌回到牌堆", function () {
        return qa(".free-table-card").length === 0;
      });
    });
  });

  step("在牌阵设置返回原牌阵，并恢复未完成的画板", function () {
    var spread = q("#spreadSelect").value;
    q("#deckSpread .deck-card").click();
    var drawnId = q(".free-table-card").dataset.cardId;
    q("#spreadSettingsBtn").click();
    q("#spreadPopover #freeBoardOpenBtn").click();
    if (q("#confirmDialog[open]") || q("#layoutModeSelect").value !== "preset" ||
        q("#spreadSelect").value !== spread || !q("#freeDraw").hidden) {
      throw new Error("返回预设牌阵没有直接切回原来的牌阵");
    }
    q("#spreadSettingsBtn").click();
    q("#spreadPopover #freeBoardOpenBtn").click();
    return wait("恢复之前的画板", function () {
      var card = q(".free-table-card");
      return q("#layoutModeSelect").value === "freeform" && card && card.dataset.cardId === drawnId;
    }).then(function () {
      q("#freeUndoBtn").click();
    });
  });

  step("洗牌会清空并重新发牌", function () {
    var shuffle = document.getElementById("shuffleBtn");
    shuffle.click();
    return wait("确认框或直接洗", function () {
      return !document.querySelector("#confirmDialog[open]");
    }, 400).then(function () {
      return sleep(200);
    });
  });

  step("点月亮能换主题", function () {
    var moon = document.getElementById("skyMoon");
    var before = document.documentElement.getAttribute("data-theme");
    var down = new PointerEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 20, pointerId: 1 });
    var up = new PointerEvent("pointerup", { bubbles: true, clientX: 20, clientY: 20, pointerId: 1 });
    moon.dispatchEvent(down);
    moon.dispatchEvent(up);
    return wait("主题变化", function () {
      return document.documentElement.getAttribute("data-theme") !== before;
    });
  });

  step("羊皮纸太阳的阴影跟随光芒轮廓", function () {
    var moon = q("#skyMoon");
    var theme = window.DivinationTheme;
    var previous = theme.getTheme();
    var classes = moon.className;
    try {
      theme.setTheme("parchment");
      ["", "is-holding", "is-egg"].forEach(function (state) {
        moon.classList.remove("is-holding", "is-egg");
        if (state) moon.classList.add(state);
        if (getComputedStyle(moon).boxShadow !== "none") {
          throw new Error("太阳容器出现了方形阴影：" + (state || "静止"));
        }
      });
    } finally {
      moon.className = classes;
      theme.setTheme(previous);
    }
  });

  step("高级设置能打开", function () {
    var open = document.getElementById("settingsOpenBtn");
    open.click();
    return wait("设置面板可见", function () {
      var panel = document.getElementById("settingsPanel");
      return panel && !panel.hidden;
    }).then(function () {
      if (!q("#settingsPanel .seg-btn.is-on")) throw new Error("胶囊没有选中态");
      open.click();
    });
  });

  step("语言切到英文再切回来", function () {
    var toggle = document.getElementById("languageToggle");
    var before = document.documentElement.lang;
    toggle.click();
    return wait("语言变化", function () {
      return document.documentElement.lang !== before;
    }).then(function () {
      toggle.click();
      return sleep(80);
    });
  });

  function run(index) {
    badge().textContent = "RUNNING " + index + "/" + steps.length;
    if (index >= steps.length) {
      report(steps.length, 0, "");
      return;
    }
    var current = steps[index];
    Promise.resolve()
      .then(function () { return current.fn(); })
      .then(function () {
        results.push(current.name);
        run(index + 1);
      })
      .catch(function (error) {
        report(index, steps.length - index, current.name + "：" + error.message);
      });
  }

  function start() {
    badge().textContent = "RUNNING 0/" + steps.length;
    try {
      var last = sessionStorage.getItem("smoke-last");
      if (last) { badge().textContent = "上一次：" + last; }
    } catch (e) {}
    setTimeout(function () { run(0); }, 1500);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
