package com.quareia.divination

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContract
import java.util.Locale

/**
 * Turns `<input type="file">` inside the bundled WebView into a system
 * document picker request.
 *
 * The WebView host keeps `allowContentAccess = false`, so the page cannot read
 * or enumerate content:// URIs on its own. The "allow the user to pick a file"
 * step instead runs through the platform picker: the page asks for a file,
 * QuareiaWebChromeClient forwards the request here, and the system
 * ACTION_OPEN_DOCUMENT screen returns a URI that the user selected. The URI
 * grant attached to that result is the only access the page gains, and it is
 * scoped to that one picked file: the manifest gains no storage permission and
 * no broader content access.
 *
 * Contract handling:
 *  - the WebView requires exactly one result per request; resolving twice
 *    throws in the WebView glue, so the pending state is cleared before the
 *    callback runs;
 *  - only one request may be in flight. A second request while the picker is
 *    open is refused immediately with null rather than queueing, because a
 *    late result from the first picker would otherwise be delivered to the
 *    second callback and hand a file to a page that never asked for it;
 *  - a result that is not a content:// URI is discarded. The picker is the
 *    trust boundary here: a provider (or an app impersonating one) must not be
 *    able to point the page at a private file:// path inside the app's sandbox;
 *  - cancel, an empty selection, a refused duplicate and an unresolvable
 *    picker all deliver null, which the page sees as "no file chosen".
 *
 * No bespoke timeout: the answer is guaranteed by the system picker's cancel
 * result, by onDestroy (discard) and by a launch failure, all of which resolve
 * the callback.
 */
internal class WebFileChooser(
    private val launcher: ActivityResultLauncher<Array<String>>,
) {

    private var pendingParams: WebChromeClient.FileChooserParams? = null
    private var pendingCallback: ValueCallback<Array<Uri>>? = null

    /** True while a request is waiting for the picker. */
    internal fun hasPendingRequest(): Boolean = pendingCallback != null

    /**
     * Entry point from WebChromeClient.onShowFileChooser. The request is
     * either handed to the picker or resolved as a cancel before this returns.
     */
    internal fun open(
        params: WebChromeClient.FileChooserParams?,
        callback: ValueCallback<Array<Uri>>?,
    ) {
        val target = callback ?: return
        val request = params
        if (request == null) {
            complete(target, null)
            return
        }
        if (pendingCallback != null) {
            // A picker is still on screen. Refusing here keeps the in-flight
            // result matched to the callback that asked for it.
            complete(target, null)
            return
        }

        pendingParams = request
        pendingCallback = target
        try {
            launcher.launch(acceptTypes(request))
        } catch (_error: Throwable) {
            // No activity can handle the picker (or the host is finishing):
            // the page still needs its callback resolved.
            discard()
        }
    }

    /**
     * Hands the picker result back. A null list is a cancel. Returns true when
     * the result was consumed by a pending request.
     */
    internal fun deliver(uris: List<Uri>?): Boolean {
        val callback = pendingCallback ?: return false
        val params = pendingParams
        clearPending()

        val picked = uris
            ?.filter { it.scheme.equals(CONTENT_SCHEME, ignoreCase = true) }
            ?.takeIf { it.isNotEmpty() }
        val accepted = when {
            picked == null -> null
            params?.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE -> picked
            // A single-file input must receive exactly one URI. The picker is
            // constrained, but a provider that returns several anyway must not
            // change the input's semantics.
            else -> listOf(picked.first())
        }
        complete(callback, accepted?.toTypedArray())
        return true
    }

    /** Releases a pending request; safe to call from onDestroy. */
    internal fun discard() {
        val callback = pendingCallback
        clearPending()
        if (callback != null) complete(callback, null)
    }

    /**
     * MIME types handed to the picker. Chromium's FileChooserParams passes raw
     * `<input accept>` tokens such as `.json` verbatim, and an empty or
     * malformed list must still produce an intent the system picker can match.
     */
    internal fun acceptTypes(params: WebChromeClient.FileChooserParams?): Array<String> =
        OpenDocumentForWebViewContract
            .mimeTypes(params?.acceptTypes?.toList().orEmpty())
            .toTypedArray()

    private fun complete(callback: ValueCallback<Array<Uri>>, result: Array<Uri>?) {
        try {
            callback.onReceiveValue(result)
        } catch (_error: Throwable) {
            // The WebView detaches the callback when the page navigates away;
            // a late result must not take down the activity.
        }
    }

    private fun clearPending() {
        pendingParams = null
        pendingCallback = null
    }

    internal companion object {
        private const val CONTENT_SCHEME = "content"
    }
}

