package com.example.quareiadivination

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
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

            webViewClient = QuareiaWebViewClient(assetLoader)
            webChromeClient = WebChromeClient()
            scrollBarStyle = View.SCROLLBARS_INSIDE_OVERLAY
        }

        // Root layout: the WebView fills the screen, with a small "About /
        // Copyright" affordance pinned to the top-right corner so the
        // attribution notice is always reachable without blocking the
        // divination flow. (The app uses a NoActionBar theme, so the legal
        // notice is surfaced via this lightweight button rather than an
        // overflow menu.)
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
        val aboutBtn = TextView(this).apply {
            text = getString(R.string.menu_about)
            setTextColor(Color.parseColor("#090d1e"))
            setBackgroundColor(Color.parseColor("#C9A86A"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            val h = dip(8); val v = dip(5)
            setPadding(h, v, h, v)
            setOnClickListener { startActivity(Intent(this@MainActivity, AboutActivity::class.java)) }
        }
        root.addView(
            aboutBtn,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.TOP or Gravity.END
            ).apply {
                marginEnd = dip(12)
                topMargin = dip(12)
            }
        )

        setContentView(root)

        // Initialise anonymous usage statistics. Non-blocking: failures never
        // affect launch, the page, or local history.
        TelemetryController.init(this)
        showFirstLaunchNoticeIfNeeded(root)

        val home = "https://appassets.androidplatform.net/assets/www/index.html"
        if (savedInstanceState == null) {
            webView.loadUrl(home)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    /**
     * Shows a one-time, non-blocking banner explaining the anonymous usage
     * statistics the first time the app runs. It sits at the bottom, does not
     * block the divination flow, and dismisses on tap or after a short delay.
     * Wording comes entirely from strings.xml.
     */
    private fun showFirstLaunchNoticeIfNeeded(root: FrameLayout) {
        val prefsKey = "first_launch_notice_shown"
        val prefs = getSharedPreferences("quareia_telemetry", MODE_PRIVATE)
        if (prefs.getBoolean(prefsKey, false)) return
        prefs.edit().putBoolean(prefsKey, true).apply()

        val bg = Color.parseColor("#1c1f3a")
        val text = Color.parseColor("#E8E6F0")
        val accent = Color.parseColor("#C9A86A")
        val noticeText = getString(R.string.telemetry_first_launch_notice)
        val dismiss = getString(R.string.telemetry_notice_dismiss)
        val fullText = "$noticeText\n\n$dismiss"
        // Make the dismiss hint a tappable link to the About screen, where the
        // toggle lives. The whole banner also dismisses on any tap.
        val spannable = android.text.SpannableString(fullText)
        val dismissStart = fullText.lastIndexOf(dismiss)
        if (dismissStart >= 0) {
            spannable.setSpan(
                object : android.text.style.ClickableSpan() {
                    override fun onClick(widget: android.view.View) {
                        startActivity(Intent(this@MainActivity, AboutActivity::class.java))
                    }
                },
                dismissStart, dismissStart + dismiss.length,
                android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
            )
            spannable.setSpan(
                android.text.style.ForegroundColorSpan(accent),
                dismissStart, dismissStart + dismiss.length,
                android.text.Spannable.SPAN_EXCLUSIVE_EXCLUSIVE
            )
        }
        val banner = android.widget.TextView(this).apply {
            setBackgroundColor(bg)
            setTextColor(text)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setLineSpacing(dip(2).toFloat(), 1f)
            setPadding(dip(16), dip(12), dip(16), dip(12))
            this.text = spannable
            movementMethod = android.text.method.LinkMovementMethod.getInstance()
            // Any tap outside the inline link just dismisses the banner.
            setOnClickListener { (parent as? FrameLayout)?.removeView(this) }
        }
        root.addView(
            banner,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.BOTTOM
            ).apply {
                marginStart = dip(8)
                marginEnd = dip(8)
                bottomMargin = dip(12)
            }
        )
        // Auto-dismiss after 12 seconds without blocking the user.
        webView.postDelayed({ (banner.parent as? FrameLayout)?.removeView(banner) }, 12000)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    /** Converts density-independent pixels to raw pixels for layout sizes. */
    private fun dip(value: Int): Int =
        TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()

    /** Back button navigates WebView history before exiting the activity. */
    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack()
            return true
        }
        return super.onKeyDown(keyCode, event)
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

        // Once the page is ready, fire the install/daily-active signals. These
        // are fire-and-forget on a background thread; any failure is retried on
        // a later launch and never blocks the UI.
        override fun onPageFinished(view: WebView?, url: String?) {
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
            webView.destroy()
        }
        super.onDestroy()
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
