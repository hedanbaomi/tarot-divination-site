package com.quareia.divination

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.util.Base64
import android.view.View
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient.FileChooserParams
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.File
import java.lang.ref.WeakReference
import org.json.JSONObject
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

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
    // JavaScript interface calls arrive on the WebView's bridge thread. Reserve
    // the shared picker before writing anything to cache.
    private lateinit var exportReserved: AtomicBoolean
    @Volatile private var exportPage = 0
    private var pendingExport: PendingExport? = null

    internal class ExportReservation : ViewModel() {
        val busy = AtomicBoolean()
    }

    private enum class ExportKind(val extension: String) {
        JSON(".json"), MARKDOWN(".md"), PNG(".png"),
    }

    private data class PendingExport(
        val file: File?,
        val name: String,
        val kind: ExportKind,
        val page: Int?,
    )
    private val webFileChooser: WebFileChooser = WebFileChooser(
        registerForActivityResult(OpenDocumentForWebViewContract) { uris ->
            // A result that arrives after onDestroy has nowhere to go;
            // deliver() ignores it.
            webFileChooser.deliver(uris)
        }
    )
    private val historyExportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri -> completeExport(ExportKind.JSON, uri) }
    private val markdownExportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("text/markdown")
    ) { uri -> completeExport(ExportKind.MARKDOWN, uri) }
    private val pngExportLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("image/png")
    ) { uri -> completeExport(ExportKind.PNG, uri) }

    internal enum class NavigationAction {
        ALLOW_IN_WEBVIEW,
        OPEN_EXTERNAL,
        BLOCK,
    }

    internal companion object {
        internal const val HOME_URL = "https://appassets.androidplatform.net/assets/www/index.html"
        internal const val CLASSIC_URL = "https://appassets.androidplatform.net/assets/www/classic.html"
        internal const val AI_URL = "https://appassets.androidplatform.net/assets/www/ai.html"

        internal fun isReadingPage(url: String?): Boolean =
            url == HOME_URL ||
                url == CLASSIC_URL ||
                url == "$HOME_URL?view=modern" ||
                url == AI_URL ||
                (url != null && url.startsWith("$AI_URL?"))

        internal const val APP_HOST = "appassets.androidplatform.net"
        internal const val PROTECTED_PREFIX = "/_m/"

        internal fun classifyNavigation(url: Uri?): NavigationAction {
            if (url == null) return NavigationAction.BLOCK
            val scheme = url.scheme?.lowercase(Locale.ROOT) ?: return NavigationAction.BLOCK
            val host = url.host?.lowercase(Locale.ROOT)
            if ((scheme == "http" || scheme == "https") && host == APP_HOST) {
                val path = url.path.orEmpty()
                return if (
                    scheme == "https" &&
                    url.port == -1 &&
                    path.startsWith("/assets/www/") &&
                    url.pathSegments.none { it == "." || it == ".." }
                ) {
                    NavigationAction.ALLOW_IN_WEBVIEW
                } else {
                    NavigationAction.BLOCK
                }
            }
            if (scheme == "file") {
                val path = url.path.orEmpty()
                return if (
                    host.isNullOrEmpty() &&
                    path.startsWith("/android_asset/") &&
                    url.pathSegments.none { it == "." || it == ".." }
                ) {
                    NavigationAction.ALLOW_IN_WEBVIEW
                } else {
                    NavigationAction.BLOCK
                }
            }
            if (scheme == "http" || scheme == "https" || scheme == "mailto" || scheme == "tel") {
                return NavigationAction.OPEN_EXTERNAL
            }
            return NavigationAction.BLOCK
        }
        private const val STATE_LXXXI_ROUTE_TOKEN = "lxxxiRouteToken"
        private const val STATE_HISTORY_EXPORT_PATH = "pendingHistoryExportPath"
        private const val STATE_HISTORY_EXPORT_NAME = "pendingHistoryExportName"
        private const val HISTORY_EXPORT_PREFIX = "quareia-history-export-"
        internal const val MAX_PNG_EXPORT_BYTES = 16 * 1024 * 1024
        private const val MAX_PNG_BASE64_LENGTH = (MAX_PNG_EXPORT_BYTES + 2) / 3 * 4
        private val PNG_SIGNATURE = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
        private val EXPORT_NAME_UNSAFE = Regex("[^A-Za-z0-9._-]")
        private val ROUTE_TOKEN_PATTERN = Regex("[0-9a-f]{32}")
        internal const val WEB_BACK_HANDLER =
            "(function(){return Boolean(window.DivinationUiBack && window.DivinationUiBack.handleBack && window.DivinationUiBack.handleBack());})()"

        private fun writeExport(resolver: ContentResolver, export: PendingExport, uri: Uri): String {
            // The URI comes from the user's CreateDocument result.
            check(uri.scheme == "content")
            val staged = checkNotNull(export.file)
            val output = resolver.openOutputStream(uri, "w")
                ?: error("Could not open the selected destination")
            output.use { destination ->
                staged.inputStream().use { source -> source.copyTo(destination) }
            }
            return try {
                resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                    ?.use { cursor ->
                        if (cursor.moveToFirst()) cursor.getString(0).orEmpty() else ""
                    }
                    ?.takeIf(String::isNotBlank)
                    ?: export.name
            } catch (_: Exception) {
                export.name
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A recreated activity shares the reservation while the original
        // request is still writing to its selected document.
        exportReserved = ViewModelProvider(this)[ExportReservation::class.java].busy

        // Preserve the capability URL across WebView state restoration. A
        // fresh launch still gets a new value, and every home-page reload is
        // reinjected below so stale DOM state cannot keep an invalid route.
        lxxxiRouteToken = savedInstanceState
            ?.getString(STATE_LXXXI_ROUTE_TOKEN)
            ?.takeIf(ROUTE_TOKEN_PATTERN::matches)
            ?: UUID.randomUUID().toString().replace("-", "")
        restorePendingExport(savedInstanceState)

        // Edge-to-edge; start with the persisted theme so cold start matches.
        val initialPalette = AppTheme.paletteFor(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        AppTheme.applySystemBars(window, initialPalette)

        // Serve bundled assets over a virtual https origin. The default host
        // is treated as a secure context, which the web app needs for fetch().
        val publicAssetRoute = PublicWebAssetRoute(this)

        WebView.setWebContentsDebuggingEnabled(
            (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0,
        )

        webView = WebView(this).apply {
            setBackgroundColor(initialPalette.pageBg)
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
            // The system document picker grants access to the user-selected location.
            addJavascriptInterface(HistoryExportBridge(this@MainActivity), "androidHistoryExport")
            // The web menu opens the native attribution and privacy screen
            // through this narrowly scoped bridge. Native chrome does not sit
            // over the homepage anymore.
            addJavascriptInterface(AboutBridge(this@MainActivity), "androidAbout")
            addJavascriptInterface(ThemeChromeBridge(this@MainActivity), "androidThemeChrome")
            addJavascriptInterface(AiConfigBridge(this@MainActivity), "androidAiConfig")

            webViewClient = QuareiaWebViewClient(
                publicAssetRoute,
                LxxxiAssetRoute(lxxxiRouteToken, LxxxiAssetProviderFactory.create()),
            )
            // ai.html imports a JSON conversation backup through a hidden
            // <input type="file">; the stock WebChromeClient ignores it, so
            // the page could never open a picker. This client forwards the
            // request to the system document picker (user-picked URI only,
            // allowContentAccess stays off).
            webChromeClient = QuareiaWebChromeClient(webFileChooser)
            scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
        }

        // Root layout: the WebView owns the homepage and its animated menu.
        // Keeping native chrome out of the page prevents a second, mismatched
        // navigation layer from covering the web UI.
        val root = FrameLayout(this).apply {
            setBackgroundColor(initialPalette.pageBg)
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val safe = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime(),
            )
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            WindowInsetsCompat.CONSUMED
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
        // telemetry is off. A foreground announcement check can reuse cached
        // unread prompts immediately, then joins one fresh request for a new
        // id/revision. Failure is silent and never affects the app.
        TelemetryController.recordAppActive()
        AnnouncementController.checkOnForeground { announcements ->
            AnnouncementPrompter(this).onAnnouncements(announcements)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_LXXXI_ROUTE_TOKEN, lxxxiRouteToken)
        pendingExport?.let {
            outState.putString(STATE_HISTORY_EXPORT_PATH, it.file?.absolutePath)
            outState.putString(STATE_HISTORY_EXPORT_NAME, it.name)
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

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            // Export callbacks belong to the document that requested the picker.
            exportPage++
            super.onPageStarted(view, url, favicon)
        }

        // Only the first completed load of the internal home page starts the
        // app-lifetime signals. WebView can call this for subresources and
        // repeated navigations; the controller also deduplicates in flight.
        override fun onPageFinished(view: WebView?, url: String?) {
            if (!isReadingPage(url)) return
            val homePage = view ?: return
            homePage.evaluateJavascript(
                "window.__qMediaBase = ${org.json.JSONObject.quote(protectedImageBaseUrl())};" +
                    "window.dispatchEvent(new Event('quareia:mediaready'));",
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
            val url = request?.url
            return when (classifyNavigation(url)) {
                NavigationAction.ALLOW_IN_WEBVIEW -> false
                NavigationAction.OPEN_EXTERNAL -> {
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, url))
                    } catch (_: ActivityNotFoundException) {
                        // No handler available — silently ignore in the demo.
                    }
                    true
                }
                // Block non-http(s)/mailto/tel schemes (intent:, javascript:,
                // data:, blob:, about:, content:, non-asset file://, etc.) so
                // untrusted navigations never run inside the bridged WebView.
                NavigationAction.BLOCK -> true
            }
        }
    }

    override fun onDestroy() {
        // A WebView whose leading page asked for a file must not leave the
        // generic callback outstanding once the host is gone.
        webFileChooser.discard()
        if (this::webView.isInitialized) {
            webView.removeJavascriptInterface("androidTelemetry")
            webView.removeJavascriptInterface("androidHistoryExport")
            webView.removeJavascriptInterface("androidAbout")
            webView.removeJavascriptInterface("androidThemeChrome")
            webView.removeJavascriptInterface("androidAiConfig")
            webView.destroy()
        }
        if (!isChangingConfigurations) {
            pendingExport?.let {
                it.file?.delete()
                pendingExport = null
                exportReserved.set(false)
            }
        }
        super.onDestroy()
    }

    internal fun requestHistoryExport(content: String, requestedName: String): Boolean {
        val name = normalizeHistoryExportName(requestedName)
        val kind = if (name.endsWith(".md", ignoreCase = true)) ExportKind.MARKDOWN else ExportKind.JSON
        return stageExport(name, kind) { it.writeText(content, Charsets.UTF_8) }
    }

    internal fun requestPngExport(base64: String, requestedName: String): Boolean {
        val basename = requestedName.substringAfterLast('/').substringAfterLast('\\')
        val stem = if (basename.endsWith(".png", ignoreCase = true)) basename.dropLast(4) else basename
        val cleaned = stem.take(256).replace(EXPORT_NAME_UNSAFE, "-").trim('.', '_', '-').take(120).trimEnd('.')
        val name = "${cleaned.ifBlank { "quareia-reading" }}.png"
        return stageExport(name, ExportKind.PNG) { it.writeBytes(decodePng(base64)) }
    }

    private fun decodePng(base64: String): ByteArray {
        val length = base64.length
        require(length in 4..MAX_PNG_BASE64_LENGTH && length % 4 == 0)
        val padding = when {
            base64.endsWith("==") -> 2
            base64.endsWith("=") -> 1
            else -> 0
        }
        require(length / 4 * 3 - padding <= MAX_PNG_EXPORT_BYTES)
        for (index in 0 until length - padding) {
            val char = base64[index]
            require(char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char == '+' || char == '/')
        }
        val decoded = Base64.decode(base64, Base64.DEFAULT)
        require(decoded.size > PNG_SIGNATURE.size &&
            PNG_SIGNATURE.indices.all { decoded[it] == PNG_SIGNATURE[it] })
        return decoded
    }

    private fun stageExport(name: String, kind: ExportKind, write: (File) -> Unit): Boolean {
        if (!exportReserved.compareAndSet(false, true)) return false
        val page = exportPage
        var staged: File? = null
        val export = try {
            val temp = File.createTempFile(HISTORY_EXPORT_PREFIX, kind.extension, cacheDir)
            staged = temp
            write(temp)
            PendingExport(temp, name, kind, page)
        } catch (_: Exception) {
            staged?.delete()
            PendingExport(null, name, kind, page)
        }

        runOnUiThread {
            if (isDestroyed || isFinishing || export.page != exportPage || export.file == null) {
                endPendingExport(export, cancelled = false)
                return@runOnUiThread
            }
            pendingExport = export
            try {
                val launcher = when (kind) {
                    ExportKind.JSON -> historyExportLauncher
                    ExportKind.MARKDOWN -> markdownExportLauncher
                    ExportKind.PNG -> pngExportLauncher
                }
                launcher.launch(name)
            } catch (_: Exception) {
                endPendingExport(export, cancelled = false)
            }
        }
        return true
    }

    private fun completeExport(kind: ExportKind, uri: Uri?) {
        val export = pendingExport?.takeIf { it.kind == kind } ?: return
        if (uri == null) {
            endPendingExport(export, cancelled = true)
            return
        }

        // The picker returned exactly once. Transfer ownership of the staged
        // file to the worker so onDestroy cannot remove it during the copy.
        pendingExport = null
        val reservation = exportReserved
        val resolver = applicationContext.contentResolver
        val caller = WeakReference(this)
        val main = Handler(Looper.getMainLooper())
        try {
            thread(name = "quareia-file-export") {
                val fileName = try {
                    writeExport(resolver, export, uri)
                } catch (_: Exception) {
                    null
                } finally {
                    export.file?.delete()
                }
                main.post {
                    reservation.set(false)
                    caller.get()?.notifyExport(
                        export, ok = fileName != null, cancelled = false, fileName = fileName ?: export.name,
                    )
                }
            }
        } catch (_: Exception) {
            endPendingExport(export, cancelled = false)
        }
    }

    private fun endPendingExport(export: PendingExport, cancelled: Boolean) {
        export.file?.delete()
        pendingExport = null
        exportReserved.set(false)
        notifyExport(export, ok = false, cancelled = cancelled)
    }

    private fun notifyExport(
        export: PendingExport,
        ok: Boolean,
        cancelled: Boolean,
        fileName: String = export.name,
    ) {
        if (isDestroyed || isFinishing || export.page != exportPage || !this::webView.isInitialized) return
        val script = "window.__quareiaHistoryExportResult && " +
            "window.__quareiaHistoryExportResult({" +
            "ok:$ok,cancelled:$cancelled,fileName:${JSONObject.quote(fileName)}" +
            "});"
        webView.evaluateJavascript(script, null)
    }

    private fun restorePendingExport(savedInstanceState: Bundle?) {
        val name = savedInstanceState?.getString(STATE_HISTORY_EXPORT_NAME) ?: return
        val kind = ExportKind.entries.firstOrNull { name.endsWith(it.extension, ignoreCase = true) } ?: return
        val path = savedInstanceState.getString(STATE_HISTORY_EXPORT_PATH)
        val staged = try {
            path?.let { File(it).canonicalFile }?.takeIf {
                it.isFile && it.parentFile == cacheDir.canonicalFile &&
                    it.name.startsWith(HISTORY_EXPORT_PREFIX) && it.name.endsWith(kind.extension)
            }
        } catch (_: Exception) {
            null
        }
        // The picker result survives recreation even if Android reclaimed the
        // cache. The new WebView has no callback from the previous document.
        pendingExport = PendingExport(staged, name, kind, page = null)
        exportReserved.set(true)
    }

    private fun normalizeHistoryExportName(requestedName: String): String {
        val basename = requestedName.substringAfterLast('/').substringAfterLast('\\')
        val cleaned = basename.replace(EXPORT_NAME_UNSAFE, "-").trim('.')
        if (cleaned.isBlank()) return "tarot-history.json"
        if (cleaned.endsWith(".md", ignoreCase = true)) return cleaned
        return if (cleaned.endsWith(".json", ignoreCase = true)) cleaned else "$cleaned.json"
    }

    private fun protectedImageBaseUrl(): String =
        "https://${APP_HOST}${PROTECTED_PREFIX}${lxxxiRouteToken}"

    internal fun applyThemeChrome(color: String, light: Boolean) {
        AppTheme.recordFromChromeColor(this, color, light)
        val parsed = try {
            Color.parseColor(color)
        } catch (_: IllegalArgumentException) {
            Color.parseColor("#060919")
        }
        @Suppress("DEPRECATION")
        window.statusBarColor = parsed
        @Suppress("DEPRECATION")
        window.navigationBarColor = parsed
        if (this::webView.isInitialized) {
            webView.setBackgroundColor(parsed)
            (webView.parent as? View)?.setBackgroundColor(parsed)
        }
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = light
        controller.isAppearanceLightNavigationBars = light
    }
}

/**
 * WebView chrome hooks. The only override that matters here is the file
 * picker: the bundled ai.html imports a JSON conversation backup through a
 * hidden `<input type="file">`, and a plain `WebChromeClient` returns "not
 * handled", which leaves the page unable to open any picker. Everything else
 * keeps the stock behaviour.
 */
internal class QuareiaWebChromeClient(
    private val fileChooser: WebFileChooser,
) : WebChromeClient() {

    override fun onShowFileChooser(
        webView: WebView?,
        filePathCallback: ValueCallback<Array<Uri>>?,
        fileChooserParams: FileChooserParams?,
    ): Boolean {
        fileChooser.open(fileChooserParams, filePathCallback)
        // Claim the request even when it resolves to a cancel: the class
        // contract requires the callback to be answered exactly once, and the
        // caller cannot answer it a second time.
        return true
    }
}

/** Bridges the web export payload to Android's user-visible save picker. */
private class HistoryExportBridge(private val activity: MainActivity) {

    @android.webkit.JavascriptInterface
    fun save(content: String, fileName: String): Boolean =
        activity.requestHistoryExport(content, fileName)

    @android.webkit.JavascriptInterface
    fun savePng(base64: String, fileName: String): Boolean =
        activity.requestPngExport(base64, fileName)
}

/** Paints system bars to match the WebView theme chosen in the app menu. */
private class ThemeChromeBridge(private val activity: MainActivity) {

    @android.webkit.JavascriptInterface
    fun set(color: String, isLight: String) {
        activity.runOnUiThread {
            activity.applyThemeChrome(color, isLight == "1" || isLight.equals("true", ignoreCase = true))
        }
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

/** Persists user-configured AI provider profiles locally outside cloud backup. */
internal class AiConfigBridge(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    @android.webkit.JavascriptInterface
    fun read(): String = prefs.getString(KEY_CONFIG_JSON, "") ?: ""

    @android.webkit.JavascriptInterface
    fun write(json: String?): Boolean {
        if (json.isNullOrBlank()) return false
        val bytes = json.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_CONFIG_BYTES) return false
        val parsed = try {
            JSONObject(json)
        } catch (_error: Throwable) {
            return false
        }
        if (parsed.optInt("version", -1) <= 0) return false
        return prefs.edit().putString(KEY_CONFIG_JSON, json).commit()
    }

    @android.webkit.JavascriptInterface
    fun clear() {
        prefs.edit().remove(KEY_CONFIG_JSON).commit()
    }

    internal companion object {
        internal const val PREFS_NAME = "quareia_ai_config"
        internal const val KEY_CONFIG_JSON = "config_json"
        internal const val MAX_CONFIG_BYTES = 262_144
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
