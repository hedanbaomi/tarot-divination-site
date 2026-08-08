package com.quareia.divination

import android.app.Application
import android.os.Looper
import androidx.activity.ComponentActivity
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
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
import org.robolectric.shadows.ShadowDialog

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class AnnouncementPrompterTest {

    private lateinit var application: Application
    private lateinit var activity: ComponentActivity
    private lateinit var controller: org.robolectric.android.controller.ActivityController<ComponentActivity>

    @Before
    fun setUp() {
        application = RuntimeEnvironment.getApplication()
        AnnouncementController.init(application)
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
        UpdateManager.resetForTest()
        ShadowDialog.reset()
        controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        activity = controller.get()
    }

    @After
    fun tearDown() {
        AnnouncementController.resetForTesting()
        AnnouncementsStore.resetForTesting()
        UpdateManager.resetForTest()
        ShadowDialog.reset()
        runCatching { controller.destroy() }
    }

    @Test
    fun unreadImportantAnnouncementShowsDialogAndIsMarkedRead() {
        val prompter = AnnouncementPrompter(activity)
        prompter.onAnnouncements(
            listOf(
                announcement(
                    1,
                    revision = 1,
                    severity = "important",
                    title = "重要标题",
                    body = "重要正文",
                )
            )
        )

        val dialog = latestThemedDialog()
        assertEquals("重要标题", dialog.titleTextView.text.toString())
        assertEquals("重要正文", dialog.bodyTextView.text.toString())
        assertEquals(
            AppLocale.contextFor(activity).getString(R.string.announcement_dialog_severity_important),
            dialog.severityTextView.text.toString(),
        )
        assertNull(dialog.primaryActionView)
        assertTrue(dialog.laterActionView.minimumHeight >= dp(48))
        assertTrue(AnnouncementController.isRead(1, 1))
    }

    @Test
    fun updateAnnouncementCreatesThemedDialogWithLocalizedSeverityAndContent() {
        AnnouncementPrompter(activity).onAnnouncements(
            listOf(
                announcement(
                    1,
                    revision = 1,
                    severity = "update",
                    title = "更新标题",
                    body = "更新正文",
                    button = "立即检查",
                )
            )
        )

        val dialog = latestThemedDialog()
        assertEquals("更新标题", dialog.titleTextView.text.toString())
        assertEquals("更新正文", dialog.bodyTextView.text.toString())
        assertEquals(
            AppLocale.contextFor(activity).getString(R.string.announcement_dialog_severity_update),
            dialog.severityTextView.text.toString(),
        )
        assertEquals("立即检查", dialog.primaryActionView?.text?.toString())
        assertTrue(dialog.primaryActionView!!.minimumHeight >= dp(48))
    }

    @Test
    fun alreadyReadAnnouncementIsNotShownAgain() {
        AnnouncementController.markRead(1, 1)
        val prompter = AnnouncementPrompter(activity)
        prompter.onAnnouncements(listOf(announcement(1, revision = 1, severity = "important")))

        assertNull(ShadowDialog.getLatestDialog())
    }

    @Test
    fun revisedAnnouncementIsShownAgain() {
        AnnouncementController.markRead(1, 1)
        val prompter = AnnouncementPrompter(activity)
        prompter.onAnnouncements(listOf(announcement(1, revision = 2, severity = "important")))

        assertNotNull(ShadowDialog.getLatestDialog())
        // The old revision stays read; the new revision is marked read too.
        assertTrue(AnnouncementController.isRead(1, 1))
        assertTrue(AnnouncementController.isRead(1, 2))
    }

    @Test
    fun activityRecreationDoesNotRepeatAnAlreadyDisplayedRevision() {
        val item = announcement(1, revision = 1, severity = "important")
        AnnouncementPrompter(activity).onAnnouncements(listOf(item))
        assertNotNull(ShadowDialog.getLatestDialog())

        controller.destroy()
        ShadowDialog.reset()
        controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        activity = controller.get()
        AnnouncementPrompter(activity).onAnnouncements(listOf(item))

        assertNull(ShadowDialog.getLatestDialog())
        assertTrue(AnnouncementController.isRead(1, 1))
    }

    @Test
    fun infoAnnouncementsNeverPopUpAndStayUnread() {
        val prompter = AnnouncementPrompter(activity)
        prompter.onAnnouncements(listOf(announcement(1, revision = 1, severity = "info")))

        assertNull(ShadowDialog.getLatestDialog())
        assertFalse(AnnouncementController.isRead(1, 1))
    }

    @Test
    fun updateAnnouncementActionReusesTheUpdateManager() {
        installUpdateManagerFakes()
        val prompter = AnnouncementPrompter(activity)
        prompter.onAnnouncements(listOf(announcement(1, revision = 1, severity = "update")))

        val dialog = latestThemedDialog()
        assertTrue(AnnouncementController.isRead(1, 1))

        dialog.primaryActionView!!.performClick()
        // UpdateManager.checkAndPrompt(manual = true) runs on its own executor;
        // give it time, then let the main looper process the posted UI work.
        assertTrue(sourceFetch.await(5, TimeUnit.SECONDS))
        shadowOf(Looper.getMainLooper()).idle()
        shadowOf(Looper.getMainLooper()).idle()

        // The update check completed and showed the update prompt.
        assertNotNull(ShadowDialog.getLatestDialog())
    }

    @Test
    fun laterActionDismissesTheThemedDialog() {
        AnnouncementPrompter(activity).onAnnouncements(
            listOf(announcement(1, severity = "important"))
        )

        val dialog = latestThemedDialog()
        assertTrue(dialog.isShowing)
        dialog.laterActionView.performClick()

        assertFalse(dialog.isShowing)
    }

    @Test
    fun destroyedActivityNeverShowsADialog() {
        controller.destroy()
        val prompter = AnnouncementPrompter(activity)
        prompter.onAnnouncements(listOf(announcement(1, revision = 1, severity = "important")))

        assertNull(ShadowDialog.getLatestDialog())
        assertFalse(AnnouncementController.isRead(1, 1))
    }

    @Test
    fun stoppedActivityDoesNotShowOrMarkAnnouncementRead() {
        controller.pause().stop()
        val prompter = AnnouncementPrompter(activity)
        prompter.onAnnouncements(listOf(announcement(1, revision = 1, severity = "important")))

        assertNull(ShadowDialog.getLatestDialog())
        assertFalse(AnnouncementController.isRead(1, 1))
    }

    @Test
    fun httpsActionUrlOpensTheSystemBrowser() {
        val prompter = AnnouncementPrompter(activity)
        prompter.onAnnouncements(
            listOf(
                announcement(
                    2,
                    revision = 1,
                    severity = "important",
                    button = "访问网站",
                    actionUrl = "https://quareia.com",
                )
            )
        )
        val dialog = latestThemedDialog()
        assertEquals("访问网站", dialog.primaryActionView?.text?.toString())
        dialog.primaryActionView!!.performClick()
        val started = shadowOf(activity).nextStartedActivity
        assertNotNull(started)
        assertEquals("android.intent.action.VIEW", started!!.action)
        assertEquals("https", started.data?.scheme)
    }

    @Test
    fun nonHttpsActionDoesNotCreateAnExecutableButton() {
        AnnouncementPrompter(activity).onAnnouncements(
            listOf(
                announcement(
                    1,
                    severity = "important",
                    button = "不安全链接",
                    actionUrl = "http://example.com",
                )
            )
        )

        val dialog = latestThemedDialog()
        assertNull(dialog.primaryActionView)
        assertNull(shadowOf(activity).nextStartedActivity)
    }

    private val sourceFetch = CountDownLatch(1)

    private fun installUpdateManagerFakes() {
        val metaReader = object : ApkMetaReader {
            override fun readApk(path: String): ApkMeta? =
                ApkMeta("com.quareia.divination", 4, listOf(SIGNER))

            override fun installedMeta(): InstalledApkMeta =
                InstalledApkMeta(4, listOf(SIGNER))
        }
        val source = object : UpdateSource {
            override fun fetchLatest(): ReleaseInfo? {
                sourceFetch.countDown()
                return ReleaseInfo(
                    tagName = "v9.9.9",
                    assetName = "QuareiaDivination-v9.9.9.apk",
                    downloadUrl = "https://github.com/hedanbaomi/tarot-divination-site/releases/download/v9.9.9/QuareiaDivination-v9.9.9.apk",
                    sizeBytes = 1024,
                    contentType = "application/vnd.android.package-archive",
                    sha256Digest = "sha256:${"ab".repeat(32)}",
                )
            }
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
    private fun latestThemedDialog(): ThemedAnnouncementDialog {
        val dialog = ShadowDialog.getLatestDialog()
        assertNotNull(dialog)
        assertTrue(dialog is ThemedAnnouncementDialog)
        return dialog as ThemedAnnouncementDialog
    }

    private fun dp(value: Int): Int =
        (value * activity.resources.displayMetrics.density + 0.5f).toInt()

    private fun announcement(
        id: Long,
        revision: Int = 1,
        severity: String = "info",
        title: String = "标题",
        body: String = "正文",
        button: String = "",
        actionUrl: String = "",
    ): Announcement = Announcement(
        id = id,
        revision = revision,
        severity = severity,
        title = title,
        body = body,
        button = button,
        actionUrl = actionUrl,
    )

    private companion object {
        const val SIGNER = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
    }
}
