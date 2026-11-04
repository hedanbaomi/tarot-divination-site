package com.quareia.divination

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.text.method.LinkMovementMethod
import android.util.TypedValue
import android.view.Gravity
import android.view.MenuItem
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.setPadding

/**
 * "About / Copyright & Attribution" screen.
 *
 * A clearly accessible, always-on legal notice reachable from the main
 * activity's homepage menu (never a forced startup dialog). It states that the
 * app is unofficial, credits the Mystagogus and LXXXI rights holders, limits
 * the non-commercial condition to the authorised third-party materials,
 * separates those materials from the application code's software licence,
 * links to the official Quareia website, and reproduces Josephine McCarthy's
 * note verbatim.
 *
 * The verbatim English note below is the authoritative text and must be kept
 * word-for-word; the Chinese text shown beneath it is only a reference
 * translation (see strings.xml `about_quote_zh`).
 */
class AboutActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // The web homepage persists the user's explicit language choice through
        // AppLocale, and its active theme through AppTheme.
        val localized = AppLocale.contextFor(this)
        val palette = AppTheme.paletteFor(this)
        val density = resources.displayMetrics.density

        WindowCompat.setDecorFitsSystemWindows(window, true)
        AppTheme.applySystemBars(window, palette)

        val primary = palette.textPrimary
        val accent = palette.accent
        val muted = palette.textSecondary

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

        container.addView(sectionTitle(localized.getString(R.string.about_title), primary, accent))

        container.addView(bodyText(localized.getString(R.string.about_status), primary))
        container.addView(bodyText(localized.getString(R.string.about_permission_note), muted))

        // Mystagogus credit
        container.addView(headingText(localized.getString(R.string.about_mystagogus_label), accent))
        container.addView(bodyText(localized.getString(R.string.about_mystagogus_rights), primary))

        // LXXXI credit
        container.addView(headingText(localized.getString(R.string.about_lxxxi_label), accent))
        container.addView(bodyText(localized.getString(R.string.about_lxxxi_rights), primary))

        // Open-source boundary
        container.addView(bodyText(localized.getString(R.string.about_oss_boundary), muted))

        // Quareia link (opens the system browser; the app's own network access
        // is limited to opt-out telemetry and the link is handled externally).
        container.addView(headingText(localized.getString(R.string.about_quareia_label), accent))
        val quareiaUrl = localized.getString(R.string.about_quareia_url)
        val link = TextView(this).apply {
            text = quareiaUrl
            setTextColor(accent)
            setTextIsSelectable(true)
            paint.isUnderlineText = true
            movementMethod = LinkMovementMethod.getInstance()
            setPadding(0, dip(2), 0, dip(12))
            setOnClickListener {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(quareiaUrl))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            }
        }
        container.addView(link)

        // Anonymous usage statistics section with an opt-out toggle. Wording is
        // entirely from strings.xml; the switch reflects and updates the live
        // setting. Turning it off deletes the local anonymous identifier.
        container.addView(headingText(localized.getString(R.string.telemetry_section_title), accent))
        container.addView(bodyText(localized.getString(R.string.telemetry_notice), muted))
        val telemetrySwitch = android.widget.Switch(this).apply {
            isChecked = TelemetryController.isEnabled()
            text = if (isChecked) {
                localized.getString(R.string.telemetry_switch_on)
            } else {
                localized.getString(R.string.telemetry_switch_off)
            }
            setTextColor(primary)
            thumbTintList = palette.switchThumbTintList()
            trackTintList = palette.switchTrackTintList()
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dip(4), 0, dip(14))
            setOnCheckedChangeListener { view, checked ->
                TelemetryController.setEnabled(checked)
                view.text = if (checked) {
                    localized.getString(R.string.telemetry_switch_on)
                } else {
                    localized.getString(R.string.telemetry_switch_off)
                }
                if (!checked) {
                    android.widget.Toast.makeText(
                        this@AboutActivity,
                        localized.getString(R.string.telemetry_disabled_toast),
                        android.widget.Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
        container.addView(telemetrySwitch)

        // Check for updates: shows the installed version and lets the user
        // fetch and install the newest release from GitHub Releases inside
        // the app via the themed update modal.
        container.addView(headingText(localized.getString(R.string.update_section_title), accent))
        container.addView(
            bodyText(
                localized.getString(
                    R.string.update_version,
                    runCatching {
                        packageManager.getPackageInfo(packageName, 0).versionName
                    }.getOrNull().orEmpty(),
                ),
                primary,
            )
        )
        val checkUpdate = actionChip(localized.getString(R.string.update_check), palette, density) {
            UpdateManager.checkAndPrompt(this@AboutActivity, manual = true)
        }
        container.addView(
            checkUpdate,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = dip(2)
                bottomMargin = dip(14)
            },
        )

        // Announcements: info announcements never pop up at launch; they are
        // read here. The manual refresh forces a network check.
        container.addView(headingText(localized.getString(R.string.announcements_section_title), accent))
        val openAnnouncements = actionChip(localized.getString(R.string.announcements_open), palette, density) {
            startActivity(Intent(this@AboutActivity, AnnouncementsActivity::class.java))
        }
        container.addView(
            openAnnouncements,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = dip(2)
                bottomMargin = dip(14)
            },
        )

        // Verbatim English note (authoritative) + Chinese reference translation.
        container.addView(headingText(localized.getString(R.string.about_quote_label), accent))
        val quote = TextView(this).apply {
            setTextColor(primary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setLineSpacing(dip(2).toFloat(), 1.06f)
            setPadding(dip(14), dip(12), dip(14), dip(12))
            background = palette.surfaceDrawable(density, radiusDp = 12f)
            text = localized.getString(
                R.string.about_quote_display,
                localized.getString(R.string.about_quote_en),
                localized.getString(R.string.about_quote_cite)
            )
        }
        container.addView(
            quote,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = dip(8) },
        )

        container.addView(bodyText(localized.getString(R.string.about_quote_zh), muted))

        val close = TextView(this).apply {
            text = localized.getString(R.string.about_close)
            setTextColor(palette.secondaryBtnText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            minHeight = dip(46)
            minimumHeight = dip(46)
            setPadding(dip(18), dip(10), dip(18), dip(10))
            background = palette.secondaryButtonDrawable(density, radiusDp = 12f)
            setOnClickListener { finish() }
        }
        container.addView(
            close,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply {
                topMargin = dip(12)
                bottomMargin = dip(8)
            },
        )

        scroll.addView(container)
        root.addView(scroll)
        setContentView(root)
    }

    private fun actionChip(
        label: String,
        palette: ThemePalette,
        density: Float,
        onClick: () -> Unit,
    ): TextView = TextView(this).apply {
        text = label
        setTextColor(palette.secondaryBtnText)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
        typeface = android.graphics.Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER_VERTICAL
        minHeight = dip(42)
        minimumHeight = dip(42)
        setPadding(dip(16), dip(9), dip(16), dip(9))
        background = palette.secondaryButtonDrawable(density, radiusDp = 11f)
        isClickable = true
        isFocusable = true
        setOnClickListener { onClick() }
    }

    private fun sectionTitle(text: String, color: Int, accent: Int): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@AboutActivity).apply {
                this.text = text
                setTextColor(color)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                typeface = android.graphics.Typeface.create(
                    android.graphics.Typeface.SERIF,
                    android.graphics.Typeface.BOLD,
                )
                setPadding(0, dip(4), 0, dip(10))
            })
            // A thin accent rule under the title.
            addView(android.view.View(this@AboutActivity).apply {
                setBackgroundColor(accent)
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    dip(2)
                ).apply { bottomMargin = dip(14) }
            })
        }

    private fun headingText(text: String, color: Int): TextView =
        TextView(this).apply {
            this.text = text
            setTextColor(color)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = android.graphics.Typeface.DEFAULT_BOLD
            setPadding(0, dip(14), 0, dip(4))
        }

    private fun bodyText(text: String, color: Int): TextView =
        TextView(this).apply {
            this.text = text
            setTextColor(color)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setLineSpacing(dip(2).toFloat(), 1f)
            setPadding(0, dip(2), 0, dip(10))
        }

    private fun dip(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()

    /** Up navigation returns to the main divination screen. */
    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == android.R.id.home) {
            finish()
            return true
        }
        return super.onOptionsItemSelected(item)
    }
}
