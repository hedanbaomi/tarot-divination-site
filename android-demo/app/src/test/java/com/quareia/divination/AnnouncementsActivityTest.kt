package com.quareia.divination

import android.app.Application
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class AnnouncementsActivityTest {

    private lateinit var application: Application

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
        AnnouncementController.init(application)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
        // No network in unit tests: the fetcher returns the same items the
        // store was seeded with, so the async refresh cannot wipe them.
        AnnouncementController.setFetcherForTesting {
            """{"announcements":[
                {"id":1,"revision":2,"severity":"update","title":"新版发布","body":"请更新","button":"","action_url":""},
                {"id":2,"revision":1,"severity":"info","title":"维护通知","body":"周末维护","button":"","action_url":""}
            ],"locale":"zh-CN"}"""
        }
    }

    @After
    fun tearDown() {
        AnnouncementController.awaitIdleForTesting()
        AnnouncementController.setFetcherForTesting(null)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
    }

    @Test
    fun activityLaunchesWithAnEmptyState() {
        val controller = Robolectric.buildActivity(AnnouncementsActivity::class.java).setup()

        assertNotNull(controller.get())
        assertFalse(controller.get().isFinishing)
    }

    @Test
    fun activityRendersAnnouncementsFromTheStore() {
        AnnouncementsStore.update(
            listOf(
                Announcement(1, 2, "update", "新版发布", "请更新", "", ""),
                Announcement(2, 1, "info", "维护通知", "周末维护", "", ""),
            )
        )
        val activity = Robolectric.buildActivity(AnnouncementsActivity::class.java).setup().get()
        // Let the async forced refresh finish and re-render.
        assertTrue(AnnouncementController.awaitIdleForTesting())
        org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()

        assertTrue(containsText(activity.window.decorView, "新版发布"))
        assertTrue(containsText(activity.window.decorView, "维护通知"))
    }

    private fun containsText(view: android.view.View, expected: String): Boolean {
        if (view is android.widget.TextView && view.text.toString().contains(expected)) return true
        if (view is android.view.ViewGroup) {
            for (index in 0 until view.childCount) {
                if (containsText(view.getChildAt(index), expected)) return true
            }
        }
        return false
    }
}
