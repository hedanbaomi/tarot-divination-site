(function (global) {
  "use strict";

  function isSafeExternalUrl(rawUrl) {
    try {
      var parsed = new URL(rawUrl);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch (_err) {
      return false;
    }
  }

  function appendInlineMarkdown(parent, text) {
    var doc = parent.ownerDocument || document;
    var source = typeof text === "string" ? text : "";
    var pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*|\[[^\]]+\]\([^)]+\))/g;
    var lastIndex = 0;
    var match;

    while ((match = pattern.exec(source)) !== null) {
      if (match.index > lastIndex) {
        parent.appendChild(doc.createTextNode(source.slice(lastIndex, match.index)));
      }
      var token = match[0];
      if (token.charAt(0) === "`") {
        var codeEl = doc.createElement("code");
        codeEl.textContent = token.slice(1, -1);
        parent.appendChild(codeEl);
      } else if (token.slice(0, 2) === "**" || token.slice(0, 2) === "__") {
        var strongEl = doc.createElement("strong");
        appendInlineMarkdown(strongEl, token.slice(2, -2));
        parent.appendChild(strongEl);
      } else if (token.slice(0, 2) === "~~") {
        var delEl = doc.createElement("del");
        appendInlineMarkdown(delEl, token.slice(2, -2));
        parent.appendChild(delEl);
      } else if (token.charAt(0) === "*") {
        var emEl = doc.createElement("em");
        appendInlineMarkdown(emEl, token.slice(1, -1));
        parent.appendChild(emEl);
      } else if (token.charAt(0) === "[") {
        var sepIdx = token.indexOf("](");
        var label = token.slice(1, sepIdx);
        var href = token.slice(sepIdx + 2, -1).trim();
        if (isSafeExternalUrl(href)) {
          var link = doc.createElement("a");
          link.href = href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          appendInlineMarkdown(link, label);
          parent.appendChild(link);
        } else {
          parent.appendChild(doc.createTextNode(token));
        }
      } else {
        parent.appendChild(doc.createTextNode(token));
      }
      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < source.length) {
      parent.appendChild(doc.createTextNode(source.slice(lastIndex)));
    }
  }

  function isTableSeparatorLine(line) {
    return /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/.test(line.trim());
  }

  function splitTableRow(line) {
    var trimmed = line.trim();
    if (trimmed.charAt(0) === "|") trimmed = trimmed.slice(1);
    if (trimmed.charAt(trimmed.length - 1) === "|") trimmed = trimmed.slice(0, -1);
    return trimmed.split("|").map(function (cell) {
      return cell.trim();
    });
  }

  function renderMarkdownInto(container, markdownText, depth) {
    if (!container) return;
    var curDepth = typeof depth === "number" ? depth : 0;
    var doc = container.ownerDocument || document;
    var frag = doc.createDocumentFragment();
    var lines = String(markdownText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var trimmed = line.trim();

      if (!trimmed) {
        i += 1;
        continue;
      }

      // Fenced code block
      if (trimmed.indexOf("```") === 0) {
        var codeLines = [];
        i += 1;
        while (i < lines.length && lines[i].trim().indexOf("```") !== 0) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        var pre = doc.createElement("pre");
        var code = doc.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.appendChild(code);
        frag.appendChild(pre);
        continue;
      }

      // Horizontal rule
      if (/^([-*_])\s*\1\s*\1[\s\-*_]*$/.test(trimmed)) {
        frag.appendChild(doc.createElement("hr"));
        i += 1;
        continue;
      }

      // Heading (# to ####)
      var headingMatch = /^(#{1,4})\s+(.*)$/.exec(trimmed);
      if (headingMatch) {
        var level = headingMatch[1].length;
        var heading = doc.createElement("h" + level);
        appendInlineMarkdown(heading, headingMatch[2]);
        frag.appendChild(heading);
        i += 1;
        continue;
      }

      // Blockquote
      if (trimmed.charAt(0) === ">") {
        var quoteLines = [];
        while (i < lines.length && lines[i].trim().charAt(0) === ">") {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
          i += 1;
        }
        var quote = doc.createElement("blockquote");
        if (curDepth + 1 < 6) {
          renderMarkdownInto(quote, quoteLines.join("\n"), curDepth + 1);
        } else {
          var fallbackQuotePara = doc.createElement("p");
          for (var qIdx = 0; qIdx < quoteLines.length; qIdx += 1) {
            if (qIdx > 0) fallbackQuotePara.appendChild(doc.createElement("br"));
            appendInlineMarkdown(fallbackQuotePara, quoteLines[qIdx].replace(/^(?:>\s?)+/, ""));
          }
          quote.appendChild(fallbackQuotePara);
        }
        frag.appendChild(quote);
        continue;
      }

      // Markdown Table
      if (trimmed.indexOf("|") !== -1 && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
        var table = doc.createElement("table");
        var thead = doc.createElement("thead");
        var headRow = doc.createElement("tr");
        var headers = splitTableRow(line);
        for (var h = 0; h < headers.length; h += 1) {
          var th = doc.createElement("th");
          appendInlineMarkdown(th, headers[h]);
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);
        i += 2;
        var tbody = doc.createElement("tbody");
        while (i < lines.length && lines[i].trim().indexOf("|") !== -1) {
          var cells = splitTableRow(lines[i]);
          var trEl = doc.createElement("tr");
          for (var c = 0; c < Math.max(headers.length, cells.length); c += 1) {
            var td = doc.createElement("td");
            appendInlineMarkdown(td, cells[c] || "");
            trEl.appendChild(td);
          }
          tbody.appendChild(trEl);
          i += 1;
        }
        table.appendChild(tbody);
        frag.appendChild(table);
        continue;
      }

      // Unordered / Ordered Lists
      if (/^[-*+]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        var ordered = /^\d+\.\s+/.test(trimmed);
        var listEl = doc.createElement(ordered ? "ol" : "ul");
        var itemRegex = ordered ? /^\d+\.\s+(.*)$/ : /^[-*+]\s+(.*)$/;
        while (i < lines.length) {
          var itemMatch = itemRegex.exec(lines[i].trim());
          if (!itemMatch) break;
          var li = doc.createElement("li");
          appendInlineMarkdown(li, itemMatch[1]);
          listEl.appendChild(li);
          i += 1;
        }
        frag.appendChild(listEl);
        continue;
      }

      // Paragraph block
      var paraLines = [];
      while (i < lines.length) {
        var cur = lines[i];
        var curTrim = cur.trim();
        if (
          !curTrim
          || curTrim.indexOf("```") === 0
          || /^(#{1,4})\s+/.test(curTrim)
          || curTrim.charAt(0) === ">"
          || /^[-*+]\s+/.test(curTrim)
          || /^\d+\.\s+/.test(curTrim)
          || /^([-*_])\s*\1\s*\1[\s\-*_]*$/.test(curTrim)
          || (curTrim.indexOf("|") !== -1 && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
        ) {
          break;
        }
        paraLines.push(cur);
        i += 1;
      }
      var p = doc.createElement("p");
      for (var pIdx = 0; pIdx < paraLines.length; pIdx += 1) {
        if (pIdx > 0) p.appendChild(doc.createElement("br"));
        appendInlineMarkdown(p, paraLines[pIdx]);
      }
      frag.appendChild(p);
    }

    container.replaceChildren(frag);
  }

  var api = {
    renderMarkdownInto: renderMarkdownInto,
    isSafeExternalUrl: isSafeExternalUrl
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.DivinationAiUiMarkdown = api;
})(typeof window !== "undefined" ? window : globalThis);
