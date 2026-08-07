package com.quareia.divination

import android.app.Application
import android.net.Uri
import android.webkit.WebResourceResponse
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class LxxxiAssetRouteTest {

    private lateinit var application: Application

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
    }

    @Test
    fun validTokenAndBackReturnWebpWithoutCaching() {
        val response = route(fakeProvider()).response(
            application.assets,
            protectedUri("lxxxi-back"),
            "GET",
        )

        assertImageResponse(response)
    }

    @Test
    fun firstAndLastFaceKeysReturnWebp() {
        listOf("lxxxi-01", "lxxxi-81").forEach { key ->
            assertImageResponse(route(fakeProvider()).response(application.assets, protectedUri(key), "GET"))
        }
    }

    @Test
    fun wrongTokenReturns404WithoutCallingProvider() {
        var called = false
        val provider = LxxxiAssetProvider { _, _ -> called = true; webpBytes() }
        val response = route(provider).response(
            application.assets,
            Uri.parse("https://${MainActivity.APP_HOST}${MainActivity.PROTECTED_PREFIX}wrong/lxxxi-01"),
            "GET",
        )

        assertNotFound(response)
        assertFalse(called)
    }

    @Test
    fun nonGetMethodsReturn404() {
        listOf("POST", "HEAD", "get").forEach { method ->
            assertNotFound(route(fakeProvider()).response(application.assets, protectedUri("lxxxi-01"), method))
        }
    }

    @Test
    fun invalidKeysAndTraversalReturn404() {
        val invalid = listOf(
            "lxxxi-00",
            "lxxxi-82",
            "lxxxi-1",
            "lxxxi-001",
            "lxxxi-front",
            "..",
            "%2e%2e",
            "lxxxi-%2F01",
        )
        invalid.forEach { key ->
            assertNotFound(route(fakeProvider()).response(application.assets, protectedUri(key), "GET"))
        }
        assertNotFound(
            route(fakeProvider()).response(
                application.assets,
                Uri.parse("${baseUrl()}/lxxxi-01/extra"),
                "GET",
            ),
        )
        assertNotFound(
            route(fakeProvider()).response(
                application.assets,
                Uri.parse("${baseUrl()}/lxxxi-01?cache=1"),
                "GET",
            ),
        )
    }

    @Test
    fun absentOrThrowingProviderFailsClosed() {
        assertNotFound(route(null).response(application.assets, protectedUri("lxxxi-back"), "GET"))
        val throwing = LxxxiAssetProvider { _, _ -> error("private provider failure") }
        assertNotFound(route(throwing).response(application.assets, protectedUri("lxxxi-01"), "GET"))
    }

    @Test
    fun emptyOrNonWebpProviderOutputFailsClosed() {
        listOf(ByteArray(0), "not-an-image".toByteArray()).forEach { bytes ->
            val provider = LxxxiAssetProvider { _, _ -> bytes }
            assertNotFound(route(provider).response(application.assets, protectedUri("lxxxi-01"), "GET"))
        }
    }

    @Test
    fun wrongOriginIsNotRecognizedAsProtectedRoute() {
        val route = route(fakeProvider())
        assertFalse(route.isProtectedRequest(Uri.parse("http://${MainActivity.APP_HOST}/_m/$TOKEN/lxxxi-01")))
        assertFalse(route.isProtectedRequest(Uri.parse("https://example.invalid/_m/$TOKEN/lxxxi-01")))
        assertFalse(route.isProtectedRequest(Uri.parse("https://${MainActivity.APP_HOST}:444/_m/$TOKEN/lxxxi-01")))
        assertFalse(route.isProtectedRequest(Uri.parse("https://${MainActivity.APP_HOST}/assets/lxxxi-01")))
        assertTrue(route.isProtectedRequest(protectedUri("lxxxi-01")))
    }

    @Test
    fun publicAssetRouteServesWwwButRejectsRawPrivateAssetNamespace() {
        val route = PublicWebAssetRoute(application)
        val home = route.response(Uri.parse(MainActivity.HOME_URL))
        val rawPrivate = route.response(
            Uri.parse("https://${MainActivity.APP_HOST}/assets/qv/opaque-record.dat"),
        )

        assertNotNull(home)
        assertTrue(home!!.data.readBytes().isNotEmpty())
        assertNotNull(rawPrivate)
        assertNotFound(rawPrivate!!)
        assertNotFound(
            route.response(
                Uri.parse("https://${MainActivity.APP_HOST}/assets/www/%2e%2e/qv/opaque-record.dat"),
            )!!,
        )
        assertNull(route.response(Uri.parse("https://example.invalid/assets/www/index.html")))
    }

    @Test
    fun successfulResponseDoesNotWriteDecryptedBytesToDisk() {
        val before = cacheFiles()
        val response = route(fakeProvider()).response(application.assets, protectedUri("lxxxi-01"), "GET")
        assertImageResponse(response)
        assertEquals(before, cacheFiles())
    }

    private fun route(provider: LxxxiAssetProvider?): LxxxiAssetRoute =
        LxxxiAssetRoute(TOKEN, provider)

    private fun fakeProvider(): LxxxiAssetProvider = LxxxiAssetProvider { _, _ -> webpBytes() }

    private fun protectedUri(key: String): Uri = Uri.parse("${baseUrl()}/$key")

    private fun baseUrl(): String =
        "https://${MainActivity.APP_HOST}${MainActivity.PROTECTED_PREFIX}$TOKEN"

    private fun webpBytes(): ByteArray =
        byteArrayOf('R'.code.toByte(), 'I'.code.toByte(), 'F'.code.toByte(), 'F'.code.toByte()) +
            byteArrayOf(4, 0, 0, 0) +
            byteArrayOf('W'.code.toByte(), 'E'.code.toByte(), 'B'.code.toByte(), 'P'.code.toByte())

    private fun assertImageResponse(response: WebResourceResponse) {
        assertEquals(200, response.statusCode)
        assertEquals("image/webp", response.mimeType)
        assertEquals("no-store", response.responseHeaders["Cache-Control"])
        assertArrayEquals(webpBytes(), response.data.readBytes())
    }

    private fun assertNotFound(response: WebResourceResponse) {
        assertEquals(404, response.statusCode)
        assertEquals("no-store", response.responseHeaders["Cache-Control"])
        assertEquals(0, response.data.readBytes().size)
    }

    private fun cacheFiles(): Set<String> = application.cacheDir
        .walkTopDown()
        .filter { it.isFile }
        .map { it.relativeTo(application.cacheDir).invariantSeparatorsPath }
        .toSet()

    private companion object {
        const val TOKEN = "0123456789abcdef0123456789abcdef"
    }
}
