package com.quareia.divination

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * Safe public gate for an optional ignored private provider. It emits only
 * normal JUnit PASS/FAIL and never prints decrypted bytes or material.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = QuareiaApplication::class, sdk = [35])
class LxxxiPrivateIntegrationTest {

    @Test
    fun completePrivateIntegrationCanDecryptEveryRecordInMemory() {
        val application: Application = RuntimeEnvironment.getApplication()
        val provider = LxxxiAssetProviderFactory.create()
        val required = System.getProperty(REQUIRE_PRIVATE_PROPERTY) == "true"

        if (provider == null && !required) return
        assertNotNull("required private LXXXI provider is missing", provider)
        assertEquals("private LXXXI record count", 82, application.assets.list("qv").orEmpty().size)

        val before = cacheFiles(application)
        val validator = LxxxiAssetRoute("0123456789abcdef0123456789abcdef", provider)
        val logicalKeys = listOf("lxxxi-back") + (1..81).map { number ->
            "lxxxi-${number.toString().padStart(2, '0')}"
        }
        logicalKeys.forEach { key ->
            val bytes = provider!!.open(application.assets, key)
            assertTrue(
                "private LXXXI record failed validation",
                bytes != null && validator.isValidWebp(bytes),
            )
        }
        assertEquals("private LXXXI validation must not write plaintext files", before, cacheFiles(application))
    }

    private fun cacheFiles(application: Application): Set<String> = application.cacheDir
        .walkTopDown()
        .filter { it.isFile }
        .map { it.relativeTo(application.cacheDir).invariantSeparatorsPath }
        .toSet()

    private companion object {
        const val REQUIRE_PRIVATE_PROPERTY = "quareia.requirePrivateLxxxi"
    }
}
