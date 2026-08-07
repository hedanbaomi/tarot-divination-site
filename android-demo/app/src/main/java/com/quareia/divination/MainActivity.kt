package com.quareia.divination

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File
import org.json.JSONObject
import java.util.UUID

/**
 * Hosts the bundled Quareia divination website inside an Android WebView,
 * served over a virtual HTTPS origin so that WebCrypto / fetch are available.
 *
 * The entire web app ships under `assets/www/` and is served by
 * `WebViewAssetLoader` from a secure virtual HTTPS origin.  LXXXI art is
 * exposed only as short-lived image responses on an opaque, per-process URL.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var homePageFinished = false
    private var backDispatchPending = false
    private var lxxxiRouteToken = ""
    private var pendingHistoryExportFile: File? = null
    private var pendingHistoryExportName: String? = null
    private val historyExportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri -> completeHistoryExport(uri) }

    internal companion object {
        internal const val HOME_URL = "https://appassets.androidplatform.net/assets/www/index.html"
        internal const val APP_HOST = "appassets.androidplatform.net"
        internal const val PROTECTED_PREFIX = "/_m/"
        private const val STATE_LXXXI_ROUTE_TOKEN = "lxxxiRouteToken"
        private const val STATE_HISTORY_EXPORT_PATH = "pendingHistoryExportPath"
        private const val STATE_HISTORY_EXPORT_NAME = "pendingHistoryExportName"
        private const val HISTORY_EXPORT_PREFIX = "quareia-history-export-"
        private val ROUTE_TOKEN_PATTERN = Regex("[0-9a-f]{32}")
        internal const val WEB_BACK_HANDLER =
            "(function(){return Boolean(window.DivinationUiBack && window.DivinationUiBack.handleBack && window.DivinationUiBack.handleBack());})()"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Preserve the capability URL across WebView state restoration. A
        // fresh launch still gets a new value, and every home-page reload is
        // reinjected below so stale DOM state cannot keep an invalid route.
        lxxxiRouteToken = savedInstanceState
            ?.getString(STATE_LXXXI_ROUTE_TOKEN)
            ?.takeIf(ROUTE_TOKEN_PATTERN::matches)
            ?: UUID.randomUUID().toString().replace("-", "")
        restorePendingHistoryExport(savedInstanceState)

        // Edge-to-edge with a dark, page-matching background (#090d1e from the site meta).
        WindowCompat.setDecorFitsSystemWindows(window, true)
        @Suppress("DEPRECATION")
        window.statusBarColor = Color.parseColor("#090d1e")
        @Suppress("DEPRECATION")
        window.navigationBarColor = Color.parseColor("#090d1e")
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false

        // Serve bundled assets over a virtual https origin. The default host
        // is treated as a secure context, which the web app needs for fetch().
        val publicAssetRoute = PublicWebAssetRoute(this)

        WebView.setWebContentsDebuggingEnabled(
            (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0,
        )

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#090d1e"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true            // localStorage powers the history feature
                loadWithOverviewMode = true
                useWideViewPort = true
                // Content is served via the asset loader over https; disable
                // raw file:// access as recommended by the WebView docs.
                allowFileAccess = false
                allowContentAccess = false
                @Suppress("DEPRECATION")
                allowFileAccessFromFileURLs = false
                @Suppress("DEPRECATION")
                allowUniversalAccessFromFileURLs = false
                mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                mediaPlaybackRequiresUserGesture = false
                setSupportZoom(false)
            }
            // Expose the anonymous, opt-out usage-statistics bridge. The page
            // calls it from completion hooks; it never reads card content.
            addJavascriptInterface(TelemetryBridge(), "androidTelemetry")
            // History export uses the Android system save picker so the user
            // chooses the destination instead of losing a WebView download.
            addJavascriptInterface(HistoryExportBridge(this@MainActivity), "androidHistoryExport")
            // The web menu opens the native attribution and privacy screen
            // through this narrowly scoped bridge. Native chrome does not sit
            // over the homepage anymore.
            addJavascriptInterface(AboutBridge(this@MainActivity), "androidAbout")

            webViewClient = QuareiaWebViewClient(
                publicAssetRoute,
                LxxxiAssetRoute(lxxxiRouteToken, LxxxiAssetProviderFactory.create()),
            )
            webChromeClient = WebChromeClient()
            scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
        }

        // Root layout: the WebView owns the homepage and its animated menu.
        // Keeping native chrome out of the page prevents a second, mismatched
        // navigation layer from covering the web UI.
        val root = FrameLayout(this).apply {
            setBackgroundColor(Color.parseColor("#090d1e"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )
        setContentView(root)
        installBackDispatcher()

        if (savedInstanceState == null) {
            webView.loadUrl(HOME_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onStart() {
        super.onStart()
        // Foreground signal for the active-version statistics; the controller
        // deduplicates to once per 6 hours per version and stays silent when
        // telemetry is off. Announcements are checked on launch and on every
        // return to the foreground (deduplicated to once per 6 hours; a
        // failure is silent and never affects the app).
        TelemetryController.recordAppActive()
        AnnouncementController.check { announcements ->
            AnnouncementPrompter(this).onAnnouncements(announcements)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_LXXXI_ROUTE_TOKEN, lxxxiRouteToken)
        pendingHistoryExportFile?.let {
            outState.putString(STATE_HISTORY_EXPORT_PATH, it.absolutePath)
            outState.putString(STATE_HISTORY_EXPORT_NAME, pendingHistoryExportName)
        }
        webView.saveState(outState)
    }

    /** Let the Web UI close its top overlay before falling back to WebView history. */
    private fun installBackDispatcher() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (backDispatchPending) return
                if (!this@MainActivity::webView.isInitialized) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    return
                }

                backDispatchPending = true
                try {
                    webView.evaluateJavascript(WEB_BACK_HANDLER) { handled ->
                        backDispatchPending = false
                        if (handled == "true") return@evaluateJavascript
                        if (webView.canGoBack()) {
                            webView.goBack()
                        } else {
                            isEnabled = false
                            onBackPressedDispatcher.onBackPressed()
                        }
                    }
                } catch (_error: Throwable) {
                    backDispatchPending = false
                    if (webView.canGoBack()) {
                        webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })
    }

    /**
     * Routes every request through the asset loader and hands http(s)/mailto/
     * tel links to the system. The asset loader returns null for paths it
     * doesn't own, which lets the WebView fall back to its default handling.
     */
    private inner class QuareiaWebViewClient(
        private val publicAssetRoute: PublicWebAssetRoute,
        private val lxxxiRoute: LxxxiAssetRoute,
    ) : WebViewClient() {

        override fun shouldInterceptRequest(
            view: WebView?,
            request: WebResourceRequest?
        ): WebResourceResponse? {
            val url = request?.url ?: return null
            if (lxxxiRoute.isProtectedRequest(url)) {
                return lxxxiRoute.response(assets, url, request.method)
            }
            return publicAssetRoute.response(url)
        }

        // Only the first completed load of the internal home page starts the
        // app-lifetime signals. WebView can call this for subresources and
        // repeated navigations; the controller also deduplicates in flight.
        override fun onPageFinished(view: WebView?, url: String?) {
            if (url != HOME_URL) return
            val homePage = view ?: return
            homePage.evaluateJavascript(
                "window.__qMediaBase = ${org.json.JSONObject.quote(protectedImageBaseUrl())};",
                null,
            )
            if (homePageFinished) return
            homePageFinished = true
            TelemetryController.recordInstallSeen()
            // First-launch active-version report (idempotent; the same
            // version is only re-reported after 6 hours). The v1.2 client
            // no longer sends the legacy daily_active event: app_active
            // supersedes it, and the worker still accepts daily_active from
            // older clients without ever downgrading a recorded version.
            TelemetryController.recordAppActive()
            // Silent startup update check: only a genuinely newer release
            // prompts anything; errors and up-to-date results stay quiet.
            UpdateManager.checkAndPrompt(this@MainActivity, manual = false)
        }

        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
        ): Boolean {
            val url = request?.url ?: return false
            val scheme = url.scheme?.lowercase()
            if (scheme == "http" || scheme == "https" || scheme == "mailto" || scheme == "tel") {
                // Only delegate genuinely external links; the virtual appassets
                // host is internal and must stay inside the WebView.
                if (url.host == "appassets.androidplatform.net") return false
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (_: ActivityNotFoundException) {
                    // No handler available — silently ignore in the demo.
                }
                return true
            }
            return false
        }
    }

    override fun onDestroy() {
        if (this::webView.isInitialized) {
            webView.removeJavascriptInterface("androidTelemetry")
            webView.removeJavascriptInterface("androidHistoryExport")
            webView.removeJavascriptInterface("androidAbout")
            webView.destroy()
        }
        if (!isChangingConfigurations) clearPendingHistoryExport()
        super.onDestroy()
    }

    /** Stage the JSON privately, then let the user choose its final location. */
    internal fun requestHistoryExport(json: String, requestedName: String) {
        if (pendingHistoryExportFile != null) return
        val fileName = normalizeHistoryExportName(requestedName)
        try {
            val staged = File.createTempFile(HISTORY_EXPORT_PREFIX, ".json", cacheDir)
            staged.writeText(json, Charsets.UTF_8)
            pendingHistoryExportFile = staged
            pendingHistoryExportName = fileName
            historyExportLauncher.launch(fileName)
        } catch (_error: Throwable) {
            pendingHistoryExportFile?.delete()
            pendingHistoryExportFile = null
            pendingHistoryExportName = null
            notifyHistoryExport(false, false, fileName)
        }
    }

    private fun completeHistoryExport(uri: Uri?) {
        val staged = pendingHistoryExportFile
        val requestedName = pendingHistoryExportName.orEmpty()
        pendingHistoryExportFile = null
        pendingHistoryExportName = null

        if (uri == null || staged == null) {
            staged?.delete()
            notifyHistoryExport(false, true, requestedName)
            return
        }

        try {
            val output = contentResolver.openOutputStream(uri, "w")
                ?: error("Could not open the selected destination")
            output.use { destination ->
                staged.inputStream().use { source -> source.copyTo(destination) }
            }
            staged.delete()
            notifyHistoryExport(true, false, selectedHistoryExportName(uri, requestedName))
        } catch (_error: Throwable) {
            staged.delete()
            notifyHistoryExport(false, false, requestedName)
        }
    }

    private fun selectedHistoryExportName(uri: Uri, fallback: String): String {
        return try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0).orEmpty() else ""
                }
                ?.takeIf(String::isNotBlank)
                ?: fallback
        } catch (_error: Throwable) {
            fallback
        }
    }

    private fun notifyHistoryExport(ok: Boolean, cancelled: Boolean, fileName: String) {
        if (!this::webView.isInitialized) return
        val script = "window.__quareiaHistoryExportResult && " +
            "window.__quareiaHistoryExportResult({" +
            "ok:$ok,cancelled:$cancelled,fileName:${JSONObject.quote(fileName)}" +
            "});"
        webView.evaluateJavascript(script, null)
    }

    private fun restorePendingHistoryExport(savedInstanceState: Bundle?) {
        val path = savedInstanceState?.getString(STATE_HISTORY_EXPORT_PATH) ?: return
        val name = savedInstanceState.getString(STATE_HISTORY_EXPORT_NAME).orEmpty()
        if (name.isBlank()) return
        try {
            val candidate = File(path).canonicalFile
            if (candidate.exists() && candidate.parentFile == cacheDir.canonicalFile) {
                pendingHistoryExportFile = candidate
                pendingHistoryExportName = name
            }
        } catch (_error: Throwable) {
            // A stale or invalid cache path is not allowed to affect launch.
        }
    }

    private fun clearPendingHistoryExport() {
        pendingHistoryExportFile?.delete()
        pendingHistoryExportFile = null
        pendingHistoryExportName = null
    }

    private fun normalizeHistoryExportName(requestedName: String): String {
        val basename = requestedName.substringAfterLast('/').substringAfterLast('\\')
        val cleaned = basename.replace(Regex("[^A-Za-z0-9._-]"), "-").trim('.')
        if (cleaned.isBlank()) return "tarot-history.json"
        return if (cleaned.endsWith(".json", ignoreCase = true)) cleaned else "$cleaned.json"
    }

    private fun protectedImageBaseUrl(): String =
        "https://${APP_HOST}${PROTECTED_PREFIX}${lxxxiRouteToken}"
}

