package com.quareia.divination

import java.io.File

/**
 * Package-metadata verification for a downloaded update APK.
 *
 * [ApkMetaReader] is the only Android-dependent seam: it reads package
 * metadata (package name, versionCode and signer certificate digests) from
 * the archive and from the currently installed app. [ApkVerifier] contains
 * the pure decision logic so every rejection path is unit-testable without a
 * device. Signatures are compared by the SHA-256 of the signer certificates
 * read from the system, never by strings typed in source code.
 */

/** Metadata read from a candidate APK archive. */
internal data class ApkMeta(
    val packageName: String,
    val versionCode: Int,
    /** SHA-256 (lowercase hex) of every signer certificate of the archive. */
    val signerSha256: List<String>,
)

/** Metadata of the currently installed application. */
internal data class InstalledApkMeta(
    val versionCode: Int,
    /** SHA-256 (lowercase hex) of current + past signer certificates. */
    val signerSha256: List<String>,
)

/** Platform-specific source of package metadata. */
internal interface ApkMetaReader {
    /** Parses an APK file; null when the PackageManager cannot parse it. */
    fun readApk(path: String): ApkMeta?

    fun installedMeta(): InstalledApkMeta
}

internal sealed class ApkVerifyResult {
    data class Success(val versionCode: Int) : ApkVerifyResult()
    data class Failure(val reason: Reason) : ApkVerifyResult()

    enum class Reason {
        NOT_PARSABLE,
        PACKAGE_MISMATCH,
        VERSION_NOT_NEWER,
        SIGNER_MISMATCH,
    }
}

/** Decides whether a downloaded APK may be handed to the system installer. */
internal class ApkVerifier(
    private val reader: ApkMetaReader,
) {

    fun verify(apk: File, installed: InstalledApkMeta, expectedPackageName: String): ApkVerifyResult {
        val meta = reader.readApk(apk.absolutePath)
            ?: return ApkVerifyResult.Failure(ApkVerifyResult.Reason.NOT_PARSABLE)

        if (!meta.packageName.equals(expectedPackageName, ignoreCase = true)) {
            return ApkVerifyResult.Failure(ApkVerifyResult.Reason.PACKAGE_MISMATCH)
        }

        if (installed.versionCode >= 0 && meta.versionCode <= installed.versionCode) {
            return ApkVerifyResult.Failure(ApkVerifyResult.Reason.VERSION_NOT_NEWER)
        }

        // Fail closed: unknown signers on either side are a rejection.
        if (meta.signerSha256.isEmpty() || installed.signerSha256.isEmpty()) {
            return ApkVerifyResult.Failure(ApkVerifyResult.Reason.SIGNER_MISMATCH)
        }
        if (meta.signerSha256.any { it !in installed.signerSha256 }) {
            return ApkVerifyResult.Failure(ApkVerifyResult.Reason.SIGNER_MISMATCH)
        }

        return ApkVerifyResult.Success(meta.versionCode)
    }
}
