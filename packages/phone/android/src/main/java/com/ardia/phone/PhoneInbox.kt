package com.ardia.phone

import com.ardia.sync.HistoryRemoval
import com.ardia.sync.ReceivedTab
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.channels.FileChannel
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.nio.file.StandardOpenOption
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

class PhoneInbox(private val file: File, private val clock: () -> Long = System::currentTimeMillis) {
    data class Entry(val id: Long, val received: List<ReceivedTab>, val removals: List<HistoryRemoval>)

    private class Contents(val entries: MutableList<Entry>, val applied: ArrayDeque<String>, var readUpTo: Long) {
        fun copy() = Contents(entries.toMutableList(), ArrayDeque(applied), readUpTo)
    }

    private val lock = Any()
    private var contents: Contents? = null
    private var failNextWrite = false

    @Volatile
    var problem: String? = null
        private set

    var onChange: ((Int) -> Unit)? = null
    var onProblem: ((String) -> Unit)? = null

    fun receive(tabs: List<ReceivedTab>): Boolean = change { current ->
        val pending = current.entries.flatMap { entry -> entry.received.map { it.key } }.toSet()
        val fresh = tabs.distinctBy { it.key }.filter { it.key !in pending && it.key !in current.applied }
        if (fresh.isEmpty()) return@change false
        add(current, fresh, emptyList())
        trimReceived(current)
        true
    }

    fun remove(removal: HistoryRemoval): Boolean = change { current ->
        val pending = current.entries.flatMap { it.removals }.filter { it.profileSyncId == removal.profileSyncId }.flatMap { it.urls }.toSet()
        val fresh = removal.urls - pending
        if (fresh.isEmpty()) return@change false
        add(current, emptyList(), listOf(HistoryRemoval(removal.profileSyncId, fresh)))
        true
    }

    fun entries(): List<Entry> = synchronized(lock) {
        val current = loaded()
        val newest = current.entries.maxOfOrNull { it.id } ?: return emptyList()
        if (newest > current.readUpTo) {
            val next = current.copy().apply { readUpTo = newest }
            runCatching { persist(next) }.onSuccess { contents = next }
        }
        current.entries.toList()
    }

    fun applied(ids: Set<Long>) {
        val count = synchronized(lock) {
            val current = loaded()
            val done = current.entries.filter { it.id in ids }
            if (done.isEmpty()) return
            val next = current.copy()
            next.entries.removeAll { it.id in ids }
            for (key in done.flatMap { entry -> entry.received.map { it.key } }) remember(next.applied, key)
            persist(next)
            contents = next
            next.entries.size
        }
        onChange?.invoke(count)
    }

    fun removedUrls(profileSyncId: String?): Set<String> = synchronized(lock) {
        loaded().entries.flatMap { entry -> entry.removals.filter { it.profileSyncId == profileSyncId }.flatMap { it.urls } }.toSet()
    }

    private fun change(edit: (Contents) -> Boolean): Boolean {
        val count = synchronized(lock) {
            val current = loaded()
            if (failNextWrite) {
                failNextWrite = false
                return false
            }
            val next = current.copy()
            if (!edit(next)) return true
            try {
                persist(next)
            } catch (error: IOException) {
                return false
            }
            contents = next
            next.entries.size
        }
        onChange?.invoke(count)
        return true
    }

    private fun add(current: Contents, received: List<ReceivedTab>, removals: List<HistoryRemoval>) {
        val last = current.entries.lastOrNull()
        if (last != null && last.id > current.readUpTo) {
            val merged = last.removals.toMutableList()
            for (removal in removals) {
                val index = merged.indexOfFirst { it.profileSyncId == removal.profileSyncId }
                if (index < 0) merged += removal else merged[index] = merged[index].copy(urls = merged[index].urls + removal.urls)
            }
            current.entries[current.entries.lastIndex] = last.copy(received = last.received + received, removals = merged)
        } else {
            current.entries += Entry((current.entries.maxOfOrNull { it.id } ?: current.readUpTo) + 1, received, removals)
        }
    }

