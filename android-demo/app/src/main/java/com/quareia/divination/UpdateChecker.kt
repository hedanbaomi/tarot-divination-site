package com.quareia.divination

import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import org.json.JSONObject

/**
 * Pure-Kotlin update engine: knows how to talk to the GitHub Releases API for
 * this repository, how to pick the single allowed APK asset out of a release,
 * how to download it into app-private storage while verifying size and
 * SHA-256, and how to compare versions. It deliberately contains no Android
 * imports so every piece of it is unit-testable without a device.
 *
 * The policy is strict and fail-closed: only a published (non-draft,
 * non-prerelease) release is accepted, exactly one APK asset matching
 * `QuareiaDivination-v<version>.apk` is required, the asset must carry a
 * size and a `sha256:<hex>` digest from the GitHub API, the download URL must
 * be HTTPS on a trusted GitHub domain (including any redirect), and the
 * downloaded file must match the announced size and digest before it is
 * handed over for package verification and installation.
 */

/** A release that passed every check and is safe to download. */
internal data class ReleaseInfo(
    val tagName: String,
    val assetName: String,
    val downloadUrl: String,
    val sizeBytes: Long,
    val contentType: String,
    /** Normalized lowercase digest, including the `sha256:` prefix. */
    val sha256Digest: String,
)

/** Result of an update check: a newer release, no newer release, or failure. */
internal sealed class UpdateCheckResult {
    data class Available(val release: ReleaseInfo) : UpdateCheckResult()
    data object UpToDate : UpdateCheckResult()
    data object Failed : UpdateCheckResult()
}

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

/** Thrown when release metadata is present but unusable (fail closed). */
internal class ReleaseDataException(message: String, cause: Throwable? = null) :
    RuntimeException(message, cause)

/** Fetches the newest acceptable release metadata. Throws on any anomaly. */
internal fun interface UpdateSource {
    /** Returns the release, or null when no release data exists at all. */
    fun fetchLatest(): ReleaseInfo?
}

/** Opens a single GET request; redirect policy is applied by the transport. */
internal interface HttpTransport {
    fun open(url: String, headers: Map<String, String>): OpenResult

    data class OpenResult(
        val url: String,
        val code: Int,
        val contentType: String?,
        val contentLength: Long,
        val stream: InputStream,
    )
}

/** Downloads a release APK to [partFile], verifies it, then renames to [destination]. */
internal interface ApkDownloader {
    /**
     * Returns [destination] only after the downloaded bytes match the asset
     * size and SHA-256 digest. On any failure (including [cancelled]
     * becoming true) both [partFile] and [destination] are deleted and null
     * is returned.
     */
    fun download(
        release: ReleaseInfo,
        partFile: File,
        destination: File,
        cancelled: () -> Boolean,
        onProgress: (DownloadProgress) -> Unit,
    ): File?
}

/**
 * Checks [source] for a release newer than [currentVersionName] and maps the
 * outcome to a distinct [UpdateCheckResult]. A network / HTTP / JSON / asset
 * anomaly is always `Failed`, never "up to date".
 */
internal fun checkSync(source: UpdateSource, currentVersionName: String): UpdateCheckResult =
    try {
        val release = source.fetchLatest() ?: return UpdateCheckResult.Failed
        if (VersionComparator.isNewer(release.tagName, currentVersionName)) {
            UpdateCheckResult.Available(release)
        } else {
            UpdateCheckResult.UpToDate
        }
    } catch (_: Throwable) {
        UpdateCheckResult.Failed
    }

/** Numeric `1.2` / `v1.2.3` style comparisons; malformed input is never newer. */
internal object VersionComparator {

    fun isNewer(tagName: String, currentVersionName: String): Boolean {
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

    /** True when both values parse to the same numeric version (v-prefix ignored). */
    fun equal(a: String, b: String): Boolean {
        val left = parseVersion(a) ?: return false
        val right = parseVersion(b) ?: return false
        return left == right
    }

    private fun parseVersion(raw: String): List<Int>? {
        val digits = raw.trim().removePrefix("v").split('.')
        val numbers = digits.map { part -> part.toIntOrNull() ?: return null }
        if (numbers.isEmpty()) return null
        return numbers
    }
}

/** HTTPS + trusted-host policy for the API call and every download redirect. */
internal object DownloadPolicy {

    private const val MAX_APK_BYTES = 100 * 1024 * 1024L
    private const val MAX_REDIRECTS = 10

