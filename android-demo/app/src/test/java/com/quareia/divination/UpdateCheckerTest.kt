package com.quareia.divination

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateCheckerTest {

    @Test
    fun equalVersionsAreNotNewer() {
        assertFalse(UpdateChecker.isNewer("1.0", "1.0"))
        assertFalse(UpdateChecker.isNewer("v1.1", "1.1"))
        assertFalse(UpdateChecker.isNewer("1.1.0", "1.1"))
    }

    @Test
    fun plainAndPrefixedTagsCompareEqually() {
        assertTrue(UpdateChecker.isNewer("v1.2", "1.1"))
        assertTrue(UpdateChecker.isNewer("1.2", "v1.1"))
        assertFalse(UpdateChecker.isNewer("v1.1", "1.2"))
    }

    @Test
    fun olderVersionsAreNeverNewer() {
        assertFalse(UpdateChecker.isNewer("0.9", "1.0"))
        assertFalse(UpdateChecker.isNewer("1.0", "1.1"))
        assertFalse(UpdateChecker.isNewer("v0.5.2", "1.0"))
    }

    @Test
    fun multiSegmentVersionsCompareSegmentBySegment() {
        assertTrue(UpdateChecker.isNewer("1.10", "1.9"))
        assertTrue(UpdateChecker.isNewer("1.2.3", "1.2.2"))
        assertFalse(UpdateChecker.isNewer("1.2.2", "1.2.3"))
        assertFalse(UpdateChecker.isNewer("2.0.0", "2.1.0"))
    }

    @Test
    fun malformedInputIsNeverNewer() {
        assertFalse(UpdateChecker.isNewer("latest", "1.0"))
        assertFalse(UpdateChecker.isNewer("v1.x", "1.0"))
        assertFalse(UpdateChecker.isNewer("1.0", "abc"))
        assertFalse(UpdateChecker.isNewer("", "1.0"))
    }
}
