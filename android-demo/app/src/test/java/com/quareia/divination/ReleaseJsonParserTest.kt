package com.quareia.divination

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Strict asset-selection policy for GitHub Latest Release payloads: only a
 * published, non-draft, non-prerelease release with exactly one APK asset
 * named `QuareiaDivination-v<version>.apk`, an in-range size, a valid
 * `sha256:<hex>` digest and an HTTPS trusted download URL is accepted.
 * Anything else must throw [ReleaseDataException] (fail closed) — in
 * particular there is never a fallback to tarball_url / zipball_url or the
 * releases page.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class ReleaseJsonParserTest {

    private companion object {
        const val SIZE = 1_234_567L
        const val UPPER_HEX = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789"
    }

    @Test
    fun validReleaseIsAccepted() {
        val info = ReleaseJsonParser.parse(releaseJson())

        assertEquals("v1.1.1", info.tagName)
        assertEquals("QuareiaDivination-v1.1.1.apk", info.assetName)
        assertEquals(
            "https://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.1.1/" +
                "QuareiaDivination-v1.1.1.apk",
            info.downloadUrl,
        )
        assertEquals(SIZE, info.sizeBytes)
        assertEquals("application/vnd.android.package-archive", info.contentType)
        assertEquals("sha256:${"ab".repeat(32)}", info.sha256Digest)
    }

    @Test
    fun uppercaseDigestIsNormalizedToLowercase() {
        val json = releaseJson(asset = asset(digest = "sha256:$UPPER_HEX"))
        val info = ReleaseJsonParser.parse(json)

        assertEquals("sha256:${UPPER_HEX.lowercase()}", info.sha256Digest)
    }

    @Test
    fun assetNameMatchingIsCaseInsensitive() {
        val json = releaseJson(asset = asset(name = "QUAREIADIVINATION-V1.1.1.APK"))
        assertNotNull(ReleaseJsonParser.parse(json))
    }

    @Test
    fun draftReleaseIsRejected() {
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(releaseJson(draft = true))
        }
    }

    @Test
    fun prereleaseIsRejected() {
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(releaseJson(prerelease = true))
        }
    }

    @Test
    fun releaseWithoutAnyApkAssetIsRejected() {
        // Even when tarball_url / zipball_url / releases page are present,
        // there is no fallback: no APK asset means fail closed.
        val json = releaseJson(asset = """
            {"name":"quareia-1.1.1.tar.gz","size":$SIZE,"browser_download_url":"https://github.com/x"},
            {"name":"quareia-1.1.1.zip","size":$SIZE,"browser_download_url":"https://github.com/x"}
        """)
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun multipleApkAssetsAreRejected() {
        val json = releaseJson(asset = "${asset()},${asset(name = "QuareiaDivination-v1.1.1-extra.apk")}")
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun apkNameNotMatchingQuareiaPatternIsRejected() {
        val json = releaseJson(asset = asset(name = "app-release.apk"))
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun apkVersionMismatchingTagIsRejected() {
        val json = releaseJson(asset = asset(name = "QuareiaDivination-v1.0.0.apk"))
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun apkLargerThanMaxIsRejected() {
        val json = releaseJson(asset = asset(size = DownloadPolicy.maxApkBytes() + 1))
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun apkWithMissingSizeIsRejected() {
        val json = releaseJson(asset = """{"name":"QuareiaDivination-v1.1.1.apk"}""")
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun apkWithMissingDigestIsRejected() {
        val json = releaseJson(asset = asset(digest = ""))
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun apkWithMalformedDigestIsRejected() {
        val json = releaseJson(asset = asset(digest = "sha256:${"ab".repeat(31)}x"))
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun apkWithNonSha256DigestIsRejected() {
        val json = releaseJson(asset = asset(digest = "md5:${"ab".repeat(16)}"))
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun nonHttpsDownloadUrlIsRejected() {
        val json = releaseJson(asset = asset(url = "http://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.1.1/QuareiaDivination-v1.1.1.apk"))
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun untrustedDownloadHostIsRejected() {
        val json = releaseJson(asset = asset(url = "https://evil.example/QuareiaDivination-v1.1.1.apk"))
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse(json)
        }
    }

    @Test
    fun invalidJsonIsRejected() {
        assertThrows(ReleaseDataException::class.java) {
            ReleaseJsonParser.parse("not json at all")
        }
    }

    @Test
    fun downloadPolicyAllowsOnlyHttpsOnTrustedHosts() {
        assertTrue(DownloadPolicy.isAllowedUrl("https://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.1.1/QuareiaDivination-v1.1.1.apk"))
        assertTrue(DownloadPolicy.isAllowedUrl("https://objects.githubusercontent.com/github-production-release-asset-2e65be/1"))
        assertTrue(DownloadPolicy.isAllowedUrl("https://release-assets.githubusercontent.com/github-production-release-asset-2e65be/1"))
        assertTrue(DownloadPolicy.isAllowedUrl("https://api.github.com/repos/hedanbaomi/tarot-divination-site/releases/latest"))

        assertFalse(DownloadPolicy.isAllowedUrl("http://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.1.1/QuareiaDivination-v1.1.1.apk"))
        assertFalse(DownloadPolicy.isAllowedUrl("https://evil.example/QuareiaDivination-v1.1.1.apk"))
        assertFalse(DownloadPolicy.isAllowedUrl("https://github.com.evil.example/QuareiaDivination-v1.1.1.apk"))
        assertFalse(DownloadPolicy.isAllowedUrl("file:///tmp/x.apk"))
        assertFalse(DownloadPolicy.isAllowedUrl(""))
        assertFalse(DownloadPolicy.isAllowedUrl("not a url"))
    }

    @Test
    fun redirectResolutionMustStayOnTrustedHosts() {
        val current = "https://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.1.1/QuareiaDivination-v1.1.1.apk"
        assertEquals(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/1",
            DownloadPolicy.resolveRedirect(current, "https://objects.githubusercontent.com/github-production-release-asset-2e65be/1"),
        )
        assertEquals(
            "https://release-assets.githubusercontent.com/x",
            DownloadPolicy.resolveRedirect(current, "https://release-assets.githubusercontent.com/x"),
        )
        assertEquals(null, DownloadPolicy.resolveRedirect(current, "https://evil.example/x"))
        assertEquals(null, DownloadPolicy.resolveRedirect(current, "http://objects.githubusercontent.com/x"))
        assertEquals(null, DownloadPolicy.resolveRedirect(current, ""))
    }

    private fun releaseJson(
        tag: String = "v1.1.1",
        draft: Boolean = false,
        prerelease: Boolean = false,
        asset: String = asset(),
    ): String = """
        {
          "tag_name": "$tag",
          "draft": $draft,
          "prerelease": $prerelease,
          "tarball_url": "https://api.github.com/repos/hedanbaomi/tarot-divination-site/tarball/$tag",
          "zipball_url": "https://api.github.com/repos/hedanbaomi/tarot-divination-site/zipball/$tag",
          "assets": [$asset]
        }
    """.trimIndent()

    private fun asset(
        name: String = "QuareiaDivination-v1.1.1.apk",
        size: Long = SIZE,
        digest: String = "sha256:${"ab".repeat(32)}",
        url: String = "https://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.1.1/$name",
        contentType: String = "application/vnd.android.package-archive",
    ): String = """
        {
          "name": "$name",
          "size": $size,
          "digest": "$digest",
          "browser_download_url": "$url",
          "content_type": "$contentType"
        }
    """.trimIndent()
}
