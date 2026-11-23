(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DivinationReadingImage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";
  var WIDTH = 1600, MARGIN = 72, CONTENT = WIDTH - MARGIN * 2;
  var PIXELS = 3500000, MAX_SIDE = 8192, IMAGE_TIMEOUT = 8000, CONCURRENCY = 4;
  var FONT = '"Noto Sans", "Microsoft YaHei", sans-serif';
  function num(v, fallback) { return typeof v === "number" && isFinite(v) ? v : fallback; }
  function value(v) { return String(v == null ? "" : v); }
  function abortError() { var e = new Error("Export cancelled"); e.name = "AbortError"; return e; }
  function check(signal) { if (signal && signal.aborted) throw abortError(); }
  function font(ctx, size, bold) { ctx.font = (bold ? "600 " : "400 ") + size + "px " + FONT; }
  function wrap(ctx, text, width) {
    var lines = [];
    value(text).replace(/\r\n?/g, "\n").split("\n").forEach(function (paragraph) {
      if (!paragraph) { lines.push(""); return; }
      var line = "";
      // Preserve words where possible; long URLs and unspaced CJK still wrap.
      (paragraph.match(/\s+|\S+/gu) || []).forEach(function (chunk) {
        if (line && ctx.measureText(line + chunk).width > width) {
          lines.push(line); line = "";
        }
        Array.from(chunk).forEach(function (ch) {
          if (line && ctx.measureText(line + ch).width > width) { lines.push(line); line = ""; }
          line += ch;
        });
      });
      if (line) lines.push(line);
    });
    return lines;
  }
  function textLines(ctx, lines, x, y, step) {
    lines.forEach(function (line) { ctx.fillText(line, x, y); y += step; });
    return y;
  }
  function cardText(card, hiddenLabel) {
    var parts = [value(card.positionName)];
    if (card.hidden) parts.push(value(hiddenLabel) || "◈");
    else parts.push(value(card.name), value(card.orientationLabel), value(card.layerLabel), value(card.realmLabel));
    var details = parts.filter(Boolean).join(" · ");
    return value(card.number) + "." + (details ? " " + details : "");
  }

  function drawOrder(a, b, positioned) {
    if (positioned) return num(a.card.z, 0) - num(b.card.z, 0) || a.index - b.index;
    var az = num(a.card.number, a.index) + (a.card.layer === "minor" ? 100 : 0);
    var bz = num(b.card.number, b.index) + (b.card.layer === "minor" ? 100 : 0);
    return az - bz || a.index - b.index;
  }
  // Normalize live CSS-pixel positions to the chart card width. Older free-board
  // snapshots retain their centers but do not record the viewport or card size.
  function layoutBoard(model) {
    var cards = model.cards || [], free = !!model.freeform;
    var positioned = free && cards.every(function (c) {
      return typeof c.x === "number" && isFinite(c.x) && typeof c.y === "number" && isFinite(c.y);
    });
    var cols = Math.max(1, Math.min(20, Math.floor(num(model.columns, Math.ceil(Math.sqrt(cards.length || 1))))));
    if (free && !positioned) cols = Math.max(1, Math.min(8, Math.ceil(Math.sqrt(cards.length || 1))));
    var worldScale = 104 / (num(model.freeCardWidth, 84) || 84);
    var raw = cards.map(function (card, i) {
      var x, y, rotation;
      if (positioned) {
        x = card.x * worldScale;
        y = card.y * worldScale;
        rotation = num(card.boardRotation, 0);
      } else {
        var col = free ? i % cols + 1 : num(card.column, i % cols + 1);
        var row = free ? Math.floor(i / cols) + 1 : num(card.row, Math.floor(i / cols) + 1);
        var cs = free ? 1 : Math.max(1, num(card.columnSpan, 1));
        var rs = free ? 1 : Math.max(1, num(card.rowSpan, 1));
        x = (col - 1 + (cs - 1) / 2) * 132;
        y = (row - 1 + (rs - 1) / 2) * 186;
        var ox = num(card.offsetX, 0), oy = num(card.offsetY, 0);
        if (card.layer === "major") { ox = -8; oy = -10; }
        if (card.layer === "minor") { ox = 8; oy = 12; }
        x += 104 * ox / 100; y += 158 * oy / 100;
        rotation = num(card.rotation, 0);
      }
      var radians = rotation * Math.PI / 180;
      var hw = (Math.abs(Math.cos(radians)) * 104 + Math.abs(Math.sin(radians)) * 158) / 2;
      var hh = (Math.abs(Math.sin(radians)) * 104 + Math.abs(Math.cos(radians)) * 158) / 2;
      return { card: card, index: i, cx: x + 52, cy: y + 79, hw: hw, hh: hh,
        rotation: rotation, cell: free ? null : col + ":" + row };
    });
    if (!raw.length) return { cards: [], height: 80, scale: 1, positioned: positioned };
    raw.sort(function (a, b) { return drawOrder(a, b, positioned); });
    if (!free) {
      var cells = new Map();
      raw.forEach(function (entry) {
        var group = cells.get(entry.cell) || [];
        if (group.length) {
          group[group.length - 1].underCard = true;
          // Separate exact registered overlaps without changing deliberate offsets.
          while (group.some(function (other) {
            return Math.abs(entry.cx - other.cx) < 0.01 && Math.abs(entry.cy - other.cy) < 0.01;
          })) entry.cy += 38;
        }
        group.push(entry);
        cells.set(entry.cell, group);
      });
    }
    var minX = Math.min.apply(null, raw.map(function (r) { return r.cx - r.hw; }));
    var maxX = Math.max.apply(null, raw.map(function (r) { return r.cx + r.hw; }));
    var minY = Math.min.apply(null, raw.map(function (r) { return r.cy - r.hh; }));
    var maxY = Math.max.apply(null, raw.map(function (r) { return r.cy + r.hh; }));
    var scale, boardWidth, boardHeight;
    if (positioned) {
      // Keep cards readable even if world coordinates are millions of units apart.
      // Transform centers uniformly; unlike a zoom of the whole board, card size
      // does not collapse with the distance between them.
      scale = Math.max(1.35, Math.min(3.2, (CONTENT - 36) / Math.max(1, maxX - minX), 1100 / Math.max(1, maxY - minY)));
      var maxHalfW = Math.max.apply(null, raw.map(function (r) { return r.hw; })) * scale;
      var maxHalfH = Math.max.apply(null, raw.map(function (r) { return r.hh; })) * scale;
      var minCX = Math.min.apply(null, raw.map(function (r) { return r.cx; }));
      var maxCX = Math.max.apply(null, raw.map(function (r) { return r.cx; }));
      var minCY = Math.min.apply(null, raw.map(function (r) { return r.cy; }));
      var maxCY = Math.max.apply(null, raw.map(function (r) { return r.cy; }));
      var positionScale = Math.min(scale, (CONTENT - 36 - 2 * maxHalfW) / Math.max(1, maxCX - minCX),
        (1100 - 2 * maxHalfH) / Math.max(1, maxCY - minCY));
      boardWidth = (maxCX - minCX) * positionScale + 2 * maxHalfW;
      boardHeight = (maxCY - minCY) * positionScale + 2 * maxHalfH;
      raw.forEach(function (r) {
        r.x = (CONTENT - boardWidth) / 2 + maxHalfW + (r.cx - minCX) * positionScale;
        r.y = 18 + maxHalfH + (r.cy - minCY) * positionScale;
      });
    } else {
      scale = Math.min(3.2, (CONTENT - 36) / Math.max(1, maxX - minX), 1100 / Math.max(1, maxY - minY));
      boardWidth = (maxX - minX) * scale; boardHeight = (maxY - minY) * scale;
      raw.forEach(function (r) {
        r.x = (CONTENT - boardWidth) / 2 + (r.cx - minX) * scale;
        r.y = 18 + (r.cy - minY) * scale;
      });
    }
    return { cards: raw, height: boardHeight + 36, scale: scale, positioned: positioned };
  }
  function pixelSize(height) {
    var scale = Math.min(1.5, Math.sqrt(PIXELS / (WIDTH * height)), MAX_SIDE / WIDTH, MAX_SIDE / height);
    return { width: Math.max(1, Math.floor(WIDTH * scale)), height: Math.max(1, Math.floor(height * scale)) };
  }
  function trustedUrl(input) {
    try {
      if (!input || !root.location) return "";
      var url = new URL(input, root.location.href), base = new URL(root.location.href);
      if (url.username || url.password || url.search || url.hash) return "";
      var local = url.origin === base.origin && /\/assets\/cards\/(?:m\/)?[a-z0-9-]+\.jpeg$/i.test(url.pathname);
      var remote = url.protocol === "https:" && url.hostname === "assets.luotianyi.fun" && !url.port &&
        /^\/tarot-divination-site\/lxxxi\/v1\/cards\/lxxxi-(0[1-9]|[1-7][0-9]|8[01])\.webp$/.test(url.pathname);
      var native = false;
      if (typeof root.__qMediaBase === "string") {
        var nativeBase = new URL(root.__qMediaBase.replace(/\/$/, ""));
        native = nativeBase.origin === base.origin && nativeBase.protocol === "https:" &&
          nativeBase.hostname === "appassets.androidplatform.net" && !nativeBase.port &&
          /^\/_m\/[^/]+$/.test(nativeBase.pathname) && !nativeBase.search && !nativeBase.hash &&
          url.origin === nativeBase.origin &&
          new RegExp("^" + nativeBase.pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
            "/lxxxi-(0[1-9]|[1-7][0-9]|8[01])$").test(url.pathname);
      }
      return local || remote || native ? url.href : "";
    } catch (_) { return ""; }
  }
  async function decode(blob, signal) {
    check(signal);
    if (typeof root.createImageBitmap === "function") {
      try {
        var bitmap = await root.createImageBitmap(blob);
        if (signal.aborted) { if (bitmap.close) bitmap.close(); throw abortError(); }
        return bitmap;
      } catch (error) {
        if (signal.aborted) throw abortError();
        // Some WebViews expose createImageBitmap but cannot decode every format.
      }
    }
    return new Promise(function (resolve, reject) {
      var url = root.URL.createObjectURL(blob), img = new root.Image(), done = false;
      function finish(error) {
        if (done) return; done = true;
        signal.removeEventListener("abort", cancel);
        img.onload = img.onerror = null; root.URL.revokeObjectURL(url);
        if (error) reject(error); else resolve(img);
      }
      function cancel() { img.src = ""; finish(abortError()); }
      signal.addEventListener("abort", cancel, { once: true });
      img.onload = function () { finish(); }; img.onerror = function () { finish(new Error("Image decode failed")); };
      if (signal.aborted) return cancel();
      img.src = url;
    });
  }
  async function loadOne(card, signal) {
    var url = !card.hidden && trustedUrl(card.image);
    if (!url) return null;
    var controller = new AbortController();
    function cancel() { controller.abort(); }
    if (signal) signal.addEventListener("abort", cancel, { once: true });
    var timer = setTimeout(function () { controller.abort(); }, IMAGE_TIMEOUT);
    try {
      check(signal);
      var response = await root.fetch(url, { mode: "cors", credentials: "omit", redirect: "error", signal: controller.signal });
      if (!response.ok || response.type === "opaque") return null;
      var blob = await response.blob();
      check(signal);
      return await Promise.race([decode(blob, controller.signal), new Promise(function (_, reject) {
        controller.signal.addEventListener("abort", function () { reject(abortError()); }, { once: true });
      })]);
    } catch (error) {
      if (signal && signal.aborted) throw abortError();
      return null;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", cancel);
    }
  }
  function releaseImage(image) {
    if (!image) return;
    if (typeof image.close === "function") image.close();
    else if ("src" in image) image.src = "";
  }
  async function loadBatch(entries, signal) {
    var results = await Promise.allSettled(entries.map(function (entry) {
      return loadOne(entry.card, signal);
    }));
    var failed = results.find(function (result) { return result.status === "rejected"; });
    if (failed) {
      results.forEach(function (result) {
        if (result.status === "fulfilled") releaseImage(result.value);
      });
      throw failed.reason;
    }
    return results.map(function (result) { return result.value; });
  }
  function border(ctx, card, palette, w, h) {
    var realm = card.hidden ? "" : value(card.realmBorder), colors = palette.realms || {}, fill;
    if (realm === "inner-underworld") {
      fill = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      fill.addColorStop(0, colors.inner); fill.addColorStop(0.5, colors.inner); fill.addColorStop(0.5, colors.underworld); fill.addColorStop(1, colors.underworld);
    } else if (realm === "inner-physical") {
      fill = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      fill.addColorStop(0, colors.inner); fill.addColorStop(0.5, colors.inner); fill.addColorStop(0.5, colors.physical); fill.addColorStop(1, colors.physical);
    } else fill = colors[realm] || palette.line;
    ctx.fillStyle = fill; ctx.fillRect(-w / 2, -h / 2, w, h);
  }
  function fitText(ctx, text, width) {
    var chars = Array.from(value(text));
    if (ctx.measureText(chars.join("")).width <= width) return chars.join("");
    while (chars.length && ctx.measureText(chars.join("") + "…").width > width) chars.pop();
    return chars.join("") + "…";
  }
  function captionGeometry(entry, scale) {
    var card = entry.card;
    var w = 104 * scale, h = 158 * scale, edge = Math.max(2, 4 * scale);
    var detail = card.hidden ? "" : value(card.layerLabel);
    var captionH = Math.min(h * 0.3, (detail ? 31 : 21) * scale);
    var top = entry.underCard || card.layer === "major";
    return { w: w, h: h, edge: edge, detail: detail, captionH: captionH, top: top,
      captionTop: top ? -h / 2 + edge : h / 2 - edge - captionH };
  }
  function drawCaption(ctx, entry, scale, palette, hiddenLabel) {
    var card = entry.card, geometry = captionGeometry(entry, scale);
    var w = geometry.w, h = geometry.h, edge = geometry.edge, detail = geometry.detail;
    var captionH = geometry.captionH, top = geometry.top, captionTop = geometry.captionTop;
    var title = card.hidden ? value(hiddenLabel) || "◈" : value(card.name);
    // Reserve the exposed upper strip for every underlying preset card.
    var titleX = -w / 2 + edge + (top ? 28 : 4) * scale;
    ctx.fillStyle = palette.surface; ctx.fillRect(-w / 2 + edge, captionTop, Math.max(0, w - 2 * edge), captionH);
    ctx.fillStyle = palette.text;
    var available = Math.max(1, w - 2 * edge - (top ? 32 : 8) * scale);
    var captionSize = Math.max(8, 11 * scale), minCaptionSize = Math.max(7, 7.5 * scale);
    font(ctx, captionSize, true);
    while (captionSize > minCaptionSize && ctx.measureText(title).width > available) {
      captionSize = Math.max(minCaptionSize, captionSize - scale * 0.5);
      font(ctx, captionSize, true);
    }
    ctx.fillText(fitText(ctx, title, available), titleX, captionTop + 14 * scale);
    if (detail) {
      ctx.fillStyle = palette.muted; font(ctx, Math.max(7, 8 * scale), false);
      ctx.fillText(fitText(ctx, detail, available), titleX, captionTop + captionH - 4 * scale);
    }
    ctx.fillStyle = palette.surface; ctx.fillRect(-w / 2, -h / 2, Math.max(25 * scale, 14), Math.max(22 * scale, 13));
    ctx.fillStyle = palette.text; font(ctx, Math.max(9, 13 * scale), true);
    ctx.fillText(value(card.number), -w / 2 + 3, -h / 2 + Math.max(16 * scale, 10));
  }
  function drawCard(ctx, entry, scale, image, palette, hiddenLabel) {
    var card = entry.card, geometry = captionGeometry(entry, scale);
    var w = geometry.w, h = geometry.h, edge = geometry.edge;
    ctx.save();
    ctx.translate(MARGIN + entry.x, entry.y);
    ctx.rotate(entry.rotation * Math.PI / 180);
    border(ctx, card, palette, w, h);
    ctx.fillStyle = palette.surface;
    ctx.fillRect(-w / 2 + edge, -h / 2 + edge, Math.max(0, w - 2 * edge), Math.max(0, h - 2 * edge));
    if (image && !card.hidden && w > 2 * edge && h > 2 * edge) {
      ctx.save();
      if (card.orientation === "reversed") ctx.rotate(Math.PI);
      var imageWidth = image.width || image.naturalWidth || 104;
      var imageHeight = image.height || image.naturalHeight || 158;
      var areaTop = -h / 2 + edge + (geometry.top ? geometry.captionH : 22 * scale);
      var areaBottom = h / 2 - edge - (geometry.top ? 0 : geometry.captionH);
      var ratio = Math.min((w - 2 * edge) / imageWidth, Math.max(0, areaBottom - areaTop) / imageHeight);
      // A reversed image rotates about the art area's center, leaving its label fixed.
      var centerY = (areaTop + areaBottom) / 2;
      if (card.orientation === "reversed") centerY = -centerY;
      ctx.drawImage(image, -imageWidth * ratio / 2, centerY - imageHeight * ratio / 2,
        imageWidth * ratio, imageHeight * ratio);
      ctx.restore();
    } else {
      ctx.fillStyle = palette.muted;
      font(ctx, Math.max(8, 12 * scale), false);
      ctx.textAlign = "center";
      ctx.fillText(card.hidden ? "◈" : "—", 0, 0);
      ctx.textAlign = "start";
    }
    drawCaption(ctx, entry, scale, palette, hiddenLabel);
    ctx.restore();
  }
  async function drawBoard(ctx, board, palette, hiddenLabel, signal) {
    for (var start = 0; start < board.cards.length; start += CONCURRENCY) {
      check(signal);
      var entries = board.cards.slice(start, start + CONCURRENCY);
      var images = await loadBatch(entries, signal);
      try {
        check(signal);
        entries.forEach(function (entry, index) {
          drawCard(ctx, entry, board.scale, images[index], palette, hiddenLabel);
        });
      } finally {
        images.forEach(releaseImage);
      }
    }
    // Repaint compact labels after all art so rotated cross-cards cannot obscure
    // the underlying card's name and number. Freeform placement is untouched.
    board.cards.filter(function (entry) { return entry.underCard; }).forEach(function (entry) {
      ctx.save();
      ctx.translate(MARGIN + entry.x, entry.y);
      ctx.rotate(entry.rotation * Math.PI / 180);
      drawCaption(ctx, entry, board.scale, palette, hiddenLabel);
      ctx.restore();
    });
  }
  async function render(model, palette, options) {
    options = options || {};
    var signal = options.signal;
    check(signal);
    var cards = model.cards || [], labels = model.labels || {};
    var canvas = root.document.createElement("canvas"), ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    var board = layoutBoard(model);
    font(ctx, 46, true); var title = wrap(ctx, model.title, CONTENT);
    font(ctx, 25, false); var metadata = wrap(ctx, [value(model.deckName), value(model.date)].filter(Boolean).join(" · "), CONTENT);
    font(ctx, 30, false); var question = model.question ? wrap(ctx, model.question, CONTENT) : [];
    font(ctx, 25, false); var index = cards.map(function (card) { return wrap(ctx, cardText(card, labels.hidden), CONTENT / 2 - 30); });
    var indexRows = [];
    for (var i = 0; i < index.length; i += 2) indexRows.push(Math.max(index[i].length, index[i + 1] ? index[i + 1].length : 0));
    font(ctx, 22, false);
    var credits = wrap(ctx, [value(model.credit), value(model.projectUrl), value(model.officialUrl)].filter(Boolean).join("\n"), CONTENT);
    var height = 100 + title.length * 56 + metadata.length * 36 + 28 +
      (question.length ? 54 + question.length * 42 : 0) + board.height + 100 +
      indexRows.reduce(function (sum, row) { return sum + row * 34 + 14; }, 0) + 100 + credits.length * 31 + 70;
    var pixels = pixelSize(height);
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    ctx.scale(pixels.width / WIDTH, pixels.height / height);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, WIDTH, height);
    try {
      check(signal);
      var y = 90;
      ctx.fillStyle = palette.text; font(ctx, 46, true); y = textLines(ctx, title, MARGIN, y, 56);
      ctx.fillStyle = palette.muted; font(ctx, 25, false); y = textLines(ctx, metadata, MARGIN, y, 36) + 28;
      if (question.length) {
        ctx.fillStyle = palette.accent; font(ctx, 24, true); ctx.fillText(value(labels.question), MARGIN, y); y += 38;
        ctx.fillStyle = palette.text; font(ctx, 30, false); y = textLines(ctx, question, MARGIN, y, 42) + 16;
      }
      ctx.save();
      ctx.translate(0, y);
      await drawBoard(ctx, board, palette, labels.hidden, signal);
      ctx.restore();
      y += board.height + 55;
      ctx.fillStyle = palette.line; ctx.fillRect(MARGIN, y - 28, CONTENT, 1);
      ctx.fillStyle = palette.accent; font(ctx, 25, true); ctx.fillText(value(labels.index), MARGIN, y); y += 45;
      ctx.fillStyle = palette.text; font(ctx, 25, false);
      for (var row = 0; row < indexRows.length; row++) {
        textLines(ctx, index[row * 2], MARGIN, y, 34);
        if (index[row * 2 + 1]) textLines(ctx, index[row * 2 + 1], MARGIN + CONTENT / 2 + 10, y, 34);
        y += indexRows[row] * 34 + 14;
      }
      y += 35; ctx.fillStyle = palette.line; ctx.fillRect(MARGIN, y - 24, CONTENT, 1);
      ctx.fillStyle = palette.accent; font(ctx, 22, true); ctx.fillText(value(labels.sources), MARGIN, y); y += 34;
      ctx.fillStyle = palette.muted; font(ctx, 22, false); textLines(ctx, credits, MARGIN, y, 31);
      check(signal);
      return await new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (signal && signal.aborted) reject(abortError());
          else if (!blob) reject(new Error("PNG encoding failed"));
          else if (blob.size >= 16 * 1024 * 1024) reject(new Error("PNG exceeds size limit"));
          else resolve(blob);
        }, "image/png");
      });
    } finally {
      canvas.width = canvas.height = 1;
    }
  }
  return { render: render, _test: { layoutBoard: layoutBoard, pixelSize: pixelSize, wrap: wrap, cardText: cardText, trustedUrl: trustedUrl, border: border } };
});
