package com.quareia.divination

import android.app.Application
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject
import org.junit.After
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
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class AnnouncementControllerTest {

    private lateinit var application: Application
    private var clock = 0L

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
        AnnouncementController.init(application)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
        clock = 0L
        AnnouncementController.setClockForTesting { clock }
    }

    @After
    fun tearDown() {
        AnnouncementController.awaitIdleForTesting()
        AnnouncementController.setFetcherForTesting(null)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
    }

    @Test
    fun successfulFetchParsesAnnouncementsAndUpdatesTheStore() {
        val seen = mutableListOf<String>()
        AnnouncementController.setFetcherForTesting { url ->
            seen.add(url)
            json(listOf(announcement(1), announcement(2, severity = "update")))
        }

        var result: List<Announcement>? = null
        val done = CountDownLatch(1)
        AnnouncementController.check(force = true) { result = it; done.countDown() }
        waitForCallback(done)

        assertNotNull(result)
        assertEquals(2, result!!.size)
        assertEquals("update", result!![1].severity)
        assertEquals(1L, result!![0].id)
        assertTrue(seen.single().contains("platform=android"))
        assertTrue(seen.single().contains("version_code=4"))
        // Store was updated for offline display.
        assertEquals(2, AnnouncementsStore.lastList().size)
    }

    @Test
    fun nonForcedCheckIsDeduplicatedWithinSixHours() {
        var fetchCount = 0
        AnnouncementController.setFetcherForTesting {
            fetchCount += 1
            json(listOf(announcement(1)))
        }
        val first = CountDownLatch(1)
        AnnouncementController.check(force = true) { first.countDown() }
        waitForCallback(first)
        assertEquals(1, fetchCount)

        // A second startup check inside 6 hours must not hit the network.
        val second = CountDownLatch(1)
        AnnouncementController.check(force = false) { second.countDown() }
        waitForCallback(second)
        assertEquals(1, fetchCount)
        assertEquals(1, AnnouncementsStore.lastList().size)
    }

    @Test
    fun forcedCheckBypassesTheDedupe() {
        var fetchCount = 0
        AnnouncementController.setFetcherForTesting {
            fetchCount += 1
            json(emptyList())
        }
        val first = CountDownLatch(1)
        AnnouncementController.check(force = true) { first.countDown() }
        waitForCallback(first)

        val forced = CountDownLatch(1)
        AnnouncementController.check(force = true) { forced.countDown() }
        waitForCallback(forced)

        assertEquals(2, fetchCount)
    }

    @Test
    fun networkFailureIsSilentAndReturnsNothing() {
        AnnouncementController.setFetcherForTesting {
            throw RuntimeException("network down")
        }

        var result: List<Announcement>? = null
        val done = CountDownLatch(1)
        AnnouncementController.check(force = true) { result = it; done.countDown() }
        waitForCallback(done)

        assertNotNull(result)
        assertTrue(result!!.isEmpty())
        // A failed check never updates the dedupe marker or the store.
        assertTrue(AnnouncementsStore.lastList().isEmpty())
        clock += 6L * 60 * 60 * 1000 + 1
        val again = CountDownLatch(1)
        AnnouncementController.check(force = false) { again.countDown() }
        waitForCallback(again)
    }

    @Test
    fun malformedPayloadIsTreatedAsAnEmptyResult() {
        AnnouncementController.setFetcherForTesting { "not json at all" }

        var result: List<Announcement>? = null
        val done = CountDownLatch(1)
        AnnouncementController.check(force = true) { result = it; done.countDown() }
        waitForCallback(done)

        assertTrue(result!!.isEmpty())
    }

    @Test
    fun malformedEntriesAreSkippedIndividually() {
        AnnouncementController.setFetcherForTesting {
            json(
                listOf(
                    announcement(1),
                    mapOf("revision" to 1), // missing id
                    mapOf("id" to 3L),      // missing revision
                    mapOf("id" to 4L, "revision" to 1, "severity" to "spam")
                )
            )
        }

        var result: List<Announcement>? = null
        val done = CountDownLatch(1)
        AnnouncementController.check(force = true) { result = it; done.countDown() }
        waitForCallback(done)

        assertEquals(1, result!!.size)
        assertEquals(1L, result!![0].id)
    }

    @Test
    fun readTrackingUsesIdAndRevision() {
        assertFalse(AnnouncementController.isRead(1, 1))
        AnnouncementController.markRead(1, 1)

        assertTrue(AnnouncementController.isRead(1, 1))
        // An edited announcement (revision bumped) is unread again.
        assertFalse(AnnouncementController.isRead(1, 2))
        // Another announcement is untouched.
        assertFalse(AnnouncementController.isRead(2, 1))

        AnnouncementController.markRead(1, 2)
        assertTrue(AnnouncementController.isRead(1, 2))
    }

    @Test
    fun readMarksDoNotGrowUnbounded() {
        for (id in 1L..(AnnouncementController.MAX_READ_MARKS_FOR_TEST + 50)) {
            AnnouncementController.markRead(id, 1)
        }
        val count = AnnouncementController.readMarkCountForTest()
        assertTrue(count <= AnnouncementController.MAX_READ_MARKS_FOR_TEST)
    }

    @Test
    fun emptyAnnouncementsListIsAValidResult() {
        AnnouncementController.setFetcherForTesting { json(emptyList()) }
        var result: List<Announcement>? = null
        val done = CountDownLatch(1)
        AnnouncementController.check(force = true) { result = it; done.countDown() }
        waitForCallback(done)
        assertNotNull(result)
        assertTrue(result!!.isEmpty())
    }

    private fun waitForCallback(done: CountDownLatch) {
        assertTrue(AnnouncementController.awaitIdleForTesting())
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(done.await(2, TimeUnit.SECONDS))
    }

    private fun announcement(
        id: Long,
        revision: Int = 1,
        severity: String = "info",
        title: String = "标题",
        body: String = "正文",
        button: String = "",
        actionUrl: String = "",
    ): Map<String, Any> = mapOf(
        "id" to id,
        "revision" to revision,
        "severity" to severity,
        "title" to title,
        "body" to body,
        "button" to button,
        "action_url" to actionUrl,
    )

    private fun json(announcements: List<Map<String, Any>>): String = JSONObject().apply {
        put("announcements", org.json.JSONArray(announcements.map { JSONObject(it) }))
        put("locale", "zh-CN")
    }.toString()
}
