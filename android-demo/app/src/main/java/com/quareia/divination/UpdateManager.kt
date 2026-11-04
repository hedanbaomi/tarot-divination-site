package com.quareia.divination

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import java.io.File
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * Drives the in-app update flow end to end: check GitHub Releases, present the
 * custom theme-matched update card, download the APK into app-private storage
 * with live progress and cancellation support, verify it completely (size,
 * SHA-256, package parse, package name, versionCode and signer certificate),
 * then hand it to the system installer.
 *
 * Threading and lifecycle:
 *  - every network and file operation runs on a single background executor;
 *  - all custom dialogs, toasts, progress updates and the installer launch are
 *    posted to the main thread;
 *  - one [UpdateFlow] is bound to one activity via a [LifecycleEventObserver];
 *    when the activity is destroyed the flow is cancelled, any open dialog is
 *    dismissed, any `.part` file is deleted and no UI on the old window is
 *    touched afterwards;
 *  - a token-scoped active-operation guard rejects duplicate checks/downloads
 *    while letting user cancellation release the lock immediately.
 */
internal object UpdateManager {

    internal const val UPDATE_DIR = "updates"
    internal const val UPDATE_FILE_NAME = "quareia-update.apk"
    internal const val PREFS_KEY = "quareia_update"
    internal const val KEY_LAST_PROMPTED_VERSION = "last_prompted_version"
    internal const val KEY_PENDING_TAG = "pending_tag"
    internal const val KEY_PENDING_SHA256 = "pending_sha256"
    internal const val KEY_PENDING_SIZE = "pending_size"
    internal const val EXPECTED_PACKAGE_NAME = "com.quareia.divination"

    @Volatile
    internal var testDependencies: UpdateDependencies? = null

    private val flows: MutableMap<ComponentActivity, UpdateFlow> =
        Collections.synchronizedMap(WeakHashMap())

    internal fun checkAndPrompt(activity: ComponentActivity, manual: Boolean) {
        flowFor(activity).checkAndPrompt(manual)
    }

    internal fun downloadAndInstall(activity: ComponentActivity, release: ReleaseInfo) {
        flowFor(activity).downloadAndInstall(release)
    }

    internal fun flowFor(activity: ComponentActivity): UpdateFlow =
        synchronized(flows) {
            flows[activity] ?: UpdateFlow(
                activity,
                testDependencies ?: UpdateDependencies.defaults(activity),
            ).also { flows[activity] = it }
        }

    internal fun removeFlow(activity: ComponentActivity) {
        synchronized(flows) { flows.remove(activity) }
    }

    /** Test-only reset: stops every tracked flow and drops injected deps. */
    internal fun resetForTest() {
        synchronized(flows) {
            flows.values.forEach { it.forceStop() }
            flows.clear()
        }
        testDependencies = null
    }
}

/** Everything an update flow needs; every member is injectable in tests. */
internal class UpdateDependencies(
    val source: UpdateSource,
    val downloader: ApkDownloader,
    val metaReader: ApkMetaReader,
    val verifier: ApkVerifier,
    val installer: InstallerLauncher,
    val pending: PendingUpdateStore,
    val mainHandler: Handler,
    val executor: ExecutorService,
    val ownsExecutor: Boolean = false,
) {
    companion object {
        fun defaults(activity: ComponentActivity): UpdateDependencies {
            val reader = PackageManagerApkMetaReader(activity)
            return UpdateDependencies(
                source = GithubUpdateSource(UrlConnectionTransport()),
                downloader = HttpApkDownloader(UrlConnectionTransport()),
                metaReader = reader,
                verifier = ApkVerifier(reader),
                installer = AndroidInstallerLauncher(activity),
                pending = PendingUpdateStore(activity.applicationContext),
                mainHandler = Handler(Looper.getMainLooper()),
                executor = Executors.newSingleThreadExecutor { runnable ->
                    Thread(runnable, "quareia-update").apply { isDaemon = true }
                },
                ownsExecutor = true,
            )
        }
    }
}

