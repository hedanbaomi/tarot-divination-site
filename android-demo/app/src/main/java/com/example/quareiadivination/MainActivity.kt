package com.example.quareiadivination

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Base64
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
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader

/**
 * Hosts the bundled Quareia divination website inside an Android WebView,
 * served over a virtual HTTPS origin so that WebCrypto / fetch are available.
 *
 * The entire web app ships under `assets/www/`; the encrypted LXXXI card art
 * ships under `assets/lxxxi-enc/`. Both are resolved by [WebViewAssetLoader],
 * which maps `https://appassets.androidplatform.net/assets/...` onto the APK's
 * `assets/` folder. This HTTPS origin is what makes the page a "secure
 * context" — required for `window.crypto.subtle` and for `fetch()` to read
 * response bodies, both of which the LXXXI decryption path relies on.
 *
 * Card art for the LXXXI deck is decrypted on the Kotlin side (via
 * [LxxxiKeys]) and handed to the page as a base64 data URL through the
 * `androidCrypto.decryptLxxxi` JavaScript interface.
 */
class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var homePageFinished = false
    private var backDispatchPending = false

    private companion object {
        const val HOME_URL = "https://appassets.androidplatform.net/assets/www/index.html"
        const val WEB_BACK_HANDLER =
            "(function(){return Boolean(window.DivinationUiBack && window.DivinationUiBack.handleBack && window.DivinationUiBack.handleBack());})()"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

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
        // appassets.androidplatform.net is treated as a secure context, which
        // is required for the page's fetch()/WebCrypto usage and for the JS
        // bridge to interoperate cleanly.
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

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
                mediaPlaybackRequiresUserGesture = false
                setSupportZoom(false)
            }
            // Expose the decryption bridge to the page. The bridge is the only
            // way the LXXXI card art leaves the APK; it never writes plaintext
            // anywhere on disk.
            addJavascriptInterface(LxxxiCryptoBridge(this@MainActivity), "androidCrypto")
            // Expose the anonymous, opt-out usage-statistics bridge. The page
            // calls it from completion hooks; it never reads card content.
            addJavascriptInterface(TelemetryBridge(), "androidTelemetry")
            // The web menu opens the native attribution and privacy screen
            // through this narrowly scoped bridge. Native chrome does not sit
            // over the homepage anymore.
            addJavascriptInterface(AboutBridge(this@MainActivity), "androidAbout")

            webViewClient = QuareiaWebViewClient(assetLoader)
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

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
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
        private val assetLoader: WebViewAssetLoader
    ) : WebViewClient() {

        override fun shouldInterceptRequest(
            view: WebView?,
            request: WebResourceRequest?
        ): WebResourceResponse? {
            val url = request?.url ?: return null
            return assetLoader.shouldInterceptRequest(url)
        }

        // Only the first completed load of the internal home page starts the
        // app-lifetime signals. WebView can call this for subresources and
        // repeated navigations; the controller also deduplicates in flight.
        override fun onPageFinished(view: WebView?, url: String?) {
            if (homePageFinished || url != HOME_URL) return
            homePageFinished = true
            TelemetryController.recordInstallSeen()
            TelemetryController.recordDailyActive()
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
        // Drop the JS bridge reference held by the WebView before destruction.
        if (this::webView.isInitialized) {
            webView.removeJavascriptInterface("androidCrypto")
            webView.removeJavascriptInterface("androidTelemetry")
            webView.removeJavascriptInterface("androidAbout")
            webView.destroy()
        }
        super.onDestroy()
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

/**
 * JavaScript bridge that decrypts a single LXXXI card blob on demand and
 * returns it as a `data:image/webp;base64,...` URL the page can set directly
 * as an `<img src>`. Synchronous return is intentional: the page calls it
 * from a resolver that needs the value immediately, and the per-call cost is
 * small (one AES-GCM open of a ~10 KB blob).
 *
 * The bridge validates [cardKey] against the allowed filename alphabet so a
 * malicious page cannot use it to read arbitrary asset paths.
 */
private class LxxxiCryptoBridge(private val activity: ComponentActivity) {

    @android.webkit.JavascriptInterface
    fun decryptLxxxi(cardKey: String): String {
        if (!cardKey.matches(Regex("lxxxi(-\\d{2})?(-back)?"))) return ""
        return try {
            val name = if (cardKey == "lxxxi-back") "lxxxi-back" else cardKey
            val plain = readAndDecrypt(name)
            val b64 = Base64.encodeToString(plain, Base64.NO_WRAP)
            "data:image/webp;base64,$b64"
        } catch (e: Exception) {
            android.util.Log.w("LxxxiCrypto", "decrypt failed for $cardKey", e)
            ""
        }
    }

    private fun readAndDecrypt(cardKey: String): ByteArray {
        val path = "lxxxi-enc/$cardKey.bin"
        val raw = activity.assets.open(path).use { it.readBytes() }
        return LxxxiKeys.decryptBlob(raw)
    }
}
