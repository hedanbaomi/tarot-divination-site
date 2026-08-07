package com.quareia.divination

import android.content.res.AssetManager

/**
 * Optional boundary between the open-source WebView host and the local-only
 * LXXXI vault implementation. Public builds intentionally have no provider.
 */
internal fun interface LxxxiAssetProvider {
    fun open(assets: AssetManager, logicalKey: String): ByteArray?
}

/** Loads the ignored private adapter when it is present in a complete build. */
internal object LxxxiAssetProviderFactory {
    private const val PRIVATE_PROVIDER_CLASS =
        "com.quareia.divination.PrivateLxxxiAssetProvider"

    fun create(): LxxxiAssetProvider? = try {
        val candidate = Class.forName(PRIVATE_PROVIDER_CLASS)
            .getDeclaredConstructor()
            .newInstance()
        candidate as? LxxxiAssetProvider
    } catch (_: Throwable) {
        null
    }
}
