package com.ardia.store

import java.time.Instant
import java.time.ZoneId
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class TabsState(
    val openTabs: List<BrowserTab> = emptyList(),
    val privateTabs: List<BrowserTab> = emptyList(),
    val selectedTabId: String? = null,
    val canReopenClosed: Boolean = false,
    val lastReceived: List<BrowserTab> = emptyList(),
    val hasArchivedTabs: Boolean = false,
    val listingRevision: Int = 0,
) {
    val selectedTab: BrowserTab?
        get() = selectedTabId?.let { id -> openTabs.firstOrNull { it.id == id } ?: privateTabs.firstOrNull { it.id == id } }

    val deckTabs: List<BrowserTab> get() = openTabs + privateTabs

    val deckOrder: List<BrowserTab> get() = TabOrdering.recencyOrder(deckTabs, selectedTabId)
}

class TabStore internal constructor(
    private val database: BrowserDatabase,
    private val queue: StoreQueue,
    internal val writer: StoreWriter,
    val history: HistoryStore,
    private val settings: KeyValueStore,
    private val clock: StoreClock,
    private val zone: ZoneId,
    callbackDispatcher: CoroutineDispatcher,
    launch: LaunchState,
) {
    internal class LaunchState(val openTabs: List<BrowserTab>, val receivedKeys: Set<String>, val archivedCount: Int, val lastVisitId: Long)

    private class ClosedTab(val tab: BrowserTab, val position: Double, val wasSelected: Boolean)

    private val lock = Any()
    private val scope = CoroutineScope(SupervisorJob() + callbackDispatcher)
    private val open = ArrayList(launch.openTabs)
    private val privates = ArrayList<BrowserTab>()
    private val privateStates = HashMap<String, ByteArray>()
    private val undo = ArrayDeque<List<ClosedTab>>()
    private val knownArchived = HashMap<String, BrowserTab>()
    private val receivedKeys = HashSet(launch.receivedKeys)
    private val deleted = HashSet<String>()
    private var selected: String? = open.maxByOrNull { it.lastActive }?.id
    private var archived: MutableList<BrowserTab>? = null
    private var archivedCount = launch.archivedCount
    private var lastReceived: List<BrowserTab> = emptyList()
    private var listingRevision = 0
    private var autoArchivePending = false
    private var gridInteractionActive = false
    private var interval = AutoArchiveInterval.of(settings.string(AUTO_ARCHIVE_KEY)) ?: AutoArchiveInterval.standard
    private var schedule: Job? = null

    private val _state = MutableStateFlow(TabsState())
    private val _archive = MutableStateFlow<List<ArchivedDay>>(emptyList())
    private val _archiveLoaded = MutableStateFlow(false)

    val state: StateFlow<TabsState> = _state.asStateFlow()
    val archive: StateFlow<List<ArchivedDay>> = _archive.asStateFlow()
    val archiveLoaded: StateFlow<Boolean> = _archiveLoaded.asStateFlow()
    val writeFailure: StateFlow<Throwable?> get() = writer.failure
    val quarantinedWrites: StateFlow<List<QuarantinedWrite>> get() = writer.quarantine
    val droppedVisits: StateFlow<Int> get() = writer.droppedVisits

    fun acknowledgeWriteProblems() = writer.acknowledgeProblems()
    val hasUnsavedChanges: Boolean get() = writer.hasUnsavedChanges

    @Volatile var profileSyncId: String? = null

    @Volatile var searchTemplate: String = SearchTemplates.known.getValue("google")

    var onLocalChange: (() -> Unit)? = null
    var onTabsRemoved: ((List<BrowserTab>) -> Unit)? = null
    var onTabsArchived: ((List<String>) -> Unit)? = null
    var onPrivateTabsClosed: ((ids: List<String>, noneLeft: Boolean) -> Unit)? = null

    @Volatile private var archivedCountStale = false

    init {
        publish()
        writer.onCommit = {
            if (archivedCountStale) {
                archivedCountStale = false
                refreshArchivedCount()
            }
        }
    }

    var autoArchiveInterval: AutoArchiveInterval
        get() = synchronized(lock) { interval }
        set(value) {
            synchronized(lock) {
                if (value == interval) return
                interval = value
                settings.putString(AUTO_ARCHIVE_KEY, value.raw)
                runAutoArchive()
            }
        }

    var isGridInteractionActive: Boolean
        get() = synchronized(lock) { gridInteractionActive }
        set(value) {
            synchronized(lock) {
                gridInteractionActive = value
                if (!value && autoArchivePending) runAutoArchive()
            }
        }

    val openTabs: List<BrowserTab> get() = state.value.openTabs
    val privateTabs: List<BrowserTab> get() = state.value.privateTabs
    val selectedTabId: String? get() = state.value.selectedTabId
    val selectedTab: BrowserTab? get() = state.value.selectedTab

    fun isPrivate(id: String): Boolean = synchronized(lock) { privates.any { it.id == id } }

    fun tab(id: String): BrowserTab? = synchronized(lock) { find(id) }

    suspend fun findTab(id: String): BrowserTab? {
        synchronized(lock) {
            find(id)?.let { return it }
            if (id in deleted) return null
        }
        val stored = queue.run { database.tab(id) } ?: return null
        return synchronized(lock) {
            find(id) ?: stored.takeIf { id !in deleted }?.also { if (it.isArchived) knownArchived[id] = it }
        }
    }

    fun open(
        destination: TabDestination,
        placement: TabPlacement = TabPlacement.End,
        selecting: Boolean = true,
        isPrivate: Boolean = false,
    ): BrowserTab = synchronized(lock) {
        val date = clock.now()
        val opener = (placement as? TabPlacement.After)?.let { find(it.id) }?.takeIf { !it.isPrivate }
        val profile = if (opener != null) opener.profileSyncId else profileSyncId
        var tab = when (destination) {
            is TabDestination.Url -> BrowserTab(BrowserTab.newId(), destination.url, created = date, origin = destination.origin, profileSyncId = profile)
            is TabDestination.Search -> BrowserTab(
                BrowserTab.newId(), BrowserUrl.searchUrl(searchTemplate, destination.query), destination.query, date,
                origin = TabOrigin.SEARCH, profileSyncId = profile,
            )
            is TabDestination.Sent -> BrowserTab(
                BrowserTab.newId(), destination.tab.url, destination.tab.title, date, origin = TabOrigin.SENT,
                profileSyncId = destination.tab.profileSyncId, receivedKey = destination.tab.key, receivedFromDevice = destination.tab.fromDevice,
            )
        }
        val afterPrivate = placement is TabPlacement.After && privates.any { it.id == placement.id }
        if (isPrivate || afterPrivate) {
            var position = privates.lastOrNull()?.let { it.position + TabPositions.STEP } ?: 0.0
            if (placement is TabPlacement.After) {
                val index = privates.indexOfFirst { it.id == placement.id }
                if (index >= 0) position = TabPositions.between(privates[index].position, privates.getOrNull(index + 1)?.position) ?: position
            }
            tab = tab.copy(isPrivate = true, profileSyncId = null, receivedKey = null, receivedFromDevice = null, position = position)
            privates.add(tab)
            privates.sortBy { it.position }
            if (selecting) select(tab.id) else publish()
            return find(tab.id) ?: tab
        }
        tab = tab.copy(position = position(placement))
        tab.receivedKey?.let(receivedKeys::add)
        insertSorted(tab)
        persist(tab)
        listingRevision++
        if (selecting) select(tab.id) else publish()
        localChanged()
        find(tab.id) ?: tab
    }

    fun select(id: String?): Unit = synchronized(lock) {
        val date = clock.now()
        val current = selectedTabInternal()
        if (current != null && current.id != id) replace(current.copy(lastActive = date))
        selected = id
        selectedTabInternal()?.let { tab ->
            replace(tab.copy(lastActive = date))
            if (!tab.isPrivate) localChanged()
        }
        publish()
    }

    fun close(id: String): Unit = synchronized(lock) {
        if (privates.any { it.id == id }) closePrivate(listOf(id)) else archiveTabs(listOf(id), undoable = true)
    }

    fun closeAllPrivate(): Unit = synchronized(lock) { closePrivate(privates.map { it.id }) }

    fun archive(id: String): Unit = synchronized(lock) { archiveTabs(listOf(id), undoable = true) }

    fun closeAll(): Unit = synchronized(lock) { archiveTabs(open.map { it.id }, undoable = true) }

    fun reopenLastClosed(): List<BrowserTab> = synchronized(lock) {
        val group = undo.removeLastOrNull() ?: return emptyList()
        val date = clock.now()
        val reopened = ArrayList<String>()
        var selection: String? = null
        for (closed in group) {
            if (open.any { it.id == closed.tab.id }) continue
            val current = knownArchived[closed.tab.id] ?: closed.tab
            val position = if (open.any { it.position == closed.position }) position(TabPlacement.End) else closed.position
            val tab = current.copy(archivedAt = null, lastActive = date, position = position)
            forgetArchived(tab.id)
            insertSorted(tab)
            persist(tab)
            reopened.add(tab.id)
            if (closed.wasSelected) selection = tab.id
        }
        (selection ?: reopened.lastOrNull())?.let(::select)
        listingRevision++
        publish()
        localChanged()
        reopened.mapNotNull(::find)
    }

    suspend fun restore(id: String): Boolean {
        val tab = findTab(id) ?: return false
        if (!tab.isArchived) return false
        return restoreKnown(id)
    }

    private fun restoreKnown(id: String): Boolean = synchronized(lock) {
        val archivedTab = knownArchived[id] ?: return false
        val tab = archivedTab.copy(archivedAt = null, position = position(TabPlacement.End), lastActive = clock.now())
        forgetArchived(id)
        insertSorted(tab)
        persist(tab)
        select(id)
        listingRevision++
        publish()
        localChanged()
        true
    }

    fun move(id: String, index: Int): Unit = synchronized(lock) {
        val privateIndex = privates.indexOfFirst { it.id == id }
        if (privateIndex >= 0) {
            val tab = privates.removeAt(privateIndex)
            privates.add(index.coerceIn(0, privates.size), tab)
            privates.forEachIndexed { offset, each -> privates[offset] = each.copy(position = offset * TabPositions.STEP) }
            publish()
            return
        }
        val from = open.indexOfFirst { it.id == id }
        if (from < 0) return
        val tab = open.removeAt(from)
        val target = index.coerceIn(0, open.size)
        val between = TabPositions.between(open.getOrNull(target - 1)?.position, open.getOrNull(target)?.position)
        open.add(target, if (between != null) tab.copy(position = between) else tab)
        if (between != null) persist(open[target]) else renumberOpen()
        publish()
        localChanged()
    }

    fun delete(ids: Set<String>): Unit = synchronized(lock) {
        if (ids.isEmpty()) return
        val tabs = ids.mapNotNull { id -> find(id) ?: undo.firstNotNullOfOrNull { group -> group.firstOrNull { it.tab.id == id }?.tab } }
        open.removeAll { it.id in ids }
        if (selected in ids) selected = open.maxByOrNull { it.lastActive }?.id
        val kept = undo.map { group -> group.filter { it.tab.id !in ids } }.filter { it.isNotEmpty() }
        undo.clear()
        undo.addAll(kept)
        ids.forEach(::forgetArchived)
        deleted.addAll(ids)
        ids.forEach(writer::deleteTab)
        if (tabs.isNotEmpty()) notify { onTabsRemoved?.invoke(tabs) }
        archivedCountStale = true
        listingRevision++
        publish()
        localChanged()
    }

    fun clearArchive(): Unit = synchronized(lock) {
        if (archivedCount == 0 && knownArchived.isEmpty()) return
        deleted.addAll(knownArchived.keys)
        knownArchived.clear()
        archived?.clear()
        val kept = undo.map { group -> group.filter { closed -> open.any { it.id == closed.tab.id } } }.filter { it.isNotEmpty() }
        undo.clear()
        undo.addAll(kept)
        archivedCount = 0
        listingRevision++
        publish()
        localChanged()
        var removed: List<BrowserTab> = emptyList()
        writer.barrier("clearArchive", afterCommit = {
            synchronized(lock) { deleted.addAll(removed.map { it.id }) }
            if (removed.isNotEmpty()) notify { onTabsRemoved?.invoke(removed) }
        }) { database -> removed = database.deleteArchivedTabs() }
    }

    fun loadArchive() {
        synchronized(lock) {
            if (archived == null) archived = ArrayList()
        }
        queue.launch {
            val rows = database.archivedTabs(ARCHIVE_LIMIT)
            synchronized(lock) {
                val fresh = rows.filter { row ->
                    val known = find(row.id)
                    (known == null || known.isArchived) && row.id !in deleted
                }
                val merged = LinkedHashMap<String, BrowserTab>()
                (archived.orEmpty() + knownArchived.values + fresh).filter { it.isArchived }.sortedByDescending { it.archivedAt }.forEach { merged.putIfAbsent(it.id, knownArchived[it.id] ?: it) }
                archived = merged.values.toMutableList()
                merged.values.forEach { knownArchived[it.id] = it }
                _archiveLoaded.value = true
                publishArchive()
            }
        }
    }

    suspend fun searchArchive(text: String): List<BrowserTab> {
        val query = text.trim()
        if (query.isEmpty()) {
            synchronized(lock) { archived?.let { return it.toList() } }
            return queue.run { database.archivedTabs(ARCHIVE_SEARCH_LIMIT) }.also(::rememberArchived)
        }
        return queue.run { database.searchArchived(query, ARCHIVE_SEARCH_LIMIT) }.also(::rememberArchived)
    }

    fun update(
        id: String,
        url: String? = null,
        title: String? = null,
        faviconUrl: String? = null,
        themeColorHex: String? = null,
        snapshotFileName: String? = null,
    ): Unit = synchronized(lock) {
        val tab = find(id) ?: return
        val next = tab.copy(
            url = url ?: tab.url,
            title = title ?: tab.title,
            faviconUrl = faviconUrl ?: tab.faviconUrl,
            themeColorHex = themeColorHex ?: tab.themeColorHex,
            snapshotFileName = snapshotFileName ?: tab.snapshotFileName,
        )
        if (next == tab) return
        replace(next)
        if (tab.isPrivate) {
            publish()
            return
        }
        val syncVisible = next.url != tab.url || next.title != tab.title
        if (syncVisible) listingRevision++
        publish()
        if (syncVisible) localChanged()
    }

    fun saveInteractionState(id: String, data: ByteArray?): Unit = synchronized(lock) {
        if (privates.any { it.id == id }) {
            if (data == null) privateStates.remove(id) else privateStates[id] = data
            return
        }
        if (find(id) == null) return
        writer.saveState(id, data)
    }

    suspend fun interactionState(id: String): ByteArray? {
        synchronized(lock) { if (privates.any { it.id == id }) return privateStates[id] }
        return queue.run { database.state(id) }
    }

    fun recordVisit(url: String, title: String, transition: VisitTransition, fromTab: String? = null): Visit? =
        recordVisit(url, title, transition, fromTab, clock.now())

    internal fun recordVisit(url: String, title: String, transition: VisitTransition, fromTab: String?, at: Long): Visit? = synchronized(lock) {
        if (!BrowserUrl.isSyncable(url)) return null
        val source = fromTab?.let(::find)
        if (fromTab != null && (source == null || privates.any { it.id == fromTab })) return null
        val profile = if (source != null) source.profileSyncId else profileSyncId
        history.record(url, title, transition, profile, at)?.also { localChanged() }
    }

    fun amend(visit: Visit, url: String? = null, title: String? = null): Visit = history.amend(visit, url, title).also { localChanged() }

    fun clearHistory(since: Long? = null) = history.clear(since)

    fun appBecameActive(): Unit = synchronized(lock) {
        selectedTabInternal()?.let { replace(it.copy(lastActive = clock.now())) }
        runAutoArchive()
        pruneExpired()
        writer.retryNow()
        schedule?.cancel()
        schedule = scope.launch {
            while (isActive) {
                delay(AUTO_ARCHIVE_CHECK_MILLIS)
                runAutoArchive()
            }
        }
        publish()
    }

    fun appWillResignActive(): Unit = synchronized(lock) {
        schedule?.cancel()
        schedule = null
        selectedTabInternal()?.let { replace(it.copy(lastActive = clock.now())) }
        writer.retryNow()
        publish()
    }

    fun runAutoArchive(): Int = synchronized(lock) {
        if (gridInteractionActive) {
            autoArchivePending = true
            return 0
        }
        autoArchivePending = false
        val date = clock.now()
        val due = open.filter { AutoArchivePolicy.isDue(it.lastActive, date, interval, it.id == selected) }
        if (due.isEmpty()) return 0
        archiveTabs(due.map { it.id }, undoable = false)
        due.size
    }

    fun syncedTabs(): List<TabRecord> {
        val counts = HashMap<String?, Int>()
        return state.value.openTabs
            .filter { BrowserUrl.isSyncable(it.url) }
            .sortedByDescending { it.lastActive }
            .filter { tab ->
                val count = counts[tab.profileSyncId] ?: 0
                counts[tab.profileSyncId] = count + 1
                count < SYNCED_TAB_LIMIT
            }
            .map { TabRecord(it.url, it.title, it.lastActive, it.profileSyncId) }
    }

    fun receive(tabs: List<IncomingTab>): Boolean {
        if (tabs.isEmpty()) return true
        synchronized(lock) {
            val opened = ArrayList<BrowserTab>()
            for (incoming in tabs.sortedBy { it.sentAt }) {
                if (incoming.key in receivedKeys || !BrowserUrl.isSyncable(incoming.url)) continue
                opened.add(open(TabDestination.Sent(incoming), selecting = false))
            }
            if (opened.isNotEmpty()) {
                lastReceived = opened
                publish()
            }
        }
        writer.commitBlocking()
        val keys = tabs.map { it.key }.toSet()
        val ids = synchronized(lock) { (open.asSequence() + knownArchived.values.asSequence()).filter { it.receivedKey in keys }.map { it.id }.toList() }
        return ids.none(writer::isUnsavedTab)
    }

    fun clearLastReceived(): Unit = synchronized(lock) {
        lastReceived = emptyList()
        publish()
    }

    suspend fun flush(): Boolean = writer.commit()

    internal fun backdate(id: String, lastActive: Long? = null, archivedAt: Long? = null): Unit = synchronized(lock) {
        val tab = find(id) ?: return
        val next = tab.copy(lastActive = lastActive ?: tab.lastActive, archivedAt = if (tab.isArchived) archivedAt ?: tab.archivedAt else null)
        replace(next)
        if (next.isArchived) {
            archived?.let { list ->
                list.removeAll { it.id == id }
                list.add(next)
                list.sortByDescending { it.archivedAt }
                publishArchive()
            }
        }
        publish()
    }

    private fun closePrivate(ids: List<String>) {
        val set = ids.toSet()
        if (privates.none { it.id in set }) return
        val selectedIndex = privates.indexOfFirst { it.id == selected }
        privates.removeAll { it.id in set }
        set.forEach(privateStates::remove)
        if (selected in set) {
            selected = if (selectedIndex >= 0 && privates.isNotEmpty()) {
                privates[minOf(selectedIndex, privates.size - 1)].id
            } else {
                open.maxByOrNull { it.lastActive }?.id
            }
        }
        publish()
        val noneLeft = privates.isEmpty()
        notify { onPrivateTabsClosed?.invoke(ids, noneLeft) }
    }

    private fun archiveTabs(ids: List<String>, undoable: Boolean) {
        val date = clock.now()
        val set = ids.toSet()
        val tabs = open.filter { it.id in set }
        if (tabs.isEmpty()) return
        if (undoable) {
            undo.addLast(tabs.map { ClosedTab(it, it.position, it.id == selected) })
            while (undo.size > UNDO_LIMIT) undo.removeFirst()
        }
        val selectedIndex = open.indexOfFirst { it.id == selected }
        open.removeAll { it.id in set }
        val archivedTabs = tabs.map { it.copy(archivedAt = date) }
        archivedTabs.forEach { tab ->
            knownArchived[tab.id] = tab
            persist(tab)
        }
        archived?.let { list ->
            list.addAll(0, archivedTabs)
            list.sortByDescending { it.archivedAt }
        }
        archivedCount += archivedTabs.size
        if (selected in set) {
            val neighbour = if (selectedIndex >= 0) minOf(selectedIndex, open.size - 1) else -1
            selected = if (neighbour >= 0) open[neighbour].id else null
            selectedTabInternal()?.let { replace(it.copy(lastActive = date)) }
        }
        val archivedIds = tabs.map { it.id }
        notify { onTabsArchived?.invoke(archivedIds) }
        listingRevision++
        publish()
        publishArchive()
        localChanged()
    }

    private fun pruneExpired() {
        val date = clock.now()
        history.pruneBefore(date - HISTORY_RETENTION_MILLIS)
        val archiveCutoff = date - ARCHIVE_RETENTION_MILLIS
        queue.launch {
            val expired = (database.archivedIdsBefore(archiveCutoff) + database.archivedIdsBeyond(ARCHIVE_LIMIT)).toSet()
            if (expired.isNotEmpty()) delete(expired)
        }
    }

    private fun refreshArchivedCount() {
        queue.launch {
            val count = database.archivedCount()
            synchronized(lock) {
                archivedCount = count
                publish()
            }
        }
    }

    private fun rememberArchived(tabs: List<BrowserTab>): Unit = synchronized(lock) {
        tabs.forEach { if (find(it.id) == null && it.id !in deleted) knownArchived[it.id] = it }
    }

    private fun forgetArchived(id: String) {
        val wasArchived = knownArchived.remove(id) != null
        archived?.let { list ->
            if (list.removeAll { it.id == id }) publishArchive()
        }
        if (wasArchived && archivedCount > 0) archivedCount--
    }

    private fun find(id: String): BrowserTab? =
        open.firstOrNull { it.id == id } ?: privates.firstOrNull { it.id == id } ?: knownArchived[id]

    private fun selectedTabInternal(): BrowserTab? = selected?.let { id -> open.firstOrNull { it.id == id } ?: privates.firstOrNull { it.id == id } }

    private fun replace(tab: BrowserTab) {
        val openIndex = open.indexOfFirst { it.id == tab.id }
        if (openIndex >= 0) {
            open[openIndex] = tab
            persist(tab)
            return
        }
        val privateIndex = privates.indexOfFirst { it.id == tab.id }
        if (privateIndex >= 0) {
            privates[privateIndex] = tab
            return
        }
        if (knownArchived.containsKey(tab.id)) {
            knownArchived[tab.id] = tab
            archived?.let { list ->
                val index = list.indexOfFirst { it.id == tab.id }
                if (index >= 0) list[index] = tab
                publishArchive()
            }
            persist(tab)
        }
    }

    private fun position(placement: TabPlacement): Double {
        val end = open.lastOrNull()?.let { it.position + TabPositions.STEP } ?: 0.0
        if (placement !is TabPlacement.After) return end
        val index = open.indexOfFirst { it.id == placement.id }
        if (index < 0) return end
        TabPositions.between(open[index].position, open.getOrNull(index + 1)?.position)?.let { return it }
        renumberOpen()
        return open[index].position + TabPositions.STEP / 2
    }

    private fun renumberOpen() {
        open.forEachIndexed { offset, each ->
            val tab = each.copy(position = offset * TabPositions.STEP)
            open[offset] = tab
            persist(tab)
        }
    }

    private fun insertSorted(tab: BrowserTab) {
        open.removeAll { it.id == tab.id }
        val index = open.indexOfFirst { it.position > tab.position }.let { if (it < 0) open.size else it }
        open.add(index, tab)
    }

    private fun persist(tab: BrowserTab) {
        if (tab.isPrivate) return
        writer.putTab(tab)
    }

    private fun localChanged() {
        notify { onLocalChange?.invoke() }
    }

    private fun notify(callback: () -> Unit) {
        scope.launch { callback() }
    }

    private fun publish() {
        _state.value = TabsState(
            openTabs = open.toList(),
            privateTabs = privates.toList(),
            selectedTabId = selected,
            canReopenClosed = undo.isNotEmpty(),
            lastReceived = lastReceived,
            hasArchivedTabs = archivedCount > 0,
            listingRevision = listingRevision,
        )
    }

    private fun publishArchive() {
        val list = archived ?: return
        val days = ArrayList<ArchivedDay>()
        for (tab in list) {
            val day = Instant.ofEpochMilli(tab.archivedAt ?: tab.lastActive).atZone(zone).toLocalDate()
            if (days.lastOrNull()?.day == day) {
                days[days.size - 1] = days.last().copy(tabs = days.last().tabs + tab)
            } else {
                days.add(ArchivedDay(day, listOf(tab)))
            }
        }
        _archive.value = days
    }

    companion object {
        const val UNDO_LIMIT = 20
        const val HISTORY_RETENTION_MILLIS = 90L * 24 * 3_600_000
        const val ARCHIVE_RETENTION_MILLIS = 90L * 24 * 3_600_000
        const val ARCHIVE_LIMIT = 2000
        const val ARCHIVE_SEARCH_LIMIT = 200
        const val SYNCED_TAB_LIMIT = 30
        const val AUTO_ARCHIVE_KEY = "tabs.autoArchiveInterval"
        const val AUTO_ARCHIVE_CHECK_MILLIS = 15L * 60_000

        suspend fun load(
            database: BrowserDatabase,
            settings: KeyValueStore,
            queue: StoreQueue = StoreQueue(),
            clock: StoreClock = StoreClock.system,
            zone: ZoneId = ZoneId.systemDefault(),
            callbackDispatcher: CoroutineDispatcher = Dispatchers.Main,
            retryDelayMillis: Long? = StoreWriter.RETRY_DELAY_MILLIS,
        ): TabStore {
            val launch = queue.run { LaunchState(database.openTabs(), database.receivedKeys(), database.archivedCount(), database.maxVisitId()) }
            val writer = StoreWriter(database, queue, retryDelayMillis)
            val history = HistoryStore(database, queue, writer, clock, launch.lastVisitId)
            return TabStore(database, queue, writer, history, settings, clock, zone, callbackDispatcher, launch).also {
                synchronized(it.lock) { it.pruneExpired() }
            }
        }
    }
}
