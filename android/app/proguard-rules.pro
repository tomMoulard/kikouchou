# The app's own R8 rules. Capacitor's consumer rules (capacitor-android)
# already keep every class that extends com.getcapacitor.Plugin, which covers
# ContactSearchPlugin, and the @PluginMethod methods the bridge calls by name.

# Keep the line numbers, so a crash report points at a line. The source file
# name is replaced, so the stack trace says nothing about the source layout.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Keep Capacitor's annotation types. Its consumer rules keep the annotated
# plugin classes but not the annotations, and no class in the program
# implements an annotation interface: the runtime makes a proxy for it. R8
# therefore decided that a field typed CapacitorPlugin can only hold null,
# removed PluginHandle.pluginAnnotation and folded getPluginAnnotation() to
# null. Every plugin then reported no permissions: checkPermissions and
# requestPermissions resolved with no data, and ContactSearch.search refused
# for want of a permission it could never get (v0.1.5, v0.1.9, v0.1.10).
# A kept type may have instances, so R8 keeps the field. The names may still
# be obfuscated, because the bridge reaches them through class literals.
-keep,allowobfuscation @interface com.getcapacitor.** { *; }
