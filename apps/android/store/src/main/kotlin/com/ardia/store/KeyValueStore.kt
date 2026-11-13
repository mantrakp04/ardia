package com.ardia.store

import android.content.SharedPreferences
import java.util.concurrent.ConcurrentHashMap

interface KeyValueStore {
    fun string(key: String): String?

    fun boolean(key: String): Boolean?

    fun putString(key: String, value: String?)

    fun putBoolean(key: String, value: Boolean)
}

class SharedPreferencesStore(private val preferences: SharedPreferences) : KeyValueStore {
    override fun string(key: String): String? = preferences.getString(key, null)

    override fun boolean(key: String): Boolean? = if (preferences.contains(key)) preferences.getBoolean(key, false) else null

    override fun putString(key: String, value: String?) {
        preferences.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }

    override fun putBoolean(key: String, value: Boolean) {
        preferences.edit().putBoolean(key, value).apply()
    }
}

class MemoryKeyValueStore : KeyValueStore {
    private val values = ConcurrentHashMap<String, Any>()

    override fun string(key: String): String? = values[key] as? String

    override fun boolean(key: String): Boolean? = values[key] as? Boolean

    override fun putString(key: String, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }

    override fun putBoolean(key: String, value: Boolean) {
        values[key] = value
    }
}
