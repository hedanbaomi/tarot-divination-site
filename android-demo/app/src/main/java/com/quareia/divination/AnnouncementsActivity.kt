package com.quareia.divination

import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
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
    private lateinit var palette: ThemePalette

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val localized = AppLocale.contextFor(this)
        palette = AppTheme.paletteFor(this)
        val density = resources.displayMetrics.density

        WindowCompat.setDecorFitsSystemWindows(window, true)
        AppTheme.applySystemBars(window, palette)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = palette.pageGradientDrawable()
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val scroll = android.widget.ScrollView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
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
                setTextColor(palette.textPrimary)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
                setPadding(0, dip(4), 0, dip(10))
            }
        )

        val hint = TextView(this).apply {
            setTextColor(palette.textSecondary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, 0, 0, dip(8))
        }
        container.addView(hint)
        this.hint = hint

        val refresh = TextView(this).apply {
            text = localized.getString(R.string.announcements_refresh)
            setTextColor(palette.secondaryBtnText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER_VERTICAL
            minHeight = dip(42)
            minimumHeight = dip(42)
            setPadding(dip(16), dip(9), dip(16), dip(9))
            background = palette.secondaryButtonDrawable(density, radiusDp = 11f)
            isClickable = true
            isFocusable = true
            setOnClickListener { refreshAnnouncements() }
        }
        container.addView(
            refresh,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = dip(16) },
        )

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
                setTextColor(palette.textSecondary)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setPadding(0, dip(8), 0, dip(8))
            }
            container.addView(empty)
            return
        }

        list.forEach { announcement ->
            container.addView(
                itemView(announcement, localized),
                LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ).apply { bottomMargin = dip(12) },
            )
        }
    }

    private fun itemView(announcement: Announcement, localized: android.content.Context): TextView {
        val density = resources.displayMetrics.density
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
                append("\n\n✦ ")
                append(actionText)
            }
        }
        val view = TextView(this).apply {
            this.text = text
            setTextColor(palette.textPrimary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
            setLineSpacing(dip(3).toFloat(), 1.08f)
            setPadding(dip(14), dip(12), dip(14), dip(12))
            background = palette.surfaceDrawable(density, radiusDp = 13f)
        }

        if (actionText != null) {
            view.setTextColor(if (announcement.severity == "update") palette.badgeText else palette.textPrimary)
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
