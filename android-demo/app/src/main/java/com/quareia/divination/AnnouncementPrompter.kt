package com.quareia.divination

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity

/**
 * Shows important/update announcements as a dialog when they are unread, and
 * performs their actions: an `update` announcement reuses [UpdateManager]'s
 * manual update check, and a plain HTTPS action URL is handed to the system
 * browser only.
 *
 * Reading is recorded at display time keyed by `id + revision`, so an admin
 * edit (revision bump) makes the announcement appear again.
 */
internal class AnnouncementPrompter(private val activity: ComponentActivity) {

    /** Picks the first unread important/update announcement and shows it. */
    fun onAnnouncements(announcements: List<Announcement>) {
        if (activity.isDestroyed || activity.isFinishing) return
        val unread = announcements.firstOrNull {
            (it.severity == SEVERITY_UPDATE || it.severity == SEVERITY_IMPORTANT) &&
                !AnnouncementController.isRead(it.id, it.revision)
        } ?: return
        AnnouncementController.markRead(unread.id, unread.revision)
        showDialog(unread)
    }

    private fun showDialog(announcement: Announcement) {
        val localized = AppLocale.contextFor(activity)
        val builder = AlertDialog.Builder(activity)
        builder.setTitle(announcement.title.ifBlank { localized.getString(R.string.announcements_title) })
        builder.setMessage(announcement.body)
        if (announcement.severity == SEVERITY_UPDATE) {
            builder.setPositiveButton(
                announcement.button.ifBlank { localized.getString(R.string.announcement_action_update) }
            ) { _, _ ->
                // Reuse the existing in-app updater: re-check and prompt.
                UpdateManager.checkAndPrompt(activity, manual = true)
            }
        } else if (announcement.actionUrl.isTrustedHttpsUrl()) {
            builder.setPositiveButton(
                announcement.button.ifBlank { localized.getString(R.string.announcement_open) }
            ) { _, _ ->
                openBrowser(announcement.actionUrl)
            }
        }
        builder.setNegativeButton(R.string.announcement_later, null)
        builder.show()
    }

    private fun openBrowser(url: String) {
        if (!url.isTrustedHttpsUrl()) return
        try {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            // No browser available; silently ignore in this demo.
        }
    }

    private fun String.isTrustedHttpsUrl(): Boolean = try {
        val uri = Uri.parse(this)
        uri.scheme == "https" && !uri.host.isNullOrBlank()
    } catch (_: Throwable) {
        false
    }

    private companion object {
        const val SEVERITY_UPDATE = "update"
        const val SEVERITY_IMPORTANT = "important"
    }
}
