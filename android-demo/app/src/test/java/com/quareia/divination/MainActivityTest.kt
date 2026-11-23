package com.quareia.divination

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Looper
import android.util.Base64
import android.webkit.WebView
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.fakes.BaseCursor

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

    @Test
    fun pngExportUsesCreateDocumentAndWritesTheOriginalBytes() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val shadow = shadowOf(activity)
        val uri = Uri.parse("content://test.documents/reading")
        val output = ByteArrayOutputStream()
        val resolver = shadowOf(activity.applicationContext.contentResolver)
        resolver.registerOutputStream(uri, output)
        resolver.setCursor(uri, object : BaseCursor() {
            override fun moveToFirst() = true
            override fun getString(columnIndex: Int) = "renamed\".png"
            override fun close() = Unit
        })

        assertTrue(activity.requestPngExport(PNG_BASE64, "../folder\\April 抽牌.PNG"))
        val picker = shadow.nextStartedActivityForResult
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, picker.intent.action)
        assertEquals("image/png", picker.intent.type)
        assertEquals("April.png", picker.intent.getStringExtra(Intent.EXTRA_TITLE))
        assertEquals(1, stagedExports(activity).size)
        assertFalse(activity.requestHistoryExport("{\"version\":1}", "backup.json"))
        assertNull(shadow.nextStartedActivityForResult)

        activity.activityResultRegistry.dispatchResult(
            picker.requestCode, Activity.RESULT_OK, Intent().setData(uri),
        )

        awaitExport { exportScript(activity).contains("ok:true") }
        assertArrayEquals(Base64.decode(PNG_BASE64, Base64.DEFAULT), output.toByteArray())
        assertTrue(stagedExports(activity).isEmpty())
        assertTrue(exportScript(activity).contains("ok:true,cancelled:false,fileName:\"renamed\\\".png\""))
        controller.pause().stop().destroy()
    }

    @Test
    fun malformedAndOversizePngResultsReleaseThePickerWithoutWriting() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val shadow = shadowOf(activity)
        val maxEncoded = (MainActivity.MAX_PNG_EXPORT_BYTES + 2) / 3 * 4
        val validPrefix = "iVBORw0KGgoA"
        val invalidImages = listOf(
            "",
            PNG_BASE64.replaceFirst('/', '?'),
            "bm90IGEgcG5n",
            "iVBORw0KGgo=",
            validPrefix + "A".repeat(maxEncoded - validPrefix.length),
            validPrefix + "A".repeat(maxEncoded - validPrefix.length + 4),
        )
        for (invalidImage in invalidImages) {
            assertTrue(activity.requestPngExport(invalidImage, "坏文件.PNG"))
            assertNull(shadow.nextStartedActivityForResult)
            assertTrue(stagedExports(activity).isEmpty())
            assertTrue(exportScript(activity).contains("ok:false,cancelled:false,fileName:\"quareia-reading.png\""))
        }

        assertTrue(activity.requestPngExport(PNG_BASE64, "retry.png"))
        assertEquals("image/png", shadow.nextStartedActivityForResult.intent.type)
        controller.pause().stop().destroy()
        assertTrue(stagedExports(activity).isEmpty())
    }

    @Test
    fun cancellationAndWriteErrorCleanUpAndKeepTextExportsAvailable() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val shadow = shadowOf(activity)
        assertTrue(activity.requestPngExport(PNG_BASE64, "cancel.png"))
        val cancelled = shadow.nextStartedActivityForResult
        activity.activityResultRegistry.dispatchResult(cancelled.requestCode, Activity.RESULT_CANCELED, null)
        assertTrue(exportScript(activity).contains("ok:false,cancelled:true,fileName:\"cancel.png\""))
        assertTrue(stagedExports(activity).isEmpty())

        val brokenUri = Uri.parse("content://test.documents/broken")
        shadowOf(activity.contentResolver).registerOutputStream(brokenUri, object : OutputStream() {
            override fun write(value: Int) {
                throw IOException("Document provider write failed")
            }
        })
        assertTrue(activity.requestPngExport(PNG_BASE64, "failure.png"))
        val failed = shadow.nextStartedActivityForResult
        activity.activityResultRegistry.dispatchResult(
            failed.requestCode, Activity.RESULT_OK, Intent().setData(brokenUri),
        )
        awaitExport { exportScript(activity).contains("ok:false,cancelled:false,fileName:\"failure.png\"") }
        assertTrue(stagedExports(activity).isEmpty())

        val uri = Uri.parse("content://test.documents/markdown")
        val output = ByteArrayOutputStream()
        shadowOf(activity.contentResolver).registerOutputStream(uri, output)
        assertTrue(activity.requestHistoryExport("# 笔记", "notes.md"))
        val markdown = shadow.nextStartedActivityForResult
        assertEquals("text/markdown", markdown.intent.type)
        assertFalse(activity.requestPngExport(PNG_BASE64, "busy.png"))
        activity.activityResultRegistry.dispatchResult(
            markdown.requestCode, Activity.RESULT_OK, Intent().setData(uri),
        )
        awaitExport { exportScript(activity).contains("ok:true") }
        assertEquals("# 笔记", output.toString("UTF-8"))
        assertTrue(stagedExports(activity).isEmpty())
        controller.pause().stop().destroy()
    }

    @Test
    fun recreationRestoresThePngPickerWithoutDeliveringToTheNewPage() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val original = controller.get()
        assertTrue(original.requestPngExport(PNG_BASE64, "recreated.png"))
        val picker = shadowOf(original).nextStartedActivityForResult
        val staged = stagedExports(original).single()

        val restored = controller.recreate().get()
        assertTrue(staged.isFile)
        assertFalse(restored.requestHistoryExport("{}", "busy.json"))
        val uri = Uri.parse("content://test.documents/recreated")
        val output = ByteArrayOutputStream()
        shadowOf(restored.contentResolver).registerOutputStream(uri, output)
        restored.activityResultRegistry.dispatchResult(
            picker.requestCode, Activity.RESULT_OK, Intent().setData(uri),
        )

        awaitExport { restored.requestHistoryExport("{}", "next.json") }
        assertArrayEquals(Base64.decode(PNG_BASE64, Base64.DEFAULT), output.toByteArray())
        assertFalse(staged.exists())
        assertNull(shadowOf(findWebView(restored.window.decorView)!!).lastEvaluatedJavascript)
        assertEquals("application/json", shadowOf(restored).nextStartedActivityForResult.intent.type)
        controller.pause().stop().destroy()
    }

    @Test
    fun aSlowPngWriteSurvivesRecreationAndReleasesTheReservationOnce() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val original = controller.get()
        val originalWebView = shadowOf(findWebView(original.window.decorView)!!)
        val uri = Uri.parse("content://test.documents/slow")
        val started = CountDownLatch(1)
        val resumeWrite = CountDownLatch(1)
        val opens = AtomicInteger()
        val output = ByteArrayOutputStream()
        shadowOf(original.contentResolver).registerOutputStreamSupplier(uri) {
            opens.incrementAndGet()
            started.countDown()
            check(resumeWrite.await(10, TimeUnit.SECONDS))
            output
        }
        assertTrue(original.requestPngExport(PNG_BASE64, "slow.png"))
        val picker = shadowOf(original).nextStartedActivityForResult
        val staged = stagedExports(original).single()
        try {
            val result = Intent().setData(uri)
            original.activityResultRegistry.dispatchResult(picker.requestCode, Activity.RESULT_OK, result)
            assertTrue("The provider must open off the main thread", started.await(5, TimeUnit.SECONDS))
            original.activityResultRegistry.dispatchResult(picker.requestCode, Activity.RESULT_OK, result)
            val restored = controller.recreate().get()
            assertTrue(staged.isFile)
            assertFalse(restored.requestHistoryExport("{}", "busy.json"))

            resumeWrite.countDown()
            awaitExport { restored.requestHistoryExport("{}", "next.json") }
            assertEquals(1, opens.get())
            assertArrayEquals(Base64.decode(PNG_BASE64, Base64.DEFAULT), output.toByteArray())
            assertFalse(staged.exists())
            assertNull(originalWebView.lastEvaluatedJavascript)
            assertNull(shadowOf(findWebView(restored.window.decorView)!!).lastEvaluatedJavascript)
            assertEquals("application/json", shadowOf(restored).nextStartedActivityForResult.intent.type)
        } finally {
            resumeWrite.countDown()
            controller.pause().stop().destroy()
        }
    }

    @Test
    fun aSlowPngWriteKeepsItsFileAfterTheActivityFinishes() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        val webView = shadowOf(findWebView(activity.window.decorView)!!)
        val uri = Uri.parse("content://test.documents/finish")
        val started = CountDownLatch(1)
        val resumeWrite = CountDownLatch(1)
        val output = ByteArrayOutputStream()
        shadowOf(activity.contentResolver).registerOutputStreamSupplier(uri) {
            started.countDown()
            check(resumeWrite.await(10, TimeUnit.SECONDS))
            output
        }
        assertTrue(activity.requestPngExport(PNG_BASE64, "finish.png"))
        val picker = shadowOf(activity).nextStartedActivityForResult
        val staged = stagedExports(activity).single()
        try {
            activity.activityResultRegistry.dispatchResult(
                picker.requestCode, Activity.RESULT_OK, Intent().setData(uri),
            )
            assertTrue("The provider must open off the main thread", started.await(5, TimeUnit.SECONDS))
            activity.finish()
            controller.pause().stop().destroy()
            assertTrue(staged.isFile)
        } finally {
            resumeWrite.countDown()
        }
        awaitExport { !staged.exists() }
        assertArrayEquals(Base64.decode(PNG_BASE64, Base64.DEFAULT), output.toByteArray())
        assertNull(webView.lastEvaluatedJavascript)
    }

    private fun awaitExport(condition: () -> Boolean) {
        val mainLooper = shadowOf(Looper.getMainLooper())
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        do {
            mainLooper.idle()
            if (condition()) return
            Thread.sleep(10)
        } while (System.nanoTime() < deadline)
        throw AssertionError("Timed out waiting for the document export")
    }

    private fun stagedExports(activity: MainActivity): List<File> =
        activity.cacheDir.listFiles().orEmpty().filter { it.name.startsWith("quareia-history-export-") }

    private fun exportScript(activity: MainActivity): String =
        shadowOf(findWebView(activity.window.decorView)!!).lastEvaluatedJavascript.orEmpty()

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
        const val PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3VcAAAAASUVORK5CYII="
    }
}
