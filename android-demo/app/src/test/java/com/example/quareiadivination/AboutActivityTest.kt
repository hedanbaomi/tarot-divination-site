package com.example.quareiadivination

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class AboutActivityTest {

    @Test
    fun activityCanBeRestoredWithApplicationOnlyInitialization() {
        val controller = Robolectric.buildActivity(AboutActivity::class.java).setup()

        assertNotNull(controller.get())
        assertFalse(controller.get().isFinishing)
    }
}
