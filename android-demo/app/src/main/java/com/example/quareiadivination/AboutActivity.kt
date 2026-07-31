package com.example.quareiadivination

import android.annotation.SuppressLint
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
 * activity's overflow menu (never a forced startup dialog). It states that the
 * app is an unofficial, free, strictly non-commercial tool, credits the
 * Mystagogus and LXXXI rights holders, separates the third-party materials
 * from the application code's open-source licence, links to the official
 * Quareia website, and reproduces Josephine McCarthy's note verbatim.
 *
 * The verbatim English note below is the authoritative text and must be kept
 * word-for-word; the Chinese text shown beneath it is only a reference
 * translation (see strings.xml `about_quote_zh`).
 */
class AboutActivity : ComponentActivity() {

    companion object {
        /** Official Quareia website, opened in the system browser on tap. */
        private const val QUAREIA_URL = "https://www.quareia.com"

        /**
         * The author's note, reproduced verbatim as requested. Do not alter
         * this string — it is the English original that must always be present.
         */
        private const val JOSEPHINE_QUOTE_EN =
            "while digital tools for readings can be useful in an emergency, " +
                "the interaction between the physical hands of the reader " +
                "touching and shuffling the deck is safer, a lot more accurate " +
                "and far more powerful"

        private const val JOSEPHINE_CITE = "— Josephine McCarthy"
    }

    @SuppressLint("SetTextI18n")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, true)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.parseColor("#090d1e")
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.parseColor("#090d1e")
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false

        val bg = Color.parseColor("#090d1e")
        val primary = Color.parseColor("#E8E6F0")
        val accent = Color.parseColor("#C9A86A")
        val muted = Color.parseColor("#9A97AE")

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(bg)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val scroll = android.widget.ScrollView(this).apply {
            setBackgroundColor(bg)
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

        container.addView(sectionTitle(getString(R.string.about_title), primary, accent))

        container.addView(bodyText(getString(R.string.about_status), primary))
        container.addView(bodyText(getString(R.string.about_permission_note), muted))

        // Mystagogus credit
        container.addView(headingText(getString(R.string.about_mystagogus_label), accent))
        container.addView(bodyText(getString(R.string.about_mystagogus_rights), primary))

        // LXXXI credit
        container.addView(headingText(getString(R.string.about_lxxxi_label), accent))
        container.addView(bodyText(getString(R.string.about_lxxxi_rights), primary))

        // Open-source boundary
        container.addView(bodyText(getString(R.string.about_oss_boundary), muted))

        // Quareia link (opens the system browser; the app has no network permission)
        container.addView(headingText(getString(R.string.about_quareia_label), accent))
        val link = TextView(this).apply {
            text = QUAREIA_URL
            setTextColor(accent)
            setTextIsSelectable(true)
            paint.isUnderlineText = true
            movementMethod = LinkMovementMethod.getInstance()
            setPadding(0, dip(2), 0, dip(12))
            setOnClickListener {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse(QUAREIA_URL))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
            }
        }
        container.addView(link)

        // Anonymous usage statistics section with an opt-out toggle. Wording is
        // entirely from strings.xml; the switch reflects and updates the live
        // setting. Turning it off deletes the local anonymous identifier.
        container.addView(headingText(getString(R.string.telemetry_section_title), accent))
        container.addView(bodyText(getString(R.string.telemetry_notice), muted))
        val telemetrySwitch = android.widget.Switch(this).apply {
            isChecked = TelemetryController.isEnabled()
            text = if (isChecked) {
                getString(R.string.telemetry_switch_on)
            } else {
                getString(R.string.telemetry_switch_off)
            }
            setTextColor(primary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dip(4), 0, dip(14))
            setOnCheckedChangeListener { view, checked ->
                TelemetryController.setEnabled(checked)
                view.text = if (checked) {
                    getString(R.string.telemetry_switch_on)
                } else {
                    getString(R.string.telemetry_switch_off)
                }
                if (!checked) {
                    android.widget.Toast.makeText(
                        this@AboutActivity,
                        R.string.telemetry_disabled_toast,
                        android.widget.Toast.LENGTH_LONG
                    ).show()
                }
            }
        }
        container.addView(telemetrySwitch)

        // Verbatim English note (authoritative) + Chinese reference translation.
        container.addView(headingText(getString(R.string.about_quote_label), accent))
        val quote = TextView(this).apply {
            setTextColor(primary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setLineSpacing(dip(2).toFloat(), 1f)
            setPadding(dip(12), dip(10), dip(12), dip(10))
            text = "\u201C$JOSEPHINE_QUOTE_EN\u201D\n\n$JOSEPHINE_CITE"
        }
        quote.setBackgroundColor(Color.parseColor("#141633"))
        container.addView(quote)

        container.addView(bodyText(getString(R.string.about_quote_zh), muted))

        val close = TextView(this).apply {
            text = getString(R.string.about_close)
            setTextColor(accent)
            gravity = Gravity.CENTER
            setPadding(0, dip(10), 0, dip(6))
            setOnClickListener { finish() }
        }
        container.addView(close)

        scroll.addView(container)
        root.addView(scroll)
        setContentView(root)
    }

    private fun sectionTitle(text: String, color: Int, accent: Int): LinearLayout =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            addView(TextView(this@AboutActivity).apply {
                this.text = text
                setTextColor(color)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
                typeface = android.graphics.Typeface.DEFAULT_BOLD
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
