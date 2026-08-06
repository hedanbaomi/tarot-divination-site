package com.quareia.divination

import android.app.Application
import android.os.Looper
import androidx.activity.ComponentActivity
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowDialog
import org.robolectric.shadows.ShadowToast

/**
 * End-to-end flow tests for [UpdateManager] with every external seam faked:
 * the network source, the downloader, the PackageManager metadata reader and
 * the installer launcher. All background work runs on a real executor thread
 * so "download must not run on the main thread" is verified for real.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class UpdateManagerTest {

    private lateinit var controller: org.robolectric.android.controller.ActivityController<ComponentActivity>
    private lateinit var activity: ComponentActivity
    private lateinit var fakeSource: FakeSource
    private lateinit var fakeDownloader: FakeDownloader
    private lateinit var fakeMetaReader: FakeMetaReader
    private lateinit var fakeInstaller: FakeInstaller
    private lateinit var pending: PendingUpdateStore

    @Before
    fun setUp() {
        UpdateManager.resetForTest()
        controller = Robolectric.buildActivity(ComponentActivity::class.java).setup()
        activity = controller.get()
        fakeSource = FakeSource(release(size = 1024))
        fakeDownloader = FakeDownloader()
        fakeMetaReader = FakeMetaReader(
            apkMeta = ApkMeta("com.quareia.divination", 3, listOf(SIGNER_A)),
            installed = InstalledApkMeta(2, listOf(SIGNER_A)),
        )
        fakeInstaller = FakeInstaller(canInstall = true)
        pending = PendingUpdateStore(activity.applicationContext)
        UpdateManager.testDependencies = UpdateDependencies(
            source = fakeSource,
            downloader = fakeDownloader,
            metaReader = fakeMetaReader,
            verifier = ApkVerifier(fakeMetaReader),
            installer = fakeInstaller,
            pending = pending,
            mainHandler = android.os.Handler(Looper.getMainLooper()),
            executor = Executors.newSingleThreadExecutor { runnable ->
                Thread(runnable, "quareia-update-test").apply { isDaemon = true }
            },
            ownsExecutor = false,
        )
    }

    @After
    fun tearDown() {
        UpdateManager.resetForTest()
        runCatching { controller.destroy() }
    }

    @Test
    fun downloadRunsOffTheMainThread() {
        val release = release(size = 1024)
        val latch = CountDownLatch(1)
        fakeDownloader.finishLatch = latch

        UpdateManager.downloadAndInstall(activity, release)

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        assertNotEquals("main", fakeDownloader.threadName.get())
        assertNotEquals(Looper.getMainLooper(), fakeDownloader.looper.get())
    }

    @Test
    fun checkRunsOffTheMainThread() {
        val latch = CountDownLatch(1)
        fakeSource.latch = latch
        fakeSource.result = release(size = 1024, tag = "v9.9.9")

        UpdateManager.checkAndPrompt(activity, manual = false)

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        assertNotEquals("main", fakeSource.threadName.get())
    }

    @Test
    fun silentCheckFailureShowsNoUi() {
        fakeSource.error = RuntimeException("network down")

        UpdateManager.checkAndPrompt(activity, manual = false)
        awaitSourceIdle()
        idleMainLooper()

        assertNull(ShadowToast.getTextOfLatestToast())
        assertNull(ShadowDialog.getLatestDialog())
    }

    @Test
    fun silentCheckAvailableShowsConfirmDialog() {
        fakeSource.result = release(size = 1024, tag = "v9.9.9")

        UpdateManager.checkAndPrompt(activity, manual = false)
        awaitSourceIdle()
        idleMainLooper()

        assertNotNull(ShadowDialog.getLatestDialog())
    }

    @Test
    fun manualCheckUpToDateShowsToast() {
        fakeSource.result = release(size = 1024, tag = "v1.0.0")

        UpdateManager.checkAndPrompt(activity, manual = true)
        awaitSourceIdle()
        idleMainLooper()

        assertEquals(
            activity.getString(R.string.update_up_to_date),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun manualCheckFailureShowsFailureToastNotUpToDate() {
        fakeSource.error = RuntimeException("boom")

        UpdateManager.checkAndPrompt(activity, manual = true)
        awaitSourceIdle()
        idleMainLooper()

        assertEquals(
            activity.getString(R.string.update_check_failed),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun duplicateChecksAreDeduplicated() {
        val gate = CountDownLatch(1)
        val calls = AtomicInteger()
        val blockingSource = object : UpdateSource {
            override fun fetchLatest(): ReleaseInfo {
                calls.incrementAndGet()
                gate.await(10, TimeUnit.SECONDS)
                return release(size = 1024, tag = "v9.9.9")
            }
        }
        UpdateManager.testDependencies = UpdateManager.testDependencies!!.let {
            UpdateDependencies(
                source = blockingSource,
                downloader = it.downloader,
                metaReader = it.metaReader,
                verifier = it.verifier,
                installer = it.installer,
                pending = it.pending,
                mainHandler = it.mainHandler,
                executor = it.executor,
                ownsExecutor = it.ownsExecutor,
            )
        }

        UpdateManager.checkAndPrompt(activity, manual = false)
        UpdateManager.checkAndPrompt(activity, manual = false)
        gate.countDown()
        awaitCondition { calls.get() >= 1 }
        idleMainLooper()

        assertEquals(1, calls.get())
    }

    @Test
    fun permissionGrantedLaunchesInstallerAndClearsPending() {
        val latch = CountDownLatch(1)
        fakeDownloader.finishLatch = latch

        UpdateManager.downloadAndInstall(activity, release(size = 1024))

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        idleMainLooper()

        assertEquals(1, fakeInstaller.launchedFiles.size)
        assertEquals(cachedApkFile().absolutePath, fakeInstaller.launchedFiles[0].absolutePath)
        assertTrue(cachedApkFile().isFile)
        assertNull(pending.load())
        assertEquals(
            activity.getString(R.string.update_install_ready),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun permissionDeniedKeepsPendingAndOpensSettings() {
        fakeInstaller.canInstall = false
        val latch = CountDownLatch(1)
        fakeDownloader.finishLatch = latch

        UpdateManager.downloadAndInstall(activity, release(size = 1024))

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        idleMainLooper()

        assertTrue(fakeInstaller.launchedFiles.isEmpty())
        assertNotNull(pending.load())
        assertEquals("v1.1.1", pending.load()!!.tagName)
        assertTrue(cachedApkFile().isFile)
        val started = shadowOf(activity.application as Application).nextStartedActivity
        assertNotNull(started)
        assertEquals(
            android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            started!!.action,
        )
    }

    @Test
    fun verificationFailureDeletesFileAndShowsSecurityToast() {
        fakeMetaReader.apkMeta = ApkMeta("com.evil.impersonator", 99, listOf(SIGNER_A))
        val latch = CountDownLatch(1)
        fakeDownloader.finishLatch = latch

        UpdateManager.downloadAndInstall(activity, release(size = 1024))

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        idleMainLooper()

        assertTrue(fakeInstaller.launchedFiles.isEmpty())
        assertNull(pending.load())
        assertFalse(cachedApkFile().exists())
        assertEquals(
            activity.getString(R.string.update_verification_failed),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun downloadFailureShowsFailureToastAndNoInstaller() {
        fakeDownloader.failNext = true
        val latch = CountDownLatch(1)
        fakeDownloader.finishLatch = latch

        UpdateManager.downloadAndInstall(activity, release(size = 1024))

        assertTrue(latch.await(10, TimeUnit.SECONDS))
        idleMainLooper()

        assertTrue(fakeInstaller.launchedFiles.isEmpty())
        assertEquals(
            activity.getString(R.string.update_download_failed),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun resumeWithPermissionInstallsVerifiedCachedApk() {
        val size = 512
        val digest = Sha256.hex(ByteArray(size))
        cachedApkFile().parentFile!!.mkdirs()
        cachedApkFile().writeBytes(ByteArray(size))
        pending.save("v1.1.1", "sha256:$digest", size.toLong())

        // flowFor registers the lifecycle observer; the activity is already
        // RESUMED, so ON_RESUME fires immediately and the pending install
        // continues without any user interaction.
        UpdateManager.flowFor(activity)
        idleMainLooperUntil { fakeInstaller.launchedFiles.isNotEmpty() }

        assertEquals(1, fakeInstaller.launchedFiles.size)
        assertNull(pending.load())
        assertEquals(
            activity.getString(R.string.update_install_ready),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun resumeWithoutPermissionDoesNotInstall() {
        val size = 512
        val digest = Sha256.hex(ByteArray(size))
        cachedApkFile().parentFile!!.mkdirs()
        cachedApkFile().writeBytes(ByteArray(size))
        pending.save("v1.1.1", "sha256:$digest", size.toLong())
        fakeInstaller.canInstall = false

        UpdateManager.flowFor(activity)

        idleMainLooper()
        assertTrue(fakeInstaller.launchedFiles.isEmpty())
        assertNotNull(pending.load())
    }

    @Test
    fun resumeAfterDeniedPermissionFeedbackAndKeepsPending() {
        fakeInstaller.canInstall = false
        val downloadLatch = CountDownLatch(1)
        fakeDownloader.finishLatch = downloadLatch
        UpdateManager.downloadAndInstall(activity, release(size = 1024))
        assertTrue(downloadLatch.await(10, TimeUnit.SECONDS))
        idleMainLooper()
        assertNotNull(pending.load())

        // The user returns from the system settings without granting.
        controller.pause()
        controller.resume()

        assertTrue(fakeInstaller.launchedFiles.isEmpty())
        assertNotNull(pending.load())
        assertEquals(
            activity.getString(R.string.update_permission_denied),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun resumeWithInvalidCachedFileClearsPendingAndNotifies() {
        val size = 512
        val digest = Sha256.hex(ByteArray(size))
        // Digest does not match the pending metadata -> file is invalid.
        cachedApkFile().parentFile!!.mkdirs()
        cachedApkFile().writeBytes(ByteArray(size) { 7 })
        pending.save("v1.1.1", "sha256:$digest", size.toLong())

        UpdateManager.flowFor(activity)
        idleMainLooperUntil { pending.load() == null }

        assertTrue(fakeInstaller.launchedFiles.isEmpty())
        assertFalse(cachedApkFile().exists())
        assertEquals(
            activity.getString(R.string.update_pending_invalid),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun resumeWithMissingFileClearsPendingAndNotifies() {
        pending.save("v1.1.1", "sha256:${"ab".repeat(32)}", 512L)

        UpdateManager.flowFor(activity)
        idleMainLooperUntil { pending.load() == null }

        assertTrue(fakeInstaller.launchedFiles.isEmpty())
        assertEquals(
            activity.getString(R.string.update_pending_invalid),
            ShadowToast.getTextOfLatestToast(),
        )
    }

    @Test
    fun activityDestructionDeletesPartFile() {
        UpdateManager.flowFor(activity)
        val part = File(activity.filesDir, "updates/quareia-update.apk.part")
        part.parentFile!!.mkdirs()
        part.writeText("partial download")

        controller.destroy()

        assertFalse(part.exists())
    }

    // --- helpers -----------------------------------------------------------

    private fun cachedApkFile(): File =
        File(activity.filesDir, "updates/quareia-update.apk")

    private fun idleMainLooper() {
        shadowOf(Looper.getMainLooper()).idle()
    }

    /** Idles the main looper until [condition] holds (posted tasks only run when it idles). */
    private fun idleMainLooperUntil(timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            idleMainLooper()
            if (System.currentTimeMillis() > deadline) {
                throw AssertionError("condition not met within ${timeoutMs}ms")
            }
            Thread.sleep(20)
        }
        idleMainLooper()
    }

    private fun awaitSourceIdle() {
        awaitCondition { fakeSource.calls.get() >= 1 }
    }

    private fun awaitCondition(timeoutMs: Long = 10_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!condition()) {
            if (System.currentTimeMillis() > deadline) {
                throw AssertionError("condition not met within ${timeoutMs}ms")
            }
            Thread.sleep(20)
        }
    }

    private fun release(size: Int, tag: String = "v1.1.1"): ReleaseInfo {
        val digest = Sha256.hex(ByteArray(size))
        return ReleaseInfo(
            tagName = tag,
            assetName = "QuareiaDivination-v${tag.removePrefix("v")}.apk",
            downloadUrl = "https://github.com/hedanbaomi/tarot-divination-site/releases/download/$tag/" +
                "QuareiaDivination-v${tag.removePrefix("v")}.apk",
            sizeBytes = size.toLong(),
            contentType = "application/vnd.android.package-archive",
            sha256Digest = "sha256:$digest",
        )
    }

    private companion object {
        const val SIGNER_A = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1"
    }

    private class FakeSource(
        var result: ReleaseInfo?,
        var error: Throwable? = null,
        val calls: AtomicInteger = AtomicInteger(),
        val threadName: AtomicReference<String> = AtomicReference(),
        var latch: CountDownLatch? = null,
    ) : UpdateSource {
        override fun fetchLatest(): ReleaseInfo {
            calls.incrementAndGet()
            threadName.set(Thread.currentThread().name)
            latch?.countDown()
            error?.let { throw it }
            return result!!
        }
    }

    private class FakeDownloader(
        var failNext: Boolean = false,
        val calls: AtomicInteger = AtomicInteger(),
        val threadName: AtomicReference<String> = AtomicReference(),
        val looper: AtomicReference<Looper?> = AtomicReference(),
        var finishLatch: CountDownLatch? = null,
    ) : ApkDownloader {
        override fun download(
            release: ReleaseInfo,
            partFile: File,
            destination: File,
            cancelled: () -> Boolean,
            onProgress: (DownloadProgress) -> Unit,
        ): File? {
            calls.incrementAndGet()
            threadName.set(Thread.currentThread().name)
            looper.set(Looper.myLooper())
            if (failNext) {
                finishLatch?.countDown()
                return null
            }
            val bytes = ByteArray(release.sizeBytes.toInt())
            onProgress(DownloadProgress(release.sizeBytes, bytes.size.toLong()))
            if (cancelled()) {
                finishLatch?.countDown()
                return null
            }
            partFile.parentFile?.mkdirs()
            partFile.writeBytes(bytes)
            if (!partFile.renameTo(destination)) {
                partFile.copyTo(destination, overwrite = true)
                partFile.delete()
            }
            finishLatch?.countDown()
            return destination
        }
    }

    private class FakeMetaReader(
        var apkMeta: ApkMeta?,
        var installed: InstalledApkMeta,
    ) : ApkMetaReader {
        override fun readApk(path: String): ApkMeta? = apkMeta

        override fun installedMeta(): InstalledApkMeta = installed
    }

    private class FakeInstaller(
        var canInstall: Boolean = true,
        var launchResult: Boolean = true,
        val launchedFiles: MutableList<File> = mutableListOf(),
    ) : InstallerLauncher {
        override fun canInstallUnknownSources(): Boolean = canInstall

        override fun launchInstaller(apk: File): Boolean {
            launchedFiles.add(apk)
            return launchResult
        }
    }
}
