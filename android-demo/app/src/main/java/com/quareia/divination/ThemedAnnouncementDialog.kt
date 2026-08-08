package com.quareia.divination

import android.app.Dialog
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
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
import kotlin.math.min

/** Star-night themed presentation for one important or update announcement. */
internal class ThemedAnnouncementDialog(
    activity: ComponentActivity,
    private val severityLabel: String,
    private val announcementTitle: String,
    private val announcementBody: String,
    private val laterText: String,
    private val primaryActionText: String? = null,
    private val onPrimaryAction: (() -> Unit)? = null,
) : Dialog(activity) {

    internal lateinit var severityTextView: TextView
        private set
    internal lateinit var titleTextView: TextView
        private set
    internal lateinit var bodyTextView: TextView
        private set
    internal lateinit var laterActionView: Button
        private set
    internal var primaryActionView: Button? = null
        private set

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestWindowFeature(Window.FEATURE_NO_TITLE)
        setCanceledOnTouchOutside(false)
        setContentView(buildContent())

        window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            attributes = attributes.apply { dimAmount = DIM_AMOUNT }
        }
    }

    override fun onStart() {
        super.onStart()
        val metrics = context.resources.displayMetrics
        val desiredWidth = (metrics.widthPixels * WIDTH_FRACTION).toInt()
        window?.setLayout(min(desiredWidth, dp(MAX_WIDTH_DP)), ViewGroup.LayoutParams.WRAP_CONTENT)
    }

    private fun buildContent(): View {
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(22), dp(24), dp(20))
            background = roundedBackground(CARD_COLOR, CARD_RADIUS_DP, BORDER_COLOR, 1)
        }

        severityTextView = TextView(context).apply {
            text = severityLabel
            setTextColor(GOLD_COLOR)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.08f
        }
        card.addView(severityTextView, matchWidthWrapHeight())

        titleTextView = TextView(context).apply {
            text = announcementTitle
            setTextColor(PRIMARY_TEXT_COLOR)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            typeface = Typeface.DEFAULT_BOLD
            setLineSpacing(0f, 1.12f)
        }
        ViewCompat.setAccessibilityHeading(titleTextView, true)
        card.addView(titleTextView, matchWidthWrapHeight(topMarginDp = 10))

        bodyTextView = TextView(context).apply {
            text = announcementBody
            setTextColor(PRIMARY_TEXT_COLOR)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setLineSpacing(dp(4).toFloat(), 1.12f)
        }
        val maxBodyHeight = (context.resources.displayMetrics.heightPixels * BODY_HEIGHT_FRACTION)
            .toInt()
            .coerceAtLeast(dp(MIN_BODY_HEIGHT_DP))
        val bodyScroller = MaxHeightScrollView(context, maxBodyHeight).apply {
            isFillViewport = false
            isVerticalScrollBarEnabled = true
            addView(
                bodyTextView,
                ViewGroup.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.WRAP_CONTENT,
                ),
            )
        }
        card.addView(bodyScroller, matchWidthWrapHeight(topMarginDp = 14))

        primaryActionText?.takeIf { it.isNotBlank() }?.let { label ->
            primaryActionView = actionButton(
                label = label,
                textColor = PAGE_BACKGROUND_COLOR,
                background = roundedBackground(GOLD_COLOR, BUTTON_RADIUS_DP),
            ) {
                onPrimaryAction?.invoke()
                dismiss()
            }
            card.addView(primaryActionView, matchWidthWrapHeight(topMarginDp = 20))
        }

        laterActionView = actionButton(
            label = laterText,
            textColor = MUTED_TEXT_COLOR,
            background = roundedBackground(
                color = Color.TRANSPARENT,
                radiusDp = BUTTON_RADIUS_DP,
                strokeColor = BUTTON_BORDER_COLOR,
                strokeWidthDp = 1,
            ),
        ) { dismiss() }
        card.addView(
            laterActionView,
            matchWidthWrapHeight(topMarginDp = if (primaryActionView == null) 20 else 10),
        )

        return card
    }

    private fun actionButton(
        label: String,
        textColor: Int,
        background: GradientDrawable,
        onClick: () -> Unit,
    ): Button = Button(context).apply {
        text = label
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

    private fun roundedBackground(
        color: Int,
        radiusDp: Int,
        strokeColor: Int? = null,
        strokeWidthDp: Int = 0,
    ): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(color)
        cornerRadius = dp(radiusDp).toFloat()
        if (strokeColor != null && strokeWidthDp > 0) {
            setStroke(dp(strokeWidthDp), strokeColor)
        }
    }

    private fun dp(value: Int): Int =
        (value * context.resources.displayMetrics.density + 0.5f).toInt()

    private class MaxHeightScrollView(
        context: android.content.Context,
        private val maxHeightPx: Int,
    ) : ScrollView(context) {
        override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
            val availableHeight = when (View.MeasureSpec.getMode(heightMeasureSpec)) {
                View.MeasureSpec.UNSPECIFIED -> maxHeightPx
                else -> min(View.MeasureSpec.getSize(heightMeasureSpec), maxHeightPx)
            }
            super.onMeasure(
                widthMeasureSpec,
                View.MeasureSpec.makeMeasureSpec(availableHeight, View.MeasureSpec.AT_MOST),
            )
        }
    }

    private companion object {
        const val WIDTH_FRACTION = 0.88f
        const val BODY_HEIGHT_FRACTION = 0.35f
        const val DIM_AMOUNT = 0.72f
        const val MAX_WIDTH_DP = 560
        const val MIN_BODY_HEIGHT_DP = 96
        const val MIN_TOUCH_TARGET_DP = 48
        const val CARD_RADIUS_DP = 18
        const val BUTTON_RADIUS_DP = 12

        val PAGE_BACKGROUND_COLOR = Color.rgb(0x09, 0x0D, 0x1E)
        val CARD_COLOR = Color.rgb(0x14, 0x16, 0x33)
        val PRIMARY_TEXT_COLOR = Color.rgb(0xE8, 0xE6, 0xF0)
        val GOLD_COLOR = Color.rgb(0xC9, 0xA8, 0x6A)
        val MUTED_TEXT_COLOR = Color.rgb(0x9A, 0x97, 0xAE)
        val BORDER_COLOR = Color.argb(112, 0xC9, 0xA8, 0x6A)
        val BUTTON_BORDER_COLOR = Color.argb(88, 0xC9, 0xA8, 0x6A)
    }
}
