(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DivinationHistoryMarkdown = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Official guidebook links from Quareia's Free Books page.
  var guidebooks = {
    tarot: "https://www.quareia.com/s/tarotbook-for-Q-website-g5at.pdf",
    mystagogus: "https://www.quareia.com/s/mystagogus-online.pdf",
    lxxxi: "https://www.quareia.com/s/deckbook-web.pdf"
  };

  // Imported names and questions are literal note text, including in Obsidian.
  function inline(value) {
    return String(value == null ? "" : value)
      .replace(/[\r\n]+/g, " ")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/[\\`*_\[\]#|~]/g, "\\$&");
  }

  function positionOrder(a, b) {
    return a.slotIndex - b.slotIndex || (a.layer === "minor") - (b.layer === "minor");
  }

  function format(records, display) {
    var t = display.t;
    var lines = ["# " + t("history.notesTitle")];
    var decks = new Set();
    records.forEach(function (record) {
      decks.add(record.deckType);
      var freeform = record.layoutMode === "freeform";
      lines.push("", "## " + inline(display.spreadName(record)), "",
        "- **" + t("history.field.time") + "**: " + display.formatTime(record.createdAt),
        "- **" + t("history.field.deck") + "**: " + inline(display.deckName(record)),
        "- **" + t("settings.mode") + "**: " + t(record.orientationMode === "mixed" ? "mode.mixed" : "mode.upright"),
        "- **" + t("history.field.cards") + "**: " + record.cards.length);

      if (record.question) {
        lines.push("", "### " + t("history.question"), "");
        record.question.split(/\r\n?|\n/).forEach(function (line) {
          // Protect list, rule, and code-block syntax at the start of each quoted line.
          lines.push("> " + inline(line).replace(/^(\s*)([-+=!]|\d+[.)])/,
            function (_, spaces, marker) { return spaces + marker.slice(0, -1) + "\\" + marker.slice(-1); }));
        });
      }

      var cards = record.cards.slice().sort(freeform
        ? function (a, b) { return a.drawOrder - b.drawOrder; }
        : positionOrder);
      cards.forEach(function (card) {
        var position = freeform ? t("freeBoard.drawOrder", { order: card.drawOrder }) :
          card.positionNumber + ". " + display.positionName(record, card);
        var orientation = t(card.orientation === "reversed" ? "orientation.reversed" : "orientation.upright");
        var layer = card.layer ? t("history.layer." + card.layer) : "";
        var interpretation = display.interpretation(record, card);
        lines.push("", "### " + inline(position) + " · " + inline(display.cardName(record, card)), "", orientation + layer);
        if (freeform && card.revealed === false) lines.push("", t("history.freeBoardHidden"));
        if (freeform && Number.isFinite(card.x) && Number.isFinite(card.y)) {
          lines.push("", "(" + card.x + ", " + card.y + ") · " + card.boardRotation + "°");
        }
        if (interpretation.keywords.length) {
          lines.push("", "**" + t("history.keywords") + "**: " + inline(interpretation.keywords.join(" · ")));
        }
        // Meanings come exclusively from the bundled deck, in the current language and orientation.
        lines.push("", interpretation.meaning || t("history.meaningUnavailable"));
      });
    });
    var citedDecks = Object.keys(guidebooks).filter(function (deck) { return decks.has(deck); });
    if (citedDecks.length) {
      lines.push("", "## " + t("history.sourcesAndCredits"), "");
      citedDecks.forEach(function (deck) {
        lines.push("- **" + t("deck.name." + deck) + "** — " +
          t("history.credit." + deck, { url: guidebooks[deck] }));
      });
    }
    return lines.join("\n") + "\n";
  }

  return { format: format };
});
