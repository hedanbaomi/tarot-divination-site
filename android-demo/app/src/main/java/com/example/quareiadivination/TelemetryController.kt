package com.example.quareiadivination

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Calendar
import java.util.TimeZone
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Transparent, anonymous, opt-out usage-statistics controller.
 *
 * Collects only aggregate usage signals — never card faces, card names,
 * orientations, spread layouts, questions, notes, or local history. Each event
 * carries a per-install hash (SHA-256 of a random UUID) so active-device counts
 * can be estimated; the raw UUID never leaves the device and no hardware/device
 * identifier is read.
 *
 * All network work runs on a single background thread. Any failure is swallowed
 * so telemetry can never affect launch, offline divination, or local history:
 *  - install_seen / daily_active: retried on the next online launch if they fail;
 *  - reading_completed: fire-and-forget (no retry).
 *
 * The whole subsystem can be turned off from the About screen; turning it off
 * deletes the local install hash immediately and stops all reporting.
 */
internal object TelemetryController {

    private const val TAG = "QuareiaTelemetry"
    private const val PREFS = "quareia_telemetry"
    private const val ENDPOINT = "https://telemetry.luotianyi.fun/v1/events"
    private const val SCHEMA_VERSION = 1
    private const val TIMEOUT_MS = 10000
    private const val MAX_BODY_BYTES = 1024

    // Persistence keys.
    private const val KEY_ENABLED = "telemetry_enabled"
    private const val KEY_INSTALL_UUID = "install_uuid"
    private const val KEY_INSTALL_SEEN_SENT = "install_seen_sent"
    private const val KEY_LAST_DAU_UTC = "last_dau_utc"

    // Rate caps are advisory server-side defences; the client also guards
    // daily_active to at most one per UTC day.
    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "quareia-telemetry").apply { isDaemon = true }
    }

    private lateinit var appContext: Context

    /** Must be called once from Application/Activity startup before any event. */
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    private val prefs get() = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Whether the user has opted in. Defaults to enabled (transparent telemetry). */
    fun isEnabled(): Boolean = prefs.getBoolean(KEY_ENABLED, true)

    /**
     * Toggles telemetry. Disabling also wipes the local install hash so the
     * device becomes unlinkable to past events.
     */
    fun setEnabled(enabled: Boolean) {
        prefs.edit().apply {
            putBoolean(KEY_ENABLED, enabled)
            if (!enabled) {
                // Forget the device: remove the UUID and reset the send flags so a
                // later opt-in starts cleanly with a fresh, unrelated identity.
                remove(KEY_INSTALL_UUID)
                remove(KEY_INSTALL_SEEN_SENT)
                remove(KEY_LAST_DAU_UTC)
            }
        }.apply()
    }

    // ---------- Public event entry points ----------

    /** Sent once per install (retried until it succeeds). Safe to call every launch. */
    fun recordInstallSeen() {
        if (!isEnabled()) return
        if (prefs.getBoolean(KEY_INSTALL_SEEN_SENT, false)) return
        enqueue(basePayload("install_seen")) { sent ->
            if (sent) prefs.edit().putBoolean(KEY_INSTALL_SEEN_SENT, true).apply()
        }
    }

    /** Sent at most once per UTC day (retried next launch if it fails). */
    fun recordDailyActive() {
        if (!isEnabled()) return
        val today = utcDateString(System.currentTimeMillis())
        if (prefs.getString(KEY_LAST_DAU_UTC, null) == today) return
        enqueue(basePayload("daily_active")) { sent ->
            if (sent) prefs.edit().putString(KEY_LAST_DAU_UTC, today).apply()
        }
    }

    /**
     * Sent once per completed spread. Fire-and-forget: a network failure is
     * never retried. [deckType] is one of tarot / mystagogus / lxxxi.
     */
    fun logReadingCompleted(deckType: String, cardCount: Int) {
        if (!isEnabled()) return
        if (deckType !in DECK_TYPES) return
        if (cardCount < 1) return
        val payload = basePayload("reading_completed").apply {
            put("deck_type", deckType)
            put("card_count", cardCount)
        }
        enqueue(payload) { /* no retry on failure */ }
    }

    // ---------- Internals ----------

    private val DECK_TYPES = setOf("tarot", "mystagogus", "lxxxi")

    /** Builds the shared field set; never includes card/reading content. */
    private fun basePayload(event: String): JSONObject {
        val payload = JSONObject()
        payload.put("schema_version", SCHEMA_VERSION)
        payload.put("event", event)
        payload.put("install_hash", installHash())
        payload.put("app_version", appVersionName())
        payload.put("locale", localeTag())
        payload.put("android_major", androidReleaseMajor())
        return payload
    }

    /**
     * Returns the SHA-256 hex digest of the per-install random UUID, creating it
     * lazily on first use. The raw UUID is never transmitted.
     */
    private fun installHash(): String {
        var uuid = prefs.getString(KEY_INSTALL_UUID, null)
        if (uuid.isNullOrBlank()) {
            uuid = UUID.randomUUID().toString()
            prefs.edit().putString(KEY_INSTALL_UUID, uuid).apply()
        }
        return sha256Hex(uuid)
    }

    private fun appVersionName(): String {
        return try {
            val pm = appContext.packageManager
            pm.getPackageInfo(appContext.packageName, 0).versionName ?: "unknown"
        } catch (e: Exception) {
            "unknown"
        }
    }

    private fun localeTag(): String =
        appContext.resources.configuration.locales[0].toLanguageTag()

    private fun androidReleaseMajor(): Int {
        val parts = android.os.Build.VERSION.RELEASE.split(".")
        return parts.firstOrNull()?.toIntOrNull() ?: android.os.Build.VERSION.SDK_INT
    }

    private fun enqueue(payload: JSONObject, onResult: (Boolean) -> Unit) {
        executor.execute {
            val ok = try {
                send(payload)
            } catch (e: Exception) {
                Log.w(TAG, "event ${payload.optString("event")} failed", e)
                false
            }
            onResult(ok)
        }
    }

    /** Performs a synchronous POST; throws on any non-success. */
    private fun send(payload: JSONObject): Boolean {
        val body = JSONArray().put(payload).toString().toByteArray(Charsets.UTF_8)
        // Defensive: never send a body larger than the 1KB worker cap.
        if (body.size > MAX_BODY_BYTES) return false
        val conn = (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = TIMEOUT_MS
            readTimeout = TIMEOUT_MS
            doOutput = true
            // Do not identify the client beyond content type; no User-Agent that
            // could leak device fingerprints.
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Content-Length", body.size.toString())
            instanceFollowRedirects = false
        }
        try {
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            // 2xx (including 204 No Content) is success; anything else is a failure.
            return code in 200..299
        } finally {
            conn.disconnect()
        }
    }

    private fun utcDateString(epochMillis: Long): String {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
        cal.timeInMillis = epochMillis
        return String.format(
            "%04d-%02d-%02d",
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH) + 1,
            cal.get(Calendar.DAY_OF_MONTH)
        )
    }

    private fun sha256Hex(input: String): String {
        val md = MessageDigest.getInstance("SHA-256")
        val digest = md.digest(input.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(digest.size * 2)
        for (b in digest) sb.append("%02x".format(b))
        return sb.toString()
    }
}
