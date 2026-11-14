package com.ardia.phone

import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.ardia.sync.HistoryRemoval
import com.ardia.sync.LocalBrowsingSource
import com.ardia.sync.LocalTabRecord
import com.ardia.sync.LocalVisitRecord
import com.ardia.sync.ReceivedTab
import java.io.File

fun interface BrowserQuery {
    fun query(sql: String, args: List<String>): List<List<Any?>>
}

interface BrowserRows {
    fun <T> open(block: (BrowserQuery) -> T): T?
}

class SqliteBrowserRows(private val file: File) : BrowserRows {
    override fun <T> open(block: (BrowserQuery) -> T): T? {
        if (!file.isFile) return null
        val database = SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY)
        return database.use { db ->
            val query = BrowserQuery { sql, args ->
                db.rawQuery(sql, args.toTypedArray()).use { cursor ->
                    buildList {
                        while (cursor.moveToNext()) add(List(cursor.columnCount) { column -> value(cursor, column) })
                    }
                }
            }
            block(query)
        }
    }

    private fun value(cursor: Cursor, column: Int): Any? = when (cursor.getType(column)) {
        Cursor.FIELD_TYPE_NULL -> null
        Cursor.FIELD_TYPE_INTEGER -> cursor.getLong(column)
        Cursor.FIELD_TYPE_FLOAT -> cursor.getDouble(column)
        else -> cursor.getString(column)
    }
}

class PhoneBrowsingSource(
    private val rows: BrowserRows,
    private val inbox: PhoneInbox,
    private val clock: () -> Long = System::currentTimeMillis,
) : LocalBrowsingSource {
    override fun syncedTabs(): List<LocalTabRecord> {
        val found = query("SELECT url, title, lastActive, profileSyncId FROM tabs WHERE archivedAt IS NULL", emptyList()) ?: return emptyList()
        val counts = HashMap<String?, Int>()
        return found
            .map { LocalTabRecord(it[0] as String, it[1] as String, (it[2] as Number).toLong(), it[3] as String?) }
            .filter { isSyncable(it.url) }
            .sortedByDescending { it.lastActive }
            .filter { tab ->
                val count = counts[tab.profileSyncId] ?: 0
                counts[tab.profileSyncId] = count + 1
                count < SYNCED_TAB_LIMIT
            }
    }

    override fun syncedVisits(since: Long): List<LocalVisitRecord> =
        visits("SELECT url, title, visitedAt, profileSyncId FROM visits WHERE visitedAt >= ? ORDER BY visitedAt, id", listOf("$since"))

    override fun syncedVisits(urls: Set<String>): List<LocalVisitRecord> {
        if (urls.isEmpty()) return emptyList()
        val cutoff = clock() - HISTORY_RETENTION_MILLIS
        return urls.toList().chunked(CHUNK).flatMap { chunk ->
            val marks = chunk.joinToString(",") { "?" }
            visits("SELECT url, title, visitedAt, profileSyncId FROM visits WHERE url IN ($marks) AND visitedAt >= ? ORDER BY visitedAt, id", chunk + "$cutoff")
        }
    }

    override fun removeVisits(urls: Set<String>, profileSyncId: String?) {
        if (urls.isEmpty()) return
        if (!inbox.remove(HistoryRemoval(profileSyncId, urls))) throw java.io.IOException("couldn't keep the history the Mac removed")
    }

    override fun receive(tabs: List<ReceivedTab>): Boolean = inbox.receive(tabs.filter { isSyncable(it.url) })

    private val session = ThreadLocal<BrowserQuery?>()

    override fun <T> readingTogether(block: () -> T): T {
        if (session.get() != null) return block()
        repeat(READ_ATTEMPTS) {
            val read = rows.open { query ->
                checkSchema(query)
                val before = dataVersion(query)
                session.set(query)
                try {
                    block() to (dataVersion(query) == before)
                } finally {
                    session.remove()
                }
            } ?: return block()
            if (read.second) return read.first
        }
        throw java.io.IOException("the phone's data kept changing while sync read it")
    }

    private fun query(sql: String, args: List<String>): List<List<Any?>>? {
        session.get()?.let { return it.query(sql, args) }
        return rows.open { query ->
            checkSchema(query)
            query.query(sql, args)
        }
    }

    private fun checkSchema(query: BrowserQuery) {
        query.query("PRAGMA busy_timeout = $BUSY_TIMEOUT_MILLIS", emptyList())
        val version = (query.query("PRAGMA user_version", emptyList()).firstOrNull()?.firstOrNull() as? Number)?.toInt() ?: 0
        check(version <= SCHEMA_VERSION) { "the phone's database is schema $version, newer than the $SCHEMA_VERSION sync reads" }
    }

    private fun dataVersion(query: BrowserQuery): Long = (query.query("PRAGMA data_version", emptyList()).first().first() as Number).toLong()

    private fun visits(sql: String, args: List<String>): List<LocalVisitRecord> {
        val found = query(sql, args) ?: return emptyList()
        val removed = HashMap<String?, Set<String>>()
        val records = LinkedHashMap<Pair<String, String?>, LocalVisitRecord>()
        for (row in found) {
            val url = row[0] as String
            val title = row[1] as String
            val at = (row[2] as Number).toLong()
            val profile = row[3] as String?
            if (url in removed.getOrPut(profile) { inbox.removedUrls(profile) }) continue
            val key = url to profile
            val record = records[key]
            records[key] = if (record == null) {
                LocalVisitRecord(url, title, listOf(at), profile)
            } else {
                record.copy(visitedAt = record.visitedAt + at, title = title.ifEmpty { record.title })
            }
        }
        return records.values.toList()
    }

    companion object {
        const val SYNCED_TAB_LIMIT = 30
        const val HISTORY_RETENTION_MILLIS = 90L * 24 * 3_600_000
        private const val CHUNK = 500
        const val SCHEMA_VERSION = 1
        private const val READ_ATTEMPTS = 3
        private const val BUSY_TIMEOUT_MILLIS = 5_000

        fun isSyncable(url: String): Boolean {
            val lower = url.lowercase()
            return lower.startsWith("https://") || lower.startsWith("http://")
        }
    }
}
