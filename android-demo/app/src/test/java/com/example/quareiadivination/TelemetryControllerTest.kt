package com.example.quareiadivination

import android.app.Application
import android.content.Context
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.hamcrest.CoreMatchers.`is`
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class TelemetryControllerTest {

    private lateinit var application: Application

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
        TelemetryController.init(application)
        TelemetryController.resetForTesting()
    }

    @After
    fun tearDown() {
        TelemetryController.awaitIdleForTesting()
        TelemetryController.setSenderForTesting(null)
        TelemetryController.resetForTesting()
    }

    @Test
    fun telemetryIsEnabledByDefault() {
        assertTrue(TelemetryController.isEnabled())
    }

    @Test
    fun disablingTelemetryDeletesUuidAndSendMarkers() {
        val prefs = preferences()
        prefs.edit()
            .putString("install_uuid", "local-only-uuid")
            .putBoolean("install_seen_sent", true)
            .putString("last_dau_utc", "2026-07-31")
            .commit()

        TelemetryController.setEnabled(false)

        assertFalse(TelemetryController.isEnabled())
        assertNull(prefs.getString("install_uuid", null))
        assertFalse(prefs.contains("install_seen_sent"))
        assertFalse(prefs.contains("last_dau_utc"))
    }

    @Test
    fun disablingInvalidatesQueuedGenerationBeforeItSends() {
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val sends = AtomicInteger()
        TelemetryController.setSenderForTesting {
            sends.incrementAndGet()
            started.countDown()
            release.await(2, TimeUnit.SECONDS)
            true
        }

        TelemetryController.recordInstallSeen()
        assertTrue(started.await(2, TimeUnit.SECONDS))
        TelemetryController.recordDailyActive()
        TelemetryController.setEnabled(false)
        release.countDown()

        assertTrue(TelemetryController.awaitIdleForTesting())
        assertThat(sends.get(), `is`(1))
        assertFalse(preferences().contains("install_uuid"))
    }

    @Test
    fun installAndDailyActiveAreDeduplicatedWhileInFlight() {
        val installStarted = CountDownLatch(1)
        val installRelease = CountDownLatch(1)
        val installSends = AtomicInteger()
        TelemetryController.setSenderForTesting {
            installSends.incrementAndGet()
            installStarted.countDown()
            installRelease.await(2, TimeUnit.SECONDS)
            true
        }

        TelemetryController.recordInstallSeen()
        TelemetryController.recordInstallSeen()
        assertTrue(installStarted.await(2, TimeUnit.SECONDS))
        installRelease.countDown()
        assertTrue(TelemetryController.awaitIdleForTesting())
        assertThat(installSends.get(), `is`(1))

        TelemetryController.resetForTesting()
        val dailyStarted = CountDownLatch(1)
        val dailyRelease = CountDownLatch(1)
        val dailySends = AtomicInteger()
        TelemetryController.setSenderForTesting {
            dailySends.incrementAndGet()
            dailyStarted.countDown()
            dailyRelease.await(2, TimeUnit.SECONDS)
            true
        }

        TelemetryController.recordDailyActive()
        TelemetryController.recordDailyActive()
        assertTrue(dailyStarted.await(2, TimeUnit.SECONDS))
        dailyRelease.countDown()
        assertTrue(TelemetryController.awaitIdleForTesting())
        assertThat(dailySends.get(), `is`(1))
    }

    @Test
    fun failedRetryableEventReleasesItsInFlightMarker() {
        val sends = AtomicInteger()
        TelemetryController.setSenderForTesting {
            sends.incrementAndGet()
            false
        }

        TelemetryController.recordInstallSeen()
        assertTrue(TelemetryController.awaitIdleForTesting())
        TelemetryController.recordInstallSeen()
        assertTrue(TelemetryController.awaitIdleForTesting())

        assertThat(sends.get(), `is`(2))
    }

    private fun preferences() =
        application.getSharedPreferences("quareia_telemetry", Context.MODE_PRIVATE)
}
