package com.ardia.phone

import com.ardia.sync.HistoryRemoval
import com.ardia.sync.ReceivedTab
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import org.json.JSONArray
import org.json.JSONObject

class PhoneInbox(private val file: File) {
    data class Entry(val id: Long, val received: List<ReceivedTab>, val removals: List<HistoryRemoval>)

    private val lock = Any()
    private var entries: MutableList<Entry>? = null
    var onChange: ((Int) -> Unit)? = null

    fun receive(tabs: List<ReceivedTab>): Boolean = add(tabs, emptyList())

    fun remove(removal: HistoryRemoval): Boolean = add(emptyList(), listOf(removal))

    fun entries(): List<Entry> = synchronized(lock) { loaded().toList() }

    fun applied(ids: Set<Long>) {
        val count = synchronized(lock) {
            val list = loaded()
            if (!list.removeAll { it.id in ids }) return
            persist(list)
            list.size
        }
        onChange?.invoke(count)
    }

    fun removedUrls(profileSyncId: String?): Set<String> = synchronized(lock) {
        loaded().flatMap { entry -> entry.removals.filter { it.profileSyncId == profileSyncId }.flatMap { it.urls } }.toSet()
    }

    fun receivedKeys(): Set<String> = synchronized(lock) { loaded().flatMap { entry -> entry.received.map { it.key } }.toSet() }

    private fun add(received: List<ReceivedTab>, removals: List<HistoryRemoval>): Boolean {
        if (received.isEmpty() && removals.isEmpty()) return true
        val count = synchronized(lock) {
            val list = loaded()
            val known = list.flatMap { entry -> entry.received.map { it.key } }.toSet()
            val fresh = received.filter { it.key !in known }
            if (fresh.isEmpty() && removals.isEmpty()) return true
            val entry = Entry((list.maxOfOrNull { it.id } ?: 0L) + 1, fresh, removals)
            list += entry
            try {
                persist(list)
            } catch (error: IOException) {
                list.remove(entry)
                return false
            }
            list.size
        }
        onChange?.invoke(count)
        return true
    }

    private fun loaded(): MutableList<Entry> = entries ?: read().toMutableList().also { entries = it }

    private fun read(): List<Entry> {
        if (!file.isFile) return emptyList()
        val array = runCatching { JSONArray(file.readText()) }.getOrElse { return emptyList() }
        return List(array.length()) { index -> entry(array.getJSONObject(index)) }
    }

    private fun persist(list: List<Entry>) {
        file.parentFile?.mkdirs()
        val staging = File(file.parentFile, "${file.name}.partial")
        FileOutputStream(staging).use { out ->
            out.write(JSONArray(list.map(::json)).toString().toByteArray(Charsets.UTF_8))
            out.fd.sync()
        }
        if (!staging.renameTo(file)) throw IOException("couldn't save the sync inbox")
    }

    companion object {
        fun json(entry: Entry): JSONObject = JSONObject()
            .put("id", entry.id)
            .put("received", JSONArray(entry.received.map(::json)))
            .put("removals", JSONArray(entry.removals.map(::json)))

        fun json(tab: ReceivedTab): JSONObject = JSONObject()
            .put("key", tab.key)
            .put("url", tab.url)
            .put("title", tab.title)
            .put("fromDevice", tab.fromDevice)
            .put("fromDeviceId", tab.fromDeviceId)
            .put("sentAt", tab.sentAt)
            .put("profileSyncId", tab.profileSyncId)

        fun json(removal: HistoryRemoval): JSONObject = JSONObject()
            .put("profileSyncId", removal.profileSyncId ?: JSONObject.NULL)
            .put("urls", JSONArray(removal.urls.sorted()))
            .put("includesUnassigned", removal.includesUnassigned)

        private fun entry(value: JSONObject): Entry {
            val received = value.getJSONArray("received")
            val removals = value.getJSONArray("removals")
            return Entry(
                value.getLong("id"),
                List(received.length()) { index ->
                    val tab = received.getJSONObject(index)
                    ReceivedTab(
                        key = tab.getString("key"),
                        url = tab.getString("url"),
                        title = tab.getString("title"),
                        fromDevice = tab.getString("fromDevice"),
                        sentAt = tab.getLong("sentAt"),
                        profileSyncId = tab.getString("profileSyncId"),
                        fromDeviceId = tab.getString("fromDeviceId"),
                    )
                },
                List(removals.length()) { index ->
                    val removal = removals.getJSONObject(index)
                    val urls = removal.getJSONArray("urls")
                    HistoryRemoval(
                        profileSyncId = if (removal.isNull("profileSyncId")) null else removal.getString("profileSyncId"),
                        urls = List(urls.length()) { urls.getString(it) }.toSet(),
                        includesUnassigned = removal.optBoolean("includesUnassigned", false),
                    )
                },
            )
        }
    }
}