    private fun trimReceived(current: Contents) {
        val all = current.entries.flatMap { it.received }
        if (all.size <= RECEIVED_LIMIT) return
        val dropped = all.sortedBy { it.sentAt }.take(all.size - RECEIVED_LIMIT).map { it.key }.toSet()
        for (index in current.entries.indices) {
            val entry = current.entries[index]
            current.entries[index] = entry.copy(received = entry.received.filter { it.key !in dropped })
        }
        current.entries.removeAll { it.received.isEmpty() && it.removals.isEmpty() }
    }

    private fun remember(applied: ArrayDeque<String>, key: String) {
        if (key in applied) return
        applied.addLast(key)
        while (applied.size > APPLIED_MEMORY) applied.removeFirst()
    }

    private fun loaded(): Contents = contents ?: read().also { contents = it }

    private fun read(): Contents {
        staging().delete()
        if (!file.exists()) return Contents(mutableListOf(), ArrayDeque(), 0)
        val text = file.readText()
        val parsed = try {
            JSONTokenizedFile.parse(text)
        } catch (error: JSONException) {
            setAside(text)
            failNextWrite = true
            report("Ardia couldn’t read the tabs and history changes waiting from your Mac, and set them aside.")
            return Contents(mutableListOf(), ArrayDeque(), 0)
        }
        val entries = ArrayList<Entry>()
        val unreadable = JSONArray()
        for (index in 0 until parsed.entries.length()) {
            val raw = parsed.entries.opt(index)
            val entry = (raw as? JSONObject)?.let { runCatching { entry(it) }.getOrNull() }
            if (entry == null) unreadable.put(raw) else entries += entry
        }
        if (unreadable.length() > 0) {
            setAside(unreadable.toString())
            report("Ardia set aside some tabs and history changes from your Mac it couldn’t read.")
        }
        val applied = ArrayDeque<String>()
        parsed.applied?.let { list -> for (index in 0 until list.length()) list.optString(index).takeIf { it.isNotEmpty() }?.let(applied::addLast) }
        return Contents(entries, applied, parsed.readUpTo)
    }

    private fun report(message: String) {
        problem = message
        onProblem?.invoke(message)
    }

    private fun setAside(text: String) {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss-SSS", Locale.ROOT).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date(clock()))
        var aside = File(file.parentFile, "${file.name}.unreadable-$stamp")
        var suffix = 1
        while (aside.exists()) aside = File(file.parentFile, "${file.name}.unreadable-$stamp-${suffix++}")
        if (text == file.takeIf { it.exists() }?.readText()) {
            if (!file.renameTo(aside)) aside.writeText(text)
        } else {
            aside.writeText(text)
        }
    }

    private fun staging() = File(file.parentFile, ".${file.name}.partial")

    private fun persist(next: Contents) {
        val directory = file.parentFile ?: throw IOException("the sync inbox has no folder")
        if (!directory.isDirectory && !directory.mkdirs()) throw IOException("couldn't make the sync inbox's folder")
        val staged = staging()
        FileOutputStream(staged).use { out ->
            out.write(json(next).toString().toByteArray(Charsets.UTF_8))
            out.fd.sync()
        }
        try {
            Files.move(staged.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING)
        } catch (unsupported: AtomicMoveNotSupportedException) {
            Files.move(staged.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
        FileChannel.open(directory.toPath(), StandardOpenOption.READ).use { it.force(true) }
    }

    private fun json(contents: Contents): JSONObject = JSONObject()
        .put("v", FORMAT)
        .put("entries", JSONArray(contents.entries.map(::json)))
        .put("applied", JSONArray(contents.applied.toList()))
        .put("readUpTo", contents.readUpTo)

    private class JSONTokenizedFile(val entries: JSONArray, val applied: JSONArray?, val readUpTo: Long) {
        companion object {
            fun parse(text: String): JSONTokenizedFile {
                if (text.isBlank()) throw JSONException("the sync inbox is empty")
                return when (val value = org.json.JSONTokener(text).nextValue()) {
                    is JSONArray -> JSONTokenizedFile(value, null, 0)
                    is JSONObject -> JSONTokenizedFile(value.getJSONArray("entries"), value.optJSONArray("applied"), value.optLong("readUpTo", 0))
                    else -> throw JSONException("the sync inbox isn't a list")
                }
            }
        }
    }

    companion object {
        const val RECEIVED_LIMIT = 200
        const val APPLIED_MEMORY = 1_000
        private const val FORMAT = 2

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
