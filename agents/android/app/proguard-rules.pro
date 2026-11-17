# Preserve SMAV Print Agent BuildConfig, DTOs, Retrofit APIs, and Room Entities during R8 shrinking

-keep class com.smav.printagent.BuildConfig { *; }

# Keep Gson models & serialized field names
-keepattributes Signature,InnerClasses,EnclosingMethod
-keepattributes RuntimeVisibleAnnotations,RuntimeVisibleParameterAnnotations,AnnotationDefault
-keepclassmembers,allowobfuscation class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
-keep class com.smav.printagent.model.** { *; }
-keep class com.google.gson.reflect.TypeToken { *; }
-keep class * extends com.google.gson.reflect.TypeToken

# Keep Retrofit service interfaces & OkHttp helpers
-keep,allowobfuscation,allowshrinking interface retrofit2.Call
-keep,allowobfuscation,allowshrinking class retrofit2.Response
-keep,allowobfuscation,allowshrinking class kotlin.coroutines.Continuation
-keep interface com.smav.printagent.network.** { *; }
-keep class com.smav.printagent.network.** { *; }

# Keep Room Database, DAOs, and Entities
-keep class * extends androidx.room.RoomDatabase
-keep @androidx.room.Entity class * { *; }
-keep @androidx.room.Dao interface * { *; }
-keep class com.smav.printagent.data.local.** { *; }

# Keep EncryptedSharedPreferences / Tink crypto reflection classes
-keep class androidx.security.crypto.** { *; }
-keep class com.google.crypto.tink.** { *; }

# Prevent R8 warnings on optional platform classes inside OkHttp/Retrofit/Gson
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn retrofit2.**
-dontwarn javax.annotation.**
-dontwarn org.codehaus.mojo.animal_sniffer.IgnoreJRERequirement
-dontwarn sun.misc.Unsafe
