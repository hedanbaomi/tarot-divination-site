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
import java.util.concurrent.atomic.AtomicLong

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

    private val executor = Executors.newSingleThreadExecutor { r ->
        Thread(r, "quareia-telemetry").apply { isDaemon = true }
    }
    private val stateLock = Any()
    private val generation = AtomicLong(0)

    @Volatile
    private var activeConnection: HttpURLConnection? = null
    private var installSeenInFlight = false
    private var dailyActiveInFlight = false

    private lateinit var appContext: Context

    // This seam is only used by local JVM tests; production always uses the
    // HttpURLConnection path below.
    private var senderForTests: ((JSONObject) -> Boolean)? = null

    private enum class InFlightSlot {
        INSTALL_SEEN,
        DAILY_ACTIVE
    }

    private data class QueuedEvent(
        val payload: JSONObject,
        val token: Long,
        val slot: InFlightSlot?,
        val onResult: (Boolean) -> Unit
    )

    /** Must be called once from [QuareiaApplication] before any event. */
    fun init(context: Context) {
        synchronized(stateLock) {
            appContext = context.applicationContext
        }
    }

    private val prefs get() = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Whether the user has opted in. Defaults to enabled (transparent telemetry). */
    fun isEnabled(): Boolean = synchronized(stateLock) {
        prefs.getBoolean(KEY_ENABLED, true)
    }

    /**
     * Toggles telemetry. Disabling invalidates every queued generation, clears
     * retry markers and the local install UUID, and best-effort disconnects the
     * request currently using the network.
     */
    fun setEnabled(enabled: Boolean) {
        var connectionToDisconnect: HttpURLConnection? = null
        synchronized(stateLock) {
            if (!enabled) {
                generation.incrementAndGet()
                installSeenInFlight = false
                dailyActiveInFlight = false
                connectionToDisconnect = activeConnection
            }
            prefs.edit().apply {
                putBoolean(KEY_ENABLED, enabled)
                if (!enabled) {
                    // Forget the device: remove the UUID and reset the send
                    // flags so a later opt-in starts with a fresh identity.
                    remove(KEY_INSTALL_UUID)
                    remove(KEY_INSTALL_SEEN_SENT)
                    remove(KEY_LAST_DAU_UTC)
                }
            }.apply()
        }
        connectionToDisconnect?.disconnect()
    }

    // ---------- Public event entry points ----------

    /** Sent once per install (retried until it succeeds). Safe to call every launch. */
    fun recordInstallSeen() {
        val queued: QueuedEvent? = synchronized(stateLock) {
            if (!isEnabledLocked() || prefs.getBoolean(KEY_INSTALL_SEEN_SENT, false) ||
                installSeenInFlight
            ) {
                return@synchronized null
            }
            val token = generation.get()
            val event = QueuedEvent(
                payload = basePayload("install_seen"),
                token = token,
                slot = InFlightSlot.INSTALL_SEEN,
                onResult = { sent -> markInstallSeenSent(token, sent) }
            )
            installSeenInFlight = true
            event
        }
        queued?.let(::enqueue)
    }

    /** Sent at most once per UTC day (retried next launch if it fails). */
    fun recordDailyActive() {
        val today = utcDateString(System.currentTimeMillis())
        val queued: QueuedEvent? = synchronized(stateLock) {
            if (!isEnabledLocked() || prefs.getString(KEY_LAST_DAU_UTC, null) == today ||
                dailyActiveInFlight
            ) {
                return@synchronized null
            }
            val token = generation.get()
            val event = QueuedEvent(
                payload = basePayload("daily_active"),
                token = token,
                slot = InFlightSlot.DAILY_ACTIVE,
                onResult = { sent -> markDailyActiveSent(token, today, sent) }
            )
            dailyActiveInFlight = true
            event
        }
        queued?.let(::enqueue)
    }

    /**
     * Sent once per completed spread. Fire-and-forget: a network failure is
     * never retried. [deckType] is one of tarot / mystagogus / lxxxi.
     */
    fun logReadingCompleted(deckType: String, cardCount: Int) {
        if (deckType !in DECK_TYPES || cardCount < 1) return
        val queued: QueuedEvent? = synchronized(stateLock) {
            if (!isEnabledLocked()) return@synchronized null
            QueuedEvent(
                payload = basePayload("reading_completed").apply {
                    put("deck_type", deckType)
                    put("card_count", cardCount)
                },
                token = generation.get(),
                slot = null,
                onResult = {}
            )
        }
        queued?.let(::enqueue)
    }

    // ---------- Internals ----------

    private val DECK_TYPES = setOf("tarot", "mystagogus", "lxxxi")

    private fun isEnabledLocked(): Boolean = prefs.getBoolean(KEY_ENABLED, true)

    private fun isCurrent(token: Long): Boolean = synchronized(stateLock) {
        isCurrentLocked(token)
    }

    private fun isCurrentLocked(token: Long): Boolean =
        generation.get() == token && isEnabledLocked()

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

    private fun localeTag(): String {
        val locales = appContext.resources.configuration.locales
        return if (!locales.isEmpty) locales[0].toLanguageTag() else "und"
    }

    private fun androidReleaseMajor(): Int {
        val major = android.os.Build.VERSION.RELEASE.substringBefore(".").toIntOrNull()
            ?: android.os.Build.VERSION.SDK_INT
        return major.coerceIn(1, 100)
    }

    private fun enqueue(event: QueuedEvent) {
        executor.execute {
            var sent = false
            try {
                // A disabled generation never reaches send(). The check is
                // repeated inside send immediately before opening the request.
                if (isCurrent(event.token)) {
                    sent = send(event.payload, event.token)
                    if (isCurrent(event.token)) event.onResult(sent)
                }
            } catch (e: Exception) {
                Log.w(TAG, "event ${event.payload.optString("event")} failed", e)
            } finally {
                releaseInFlight(event.slot)
            }
        }
    }

    private fun releaseInFlight(slot: InFlightSlot?) {
        if (slot == null) return
        synchronized(stateLock) {
            when (slot) {
                InFlightSlot.INSTALL_SEEN -> installSeenInFlight = false
                InFlightSlot.DAILY_ACTIVE -> dailyActiveInFlight = false
            }
        }
    }

    private fun markInstallSeenSent(token: Long, sent: Boolean) {
        if (!sent) return
        synchronized(stateLock) {
            if (isCurrentLocked(token)) {
                prefs.edit().putBoolean(KEY_INSTALL_SEEN_SENT, true).apply()
            }
        }
    }

    private fun markDailyActiveSent(token: Long, today: String, sent: Boolean) {
        if (!sent) return
        synchronized(stateLock) {
            if (isCurrentLocked(token)) {
                prefs.edit().putString(KEY_LAST_DAU_UTC, today).apply()
            }
        }
    }

    /** Performs a synchronous POST; throws on any non-success. */
    private fun send(payload: JSONObject, token: Long): Boolean {
        val body = JSONArray().put(payload).toString().toByteArray(Charsets.UTF_8)
        // Defensive: never send a body larger than the 1KB worker cap.
        if (body.size > MAX_BODY_BYTES || !isCurrent(token)) return false

        val testSender = synchronized(stateLock) {
            if (isCurrentLocked(token)) senderForTests else null
        }
        if (testSender != null) return testSender.invoke(payload)

        // Opening and registering the connection is one critical section with
        // the generation check, so close() cannot race before the reference is
        // visible to setEnabled(false).
        val conn = synchronized(stateLock) {
            if (!isCurrentLocked(token)) return@synchronized null
            (URL(ENDPOINT).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Content-Length", body.size.toString())
                instanceFollowRedirects = false
                activeConnection = this
            }
        } ?: return false

        try {
            if (!isCurrent(token)) return false
            conn.outputStream.use { it.write(body) }
            val code = conn.responseCode
            return code in 200..299
        } finally {
            synchronized(stateLock) {
                if (activeConnection === conn) activeConnection = null
            }
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

    // ---------- Local JVM-test seams ----------

    internal fun setSenderForTesting(sender: ((JSONObject) -> Boolean)?) {
        synchronized(stateLock) {
            senderForTests = sender
        }
    }

    internal fun awaitIdleForTesting(timeoutMs: Long = 2000): Boolean {
        val idle = java.util.concurrent.CountDownLatch(1)
        executor.execute { idle.countDown() }
        return idle.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
    }

    internal fun resetForTesting() {
        var connectionToDisconnect: HttpURLConnection? = null
        synchronized(stateLock) {
            generation.incrementAndGet()
            installSeenInFlight = false
            dailyActiveInFlight = false
            connectionToDisconnect = activeConnection
            senderForTests = null
            prefs.edit().clear().commit()
        }
        connectionToDisconnect?.disconnect()
    }
}
