package com.quareia.divination

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import org.json.JSONObject

/**
 * Checks GitHub Releases for a newer published version of the app and, when
 * one exists, downloads the release APK straight into the app's private
 * storage. Nothing is opened in an external browser for the update path.
 *
 * The check runs on a dedicated background thread and reports the newest
 * release only when its tag is strictly newer than the installed version.
 * Any network or parsing failure is reported as "no update" so the check
 * never blocks the UI or prompts the user twice for the same version.
 */
internal object UpdateChecker {

    private const val RELEASES_API =
        "https://api.github.com/repos/hedanbaomi/tarot-divination-site/releases/latest"
    private const val RELEASES_PAGE =
        "https://github.com/hedanbaomi/tarot-divination-site/releases"
    private const val TIMEOUT_MS = 10_000
    private const val MAX_BODY_BYTES = 64 * 1024
    private const val USER_AGENT = "Quareia-Divination-Android"

    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "quareia-update").apply { isDaemon = true }
    }

    /** Parsed result of a successful update check. */
    internal data class LatestRelease(
        val tagName: String,
        val apkUrl: String,
    )

    /** Immutable download progress snapshot. */
    internal data class DownloadProgress(
        val totalBytes: Long,
        val downloadedBytes: Long,
    ) {
        val fraction: Float
            get() = if (totalBytes > 0) {
                (downloadedBytes.toFloat() / totalBytes).coerceIn(0f, 1f)
            } else {
                0f
            }
    }

    /**
     * Asks for the newest release and invokes [onResult] on the caller's
     * original thread. [onResult] is always called exactly once, with a
     * release only if it is strictly newer than [currentVersionName].
     */
    internal fun check(
        currentVersionName: String,
        onResult: (LatestRelease?) -> Unit,
    ) {
        executor.execute {
            val release = try {
                fetchLatestRelease()
            } catch (_: Throwable) {
                null
            }
            onResult(release?.takeIf { isNewer(it.tagName, currentVersionName) })
        }
    }

    /**
     * Downloads the APK of [release] into [destination] on the background
     * thread, reporting progress via [onProgress] (called on that same
     * background thread, so the caller must post to its own UI thread).
     * Returns the downloaded file, or null on any failure (partial files
     * are deleted).
     */
    internal fun download(
        release: LatestRelease,
        destination: File,
        onProgress: (DownloadProgress) -> Unit,
    ): File? {
        var connection: HttpURLConnection? = null
        try {
            destination.parentFile?.mkdirs()
            connection = URL(release.apkUrl).openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive")
            connection.setRequestProperty("User-Agent", USER_AGENT)
            val code = connection.responseCode
            if (code !in 200..299) throw RuntimeException("download responded $code")
            val expected = connection.contentLengthLong
            val input: InputStream = connection.inputStream
            val temporary = File(destination.parentFile, destination.name + ".part")
            try {
                input.use { stream ->
                    FileOutputStream(temporary).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var total = 0L
                        while (true) {
                            val read = stream.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            total += read
                            onProgress(DownloadProgress(expected, total))
                        }
                    }
                }
            } catch (_: Throwable) {
                temporary.delete()
                throw RuntimeException("download interrupted")
            }
            if (expected > 0 && temporary.length() != expected) {
                temporary.delete()
                throw RuntimeException("download size mismatch")
            }
            if (!temporary.renameTo(destination)) {
                temporary.copyTo(destination, overwrite = true)
                temporary.delete()
            }
            return destination
        } catch (_: Throwable) {
            destination.delete()
            return null
        } finally {
            connection?.disconnect()
        }
    }

    /** "1.2" / "v1.2.3" style numeric comparison; malformed input is not newer. */
    internal fun isNewer(tagName: String, currentVersionName: String): Boolean {
        val latest = parseVersion(tagName) ?: return false
        val current = parseVersion(currentVersionName) ?: return false
        val width = maxOf(latest.size, current.size)
        for (index in 0 until width) {
            val left = latest.getOrElse(index) { 0 }
            val right = current.getOrElse(index) { 0 }
            if (left != right) return left > right
        }
        return false
    }

    private fun parseVersion(raw: String): List<Int>? {
        val digits = raw.trim().removePrefix("v").split('.')
        val numbers = digits.map { part -> part.toIntOrNull() ?: return null }
        if (numbers.isEmpty()) return null
        return numbers
    }

    private fun fetchLatestRelease(): LatestRelease {
        val connection = URL(RELEASES_API).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/vnd.github+json")
            connection.setRequestProperty("User-Agent", USER_AGENT)
            connection.instanceFollowRedirects = false
            val code = connection.responseCode
            if (code !in 200..299) throw RuntimeException("release API responded $code")
            val body = connection.inputStream.use { stream ->
                val buffer = ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                var total = 0
                while (true) {
                    val read = stream.read(chunk)
                    if (read < 0) break
                    total += read
                    if (total > MAX_BODY_BYTES) throw RuntimeException("release payload too large")
                    buffer.write(chunk, 0, read)
                }
                buffer.toString(Charsets.UTF_8.name())
            }
            val json = JSONObject(body)
            val assets = json.optJSONArray("assets")
            var apkUrl: String? = null
            if (assets != null) {
                for (index in 0 until assets.length()) {
                    val asset = assets.optJSONObject(index) ?: continue
                    val name = asset.optString("name")
                    if (name.endsWith(".apk", ignoreCase = true)) {
                        apkUrl = asset.optString("browser_download_url")
                        break
                    }
                }
            }
            val downloadUrl = apkUrl ?: json.optString(
                "tarball_url",
                json.optString("zipball_url", RELEASES_PAGE),
            )
            return LatestRelease(
                tagName = json.getString("tag_name"),
                apkUrl = downloadUrl,
            )
        } finally {
            connection.disconnect()
        }
    }
}