/** Platform seam for "can the system installer be launched / permission present". */
internal interface InstallerLauncher {
    fun canInstallUnknownSources(): Boolean

    /** Starts the system installer for [apk]; false when no handler exists. */
    fun launchInstaller(apk: File): Boolean
}

internal class AndroidInstallerLauncher(
    private val activity: ComponentActivity,
) : InstallerLauncher {

    override fun canInstallUnknownSources(): Boolean =
        Build.VERSION.SDK_INT < 26 || activity.packageManager.canRequestPackageInstalls()

    override fun launchInstaller(apk: File): Boolean = try {
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.updatefileprovider",
            apk,
        )
        activity.startActivity(
            Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        )
        true
    } catch (_: Throwable) {
        false
    }
}

/** Persists the verified-but-not-yet-installed update across resumes/restarts. */
internal class PendingUpdateStore(context: Context) {

    private val prefs =
        context.getSharedPreferences(UpdateManager.PREFS_KEY, Context.MODE_PRIVATE)

    fun save(tagName: String, sha256Digest: String, sizeBytes: Long) {
        prefs.edit()
            .putString(UpdateManager.KEY_PENDING_TAG, tagName)
            .putString(UpdateManager.KEY_PENDING_SHA256, sha256Digest)
            .putLong(UpdateManager.KEY_PENDING_SIZE, sizeBytes)
            .apply()
    }

    fun load(): PendingUpdate? {
        val tag = prefs.getString(UpdateManager.KEY_PENDING_TAG, null)
            ?.takeIf { it.isNotBlank() } ?: return null
        val sha256 = prefs.getString(UpdateManager.KEY_PENDING_SHA256, null) ?: return null
        val size = prefs.getLong(UpdateManager.KEY_PENDING_SIZE, -1L)
        if (size <= 0) return null
        return PendingUpdate(tag, sha256, size)
    }

    fun clear() {
        prefs.edit()
            .remove(UpdateManager.KEY_PENDING_TAG)
            .remove(UpdateManager.KEY_PENDING_SHA256)
            .remove(UpdateManager.KEY_PENDING_SIZE)
            .apply()
    }

    fun wasPrompted(tagName: String): Boolean =
        prefs.getString(UpdateManager.KEY_LAST_PROMPTED_VERSION, null) == tagName

    fun rememberPrompted(tagName: String) {
        prefs.edit().putString(UpdateManager.KEY_LAST_PROMPTED_VERSION, tagName).apply()
    }

    data class PendingUpdate(
        val tagName: String,
        val sha256Digest: String,
        val sizeBytes: Long,
    )
}

/** Reads package metadata through PackageManager, compatible with API 24-36. */
internal class PackageManagerApkMetaReader(private val context: Context) : ApkMetaReader {

    override fun readApk(path: String): ApkMeta? {
        return try {
            val flags = if (Build.VERSION.SDK_INT >= 28) {
                PackageManager.GET_SIGNING_CERTIFICATES
            } else {
                PackageManager.GET_SIGNATURES or PackageManager.GET_ACTIVITIES
            }
            val info = context.packageManager.getPackageArchiveInfo(path, flags) ?: return null
            val packageName = info.packageName ?: return null
            val versionCode = packageVersionCode(info)
            val signers = signerDigests(info)
            if (packageName.isBlank() || versionCode < 0 || signers.isEmpty()) return null
            ApkMeta(packageName, versionCode, signers)
        } catch (_: Throwable) {
            null
        }
    }

    override fun installedMeta(): InstalledApkMeta = try {
        val flags = if (Build.VERSION.SDK_INT >= 28) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        val info = context.packageManager.getPackageInfo(context.packageName, flags)
        InstalledApkMeta(
            versionCode = packageVersionCode(info),
            signerSha256 = signerDigests(info).distinct(),
        )
    } catch (_: Throwable) {
        InstalledApkMeta(-1, emptyList())
    }

