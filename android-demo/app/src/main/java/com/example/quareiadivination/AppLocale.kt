package com.example.quareiadivination

import android.content.Context
import android.content.res.Configuration
import java.util.Locale

/**
 * Stores the user's explicit web-language choice and applies the same choice
 * to native screens. With no explicit choice, the app follows the system's
 * Chinese-versus-English language family selection.
 */
internal object AppLocale {
    const val PREFS = "quareia_ui"
    const val KEY_LOCALE = "locale"

    private fun normalize(value: String?): String? {
        val language = value?.trim()?.lowercase(Locale.ROOT) ?: return null
        return when {
            language == "zh" || language.startsWith("zh-") -> "zh-CN"
            language == "en" || language.startsWith("en-") -> "en"
            else -> null
        }
    }

    fun set(context: Context, value: String): Boolean {
        val normalized = normalize(value) ?: return false
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_LOCALE, normalized)
            .apply()
        return true
    }

    fun contextFor(context: Context): Context {
        val preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val stored = normalize(preferences.getString(KEY_LOCALE, null))
        val language = stored ?: systemLanguage(context)
        val configuration = Configuration(context.resources.configuration)
        configuration.setLocale(Locale.forLanguageTag(language))
        return context.createConfigurationContext(configuration)
    }

    private fun systemLanguage(context: Context): String {
        val locales = context.resources.configuration.locales
        val systemLanguage = if (!locales.isEmpty) locales[0].language else ""
        return if (systemLanguage.equals("zh", ignoreCase = true)) "zh-CN" else "en"
    }
}
