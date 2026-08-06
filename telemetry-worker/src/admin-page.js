// Same-origin admin page for the Quareia telemetry worker. Static HTML+CSS+JS
// served by the worker; the admin token lives only in sessionStorage and is
// sent exclusively through the Authorization: Bearer header. Announcement
// content is rendered with textContent/DOM APIs — never innerHTML — and the
// token never appears in console output, error strings, or the page source.
export const ADMIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Quareia 公告与统计后台</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0e1020; color: #e8e6f0; font: 14px/1.6 system-ui, "Microsoft YaHei", sans-serif; }
  header { padding: 14px 20px; background: #141633; border-bottom: 1px solid #2a2d4a; display: flex; justify-content: space-between; align-items: center; }
  header h1 { font-size: 16px; margin: 0; }
  nav { display: flex; gap: 10px; }
  button { background: #2a2d4a; color: #e8e6f0; border: 1px solid #3a3e66; border-radius: 6px; padding: 7px 12px; cursor: pointer; }
  button:hover { background: #363a5c; }
  button.primary { background: #c9a86a; color: #141633; border-color: #c9a86a; font-weight: 600; }
  button.danger { border-color: #8a4a4a; color: #f0b0b0; }
  main { padding: 20px; max-width: 960px; margin: 0 auto; }
  .card { background: #141633; border: 1px solid #2a2d4a; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; margin-right: 6px; }
  .badge.draft { background: #333; color: #ccc; }
  .badge.published { background: #1e5c3a; color: #d0f0e0; }
  .badge.withdrawn { background: #5c1e1e; color: #f0d0d0; }
  .badge.update { background: #c9a86a; color: #141633; }
  .badge.important { background: #7a4a1e; color: #f8e0c0; }
  .badge.info { background: #2a3a6a; color: #d0e0f8; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 6px 0; }
  label { display: block; margin: 10px 0 4px; color: #9a97ae; font-size: 13px; }
  input, select, textarea { width: 100%; background: #0e1020; color: #e8e6f0; border: 1px solid #3a3e66; border-radius: 6px; padding: 8px; }
  textarea { min-height: 90px; resize: vertical; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  .muted { color: #9a97ae; }
  .stat { font-size: 28px; font-weight: 700; color: #c9a86a; }
  .bar { height: 12px; background: #2a2d4a; border-radius: 6px; overflow: hidden; margin-top: 4px; }
  .bar > div { height: 100%; background: #c9a86a; }
  #status { padding: 10px 14px; border-radius: 8px; margin: 10px 0; display: none; }
  #status.ok { display: block; background: #12301f; color: #a8e0c0; }
  #status.err { display: block; background: #301212; color: #f0a8a8; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
  .preview { white-space: pre-wrap; border: 1px dashed #3a3e66; border-radius: 8px; padding: 12px; margin-top: 8px; }
  .dialog-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; }
  .dialog { background: #141633; border: 1px solid #3a3e66; border-radius: 10px; padding: 18px; max-width: 520px; width: 90%; max-height: 80vh; overflow: auto; }
</style>
</head>
<body>
<header>
  <h1>Quareia 公告与统计后台</h1>
  <nav>
    <button id="tabAnnouncements">公告</button>
    <button id="tabStats">统计</button>
    <button id="logout" class="danger">退出</button>
  </nav>
</header>
<main>
  <div id="status"></div>

  <div id="loginView" class="card">
    <p>输入管理员 Token（仅保存在本页面会话中）。</p>
    <label for="tokenInput">Admin token</label>
    <input type="password" id="tokenInput" autocomplete="off">
    <div class="row" style="margin-top:12px"><button class="primary" id="loginBtn">登录</button></div>
  </div>

  <div id="appView" style="display:none">
    <section id="announcementsView">
      <div class="row">
        <button class="primary" id="newAnnouncement">新建公告</button>
        <button id="refreshList">刷新列表</button>
        <span class="muted" id="listHint"></span>
      </div>
      <div id="announcementList"></div>
      <div id="announcementForm" class="card" style="display:none">
        <h3 id="formTitle">新建公告</h3>
        <input type="hidden" id="fId">
        <div class="grid">
          <div><label>级别</label><select id="fSeverity">
            <option value="info">info · 信息</option>
            <option value="important">important · 重要</option>
            <option value="update">update · 更新</option>
          </select></div>
          <div><label>平台</label><select id="fPlatform">
            <option value="all">all</option>
            <option value="android">android</option>
            <option value="web">web</option>
          </select></div>
          <div><label>状态</label><select id="fStatus">
            <option value="draft">draft</option>
            <option value="published">published</option>
            <option value="withdrawn">withdrawn</option>
          </select></div>
          <div><label>按钮文字（zh）</label><input id="fButtonZh" maxlength="60"></div>
          <div><label>标题（zh）</label><input id="fTitleZh" maxlength="200"></div>
          <div><label>标题（en）</label><input id="fTitleEn" maxlength="200"></div>
          <div><label>按钮文字（en）</label><input id="fButtonEn" maxlength="60"></div>
        </div>
        <label>正文（zh）</label><textarea id="fBodyZh" maxlength="2000"></textarea>
        <label>正文（en）</label><textarea id="fBodyEn" maxlength="2000"></textarea>
        <label>操作链接（action_url，仅 HTTPS）</label><input id="fActionUrl" maxlength="2048">
        <div class="grid">
          <div><label>最低 version_code</label><input type="number" id="fMinVc" min="0" value="0"></div>
          <div><label>最高 version_code</label><input type="number" id="fMaxVc" min="0" value="2147483647"></div>
          <div><label>开始时间</label><input type="datetime-local" id="fStartsAt"></div>
          <div><label>结束时间（留空 = 不结束）</label><input type="datetime-local" id="fEndsAt"></div>
        </div>
        <div class="actions">
          <button class="primary" id="saveAnnouncement">保存</button>
          <button id="previewAnnouncement">预览</button>
          <button id="cancelForm">取消</button>
        </div>
        <div id="previewBox" class="preview" style="display:none"></div>
      </div>
    </section>

    <section id="statsView" style="display:none">
      <div class="row">
        <button id="refreshStats">刷新统计</button>
        <span class="muted" id="statsHint"></span>
      </div>
      <div class="grid" id="windowCards"></div>
      <div class="card">
        <h3>按最近上报版本分组的版本分布</h3>
        <div id="versionList"></div>
      </div>
    </section>
  </div>
</main>
<script>
(function () {
  "use strict";
  var tokenKey = "quareia_admin_token";
  var state = { announcements: [], editingId: null };

  function $(id) { return document.getElementById(id); }

  function showStatus(text, ok) {
    var el = $("status");
    el.textContent = text;
    el.className = ok ? "ok" : "err";
  }

  function clearStatus() {
    var el = $("status");
    el.textContent = "";
    el.className = "";
  }

  function api(path, options) {
    options = options || {};
    var headers = options.headers || {};
    headers["authorization"] = "Bearer " + (sessionStorage.getItem(tokenKey) || "");
    if (options.body !== undefined) headers["content-type"] = "application/json";
    return fetch(path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    }).then(function (response) {
      if (response.status === 401) {
        showLogin();
        var err = new Error("unauthorized");
        err.unauthorized = true;
        throw err;
      }
      return response;
    });
  }

  function showLogin() {
    sessionStorage.removeItem(tokenKey);
    $("loginView").style.display = "block";
    $("appView").style.display = "none";
  }

  function showApp() {
    $("loginView").style.display = "none";
    $("appView").style.display = "block";
    loadAnnouncements();
  }

  function setTab(name) {
    $("announcementsView").style.display = name === "announcements" ? "block" : "none";
    $("statsView").style.display = name === "stats" ? "block" : "none";
    if (name === "stats") loadStats();
  }

  function makeBadge(text, cls) {
    var span = document.createElement("span");
    span.className = "badge " + (cls || "");
    span.textContent = text;
    return span;
  }

  function loadAnnouncements() {
    api("/admin/api/announcements").then(function (response) {
      if (!response.ok) {
        showStatus("加载公告列表失败（" + response.status + "）", false);
        return;
      }
      return response.json().then(function (data) {
        state.announcements = data.announcements || [];
        renderList();
      });
    }).catch(function (err) {
      if (!err.unauthorized) showStatus("加载公告列表失败：网络错误", false);
    });
  }

  function renderList() {
    var list = $("announcementList");
    list.textContent = "";
    var hint = $("listHint");
    hint.textContent = "共 " + state.announcements.length + " 条";
    state.announcements.forEach(function (ann) {
      var card = document.createElement("div");
      card.className = "card";
      var head = document.createElement("div");
      head.className = "row";
      head.appendChild(makeBadge(ann.status, ann.status));
      head.appendChild(makeBadge(ann.severity, ann.severity));
      head.appendChild(makeBadge("rev " + ann.revision, ""));
      head.appendChild(makeBadge(ann.platform, ""));
      var time = document.createElement("span");
      time.className = "muted";
      time.textContent = formatRange(ann.starts_at, ann.ends_at);
      head.appendChild(time);
      card.appendChild(head);

      var zh = document.createElement("div");
      zh.textContent = (ann.title_zh || "(无标题)") + " — " + ann.body_zh;
      card.appendChild(zh);
      if (ann.title_en || ann.body_en) {
        var en = document.createElement("div");
        en.className = "muted";
        en.textContent = (ann.title_en || "") + " — " + ann.body_en;
        card.appendChild(en);
      }
      if (ann.action_url) {
        var link = document.createElement("div");
        link.className = "muted";
        link.textContent = "链接: " + ann.action_url;
        card.appendChild(link);
      }

      var actions = document.createElement("div");
      actions.className = "actions";
      var edit = document.createElement("button");
      edit.textContent = "编辑";
      edit.addEventListener("click", function () { openForm(ann); });
      var publish = document.createElement("button");
      publish.textContent = "发布";
      publish.disabled = ann.status === "published";
      publish.addEventListener("click", function () { changeStatus(ann.id, "publish"); });
      var withdraw = document.createElement("button");
      withdraw.textContent = "撤回";
      withdraw.disabled = ann.status === "withdrawn";
      withdraw.addEventListener("click", function () { changeStatus(ann.id, "withdraw"); });
      actions.appendChild(edit);
      actions.appendChild(publish);
      actions.appendChild(withdraw);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  function formatRange(starts, ends) {
    var parts = [];
    if (starts > 0) parts.push("起 " + new Date(starts * 1000).toLocaleString());
    if (ends > 0) parts.push("止 " + new Date(ends * 1000).toLocaleString());
    if (parts.length === 0) return "无时间限制";
    return parts.join(" · ");
  }

  function changeStatus(id, action) {
    api("/admin/api/announcements/" + id + "/" + action, { method: "POST", body: {} })
      .then(function (response) {
        if (!response.ok) {
          showStatus((action === "publish" ? "发布" : "撤回") + "失败（" + response.status + "）", false);
          return;
        }
        showStatus(action === "publish" ? "已发布" : "已撤回", true);
        loadAnnouncements();
      })
      .catch(function () { showStatus("操作失败：网络错误", false); });
  }

  function emptyForm() {
    state.editingId = null;
    $("formTitle").textContent = "新建公告";
    $("fId").value = "";
    $("fSeverity").value = "info";
    $("fPlatform").value = "all";
    $("fStatus").value = "draft";
    $("fTitleZh").value = "";
    $("fBodyZh").value = "";
    $("fButtonZh").value = "";
    $("fTitleEn").value = "";
    $("fBodyEn").value = "";
    $("fButtonEn").value = "";
    $("fActionUrl").value = "";
    $("fMinVc").value = "0";
    $("fMaxVc").value = "2147483647";
    $("fStartsAt").value = "";
    $("fEndsAt").value = "";
    $("previewBox").style.display = "none";
    $("previewBox").textContent = "";
  }

  function openForm(ann) {
    emptyForm();
    state.editingId = ann.id;
    $("formTitle").textContent = "编辑公告 #" + ann.id + "（保存后 revision 自动 +1）";
    $("fId").value = String(ann.id);
    $("fSeverity").value = ann.severity;
    $("fPlatform").value = ann.platform;
    $("fStatus").value = ann.status;
    $("fTitleZh").value = ann.title_zh || "";
    $("fBodyZh").value = ann.body_zh || "";
    $("fButtonZh").value = ann.button_zh || "";
    $("fTitleEn").value = ann.title_en || "";
    $("fBodyEn").value = ann.body_en || "";
    $("fButtonEn").value = ann.button_en || "";
    $("fActionUrl").value = ann.action_url || "";
    $("fMinVc").value = String(ann.min_version_code);
    $("fMaxVc").value = String(ann.max_version_code);
    $("fStartsAt").value = toLocalInput(ann.starts_at);
    $("fEndsAt").value = toLocalInput(ann.ends_at);
    $("announcementForm").style.display = "block";
    $("announcementForm").scrollIntoView({ block: "start" });
  }

  function toLocalInput(epochSeconds) {
    if (!epochSeconds) return "";
    var d = new Date(epochSeconds * 1000);
    function pad(n) { return n < 10 ? "0" + n : String(n); }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fromLocalInput(value) {
    if (!value) return 0;
    var d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : Math.floor(d.getTime() / 1000);
  }

  function collectForm() {
    return {
      severity: $("fSeverity").value,
      platform: $("fPlatform").value,
      status: $("fStatus").value,
      title_zh: $("fTitleZh").value,
      body_zh: $("fBodyZh").value,
      button_zh: $("fButtonZh").value,
      title_en: $("fTitleEn").value,
      body_en: $("fBodyEn").value,
      button_en: $("fButtonEn").value,
      action_url: $("fActionUrl").value,
      min_version_code: Number($("fMinVc").value || 0),
      max_version_code: Number($("fMaxVc").value || 0),
      starts_at: fromLocalInput($("fStartsAt").value),
      ends_at: fromLocalInput($("fEndsAt").value)
    };
  }

  function saveForm() {
    var body = collectForm();
    var editing = state.editingId !== null;
    var path = editing ? "/admin/api/announcements/" + state.editingId : "/admin/api/announcements";
    var method = editing ? "PUT" : "POST";
    api(path, { method: method, body: body }).then(function (response) {
      if (!response.ok) {
        return response.json().then(function (data) {
          showStatus("保存失败：" + (data && data.error ? data.error : response.status), false);
        });
      }
      showStatus("保存成功" + (editing ? "（revision 已 +1）" : ""), true);
      $("announcementForm").style.display = "none";
      loadAnnouncements();
      return null;
    }).catch(function () { showStatus("保存失败：网络错误", false); });
  }

  function preview() {
    var body = collectForm();
    var box = $("previewBox");
    box.textContent = "";
    box.style.display = "block";
    var zh = document.createElement("div");
    zh.textContent = "【zh】" + (body.title_zh || "(无标题)") + "\n" + body.body_zh;
    var en = document.createElement("div");
    en.textContent = "【en】" + (body.title_en || "(no title)") + "\n" + body.body_en;
    box.appendChild(zh);
    box.appendChild(en);
    if (body.action_url) {
      var link = document.createElement("div");
      link.textContent = "链接: " + body.action_url;
      box.appendChild(link);
    }
  }

  function loadStats() {
    api("/admin/api/stats").then(function (response) {
      if (!response.ok) {
        showStatus("加载统计失败（" + response.status + "）", false);
        return;
      }
      return response.json().then(renderStats);
    }).catch(function () { showStatus("加载统计失败：网络错误", false); });
  }

  function renderStats(data) {
    var cards = $("windowCards");
    cards.textContent = "";
    var labels = [
      ["active_24h", "最近 24 小时活跃安装数"],
      ["active_7d", "最近 7 天活跃安装数"],
      ["active_30d", "最近 30 天活跃安装数"]
    ];
    labels.forEach(function (pair) {
      var card = document.createElement("div");
      card.className = "card";
      var name = document.createElement("div");
      name.className = "muted";
      name.textContent = pair[1];
      var value = document.createElement("div");
      value.className = "stat";
      value.textContent = String(data.windows[pair[0]].count);
      card.appendChild(name);
      card.appendChild(value);
      cards.appendChild(card);
    });

    var hint = $("statsHint");
    hint.textContent = "数据更新时间 " + new Date(data.generated_at * 1000).toLocaleString() +
      " · 总计 " + data.total_installs + " 条安装记录（活跃设备数按 6 小时窗口上报估算，非精确用户人数）";

    var list = $("versionList");
    list.textContent = "";
    data.by_version.forEach(function (row) {
      var line = document.createElement("div");
      line.style.marginTop = "10px";
      var label = document.createElement("div");
      var versionLabel = row.version_code === 0
        ? "未知/旧客户端"
        : "versionCode " + row.version_code;
      label.textContent = versionLabel + " · " + (row.app_version || "?") +
        " · " + row.installs + " 个安装 · " + row.percent + "%";
      var bar = document.createElement("div");
      bar.className = "bar";
      var fill = document.createElement("div");
      fill.style.width = Math.max(1, row.percent) + "%";
      bar.appendChild(fill);
      line.appendChild(label);
      line.appendChild(bar);
      list.appendChild(line);
    });
    if (data.by_version.length === 0) {
      var empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "暂无数据";
      list.appendChild(empty);
    }
  }

  $("loginBtn").addEventListener("click", function () {
    var token = $("tokenInput").value.trim();
    if (!token) { showStatus("请输入 Token", false); return; }
    sessionStorage.setItem(tokenKey, token);
    api("/admin/verify", { method: "POST", body: {} }).then(function (response) {
      if (response.ok) {
        clearStatus();
        $("tokenInput").value = "";
        showApp();
      } else {
        showStatus("Token 无效", false);
        sessionStorage.removeItem(tokenKey);
      }
    }).catch(function () { showStatus("验证失败：网络错误", false); });
  });

  $("logout").addEventListener("click", function () {
    showLogin();
    clearStatus();
  });

  $("tabAnnouncements").addEventListener("click", function () { setTab("announcements"); });
  $("tabStats").addEventListener("click", function () { setTab("stats"); });
  $("newAnnouncement").addEventListener("click", function () {
    emptyForm();
    $("announcementForm").style.display = "block";
    $("announcementForm").scrollIntoView({ block: "start" });
  });
  $("refreshList").addEventListener("click", loadAnnouncements);
  $("refreshStats").addEventListener("click", loadStats);
  $("saveAnnouncement").addEventListener("click", saveForm);
  $("previewAnnouncement").addEventListener("click", preview);
  $("cancelForm").addEventListener("click", function () {
    $("announcementForm").style.display = "none";
    emptyForm();
  });

  if (sessionStorage.getItem(tokenKey)) {
    api("/admin/verify", { method: "POST", body: {} }).then(function (response) {
      if (response.ok) showApp(); else showLogin();
    }).catch(function () { showLogin(); });
  } else {
    showLogin();
  }
})();
</script>
</body>
</html>
`;
