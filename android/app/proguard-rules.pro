# The release build does not currently minify. Keep rules here for when it does:
# - Room entities are accessed reflectively by generated code.
-keep class org.opensource.tracker.** { *; }
# - osmdroid ships some optional reflection-based paths.
-dontwarn org.osmdroid.**
