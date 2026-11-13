package com.ardia.blocking

import android.content.SharedPreferences
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

interface BlockingStore {
    fun boolean(key: String): Boolean?

    fun setBoolean(key: String, value: Boolean)

    fun string(key: String): String?

    fun setString(key: String, value: String)

    fun strings(key: String): List<String>? = string(key)?.let { text ->
        runCatching { blockingJson.decodeFromString(ListSerializer(String.serializer()), text) }.getOrNull()
    }

    fun setStrings(key: String, value: List<String>) = setString(key, blockingJson.encodeToString(ListSerializer(String.serializer()), value))
}

class InMemoryBlockingStore : BlockingStore {
    private val values = HashMap<String, Any>()

    override fun boolean(key: String): Boolean? = synchronized(values) { values[key] as? Boolean }

    override fun setBoolean(key: String, value: Boolean) {
        synchronized(values) { values[key] = value }
    }

    override fun string(key: String): String? = synchronized(values) { values[key] as? String }

    override fun setString(key: String, value: String) {
        synchronized(values) { values[key] = value }
    }
}

class SharedPreferencesBlockingStore(private val preferences: SharedPreferences) : BlockingStore {
    override fun boolean(key: String): Boolean? = if (preferences.contains(key)) preferences.getBoolean(key, false) else null

    override fun setBoolean(key: String, value: Boolean) {
        preferences.edit().putBoolean(key, value).apply()
    }

    override fun string(key: String): String? = preferences.getString(key, null)

    override fun setString(key: String, value: String) {
        preferences.edit().putString(key, value).apply()
    }
}

internal val blockingJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}
