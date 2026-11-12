package com.quareia.divination

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.util.StateSet
import android.view.Window
import androidx.core.view.WindowCompat
import java.util.Locale

/**
 * Mirrors the bundled web themes on the Android native layer so update dialogs,
 * announcement dialogs, and the native About / Announcements screens match
 * the user's chosen aesthetic without exposing any new WebView bridge surface.
 */
internal enum class ThemeId(val wireId: String) {
    CELESTIAL("celestial"),
    PARCHMENT("parchment"),
    EMBER("ember"),
    GROVE("grove"), // classic and the bright Grove variant use the same palette
    DARK_GROVE("dark-grove"),
    JADE("jade"),
    DUSK("dusk"),
    ASH("ash");

    companion object {
        fun fromId(raw: String?): ThemeId =
            entries.firstOrNull { it.wireId == raw?.trim()?.lowercase(Locale.ROOT) } ?: CELESTIAL

        fun fromChromeSignal(colorHex: String?, isLight: Boolean): ThemeId {
            return when (colorHex?.trim()?.lowercase(Locale.ROOT)) {
                "#efe4cc" -> PARCHMENT
                "#140a08" -> EMBER
                "#31483c", "#07140f" -> GROVE
                "#0d1511" -> DARK_GROVE
                "#eef1e9" -> JADE
                "#140f1e" -> DUSK
                "#121214" -> ASH
                "#060919" -> CELESTIAL
                else -> if (isLight) PARCHMENT else CELESTIAL
            }
        }
    }
}

/** Complete native chrome token set for one Quareia theme. */
internal data class ThemePalette(
    val id: ThemeId,
    val isLight: Boolean,
    val dimAmount: Float,
    val pageTopBg: Int,
    val pageBg: Int,
    val cardTopBg: Int,
    val cardBottomBg: Int,
    val cardBorder: Int,
    val cardStrokeDp: Float,
    val surfaceBg: Int,
    val surfaceBorder: Int,
    val accent: Int,
    val accentLight: Int,
    val textPrimary: Int,
    val textSecondary: Int,
    val badgeBg: Int,
    val badgeBorder: Int,
    val badgeText: Int,
    val primaryBtnStart: Int,
    val primaryBtnMid: Int,
    val primaryBtnEnd: Int,
    val primaryBtnPressedStart: Int,
    val primaryBtnPressedEnd: Int,
    val primaryBtnBorder: Int,
    val primaryBtnStrokeDp: Float,
    val primaryBtnText: Int,
    val secondaryBtnBg: Int,
    val secondaryBtnPressedBg: Int,
    val secondaryBtnBorder: Int,
    val secondaryBtnStrokeDp: Float,
    val secondaryBtnText: Int,
    val progressTrackBg: Int,
    val progressTrackBorder: Int,
    val progressFillStart: Int,
    val progressFillMid: Int,
    val progressFillEnd: Int,
) {
    fun pageGradientDrawable(): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TOP_BOTTOM,
        intArrayOf(pageTopBg, pageBg, pageBg),
    )

    fun cardDrawable(density: Float, radiusDp: Float = 20f): GradientDrawable = GradientDrawable(
        GradientDrawable.Orientation.TL_BR,
        intArrayOf(cardTopBg, cardBottomBg),
    ).apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = radiusDp * density
        setStroke(strokePx(cardStrokeDp, density), cardBorder)
    }

    fun surfaceDrawable(density: Float, radiusDp: Float = 12f): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(surfaceBg)
            cornerRadius = radiusDp * density
            setStroke(strokePx(1f, density), surfaceBorder)
        }

    fun badgeDrawable(density: Float, radiusDp: Float = 999f): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(badgeBg)
            cornerRadius = radiusDp * density
            setStroke(strokePx(1f, density), badgeBorder)
        }

    fun primaryButtonDrawable(density: Float, radiusDp: Float = 12f): StateListDrawable {
        val normal = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(primaryBtnStart, primaryBtnMid, primaryBtnEnd),
        ).apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radiusDp * density
            setStroke(strokePx(primaryBtnStrokeDp, density), primaryBtnBorder)
        }
        val pressed = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(primaryBtnPressedStart, primaryBtnPressedEnd),
        ).apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radiusDp * density
            setStroke(strokePx(primaryBtnStrokeDp, density), primaryBtnBorder)
        }
        val disabled = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(withAlpha(primaryBtnMid, 110), withAlpha(primaryBtnEnd, 110)),
        ).apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radiusDp * density
            setStroke(strokePx(1f, density), withAlpha(primaryBtnBorder, 96))
        }
        return StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), disabled)
            addState(intArrayOf(android.R.attr.state_pressed), pressed)
            addState(StateSet.WILD_CARD, normal)
        }
    }

    fun secondaryButtonDrawable(density: Float, radiusDp: Float = 12f): StateListDrawable {
        val normal = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(secondaryBtnBg)
            cornerRadius = radiusDp * density
            setStroke(strokePx(secondaryBtnStrokeDp, density), secondaryBtnBorder)
        }
        val pressed = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(secondaryBtnPressedBg)
            cornerRadius = radiusDp * density
            setStroke(strokePx(secondaryBtnStrokeDp, density), secondaryBtnBorder)
        }
        val disabled = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(withAlpha(secondaryBtnBg, 96))
            cornerRadius = radiusDp * density
            setStroke(strokePx(1f, density), withAlpha(secondaryBtnBorder, 72))
        }
        return StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), disabled)
            addState(intArrayOf(android.R.attr.state_pressed), pressed)
            addState(StateSet.WILD_CARD, normal)
        }
    }

    fun switchThumbTintList(): ColorStateList = ColorStateList(
        arrayOf(
            intArrayOf(android.R.attr.state_checked),
            StateSet.WILD_CARD,
        ),
        intArrayOf(accent, textSecondary),
    )

    fun switchTrackTintList(): ColorStateList = ColorStateList(
        arrayOf(
            intArrayOf(android.R.attr.state_checked),
            StateSet.WILD_CARD,
        ),
        intArrayOf(withAlpha(accent, if (isLight) 110 else 130), withAlpha(textSecondary, 75)),
    )

    private fun strokePx(dpValue: Float, density: Float): Int =
        (dpValue * density + 0.5f).toInt().coerceAtLeast(1)

    private fun withAlpha(color: Int, alpha: Int): Int =
        Color.argb(alpha.coerceIn(0, 255), Color.red(color), Color.green(color), Color.blue(color))
}

