package com.quareia.divination

import android.content.Context
import java.io.File
import java.io.StringReader
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.xmlpull.v1.XmlPullParser
import org.xmlpull.v1.XmlPullParserFactory

/**
 * Guards the manifest wiring that keeps the BYOK API key out of Android
 * backups, and pins the backup rules themselves.
 *
 * The manifest assertions run against com.quareia.divination.R, which AGP
 * generates from the *merged* manifest of the variant under test. A rule file
 * left unreferenced would compile and ship silently, which is exactly the bug
 * this test exists to catch.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class BackupRulesTest {

    private val context: Context get() = RuntimeEnvironment.getApplication()

    @Test
    fun mergedManifestReferencesBothBackupRuleFiles() {
        val merged = mergedManifest()
        // A rule file no manifest points at would compile and ship silently,
        // which is exactly the bug this test exists to catch.
        assertTrue(
            "android:fullBackupContent must point at @xml/backup_rules",
            merged.contains("""android:fullBackupContent="@xml/backup_rules""""),
        )
        assertTrue(
            "android:dataExtractionRules must point at @xml/data_extraction_rules",
            merged.contains("""android:dataExtractionRules="@xml/data_extraction_rules""""),
        )
        assertTrue(
            "backup must stay enabled so the AI exclusions matter",
            merged.contains("""android:allowBackup="true""""),
        )
    }

    @Test
    fun fullBackupRulesExcludeTheAiKeyStores() {
        val excludes = excludesUnder(R.xml.backup_rules, "full-backup-content")
        assertEquals(
            setOf(
                "sharedpref" to AiConfigBridge.PREFS_NAME + ".xml",
                "root" to "app_webview/",
            ),
            excludes,
        )
    }

    @Test
    fun dataExtractionRulesExcludeTheAiKeyStoresForCloudAndTransfer() {
        assertEquals(
            "cloud-backup must exclude both key stores",
            EXPECTED_EXCLUSIONS,
            excludesUnder(R.xml.data_extraction_rules, "cloud-backup"),
        )
        assertEquals(
            "device-transfer must exclude both key stores",
            EXPECTED_EXCLUSIONS,
            excludesUnder(R.xml.data_extraction_rules, "device-transfer"),
        )
        assertFalse(
            "backup_rules.xml must not use <include> (which switches backup into allowlist-only mode)",
            hasTag(R.xml.backup_rules, "include"),
        )
        assertFalse(
            "data_extraction_rules.xml must not use <include>",
            hasTag(R.xml.data_extraction_rules, "include"),
        )
    }

    @Test
    fun sectionParserResetsOnEndTagSoDeviceTransferCannotMaskMissingCloudBackup() {
        val missingCloudXml = """
            <data-extraction-rules>
                <cloud-backup>
                </cloud-backup>
                <device-transfer>
                    <exclude domain="sharedpref" path="quareia_ai_config.xml"/>
                    <exclude domain="root" path="app_webview/"/>
                </device-transfer>
            </data-extraction-rules>
        """.trimIndent()

        assertEquals(
            "device-transfer exclusions must not satisfy an empty cloud-backup section",
            emptySet<Pair<String, String>>(),
            excludesUnderXmlText(missingCloudXml, "cloud-backup"),
        )
        assertEquals(
            EXPECTED_EXCLUSIONS,
            excludesUnderXmlText(missingCloudXml, "device-transfer"),
        )

        val missingTransferXml = """
            <data-extraction-rules>
                <cloud-backup>
                    <exclude domain="sharedpref" path="quareia_ai_config.xml"/>
                    <exclude domain="root" path="app_webview/"/>
                </cloud-backup>
                <device-transfer/>
            </data-extraction-rules>
        """.trimIndent()

        assertEquals(
            EXPECTED_EXCLUSIONS,
            excludesUnderXmlText(missingTransferXml, "cloud-backup"),
        )
        assertEquals(
            "cloud-backup exclusions must not leak into an empty device-transfer section",
            emptySet<Pair<String, String>>(),
            excludesUnderXmlText(missingTransferXml, "device-transfer"),
        )
    }

    @Test
    fun backupExclusionsMatchTheStoreNamesUsedAtRuntime() {
        // The SharedPreferences file name is part of the exclusion; a rename
        // must not silently make the key backup-eligible again.
        assertEquals("quareia_ai_config", AiConfigBridge.PREFS_NAME)

        // Writing through the bridge must use exactly that preferences file.
        val bridge = AiConfigBridge(context)
        bridge.clear()
        assertTrue(
            bridge.write("""{"version":1,"activeProfileId":"p","profiles":[{"id":"p","apiKey":"k"}]}"""),
        )
        val prefs = context.getSharedPreferences(AiConfigBridge.PREFS_NAME, Context.MODE_PRIVATE)
        assertNotNull(
            "the bridge key must live in the excluded preferences file",
            prefs.getString(AiConfigBridge.KEY_CONFIG_JSON, null),
        )
        bridge.clear()
    }

    @Test
    fun rulesDoNotRequestAnyWiderFileAccess() {
        val permissions = mergedManifest()
            .let { REQUIRES_PERMISSION.findAll(it).map { match -> match.groupValues[1] }.toSet() }
        assertFalse(
            "no storage permission may be added for the backup or file-picker work",
            permissions.any { it.startsWith("android.permission.READ_EXTERNAL") },
        )
        assertFalse(permissions.contains("android.permission.WRITE_EXTERNAL_STORAGE"))
        assertFalse(permissions.contains("android.permission.MANAGE_EXTERNAL_STORAGE"))
    }

    /**
     * The merged manifest AGP actually packages for the variant under test,
     * read from the compiled resources (Robolectric loads the same copy).
     */
    private fun mergedManifest(): String {
        val resources = RuntimeEnvironment.getApplication().resources
        val id = resources.getIdentifier("AndroidManifest", "xml", "android")
        if (id == 0) {
            // Some Robolectric versions do not expose the manifest resource;
            // fall back to the file AGP wrote next to the test build.
            val candidates = listOf(
                File("build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml"),
                File("build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml"),
            )
            val file = candidates.firstOrNull(File::isFile)
                ?: error("Merged manifest not found; run :app:processDebugManifest first")
            return file.readText()
        }
        return resources.openRawResource(id).bufferedReader().use { it.readText() }
    }

    /**
     * Exclusions declared inside one section of a backup rule file. The rules
     * are read with the resource XML parser because AGP compiles them into
     * binary XML; handing raw bytes to a text parser fails.
     */
    private fun excludesUnder(resourceId: Int, section: String): Set<Pair<String, String>> {
        val parser = context.resources.getXml(resourceId)
        return try {
            excludesUnder(parser, section)
        } finally {
            parser.close()
        }
    }

    private fun excludesUnderXmlText(xml: String, section: String): Set<Pair<String, String>> {
        val parser = XmlPullParserFactory.newInstance().newPullParser()
        parser.setInput(StringReader(xml))
        return excludesUnder(parser, section)
    }

    private fun excludesUnder(parser: XmlPullParser, section: String): Set<Pair<String, String>> {
        var event = parser.eventType
        var depth = 0
        var sectionDepth = -1
        val result = mutableSetOf<Pair<String, String>>()
        while (event != XmlPullParser.END_DOCUMENT) {
            when (event) {
                XmlPullParser.START_TAG -> {
                    depth += 1
                    if (parser.name == section && sectionDepth < 0) {
                        sectionDepth = depth
                    }
                    if (parser.name == "exclude" && inSection(sectionDepth, depth)) {
                        result.add(
                            parser.getAttributeValue(null, "domain") to
                                parser.getAttributeValue(null, "path"),
                        )
                    }
                }
                XmlPullParser.END_TAG -> {
                    if (depth == sectionDepth) {
                        sectionDepth = -1
                    }
                    depth -= 1
                }
            }
            event = parser.next()
        }
        return result
    }

    private fun hasTag(resourceId: Int, tagName: String): Boolean {
        val parser = context.resources.getXml(resourceId)
        return try {
            var event = parser.eventType
            while (event != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG && parser.name == tagName) {
                    return true
                }
                event = parser.next()
            }
            false
        } finally {
            parser.close()
        }
    }

    /** Matches tags nested strictly inside the active section (or root full-backup-content). */
    private fun inSection(sectionDepth: Int, depth: Int): Boolean =
        sectionDepth > 0 && depth > sectionDepth

    private companion object {
        val EXPECTED_EXCLUSIONS = setOf(
            "sharedpref" to AiConfigBridge.PREFS_NAME + ".xml",
            "root" to "app_webview/",
        )
        val REQUIRES_PERMISSION = Regex("""android:name="(android\.permission\.[^"]+)"""")
    }
}
