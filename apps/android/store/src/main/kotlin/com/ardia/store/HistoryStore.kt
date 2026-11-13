package com.ardia.store

import java.time.Instant
import java.time.ZoneId
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

class HistoryStore internal constructor(
    private val database: BrowserDatabase,
    private val queue: StoreQueue,
    private val writer: StoreWriter,
    private val clock: StoreClock,
    lastVisitId: Long,
) {
    private val nextId = AtomicLong(lastVisitId)
    private val _revision = MutableStateFlow(0)

    val revision: StateFlow<Int> = _revision.asStateFlow()

    fun record(url: String, title: String, transition: VisitTransition, profileSyncId: String?, at: Long = clock.now()): Visit? {
        if (!BrowserUrl.isSyncable(url)) return null
        val visit = Visit(nextId.incrementAndGet(), url, title, at, profileSyncId, transition)
        writer.putVisit(visit, isNew = true)
        bump()
        return visit
    }

    fun amend(visit: Visit, url: String? = null, title: String? = null): Visit {
        val amended = visit.copy(
            url = url?.takeIf(BrowserUrl::isSyncable) ?: visit.url,
            title = title?.takeIf { it.isNotEmpty() } ?: visit.title,
        )
        writer.putVisit(amended, isNew = false)
        bump()
        return amended
    }

    fun clear(since: Long? = null) {
        writer.barrier("clearHistory:$since", covers = { since == null || it.visitedAt >= since }) { it.deleteVisits(since) }
        bump()
    }

    fun clear(range: ClearRange, zone: ZoneId = ZoneId.systemDefault()) {
        clear(range.since(clock.now(), zone))
    }

    fun delete(ids: Set<Long>) {
        if (ids.isEmpty()) return
        writer.barrier("deleteVisits:${ids.sorted()}", covers = { it.id in ids }) { it.deleteVisitIds(ids) }
        bump()
    }

    fun deleteAll(url: String) {
        writer.barrier("deleteUrl:$url", covers = { it.url == url }) { it.deleteVisits(url) }
        bump()
    }

    suspend fun recent(limit: Int = 100, before: Long? = null): List<Visit> = queue.run {
        if (before == null) database.newestVisits(limit) else database.visitsBefore(before, limit)
    }

    suspend fun search(text: String, limit: Int = 200): List<Visit> {
        val query = text.trim()
        if (query.isEmpty()) return recent(limit)
        return queue.run { database.searchVisits(query, limit) }
    }

    suspend fun summary(limit: Int = SUMMARY_LIMIT, scan: Int = SUMMARY_SCAN): List<HistoryRow> = queue.run {
        summarize(database.newestVisits(scan), limit)
    }

    suspend fun recentSearches(limit: Int = RECENT_SEARCH_LIMIT, scan: Int = RECENT_SEARCH_SCAN): List<String> {
        val urls = summary(scan, scan * 4).map { it.url }
        return RecentSearches.queries(urls, limit)
    }

    suspend fun syncedVisits(since: Long): List<VisitRecord> = queue.run { group(database.visitsSince(since)) }

    suspend fun syncedVisits(urls: Set<String>): List<VisitRecord> {
        if (urls.isEmpty()) return emptyList()
        val cutoff = clock.now() - TabStore.HISTORY_RETENTION_MILLIS
        return queue.run { group(database.visits(urls, cutoff)) }
    }

    suspend fun removeVisits(urls: Set<String>, profileSyncId: String?) {
        if (urls.isEmpty()) return
        writer.barrier("removeVisits:$profileSyncId:${urls.sorted()}", covers = { it.url in urls && it.profileSyncId == profileSyncId }) { it.deleteVisits(urls, profileSyncId) }
        bump()
        writer.commit()
    }

    suspend fun count(): Int = queue.run { database.visitCount() }

    internal fun pruneBefore(cutoff: Long) {
        var removed = 0
        writer.barrier("prune:$cutoff", covers = { it.visitedAt < cutoff }, afterCommit = { if (removed > 0) bump() }) { removed = it.deleteVisitsBefore(cutoff) }
    }

    private fun bump() {
        _revision.update { it + 1 }
    }

    companion object {
        const val SUMMARY_LIMIT = 5000
        const val SUMMARY_SCAN = 20_000
        const val RECENT_SEARCH_LIMIT = 3
        const val RECENT_SEARCH_SCAN = 400

        fun summarize(newestFirst: List<Visit>, limit: Int): List<HistoryRow> {
            val rows = LinkedHashMap<String, HistoryRow>()
            for (visit in newestFirst) {
                val row = rows[visit.url]
                if (row != null) {
                    rows[visit.url] = row.copy(visits = row.visits + 1, title = row.title.ifEmpty { visit.title })
                } else if (rows.size < limit) {
                    rows[visit.url] = HistoryRow(visit.url, visit.title, null, 1, visit.visitedAt.toDouble())
                }
            }
            return rows.values.toList()
        }

        fun group(visits: List<Visit>): List<VisitRecord> {
            val records = LinkedHashMap<Pair<String, String?>, VisitRecord>()
            for (visit in visits) {
                val key = visit.url to visit.profileSyncId
                val record = records[key]
                records[key] = if (record == null) {
                    VisitRecord(visit.url, visit.title, listOf(visit.visitedAt), visit.profileSyncId)
                } else {
                    record.copy(visitedAt = record.visitedAt + visit.visitedAt, title = visit.title.ifEmpty { record.title })
                }
            }
            return records.values.toList()
        }
    }
}

enum class ClearRange(val title: String, val phrase: String) {
    LAST_HOUR("Last Hour", "from the last hour"),
    TODAY("Today", "from today"),
    TODAY_AND_YESTERDAY("Today and Yesterday", "from today and yesterday"),
    ALL_TIME("All Time", "from all time");

    fun since(now: Long, zone: ZoneId = ZoneId.systemDefault()): Long? {
        val startOfToday = Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone)
        return when (this) {
            LAST_HOUR -> now - 3_600_000L
            TODAY -> startOfToday.toInstant().toEpochMilli()
            TODAY_AND_YESTERDAY -> startOfToday.minusDays(1).toInstant().toEpochMilli()
            ALL_TIME -> null
        }
    }
}