/** Bridges the web export payload to Android's user-visible save picker. */
private class HistoryExportBridge(private val activity: MainActivity) {

    @android.webkit.JavascriptInterface
    fun save(json: String, fileName: String) {
        activity.runOnUiThread { activity.requestHistoryExport(json, fileName) }
    }
}

/** Opens the native attribution and telemetry settings screen from the web menu. */
private class AboutBridge(private val activity: ComponentActivity) {

    @android.webkit.JavascriptInterface
    fun open() {
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, AboutActivity::class.java))
        }
    }

    @android.webkit.JavascriptInterface
    fun setLocale(locale: String) {
        AppLocale.set(activity, locale)
    }
}

/** Serves only the public web bundle and explicitly rejects every other asset namespace. */
internal class PublicWebAssetRoute(context: Context) {
    private val loader: WebViewAssetLoader

    init {
        val publicAssets = WebViewAssetLoader.AssetsPathHandler(context)
        loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/www/") { path -> publicAssets.handle("www/$path") }
            .build()
    }

    internal fun response(uri: Uri): WebResourceResponse? {
        if (!uri.scheme.equals("https", ignoreCase = true) ||
            uri.host != MainActivity.APP_HOST ||
            uri.port != -1
        ) {
            return null
        }
        val segments = uri.pathSegments
        if (segments.firstOrNull() != "assets") return loader.shouldInterceptRequest(uri)
        if (segments.getOrNull(1) != "www") return notFound()
        if (segments.drop(2).any { segment ->
                segment == "." || segment == ".." ||
                    segment.contains('/') || segment.contains('\\')
            }
        ) {
            return notFound()
        }
        return loader.shouldInterceptRequest(uri) ?: notFound()
    }

