package com.quareia.divination

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * All post-download package checks (parseability, package name, versionCode
 * progression, signer certificate match) live in [ApkVerifier] behind an
 * [ApkMetaReader] seam, so each rejection path is testable without a device
 * or a real PackageManager.
 */
class ApkVerifierTest {

    private val apk = File("fake-update.apk")

    @Test
    fun validApkPasses() {
        val verifier = ApkVerifier(
            FakeReader(
                apkMeta = ApkMeta("com.quareia.divination", 3, listOf(SIGNER_A)),
                installed = InstalledApkMeta(2, listOf(SIGNER_A)),
            )
        )

        assertEquals(ApkVerifyResult.Success(3), verifier.verify(apk, InstalledApkMeta(2, listOf(SIGNER_A)), "com.quareia.divination"))
    }

    @Test
    fun signingHistoryMatchPasses() {
        // The installed app rotated from SIGNER_OLD to SIGNER_A; the update
        // signed by the current certificate must still be accepted.
        val verifier = ApkVerifier(
            FakeReader(
                apkMeta = ApkMeta("com.quareia.divination", 3, listOf(SIGNER_A)),
                installed = InstalledApkMeta(2, listOf(SIGNER_OLD, SIGNER_A)),
            )
        )

        assertEquals(
            ApkVerifyResult.Success(3),
            verifier.verify(apk, InstalledApkMeta(2, listOf(SIGNER_OLD, SIGNER_A)), "com.quareia.divination"),
        )
    }

    @Test
    fun unparseableApkIsRejected() {
        val verifier = ApkVerifier(FakeReader(null, InstalledApkMeta(2, listOf(SIGNER_A))))

        val result = verifier.verify(apk, InstalledApkMeta(2, listOf(SIGNER_A)), "com.quareia.divination")

        assertEquals(ApkVerifyResult.Failure(ApkVerifyResult.Reason.NOT_PARSABLE), result)
    }

    @Test
    fun packageNameMismatchIsRejected() {
        val verifier = ApkVerifier(
            FakeReader(
                ApkMeta("com.evil.impersonator", 99, listOf(SIGNER_A)),
                InstalledApkMeta(2, listOf(SIGNER_A)),
            )
        )

        val result = verifier.verify(apk, InstalledApkMeta(2, listOf(SIGNER_A)), "com.quareia.divination")

        assertEquals(ApkVerifyResult.Failure(ApkVerifyResult.Reason.PACKAGE_MISMATCH), result)
    }

    @Test
    fun equalVersionCodeIsRejected() {
        val verifier = ApkVerifier(
            FakeReader(
                ApkMeta("com.quareia.divination", 2, listOf(SIGNER_A)),
                InstalledApkMeta(2, listOf(SIGNER_A)),
            )
        )

        val result = verifier.verify(apk, InstalledApkMeta(2, listOf(SIGNER_A)), "com.quareia.divination")

        assertEquals(ApkVerifyResult.Failure(ApkVerifyResult.Reason.VERSION_NOT_NEWER), result)
    }

    @Test
    fun lowerVersionCodeIsRejected() {
        val verifier = ApkVerifier(
            FakeReader(
                ApkMeta("com.quareia.divination", 1, listOf(SIGNER_A)),
                InstalledApkMeta(2, listOf(SIGNER_A)),
            )
        )

        val result = verifier.verify(apk, InstalledApkMeta(2, listOf(SIGNER_A)), "com.quareia.divination")

        assertEquals(ApkVerifyResult.Failure(ApkVerifyResult.Reason.VERSION_NOT_NEWER), result)
    }

    @Test
    fun signerMismatchIsRejected() {
        val verifier = ApkVerifier(
            FakeReader(
                ApkMeta("com.quareia.divination", 3, listOf(SIGNER_EVIL)),
                InstalledApkMeta(2, listOf(SIGNER_A)),
            )
        )

        val result = verifier.verify(apk, InstalledApkMeta(2, listOf(SIGNER_A)), "com.quareia.divination")

        assertEquals(ApkVerifyResult.Failure(ApkVerifyResult.Reason.SIGNER_MISMATCH), result)
    }

    @Test
    fun unknownInstalledSignersFailClosed() {
        val verifier = ApkVerifier(
            FakeReader(
                ApkMeta("com.quareia.divination", 3, listOf(SIGNER_A)),
                InstalledApkMeta(2, emptyList()),
            )
        )

        val result = verifier.verify(apk, InstalledApkMeta(2, emptyList()), "com.quareia.divination")

        assertEquals(ApkVerifyResult.Failure(ApkVerifyResult.Reason.SIGNER_MISMATCH), result)
    }

    @Test
    fun apkWithoutSignersFailClosed() {
        val verifier = ApkVerifier(
            FakeReader(
                ApkMeta("com.quareia.divination", 3, emptyList()),
                InstalledApkMeta(2, listOf(SIGNER_A)),
            )
        )

        val result = verifier.verify(apk, InstalledApkMeta(2, listOf(SIGNER_A)), "com.quareia.divination")

        assertEquals(ApkVerifyResult.Failure(ApkVerifyResult.Reason.SIGNER_MISMATCH), result)
    }

    private class FakeReader(
        private val apkMeta: ApkMeta?,
        private val installed: InstalledApkMeta,
    ) : ApkMetaReader {
        override fun readApk(path: String): ApkMeta? = apkMeta

        override fun installedMeta(): InstalledApkMeta = installed
    }

    private companion object {
        val SIGNER_A = "a".repeat(64)
        val SIGNER_OLD = "b".repeat(64)
        val SIGNER_EVIL = "c".repeat(64)
    }
}