    private val ALLOWED_HOSTS = setOf(
        "github.com",
        "api.github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    )

    fun maxApkBytes(): Long = MAX_APK_BYTES

    fun maxRedirects(): Int = MAX_REDIRECTS

    /** Only HTTPS URLs on trusted GitHub hosts may be opened or followed. */
    fun isAllowedUrl(raw: String): Boolean = try {
        val url = URL(raw)
        url.protocol == "https" && ALLOWED_HOSTS.contains(url.host)
    } catch (_: Throwable) {
        false
    }

    /** Resolves a redirect Location; returns null when it leaves the allowlist. */
    fun resolveRedirect(currentUrl: String, location: String): String? {
        return try {
            if (location.isBlank()) return null
            val resolved = URL(URL(currentUrl), location).toExternalForm()
            if (isAllowedUrl(resolved)) resolved else null
        } catch (_: Throwable) {
            null
        }
    }
}

/** SHA-256 helpers shared by download verification and signer comparison. */
internal object Sha256 {

    fun hex(data: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(data).toHex()

    fun hex(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().toHex()
    }

    private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
}

/** Parses the GitHub `/releases/latest` payload with a strict fail-closed policy. */
internal object ReleaseJsonParser {

    private val ASSET_NAME_REGEX =
        Regex("^quareiadivination-v(\\d+(?:\\.\\d+)*)\\.apk$", RegexOption.IGNORE_CASE)
    private val DIGEST_REGEX = Regex("^sha256:[0-9a-f]{64}$")

    fun parse(body: String): ReleaseInfo {
        val json = try {
            JSONObject(body)
        } catch (cause: Throwable) {
            throw ReleaseDataException("release payload is not valid JSON", cause)
        }

        if (json.optBoolean("draft", false)) {
            throw ReleaseDataException("draft release is never accepted")
        }
        if (json.optBoolean("prerelease", false)) {
            throw ReleaseDataException("prerelease is never accepted")
        }

        val tagName = json.optString("tag_name").takeIf { it.isNotBlank() }
            ?: throw ReleaseDataException("release has no tag_name")

        val assets = json.optJSONArray("assets")
            ?: throw ReleaseDataException("release has no assets array")
        val apks = buildList {
            for (index in 0 until assets.length()) {
                val asset = assets.optJSONObject(index) ?: continue
                if (asset.optString("name").endsWith(".apk", ignoreCase = true)) add(asset)
            }
        }
        if (apks.isEmpty()) throw ReleaseDataException("release has no APK asset")
        if (apks.size > 1) throw ReleaseDataException("release has multiple APK assets")

        val asset = apks.single()
        val name = asset.optString("name")
        val match = ASSET_NAME_REGEX.matchEntire(name)
            ?: throw ReleaseDataException("APK asset name does not match QuareiaDivination-v<version>.apk")
        val nameVersion = match.groupValues[1]
        if (!VersionComparator.equal(nameVersion, tagName)) {
            throw ReleaseDataException("APK asset version does not match the release tag")
        }

        val size = asset.optLong("size", -1L)
        if (size <= 0 || size > DownloadPolicy.maxApkBytes()) {
            throw ReleaseDataException("APK asset size is missing or out of range")
        }

        val digest = asset.optString("digest").lowercase()
        if (!DIGEST_REGEX.matches(digest)) {
            throw ReleaseDataException("APK asset digest is missing or malformed")
        }

        val downloadUrl = asset.optString("browser_download_url").takeIf { it.isNotBlank() }
            ?: throw ReleaseDataException("APK asset has no download URL")
        if (!DownloadPolicy.isAllowedUrl(downloadUrl)) {
            throw ReleaseDataException("APK download URL is not a trusted HTTPS URL")
        }

        return ReleaseInfo(
            tagName = tagName,
            assetName = name,
            downloadUrl = downloadUrl,
            sizeBytes = size,
            contentType = asset.optString("content_type"),
            sha256Digest = digest,
        )
    }
}

/** GitHub Releases API source backed by [HttpTransport]. */
internal class GithubUpdateSource(
    private val transport: HttpTransport,
    private val apiUrl: String = "https://api.github.com/repos/hedanbaomi/tarot-divination-site/releases/latest",
) : UpdateSource {

    private companion object {
        const val USER_AGENT = "Quareia-Divination-Android"
        const val TIMEOUT_MS = 10_000
        const val MAX_BODY_BYTES = 64 * 1024
    }

    override fun fetchLatest(): ReleaseInfo? {
        val response = transport.open(
            apiUrl,
            mapOf(
                "Accept" to "application/vnd.github+json",
                "User-Agent" to USER_AGENT,
            ),
        )
        return try {
            if (response.code != 200) {
                throw ReleaseDataException("release API responded ${response.code}")
            }
            val body = response.stream.use { stream ->
                val buffer = java.io.ByteArrayOutputStream()
                val chunk = ByteArray(8192)
                var total = 0
                while (true) {
                    val read = stream.read(chunk)
                    if (read < 0) break
                    total += read
                    if (total > MAX_BODY_BYTES) {
                        throw ReleaseDataException("release payload too large")
                    }
                    buffer.write(chunk, 0, read)
                }
                buffer.toString(Charsets.UTF_8.name())
            }
            ReleaseJsonParser.parse(body)
        } finally {
            runCatching { response.stream.close() }
        }
    }
}

/** HttpURLConnection-based transport with redirect validation and timeouts. */
internal class UrlConnectionTransport : HttpTransport {

