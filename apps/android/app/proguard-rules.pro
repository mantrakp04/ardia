-keepclasseswithmembernames,includedescriptorclasses class * {
    native <methods>;
}
-keep class com.ardia.shared.ScriptEngine { *; }
-keep class com.ardia.shared.ScriptError { <init>(java.lang.String); }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep @com.facebook.proguard.annotations.DoNotStrip class * { *; }
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}
-keep @com.facebook.jni.annotations.DoNotStrip class * { *; }
-keepclassmembers class * {
    @com.facebook.jni.annotations.DoNotStrip *;
}
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}
-dontwarn com.facebook.proguard.annotations.DoNotStrip
-dontwarn com.facebook.jni.annotations.DoNotStrip
