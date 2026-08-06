package com.quareia.divination

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * In-app announcements (info / important / update).
 *
 * Fetches published announcements from the telemetry worker's public
 * endpoint, deduplicated to at most one network check per 6 hours on startup
 * and foreground (a manual refresh can force a check). Any network, HTTP, or
 * JSON failure is silent and never affects launch, divination, history, or
 * the updater.
 *
 * Read tracking is local and keyed by `id + revision`: marking an
 * announcement read records both values, so when an admin edits an
 * announcement (revision bumps) it is shown again.
 *
 * The worker resolves the requested language; this controller never renders
 * HTML — every field is plain text.
 */
internal object AnnouncementController {

    private const val TAG = "QuareiaAnnouncements"
    private const val PREFS = "quareia_announcements"
    private const val KEY_LAST_CHECK_UTC = "last_check_utc"
    private const val KEY_READ = "read_marks"
    private const val ENDPOINT = "https://telemetry.luotianyi.fun/v1/announcements"
    private const val MIN_CHECK_INTERVAL_MS = 6L * 60 * 60 * 1000
    private const val TIMEOUT_MS = 10_000
    private const val MAX_READ_MARKS = 200
    private const val READ_SEPARATOR = "\n"

    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "quareia-announcements").apply { isDaemon = true }
    }
    private val mainHandler = Handler(Looper.getMainLooper())
    private val inFlight = AtomicBoolean(false)

    @Volatile
    private var appContext: Context? = null

    // Test seams; production uses the network and the real clock.
    @Volatile
    private var fetcherForTests: ((String) -> String?)? = null

    @Volatile
    private var nowProviderForTests: (() -> Long)? = null

    /** Must be called once from [QuareiaApplication] before any check. */
    fun init(context: Context) {
        appContext = context.applicationContext
    }

    /**
     * Checks for announcements. [force] bypasses the 6-hour dedupe (manual
     * refresh). [onResult] runs on the main thread with the fetched list, or
     * with the cached snapshot when the check was deduplicated, or with an
     * empty list on failure.
     */
    fun check(force: Boolean = false, onResult: ((List<Announcement>) -> Unit)? = null) {
        val context = appContext ?: return
        if (!inFlight.compareAndSet(false, true)) return

        val now = currentTimeMillis()
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!force && now - prefs.getLong(KEY_LAST_CHECK_UTC, 0L) < MIN_CHECK_INTERVAL_MS) {
            inFlight.set(false)
            mainHandler.post { onResult?.invoke(AnnouncementsStore.lastList()) }
            return
        }

        executor.execute {
            val fetched = try {
                fetch(context)
            } catch (e: Exception) {
                Log.w(TAG, "announcement check failed", e)
                null
            }
            val list = fetched ?: emptyList()
            mainHandler.post {
                inFlight.set(false)
                if (fetched != null) {
                    prefs.edit().putLong(KEY_LAST_CHECK_UTC, currentTimeMillis()).apply()
                    AnnouncementsStore.update(list)
                }
                onResult?.invoke(list)
            }
        }
    }

    /** True when the announcement with this id/revision was already shown. */
    fun isRead(id: Long, revision: Int): Boolean =
        readMarks().contains(markKey(id, revision))

    /** Records the announcement as read; the list is capped and oldest-first pruned. */
    fun markRead(id: Long, revision: Int) {
        val context = appContext ?: return
        val key = markKey(id, revision)
        val marks = readMarks()
        if (key in marks) return
        marks.add(key)
        while (marks.size > MAX_READ_MARKS) marks.removeAt(0)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_READ, marks.joinToString(READ_SEPARATOR))
            .apply()
    }

    private fun markKey(id: Long, revision: Int): String = "$id:$revision"

    private fun readMarks(): MutableList<String> {
        val context = appContext ?: return mutableListOf()
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_READ, null)
            ?: return mutableListOf()
        return raw.split(READ_SEPARATOR).filter { it.isNotBlank() }.toMutableList()
    }

    // ---------- Network ----------

    private fun fetch(context: Context): List<Announcement> {
        val url = buildUrl(context)
        val testFetcher = fetcherForTests
        val raw = testFetcher?.invoke(url) ?: httpGet(url)
        return parse(raw)
    }

    private fun buildUrl(context: Context): String {
        val versionCode = try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            @Suppress("DEPRECATION")
            if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode
        } catch (e: Exception) {
            0
        }
        val locale = try {
            AppLocale.contextFor(context)
                .resources
                .configuration
                .locales
                .let { if (!it.isEmpty) it[0].toLanguageTag() else "en" }
        } catch (e: Exception) {
            "en"
        }
        return "$ENDPOINT?platform=android&version_code=$versionCode&locale=$locale"
    }

    /** Synchronous GET; throws on any non-2xx response or connection error. */
    private fun httpGet(url: String): String {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("User-Agent", "Quareia-Divination-Android")
            connection.instanceFollowRedirects = false
            val code = connection.responseCode
            if (code !in 200..299) throw RuntimeException("announcements responded $code")
            val body = connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            if (body.length > 64 * 1024) throw RuntimeException("announcements payload too large")
            return body
        } finally {
            connection.disconnect()
        }
    }

    /** Strict-ish parse: skips malformed entries but never throws on one bad item. */
    private fun parse(raw: String): List<Announcement> {
        val json = JSONObject(raw)
        val array = json.optJSONArray("announcements") ?: return emptyList()
        val result = mutableListOf<Announcement>()
        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            val id = item.optLong("id", -1L)
            val revision = item.optInt("revision", -1)
            val severity = item.optString("severity")
            if (id <= 0 || revision <= 0 || severity !in SEVERITIES) continue
            result.add(
                Announcement(
                    id = id,
                    revision = revision,
                    severity = severity,
                    title = item.optString("title"),
                    body = item.optString("body"),
                    button = item.optString("button"),
                    actionUrl = item.optString("action_url"),
                )
            )
        }
        return result
    }

    private fun currentTimeMillis(): Long =
        nowProviderForTests?.invoke() ?: System.currentTimeMillis()

    // ---------- Local JVM-test seams ----------

    internal const val MAX_READ_MARKS_FOR_TEST = MAX_READ_MARKS

    internal fun readMarkCountForTest(): Int = readMarks().size

    internal fun setFetcherForTesting(fetcher: ((String) -> String?)?) {
        fetcherForTests = fetcher
    }

    internal fun setClockForTesting(provider: () -> Long) {
        nowProviderForTests = provider
    }

    internal fun resetForTesting() {
        fetcherForTests = null
        nowProviderForTests = null
        inFlight.set(false)
        appContext?.getSharedPreferences(PREFS, Context.MODE_PRIVATE)?.edit()?.clear()?.commit()
    }

    internal fun awaitIdleForTesting(timeoutMs: Long = 2000): Boolean {
        val idle = java.util.concurrent.CountDownLatch(1)
        executor.execute { idle.countDown() }
        return idle.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
    }

    private val SEVERITIES = setOf("info", "important", "update")
}

/** One localized announcement as returned by the worker. Plain text only. */
internal data class Announcement(
    val id: Long,
    val revision: Int,
    val severity: String,
    val title: String,
    val body: String,
    val button: String,
    val actionUrl: String,
)

/** In-memory snapshot of the last successful fetch, for offline display. */
internal object AnnouncementsStore {

    @Volatile
    private var list: List<Announcement> = emptyList()

    @Volatile
    private var updatedAtMillis: Long = 0L

    fun update(announcements: List<Announcement>) {
        list = announcements
        updatedAtMillis = System.currentTimeMillis()
    }

    fun lastList(): List<Announcement> = list

    fun lastUpdatedAtMillis(): Long = updatedAtMillis

    fun resetForTesting() {
        list = emptyList()
        updatedAtMillis = 0L
    }
}
