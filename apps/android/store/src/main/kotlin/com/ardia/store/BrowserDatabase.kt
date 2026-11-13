package com.ardia.store

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

open class BrowserDatabase(context: Context, name: String? = FILE_NAME) : AutoCloseable {
    private val helper = object : SQLiteOpenHelper(context, name, null, VERSION) {
        override fun onConfigure(db: SQLiteDatabase) {
            if (name != null) db.enableWriteAheadLogging()
        }

        override fun onCreate(db: SQLiteDatabase) {
            createSchema(db)
        }

        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    }

    private val db: SQLiteDatabase by lazy { helper.writableDatabase }

    override fun close() {
        helper.close()
    }

    internal open fun <T> inTransaction(work: () -> T): T {
        db.beginTransaction()
        try {
            val result = work()
            db.setTransactionSuccessful()
            return result
        } finally {
            db.endTransaction()
        }
    }

    internal fun tab(id: String): BrowserTab? = tabs("SELECT $TAB_COLUMNS FROM tabs WHERE id = ?", arrayOf(id)).firstOrNull()

    internal fun openTabs(): List<BrowserTab> =
        tabs("SELECT $TAB_COLUMNS FROM tabs WHERE archivedAt IS NULL ORDER BY position", emptyArray())

    internal fun archivedTabs(limit: Int, offset: Int = 0): List<BrowserTab> =
        tabs("SELECT $TAB_COLUMNS FROM tabs WHERE archivedAt IS NOT NULL ORDER BY archivedAt DESC LIMIT ? OFFSET ?", arrayOf("$limit", "$offset"))

    internal fun searchArchived(text: String, limit: Int): List<BrowserTab> {
        val pattern = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        return tabs(
            "SELECT $TAB_COLUMNS FROM tabs WHERE archivedAt IS NOT NULL AND (title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\') ORDER BY archivedAt DESC LIMIT ?",
            arrayOf(pattern, pattern, "$limit"),
        )
    }

    internal fun archivedIdsBefore(cutoff: Long): List<String> =
        strings("SELECT id FROM tabs WHERE archivedAt IS NOT NULL AND archivedAt < ?", arrayOf("$cutoff"))

    internal fun archivedIdsBeyond(limit: Int): List<String> =
        strings("SELECT id FROM tabs WHERE archivedAt IS NOT NULL ORDER BY archivedAt DESC LIMIT -1 OFFSET ?", arrayOf("$limit"))

