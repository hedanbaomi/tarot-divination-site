package com.quareia.divination

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.setPadding

/**
 * "Announcements" screen: lists every fetched announcement (info items do not
 * pop up at launch and are read here), with a manual refresh that forces a
 * network check. `update` announcements offer the in-app update check through
 * [UpdateManager]; an HTTPS action URL opens only in the system browser.
 * Everything is rendered as plain text — never HTML.
 */
class AnnouncementsActivity : ComponentActivity() {

    private lateinit var container: LinearLayout
    private lateinit var hint: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val localized = AppLocale.contextFor(this)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.parseColor("#090d1e")
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.parseColor("#090d1e")
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#090d1e"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val scroll = android.widget.ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#090d1e"))
            isFillViewport = true
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                0,
                1f
            )
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dip(20))
        }

        container.addView(
            TextView(this).apply {
                text = localized.getString(R.string.announcements_title)
                setTextColor(Color.parseColor("#E8E6F0"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
                setPadding(0, dip(4), 0, dip(10))
            }
        )

        val hint = TextView(this).apply {
            setTextColor(Color.parseColor("#9A97AE"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, 0, 0, dip(8))
        }
        container.addView(hint)
        this.hint = hint

        val refresh = TextView(this).apply {
            text = localized.getString(R.string.announcements_refresh)
            setTextColor(Color.parseColor("#C9A86A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, dip(2), 0, dip(14))
            setOnClickListener { refreshAnnouncements() }
        }
        container.addView(refresh)

        this.container = container

        scroll.addView(container)
        root.addView(scroll)
        setContentView(root)

        refreshAnnouncements()
    }

    private fun refreshAnnouncements() {
        // Mark everything currently visible as read — the user is reading it.
        AnnouncementsStore.lastList().forEach {
            AnnouncementController.markRead(it.id, it.revision)
        }
        render()
        AnnouncementController.check(force = true) { announcements ->
            announcements.forEach {
                AnnouncementController.markRead(it.id, it.revision)
            }
            render()
        }
    }

    private fun render() {
        val localized = AppLocale.contextFor(this)
        val list = AnnouncementsStore.lastList()
        hint.text = if (AnnouncementsStore.lastUpdatedAtMillis() > 0L) {
            localized.getString(R.string.announcements_updated_hint)
        } else {
            localized.getString(R.string.announcements_empty)
        }

        // Drop all item rows: keep the two header rows and the refresh row.
        while (container.childCount > 3) {
            container.removeViewAt(container.childCount - 1)
        }

        if (list.isEmpty()) {
            val empty = TextView(this).apply {
                text = localized.getString(R.string.announcements_empty)
                setTextColor(Color.parseColor("#9A97AE"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setPadding(0, dip(8), 0, dip(8))
            }
            container.addView(empty)
            return
        }

        list.forEach { announcement ->
            container.addView(itemView(announcement, localized))
        }
    }

    private fun itemView(announcement: Announcement, localized: android.content.Context): TextView {
        val primary = Color.parseColor("#E8E6F0")
        val accent = Color.parseColor("#C9A86A")
        val muted = Color.parseColor("#9A97AE")

        val severityLabel = when (announcement.severity) {
            "update" -> localized.getString(R.string.announcement_severity_update)
            "important" -> localized.getString(R.string.announcement_severity_important)
            else -> localized.getString(R.string.announcement_severity_info)
        }
        val actionText = when {
            announcement.severity == "update" ->
                announcement.button.ifBlank { localized.getString(R.string.announcement_action_update) }
            announcement.actionUrl.isTrustedHttpsUrl() ->
                announcement.button.ifBlank { localized.getString(R.string.announcement_open) }
            else -> null
        }

        val text = buildString {
            append("[$severityLabel] ")
            append(announcement.title.ifBlank { "—" })
            if (announcement.body.isNotBlank()) {
                append("\n")
                append(announcement.body)
            }
            if (actionText != null) {
                append("\n")
                append(actionText)
            }
        }
        val view = TextView(this).apply {
            this.text = text
            setTextColor(primary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setLineSpacing(dip(2).toFloat(), 1f)
            setPadding(dip(12), dip(10), dip(12), dip(10))
        }
        view.setBackgroundColor(Color.parseColor("#141633"))
        (view.layoutParams as? LinearLayout.LayoutParams)?.bottomMargin = dip(10)

        if (actionText != null) {
            view.setTextColor(if (announcement.severity == "update") accent else primary)
            view.setOnClickListener {
                if (announcement.severity == "update") {
                    UpdateManager.checkAndPrompt(this, manual = true)
                } else {
                    openBrowser(announcement.actionUrl)
                }
            }
        }
        return view
    }

    private fun openBrowser(url: String) {
        if (!url.isTrustedHttpsUrl()) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            // No browser available; silently ignore.
        }
    }

    private fun String.isTrustedHttpsUrl(): Boolean = try {
        val uri = Uri.parse(this)
        uri.scheme == "https" && !uri.host.isNullOrBlank()
    } catch (_: Throwable) {
        false
    }

    private fun dip(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
}
