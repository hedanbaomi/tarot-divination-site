package com.quareia.divination

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class AiConfigBridgeTest {

    private lateinit var application: Application

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
        AiConfigBridge(application).clear()
    }

    @Test
    fun bridgePersistsValidJsonAcrossInstancesAndClearsCleanly() {
        val bridgeA = AiConfigBridge(application)
        assertEquals("", bridgeA.read())

        val sampleConfig =
            """{"version":1,"activeProfileId":"p1","profiles":[{"id":"p1","format":"gemini-vertex","apiKey":"AQ.static-key","model":"gemini-2.5-flash"}]}"""
        assertTrue(bridgeA.write(sampleConfig))

        val bridgeB = AiConfigBridge(application)
        assertEquals(sampleConfig, bridgeB.read())

        bridgeB.clear()
        assertEquals("", bridgeA.read())
    }

    @Test
    fun bridgeRejectsInvalidOrOversizedPayloads() {
        val bridge = AiConfigBridge(application)
        assertFalse(bridge.write(""))
        assertFalse(bridge.write("not-json"))
        assertFalse(bridge.write("""{"profiles":[]}"""))

        val oversizedKey = "x".repeat(AiConfigBridge.MAX_CONFIG_BYTES)
        val oversized = """{"version":1,"apiKey":"$oversizedKey"}"""
        assertFalse(bridge.write(oversized))
        assertEquals("", bridge.read())
    }

    @Test
    fun isReadingPageMatchesAiChatAndQueryLinksOnly() {
        assertTrue(MainActivity.isReadingPage(MainActivity.HOME_URL))
        assertTrue(MainActivity.isReadingPage(MainActivity.CLASSIC_URL))
        assertTrue(MainActivity.isReadingPage(MainActivity.AI_URL))
        assertTrue(MainActivity.isReadingPage("${MainActivity.AI_URL}?readingId=rec-123"))
        assertFalse(MainActivity.isReadingPage("https://example.com/assets/www/ai.html"))
        assertFalse(MainActivity.isReadingPage(null))
    }
}
