/* Pointer, keyboard and assistive activation share the same reading transaction. */
(function (root) {
  "use strict";

  function bind(button, getVisual, shuffle) {
    var pointer = null;
    var heldVisual = null;
    var settling = false;
    var consumeClick = false;
    var releasedPointer = null;

    async function settle(visual) {
      settling = true;
      try {
        var accepted = await shuffle();
        if (visual && accepted) visual.finish();
        else if (visual) visual.cancel();
      } catch (error) {
        if (visual) visual.cancel();
        throw error;
      } finally {
        settling = false;
      }
    }

    function single() {
      var visual = getVisual();
      if (pointer !== null || settling || (visual && visual.isRunning())) return;
      return settle(null);
    }

    function down(event) {
      if (event.isPrimary === false || event.button !== 0 || pointer !== null) return;
      var visual = getVisual();
      consumeClick = settling || !!(visual && visual.isRunning());
      if (settling || !visual || !visual.begin()) return;
      consumeClick = true;
      pointer = event.pointerId;
      heldVisual = visual;
      button.classList.add("is-holding");
      try { button.setPointerCapture(pointer); } catch (_) { /* window also handles release */ }
    }

    function end(event, cancelled) {
      if (pointer === null || (event && event.pointerId !== pointer)) return;
      var id = pointer;
      releasedPointer = id;
      var visual = heldVisual;
      pointer = null;
      heldVisual = null;
      button.classList.remove("is-holding");
      try { button.releasePointerCapture(id); } catch (_) { /* capture was already lost */ }
      if (cancelled) {
        visual.cancel();
      } else {
        visual.release();
        return settle(visual);
      }
    }

    function interrupt() { end(null, true); }
    function cancelPointer(event) { end(event, true); }
    function releasePointer(event) { end(event, false); }

    // A touch release can open a modal before Chrome generates its click.
    // That click can target the backdrop (or a dialog action) instead of the button.
    root.addEventListener("pointerdown", function () { releasedPointer = null; }, true);
    root.addEventListener("click", function (event) {
      if (releasedPointer === null || !event.detail) return;
      if (event.pointerId != null && event.pointerId !== releasedPointer) return;
      releasedPointer = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", releasePointer);
    button.addEventListener("pointercancel", cancelPointer);
    button.addEventListener("lostpointercapture", cancelPointer);
    root.addEventListener("pointerup", releasePointer);
    root.addEventListener("pointercancel", cancelPointer);
    root.addEventListener("blur", interrupt);
    root.addEventListener("pagehide", interrupt);
    root.document.addEventListener("visibilitychange", function () {
      if (root.document.hidden) interrupt();
    });
    button.addEventListener("contextmenu", function (event) { event.preventDefault(); });
    button.addEventListener("click", function (event) {
      if (event.detail && consumeClick) return;
      return single();
    });
    return single;
  }

  root.DivinationShuffleGesture = { bind: bind };
})(globalThis);