    private companion object {
        const val TIMEOUT_MS = 10_000
        const val USER_AGENT = "Quareia-Divination-Android"
    }

    override fun open(url: String, headers: Map<String, String>): HttpTransport.OpenResult {
        if (!DownloadPolicy.isAllowedUrl(url)) {
            throw ReleaseDataException("refusing to open non-HTTPS or untrusted URL")
        }
        var current = url
        var connection: HttpURLConnection? = null
        try {
            repeat(DownloadPolicy.maxRedirects()) {
                connection = URL(current).openConnection() as HttpURLConnection
                connection!!.requestMethod = "GET"
                connection!!.connectTimeout = TIMEOUT_MS
                connection!!.readTimeout = TIMEOUT_MS
                connection!!.setRequestProperty("User-Agent", USER_AGENT)
                headers.forEach { (key, value) -> connection!!.setRequestProperty(key, value) }
                connection!!.instanceFollowRedirects = false

                val code = connection!!.responseCode
                if (code in 300..399) {
                    val location = connection!!.getHeaderField("Location")
                    val next = DownloadPolicy.resolveRedirect(current, location)
                        ?: throw ReleaseDataException("download redirect left the trusted domain")
                    connection!!.disconnect()
                    connection = null
                    current = next
                } else {
                    val stream = if (code in 200..299) {
                        connection!!.inputStream
                    } else {
                        connection!!.errorStream ?: ByteArrayInputStream(ByteArray(0))
                    }
                    return HttpTransport.OpenResult(
                        url = current,
                        code = code,
                        contentType = connection!!.contentType,
                        contentLength = connection!!.contentLengthLong,
                        stream = stream,
                    )
                }
            }
            throw ReleaseDataException("too many redirects")
        } catch (throwable: Throwable) {
            connection?.disconnect()
            throw throwable
        }
    }
}

/** Downloads a release APK and verifies size + SHA-256 before returning it. */
internal class HttpApkDownloader(
    private val transport: HttpTransport,
) : ApkDownloader {

    private companion object {
        const val USER_AGENT = "Quareia-Divination-Android"
        const val TIMEOUT_MS = 10_000
    }

    override fun download(
        release: ReleaseInfo,
        partFile: File,
        destination: File,
        cancelled: () -> Boolean,
        onProgress: (DownloadProgress) -> Unit,
    ): File? {
        var succeeded = false
        try {
            // Defense in depth: never touch a URL the policy does not allow,
            // even if a misconfigured source slipped an asset through.
            if (!DownloadPolicy.isAllowedUrl(release.downloadUrl)) return null
            partFile.parentFile?.mkdirs()
            destination.delete()
            partFile.delete()

            val response = transport.open(
                release.downloadUrl,
                mapOf(
                    "Accept" to "application/vnd.android.package-archive",
                    "User-Agent" to USER_AGENT,
                ),
            )
            try {
                if (response.code !in 200..299) return null

                var total = 0L
                response.stream.use { input ->
                    FileOutputStream(partFile).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        while (true) {
                            if (cancelled()) return null
                            val read = input.read(buffer)
                            if (read < 0) break
                            output.write(buffer, 0, read)
                            total += read
                            if (total > release.sizeBytes) return null
                            onProgress(DownloadProgress(release.sizeBytes, total))
                        }
                    }
                }
                if (cancelled()) return null
                if (total != release.sizeBytes) return null
                if (Sha256.hex(partFile) != release.sha256Digest.removePrefix("sha256:")) {
                    return null
                }
                if (!partFile.renameTo(destination)) {
                    partFile.copyTo(destination, overwrite = true)
                    partFile.delete()
                }
                succeeded = true
                return destination
            } finally {
                runCatching { response.stream.close() }
            }
        } catch (_: Throwable) {
            return null
        } finally {
            if (!succeeded) {
                runCatching { partFile.delete() }
                runCatching { destination.delete() }
            }
        }
    }
}
