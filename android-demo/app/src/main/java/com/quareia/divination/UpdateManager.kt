package com.quareia.divination

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import java.io.File

/**
 * Drives the in-app update flow: check GitHub Releases, confirm with the
 * user, download the APK into private storage, and hand it to the system
 * package installer through a content:// URI. The user never leaves the app
 * to update.
 *
 * All UI callbacks run on the activity's main thread; the download itself
 * runs on UpdateChecker's background thread.
 */
internal object UpdateManager {

    private const val UPDATE_FILE_NAME = "quareia-update.apk"
    private const val PREFS = "quareia_update"
    private const val KEY_LAST_PROMPTED_VERSION = "last_prompted_version"

    /** True if the system already allows this app to install packages. */
    internal fun canInstall(context: Context): Boolean =
        context.packageManager.canRequestPackageInstalls()

    /** Returns a cached update APK if one was already downloaded. */
    internal fun downloadedApk(context: Context): File? =
        File(context.filesDir, "updates/$UPDATE_FILE_NAME").takeIf { it.isFile && it.length() > 0 }

    /**
     * Checks for an update and prompts accordingly.
     *
     * @param manual true when the user tapped "check for updates" (feedback
     *   is given in every case); false for the silent startup check (only a
     *   real update produces any UI, and a version already offered before is
     *   not offered again on a later launch).
     */
    internal fun checkAndPrompt(activity: ComponentActivity, manual: Boolean) {
        val progress = if (manual) {
            indeterminateDialog(activity, activity.getString(R.string.update_checking))
        } else {
            null
        }
        val currentVersion = runCatching {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
        }.getOrNull().orEmpty()

        UpdateChecker.check(currentVersion) { release ->
            Handler(Looper.getMainLooper()).post {
                progress?.dismiss()
                when {
                    release != null && !manual && wasPrompted(activity, release.tagName) -> {
                        // Already offered on an earlier launch; keep quiet.
                    }
                    release != null -> {
                        rememberPrompted(activity, release.tagName)
                        confirmUpdate(activity, release)
                    }
                    manual -> toast(
                        activity,
                        if (currentVersion.isBlank()) {
                            R.string.update_check_failed
                        } else {
                            R.string.update_up_to_date
                        }
                    )
                }
            }
        }
    }

    private fun wasPrompted(context: Context, tagName: String): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_LAST_PROMPTED_VERSION, null) == tagName

    private fun rememberPrompted(context: Context, tagName: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LAST_PROMPTED_VERSION, tagName)
            .apply()
    }

    /** Prompts the user to download and install [release]. */
    private fun confirmUpdate(activity: ComponentActivity, release: UpdateChecker.LatestRelease) {
        AlertDialog.Builder(activity)
            .setTitle(R.string.update_available_title)
            .setMessage(
                activity.getString(R.string.update_available_message, release.tagName)
            )
            .setPositiveButton(R.string.update_yes) { _, _ -> downloadAndInstall(activity, release) }
            .setNegativeButton(R.string.update_later, null)
            .show()
    }

    /** Downloads the APK, then starts the system package installer. */
    internal fun downloadAndInstall(activity: ComponentActivity, release: UpdateChecker.LatestRelease) {
        val dialog = AlertDialog.Builder(activity)
            .setTitle(R.string.update_available_title)
            .setMessage(activity.getString(R.string.update_downloading, 0))
            .setCancelable(false)
            .show()

        UpdateChecker.download(
            release,
            File(activity.filesDir, "updates/$UPDATE_FILE_NAME"),
        ) { progress ->
            val percent = (progress.fraction * 100).toInt().coerceIn(0, 100)
            activity.runOnUiThread {
                dialog.setMessage(activity.getString(R.string.update_downloading, percent))
            }
        }?.let { apk ->
            activity.runOnUiThread {
                dialog.dismiss()
                install(activity, apk)
            }
        } ?: activity.runOnUiThread {
            dialog.dismiss()
            toast(activity, R.string.update_download_failed)
        }
    }

    /**
     * Hands the downloaded APK to the system installer. When the package
     * install permission is missing, the user is sent to the system setting;
     * the cached APK stays in place so the update can continue afterwards.
     */
    private fun install(activity: ComponentActivity, apk: File) {
        if (!canInstall(activity)) {
            AlertDialog.Builder(activity)
                .setTitle(R.string.update_available_title)
                .setMessage(R.string.update_install_permission)
                .setPositiveButton(android.R.string.ok) { _, _ ->
                    try {
                        activity.startActivity(
                            Intent(
                                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:${activity.packageName}")
                            )
                        )
                    } catch (_: ActivityNotFoundException) {
                        toast(activity, R.string.update_install_permission)
                    }
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
            return
        }

        val uri: Uri = try {
            FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.updatefileprovider",
                apk,
            )
        } catch (_: Throwable) {
            toast(activity, R.string.update_download_failed)
            return
        }

        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            activity.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            toast(activity, R.string.update_download_failed)
        }
    }

    /** Removes a stale cached APK so a fresh one is downloaded next time. */
    internal fun clearDownloadedApk(context: Context) {
        downloadedApk(context)?.delete()
    }

    private fun indeterminateDialog(activity: ComponentActivity, message: String): AlertDialog =
        AlertDialog.Builder(activity)
            .setMessage(message)
            .setCancelable(false)
            .show()

    private fun toast(activity: ComponentActivity, messageRes: Int) {
        Toast.makeText(activity, messageRes, Toast.LENGTH_LONG).show()
    }
}