    internal fun archivedCount(): Int = db.rawQuery("SELECT count(*) FROM tabs WHERE archivedAt IS NOT NULL", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    internal fun tabCount(): Int = db.rawQuery("SELECT count(*) FROM tabs", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    internal fun receivedKeys(): Set<String> = strings("SELECT receivedKey FROM tabs WHERE receivedKey IS NOT NULL", emptyArray()).toHashSet()

    internal open fun writeTabs(changes: Map<String, BrowserTab?>) {
        if (changes.isEmpty()) return
        transaction {
            for ((id, tab) in changes) {
                if (tab == null) {
                    db.delete("tabs", "id = ?", arrayOf(id))
                    db.delete("tab_state", "id = ?", arrayOf(id))
                } else {
                    db.insertWithOnConflict("tabs", null, values(tab), SQLiteDatabase.CONFLICT_REPLACE)
                }
            }
        }
    }

    internal fun deleteArchivedTabs(): List<BrowserTab> {
        var removed: List<BrowserTab> = emptyList()
        transaction {
            removed = tabs("SELECT $TAB_COLUMNS FROM tabs WHERE archivedAt IS NOT NULL", emptyArray())
            db.execSQL("DELETE FROM tab_state WHERE id IN (SELECT id FROM tabs WHERE archivedAt IS NOT NULL)")
            db.execSQL("DELETE FROM tabs WHERE archivedAt IS NOT NULL")
        }
        return removed
    }

    internal fun saveState(id: String, data: ByteArray?) {
        if (data == null) {
            db.delete("tab_state", "id = ?", arrayOf(id))
        } else {
            db.insertWithOnConflict("tab_state", null, ContentValues().apply { put("id", id); put("data", data) }, SQLiteDatabase.CONFLICT_REPLACE)
        }
    }

    internal fun state(id: String): ByteArray? =
        db.rawQuery("SELECT data FROM tab_state WHERE id = ?", arrayOf(id)).use { if (it.moveToFirst()) it.getBlob(0) else null }

    internal fun maxVisitId(): Long = db.rawQuery("SELECT max(id) FROM visits", null).use { if (it.moveToFirst() && !it.isNull(0)) it.getLong(0) else 0L }

    internal open fun insertVisit(visit: Visit) {
        db.insertWithOnConflict("visits", null, values(visit), SQLiteDatabase.CONFLICT_REPLACE)
    }

    internal fun updateVisit(visit: Visit) {
        db.update("visits", values(visit), "id = ?", arrayOf("${visit.id}"))
    }

    internal fun deleteVisits(since: Long?): Int =
        if (since == null) db.delete("visits", null, null) else db.delete("visits", "visitedAt >= ?", arrayOf("$since"))

    internal fun deleteVisitsBefore(cutoff: Long): Int = db.delete("visits", "visitedAt < ?", arrayOf("$cutoff"))

    internal fun deleteVisitIds(ids: Collection<Long>): Int = inChunks(ids.map { "$it" }) { marks, args -> db.delete("visits", "id IN ($marks)", args) }

    internal fun deleteVisits(urls: Collection<String>, profileSyncId: String?): Int = inChunks(urls.toList()) { marks, args ->
        if (profileSyncId == null) {
            db.delete("visits", "url IN ($marks) AND profileSyncId IS NULL", args)
        } else {
            db.delete("visits", "url IN ($marks) AND profileSyncId = ?", args + profileSyncId)
        }
    }

    internal fun deleteVisits(url: String): Int = db.delete("visits", "url = ?", arrayOf(url))

    internal fun visitsSince(since: Long): List<Visit> =
        visits("SELECT $VISIT_COLUMNS FROM visits WHERE visitedAt >= ? ORDER BY visitedAt, id", arrayOf("$since"))

    internal fun visits(urls: Collection<String>, since: Long): List<Visit> {
        val found = ArrayList<Visit>()
        inChunks(urls.toList()) { marks, args ->
            found += visits("SELECT $VISIT_COLUMNS FROM visits WHERE url IN ($marks) AND visitedAt >= ?", args + "$since")
            0
        }
        return found.sortedWith(compareBy({ it.visitedAt }, { it.id }))
    }

    internal fun newestVisits(limit: Int): List<Visit> =
        visits("SELECT $VISIT_COLUMNS FROM visits ORDER BY visitedAt DESC, id DESC LIMIT ?", arrayOf("$limit"))

    internal fun visitsBefore(before: Long, limit: Int): List<Visit> =
        visits("SELECT $VISIT_COLUMNS FROM visits WHERE visitedAt < ? ORDER BY visitedAt DESC, id DESC LIMIT ?", arrayOf("$before", "$limit"))

    internal fun searchVisits(text: String, limit: Int): List<Visit> {
        val pattern = "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        return visits(
            "SELECT $VISIT_COLUMNS FROM visits WHERE title LIKE ? ESCAPE '\\' OR url LIKE ? ESCAPE '\\' ORDER BY visitedAt DESC, id DESC LIMIT ?",
            arrayOf(pattern, pattern, "$limit"),
        )
    }

    internal fun visitCount(): Int = db.rawQuery("SELECT count(*) FROM visits", null).use { if (it.moveToFirst()) it.getInt(0) else 0 }

    private inline fun transaction(work: () -> Unit) {
        db.beginTransaction()
        try {
            work()
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    private inline fun inChunks(items: List<String>, run: (String, Array<String>) -> Int): Int {
        var total = 0
        for (chunk in items.chunked(500)) {
            total += run(chunk.joinToString(",") { "?" }, chunk.toTypedArray())
        }
        return total
    }

    private fun strings(sql: String, args: Array<String>): List<String> = db.rawQuery(sql, args).use { cursor ->
        buildList { while (cursor.moveToNext()) add(cursor.getString(0)) }
    }

    private fun tabs(sql: String, args: Array<String>): List<BrowserTab> = db.rawQuery(sql, args).use { cursor ->
        buildList { while (cursor.moveToNext()) add(tab(cursor)) }
    }

    private fun visits(sql: String, args: Array<String>): List<Visit> = db.rawQuery(sql, args).use { cursor ->
        buildList { while (cursor.moveToNext()) add(visit(cursor)) }
    }

    private fun tab(cursor: Cursor) = BrowserTab(
        id = cursor.getString(0),
        url = cursor.getString(1),
        title = cursor.getString(2),
        created = cursor.getLong(3),
        lastActive = cursor.getLong(4),
        archivedAt = if (cursor.isNull(5)) null else cursor.getLong(5),
        position = cursor.getDouble(6),
        profileSyncId = cursor.getStringOrNull(7),
        faviconUrl = cursor.getStringOrNull(8),
        themeColorHex = cursor.getStringOrNull(9),
        snapshotFileName = cursor.getStringOrNull(10),
        origin = TabOrigin.of(cursor.getString(11)),
        receivedKey = cursor.getStringOrNull(12),
        receivedFromDevice = cursor.getStringOrNull(13),
    )

    private fun visit(cursor: Cursor) = Visit(
        id = cursor.getLong(0),
        url = cursor.getString(1),
        title = cursor.getString(2),
        visitedAt = cursor.getLong(3),
        profileSyncId = cursor.getStringOrNull(4),
        transition = VisitTransition.of(cursor.getString(5)),
    )

    private fun Cursor.getStringOrNull(index: Int): String? = if (isNull(index)) null else getString(index)

    private fun values(tab: BrowserTab) = ContentValues().apply {
        put("id", tab.id)
        put("url", tab.url)
        put("title", tab.title)
        put("created", tab.created)
        put("lastActive", tab.lastActive)
        put("archivedAt", tab.archivedAt)
        put("position", tab.position)
        put("profileSyncId", tab.profileSyncId)
        put("faviconUrl", tab.faviconUrl)
        put("themeColorHex", tab.themeColorHex)
        put("snapshotFileName", tab.snapshotFileName)
        put("origin", tab.origin.raw)
        put("receivedKey", tab.receivedKey)
        put("receivedFromDevice", tab.receivedFromDevice)
    }

    private fun values(visit: Visit) = ContentValues().apply {
        put("id", visit.id)
        put("url", visit.url)
        put("title", visit.title)
        put("visitedAt", visit.visitedAt)
        put("profileSyncId", visit.profileSyncId)
        put("transition", visit.transition.raw)
    }

    companion object {
        const val FILE_NAME = "browser.db"
        private const val VERSION = 1
        private const val TAB_COLUMNS =
            "id, url, title, created, lastActive, archivedAt, position, profileSyncId, faviconUrl, themeColorHex, snapshotFileName, origin, receivedKey, receivedFromDevice"
        private const val VISIT_COLUMNS = "id, url, title, visitedAt, profileSyncId, transition"

        private fun createSchema(db: SQLiteDatabase) {
            db.execSQL(
                "CREATE TABLE tabs (id TEXT PRIMARY KEY NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, created INTEGER NOT NULL, " +
                    "lastActive INTEGER NOT NULL, archivedAt INTEGER, position REAL NOT NULL, profileSyncId TEXT, faviconUrl TEXT, " +
                    "themeColorHex TEXT, snapshotFileName TEXT, origin TEXT NOT NULL, receivedKey TEXT, receivedFromDevice TEXT)",
            )
            db.execSQL("CREATE INDEX tabs_archivedAt ON tabs(archivedAt)")
            db.execSQL("CREATE INDEX tabs_receivedKey ON tabs(receivedKey) WHERE receivedKey IS NOT NULL")
            db.execSQL("CREATE TABLE tab_state (id TEXT PRIMARY KEY NOT NULL, data BLOB NOT NULL)")
            db.execSQL(
                "CREATE TABLE visits (id INTEGER PRIMARY KEY NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, visitedAt INTEGER NOT NULL, " +
                    "profileSyncId TEXT, transition TEXT NOT NULL)",
            )
            db.execSQL("CREATE INDEX visits_url ON visits(url)")
            db.execSQL("CREATE INDEX visits_visitedAt ON visits(visitedAt)")
            db.execSQL("CREATE INDEX visits_profile_visitedAt ON visits(profileSyncId, visitedAt)")
        }
    }
}
