package com.quareia.divination

import android.content.Intent
import android.net.Uri
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContract
import androidx.core.app.ActivityOptionsCompat
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class WebFileChooserTest {

    /** Records what was launched and can fail the launch like a dead activity. */
    private class FakeLauncher(private val failOnLaunch: Boolean = false) :
        ActivityResultLauncher<Array<String>>() {

        val launched: MutableList<Array<String>> = mutableListOf()

        override fun launch(input: Array<String>, options: ActivityOptionsCompat?) {
            if (failOnLaunch) throw IllegalStateException("Activity is finishing")
            launched.add(input)
        }

        override fun unregister() = Unit

        override val contract: ActivityResultContract<Array<String>, *> =
            OpenDocumentForWebViewContract
    }

    /** Collects the exact values the WebView bridge is handed. */
    private class RecordingCallback : ValueCallback<Array<Uri>> {
        val results: MutableList<Array<Uri>?> = mutableListOf()

        override fun onReceiveValue(value: Array<Uri>?) {
            results.add(value)
        }
    }

    private class FakeParams(
        private val types: Array<String>,
        private val mode: Int,
    ) : WebChromeClient.FileChooserParams() {
        override fun getAcceptTypes(): Array<String> = types
        override fun getMode(): Int = mode
        override fun isCaptureEnabled(): Boolean = false
        override fun getTitle(): CharSequence = ""
        override fun getFilenameHint(): String = ""
        override fun createIntent(): Intent = Intent(Intent.ACTION_GET_CONTENT)
    }

    private fun contentUri(path: String): Uri = Uri.parse("content://com.android.providers.downloads.documents$path")

    private fun singleFileParams(vararg accept: String): FakeParams =
        FakeParams(accept.toList().toTypedArray(), WebChromeClient.FileChooserParams.MODE_OPEN)

    @Test
    fun chosenContentUriIsHandedBackOnceAndClearsPendingState() {
        val launcher = FakeLauncher()
        val chooser = WebFileChooser(launcher)
        val callback = RecordingCallback()
        val picked = contentUri("/document/42")

        chooser.open(singleFileParams("application/json"), callback)
        assertTrue("picker should have been launched", launcher.launched.size == 1)
        assertTrue(chooser.hasPendingRequest())

        assertTrue(chooser.deliver(listOf(picked)))
        assertEquals(1, callback.results.size)
        assertArrayEqualsUri(arrayOf(picked), callback.results[0])
        assertFalse("pending state must be cleared after a result", chooser.hasPendingRequest())

        // A late second deliver (e.g. a duplicated picker result) must be a no-op.
        assertFalse(chooser.deliver(listOf(contentUri("/document/43"))))
        assertEquals(1, callback.results.size)
    }

    @Test
    fun cancelAndEmptySelectionDeliverNull() {
        val cancelLauncher = FakeLauncher()
        val cancelChooser = WebFileChooser(cancelLauncher)
        val cancelCallback = RecordingCallback()
        cancelChooser.open(singleFileParams("application/json"), cancelCallback)
        assertTrue(cancelChooser.deliver(null))
        assertEquals(1, cancelCallback.results.size)
        assertNull("a cancel must surface as no file", cancelCallback.results[0])

        val emptyLauncher = FakeLauncher()
        val emptyChooser = WebFileChooser(emptyLauncher)
        val emptyCallback = RecordingCallback()
        emptyChooser.open(singleFileParams("application/json"), emptyCallback)
        assertTrue(emptyChooser.deliver(emptyList()))
        assertNull(emptyCallback.results[0])
    }

    @Test
    fun resultsThatAreNotContentUrisAreRejected() {
        val launcher = FakeLauncher()
        val chooser = WebFileChooser(launcher)
        val callback = RecordingCallback()
        chooser.open(singleFileParams("application/json"), callback)

        // A provider must not be able to point the page at a private file://
        // path inside the app sandbox, or smuggle one alongside a real pick.
        val privateFile = Uri.fromFile(java.io.File("/data/data/com.quareia.divination/files/secret.json"))
        val https = Uri.parse("https://example.com/evil.json")
        assertTrue(chooser.deliver(listOf(privateFile, https)))
        assertNull("no content:// URI means no file", callback.results[0])

        val mixed = WebFileChooser(FakeLauncher())
        val mixedCallback = RecordingCallback()
        val real = contentUri("/document/7")
        mixed.open(singleFileParams("application/json"), mixedCallback)
        mixed.deliver(listOf(privateFile, real))
        assertArrayEqualsUri(arrayOf(real), mixedCallback.results[0])
    }

    @Test
    fun secondRequestWhilePickerIsOpenIsRefusedWithNull() {
        val launcher = FakeLauncher()
        val chooser = WebFileChooser(launcher)
        val first = RecordingCallback()
        val second = RecordingCallback()

        chooser.open(singleFileParams("application/json"), first)
        chooser.open(singleFileParams("application/json"), second)

        // Only one system picker may be in flight, so the duplicate must not
        // launch anything and must be answered immediately.
        assertEquals("no second picker may be launched", 1, launcher.launched.size)
        assertEquals(1, second.results.size)
        assertNull(second.results[0])
        assertEquals("the first request is untouched", 0, first.results.size)
        assertTrue(chooser.hasPendingRequest())

        // Crucially, the still-open picker's result must go to the first
        // callback and never to the refused one.
        val picked = contentUri("/document/9")
        assertTrue(chooser.deliver(listOf(picked)))
        assertArrayEqualsUri(arrayOf(picked), first.results[0])
        assertEquals(1, second.results.size)
    }

    @Test
    fun unresolvedPickerDeliversNullInsteadOfLeavingThePageWaiting() {
        val launcher = FakeLauncher(failOnLaunch = true)
        val chooser = WebFileChooser(launcher)
        val callback = RecordingCallback()

        chooser.open(singleFileParams("application/json"), callback)

        assertEquals("a failed launch must still answer once", 1, callback.results.size)
        assertNull(callback.results[0])
        assertFalse(chooser.hasPendingRequest())
    }

    @Test
    fun missingParamsOrCallbackIsHandledWithoutThrowing() {
        val chooser = WebFileChooser(FakeLauncher())
        val callback = RecordingCallback()

        // The page can race navigation against the chooser request.
        chooser.open(null, callback)
        assertNull(callback.results[0])

        val noCallbackLauncher = FakeLauncher()
        val noCallbackChooser = WebFileChooser(noCallbackLauncher)
        noCallbackChooser.open(singleFileParams("application/json"), null)
        assertFalse(noCallbackChooser.hasPendingRequest())
        assertTrue(noCallbackLauncher.launched.isEmpty())
    }

    @Test
    fun destroyReleasesTheOutstandingRequest() {
        val chooser = WebFileChooser(FakeLauncher())
        val callback = RecordingCallback()
        chooser.open(singleFileParams("application/json"), callback)

        chooser.discard()

        assertFalse(chooser.hasPendingRequest())
        assertEquals(1, callback.results.size)
        assertNull("an abandoned request resolves as a cancel", callback.results[0])
        assertFalse("nothing is pending after destroy", chooser.deliver(null))
    }

    @Test
    fun singleFileInputReceivesOneUriAndMultiFileKeepsAll() {
        val single = WebFileChooser(FakeLauncher())
        val singleCallback = RecordingCallback()
        single.open(singleFileParams("application/json"), singleCallback)
        single.deliver(listOf(contentUri("/document/1"), contentUri("/document/2")))
        assertEquals(1, singleCallback.results[0]!!.size)

        val multi = WebFileChooser(FakeLauncher())
        val multiCallback = RecordingCallback()
        multi.open(
            FakeParams(arrayOf("*/*"), WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE),
            multiCallback,
        )
        multi.deliver(listOf(contentUri("/document/1"), contentUri("/document/2")))
        assertEquals(2, multiCallback.results[0]!!.size)
    }

    @Test
    fun acceptTypesBroadenJsonForSafAndInvalidOnesBecomeAWildcard() {
        val chooser = WebFileChooser(FakeLauncher())
        assertEquals(
            OpenDocumentForWebViewContract.JSON_PICKER_MIMES,
            chooser.acceptTypes(singleFileParams(".json", "application/json")).toList(),
        )
        assertEquals(
            OpenDocumentForWebViewContract.JSON_PICKER_MIMES,
            chooser.acceptTypes(singleFileParams(".JSON")).toList(),
        )
        assertEquals(
            listOf("image/png"),
            chooser.acceptTypes(singleFileParams("image/png")).toList(),
        )
        assertEquals(
            listOf("*/*"),
            chooser.acceptTypes(singleFileParams("", "not-a-mime")).toList(),
        )
        assertEquals(
            listOf("*/*"),
            chooser.acceptTypes(singleFileParams(".custom", "application/x-custom")).toList(),
        )
        assertEquals(listOf("*/*"), chooser.acceptTypes(null).toList())
    }

    @Test
    fun contractBuildsAnOpenDocumentPickerWithJsonFallbacksAndSingleMimeLimits() {
        val jsonIntent = OpenDocumentForWebViewContract.createIntent(
            RuntimeEnvironment.getApplication(),
            arrayOf(".json", "application/json"),
        )

        assertEquals(Intent.ACTION_OPEN_DOCUMENT, jsonIntent.action)
        assertTrue(jsonIntent.categories.contains(Intent.CATEGORY_OPENABLE))
        // Android SAF greys out .json backups indexed as octet-stream or
        // text/plain when intent.type is locked to application/json alone.
        assertEquals("*/*", jsonIntent.type)
        assertEquals(
            OpenDocumentForWebViewContract.JSON_PICKER_MIMES,
            jsonIntent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES)?.toList(),
        )
        // The page's accept list must not be able to steer anything else.
        assertNull(jsonIntent.getStringExtra(Intent.EXTRA_TITLE))

        val singleMimeIntent = OpenDocumentForWebViewContract.createIntent(
            RuntimeEnvironment.getApplication(),
            arrayOf("image/png"),
        )
        assertEquals("image/png", singleMimeIntent.type)
        assertNull(singleMimeIntent.getStringArrayExtra(Intent.EXTRA_MIME_TYPES))

        val many = OpenDocumentForWebViewContract.mimeTypes(
            listOf("image/png", "text/plain", "image/png"),
        )
        assertEquals(listOf("image/png", "text/plain"), many)
    }

    @Test
    fun contractCollectsUrisAndTreatsCancelAsNoFile() {
        val picked = contentUri("/document/5")
        val result = Intent().apply { data = picked }
        assertEquals(
            listOf(picked),
            OpenDocumentForWebViewContract.parseResult(android.app.Activity.RESULT_OK, result),
        )
        assertNull(
            "a cancel must be reported as no file",
            OpenDocumentForWebViewContract.parseResult(android.app.Activity.RESULT_CANCELED, result),
        )
        assertNull(
            OpenDocumentForWebViewContract.parseResult(android.app.Activity.RESULT_OK, null),
        )
    }

    @Test
    fun chromeClientClaimsTheRequestAndForwardsItToThePicker() {
        val launcher = FakeLauncher()
        val chooser = WebFileChooser(launcher)
        val client = QuareiaWebChromeClient(chooser)
        val callback = RecordingCallback()

        val handled = client.onShowFileChooser(
            null,
            callback,
            singleFileParams("application/json"),
        )

        // Returning false (the stock WebChromeClient behaviour) is what left
        // ai.html's "导入备份" button unable to open any picker.
        assertTrue("the host must claim the request", handled)
        assertEquals(1, launcher.launched.size)
        assertEquals(
            OpenDocumentForWebViewContract.JSON_PICKER_MIMES,
            launcher.launched[0].toList(),
        )
        assertTrue(chooser.hasPendingRequest())

        // A null params object still has to be answered exactly once.
        val bare = RecordingCallback()
        assertTrue(client.onShowFileChooser(null, bare, null))
        assertNull(bare.results[0])
    }

    @Test
    fun webViewNavigationPolicyAllowsBundledPagesDelegatesExternalLinksAndBlocksCustomSchemes() {
        assertEquals(
            MainActivity.NavigationAction.ALLOW_IN_WEBVIEW,
            MainActivity.classifyNavigation(Uri.parse(MainActivity.HOME_URL)),
        )
        assertEquals(
            MainActivity.NavigationAction.ALLOW_IN_WEBVIEW,
            MainActivity.classifyNavigation(Uri.parse("${MainActivity.AI_URL}?readingId=rec-1")),
        )
        assertEquals(
            MainActivity.NavigationAction.ALLOW_IN_WEBVIEW,
            MainActivity.classifyNavigation(Uri.parse("file:///android_asset/www/index.html")),
        )
        assertEquals(
            MainActivity.NavigationAction.OPEN_EXTERNAL,
            MainActivity.classifyNavigation(Uri.parse("https://www.quareia.com")),
        )
        assertEquals(
            MainActivity.NavigationAction.OPEN_EXTERNAL,
            MainActivity.classifyNavigation(Uri.parse("mailto:contact@example.com")),
        )
        assertEquals(
            MainActivity.NavigationAction.OPEN_EXTERNAL,
            MainActivity.classifyNavigation(Uri.parse("tel:+15550199")),
        )
        assertEquals(
            MainActivity.NavigationAction.BLOCK,
            MainActivity.classifyNavigation(Uri.parse("intent://evil#Intent;scheme=https;end")),
        )
        assertEquals(
            MainActivity.NavigationAction.BLOCK,
            MainActivity.classifyNavigation(Uri.parse("data:text/html,<script>1</script>")),
        )
        assertEquals(
            MainActivity.NavigationAction.BLOCK,
            MainActivity.classifyNavigation(Uri.parse("blob:https://appassets.androidplatform.net/1")),
        )
        assertEquals(
            MainActivity.NavigationAction.BLOCK,
            MainActivity.classifyNavigation(Uri.parse("about:blank")),
        )
        assertEquals(
            MainActivity.NavigationAction.BLOCK,
            MainActivity.classifyNavigation(Uri.parse("file:///data/data/com.quareia.divination/shared_prefs/quareia_ai_config.xml")),
        )
        assertEquals(
            MainActivity.NavigationAction.BLOCK,
            MainActivity.classifyNavigation(Uri.parse("file:///android_asset/../shared_prefs/quareia_ai_config.xml")),
        )
        assertEquals(
            MainActivity.NavigationAction.BLOCK,
            MainActivity.classifyNavigation(Uri.parse("http://appassets.androidplatform.net/assets/www/ai.html")),
        )
        assertEquals(
            MainActivity.NavigationAction.BLOCK,
            MainActivity.classifyNavigation(null),
        )
    }

    @Test
    fun mainActivityKeepsContentAccessOffAndUsesTheCustomChromeClient() {
        // Contract check on the host wiring: the picker must not have been
        // "fixed" by switching allowContentAccess on, and the stock
        // WebChromeClient must not come back.
        val source = File("src/main/java/com/quareia/divination/MainActivity.kt")
        if (!source.isFile) return
        val text = source.readText()
        assertTrue(
            "allowContentAccess must stay false; the picker relies on the user's grant",
            text.contains("allowContentAccess = false"),
        )
        assertTrue(
            "the WebView must use QuareiaWebChromeClient",
            text.contains("webChromeClient = QuareiaWebChromeClient(webFileChooser)"),
        )
        assertTrue(
            "the chooser must be released with the activity",
            text.contains("webFileChooser.discard()"),
        )
    }

    private fun assertArrayEqualsUri(expected: Array<Uri>, actual: Array<Uri>?) {
        assertEquals(expected.toList(), actual?.toList())
    }
}
