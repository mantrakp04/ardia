package com.ardia.browser.android.system

import android.content.Context
import com.ardia.design.ProfileLook
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

data class SystemTab(val title: String, val url: String, val favicon: String? = null) {
    val host: String?
        get() = runCatching { java.net.URI(url).host }.getOrNull()?.lowercase()?.removePrefix("www.")?.ifEmpty { null }

    val displayTitle: String get() = title.trim().ifEmpty { host ?: url }
}

data class SystemDevice(val id: String, val name: String, val kind: String) {
    val isMac: Boolean get() = kind == MAC

    companion object {
        const val MAC = "mac"
        const val PHONE = "phone"
    }
}

data class SystemDeviceTabs(val device: SystemDevice, val tabs: List<SystemTab>)

data class SystemSnapshot(
    val isSyncEnabled: Boolean = false,
    val macTabs: List<SystemDeviceTabs> = emptyList(),
    val sendTargets: List<SystemDevice> = emptyList(),
    val gradient: List<String> = emptyList(),
    val darkGradient: List<String>? = null,
    val color: String? = null,
    val version: Int = CURRENT_VERSION,
) {
    val look: ProfileLook get() = ProfileLook.of(color, gradient, darkGradient)

    val faviconNames: Set<String> get() = macTabs.flatMap { group -> group.tabs.mapNotNull { it.favicon } }.toSet()

    val hasMacTabs: Boolean get() = macTabs.any { it.tabs.isNotEmpty() }

    fun toJson(): String = JSONObject().apply {
        put("version", version)
        put("isSyncEnabled", isSyncEnabled)
        put("macTabs", JSONArray(macTabs.map { group -> JSONObject().put("device", device(group.device)).put("tabs", JSONArray(group.tabs.map(::tab))) }))
        put("sendTargets", JSONArray(sendTargets.map(::device)))
        put("gradient", JSONArray(gradient))
        darkGradient?.let { put("darkGradient", JSONArray(it)) }
        color?.let { put("color", it) }
    }.toString()

    companion object {
        const val CURRENT_VERSION = 1
        const val TAB_LIMIT_PER_DEVICE = 8

        val empty = SystemSnapshot()

        fun fromJson(text: String): SystemSnapshot? = runCatching {
            val json = JSONObject(text)
            if (json.optInt("version") != CURRENT_VERSION) return null
            SystemSnapshot(
                isSyncEnabled = json.optBoolean("isSyncEnabled"),
                macTabs = json.optJSONArray("macTabs").objects().map { group ->
                    SystemDeviceTabs(device(group.getJSONObject("device")), group.optJSONArray("tabs").objects().map(::tab))
                },
                sendTargets = json.optJSONArray("sendTargets").objects().map(::device),
                gradient = json.optJSONArray("gradient").strings(),
                darkGradient = json.optJSONArray("darkGradient")?.strings(),
                color = json.optString("color").ifEmpty { null },
            )
        }.getOrNull()

        private fun device(device: SystemDevice) = JSONObject().put("id", device.id).put("name", device.name).put("kind", device.kind)

        private fun device(json: JSONObject) = SystemDevice(json.getString("id"), json.getString("name"), json.getString("kind"))

        private fun tab(tab: SystemTab) = JSONObject().put("title", tab.title).put("url", tab.url).apply { tab.favicon?.let { put("favicon", it) } }

        private fun tab(json: JSONObject) = SystemTab(json.optString("title"), json.getString("url"), json.optString("favicon").ifEmpty { null })

        private fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).map { getJSONObject(it) }

        private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
    }
}

class SystemStore(val directory: File) {
    private val snapshotFile get() = File(directory, "snapshot.json")
    val faviconDirectory: File get() = File(directory, "Favicons")

    fun loadSnapshot(): SystemSnapshot = runCatching { SystemSnapshot.fromJson(snapshotFile.readText()) }.getOrNull() ?: SystemSnapshot.empty

    fun save(snapshot: SystemSnapshot): Boolean {
        val written = runCatching {
            directory.mkdirs()
            val temporary = File(directory, "snapshot.json.tmp")
            temporary.writeText(snapshot.toJson())
            check(temporary.renameTo(snapshotFile))
        }.isSuccess
        if (written) removeFavicons(except = snapshot.faviconNames)
        return written
    }

    fun favicon(name: String): File = File(faviconDirectory, name)

    fun hasFavicon(name: String): Boolean = favicon(name).isFile

    fun saveFavicon(png: ByteArray, name: String): Boolean = runCatching {
        faviconDirectory.mkdirs()
        val temporary = File(faviconDirectory, "$name.tmp")
        temporary.writeBytes(png)
        check(temporary.renameTo(favicon(name)))
    }.isSuccess

    private fun removeFavicons(except: Set<String>) {
        faviconDirectory.listFiles()?.filter { it.name !in except }?.forEach { it.delete() }
    }

    companion object {
        const val FOLDER = "System"
        const val DEMO_FOLDER = "DemoSystem"

        fun shared(context: Context): SystemStore = SystemStore(File(context.applicationContext.filesDir, FOLDER))

        fun demo(context: Context): SystemStore = SystemStore(File(context.applicationContext.cacheDir, DEMO_FOLDER))

        fun faviconName(host: String): String {
            var hash = -0x340d631b7bdddcdbL
            for (byte in host.lowercase().toByteArray(Charsets.UTF_8)) {
                hash = hash xor (byte.toLong() and 0xFF)
                hash *= 0x100000001b3L
            }
            return java.lang.Long.toUnsignedString(hash, 16) + ".png"
        }
    }
}
