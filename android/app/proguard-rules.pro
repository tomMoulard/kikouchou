# The app's own R8 rules. Capacitor's consumer rules (capacitor-android)
# already keep every class that extends com.getcapacitor.Plugin, which covers
# ContactSearchPlugin, and the @PluginMethod methods the bridge calls by name.

# Keep the line numbers, so a crash report points at a line. The source file
# name is replaced, so the stack trace says nothing about the source layout.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
