# The only runtime reflection in the app is the deliberately narrow WebView
# bridge used for telemetry/about actions. Keep annotated method names so the
# page contract survives R8, while allowing the containing classes and all
# crypto/vault implementation details to be obfuscated and optimized.
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
-keepclassmembers,allowoptimization class * {
    @android.webkit.JavascriptInterface <methods>;
}

# The open-source host discovers this ignored local-only adapter by name. Keep
# only the adapter entry point; its vault dependencies remain obfuscatable.
-keep,allowoptimization class com.quareia.divination.PrivateLxxxiAssetProvider {
    public <init>();
}

# Do not retain source paths or verbose local variable metadata in the
# distributable mapping. The private mapping file is still generated for crash
# retracing by the release build.
-renamesourcefileattribute SourceFile
