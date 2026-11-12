/* ==========================================================================
   星夜秘境 · 可交互天体（月亮 / 羊皮纸主题下的中世纪太阳）
   - idle：缓慢自转（--spin）+ 轻微上下浮动
   - 按住拖动：移动天体并带动旋转（横向位移映射为转角）
   - 松手：惯性滑行 + 自转角速度，摩擦力衰减，边缘轻弹，随后恢复 idle
   - 主题切换只换外观，物理与月亮相同
   - 轻点十次/一分钟：月亮刻纹五官淡入再睁眼；羊皮纸太阳闭眼并淡出到无脸底图
   - rAF 驱动、passive 监听、仅 transform；touch-action:none 由 CSS 保证
   - prefers-reduced-motion：关闭自转/浮动/惯性，仅保留直接拖动；脸状态无动画
   ========================================================================== */
(function () {
  "use strict";

  var moon = document.querySelector(".sky-moon");
  if (!moon) return;
  if (!window.PointerEvent) return;   // 老浏览器优雅降级为静态天体

  var reduceMQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  var rm = reduceMQ.matches;
  function onMQChange(e) { rm = e.matches; }
  if (reduceMQ.addEventListener) reduceMQ.addEventListener("change", onMQChange);
  else if (reduceMQ.addListener) reduceMQ.addListener(onMQChange);

  var IDLE_SPIN = 0.5 / 1000;    // 自转角速度：0.5 deg/s（约 12 分钟一圈）
  var SPIN_PER_PX = 0.12;        // 拖动时每像素水平位移带动的角度
  var FLOAT_AMP = 5;             // 浮动振幅 px
  var FLOAT_PERIOD = 5200;       // 浮动周期 ms
  var FRICTION = 0.94;           // 线速度摩擦（每 16.7ms）
  var ANG_FRICTION = 0.985;      // 角速度摩擦（每 16.7ms）
  var BOUNCE = 0.42;             // 边缘反弹保留速度
  var V_CAP = 2.2;               // 松手速度上限 px/ms
  var TAP_SLOP = 12;             // 超过则视为拖动，不计入轻点彩蛋
  var TAP_MS = 500;
  var TAP_WINDOW = 60000;
  var TAP_NEED = 10;
  var FACE_WAKE_MS = 900;        // 与 CSS 淡入对齐后再睁眼
  var FACE_SLEEP_MS = 1000;      // 闭眼同时淡出

  var rect = moon.getBoundingClientRect();
  var x = rect.left;
  var y = rect.top;
  var w = rect.width;
  var h = rect.height;
  var vx = 0;
  var vy = 0;
  var angle = 0;                 // 自转角 deg
  var angVel = 0;                // 角速度 deg/ms
  var floatAmp = 0;              // 浮动振幅（idle 时渐增，拖动时渐消）
  var dragging = false;
  var startPX = 0;
  var startPY = 0;
  var startX = 0;
  var startY = 0;
  var lastMX = 0;
  var lastMY = 0;
  var lastMoveT = 0;
  var lastT = 0;
  var downT = 0;
  var maxDist = 0;
  var taps = [];
  var faceTimer = 0;

  function isSunTheme() {
    return document.documentElement.getAttribute("data-theme") === "parchment";
  }
  function defaultFace() {
    return isSunTheme() ? "shown" : "hidden";
  }
  function faceState() {
    return moon.getAttribute("data-face") || defaultFace();
  }
  function setFace(state) {
    moon.setAttribute("data-face", state);
  }
  function resetFace() {
    if (faceTimer) {
      clearTimeout(faceTimer);
      faceTimer = 0;
    }
    taps = [];
    setFace(defaultFace());
  }
  function wakeFace() {
    if (rm) { setFace("shown"); return; }
    setFace("waking");
    if (faceTimer) clearTimeout(faceTimer);
    faceTimer = setTimeout(function () {
      setFace("shown");
      faceTimer = 0;
    }, FACE_WAKE_MS);
  }
  function sleepFace() {
    if (rm) { setFace("hidden"); return; }
    setFace("sleeping");
    if (faceTimer) clearTimeout(faceTimer);
    faceTimer = setTimeout(function () {
      setFace("hidden");
      faceTimer = 0;
    }, FACE_SLEEP_MS);
  }
  function registerTap() {
    var state = faceState();
    if (state === "waking" || state === "sleeping") return;
    var def = defaultFace();
    if (state !== def) {
      if (def === "shown") wakeFace();
      else sleepFace();
      taps = [];
      return;
    }
    var now = Date.now();
    taps.push(now);
    taps = taps.filter(function (t) { return now - t <= TAP_WINDOW; });
    if (taps.length >= TAP_NEED) {
      taps = [];
      if (def === "shown") sleepFace();
      else wakeFace();
    }
  }
  resetFace();

  // 初始定位由 CSS(top/right) 切换为 transform，之后完全由 rAF 驱动
  moon.style.left = "0px";
  moon.style.top = "0px";
  moon.style.right = "auto";
  moon.style.bottom = "auto";

  function measure() {
    w = moon.offsetWidth;
    h = moon.offsetHeight;
  }

  function viewW() { return document.documentElement.clientWidth; }
  function viewH() { return document.documentElement.clientHeight; }

  /* 拖动中硬钳制；惯性滑行中钳制并反弹 */
  function clampPos(withBounce) {
    var maxX = Math.max(0, viewW() - w);
    var maxY = Math.max(0, viewH() - h);
    if (x < 0) { x = 0; if (withBounce && vx < 0) vx = -vx * BOUNCE; }
    else if (x > maxX) { x = maxX; if (withBounce && vx > 0) vx = -vx * BOUNCE; }
    if (y < 0) { y = 0; if (withBounce && vy < 0) vy = -vy * BOUNCE; }
    else if (y > maxY) { y = maxY; if (withBounce && vy > 0) vy = -vy * BOUNCE; }
  }

  function onDown(e) {
    dragging = true;
    moon.classList.add("dragging");
    startPX = e.clientX;
    startPY = e.clientY;
    startX = x;
    startY = y;
    lastMX = e.clientX;
    lastMY = e.clientY;
    lastMoveT = performance.now();
    downT = lastMoveT;
    maxDist = 0;
    vx = 0;
    vy = 0;
    if (moon.setPointerCapture && e.pointerId != null) {
      try { moon.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
  }

  function onMove(e) {
    if (!dragging) return;
    var now = performance.now();
    var dt = now - lastMoveT;
    x = startX + (e.clientX - startPX);
    y = startY + (e.clientY - startPY);
    if (dt > 0) {
      vx = 0.3 * vx + 0.7 * ((e.clientX - lastMX) / dt);
      vy = 0.3 * vy + 0.7 * ((e.clientY - lastMY) / dt);
    }
    angle += (e.clientX - lastMX) * SPIN_PER_PX;
    maxDist = Math.max(maxDist, Math.hypot(e.clientX - startPX, e.clientY - startPY));
    lastMX = e.clientX;
    lastMY = e.clientY;
    lastMoveT = now;
    clampPos(false);
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    moon.classList.remove("dragging");
    if (vx > V_CAP) vx = V_CAP;
    else if (vx < -V_CAP) vx = -V_CAP;
    if (vy > V_CAP) vy = V_CAP;
    else if (vy < -V_CAP) vy = -V_CAP;
    angVel = vx * SPIN_PER_PX;
    if (rm) { vx = 0; vy = 0; angVel = 0; }
    var held = performance.now() - downT;
    if (maxDist < TAP_SLOP && held < TAP_MS) registerTap();
  }

  moon.addEventListener("pointerdown", onDown, { passive: true });
  moon.addEventListener("pointermove", onMove, { passive: true });
  moon.addEventListener("pointerup", onUp, { passive: true });
  moon.addEventListener("pointercancel", onUp, { passive: true });
  moon.addEventListener("lostpointercapture", onUp, { passive: true });

  window.addEventListener("resize", function () {
    measure();
    clampPos(false);
  }, { passive: true });

  window.addEventListener("quareia:themechange", function () {
    measure();
    clampPos(false);
    resetFace();
  });

  function frame(t) {
    if (!lastT) lastT = t;
    var dt = t - lastT;
    lastT = t;
    if (dt > 50) dt = 50;
    if (dt < 0) dt = 0;

    if (!dragging && !rm) {
      var steps = dt / 16.7;
      x += vx * dt;
      y += vy * dt;
      vx *= Math.pow(FRICTION, steps);
      vy *= Math.pow(FRICTION, steps);
      if (Math.abs(vx) < 0.005) vx = 0;
      if (Math.abs(vy) < 0.005) vy = 0;
      angVel *= Math.pow(ANG_FRICTION, steps);
      angVel += (IDLE_SPIN - angVel) * Math.min(1, dt * 0.002);
      angle += angVel * dt;
      clampPos(true);
      var settled = vx === 0 && vy === 0;
      floatAmp += ((settled ? FLOAT_AMP : 0) - floatAmp) * Math.min(1, dt * 0.004);
    } else {
      floatAmp += (0 - floatAmp) * Math.min(1, dt * 0.01);
    }

    var fy = rm ? 0 : Math.sin((t / FLOAT_PERIOD) * 2 * Math.PI) * floatAmp;
    moon.style.transform = "translate3d(" + x.toFixed(2) + "px," + (y + fy).toFixed(2) + "px,0)";
    moon.style.setProperty("--spin", angle.toFixed(2) + "deg");
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