internal object AppTheme {
    const val KEY_THEME = "theme"

    fun currentId(context: Context): ThemeId {
        val raw = context.getSharedPreferences(AppLocale.PREFS, Context.MODE_PRIVATE)
            .getString(KEY_THEME, null)
        return ThemeId.fromId(raw)
    }

    fun set(context: Context, id: ThemeId) {
        context.getSharedPreferences(AppLocale.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_THEME, id.wireId)
            .apply()
    }

    fun recordFromChromeColor(context: Context, colorHex: String?, isLight: Boolean): ThemeId {
        val resolved = ThemeId.fromChromeSignal(colorHex, isLight)
        set(context, resolved)
        return resolved
    }

    fun paletteFor(context: Context): ThemePalette = palette(currentId(context))

    fun applySystemBars(window: Window, palette: ThemePalette) {
        @Suppress("DEPRECATION")
        window.statusBarColor = palette.pageBg
        @Suppress("DEPRECATION")
        window.navigationBarColor = palette.pageBg
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = palette.isLight
        controller.isAppearanceLightNavigationBars = palette.isLight
    }

    private fun modernPalette(
        id: ThemeId, pageHex: String, surfaceHex: String, raisedHex: String,
        accentHex: String, textHex: String, mutedHex: String, light: Boolean = false,
    ): ThemePalette {
        val page = Color.parseColor(pageHex)
        val surface = Color.parseColor(surfaceHex)
        val raised = Color.parseColor(raisedHex)
        val accent = Color.parseColor(accentHex)
        val text = Color.parseColor(textHex)
        val muted = Color.parseColor(mutedHex)
        val line = Color.argb(120, Color.red(accent), Color.green(accent), Color.blue(accent))
        return palette(if (light) ThemeId.PARCHMENT else ThemeId.CELESTIAL).copy(
            id = id, pageTopBg = surface, pageBg = page, cardTopBg = raised, cardBottomBg = surface,
            cardBorder = line, surfaceBg = raised, surfaceBorder = line,
            accent = accent, accentLight = accent, textPrimary = text, textSecondary = muted,
            badgeBg = raised, badgeBorder = line, badgeText = accent,
            primaryBtnStart = accent, primaryBtnMid = accent, primaryBtnEnd = accent,
            primaryBtnPressedStart = muted, primaryBtnPressedEnd = muted, primaryBtnText = page,
            primaryBtnBorder = accent, secondaryBtnBg = surface, secondaryBtnPressedBg = raised,
            secondaryBtnBorder = line, secondaryBtnText = text, progressTrackBg = raised,
            progressTrackBorder = line, progressFillStart = muted, progressFillMid = accent, progressFillEnd = accent,
        )
    }

