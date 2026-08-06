package com.quareia.divination

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
    fun staleGenerationReleaseCannotClearNewGenerationInFlightMarker() {
        val generationZeroStarted = CountDownLatch(1)
        val generationZeroRelease = CountDownLatch(1)
        val generationOneStarted = CountDownLatch(1)
        val generationOneRelease = CountDownLatch(1)
        val sends = AtomicInteger()

        TelemetryController.setSenderForTesting {
            when (sends.incrementAndGet()) {
                1 -> {
                    generationZeroStarted.countDown()
                    generationZeroRelease.await(2, TimeUnit.SECONDS)
                }
                2 -> {
                    generationOneStarted.countDown()
                    generationOneRelease.await(2, TimeUnit.SECONDS)
                }
            }
            true
        }

        // Generation 0 is blocked inside the sender.
        TelemetryController.recordInstallSeen()
        assertTrue(generationZeroStarted.await(2, TimeUnit.SECONDS))

        // Disable invalidates generation 0; re-enable queues generation 1.
        TelemetryController.setEnabled(false)
        TelemetryController.setEnabled(true)
        TelemetryController.recordInstallSeen()
        TelemetryController.recordInstallSeen()

        generationZeroRelease.countDown()
        assertTrue(generationOneStarted.await(2, TimeUnit.SECONDS))

        // Generation 0 has now released, but generation 1 is still in flight.
        // A third call must not create a duplicate generation-1 request.
        TelemetryController.recordInstallSeen()
        assertThat(sends.get(), `is`(2))

        generationOneRelease.countDown()
        assertTrue(TelemetryController.awaitIdleForTesting())
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

    @Test
    fun appActiveSendsImmediatelyThenDedupesSameVersionForSixHours() {
        var clock = 1_000_000L
        TelemetryController.setClockForTesting { clock }
        TelemetryController.setVersionCodeForTesting { 4 }
        val payloads = mutableListOf<org.json.JSONObject>()
        TelemetryController.setSenderForTesting { payload ->
            payloads.add(payload)
            true
        }

        TelemetryController.recordAppActive()
        assertTrue(TelemetryController.awaitIdleForTesting())
        assertThat(payloads.size, `is`(1))
        assertThat(payloads[0].optString("event"), `is`("app_active"))
        assertThat(payloads[0].optInt("version_code"), `is`(4))

        // Same version, just under 6 hours later: deduplicated.
        clock += 6L * 60 * 60 * 1000 - 1000
        TelemetryController.recordAppActive()
        assertTrue(TelemetryController.awaitIdleForTesting())
        assertThat(payloads.size, `is`(1))

        // Just past 6 hours: sent again.
        clock += 2000
        TelemetryController.recordAppActive()
        assertTrue(TelemetryController.awaitIdleForTesting())
        assertThat(payloads.size, `is`(2))
    }

    @Test
    fun appActiveVersionChangeSendsImmediatelyEvenInsideTheWindow() {
        var version = 3
        TelemetryController.setClockForTesting { 1_000_000L }
        TelemetryController.setVersionCodeForTesting { version }
        val payloads = mutableListOf<org.json.JSONObject>()
        TelemetryController.setSenderForTesting { payload ->
            payloads.add(payload)
            true
        }

        TelemetryController.recordAppActive()
        assertTrue(TelemetryController.awaitIdleForTesting())
        assertThat(payloads.size, `is`(1))

        // The app is upgraded; the next foreground must report immediately.
        version = 4
        TelemetryController.recordAppActive()
        assertTrue(TelemetryController.awaitIdleForTesting())

        assertThat(payloads.size, `is`(2))
        assertThat(payloads[1].optInt("version_code"), `is`(4))
    }

    @Test
    fun appActiveIsNeverSentWhenTelemetryIsDisabled() {
        TelemetryController.setEnabled(false)
        val sends = AtomicInteger()
        TelemetryController.setSenderForTesting {
            sends.incrementAndGet()
            true
        }

        TelemetryController.recordAppActive()
        assertTrue(TelemetryController.awaitIdleForTesting())

        assertThat(sends.get(), `is`(0))
        // Disabling also removed the app-active send markers.
        assertFalse(preferences().contains("last_app_active_utc"))
        assertFalse(preferences().contains("last_app_active_version_code"))
    }

    private fun preferences() =
        application.getSharedPreferences("quareia_telemetry", Context.MODE_PRIVATE)
}
