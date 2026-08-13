package com.quareia.divination

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateCheckerTest {

    @Test
    fun equalVersionsAreNotNewer() {
        assertFalse(VersionComparator.isNewer("1.0", "1.0"))
        assertFalse(VersionComparator.isNewer("v1.1", "1.1"))
        assertFalse(VersionComparator.isNewer("1.1.0", "1.1"))
    }

    @Test
    fun plainAndPrefixedTagsCompareEqually() {
        assertTrue(VersionComparator.isNewer("v1.2", "1.1"))
        assertTrue(VersionComparator.isNewer("1.2", "v1.1"))
        assertFalse(VersionComparator.isNewer("v1.1", "1.2"))
    }

    @Test
    fun olderVersionsAreNeverNewer() {
        assertFalse(VersionComparator.isNewer("0.9", "1.0"))
        assertFalse(VersionComparator.isNewer("1.0", "1.1"))
        assertFalse(VersionComparator.isNewer("v0.5.2", "1.0"))
    }

    @Test
    fun multiSegmentVersionsCompareSegmentBySegment() {
        assertTrue(VersionComparator.isNewer("1.10", "1.9"))
        assertTrue(VersionComparator.isNewer("1.2.3", "1.2.2"))
        assertFalse(VersionComparator.isNewer("1.2.2", "1.2.3"))
        assertFalse(VersionComparator.isNewer("2.0.0", "2.1.0"))
    }

    @Test
    fun threePartPatchReleaseIsNewerThanInstalledBase() {
        assertTrue(VersionComparator.isNewer("v1.3.1", "1.3.0"))
        assertTrue(VersionComparator.isNewer("1.3.1", "1.3"))
        assertTrue(VersionComparator.equal("v1.3.1", "1.3.1"))
        assertFalse(VersionComparator.isNewer("1.3.0", "1.3.1"))
    }

    @Test
    fun hardenedVersionUsesItsNumericCore() {
        assertTrue(VersionComparator.isNewer("v1.2.1", "1.2.0-hardened-local"))
        assertFalse(VersionComparator.isNewer("1.2.0", "1.2.0-hardened-local"))
        assertTrue(VersionComparator.equal("1.2.0", "1.2.0-hardened-local"))
    }

    @Test
    fun prereleaseAndBuildSuffixesUseTheirNumericCore() {
        assertTrue(VersionComparator.equal("1.2.0", "1.2.0-rc.1"))
        assertTrue(VersionComparator.equal("v1.2.0", "1.2.0+build.7"))
        assertTrue(VersionComparator.equal("1.2.0", "1.2.0-rc.1+build.7"))
        assertTrue(VersionComparator.isNewer("1.2.1+build", "1.2.0-rc.1"))
    }

    @Test
    fun malformedInputIsNeverNewer() {
        assertFalse(VersionComparator.isNewer("latest", "1.0"))
        assertFalse(VersionComparator.isNewer("v1.x", "1.0"))
        assertFalse(VersionComparator.isNewer("1.0", "abc"))
        assertFalse(VersionComparator.isNewer("", "1.0"))
        assertNull(VersionComparator.compare("1.0", "1.0-"))
        assertNull(VersionComparator.compare("1.0+", "1.0"))
        assertNull(VersionComparator.compare("1.0-rc.", "1.0"))
        assertNull(VersionComparator.compare("1.0++build", "1.0"))
    }

    @Test
    fun newerReleaseIsAvailable() {
        val source = UpdateSource { release("v1.1.1") }
        assertEquals(
            UpdateCheckResult.Available(release("v1.1.1")),
            checkSync(source, "1.1"),
        )
    }

    @Test
    fun newerReleaseIsAvailableFromHardenedBuild() {
        val source = UpdateSource { release("v1.2.1") }
        assertEquals(
            UpdateCheckResult.Available(release("v1.2.1")),
            checkSync(source, "1.2.0-hardened-local"),
        )
    }

    @Test
    fun sameVersionIsUpToDate() {
        val source = UpdateSource { release("v1.1.1") }
        assertEquals(UpdateCheckResult.UpToDate, checkSync(source, "1.1.1"))
    }

    @Test
    fun olderReleaseIsUpToDate() {
        val source = UpdateSource { release("v1.0.0") }
        assertEquals(UpdateCheckResult.UpToDate, checkSync(source, "1.1"))
    }

    @Test
    fun networkFailureIsFailedNotUpToDate() {
        val source = UpdateSource { throw RuntimeException("network down") }
        assertEquals(UpdateCheckResult.Failed, checkSync(source, "1.0"))
    }

    @Test
    fun emptySourceResultIsFailed() {
        val source = UpdateSource { null }
        assertEquals(UpdateCheckResult.Failed, checkSync(source, "1.0"))
    }

    @Test
    fun malformedTagIsFailedNotUpToDate() {
        val source = UpdateSource { release("latest") }
        assertEquals(UpdateCheckResult.Failed, checkSync(source, "1.0"))
    }

    @Test
    fun malformedCurrentVersionIsFailedNotUpToDate() {
        val source = UpdateSource { release("v1.2.1") }
        assertEquals(UpdateCheckResult.Failed, checkSync(source, "not-a-version"))
    }

    companion object {
        private fun release(tag: String): ReleaseInfo = ReleaseInfo(
            tagName = tag,
            assetName = "QuareiaDivination-v${tag.removePrefix("v")}.apk",
            downloadUrl = "https://github.com/hedanbaomi/tarot-divination-site/releases/download/$tag/" +
                "QuareiaDivination-v${tag.removePrefix("v")}.apk",
            sizeBytes = 1024,
            contentType = "application/vnd.android.package-archive",
            sha256Digest = "sha256:${"ab".repeat(32)}",
        )
    }
}