    fun palette(id: ThemeId): ThemePalette = when (id) {
        ThemeId.DARK_GROVE -> modernPalette(id, "#0d1511", "#16211b", "#1b2821", "#c8b174", "#e9ecd9", "#b3b9a1")
        ThemeId.JADE -> modernPalette(id, "#eef1e9", "#f8faf5", "#f1f5ec", "#2f6b58", "#1a2a24", "#46584f", light = true)
        ThemeId.DUSK -> modernPalette(id, "#140f1e", "#1a1426", "#211a2e", "#b8a2e6", "#ece7f6", "#b6aec9")
        ThemeId.ASH -> modernPalette(id, "#121214", "#17171a", "#1d1d21", "#cfc9ba", "#e8e5df", "#b0aca4")
        ThemeId.CELESTIAL -> ThemePalette(
            id = ThemeId.CELESTIAL,
            isLight = false,
            dimAmount = 0.76f,
            pageTopBg = Color.rgb(0x13, 0x1B, 0x44),
            pageBg = Color.rgb(0x06, 0x09, 0x19),
            cardTopBg = Color.rgb(0x1B, 0x23, 0x4E),
            cardBottomBg = Color.rgb(0x0A, 0x0E, 0x25),
            cardBorder = Color.argb(122, 0xD8, 0xB3, 0x6A),
            cardStrokeDp = 1.2f,
            surfaceBg = Color.rgb(0x11, 0x17, 0x38),
            surfaceBorder = Color.argb(68, 0xD8, 0xB3, 0x6A),
            accent = Color.rgb(0xD8, 0xB3, 0x6A),
            accentLight = Color.rgb(0xF2, 0xDD, 0xA6),
            textPrimary = Color.rgb(0xF1, 0xEB, 0xDB),
            textSecondary = Color.rgb(0xA6, 0xAE, 0xD0),
            badgeBg = Color.argb(38, 0xD8, 0xB3, 0x6A),
            badgeBorder = Color.argb(98, 0xD8, 0xB3, 0x6A),
            badgeText = Color.rgb(0xF2, 0xDD, 0xA6),
            primaryBtnStart = Color.rgb(0xF0, 0xD5, 0x9A),
            primaryBtnMid = Color.rgb(0xD8, 0xB3, 0x6A),
            primaryBtnEnd = Color.rgb(0xB8, 0x90, 0x4A),
            primaryBtnPressedStart = Color.rgb(0xE2, 0xC2, 0x80),
            primaryBtnPressedEnd = Color.rgb(0xA6, 0x7E, 0x3B),
            primaryBtnBorder = Color.rgb(0xF2, 0xDD, 0xA6),
            primaryBtnStrokeDp = 1f,
            primaryBtnText = Color.rgb(0x24, 0x1A, 0x06),
            secondaryBtnBg = Color.argb(150, 0x1C, 0x24, 0x50),
            secondaryBtnPressedBg = Color.argb(205, 0x25, 0x30, 0x66),
            secondaryBtnBorder = Color.argb(96, 0xD8, 0xB3, 0x6A),
            secondaryBtnStrokeDp = 1f,
            secondaryBtnText = Color.rgb(0xC6, 0xCC, 0xE6),
            progressTrackBg = Color.rgb(0x0B, 0x10, 0x2C),
            progressTrackBorder = Color.argb(80, 0xD8, 0xB3, 0x6A),
            progressFillStart = Color.rgb(0xB8, 0x90, 0x4A),
            progressFillMid = Color.rgb(0xD8, 0xB3, 0x6A),
            progressFillEnd = Color.rgb(0xF5, 0xE3, 0xB3),
        )

        ThemeId.PARCHMENT -> ThemePalette(
            id = ThemeId.PARCHMENT,
            isLight = true,
            dimAmount = 0.50f,
            pageTopBg = Color.rgb(0xFF, 0xF6, 0xE4),
            pageBg = Color.rgb(0xEF, 0xE4, 0xCC),
            cardTopBg = Color.rgb(0xFF, 0xFC, 0xF4),
            cardBottomBg = Color.rgb(0xF4, 0xE8, 0xD0),
            cardBorder = Color.argb(120, 0x7A, 0x5A, 0x28),
            cardStrokeDp = 1.2f,
            surfaceBg = Color.rgb(0xF7, 0xED, 0xD6),
            surfaceBorder = Color.argb(72, 0x7A, 0x5A, 0x28),
            accent = Color.rgb(0x7A, 0x5A, 0x28),
            accentLight = Color.rgb(0x5C, 0x43, 0x18),
            textPrimary = Color.rgb(0x2A, 0x24, 0x18),
            textSecondary = Color.rgb(0x6A, 0x5E, 0x48),
            badgeBg = Color.argb(46, 0xC4, 0xA0, 0x56),
            badgeBorder = Color.argb(98, 0x7A, 0x5A, 0x28),
            badgeText = Color.rgb(0x5C, 0x43, 0x18),
            primaryBtnStart = Color.rgb(0xE8, 0xD0, 0x9A),
            primaryBtnMid = Color.rgb(0xC4, 0xA0, 0x56),
            primaryBtnEnd = Color.rgb(0x9A, 0x74, 0x38),
            primaryBtnPressedStart = Color.rgb(0xDA, 0xBE, 0x82),
            primaryBtnPressedEnd = Color.rgb(0x88, 0x64, 0x2D),
            primaryBtnBorder = Color.rgb(0x9A, 0x74, 0x38),
            primaryBtnStrokeDp = 1f,
            primaryBtnText = Color.rgb(0x2A, 0x1C, 0x08),
            secondaryBtnBg = Color.rgb(0xFF, 0xF8, 0xEC),
            secondaryBtnPressedBg = Color.rgb(0xF1, 0xE2, 0xC4),
            secondaryBtnBorder = Color.argb(104, 0x7A, 0x5A, 0x28),
            secondaryBtnStrokeDp = 1f,
            secondaryBtnText = Color.rgb(0x5C, 0x43, 0x18),
            progressTrackBg = Color.rgb(0xE7, 0xD7, 0xB4),
            progressTrackBorder = Color.argb(86, 0x7A, 0x5A, 0x28),
            progressFillStart = Color.rgb(0x9A, 0x74, 0x38),
            progressFillMid = Color.rgb(0xC4, 0xA0, 0x56),
            progressFillEnd = Color.rgb(0xDE, 0xBD, 0x76),
        )

        ThemeId.EMBER -> ThemePalette(
            id = ThemeId.EMBER,
            isLight = false,
            dimAmount = 0.78f,
            pageTopBg = Color.rgb(0x3A, 0x1C, 0x12),
            pageBg = Color.rgb(0x14, 0x0A, 0x08),
            cardTopBg = Color.rgb(0x2E, 0x16, 0x10),
            cardBottomBg = Color.rgb(0x12, 0x08, 0x06),
            cardBorder = Color.argb(122, 0xE0, 0x8A, 0x48),
            cardStrokeDp = 1.2f,
            surfaceBg = Color.rgb(0x21, 0x0F, 0x0B),
            surfaceBorder = Color.argb(70, 0xE0, 0x8A, 0x48),
            accent = Color.rgb(0xE0, 0x8A, 0x48),
            accentLight = Color.rgb(0xF3, 0xC4, 0x9A),
            textPrimary = Color.rgb(0xF6, 0xE8, 0xD8),
            textSecondary = Color.rgb(0xC4, 0xA0, 0x90),
            badgeBg = Color.argb(40, 0xE0, 0x8A, 0x48),
            badgeBorder = Color.argb(100, 0xE0, 0x8A, 0x48),
            badgeText = Color.rgb(0xF3, 0xC4, 0x9A),
            primaryBtnStart = Color.rgb(0xF0, 0xB0, 0x78),
            primaryBtnMid = Color.rgb(0xE0, 0x8A, 0x48),
            primaryBtnEnd = Color.rgb(0xB0, 0x5A, 0x28),
            primaryBtnPressedStart = Color.rgb(0xE0, 0x9B, 0x62),
            primaryBtnPressedEnd = Color.rgb(0x98, 0x49, 0x1E),
            primaryBtnBorder = Color.rgb(0xF3, 0xC4, 0x9A),
            primaryBtnStrokeDp = 1f,
            primaryBtnText = Color.rgb(0x2A, 0x12, 0x08),
            secondaryBtnBg = Color.argb(155, 0x2E, 0x18, 0x10),
            secondaryBtnPressedBg = Color.argb(210, 0x3D, 0x20, 0x16),
            secondaryBtnBorder = Color.argb(98, 0xE0, 0x8A, 0x48),
            secondaryBtnStrokeDp = 1f,
            secondaryBtnText = Color.rgb(0xDC, 0xBA, 0xA8),
            progressTrackBg = Color.rgb(0x18, 0x0B, 0x08),
            progressTrackBorder = Color.argb(80, 0xE0, 0x8A, 0x48),
            progressFillStart = Color.rgb(0xB0, 0x5A, 0x28),
            progressFillMid = Color.rgb(0xE0, 0x8A, 0x48),
            progressFillEnd = Color.rgb(0xF6, 0xC5, 0x96),
        )

        ThemeId.GROVE -> ThemePalette(
            id = ThemeId.GROVE,
            isLight = false,
            dimAmount = 0.64f,
            pageTopBg = Color.rgb(0x58, 0x70, 0x58),
            pageBg = Color.rgb(0x31, 0x48, 0x3C),
            cardTopBg = Color.rgb(0x4B, 0x60, 0x4D),
            cardBottomBg = Color.rgb(0x34, 0x4B, 0x3C),
            cardBorder = Color.rgb(0xE2, 0xC2, 0x70),
            cardStrokeDp = 1.5f,
            surfaceBg = Color.rgb(0x2C, 0x43, 0x35),
            surfaceBorder = Color.argb(110, 0xE2, 0xC2, 0x70),
            accent = Color.rgb(0xDC, 0xC3, 0x84),
            accentLight = Color.rgb(0xF2, 0xE3, 0xB7),
            textPrimary = Color.rgb(0xF2, 0xF3, 0xE7),
            textSecondary = Color.rgb(0xCC, 0xD7, 0xC2),
            badgeBg = Color.argb(180, 0x1F, 0x44, 0x35),
            badgeBorder = Color.rgb(0xE2, 0xC2, 0x70),
            badgeText = Color.rgb(0xFF, 0xF0, 0xC7),
            primaryBtnStart = Color.rgb(0x3F, 0x60, 0x45),
            primaryBtnMid = Color.rgb(0x2D, 0x4C, 0x37),
            primaryBtnEnd = Color.rgb(0x20, 0x3D, 0x2C),
            primaryBtnPressedStart = Color.rgb(0x34, 0x52, 0x3A),
            primaryBtnPressedEnd = Color.rgb(0x19, 0x32, 0x24),
            primaryBtnBorder = Color.rgb(0xF7, 0xE4, 0xA6),
            primaryBtnStrokeDp = 1.5f,
            primaryBtnText = Color.rgb(0xFF, 0xF0, 0xC7),
            secondaryBtnBg = Color.rgb(0x1C, 0x40, 0x32),
            secondaryBtnPressedBg = Color.rgb(0x25, 0x52, 0x40),
            secondaryBtnBorder = Color.rgb(0xE2, 0xC2, 0x70),
            secondaryBtnStrokeDp = 1.5f,
            secondaryBtnText = Color.rgb(0xF2, 0xE3, 0xB7),
            progressTrackBg = Color.rgb(0x20, 0x36, 0x2B),
            progressTrackBorder = Color.argb(140, 0xE2, 0xC2, 0x70),
            progressFillStart = Color.rgb(0xBB, 0xA2, 0x64),
            progressFillMid = Color.rgb(0xE2, 0xC2, 0x70),
            progressFillEnd = Color.rgb(0xF7, 0xE4, 0xA6),
        )
    }
}
