package com.quareia.divination

import android.app.AlertDialog
import android.app.Application
import android.app.Dialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog
import org.robolectric.shadows.ShadowToast

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class ThemedUpdateDialogTest {

    private lateinit var application: Application
    private lateinit var controller: org.robolectric.android.controller.ActivityController<ComponentActivity>
    private lateinit var activity: ComponentActivity

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
        clearUiPreferences()
        AnnouncementController.init(application)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
        AnnouncementController.setFetcherForTesting { """{"announcements":[],"locale":"zh-CN"}""" }
        UpdateManager.resetForTest()
        ShadowDialog.reset()
        ShadowToast.reset()
        controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        activity = controller.get()
    }

    @After
    fun tearDown() {
        AnnouncementController.awaitIdleForTesting()
        AnnouncementController.setFetcherForTesting(null)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
        UpdateManager.resetForTest()
        ShadowDialog.reset()
        ShadowToast.reset()
        clearUiPreferences()
        runCatching { controller.destroy() }
    }

    @Test
    fun appThemeMapsWebChromeColorsAndRejectsUnknownValues() {
        assertEquals(ThemeId.CELESTIAL, AppTheme.currentId(application))
        assertEquals(ThemeId.GROVE, AppTheme.recordFromChromeColor(application, "#31483c", false))
        assertEquals(ThemeId.GROVE, AppTheme.currentId(application))
        assertEquals(ThemeId.PARCHMENT, AppTheme.recordFromChromeColor(application, "#efe4cc", true))
        assertEquals(ThemeId.EMBER, AppTheme.recordFromChromeColor(application, "#140a08", false))
        assertEquals(ThemeId.CELESTIAL, AppTheme.recordFromChromeColor(application, "#123456", false))
    }

    @Test
    fun releaseNotesFormatterStripsGenericHeaderAndFormatsNestedBulletsAsPlainText() {
        val raw = """
            ## 更新内容
            - 优化「密林祭坛」主题视觉表现：
              - 交互按键升级为立体描金边框。
              - 塔罗牌背升级为 `墨玉` 双金线。
        """.trimIndent()

        val formatted = ReleaseNotesFormatter.toPlainText(raw)
        assertFalse(formatted.contains("##"))
        assertTrue(formatted.contains("• 优化「密林祭坛」主题视觉表现："))
        assertTrue(formatted.contains("  ◦ 交互按键升级为立体描金边框。"))
        assertTrue(formatted.contains("  ◦ 塔罗牌背升级为 墨玉 双金线。"))

        val jsonWithNullBody = """
            {
              "tag_name": "v1.5.0",
              "draft": false,
              "prerelease": false,
              "body": null,
              "assets": [{
                "name": "QuareiaDivination-v1.5.0.apk",
                "size": 23167206,
                "digest": "sha256:${"ab".repeat(32)}",
                "browser_download_url": "https://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.5.0/QuareiaDivination-v1.5.0.apk",
                "content_type": "application/vnd.android.package-archive"
              }]
            }
        """.trimIndent()
        val parsed = ReleaseJsonParser.parse(jsonWithNullBody)
        assertEquals("", parsed.releaseNotes)
    }

    @Test
    fun updateDialogAdaptsPaletteAcrossAllFourThemesAndNeverUsesSystemAlertDialog() {
        val release = sampleRelease(notes = "• 新增主题化更新下载界面")
        for (themeId in ThemeId.entries) {
            AppTheme.set(application, themeId)
            val dialog = ThemedUpdateDialog(activity)
            dialog.showAvailable(
                release = release,
                currentVersionName = "1.4.2",
                onConfirm = {},
                onLater = { dialog.dismiss() },
            )

            val latestAsDialog: Dialog = ShadowDialog.getLatestDialog()
            assertFalse(latestAsDialog is AlertDialog)
            assertEquals(themeId, dialog.palette.id)
            assertEquals(ThemedUpdateDialog.State.AVAILABLE, dialog.state)
            assertEquals("22.1 MB", dialog.badgeTextView.text.toString())
            assertTrue(dialog.versionBannerView.text.toString().contains("1.4.2"))
            assertTrue(dialog.versionBannerView.text.toString().contains("v1.5.0"))
            assertTrue(dialog.notesTextView.text.toString().contains("新增主题化更新下载界面"))

            if (themeId == ThemeId.GROVE) {
                assertEquals(Color.rgb(0xE2, 0xC2, 0x70), dialog.palette.cardBorder)
                assertEquals(Color.rgb(0xF7, 0xE4, 0xA6), dialog.palette.primaryBtnBorder)
            } else if (themeId == ThemeId.PARCHMENT) {
                assertTrue(dialog.palette.isLight)
                assertEquals(Color.rgb(0x2A, 0x24, 0x18), dialog.titleTextView.currentTextColor)
            }

            // Render custom progress bar onto a real Bitmap Canvas to verify drawing math.
            dialog.showDownloading(release) {}
            dialog.updateDownloadProgress(
                DownloadProgress(totalBytes = release.sizeBytes, downloadedBytes = release.sizeBytes / 2),
            )
            assertEquals("50%", dialog.percentTextView.text.toString())
            assertEquals("11.0 MB / 22.1 MB", dialog.bytesTextView.text.toString())
            dialog.progressBarView.measure(
                View.MeasureSpec.makeMeasureSpec(300, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(24, View.MeasureSpec.EXACTLY),
            )
            dialog.progressBarView.layout(0, 0, 300, 24)
            val bmp = Bitmap.createBitmap(300, 24, Bitmap.Config.ARGB_8888)
            dialog.progressBarView.draw(Canvas(bmp))

            dialog.dismiss()
        }
    }

    @Test
    fun manualCheckTransitionsInPlaceFromCheckingToAvailableToDownloadingAndSupportsCancel() {
        AppLocale.set(application, "zh-CN")
        AppTheme.set(application, ThemeId.GROVE)

        val checkGate = CountDownLatch(1)
        val downloadStarted = CountDownLatch(1)
        val allowDownloadFinish = CountDownLatch(1)
        val sawCancelled = AtomicBoolean(false)
        val targetRelease = sampleRelease(notes = "• 支持同卡片内平滑切换下载进度")

        installUpdateDependencies(
            source = UpdateSource {
                checkGate.await(5, TimeUnit.SECONDS)
                targetRelease
            },
            downloader = object : ApkDownloader {
                override fun download(
                    release: ReleaseInfo,
                    partFile: File,
                    destination: File,
                    cancelled: () -> Boolean,
                    onProgress: (DownloadProgress) -> Unit,
                ): File? {
                    partFile.parentFile?.mkdirs()
                    partFile.writeBytes(ByteArray(64))
                    onProgress(DownloadProgress(release.sizeBytes, release.sizeBytes / 4))
                    downloadStarted.countDown()
                    allowDownloadFinish.await(5, TimeUnit.SECONDS)
                    if (cancelled()) {
                        sawCancelled.set(true)
                        partFile.delete()
                        return null
                    }
                    return destination
                }
            },
        )

        UpdateManager.checkAndPrompt(activity, manual = true)
        val checkingDialog = ShadowDialog.getLatestDialog() as ThemedUpdateDialog
        assertEquals(ThemedUpdateDialog.State.CHECKING, checkingDialog.state)
        assertEquals(ThemeId.GROVE, checkingDialog.palette.id)

        checkGate.countDown()
        idleUntil { checkingDialog.state == ThemedUpdateDialog.State.AVAILABLE }
        // Same window transitioned in-place without flashing a second Dialog.
        assertSame(checkingDialog, ShadowDialog.getLatestDialog())
        assertEquals(View.VISIBLE, checkingDialog.primaryActionView.visibility)

        // Tap "立即更新" -> transitions the same dialog into DOWNLOADING.
        checkingDialog.primaryActionView.performClick()
        assertEquals(ThemedUpdateDialog.State.DOWNLOADING, checkingDialog.state)
        assertTrue(downloadStarted.await(5, TimeUnit.SECONDS))
        idleMainLooper()
        assertEquals("25%", checkingDialog.percentTextView.text.toString())

        // Tap "取消下载" -> cancels cleanly, dismisses dialog, shows cancel toast (not failure).
        checkingDialog.secondaryActionView.performClick()
        allowDownloadFinish.countDown()
        idleUntil { sawCancelled.get() }
        idleMainLooper()

        assertFalse(checkingDialog.isShowing)
        assertFalse(File(activity.filesDir, "updates/quareia-update.apk.part").exists())
        assertEquals(
            AppLocale.contextFor(activity).getString(R.string.update_download_cancelled),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun aboutAndAnnouncementsScreensFollowPersistedUserTheme() {
        AppLocale.set(application, "zh-CN")
        AppTheme.set(application, ThemeId.PARCHMENT)
        val parchmentPalette = AppTheme.palette(ThemeId.PARCHMENT)

        val about = Robolectric.buildActivity(AboutActivity::class.java).setup().get()
        assertTrue(
            WindowCompat.getInsetsController(about.window, about.window.decorView)
                .isAppearanceLightStatusBars
        )
        val aboutTitle = findTextViewWithText(
            about.window.decorView,
            AppLocale.contextFor(application).getString(R.string.about_title),
        )
        assertEquals(parchmentPalette.textPrimary, aboutTitle?.currentTextColor)

        val announcements = Robolectric.buildActivity(AnnouncementsActivity::class.java).setup().get()
        assertTrue(AnnouncementController.awaitIdleForTesting())
        idleMainLooper()
        val announcementsTitle = findTextViewWithText(
            announcements.window.decorView,
            AppLocale.contextFor(application).getString(R.string.announcements_title),
        )
        assertEquals(parchmentPalette.textPrimary, announcementsTitle?.currentTextColor)
    }

    private fun findTextViewWithText(view: View, expected: String): TextView? {
        if (view is TextView && view.text.toString() == expected) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findTextViewWithText(view.getChildAt(i), expected)?.let { return it }
            }
        }
        return null
    }

    private fun clearUiPreferences() {
        application.getSharedPreferences(AppLocale.PREFS, Context.MODE_PRIVATE)
            .edit()
            .clear()
            .commit()
    }

    private fun installUpdateDependencies(
        source: UpdateSource,
        downloader: ApkDownloader,
    ) {
        val metaReader = object : ApkMetaReader {
            override fun readApk(path: String): ApkMeta =
                ApkMeta("com.quareia.divination", 11, listOf(SIGNER))

            override fun installedMeta(): InstalledApkMeta =
                InstalledApkMeta(10, listOf(SIGNER))
        }
        UpdateManager.testDependencies = UpdateDependencies(
            source = source,
            downloader = downloader,
            metaReader = metaReader,
            verifier = ApkVerifier(metaReader),
            installer = object : InstallerLauncher {
                override fun canInstallUnknownSources(): Boolean = true
                override fun launchInstaller(apk: File): Boolean = true
            },
            pending = PendingUpdateStore(application),
            mainHandler = android.os.Handler(Looper.getMainLooper()),
            executor = Executors.newSingleThreadExecutor { r ->
                Thread(r, "quareia-themed-update-test").apply { isDaemon = true }
            },
            ownsExecutor = false,
        )
    }

    private fun idleMainLooper() {
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun idleUntil(timeoutMs: Long = 5_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            idleMainLooper()
            if (System.currentTimeMillis() > deadline) {
                throw AssertionError("Condition not met within " + timeoutMs + "ms")
            }
            Thread.sleep(20)
        }
        idleMainLooper()
    }

    private fun sampleRelease(notes: String): ReleaseInfo {
        val size = 23_167_206L
        return ReleaseInfo(
            tagName = "v1.5.0",
            assetName = "QuareiaDivination-v1.5.0.apk",
            downloadUrl = "https://github.com/hedanbaomi/tarot-divination-site/releases/download/v1.5.0/QuareiaDivination-v1.5.0.apk",
            sizeBytes = size,
            contentType = "application/vnd.android.package-archive",
            sha256Digest = "sha256:${"ab".repeat(32)}",
            releaseNotes = notes,
        )
    }

    private companion object {
        const val SIGNER = "8ddb65a97a45865cca0f53748e85fad6a880efb30b10865239ea3c0cb67a9505"
    }
}
