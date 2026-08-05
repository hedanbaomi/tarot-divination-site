package com.quareia.divination

import android.webkit.JavascriptInterface

/**
 * JavaScript bridge that exposes the (anonymous, opt-out) usage-statistics
 * entry points to the bundled web page.
 *
 * The page calls these from its own completion hooks; the actual network
 * request is performed off the main thread by [TelemetryController]. None of
 * these methods ever read card faces, names, orientations, spread layouts,
 * questions, notes, or history — they only pass the deck type and the number
 * of cards in the finished spread.
 *
 * Every method is a thin, argument-validated pass-through, so a malformed call
 * from the page can never crash the app.
 */
internal class TelemetryBridge {

    @JavascriptInterface
    fun isEnabled(): Boolean = TelemetryController.isEnabled()

    /** Turns statistics on/off. Disabling also deletes the local install hash. */
    @JavascriptInterface
    fun setEnabled(enabled: Boolean) {
        TelemetryController.setEnabled(enabled)
    }

    /** To be called once per finished spread; fire-and-forget on failure. */
    @JavascriptInterface
    fun logReadingCompleted(deckType: String, cardCount: Int) {
        TelemetryController.logReadingCompleted(deckType, cardCount)
    }

    /** To be called on app launch; sent once per install (retried on failure). */
    @JavascriptInterface
    fun recordInstallSeen() {
        TelemetryController.recordInstallSeen()
    }

    /** To be called on app launch; sent at most once per UTC day. */
    @JavascriptInterface
    fun recordDailyActive() {
        TelemetryController.recordDailyActive()
    }
}
