package com.quareia.divination

import android.app.Dialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.view.ViewCompat
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Custom Quareia-themed modal card for the entire Android update lifecycle:
 * manual update check -> update available details (version comparison, size
 * badge, plain-text release notes) -> in-card download progress bar with
 * cancel support -> package signature verification.
 *
 * Replaces all system `android.app.AlertDialog` instances in [UpdateManager]
 * and adapts automatically to `celestial`, `parchment`, `ember`, and `grove`.
 */
internal class ThemedUpdateDialog(
    private val activity: ComponentActivity,
) : Dialog(activity) {

    internal enum class State {
        CHECKING,
        AVAILABLE,
        DOWNLOADING,
        VERIFYING,
    }

    internal val palette: ThemePalette = AppTheme.paletteFor(activity)
    private val localized: Context = AppLocale.contextFor(activity)

    internal var state: State = State.CHECKING
        private set

    private var rootCard: LinearLayout? = null
    internal lateinit var kickerTextView: TextView
        private set
    internal lateinit var badgeTextView: TextView
        private set
    internal lateinit var titleTextView: TextView
        private set
    internal lateinit var versionBannerView: TextView
        private set
    internal lateinit var dividerView: View
        private set

    private lateinit var checkingSection: LinearLayout
    internal lateinit var checkingProgressView: ThemedProgressBar
        private set
    internal lateinit var checkingHintView: TextView
        private set

    private lateinit var availableSection: LinearLayout
    internal lateinit var notesLabelView: TextView
        private set
    internal lateinit var notesTextView: TextView
        private set

    private lateinit var downloadSection: LinearLayout
    internal lateinit var percentTextView: TextView
        private set
    internal lateinit var bytesTextView: TextView
        private set
    internal lateinit var progressBarView: ThemedProgressBar
        private set
    internal lateinit var securityHintView: TextView
        private set

    internal lateinit var primaryActionView: Button
        private set
    internal lateinit var secondaryActionView: Button
        private set

    private var onPrimaryClick: (() -> Unit)? = null
    private var onSecondaryClick: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        setCanceledOnTouchOutside(false)
        setContentView(ensureViews())

        window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            attributes = attributes.apply { dimAmount = palette.dimAmount }
        }
    }

    override fun onStart() {
        super.onStart()
        applyWindowWidth()
    }

    private fun applyWindowWidth() {
        val metrics = context.resources.displayMetrics
        val desiredWidth = (metrics.widthPixels * WIDTH_FRACTION).toInt()
        window?.setLayout(
            min(desiredWidth, dp(MAX_WIDTH_DP)),
            ViewGroup.LayoutParams.WRAP_CONTENT,
        )
    }

    internal fun showChecking(onCancel: () -> Unit) {
        ensureViews()
        state = State.CHECKING
        setCancelable(true)
        setOnCancelListener { onCancel() }

        kickerTextView.text = localized.getString(R.string.update_kicker_checking)
        badgeTextView.visibility = View.GONE
        titleTextView.text = localized.getString(R.string.update_checking)
        versionBannerView.visibility = View.GONE
        dividerView.visibility = View.VISIBLE

        checkingSection.visibility = View.VISIBLE
        availableSection.visibility = View.GONE
        downloadSection.visibility = View.GONE
        checkingProgressView.setIndeterminateMode(true)
        checkingHintView.text = localized.getString(R.string.update_checking_hint)

        primaryActionView.visibility = View.GONE
        onPrimaryClick = null

        secondaryActionView.visibility = View.VISIBLE
        secondaryActionView.isEnabled = true
        secondaryActionView.text = localized.getString(R.string.update_cancel_check)
        updateSecondaryTopMargin(hasPrimary = false)
        onSecondaryClick = onCancel

        if (!isShowing) show() else applyWindowWidth()
    }

    internal fun showAvailable(
        release: ReleaseInfo,
        currentVersionName: String,
        onConfirm: () -> Unit,
        onLater: () -> Unit,
    ) {
        ensureViews()
        state = State.AVAILABLE
        setCancelable(true)
        setOnCancelListener { onLater() }

        kickerTextView.text = localized.getString(R.string.update_kicker_available)
        badgeTextView.text = ByteFormatter.format(release.sizeBytes)
        badgeTextView.visibility = View.VISIBLE

        titleTextView.text = localized.getString(R.string.update_available_title)

        val cleanCurrent = currentVersionName.trim().removePrefix("v").removePrefix("V")
        versionBannerView.text = if (cleanCurrent.isNotEmpty()) {
            localized.getString(R.string.update_version_upgrade, cleanCurrent, release.tagName)
        } else {
            localized.getString(R.string.update_version_target, release.tagName)
        }
        versionBannerView.visibility = View.VISIBLE
        dividerView.visibility = View.VISIBLE

        checkingSection.visibility = View.GONE
        availableSection.visibility = View.VISIBLE
        downloadSection.visibility = View.GONE

        notesLabelView.text = localized.getString(R.string.update_notes_label)
        notesTextView.text = release.releaseNotes.ifBlank {
            localized.getString(R.string.update_notes_fallback, release.tagName)
        }

        primaryActionView.visibility = View.VISIBLE
        primaryActionView.isEnabled = true
        primaryActionView.text = localized.getString(R.string.update_yes)
        onPrimaryClick = onConfirm

        secondaryActionView.visibility = View.VISIBLE
        secondaryActionView.isEnabled = true
        secondaryActionView.text = localized.getString(R.string.update_later)
        updateSecondaryTopMargin(hasPrimary = true)
        onSecondaryClick = onLater

        if (!isShowing) show() else applyWindowWidth()
    }

    internal fun showDownloading(
        release: ReleaseInfo,
        onCancelDownload: () -> Unit,
    ) {
        ensureViews()
        state = State.DOWNLOADING
        setCancelable(false)
        setOnCancelListener(null)

        kickerTextView.text = localized.getString(R.string.update_kicker_downloading)
        badgeTextView.text = release.tagName
        badgeTextView.visibility = View.VISIBLE

        titleTextView.text = localized.getString(R.string.update_downloading_title, release.tagName)
        versionBannerView.visibility = View.GONE
        dividerView.visibility = View.VISIBLE

        checkingSection.visibility = View.GONE
        availableSection.visibility = View.GONE
        downloadSection.visibility = View.VISIBLE

        progressBarView.setIndeterminateMode(false)
        updateDownloadProgress(DownloadProgress(totalBytes = release.sizeBytes, downloadedBytes = 0L))
        securityHintView.text = localized.getString(R.string.update_security_hint)

        primaryActionView.visibility = View.GONE
        onPrimaryClick = null

        secondaryActionView.visibility = View.VISIBLE
        secondaryActionView.isEnabled = true
        secondaryActionView.text = localized.getString(R.string.update_cancel_download)
        updateSecondaryTopMargin(hasPrimary = false)
        onSecondaryClick = onCancelDownload

        if (!isShowing) show() else applyWindowWidth()
    }

    internal fun updateDownloadProgress(progress: DownloadProgress) {
        ensureViews()
        val percent = when {
            progress.totalBytes > 0L && progress.downloadedBytes >= progress.totalBytes -> 100
            progress.totalBytes > 0L -> (progress.fraction * 100f).roundToInt().coerceIn(0, 99)
            else -> 0
        }
        percentTextView.text = "$percent%"
        bytesTextView.text = if (progress.totalBytes > 0L) {
            "${ByteFormatter.format(progress.downloadedBytes)} / ${ByteFormatter.format(progress.totalBytes)}"
        } else {
            ByteFormatter.format(progress.downloadedBytes)
        }
        progressBarView.setProgressFraction(progress.fraction)
    }

    internal fun showVerifying(release: ReleaseInfo) {
        ensureViews()
        state = State.VERIFYING
        setCancelable(false)
        setOnCancelListener(null)

        kickerTextView.text = localized.getString(R.string.update_kicker_verifying)
        badgeTextView.text = release.tagName
        badgeTextView.visibility = View.VISIBLE
        titleTextView.text = localized.getString(R.string.update_verifying_title)

        percentTextView.text = "100%"
        bytesTextView.text = "${ByteFormatter.format(release.sizeBytes)} / ${ByteFormatter.format(release.sizeBytes)}"
        progressBarView.setProgressFraction(1f)

        secondaryActionView.isEnabled = false
        onSecondaryClick = null
    }

    private fun ensureViews(): View {
        rootCard?.let { return it }

        val density = context.resources.displayMetrics.density
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(20), dp(22), dp(20))
            background = palette.cardDrawable(density, radiusDp = CARD_RADIUS_DP.toFloat())
            elevation = dp(14).toFloat()
        }

        // 1. Header row: kicker + right-aligned pill badge
        val headerRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        kickerTextView = TextView(context).apply {
            setTextColor(palette.accent)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.08f
        }
        headerRow.addView(
            kickerTextView,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        badgeTextView = TextView(context).apply {
            setTextColor(palette.badgeText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(10), dp(3), dp(10), dp(3))
            background = palette.badgeDrawable(density)
        }
        headerRow.addView(
            badgeTextView,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { marginStart = dp(8) },
        )
        card.addView(headerRow, matchWidthWrapHeight())

        // 2. Display title
        titleTextView = TextView(context).apply {
            setTextColor(palette.textPrimary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.create(Typeface.SERIF, Typeface.BOLD)
            setLineSpacing(0f, 1.14f)
        }
        ViewCompat.setAccessibilityHeading(titleTextView, true)
        card.addView(titleTextView, matchWidthWrapHeight(topMarginDp = 9))

        // 3. Version upgrade pill strip
        versionBannerView = TextView(context).apply {
            setTextColor(palette.badgeText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            typeface = Typeface.DEFAULT_BOLD
            setPadding(dp(12), dp(7), dp(12), dp(7))
            background = palette.badgeDrawable(density, radiusDp = 10f)
        }
        card.addView(versionBannerView, matchWidthWrapHeight(topMarginDp = 11))

        // 4. Thin ornamental divider
        dividerView = View(context).apply {
            setBackgroundColor(palette.surfaceBorder)
        }
        card.addView(
            dividerView,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, max(1, dp(1))).apply {
                topMargin = dp(14)
            },
        )

        // 5a. Checking section
        checkingSection = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = palette.surfaceDrawable(density, radiusDp = 14f)
            setPadding(dp(16), dp(16), dp(16), dp(15))
            visibility = View.GONE
        }
        checkingProgressView = ThemedProgressBar(context, palette).apply {
            setIndeterminateMode(true)
        }
        checkingSection.addView(
            checkingProgressView,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(10)),
        )
        checkingHintView = TextView(context).apply {
            setTextColor(palette.textSecondary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
            setLineSpacing(dp(2).toFloat(), 1.15f)
        }
        checkingSection.addView(checkingHintView, matchWidthWrapHeight(topMarginDp = 12))
        card.addView(checkingSection, matchWidthWrapHeight(topMarginDp = 14))

        // 5b. Available release notes section
        availableSection = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            visibility = View.GONE
        }
        notesLabelView = TextView(context).apply {
            setTextColor(palette.accent)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.05f
        }
        availableSection.addView(notesLabelView, matchWidthWrapHeight())

        notesTextView = TextView(context).apply {
            setTextColor(palette.textPrimary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14.5f)
            setLineSpacing(dp(3).toFloat(), 1.18f)
        }
        val maxNotesHeight = (context.resources.displayMetrics.heightPixels * NOTES_HEIGHT_FRACTION)
            .toInt()
            .coerceAtLeast(dp(MIN_NOTES_HEIGHT_DP))
        val notesScroller = MaxHeightScrollView(context, maxNotesHeight).apply {
            isFillViewport = false
            isVerticalScrollBarEnabled = true
            background = palette.surfaceDrawable(density, radiusDp = 13f)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            addView(
                notesTextView,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
        availableSection.addView(notesScroller, matchWidthWrapHeight(topMarginDp = 8))
        card.addView(availableSection, matchWidthWrapHeight(topMarginDp = 14))

        // 5c. Downloading & verifying progress section
        downloadSection = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = palette.surfaceDrawable(density, radiusDp = 14f)
            setPadding(dp(16), dp(14), dp(16), dp(14))
            visibility = View.GONE
        }
        val statsRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.BOTTOM
        }
        percentTextView = TextView(context).apply {
            setTextColor(palette.badgeText)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 26f)
            typeface = Typeface.DEFAULT_BOLD
            includeFontPadding = false
        }
        statsRow.addView(
            percentTextView,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        bytesTextView = TextView(context).apply {
            setTextColor(palette.textSecondary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.END
        }
        statsRow.addView(
            bytesTextView,
            LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT,
                ViewGroup.LayoutParams.WRAP_CONTENT,
            ),
        )
        downloadSection.addView(statsRow, matchWidthWrapHeight())

        progressBarView = ThemedProgressBar(context, palette)
        downloadSection.addView(
            progressBarView,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(11)).apply {
                topMargin = dp(12)
            },
        )

        securityHintView = TextView(context).apply {
            setTextColor(palette.textSecondary)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setLineSpacing(dp(2).toFloat(), 1.15f)
        }
        downloadSection.addView(securityHintView, matchWidthWrapHeight(topMarginDp = 11))
        card.addView(downloadSection, matchWidthWrapHeight(topMarginDp = 14))

        // 6. Action buttons
        primaryActionView = buildButton(
            textColor = palette.primaryBtnText,
            background = palette.primaryButtonDrawable(density, radiusDp = BUTTON_RADIUS_DP.toFloat()),
        ) {
            onPrimaryClick?.invoke()
        }
        card.addView(primaryActionView, matchWidthWrapHeight(topMarginDp = 18))

        secondaryActionView = buildButton(
            textColor = palette.secondaryBtnText,
            background = palette.secondaryButtonDrawable(density, radiusDp = BUTTON_RADIUS_DP.toFloat()),
        ) {
            onSecondaryClick?.invoke()
        }
        card.addView(secondaryActionView, matchWidthWrapHeight(topMarginDp = 10))

        rootCard = card
        return card
    }

    private fun updateSecondaryTopMargin(hasPrimary: Boolean) {
        val params = secondaryActionView.layoutParams as? LinearLayout.LayoutParams ?: return
        params.topMargin = dp(if (hasPrimary) 10 else 18)
        secondaryActionView.layoutParams = params
    }

    private fun buildButton(
        textColor: Int,
        background: android.graphics.drawable.Drawable,
        onClick: () -> Unit,
    ): Button = Button(context).apply {
        isAllCaps = false
        setTextColor(textColor)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        typeface = Typeface.DEFAULT_BOLD
        gravity = Gravity.CENTER
        minHeight = dp(MIN_TOUCH_TARGET_DP)
        minimumHeight = dp(MIN_TOUCH_TARGET_DP)
        setPadding(dp(16), dp(12), dp(16), dp(12))
        this.background = background
        stateListAnimator = null
        isFocusable = true
        setOnClickListener { onClick() }
    }

    private fun matchWidthWrapHeight(topMarginDp: Int = 0): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply {
            if (topMarginDp > 0) topMargin = dp(topMarginDp)
        }

    private fun dp(value: Int): Int =
        (value * context.resources.displayMetrics.density + 0.5f).toInt()

    /**
     * Custom-drawn capsule progress bar matching the active Quareia theme,
     * avoiding native Android ProgressBar chrome across OS versions.
     */
    internal class ThemedProgressBar(
        context: Context,
        private val palette: ThemePalette,
    ) : View(context) {

        internal var fraction: Float = 0f
            private set
        internal var isIndeterminateMode: Boolean = false
            private set

        private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = palette.progressTrackBg
        }
        private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = max(1f, context.resources.displayMetrics.density)
            color = palette.progressTrackBorder
        }
        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
        }
        private val sheenPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            color = Color.argb(if (palette.isLight) 70 else 52, 255, 255, 255)
        }
        private val trackRect = RectF()
        private val fillRect = RectF()
        private val sheenRect = RectF()
        private val clipPath = Path()

        fun setProgressFraction(value: Float) {
            isIndeterminateMode = false
            fraction = value.coerceIn(0f, 1f)
            invalidate()
        }

        fun setIndeterminateMode(enabled: Boolean) {
            isIndeterminateMode = enabled
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            val w = width.toFloat()
            val h = height.toFloat()
            if (w <= 0f || h <= 0f) return

            val inset = strokePaint.strokeWidth / 2f
            trackRect.set(inset, inset, w - inset, h - inset)
            val radius = h / 2f

            canvas.drawRoundRect(trackRect, radius, radius, trackPaint)

            val saveCount = canvas.save()
            clipPath.reset()
            clipPath.addRoundRect(trackRect, radius, radius, Path.Direction.CW)
            canvas.clipPath(clipPath)

            if (isIndeterminateMode) {
                val segmentWidth = w * 0.42f
                val left = (w - segmentWidth) * 0.5f
                val right = left + segmentWidth
                fillRect.set(left, 0f, right, h)
                fillPaint.shader = LinearGradient(
                    left,
                    0f,
                    right,
                    0f,
                    intArrayOf(palette.progressFillStart, palette.progressFillEnd, palette.progressFillStart),
                    floatArrayOf(0f, 0.5f, 1f),
                    Shader.TileMode.CLAMP,
                )
                canvas.drawRoundRect(fillRect, radius, radius, fillPaint)
            } else if (fraction > 0f) {
                val fillWidth = max(h, w * fraction).coerceAtMost(w)
                fillRect.set(0f, 0f, fillWidth, h)
                fillPaint.shader = LinearGradient(
                    0f,
                    0f,
                    fillWidth,
                    0f,
                    intArrayOf(palette.progressFillStart, palette.progressFillMid, palette.progressFillEnd),
                    floatArrayOf(0f, 0.55f, 1f),
                    Shader.TileMode.CLAMP,
                )
                canvas.drawRoundRect(fillRect, radius, radius, fillPaint)
                sheenRect.set(0f, 0f, fillWidth, h * 0.46f)
                canvas.drawRect(sheenRect, sheenPaint)
            }

            canvas.restoreToCount(saveCount)
            canvas.drawRoundRect(trackRect, radius, radius, strokePaint)
        }
    }

    private class MaxHeightScrollView(
        context: Context,
        private val maxHeightPx: Int,
    ) : ScrollView(context) {
        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            val availableHeight = when (MeasureSpec.getMode(heightMeasureSpec)) {
                MeasureSpec.UNSPECIFIED -> maxHeightPx
                else -> min(MeasureSpec.getSize(heightMeasureSpec), maxHeightPx)
            }
            super.onMeasure(
                widthMeasureSpec,
                MeasureSpec.makeMeasureSpec(availableHeight, MeasureSpec.AT_MOST),
            )
        }
    }

    private companion object {
        const val WIDTH_FRACTION = 0.90f
        const val NOTES_HEIGHT_FRACTION = 0.30f
        const val MAX_WIDTH_DP = 520
        const val MIN_NOTES_HEIGHT_DP = 88
        const val MIN_TOUCH_TARGET_DP = 48
        const val CARD_RADIUS_DP = 20
        const val BUTTON_RADIUS_DP = 12
    }
}