    @Suppress("DEPRECATION")
    private fun packageVersionCode(info: PackageInfo): Int =
        if (Build.VERSION.SDK_INT >= 28) info.longVersionCode.toInt() else info.versionCode

    @Suppress("DEPRECATION")
    private fun signerDigests(info: PackageInfo): List<String> =
        if (Build.VERSION.SDK_INT >= 28) {
            val signingInfo = info.signingInfo ?: return emptyList()
            val digests = mutableListOf<String>()
            signingInfo.apkContentsSigners?.let { signers ->
                digests += signers.map { it.sha256Hex() }
            }
            if (signingInfo.hasPastSigningCertificates()) {
                signingInfo.signingCertificateHistory?.let { history ->
                    digests += history.map { it.sha256Hex() }
                }
            }
            digests
        } else {
            info.signatures?.map { it.sha256Hex() }.orEmpty()
        }

    private fun Signature.sha256Hex(): String = Sha256.hex(toByteArray())
}

/**
 * One update flow bound to one [ComponentActivity]. Created by
 * [UpdateManager.flowFor] and stopped by the activity lifecycle.
 */
internal class UpdateFlow(
    private val activity: ComponentActivity,
    private val deps: UpdateDependencies,
) {

    private val activeOp = AtomicReference<Any?>(null)
    private val cancelled = AtomicBoolean(false)
    private val waitingForPermission = AtomicBoolean(false)
    private var activeDialog: ThemedUpdateDialog? = null

    private val observer = LifecycleEventObserver { _, event ->
        when (event) {
            Lifecycle.Event.ON_RESUME -> onResume()
            Lifecycle.Event.ON_DESTROY -> onDestroy()
            else -> {}
        }
    }

    init {
        activity.lifecycle.addObserver(observer)
    }

    private val isDead: Boolean
        get() = activity.isDestroyed || activity.isFinishing

    private val updateDir: File
        get() = File(activity.filesDir, UpdateManager.UPDATE_DIR)

    private val apkFile: File
        get() = File(updateDir, UpdateManager.UPDATE_FILE_NAME)

    private val partFile: File
        get() = File(updateDir, UpdateManager.UPDATE_FILE_NAME + ".part")

    /**
     * Checks for an update and reacts. Manual checks show a custom themed
     * checking card and always give feedback ("up to date" vs "check failed");
     * silent startup checks only surface a genuinely newer release.
     */
    internal fun checkAndPrompt(manual: Boolean) {
        val opToken = Any()
        if (!activeOp.compareAndSet(null, opToken)) return
        if (isDead) {
            activeOp.compareAndSet(opToken, null)
            return
        }
        val checkCancelled = AtomicBoolean(false)
        val dialog = if (manual) {
            obtainDialog().also { dlg ->
                dlg.showChecking(
                    onCancel = {
                        checkCancelled.set(true)
                        activeOp.compareAndSet(opToken, null)
                        dismissActiveDialog(dlg)
                    },
                )
            }
        } else {
            null
        }
        deps.executor.execute {
            val currentVersion = installedVersionName()
            val result = checkSync(deps.source, currentVersion)
            deps.mainHandler.post {
                val ownsOp = activeOp.compareAndSet(opToken, null)
                if (!ownsOp || checkCancelled.get() || cancelled.get() || isDead) {
                    if (cancelled.get() || isDead) dismissActiveDialog(dialog)
                    return@post
                }
                when (result) {
                    is UpdateCheckResult.Available -> {
                        if (!manual && deps.pending.wasPrompted(result.release.tagName)) {
                            dismissActiveDialog(dialog)
                            return@post
                        }
                        deps.pending.rememberPrompted(result.release.tagName)
                        confirmUpdate(result.release, currentVersion, existingDialog = dialog)
                    }
                    UpdateCheckResult.UpToDate -> {
                        dismissActiveDialog(dialog)
                        if (manual) toast(R.string.update_up_to_date)
                    }
                    UpdateCheckResult.Failed -> {
                        dismissActiveDialog(dialog)
                        if (manual) toast(R.string.update_check_failed)
                    }
                }
            }
        }
    }

    /** Downloads [release] inside the themed card, verifies it, then installs or defers. */
    internal fun downloadAndInstall(
        release: ReleaseInfo,
        existingDialog: ThemedUpdateDialog? = null,
    ) {
        val opToken = Any()
        if (!activeOp.compareAndSet(null, opToken)) return
        if (isDead) {
            activeOp.compareAndSet(opToken, null)
            return
        }
        val downloadCancelled = AtomicBoolean(false)
        val dialog = existingDialog ?: obtainDialog()
        dialog.showDownloading(
            release = release,
            onCancelDownload = {
                downloadCancelled.set(true)
                activeOp.compareAndSet(opToken, null)
                dismissActiveDialog(dialog)
                toast(R.string.update_download_cancelled)
            },
        )
        deps.executor.execute {
            val isAborted = { cancelled.get() || downloadCancelled.get() }
            val downloaded = try {
                deps.downloader.download(
                    release,
                    partFile,
                    apkFile,
                    cancelled = isAborted,
                    onProgress = { progress ->
                        deps.mainHandler.post {
                            if (!isAborted() && !isDead && activeOp.get() === opToken) {
                                dialog.updateDownloadProgress(progress)
                            }
                        }
                    },
                )
            } catch (_: Throwable) {
                null
            }
            val outcome = when {
                isAborted() -> {
                    if (downloaded != null) runCatching { downloaded.delete() }
                    DownloadOutcome.Cancelled
                }
                downloaded != null -> {
                    deps.mainHandler.post {
                        if (!isAborted() && !isDead && activeOp.get() === opToken) {
                            dialog.showVerifying(release)
                        }
                    }
                    val installed = deps.metaReader.installedMeta()
                    when (deps.verifier.verify(downloaded, installed, UpdateManager.EXPECTED_PACKAGE_NAME)) {
                        is ApkVerifyResult.Success -> DownloadOutcome.Ready(downloaded)
                        else -> {
                            runCatching { downloaded.delete() }
                            DownloadOutcome.VerificationFailed
                        }
                    }
                }
                else -> DownloadOutcome.DownloadFailed
            }
            deps.mainHandler.post {
                val ownsOp = activeOp.compareAndSet(opToken, null)
                if (!ownsOp || isAborted() || isDead) {
                    if (isAborted() && outcome is DownloadOutcome.Ready) {
                        runCatching { outcome.apk.delete() }
                    }
                    if (cancelled.get() || isDead) dismissActiveDialog(dialog)
                    return@post
                }
                dismissActiveDialog(dialog)
                when (outcome) {
                    is DownloadOutcome.Ready -> {
                        deps.pending.save(release.tagName, release.sha256Digest, release.sizeBytes)
                        launchOrAskPermission(outcome.apk)
                    }
                    DownloadOutcome.DownloadFailed -> toast(R.string.update_download_failed)
                    DownloadOutcome.VerificationFailed -> toast(R.string.update_verification_failed)
                    DownloadOutcome.Cancelled -> Unit
                }
            }
        }
    }

    /** Called on every ON_RESUME: continues a pending install when possible. */
    private fun onResume() {
        val pending = deps.pending.load() ?: return
        val opToken = Any()
        if (!activeOp.compareAndSet(null, opToken)) return

        if (!deps.installer.canInstallUnknownSources()) {
            activeOp.compareAndSet(opToken, null)
            if (waitingForPermission.getAndSet(false)) {
                toast(R.string.update_permission_denied)
            }
            return
        }

        val cached = apkFile
        deps.executor.execute {
            val outcome = if (cached.isFile && cached.length() == pending.sizeBytes &&
                Sha256.hex(cached) == pending.sha256Digest.removePrefix("sha256:")
            ) {
                val installed = deps.metaReader.installedMeta()
                when (deps.verifier.verify(cached, installed, UpdateManager.EXPECTED_PACKAGE_NAME)) {
                    is ApkVerifyResult.Success -> ResumeOutcome.Ready
                    else -> ResumeOutcome.Invalid
                }
            } else {
                ResumeOutcome.Invalid
            }
            deps.mainHandler.post {
                val ownsOp = activeOp.compareAndSet(opToken, null)
                if (!ownsOp || cancelled.get() || isDead) return@post
                when (outcome) {
                    ResumeOutcome.Ready -> {
                        if (deps.installer.launchInstaller(cached)) {
                            deps.pending.clear()
                            toast(R.string.update_install_ready)
                        } else {
                            deps.pending.clear()
                            toast(R.string.update_download_failed)
                        }
                    }
                    ResumeOutcome.Invalid -> {
                        deps.pending.clear()
                        runCatching { cached.delete() }
                        toast(R.string.update_pending_invalid)
                    }
                }
            }
        }
    }

    private fun onDestroy() {
        cancelled.set(true)
        dismissActiveDialog()
        runCatching { activity.lifecycle.removeObserver(observer) }
        runCatching { partFile.delete() }
        if (deps.ownsExecutor) deps.executor.shutdownNow()
        UpdateManager.removeFlow(activity)
    }

    /** Detaches the flow without touching the activity (test teardown). */
    internal fun forceStop() {
        cancelled.set(true)
        dismissActiveDialog()
        runCatching { activity.lifecycle.removeObserver(observer) }
    }

    private fun confirmUpdate(
        release: ReleaseInfo,
        currentVersionName: String,
        existingDialog: ThemedUpdateDialog? = null,
    ) {
        if (isDead) return
        val dialog = existingDialog ?: obtainDialog()
        dialog.showAvailable(
            release = release,
            currentVersionName = currentVersionName,
            onConfirm = { downloadAndInstall(release, existingDialog = dialog) },
            onLater = { dismissActiveDialog(dialog) },
        )
    }

    private fun obtainDialog(): ThemedUpdateDialog {
        val current = activeDialog
        if (current != null && current.isShowing) return current
        return ThemedUpdateDialog(activity).also { activeDialog = it }
    }

    private fun dismissActiveDialog(dialog: ThemedUpdateDialog? = activeDialog) {
        if (dialog != null) {
            runCatching { dialog.dismiss() }
            if (activeDialog === dialog) activeDialog = null
        }
    }

    private fun installedVersionName(): String = runCatching {
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
    }.getOrNull().orEmpty()

    private fun launchOrAskPermission(apk: File) {
        if (deps.installer.canInstallUnknownSources()) {
            if (deps.installer.launchInstaller(apk)) {
                deps.pending.clear()
                toast(R.string.update_install_ready)
            } else {
                deps.pending.clear()
                runCatching { apk.delete() }
                toast(R.string.update_download_failed)
            }
        } else {
            waitingForPermission.set(true)
            openPermissionSettings()
        }
    }

    private fun openPermissionSettings() {
        try {
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}"),
                )
            )
        } catch (_: Throwable) {
            waitingForPermission.set(false)
            toast(R.string.update_install_permission)
        }
    }

    private fun toast(messageRes: Int) {
        if (isDead) return
        val localized = AppLocale.contextFor(activity)
        Toast.makeText(activity, localized.getString(messageRes), Toast.LENGTH_LONG).show()
    }

    private sealed class DownloadOutcome {
        data class Ready(val apk: File) : DownloadOutcome()
        data object DownloadFailed : DownloadOutcome()
        data object VerificationFailed : DownloadOutcome()
        data object Cancelled : DownloadOutcome()
    }

    private sealed class ResumeOutcome {
        data object Ready : ResumeOutcome()
        data object Invalid : ResumeOutcome()
    }
}
