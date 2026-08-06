// Same-origin admin page for the Quareia telemetry worker. Static HTML+CSS+JS
// served by the worker; the admin token lives only in sessionStorage and is
// sent exclusively through the Authorization: Bearer header. Announcement
// content is rendered with textContent/DOM APIs only, and the
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
  .section-title { margin: 0 0 4px; font-size: 18px; }
  .section-intro { margin: 0 0 14px; }
  .section-nav { display: flex; gap: 8px; flex-wrap: wrap; }
  .section-nav button { padding: 6px 10px; }
  .window-choice.active { background: #c9a86a; color: #141633; border-color: #c9a86a; font-weight: 600; }
  .notice { padding: 10px 12px; border-radius: 8px; margin: 10px 0; }
  .notice.warning { background: #3a2d12; color: #f0d9a8; }
  .notice.err { display: block; background: #301212; color: #f0a8a8; }
  .history-summary { margin-bottom: 14px; }
  .history-summary .card { margin-bottom: 0; }
  .history-summary .stat { font-size: 24px; }
  .distribution-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .distribution { border-top: 1px solid #2a2d4a; padding-top: 10px; }
  .distribution h4 { margin: 0 0 4px; font-size: 15px; }
  .distribution table { margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid #2a2d4a; vertical-align: top; }
  th { color: #c9a86a; font-weight: 600; }
  td.number, th.number { text-align: right; white-space: nowrap; }
  .trend-wrap { overflow-x: auto; }
  .trend-wrap svg { display: block; min-width: 560px; width: 100%; height: auto; }
  .trend-axis { stroke: #3a3e66; stroke-width: 1; }
  .trend-line { fill: none; stroke: #c9a86a; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .trend-point { fill: #c9a86a; stroke: #141633; stroke-width: 2; }
  .trend-label { fill: #9a97ae; font-size: 11px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
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
    <div class="section-nav" aria-label="后台分区">
      <button id="navAnnouncements" type="button">公告管理</button>
      <button id="navCurrentStats" type="button">当前活跃版本</button>
      <button id="navHistory" type="button">历史遥测</button>
    </div>
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
    <section id="announcementsView" aria-labelledby="announcementsHeading">
      <h2 id="announcementsHeading" class="section-title">1. 公告管理</h2>
      <p class="muted section-intro">管理当前客户端可见的公告、版本范围和发布状态。</p>
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

    <section id="currentStatsView" aria-labelledby="currentStatsHeading">
      <h2 id="currentStatsHeading" class="section-title">2. 当前活跃版本（D1）</h2>
      <p class="muted section-intro">来自 D1 的当前活跃安装与最近上报版本；与历史遥测独立加载。</p>
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

    <section id="historyView" aria-labelledby="historyHeading">
      <h2 id="historyHeading" class="section-title">3. 历史遥测（Analytics Engine）</h2>
      <p class="muted section-intro">历史窗口仅供趋势观察；活跃 DISTINCT 与采样加权结果均为估算，不等同于精确用户数。</p>
      <div class="row" role="group" aria-label="历史遥测窗口">
        <span class="muted">窗口：</span>
        <button id="historyWindow24h" class="window-choice active" type="button" data-window="24h" aria-pressed="true">24 小时</button>
        <button id="historyWindow7d" class="window-choice" type="button" data-window="7d" aria-pressed="false">7 天</button>
        <button id="historyWindow30d" class="window-choice" type="button" data-window="30d" aria-pressed="false">30 天</button>
        <button id="refreshHistory" type="button">刷新历史遥测</button>
      </div>
      <p id="historyHint" class="muted" role="status" aria-live="polite">正在加载历史遥测……</p>
      <div id="historyUnavailable" class="notice err" role="alert" style="display:none"></div>
      <div id="historyContent">
        <div id="historySummaryCards" class="grid history-summary" aria-label="历史遥测摘要"></div>
        <p id="historyEstimateNote" class="notice warning">活跃估算使用 DISTINCT 上报并受采样间隔和事件覆盖影响；请勿将其解读为精确用户人数。</p>
        <div class="card">
          <h3>历史分布</h3>
          <p class="muted">计数按所选历史窗口汇总。应用版本、语言、国家和省/州为首次上报快照，不表示当前状态。</p>
          <div id="historyDistributionTables" class="distribution-grid"></div>
        </div>
        <div class="card">
          <h3>每日趋势</h3>
          <div id="historyTrendBasis" class="muted"></div>
          <div id="historyTrend" class="trend-wrap"></div>
          <div id="historyTrendTable"></div>
        </div>
      </div>
    </section>
  </div>
</main>
<script>
(function () {
  "use strict";
  var tokenKey = "quareia_admin_token";
  var state = {
    announcements: [],
    editingId: null,
    historyWindow: "24h",
    analyticsRequestId: 0
  };
  var analyticsWindows = ["24h", "7d", "30d"];

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
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    }).then(function (response) {
      if (response.status === 401 && !options.isolated) {
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
    loadStats();
    loadAnalytics();
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
    zh.textContent = "【zh】" + (body.title_zh || "(无标题)") + "\\n" + body.body_zh;
    var en = document.createElement("div");
    en.textContent = "【en】" + (body.title_en || "(no title)") + "\\n" + body.body_en;
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
      " · 已知安装总数（最近 90 天）：" + data.known_installs_90d +
      "（活跃设备数按 6 小时窗口上报估算，非精确用户人数）";

    var list = $("versionList");
    list.textContent = "";
    var windows = [
      ["active_24h", "24小时活跃版本分布"],
      ["active_7d", "7天活跃版本分布"],
      ["active_30d", "30天活跃版本分布"]
    ];
    windows.forEach(function (pair) {
      var block = document.createElement("div");
      block.className = "card";
      var title = document.createElement("h3");
      title.textContent = pair[1];
      block.appendChild(title);
      var rows = data.version_distribution[pair[0]] || [];
      rows.forEach(function (row) {
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
        block.appendChild(line);
      });
      if (rows.length === 0) {
        var empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "该窗口暂无数据";
        block.appendChild(empty);
      }
      list.appendChild(block);
    });
  }

  function loadAnalytics() {
    var requestId = ++state.analyticsRequestId;
    var selectedWindow = state.historyWindow;
    updateHistoryWindowControls();
    $("historyHint").textContent = "正在加载历史遥测（" + historyWindowLabel(selectedWindow) + "）……";
    $("historyUnavailable").style.display = "none";
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(function () { controller.abort(); }, 10000);
    }

    api("/admin/api/analytics?window=" + selectedWindow, {
      isolated: true,
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (requestId !== state.analyticsRequestId) return null;
      if (!response.ok) {
        showHistoryUnavailable(response.status === 401
          ? "历史遥测不可用：授权缺失或已失效。"
          : "历史遥测不可用（HTTP " + response.status + "）。");
        return null;
      }
      return response.json().then(function (data) {
        if (requestId !== state.analyticsRequestId) return;
        if (!data || data.module !== "analytics" || data.available !== true) {
          showHistoryUnavailable("历史遥测不可用：Analytics Engine 未返回可用数据。");
          return;
        }
        renderAnalytics(data, selectedWindow);
      });
    }).catch(function (error) {
      if (requestId !== state.analyticsRequestId) return;
      showHistoryUnavailable(error && error.name === "AbortError"
        ? "历史遥测不可用：请求超时。"
        : "历史遥测不可用：网络错误。");
    }).then(function () {
      if (timeoutId !== null) clearTimeout(timeoutId);
    });
  }

  function showHistoryUnavailable(message) {
    $("historyContent").style.display = "none";
    $("historyUnavailable").textContent = message + " 公告管理和当前活跃版本仍可用。";
    $("historyUnavailable").style.display = "block";
    $("historyHint").textContent = "历史窗口 " + historyWindowLabel(state.historyWindow) + " · 暂不可用";
  }

  function historyWindowLabel(value) {
    if (value === "7d") return "7 天";
    if (value === "30d") return "30 天";
    return "24 小时";
  }

  function updateHistoryWindowControls() {
    var controls = [
      ["24h", "historyWindow24h"],
      ["7d", "historyWindow7d"],
      ["30d", "historyWindow30d"]
    ];
    controls.forEach(function (pair) {
      var active = pair[0] === state.historyWindow;
      var button = $(pair[1]);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.className = active ? "window-choice active" : "window-choice";
    });
  }

  function selectHistoryWindow(value) {
    if (analyticsWindows.indexOf(value) === -1 || value === state.historyWindow) return;
    state.historyWindow = value;
    loadAnalytics();
  }

  function renderAnalytics(data, selectedWindow) {
    $("historyContent").style.display = "block";
    $("historyUnavailable").style.display = "none";
    $("historyHint").textContent = "历史窗口 " + historyWindowLabel(selectedWindow) +
      " · Analytics Engine · 已加载";
    renderHistorySummary(data);
    renderHistoryDistributions(data.distributions || {});
    renderHistoryTrend(data.daily_trend || {});
    renderFailedSections(data.failed_sections);
  }

  function formatMetric(value) {
    if (value === null || value === undefined || value === "") return "—";
    var number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return Number.isInteger(number) ? String(number) : String(Number(number.toFixed(2)));
  }

  function formatPercent(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return "—";
    return String(Number(number.toFixed(1))) + "%";
  }

  function makeSummaryCard(label, value, unavailableText) {
    var card = document.createElement("div");
    card.className = "card";
    var name = document.createElement("div");
    name.className = "muted";
    name.textContent = label;
    var number = document.createElement("div");
    if (unavailableText) {
      number.className = "muted";
      number.textContent = unavailableText;
    } else {
      number.className = "stat";
      number.textContent = formatMetric(value);
    }
    card.appendChild(name);
    card.appendChild(number);
    return card;
  }

  function renderHistorySummary(data) {
    var cards = $("historySummaryCards");
    cards.textContent = "";
    var failed = Array.isArray(data.failed_sections) ? data.failed_sections : [];
    [
      ["安装上报", "event_totals", data.install_seen, "暂不可用"],
      ["完成阅读", "event_totals", data.reading_completed, "暂不可用"],
      ["活跃估算", "active_estimate", data.active_estimate, "暂不可用"],
      ["完成阅读平均抽牌数", "reading_metrics", data.reading_completed_average_card_count, "平均牌数暂不可用"]
    ].forEach(function (item) {
      var unavailable = failed.indexOf(item[1]) !== -1 ? item[3] : null;
      cards.appendChild(makeSummaryCard(item[0], item[2], unavailable));
    });

    var meta = data.active_estimate_meta || {};
    var eventTypes = Array.isArray(meta.event_types) ? meta.event_types.join("、") : "";
    var note = "活跃 DISTINCT 与采样加权结果均为估算，受采样间隔和事件覆盖影响；不是精确用户数。";
    if (eventTypes) note += "参与事件：" + eventTypes + "。";
    $("historyEstimateNote").textContent = note;
  }

  function renderFailedSections(failedSections) {
    var previous = $("historyPartialWarning");
    if (previous && previous.parentNode) previous.parentNode.removeChild(previous);
    var sections = Array.isArray(failedSections) ? failedSections : [];
    if (sections.length === 0) return;
    var notice = document.createElement("div");
    notice.id = "historyPartialWarning";
    notice.className = "notice warning";
    notice.setAttribute("role", "status");
    notice.textContent = "部分历史区段暂不可用：" + sections.join("、") + "。";
    $("historyContent").insertBefore(notice, $("historyContent").firstChild);
  }

  function dimensionValue(row) {
    if (!row || row.value === null || row.value === undefined || row.value === "") return "未提供";
    return String(row.value);
  }

  function makeDistributionTable(title, rows, truncated) {
    var table = document.createElement("table");
    var caption = document.createElement("caption");
    caption.className = "sr-only";
    caption.textContent = title + "分布表";
    table.appendChild(caption);
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["值", "计数", "比例条", "比例"].forEach(function (label, index) {
      var cell = document.createElement("th");
      cell.setAttribute("scope", "col");
      cell.textContent = label;
      if (index > 0) cell.className = "number";
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);

    var body = document.createElement("tbody");
    var total = rows.reduce(function (sum, row) {
      var count = Number(row && row.count);
      return sum + (Number.isFinite(count) && count > 0 ? count : 0);
    }, 0);
    var maximum = rows.reduce(function (value, row) {
      var count = Number(row && row.count);
      return Math.max(value, Number.isFinite(count) ? count : 0);
    }, 0);
    rows.forEach(function (row) {
      var count = Number(row && row.count);
      var safeCount = Number.isFinite(count) ? count : 0;
      var percent = total > 0 ? safeCount / total * 100 : 0;
      var line = document.createElement("tr");
      var valueCell = document.createElement("td");
      valueCell.textContent = dimensionValue(row);
      line.appendChild(valueCell);
      var countCell = document.createElement("td");
      countCell.className = "number";
      countCell.textContent = formatMetric(row && row.count);
      line.appendChild(countCell);
      var barCell = document.createElement("td");
      var bar = document.createElement("div");
      bar.className = "bar";
      bar.setAttribute("aria-hidden", "true");
      var fill = document.createElement("div");
      fill.style.width = (maximum > 0 ? Math.max(1, safeCount / maximum * 100) : 0) + "%";
      bar.appendChild(fill);
      barCell.appendChild(bar);
      line.appendChild(barCell);
      var percentCell = document.createElement("td");
      percentCell.className = "number";
      percentCell.textContent = formatPercent(percent);
      line.appendChild(percentCell);
      body.appendChild(line);
    });
    table.appendChild(body);
    return table;
  }

  function renderHistoryDistributions(distributions) {
    var container = $("historyDistributionTables");
    container.textContent = "";
    [
      ["deck_type", "牌组"],
      ["event", "事件"],
      ["app_version", "应用版本（首次上报快照）"],
      ["locale", "语言（首次上报快照）"],
      ["country", "国家（首次上报快照）"],
      ["subdivision", "省/州（首次上报快照）"]
    ].forEach(function (pair) {
      var block = document.createElement("div");
      block.className = "distribution";
      var heading = document.createElement("h4");
      heading.textContent = pair[1];
      block.appendChild(heading);
      var section = distributions[pair[0]];
      var rows = section && Array.isArray(section.rows) ? section.rows : [];
      if (!section) {
        var missing = document.createElement("p");
        missing.className = "muted";
        missing.textContent = "该维度暂不可用。";
        block.appendChild(missing);
      } else if (rows.length === 0) {
        var empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "该窗口暂无数据。";
        block.appendChild(empty);
      } else {
        block.appendChild(makeDistributionTable(pair[1], rows, section.truncated === true));
        if (section.truncated === true) {
          var truncated = document.createElement("p");
          truncated.className = "muted";
          truncated.textContent = "结果已截断，仅显示部分值。";
          block.appendChild(truncated);
        }
      }
      container.appendChild(block);
    });
  }

  function trendDay(row) {
    return row && (row.utc_day || row.day || row.date) ? String(row.utc_day || row.day || row.date) : "未知日期";
  }

  function renderHistoryTrend(trend) {
    var chart = $("historyTrend");
    chart.textContent = "";
    var tableContainer = $("historyTrendTable");
    tableContainer.textContent = "";
    var rows = trend && Array.isArray(trend.rows) ? trend.rows.slice() : [];
    rows.sort(function (a, b) { return trendDay(a).localeCompare(trendDay(b)); });
    $("historyTrendBasis").textContent = "窗口口径：" + (trend.window_basis || "—") +
      " · 分桶口径：" + (trend.bucket_basis || "—");
    if (rows.length === 0) {
      var empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "该窗口暂无每日趋势数据。";
      chart.appendChild(empty);
      return;
    }

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 640 230");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", "historyTrendSvgTitle historyTrendSvgDesc");
    var svgTitle = document.createElementNS("http://www.w3.org/2000/svg", "title");
    svgTitle.setAttribute("id", "historyTrendSvgTitle");
    svgTitle.textContent = "每日历史遥测趋势";
    svg.appendChild(svgTitle);
    var svgDesc = document.createElementNS("http://www.w3.org/2000/svg", "desc");
    svgDesc.setAttribute("id", "historyTrendSvgDesc");
    svgDesc.textContent = "每日事件计数折线图；下方表格提供相同数据。";
    svg.appendChild(svgDesc);
    var width = 640;
    var height = 230;
    var left = 36;
    var right = 18;
    var top = 22;
    var bottom = 42;
    var plotWidth = width - left - right;
    var plotHeight = height - top - bottom;
    var max = rows.reduce(function (value, row) {
      var count = Number(row && row.count);
      return Math.max(value, Number.isFinite(count) ? count : 0);
    }, 0);
    var axis = document.createElementNS("http://www.w3.org/2000/svg", "line");
    axis.setAttribute("class", "trend-axis");
    axis.setAttribute("x1", String(left));
    axis.setAttribute("y1", String(height - bottom));
    axis.setAttribute("x2", String(width - right));
    axis.setAttribute("y2", String(height - bottom));
    svg.appendChild(axis);
    var points = [];
    rows.forEach(function (row, index) {
      var count = Number(row && row.count);
      var safeCount = Number.isFinite(count) ? count : 0;
      var x = rows.length === 1 ? left + plotWidth / 2 : left + plotWidth * index / (rows.length - 1);
      var y = max > 0 ? height - bottom - plotHeight * safeCount / max : height - bottom;
      points.push(x + "," + y);
      var point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      point.setAttribute("class", "trend-point");
      point.setAttribute("cx", String(x));
      point.setAttribute("cy", String(y));
      point.setAttribute("r", "4");
      point.setAttribute("aria-label", trendDay(row) + " " + formatMetric(row && row.count));
      svg.appendChild(point);
    });
    var line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("class", "trend-line");
    line.setAttribute("points", points.join(" "));
    line.setAttribute("aria-hidden", "true");
    svg.appendChild(line);
    var firstLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    firstLabel.setAttribute("class", "trend-label");
    firstLabel.setAttribute("x", String(left));
    firstLabel.setAttribute("y", String(height - 12));
    firstLabel.textContent = trendDay(rows[0]);
    svg.appendChild(firstLabel);
    var lastLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    lastLabel.setAttribute("class", "trend-label");
    lastLabel.setAttribute("text-anchor", "end");
    lastLabel.setAttribute("x", String(width - right));
    lastLabel.setAttribute("y", String(height - 12));
    lastLabel.textContent = trendDay(rows[rows.length - 1]);
    svg.appendChild(lastLabel);
    chart.appendChild(svg);
    tableContainer.appendChild(makeTrendTable(rows));
  }

  function makeTrendTable(rows) {
    var table = document.createElement("table");
    var caption = document.createElement("caption");
    caption.className = "sr-only";
    caption.textContent = "每日历史遥测趋势数据表";
    table.appendChild(caption);
    var head = document.createElement("thead");
    var headRow = document.createElement("tr");
    ["日期", "事件计数"].forEach(function (label, index) {
      var cell = document.createElement("th");
      cell.setAttribute("scope", "col");
      cell.textContent = label;
      if (index === 1) cell.className = "number";
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    var body = document.createElement("tbody");
    rows.forEach(function (row) {
      var line = document.createElement("tr");
      var day = document.createElement("td");
      day.textContent = trendDay(row);
      line.appendChild(day);
      var count = document.createElement("td");
      count.className = "number";
      count.textContent = formatMetric(row && row.count);
      line.appendChild(count);
      body.appendChild(line);
    });
    table.appendChild(body);
    return table;
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

  $("navAnnouncements").addEventListener("click", function () {
    $("announcementsView").scrollIntoView({ block: "start" });
  });
  $("navCurrentStats").addEventListener("click", function () {
    $("currentStatsView").scrollIntoView({ block: "start" });
  });
  $("navHistory").addEventListener("click", function () {
    $("historyView").scrollIntoView({ block: "start" });
  });
  $("newAnnouncement").addEventListener("click", function () {
    emptyForm();
    $("announcementForm").style.display = "block";
    $("announcementForm").scrollIntoView({ block: "start" });
  });
  $("refreshList").addEventListener("click", loadAnnouncements);
  $("refreshStats").addEventListener("click", loadStats);
  $("historyWindow24h").addEventListener("click", function () { selectHistoryWindow("24h"); });
  $("historyWindow7d").addEventListener("click", function () { selectHistoryWindow("7d"); });
  $("historyWindow30d").addEventListener("click", function () { selectHistoryWindow("30d"); });
  $("refreshHistory").addEventListener("click", loadAnalytics);
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
