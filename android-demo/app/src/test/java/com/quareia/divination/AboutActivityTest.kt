package com.quareia.divination

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class AboutActivityTest {

    private val application
        get() = org.robolectric.RuntimeEnvironment.getApplication()

    @Before
    fun clearManualLocale() {
        application.getSharedPreferences(AppLocale.PREFS, android.content.Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    @After
    fun clearManualLocaleAfterTest() {
        clearManualLocale()
    }

    @Test
    fun activityCanBeRestoredWithApplicationOnlyInitialization() {
        val controller = Robolectric.buildActivity(AboutActivity::class.java).setup()

        assertNotNull(controller.get())
        assertFalse(controller.get().isFinishing)
    }

    @Test
    fun activityUsesTheHomepageManualChineseLocale() {
        AppLocale.set(application, "zh-CN")

        val activity = Robolectric.buildActivity(AboutActivity::class.java).setup().get()

        assertTrue(containsText(activity.window.decorView, AppLocale.contextFor(application).getString(R.string.about_title)))
        assertTrue(containsText(activity.window.decorView, AppLocale.contextFor(application).getString(R.string.telemetry_section_title)))
    }

    @Test
    fun activityUsesTheHomepageManualEnglishLocale() {
        AppLocale.set(application, "en")

        val activity = Robolectric.buildActivity(AboutActivity::class.java).setup().get()

        assertTrue(containsText(activity.window.decorView, AppLocale.contextFor(application).getString(R.string.about_title)))
        assertTrue(containsText(activity.window.decorView, AppLocale.contextFor(application).getString(R.string.telemetry_section_title)))
    }

    private fun containsText(view: android.view.View, expected: String): Boolean {
        if (view is android.widget.TextView && view.text.toString() == expected) return true
        if (view is android.view.ViewGroup) {
            for (index in 0 until view.childCount) {
                if (containsText(view.getChildAt(index), expected)) return true
            }
        }
        return false
    }
}