    private fun notFound(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        "UTF-8",
        404,
        "Not Found",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)),
    )
}

/** Opaque image route that never exposes a native object to page JavaScript. */
internal class LxxxiAssetRoute(
    private val token: String,
    private val provider: LxxxiAssetProvider?,
) {
    private val baseHost = MainActivity.APP_HOST

    internal fun baseUrl(): String =
        "https://$baseHost${MainActivity.PROTECTED_PREFIX}$token"

    internal fun isProtectedRequest(uri: Uri): Boolean =
        uri.scheme.equals("https", ignoreCase = true) &&
            uri.host == baseHost &&
            uri.port == -1 &&
            uri.pathSegments.firstOrNull() == MainActivity.PROTECTED_PREFIX.trim('/')

    internal fun response(assets: android.content.res.AssetManager, uri: Uri, method: String): WebResourceResponse {
        if (!isProtectedRequest(uri) || method != "GET") return notFound()
        val segments = uri.pathSegments
        if (segments.size != 3 || segments[1] != token) return notFound()
        if (uri.query != null || uri.fragment != null) return notFound()
        val logicalKey = segments[2]
        if (!isAllowedLogicalKey(logicalKey)) return notFound()

        val bytes = try {
            provider?.open(assets, logicalKey)
        } catch (_: Throwable) {
            null
        }
        val imageBytes = bytes?.takeIf(::isValidWebp) ?: return notFound()

        return WebResourceResponse(
            "image/webp",
            null,
            200,
            "OK",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(imageBytes),
        )
    }

    internal fun isAllowedLogicalKey(logicalKey: String): Boolean =
        logicalKey == "lxxxi-back" || FACE_KEY_PATTERN.matches(logicalKey)

    internal fun isValidWebp(bytes: ByteArray): Boolean =
        bytes.size in WEBP_HEADER_SIZE..MAX_IMAGE_BYTES &&
            bytes[0] == 'R'.code.toByte() &&
            bytes[1] == 'I'.code.toByte() &&
            bytes[2] == 'F'.code.toByte() &&
            bytes[3] == 'F'.code.toByte() &&
            bytes[8] == 'W'.code.toByte() &&
            bytes[9] == 'E'.code.toByte() &&
            bytes[10] == 'B'.code.toByte() &&
            bytes[11] == 'P'.code.toByte()

    private fun notFound(): WebResourceResponse = WebResourceResponse(
        "text/plain",
        "UTF-8",
        404,
        "Not Found",
        mapOf("Cache-Control" to "no-store"),
        ByteArrayInputStream(ByteArray(0)),
    )

    private companion object {
        const val WEBP_HEADER_SIZE = 12
        const val MAX_IMAGE_BYTES = 4 * 1024 * 1024
        val FACE_KEY_PATTERN = Regex("lxxxi-(0[1-9]|[1-7][0-9]|8[01])")
    }
}