/**
 * Result contract for WebFileChooser: the system document picker limited to
 * the MIME types the page accepts. A cancel yields null, so the caller can
 * treat cancel and "nothing selected" identically.
 */
internal object OpenDocumentForWebViewContract :
    ActivityResultContract<Array<String>, List<Uri>?>() {

    override fun createIntent(context: Context, input: Array<String>): Intent =
        pickIntent(input.toList())

    override fun getSynchronousResult(
        context: Context,
        input: Array<String>,
    ): SynchronousResult<List<Uri>?>? = null

    override fun parseResult(resultCode: Int, intent: Intent?): List<Uri>? {
        if (resultCode != Activity.RESULT_OK) return null
        return collectSelectedUris(intent)?.toList()
    }

    /**
     * The picker intent. Only the MIME types the page declared are forwarded;
     * the page cannot add extras, a title override, a writable mode or a
     * capture mode.
     */
    internal fun pickIntent(requested: List<String>): Intent {
        val types = mimeTypes(requested)
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
        if (types.size == 1) {
            intent.type = types.first()
        } else {
            intent.type = ALL_MIMES
            if (types.size > 1) {
                intent.putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
            }
        }
        return intent
    }

    /**
     * Valid, de-duplicated MIME types; falls back to a wildcard when nothing
     * usable was supplied or an unmapped file extension is requested.
     *
     * Android document providers (Downloads, MTP, messaging/cloud apps, OEM
     * ExternalStorageProvider) frequently index `.json` backups as
     * `application/octet-stream` or `text/plain` rather than `application/json`.
     * Broadening JSON requests to [JSON_PICKER_MIMES] causes [pickIntent] to
     * use [ALL_MIMES] with `EXTRA_MIME_TYPES` so `.json` backups are never
     * greyed out, while the web importer still validates the JSON payload.
     */
    internal fun mimeTypes(requested: List<String>): List<String> {
        val expanded = LinkedHashSet<String>()
        for (raw in requested) {
            val token = raw.substringBefore(';').trim().lowercase(Locale.ROOT)
            if (token.isEmpty()) continue
            when {
                token == ALL_MIMES -> return listOf(ALL_MIMES)
                token in JSON_ACCEPT_TOKENS -> expanded.addAll(JSON_PICKER_MIMES)
                EXTENSION_TOKEN.matches(token) -> return listOf(ALL_MIMES)
                MIME_TYPE.matches(token) -> expanded.add(token)
            }
        }
        return expanded.toList().ifEmpty { listOf(ALL_MIMES) }
    }

    /** The URIs a picker returned, de-duplicated and in order. */
    internal fun collectSelectedUris(intent: Intent?): Array<Uri>? {
        if (intent == null) return null
        val uris = LinkedHashSet<Uri>()
        intent.data?.let { uris.add(it) }
        intent.clipData?.let { clip ->
            for (index in 0 until clip.itemCount) {
                clip.getItemAt(index)?.uri?.let { uris.add(it) }
            }
        }
        return uris.toTypedArray().takeIf { it.isNotEmpty() }
    }

    internal val JSON_PICKER_MIMES = listOf(
        "application/json",
        "text/json",
        "text/plain",
        "application/octet-stream",
    )
    private val JSON_ACCEPT_TOKENS = setOf(
        ".json",
        "application/json",
        "text/json",
        "application/x-json",
    )
    private const val ALL_MIMES = "*/*"
    private val EXTENSION_TOKEN = Regex("\\.[a-z0-9][a-z0-9.+-]*")
    private val MIME_TYPE = Regex("[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+|\\*/\\*")
}
