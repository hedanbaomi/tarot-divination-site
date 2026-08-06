package com.quareia.divination

import java.io.ByteArrayInputStream
import java.io.File
import java.nio.file.Files
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The downloader must never hand over a file whose size or SHA-256 does not
 * match the release metadata, and it must always delete the `.part` file on
 * failure or cancellation so no partial download survives.
 */
class ApkDownloaderTest {

    private val tempDir: File = Files.createTempDirectory("quareia-downloader-test").toFile()

    private fun part(): File = File(tempDir, "update.apk.part")

    private fun destination(): File = File(tempDir, "update.apk")

    private fun release(
        size: Long = 100,
        digest: String = "sha256:${Sha256.hex(ByteArray(100))}",
    ): ReleaseInfo = ReleaseInfo(
        tagName = "v1.1.1",
        assetName = "QuareiaDivination-v1.1.1.apk",
        downloadUrl = "https://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.1.1/QuareiaDivination-v1.1.1.apk",
        sizeBytes = size,
        contentType = "application/vnd.android.package-archive",
        sha256Digest = digest,
    )

    @Test
    fun validDownloadRenamesToDestination() {
        val bytes = ByteArray(100) { it.toByte() }
        val downloader = HttpApkDownloader(FakeTransport(bytes))

        val result = downloader.download(
            release(size = 100, digest = "sha256:${Sha256.hex(bytes)}"),
            part(),
            destination(),
            cancelled = { false },
            onProgress = {},
        )

        assertEquals(destination(), result)
        assertTrue(destination().isFile)
        assertArrayEquals(bytes, destination().readBytes())
        assertFalse(part().exists())
    }

    @Test
    fun sizeMismatchDeletesPartAndDestination() {
        val downloader = HttpApkDownloader(FakeTransport(ByteArray(100)))

        val result = downloader.download(
            release(size = 99, digest = "sha256:${Sha256.hex(ByteArray(100))}"),
            part(),
            destination(),
            cancelled = { false },
            onProgress = {},
        )

        assertNull(result)
        assertFalse(part().exists())
        assertFalse(destination().exists())
    }

    @Test
    fun digestMismatchDeletesPartAndDestination() {
        val downloader = HttpApkDownloader(FakeTransport(ByteArray(100)))

        val result = downloader.download(
            release(size = 100, digest = "sha256:${"cd".repeat(32)}"),
            part(),
            destination(),
            cancelled = { false },
            onProgress = {},
        )

        assertNull(result)
        assertFalse(part().exists())
        assertFalse(destination().exists())
    }

    @Test
    fun cancellationDeletesPartFile() {
        val counters = AtomicInteger()
        val downloader = HttpApkDownloader(FakeTransport(ByteArray(1_000_000) { 1 }))

        val result = downloader.download(
            release(size = 1_000_000, digest = "sha256:${Sha256.hex(ByteArray(1_000_000) { 1 })}"),
            part(),
            destination(),
            cancelled = { counters.incrementAndGet() > 2 },
            onProgress = {},
        )

        assertNull(result)
        assertFalse(part().exists())
        assertFalse(destination().exists())
    }

    @Test
    fun httpErrorResponseFailsClosed() {
        val downloader = HttpApkDownloader(FakeTransport(ByteArray(10), code = 404))

        val result = downloader.download(
            release(size = 10, digest = "sha256:${Sha256.hex(ByteArray(10))}"),
            part(),
            destination(),
            cancelled = { false },
            onProgress = {},
        )

        assertNull(result)
        assertFalse(part().exists())
        assertFalse(destination().exists())
    }

    @Test
    fun nonHttpsOrUntrustedUrlFailsClosed() {
        val downloader = HttpApkDownloader(FakeTransport(ByteArray(10)))

        val result = downloader.download(
            release(size = 10, digest = "sha256:${Sha256.hex(ByteArray(10))}").copy(
                downloadUrl = "http://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.1.1/QuareiaDivination-v1.1.1.apk",
            ),
            part(),
            destination(),
            cancelled = { false },
            onProgress = {},
        )

        assertNull(result)
        assertFalse(part().exists())
        assertFalse(destination().exists())
    }

    @Test
    fun streamLargerThanAnnouncedSizeFailsClosed() {
        // Transport claims a smaller content length than it actually sends.
        val downloader = HttpApkDownloader(FakeTransport(ByteArray(200), contentLength = 100))

        val result = downloader.download(
            release(size = 150, digest = "sha256:${Sha256.hex(ByteArray(200))}"),
            part(),
            destination(),
            cancelled = { false },
            onProgress = {},
        )

        assertNull(result)
        assertFalse(part().exists())
        assertFalse(destination().exists())
    }

    private class FakeTransport(
        private val bytes: ByteArray,
        private val code: Int = 200,
        private val contentLength: Long = bytes.size.toLong(),
    ) : HttpTransport {
        override fun open(url: String, headers: Map<String, String>): HttpTransport.OpenResult =
            HttpTransport.OpenResult(
                url = "https://objects.githubusercontent.com/fake",
                code = code,
                contentType = "application/vnd.android.package-archive",
                contentLength = contentLength,
                stream = ByteArrayInputStream(bytes),
            )
    }
}
