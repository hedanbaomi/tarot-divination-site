package com.quareia.divination

import android.app.Application
import android.os.Looper
import android.webkit.WebView
import java.io.File
import java.util.concurrent.Executors
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class MainActivityTest {

    private lateinit var application: Application
    private val events = mutableListOf<String>()

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
        TelemetryController.init(application)
        TelemetryController.resetForTesting()
        TelemetryController.setSenderForTesting { payload: JSONObject ->
            events.add(payload.optString("event"))
            true
        }
        AnnouncementController.init(application)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
        AnnouncementController.setFetcherForTesting { """{"announcements":[],"locale":"en"}""" }
        UpdateManager.resetForTest()
        installUpdateManagerFakes()
    }

    @After
    fun tearDown() {
        TelemetryController.awaitIdleForTesting()
        TelemetryController.setSenderForTesting(null)
        TelemetryController.resetForTesting()
        AnnouncementController.awaitIdleForTesting()
        AnnouncementController.setFetcherForTesting(null)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
        UpdateManager.resetForTest()
    }

    @Test
    fun startupSignalsNoLongerIncludeDailyActive() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val webView = findWebView(controller.get().window.decorView)!!

        // Simulate the bundled home page finishing its first load.
        shadowOf(webView).webViewClient.onPageFinished(webView, MainActivity.HOME_URL)

        assertTrue(TelemetryController.awaitIdleForTesting())
        shadowOf(Looper.getMainLooper()).idle()
        shadowOf(Looper.getMainLooper()).idle()

        assertTrue("install_seen should be sent", events.contains("install_seen"))
        assertTrue("app_active should be sent", events.contains("app_active"))
        assertFalse("v1.2 must not send the legacy daily_active", events.contains("daily_active"))
    }

    private fun findWebView(view: android.view.View): WebView? = when (view) {
        is WebView -> view
        is android.view.ViewGroup -> {
            for (index in 0 until view.childCount) {
                findWebView(view.getChildAt(index))?.let { return it }
            }
            null
        }
        else -> null
    }

    private fun installUpdateManagerFakes() {
        val metaReader = object : ApkMetaReader {
            override fun readApk(path: String): ApkMeta? =
                ApkMeta("com.quareia.divination", 4, listOf(SIGNER))

            override fun installedMeta(): InstalledApkMeta =
                InstalledApkMeta(4, listOf(SIGNER))
        }
        val source = object : UpdateSource {
            override fun fetchLatest(): ReleaseInfo? = null
        }
        val installer = object : InstallerLauncher {
            override fun canInstallUnknownSources(): Boolean = true
            override fun launchInstaller(apk: File): Boolean = true
        }
        UpdateManager.testDependencies = UpdateDependencies(
            source = source,
            downloader = object : ApkDownloader {
                override fun download(
                    release: ReleaseInfo,
                    partFile: File,
                    destination: File,
                    cancelled: () -> Boolean,
                    onProgress: (DownloadProgress) -> Unit,
                ): File? = null
            },
            metaReader = metaReader,
            verifier = ApkVerifier(metaReader),
            installer = installer,
            pending = PendingUpdateStore(application),
            mainHandler = android.os.Handler(Looper.getMainLooper()),
            executor = Executors.newSingleThreadExecutor { r ->
                Thread(r, "quareia-update-test").apply { isDaemon = true }
            },
            ownsExecutor = false,
        )
    }

    private companion object {
        const val SIGNER = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
    }
}
