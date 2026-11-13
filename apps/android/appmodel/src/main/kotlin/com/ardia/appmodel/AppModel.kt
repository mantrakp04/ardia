package com.ardia.appmodel

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.compose.runtime.Stable
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.Snapshot
import com.ardia.blocking.BlockingSettings
import com.ardia.blocking.BlockingSettingsState
import com.ardia.blocking.ContentBlocker
import com.ardia.blocking.FilterLists
import com.ardia.blocking.FilterListsState
import com.ardia.blocking.MyFiltersResult
import com.ardia.browser.BrowserUrl as PageUrl
import com.ardia.browser.DownloadFailure
import com.ardia.browser.DownloadOutcome
import com.ardia.browser.Page
import com.ardia.browser.PageColors
import com.ardia.browser.PageDownload
import com.ardia.browser.PageEngine
import com.ardia.browser.PageEvent
import com.ardia.browser.PageSetup
import com.ardia.browser.PageState
import com.ardia.browser.PageTone
import com.ardia.browser.PopupRequest
import com.ardia.browser.PrivatePagesUnavailableException
import com.ardia.browser.DownloadProgress
import com.ardia.browser.SitePreferences
import com.ardia.browser.VisitKind
import com.ardia.browser.WebsiteDataKind
import com.ardia.design.ArdiaSymbols
import com.ardia.design.ProfileLook
import com.ardia.design.ReceivedTabsSender
import com.ardia.design.Toast
import com.ardia.design.ToastCenter
import com.ardia.design.Toasts
import com.ardia.store.AppLinkPreference
import com.ardia.store.AppPreferences
import com.ardia.store.ArchivedDay
import com.ardia.store.AutoArchiveInterval
import com.ardia.store.BrowserStore
import com.ardia.store.BrowserTab
import com.ardia.store.BrowserUrl
import com.ardia.store.BrowsingPreferences
import com.ardia.store.BrowsingSettings
import com.ardia.store.ClearRange
import com.ardia.store.ColorChoice
import com.ardia.store.NightShadeMode
import com.ardia.store.Omnibox
import com.ardia.store.OmniboxResolution
import com.ardia.store.RecentSearches
import com.ardia.store.SearchEngineInfo
import com.ardia.store.SearchInput
import com.ardia.store.SearchSuggestion
import com.ardia.store.SearchSuggestions
import com.ardia.store.SearchTemplates
import com.ardia.store.SwipeNavigationMode
import com.ardia.store.TabDestination
import com.ardia.store.TabOrigin
import com.ardia.store.TabPlacement
import com.ardia.store.TabStore
import com.ardia.store.TabsState
import com.ardia.store.Visit
import com.ardia.sync.ConnectResult
import com.ardia.sync.PhraseCheck
import com.ardia.sync.SyncController
import com.ardia.sync.SyncFolderPick
import com.ardia.sync.SyncPhase
import com.ardia.sync.SyncSnapshot
import com.ardia.sync.SyncState
import com.ardia.sync.SyncedDevice
import com.ardia.sync.SyncedProfile
import java.net.URLEncoder
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

@Stable
class AppModel(
    val launch: LaunchArguments,
    private val environment: AppEnvironment,
    private val mainDispatcher: CoroutineDispatcher = Dispatchers.Main.immediate,
) {
    enum class Surface { Search, Browsing, TabSwitcher }

    enum class Sheet { Settings, SyncSetup, Onboarding, Archive, SyncedSpaces }

    data class ClearChoice(val history: Boolean, val cache: Boolean, val cookies: Boolean, val archive: Boolean) {
        val isEmpty: Boolean get() = !history && !cache && !cookies && !archive

        val websiteData: Set<WebsiteDataKind>
            get() = buildSet {
                if (cache) add(WebsiteDataKind.Cache)
                if (cookies) add(WebsiteDataKind.CookiesAndSiteData)
            }
    }

    val isDemo: Boolean = environment.isDemo
    internal val scope = CoroutineScope(SupervisorJob() + mainDispatcher)
    internal val system: SystemActions = environment.system

    val appPreferences = AppPreferences(environment.preferences).also(::applyDemoSettings)
    val preferences = BrowsingPreferences(environment.preferences)
    val settings = SettingsModel(appPreferences)
    val blocking = BlockingSettings(environment.blockingStore)
    val omnibox = Omnibox(environment.coreScript, directory = environment.omniboxDirectory)
    val sync: SyncController = environment.makeSync()
    val browse = BrowseSession(scope)
    val deck = TabDeckModel(appPreferences)
    val toasts = ToastCenter(scope)
    val defaultBrowser = DefaultBrowserStatus(system, asksSystem = !isDemo)
    val sitePreferences: SitePreferences = StoreSitePreferences(preferences)

    var surface: Surface by mutableStateOf(Surface.Search)
    var sheet: Sheet? by mutableStateOf(null)
    private var incognitoState: Boolean by mutableStateOf(false)
    var isIncognito: Boolean
        get() = incognitoState
        set(value) {
            if (value && !allowsIncognito()) return
            incognitoState = value
        }
    var supportsIncognito: Boolean by mutableStateOf(true)
        private set

    val isPrivateOnScreen: Boolean get() = incognitoState || tabs.privateTabs.isNotEmpty()

    var store: BrowserStore? by mutableStateOf(null)
        private set
    val isReady: Boolean get() = store != null
    var tabs: TabsState by mutableStateOf(TabsState())
        private set
    var archive: List<ArchivedDay> by mutableStateOf(emptyList())
        private set
    var archiveLoaded: Boolean by mutableStateOf(false)
        private set
    var browsing: BrowsingSettings by mutableStateOf(preferences.current)
        private set
    var blockingState: BlockingSettingsState by mutableStateOf(blocking.state.value)
        private set
    var blocker: ContentBlocker? by mutableStateOf(null)
        private set
    var filterListsState: FilterListsState by mutableStateOf(FilterListsState())
        private set
    var syncState: SyncState by mutableStateOf(sync.state.value)
        private set
    var syncSnapshot: SyncSnapshot by mutableStateOf(sync.snapshot.value)
        private set
    var selectedProfile: SyncedProfile? by mutableStateOf(sync.selectedProfile.value)
        private set
    var recentQueries: List<String> by mutableStateOf(emptyList())
        private set
    var downloads: List<DownloadProgress> by mutableStateOf(emptyList())
        private set
    private var privateDownloadIds: Set<Long> by mutableStateOf(emptySet())
    private var privateStopAnnounced = false
    val privateDownloadsInFlight: Int get() = downloads.count { it.id in privateDownloadIds }
    var saveFailure: Throwable? by mutableStateOf(null)
        private set
    private var autoArchiveState: AutoArchiveInterval by mutableStateOf(AutoArchiveInterval.standard)

    val pages = mutableStateMapOf<String, Page>()
    val snapshotVersions = mutableStateMapOf<String, Int>()

    private val lookState = derivedStateOf {
        val profile = selectedProfile
        ProfileLook.forApp(
            colorChoice = settings.colorChoice,
            syncEnabled = syncState.isEnabled,
            profileColor = profile?.color,
            profileThemeColors = profile?.theme?.colors.orEmpty(),
            profileDarkThemeColors = profile?.theme?.darkColors,
        )
    }

    @Volatile
    private var blockerForPages: ContentBlocker? = null
    private var engine: PageEngine? = null
    private var hostActivity: Context? = null
    private val storeReady = CompletableDeferred<BrowserStore>()
    private val pendingStoreWork = ArrayList<(BrowserStore) -> Unit>()
    private val pageJobs = HashMap<String, Job>()
    private val snapshotJobs = HashMap<String, Job>()
    private val pendingPageLoads = HashSet<String>()
    private val lastVisits = HashMap<String, Visit>()
    private val freshTabs = HashMap<String, VisitKind>()
    private var isActive = false
    private var appliedSearchKey: Any? = null

    init {
        mirrorServices()
        scope.launch { loadStore() }
        scope.launch(environment.workDispatcher) { prepareBlocking() }
        scope.launch {
            omnibox.warmUp()
            omnibox.loadBangs()
        }
    }

    val web: PageEngine
        get() = engine ?: environment.makeEngine(sitePreferences).also { made ->
            made.filter = BlockingPageFilter(isPrivate = false) { blockerForPages }
            made.privateFilter = BlockingPageFilter(isPrivate = true) { blockerForPages }
            made.onPrivateBrowsingEnded = { endPrivateBrowsing() }
            hostActivity?.let(made::attach)
            engine = made
            supportsIncognito = made.separatesPrivatePages
            system.useEngine(made)
        }

    val look: ProfileLook get() = lookState.value

    val tabStore: TabStore? get() = store?.tabs

    fun attach(activity: Context) {
        hostActivity = activity
        engine?.attach(activity)
    }

    fun detach(activity: Context) {
        if (hostActivity === activity) hostActivity = null
        engine?.detach(activity)
    }

    suspend fun awaitReady(): BrowserStore = storeReady.await()

    fun close() {
        savePageStates()
        pages.keys.toList().forEach { closePage(it, saving = false) }
        scope.cancel()
        sync.close()
        store?.close()
        omnibox.close()
    }

    internal fun allowsIncognito(): Boolean {
        val supported = web.separatesPrivatePages
        supportsIncognito = supported
        if (!supported) toasts.show(Toast(INCOGNITO_NEEDS_WEBVIEW, ArdiaSymbols.exclamationmarkTriangleFill))
        return supported
    }

    private fun mirrorServices() {
        scope.launch { sync.state.collect { syncState = it; applySyncedSearchIfChanged() } }
        scope.launch { sync.snapshot.collect { syncSnapshot = it; applySyncedSearchIfChanged() } }
        scope.launch { sync.selectedProfile.collect { selectedProfile = it; applySyncedSearchIfChanged() } }
        scope.launch { preferences.settings.collect { browsing = it } }
        scope.launch { blocking.state.collect { blockingState = it } }
    }

    private suspend fun loadStore() {
        val loaded = environment.openStore()
        attachStore(loaded)
    }

    private fun attachStore(loaded: BrowserStore) {
        val tabStore = loaded.tabs
        tabs = tabStore.state.value
        autoArchiveState = tabStore.autoArchiveInterval
        tabStore.onLocalChange = { sync.localDidChange() }
        tabStore.onTabsArchived = { ids -> ids.forEach { closePage(it, saving = true) } }
        tabStore.onTabsRemoved = { removed ->
            val ids = removed.map { it.id }
            loaded.snapshots.removeTabs(ids)
            ids.forEach { closePage(it, saving = false) }
        }
        tabStore.onPrivateTabsClosed = { ids, noneLeft ->
            ids.forEach { closePage(it, saving = false) }
            loaded.snapshots.removeTabs(ids)
            deck.forget(ids.toSet())
            ids.forEach(browse::forget)
            if (noneLeft) endPrivateBrowsing()
        }
        store = loaded
        scope.launch { tabStore.state.collect { tabs = it; announceReceivedTabs() } }
        scope.launch { tabStore.archive.collect { archive = it } }
        scope.launch { tabStore.archiveLoaded.collect { archiveLoaded = it } }
        appliedSearchKey = null
        applySyncedSearch()
        sync.source = StoreSyncSource(loaded.syncSource)
        sync.start()
        if (isActive) tabStore.appBecameActive()
        scope.launch { system.downloadOutcomes.collect(::announceDownload) }
        scope.launch { system.activeDownloads.collect { downloads = it } }
        scope.launch { tabStore.writeFailure.collect(::noteSaveFailure) }
        refreshRecents()
        val work = pendingStoreWork.toList()
        pendingStoreWork.clear()
        work.forEach { it(loaded) }
        storeReady.complete(loaded)
        if (isDemo) DemoScenario.apply(this)
        LaunchHooks.run(this)
        scope.launch {
            delay(WARM_UP_DELAY_MILLIS)
            web.warmUp()
        }
    }

    private suspend fun prepareBlocking() {
        val lists = environment.makeFilterLists(environment.blockingStore)
        val made = ContentBlocker(blocking, lists)
        withContext(mainDispatcher) {
            blockerForPages = made
            blocker = made
            scope.launch { lists.state.collect { filterListsState = it } }
        }
        made.prepare()
        if (environment.refreshesFromNetwork) made.refreshIfDue()
    }

    private fun applyDemoSettings(preferences: AppPreferences) {
        if (!environment.isDemo) return
        if (!launch.showsOnboarding) preferences.finishOnboarding()
        if (launch.restingStart) preferences.setAutoOpensKeyboard(false)
        launch.color?.let { preferences.setColorChoice(ColorChoice.of(it)) }
    }

    internal fun withStore(work: (BrowserStore) -> Unit) {
        val loaded = store
        if (loaded != null) work(loaded) else pendingStoreWork.add(work)
    }

    fun sceneBecameActive() {
        isActive = true
        tabStore?.appBecameActive()
        sync.appForegrounded()
        applySyncedSearch()
        defaultBrowser.sceneBecameActive()
        if (!environment.refreshesFromNetwork) return
        scope.launch { blockerForPages?.refreshIfDue() }
        scope.launch { omnibox.refreshBangsIfDue() }
    }

    fun sceneWillResignActive() {
        isActive = false
        tabStore?.appWillResignActive()
    }

    fun sceneEnteredBackground() {
        savePageStates()
        sync.appBackgrounded()
    }

    fun applySyncedSearch() {
        val choice = SyncedData.searchChoice(syncSnapshot.search)
        val local = browsing.searchEngineId
        val tabStore = tabStore
        if (tabStore != null) {
            tabStore.searchTemplate = SearchTemplates.template(choice, local)
            tabStore.profileSyncId = if (syncState.isEnabled) selectedProfile?.syncId else null
        }
        scope.launch {
            val info = omnibox.setSearch(choice, local) ?: return@launch
            if (info.url.contains("%s")) this@AppModel.tabStore?.searchTemplate = info.url
        }
    }

    private fun applySyncedSearchIfChanged() {
        val key = listOf(syncSnapshot.search, selectedProfile?.syncId, syncState.isEnabled, browsing.searchEngineId)
        if (key == appliedSearchKey) return
        appliedSearchKey = key
        applySyncedSearch()
    }

    val currentPage: Page? get() = tabs.selectedTabId?.let { pages[it] }

    fun page(id: String): Page? = pages[id]

    fun snapshotVersion(id: String): Int = snapshotVersions[id] ?: 0

    fun copyCurrentLink(): Boolean {
        val tab = tabs.selectedTab ?: return false
        if (!BrowserUrl.isSyncable(tab.url)) return false
        copyCleanLink(tab.url)
        browse.showTitleFeedback(COPIED_URL)
        return true
    }

    fun announceDownload(outcome: DownloadOutcome) {
        when (outcome) {
            is DownloadOutcome.Finished -> toasts.show(Toasts.downloaded(outcome.fileName) { system.openDownloaded(outcome) })
            is DownloadOutcome.Failed -> if (outcome.reason == DownloadFailure.PrivateSessionEnded) {
                if (!privateStopAnnounced) announcePrivateDownloadsStopped(1)
            } else {
                toasts.show(Toasts.downloadFailed(outcome.fileName))
            }
        }
    }

    fun shareCurrentPage() {
        val tab = tabs.selectedTab ?: return
        if (!BrowserUrl.isSyncable(tab.url)) return
        system.share(tab.url, tab.title)
    }

    fun pinCurrentToMac() {
        val tab = tabs.selectedTab ?: return
        if (!syncState.isEnabled) {
            toasts.show(Toast(SYNC_TO_PIN, ArdiaSymbols.laptopcomputer, onTap = { sheet = Sheet.SyncSetup }))
            return
        }
        pinToMac(tab)
    }

    fun nightShade(page: Page): NightShadeMode = browsing.nightShade(page.state.value.host, page.isPrivate)

    fun setNightShade(on: Boolean, page: Page) {
        val host = page.state.value.host ?: return
        preferences.updateSite(host, page.isPrivate) { it.copy(nightShade = if (on) NightShadeMode.ALWAYS else NightShadeMode.DISABLED) }
        engine?.refreshSitePreferences()
    }

    fun isDesktopSite(page: Page): Boolean = page.id in browse.desktopTabs

    fun toggleDesktopSite(page: Page) {
        val wantsDesktop = page.id !in browse.desktopTabs
        browse.desktopTabs = if (wantsDesktop) browse.desktopTabs + page.id else browse.desktopTabs - page.id
        page.setDesktopSite(wantsDesktop)
    }

    fun translate(page: Page) {
        val url = page.state.value.url ?: return
        if (!PageUrl.isWeb(url)) return
        page.load(translationUrl(url, system.preferredLanguage()))
    }

    fun blockersEnabled(page: Page): Boolean = !blocking.isExempt(page.state.value.host, page.isPrivate)

    fun toggleBlockers(page: Page) {
        val host = page.state.value.host ?: return
        val enabled = !blockersEnabled(page)
        blocking.setExempt(host, !enabled, page.isPrivate)
        val message = if (enabled) "Blockers enabled for $host" else "Blockers disabled for $host"
        toasts.show(Toast(message, if (enabled) ArdiaSymbols.handRaisedFill else ArdiaSymbols.shieldLefthalfFilled))
        page.reload()
    }

    fun openInDefaultBrowser(page: Page) {
        val url = page.state.value.url ?: return
        system.openExternal(url)
    }

    fun showReader(tabId: String) {
        browse.readerTabId = tabId
    }

    fun showFindOnPage() {
        browse.isToolbarPresented = false
        browse.isFindPresented = true
    }

    fun endFindOnPage() {
        browse.isFindPresented = false
        currentPage?.endFind()
    }

    fun goBackToSearchIfEmpty() {
        if (tabs.selectedTab == null && surface == Surface.Browsing) surface = Surface.Search
    }

    fun prepareToOpen(id: String) {
        ensurePage(id)
    }

    internal fun ensurePage(id: String) {
        val tabStore = tabStore ?: return
        val tab = tabStore.tab(id) ?: return
        if (tab.isArchived) return
        if (pages[id] != null) {
            web.open(id, PageSetup(url = tab.url, title = tab.title, isPrivate = tab.isPrivate))
            return
        }
        val fresh = freshTabs.remove(id)
        if (fresh != null) {
            openPageOrDrop(id, PageSetup.fresh(tab.url, fresh, title = tab.title, isPrivate = tab.isPrivate))
            return
        }
        if (!pendingPageLoads.add(id)) return
        scope.launch {
            val saved = runCatching { tabStore.interactionState(id) }.getOrNull()
            pendingPageLoads.remove(id)
            val current = tabStore.tab(id) ?: return@launch
            if (pages[id] != null || current.isArchived) return@launch
            openPageOrDrop(id, PageSetup(url = current.url, title = current.title, isPrivate = current.isPrivate, savedState = saved))
        }
    }

    private fun openPageOrDrop(id: String, setup: PageSetup) {
        val page = try {
            web.open(id, setup)
        } catch (refused: PrivatePagesUnavailableException) {
            refusePrivatePage(id)
            return
        }
        attachPage(id, page)
    }

    private fun refusePrivatePage(id: String) {
        supportsIncognito = false
        toasts.show(Toast(INCOGNITO_NEEDS_WEBVIEW, ArdiaSymbols.exclamationmarkTriangleFill))
        incognitoState = false
        val tabStore = tabStore ?: return
        tabStore.close(id)
        if (tabStore.selectedTab == null && surface == Surface.Browsing) surface = Surface.Search
    }

    private fun attachPage(id: String, page: Page) {
        pages[id] = page
        pageJobs.remove(id)?.cancel()
        pageJobs[id] = scope.launch {
            launch { page.events.collect { pageEvent(id, it) } }
            var previous: PageState? = null
            page.state.collect { state ->
                pageStateChanged(id, previous, state)
                previous = state
            }
        }
    }

    private fun pageStateChanged(id: String, previous: PageState?, state: PageState) {
        val tabStore = tabStore ?: return
        val tab = tabStore.tab(id) ?: return
        val url = state.url?.takeIf { PageUrl.isWeb(it) && it != tab.url }
        val title = state.title.takeIf { it.isNotBlank() && it != tab.title }
        val favicon = state.faviconUrl?.takeIf { it != tab.faviconUrl }
        val theme = state.themeColor?.let(PageColors::hex)?.takeIf { it != tab.themeColorHex }
        if (url != null || title != null || favicon != null || theme != null) {
            tabStore.update(id, url = url, title = title, faviconUrl = favicon, themeColorHex = theme)
        }
        val visit = lastVisits[id]
        if (title != null && visit != null && visit.url == state.url && visit.title != title) lastVisits[id] = tabStore.amend(visit, title = title)
        if (previous?.isLoading == true && !state.isLoading && state.failure == null) scheduleSnapshot(id)
    }

    private fun pageEvent(id: String, event: PageEvent) {
        when (event) {
            is PageEvent.Visited -> recordVisit(id, event)
            is PageEvent.OpenWindow -> openPopup(id, event.popup)
            is PageEvent.Download -> startDownload(event.download)
            PageEvent.CloseRequested -> closeTab(id)
            is PageEvent.ExternalAppMissing -> toasts.show(Toast(NO_APP_FOR_LINK, ArdiaSymbols.exclamationmarkTriangleFill))
            is PageEvent.LongPress -> browse.press = BrowseSession.PagePress(id, event.target, event.x, event.y)
        }
    }

    private fun recordVisit(id: String, event: PageEvent.Visited) {
        val tabStore = tabStore ?: return
        if (PageUrl.isWeb(event.url)) tabStore.update(id, url = event.url, title = event.title.ifBlank { null })
        val transition = VisitKinds.transition(event.kind) ?: return
        tabStore.recordVisit(event.url, event.title, transition, fromTab = id)?.let { lastVisits[id] = it }
    }

    private fun openPopup(openerId: String, popup: PopupRequest) {
        val tabStore = tabStore ?: return
        val tab = tabStore.open(TabDestination.Url(popup.url ?: ABOUT_BLANK, TabOrigin.LINK), TabPlacement.After(openerId), isPrivate = popup.isPrivate)
        val page = try {
            web.openPopup(tab.id, popup)
        } catch (refused: PrivatePagesUnavailableException) {
            refusePrivatePage(tab.id)
            return
        }
        attachPage(tab.id, page)
        isIncognito = tab.isPrivate
        surface = Surface.Browsing
    }

    fun cancelDownload(id: Long) {
        system.cancelDownload(id)
    }

    private fun startDownload(download: PageDownload) {
        val id = system.enqueueDownload(download)
        if (id != null) {
            if (download.isPrivate) {
                privateDownloadIds = privateDownloadIds + id
                privateStopAnnounced = false
            }
            toasts.show(Toast(downloading(download.fileName), ArdiaSymbols.arrowDownCircleFill))
        } else {
            toasts.show(Toasts.downloadFailed(download.fileName))
        }
    }

    fun captureSnapshot(id: String): Job = scope.launch {
        val page = pages[id] ?: return@launch
        val image = page.snapshot() ?: return@launch
        persistSnapshot(image, id)
    }

    private fun scheduleSnapshot(id: String) {
        if (id != tabs.selectedTabId || surface != Surface.Browsing) return
        snapshotJobs.remove(id)?.cancel()
        snapshotJobs[id] = scope.launch {
            delay(SNAPSHOT_SETTLE_MILLIS)
            val image = pages[id]?.snapshot() ?: return@launch
            persistSnapshot(image, id)
        }
    }

    internal suspend fun persistSnapshot(image: Bitmap, id: String) {
        val loaded = store ?: return
        val name = if (loaded.tabs.isPrivate(id)) loaded.snapshots.keepInMemory(image, id) else loaded.snapshots.save(image, id) ?: return
        loaded.tabs.update(id, snapshotFileName = name)
        snapshotVersions[id] = snapshotVersion(id) + 1
    }

    suspend fun snapshotImage(tab: BrowserTab): Bitmap? {
        deck.memoryImage(tab.id)?.let { return it }
        val name = tab.snapshotFileName ?: return null
        return store?.snapshots?.image(name)
    }

    private fun savePageStates() {
        val tabStore = tabStore ?: return
        for ((id, page) in pages) tabStore.saveInteractionState(id, page.saveState())
    }

    private fun closePage(id: String, saving: Boolean) {
        val page = pages.remove(id)
        if (saving && page != null) tabStore?.saveInteractionState(id, page.saveState())
        freshTabs.remove(id)
        pageJobs.remove(id)?.cancel()
        snapshotJobs.remove(id)?.cancel()
        lastVisits.remove(id)
        engine?.close(id)
    }

    internal fun noteSaveFailure(failure: Throwable?) {
        val wasFailing = saveFailure != null
        saveFailure = failure
        if (failure != null && !wasFailing) toasts.show(Toast(SAVE_FAILED, ArdiaSymbols.exclamationmarkTriangleFill, Toast.LONG_DURATION_MILLIS))
    }

    private fun endPrivateBrowsing() {
        preferences.endPrivateBrowsing()
        blocking.endPrivateBrowsing()
        val inFlight = downloads.filter { it.id in privateDownloadIds }.map { it.id }
        privateDownloadIds = emptySet()
        if (inFlight.isEmpty()) return
        inFlight.forEach(system::cancelDownload)
        announcePrivateDownloadsStopped(inFlight.size)
    }

    private fun announcePrivateDownloadsStopped(count: Int) {
        privateStopAnnounced = true
        toasts.show(Toast(stoppedPrivateDownloads(count), ArdiaSymbols.exclamationmarkTriangleFill, Toast.LONG_DURATION_MILLIS))
    }

    val deckTabs: List<BrowserTab> get() = tabs.deckTabs

    val deckOrder: List<BrowserTab> get() = tabs.deckOrder

    val hasArchivedTabs: Boolean get() = tabs.hasArchivedTabs

    fun tab(id: String): BrowserTab? = tabStore?.tab(id)

    fun showTabSwitcher() {
        val id = tabs.selectedTabId
        deck.handoff = null
        val page = id?.let { pages[it] }
        if (id == null || surface != Surface.Browsing || page == null) {
            deck.entrance = TabDeckModel.Entrance.Plain
            surface = Surface.TabSwitcher
            return
        }
        scope.launch {
            val image = withTimeoutOrNull(HANDOFF_TIMEOUT_MILLIS) { page.snapshot() }
            if (image != null) {
                deck.handoff = TabDeckModel.Handoff(id, image)
                deck.entrance = TabDeckModel.Entrance.FromPage(id)
            } else {
                deck.entrance = TabDeckModel.Entrance.Plain
            }
            surface = Surface.TabSwitcher
            if (image != null) persistSnapshot(image, id)
        }
    }

    suspend fun primeCover(id: String) {
        if (browse.covers.image(id) != null) return
        val image = deck.memoryImage(id) ?: tab(id)?.let { snapshotImage(it) } ?: return
        browse.covers.store(image, id)
    }

    fun beginOpening(id: String) {
        val tabStore = tabStore ?: return
        if (tabStore.tab(id) == null || tabStore.selectedTabId == id) return
        isIncognito = tabStore.isPrivate(id)
        tabStore.select(id)
        ensurePage(id)
    }

    fun openTab(id: String) {
        withStore { loaded ->
            isIncognito = loaded.tabs.isPrivate(id)
            loaded.tabs.select(id)
            surface = Surface.Browsing
            ensurePage(id)
        }
    }

    fun newTab() {
        browse.presentSearch(if (surface == Surface.Search) BrowseSession.SearchOrigin.Start else BrowseSession.SearchOrigin.Page, incognitoOnCancel = isIncognito)
    }

    fun newRegularTab() {
        val wasIncognito = isIncognito
        isIncognito = false
        browse.presentSearch(if (surface == Surface.Search) BrowseSession.SearchOrigin.Start else BrowseSession.SearchOrigin.Page, incognitoOnCancel = wasIncognito)
    }

    fun newIncognitoTab() {
        val wasIncognito = isIncognito
        if (!allowsIncognito()) return
        isIncognito = true
        browse.presentSearch(if (surface == Surface.Search) BrowseSession.SearchOrigin.Start else BrowseSession.SearchOrigin.Page, incognitoOnCancel = wasIncognito)
    }

    fun leaveIncognito() {
        val tabStore = tabStore
        if (tabStore != null) {
            deck.forget(tabStore.privateTabs.map { it.id }.toSet())
            tabStore.closeAllPrivate()
        }
        isIncognito = false
    }

    fun closeTab(id: String) {
        deck.forget(setOf(id))
        browse.forget(id)
        tabStore?.close(id)
    }

    fun closeAllTabs() {
        val tabStore = tabStore ?: return
        deck.forget(deckTabs.map { it.id }.toSet())
        deckTabs.forEach { browse.forget(it.id) }
        tabStore.closeAllPrivate()
        tabStore.closeAll()
        isIncognito = false
    }

    fun reopenLastClosed() {
        val reopened = tabStore?.reopenLastClosed().orEmpty()
        reopened.lastOrNull()?.let { openTab(it.id) }
    }

    fun archiveTab(id: String) {
        deck.forget(setOf(id))
        browse.forget(id)
        tabStore?.archive(id)
    }

    fun moveTab(id: String, index: Int) {
        tabStore?.move(id, index)
    }

    fun openArchive() {
        sheet = Sheet.Archive
    }

    fun openSyncedSpaces() {
        sheet = Sheet.SyncedSpaces
    }

    fun loadArchive() {
        tabStore?.loadArchive()
    }

    suspend fun searchArchive(text: String): List<BrowserTab> = awaitReady().tabs.searchArchive(text)

    fun deleteArchived(ids: Set<String>) {
        tabStore?.delete(ids)
    }

    fun clearArchive() {
        tabStore?.clearArchive()
    }

    var autoArchiveInterval: AutoArchiveInterval
        get() = autoArchiveState
        set(value) {
            autoArchiveState = value
            tabStore?.autoArchiveInterval = value
        }

    fun openRemote(url: String, title: String, profileSyncId: String?) {
        if (!PageUrl.isWeb(url)) return
        withStore { loaded ->
            val tabStore = loaded.tabs
            if (isIncognito) isIncognito = false
            if (profileSyncId != null && syncState.isEnabled && profileSyncId != tabStore.profileSyncId) switchProfile(profileSyncId)
            val existing = tabStore.openTabs.firstOrNull { it.url == url && !it.isPrivate && it.profileSyncId == tabStore.profileSyncId }
            sheet = null
            if (existing != null) {
                openTab(existing.id)
                return@withStore
            }
            val tab = tabStore.open(TabDestination.Url(url, TabOrigin.SYNC))
            if (title.isNotEmpty()) tabStore.update(tab.id, title = title)
            freshTabs[tab.id] = VisitKind.Typed
            openTab(tab.id)
        }
    }

    fun switchProfile(syncId: String) {
        sync.selectProfile(syncId)
        tabStore?.profileSyncId = syncId
    }

    fun restoreArchived(id: String) {
        scope.launch {
            val loaded = awaitReady()
            if (!loaded.tabs.restore(id)) return@launch
            sheet = null
            openTab(id)
        }
    }

    fun copyLink(tab: BrowserTab) {
        copyCleanLink(tab.url)
        toasts.show(Toasts.copiedUrlWithoutTrackers())
    }

    fun shareUrl(tab: BrowserTab): String? = tab.url.takeIf(BrowserUrl::isSyncable)

    fun share(tab: BrowserTab) {
        val url = shareUrl(tab) ?: return
        system.share(url, tab.title)
    }

    fun send(tab: BrowserTab, device: SyncedDevice) {
        if (!BrowserUrl.isSyncable(tab.url)) return
        scope.launch {
            val sent = runCatching { sync.send(tab.url, tab.title, device, tab.profileSyncId, fromPrivateTab = tab.isPrivate) }.getOrDefault(false)
            toasts.show(if (sent) Toasts.sentTab(device.name) else Toast(couldNotSend(device.name), ArdiaSymbols.exclamationmarkTriangleFill))
        }
    }

    fun pinToMac(tab: BrowserTab) {
        if (tab.isPrivate || !BrowserUrl.isSyncable(tab.url)) return
        scope.launch {
            val pinned = runCatching { sync.pinToMac(tab.url, tab.title, tab.profileSyncId) }.getOrDefault(false)
            toasts.show(if (pinned) Toast(PINNED, ArdiaSymbols.starFill) else Toast(COULD_NOT_PIN, ArdiaSymbols.exclamationmarkTriangleFill))
        }
    }

    fun sendTargets(tab: BrowserTab): List<SyncedDevice> {
        if (!syncState.isEnabled || tab.isPrivate) return emptyList()
        return syncSnapshot.devicesThatReceiveTabs(tab.profileSyncId ?: selectedProfile?.syncId ?: syncState.selectedProfileId)
    }

    private fun copyCleanLink(url: String) {
        scope.launch { system.copyText(runCatching { omnibox.cleanUrl(url) }.getOrDefault(url)) }
    }

    fun makeSuggestionsModel(): SearchSuggestionsModel = Snapshot.withoutReadObservation {
        val current = if (surface == Surface.Browsing) tabs.selectedTab else null
        refreshRecents()
        SearchSuggestionsModel(
            source = omnibox,
            parent = scope,
            tabs = { awaitReady().tabs },
            synced = if (syncState.isEnabled) SyncedData.browsing(syncSnapshot, selectedProfile?.syncId ?: syncState.selectedProfileId) else null,
            recentQueries = { recentQueries },
            fetchesNetworkSuggestions = browsing.searchSuggestions,
            currentUrl = current?.url,
            currentTabId = current?.id,
        )
    }

    fun refreshRecents() {
        val tabStore = tabStore ?: return
        scope.launch {
            val recents = runCatching { tabStore.history.recentSearches(SearchSuggestions.IDLE_SEARCH_LIMIT) }.getOrDefault(emptyList())
            if (recents != recentQueries) recentQueries = recents
        }
    }

    fun submitSearch(text: String, resolution: OmniboxResolution?) {
        if (resolution != null) {
            openPage(resolution.url, if (resolution.kind == OmniboxResolution.Kind.URL) TabOrigin.TYPED else TabOrigin.SEARCH)
            return
        }
        when (val destination = SearchInput.resolve(text) ?: return) {
            is SearchInput.Destination.Url -> openPage(destination.url, TabOrigin.TYPED)
            is SearchInput.Destination.Search -> openSearch(destination.query)
        }
    }

    fun activate(suggestion: SearchSuggestion) {
        val url = suggestion.url
        when (val kind = suggestion.kind) {
            SearchSuggestion.Kind.Query -> if (url != null) openPage(url, TabOrigin.SEARCH) else openSearch(suggestion.query)
            is SearchSuggestion.Kind.OpenTab -> {
                browse.dismissSearch()
                openTab(kind.tabId)
            }
            is SearchSuggestion.Kind.RemoteTab -> url?.let { openPage(it, TabOrigin.SYNC) }
            SearchSuggestion.Kind.Url, SearchSuggestion.Kind.History, SearchSuggestion.Kind.Bookmark -> url?.let { openPage(it, TabOrigin.TYPED) }
            SearchSuggestion.Kind.Calculation -> suggestion.copyValue?.let { value ->
                system.copyText(value)
                toasts.show(Toast("Copied $value", ArdiaSymbols.equalCircleFill))
            }
        }
    }

    fun openSearch(query: String) {
        val trimmed = query.trim()
        if (trimmed.isEmpty()) return
        val incognito = isIncognito
        withStore { loaded -> finishOpening(loaded.tabs.open(TabDestination.Search(trimmed), isPrivate = incognito).id, VisitKind.Typed) }
    }

    fun openPage(url: String, origin: TabOrigin) {
        val incognito = isIncognito
        withStore { loaded -> finishOpening(loaded.tabs.open(TabDestination.Url(url, origin), isPrivate = incognito).id, firstVisit(origin)) }
    }

    fun cancelSearch() {
        val request = browse.search
        browse.dismissSearch()
        val selected = tabs.selectedTabId
        if (surface == Surface.Search && request?.origin != BrowseSession.SearchOrigin.Start && selected != null) {
            openTab(selected)
        } else {
            request?.incognitoOnCancel?.let { isIncognito = it }
        }
    }

    private fun finishOpening(id: String, kind: VisitKind) {
        freshTabs[id] = kind
        browse.dismissSearch()
        surface = Surface.Browsing
        ensurePage(id)
    }

    private fun firstVisit(origin: TabOrigin): VisitKind = if (origin == TabOrigin.LINK) VisitKind.Link else VisitKind.Typed

    fun currentQuery(tab: BrowserTab): String = RecentSearches.query(tab.url) ?: tab.url

    suspend fun searchEngines(): List<SearchEngineInfo> = omnibox.engines()

    fun setSearchEngine(id: String) {
        preferences.setSearchEngine(id)
        browsing = preferences.current
        applySyncedSearchIfChanged()
    }

    fun setDefaultNightShade(mode: NightShadeMode) {
        preferences.setNightShade(mode)
        browsing = preferences.current
        engine?.refreshSitePreferences()
    }

    fun setSwipeNavigation(mode: SwipeNavigationMode) {
        preferences.setSwipeNavigation(mode)
        browsing = preferences.current
    }

    fun setAppLinks(preference: AppLinkPreference) {
        preferences.setAppLinks(preference)
        browsing = preferences.current
    }

    fun setSearchSuggestions(enabled: Boolean) {
        preferences.setSearchSuggestions(enabled)
        browsing = preferences.current
    }

    fun setColorChoice(choice: String?) {
        settings.colorChoice = choice
    }

    fun setBlocksAds(enabled: Boolean) {
        blocking.blocksAds = enabled
    }

    fun setBlocksTrackers(enabled: Boolean) {
        blocking.blocksTrackers = enabled
    }

    fun setHidesCookieBanners(enabled: Boolean) {
        blocking.hidesCookieBanners = enabled
    }

    fun setExempt(host: String, exempt: Boolean) {
        blocking.setExempt(host, exempt)
    }

    val filterLists: FilterLists? get() = blocker?.filterLists

    fun setFilterListEnabled(id: String, enabled: Boolean) {
        filterLists?.setEnabled(id, enabled)
    }

    suspend fun addFilterList(url: String): String? = filterLists?.addList(url)

    fun removeFilterList(id: String) {
        filterLists?.removeList(id)
    }

    suspend fun applyMyFilters(text: String): MyFiltersResult? = filterLists?.applyMyFilters(text)

    suspend fun resetFilterLists() {
        filterLists?.resetToDefaults()
    }

    suspend fun updateFilterListsNow() {
        blocker?.refreshIfDue(force = true)
    }

    suspend fun clearBrowsingData(choice: ClearChoice, range: ClearRange) {
        val loaded = awaitReady()
        if (choice.history) loaded.tabs.clearHistory(range.since(System.currentTimeMillis()))
        val kinds = choice.websiteData
        if (kinds.isNotEmpty()) web.clearWebsiteData(kinds)
        if (choice.archive && range == ClearRange.ALL_TIME) loaded.tabs.clearArchive()
        refreshRecents()
        toasts.show(Toasts.clearedBrowsingData())
    }

    fun checkPhrase(phrase: String): PhraseCheck = sync.check(phrase)

    suspend fun connectSync(phrase: String, pick: SyncFolderPick): ConnectResult {
        val result = sync.connect(phrase, pick)
        if (result == ConnectResult.Connected) {
            toasts.show(Toasts.syncConnected())
            applySyncedSearch()
        }
        return result
    }

    suspend fun changeSyncFolder(pick: SyncFolderPick): ConnectResult = sync.changeFolder(pick)

    suspend fun stopSyncing() {
        sync.stopSyncing()
        tabStore?.profileSyncId = null
        applySyncedSearch()
    }

    suspend fun syncNow() {
        sync.syncNow()
    }

    suspend fun acknowledgeSyncReset() {
        sync.acknowledgeReset()
    }

    fun setDeviceName(name: String) {
        sync.setDeviceName(name)
    }

    internal fun announceReceivedTabs() {
        val received = tabs.lastReceived
        if (received.isEmpty() || settings.isShowingOnboarding) return
        tabStore?.clearLastReceived()
        val sender = ReceivedTabsSender.name(received.map { it.receivedFromDevice }, YOUR_MAC)
        val ids = received.map { it.id }
        toasts.show(
            Toasts.tabReceived(sender, ids.size) {
                if (ids.size == 1) openTab(ids.first()) else showTabSwitcher()
            },
        )
    }

    fun finishOnboarding() {
        settings.finishOnboarding()
        announceReceivedTabs()
    }

    fun handle(link: SystemLink) {
        when (link) {
            is SystemLink.Search -> {
                prepareForSystemEntry()
                if (link.query != null) openSearch(link.query) else showSearch()
            }
            SystemLink.VoiceSearch -> {
                prepareForSystemEntry()
                showSearch()
                browse.isVoicePresented = true
            }
            SystemLink.Incognito -> {
                prepareForSystemEntry()
                newIncognitoTab()
                browse.presentSearch(BrowseSession.SearchOrigin.Home)
            }
            is SystemLink.Open -> openWebLink(link.url, TabOrigin.LINK)
            is SystemLink.Tab -> openTabFromSystem(link.id)
            SystemLink.MacTabs -> {
                prepareForSystemEntry()
                sheet = if (syncState.isEnabled) Sheet.SyncedSpaces else Sheet.SyncSetup
            }
        }
    }

    fun open(uri: String, origin: TabOrigin = TabOrigin.LINK): Boolean {
        SystemLink.parse(uri)?.let {
            handle(it)
            return true
        }
        if (!PageUrl.isWeb(uri)) return false
        defaultBrowser.receivedLinkFromSystem()
        openWebLink(uri, origin)
        return true
    }

    fun openWebLink(url: String, origin: TabOrigin) {
        if (!PageUrl.isWeb(url)) return
        prepareForSystemEntry()
        isIncognito = false
        openPage(url, origin)
    }

    fun openTabFromSystem(id: String): Boolean {
        val known = tab(id)
        if (known?.isPrivate == true) return false
        if (known == null) {
            scope.launch { openTabFromSystemWhenFound(id) }
            return true
        }
        prepareForSystemEntry()
        if (known.isArchived) restoreArchived(id) else openTab(id)
        return true
    }

    private suspend fun openTabFromSystemWhenFound(id: String) {
        val loaded = awaitReady()
        val tab = runCatching { loaded.tabs.findTab(id) }.getOrNull() ?: return
        if (tab.isPrivate) return
        prepareForSystemEntry()
        if (tab.isArchived) restoreArchived(id) else openTab(id)
    }


    fun showSearch() {
        browse.isToolbarPresented = false
        surface = Surface.Search
        browse.presentSearch(BrowseSession.SearchOrigin.Home)
    }

    suspend fun sendFromShare(url: String, title: String, deviceId: String): Boolean {
        if (!BrowserUrl.isSyncable(url)) return false
        val device = withTimeoutOrNull(SHARE_SYNC_WAIT_MILLIS) {
            while (syncState.isEnabled && syncState.phase != SyncPhase.Updated && syncSnapshot.devices.none { it.id == deviceId }) delay(250)
            syncSnapshot.devices.firstOrNull { it.id == deviceId }
        }
        if (!syncState.isEnabled || device == null) {
            toasts.show(Toast(couldNotSend(device?.name ?: YOUR_MAC), ArdiaSymbols.exclamationmarkTriangleFill))
            return false
        }
        val sent = runCatching { sync.send(url, title, device) }.getOrDefault(false)
        toasts.show(if (sent) Toasts.sentTab(device.name) else Toast(couldNotSend(device.name), ArdiaSymbols.exclamationmarkTriangleFill))
        return sent
    }

    private fun prepareForSystemEntry() {
        sheet = null
        browse.isVoicePresented = false
        browse.isToolbarPresented = false
        browse.readerTabId = null
    }

    val swipeOrder: List<BrowserTab>
        get() {
            val current = deckOrder
            val frozen = browse.frozenOrder ?: return current
            val byId = current.associateBy { it.id }
            val frozenIds = frozen.toHashSet()
            return frozen.mapNotNull { byId[it] } + current.filter { it.id !in frozenIds }
        }

    fun tone(tab: BrowserTab, themeColor: Int?, backgroundColor: Int?): PageTone = PageTone.resolve(
        themeColor = themeColor,
        backgroundColor = backgroundColor,
        sampled = browse.tones[tab.id],
        stored = PageColors.parseHex(tab.themeColorHex),
    )

    fun tone(tab: BrowserTab, state: PageState?): PageTone = tone(tab, state?.themeColor, state?.backgroundColor)

    fun openLink(url: String, fromTabId: String, inBackground: Boolean) {
        if (!PageUrl.isWeb(url)) return
        withStore { loaded ->
            val opener = loaded.tabs.tab(fromTabId)
            val tab = loaded.tabs.open(
                TabDestination.Url(url, TabOrigin.LINK),
                TabPlacement.After(fromTabId),
                selecting = !inBackground,
                isPrivate = opener?.isPrivate ?: incognitoState,
            )
            freshTabs[tab.id] = VisitKind.Link
            if (!inBackground) openTab(tab.id)
        }
    }

    fun editQuery(tab: BrowserTab) {
        browse.isToolbarPresented = false
        browse.presentSearch(BrowseSession.SearchOrigin.Page, text = currentQuery(tab), selectsAll = true)
    }

    fun openSiteSettingsRoute(route: SettingsRoute) {
        browse.isToolbarPresented = false
        settings.pendingRoute = route
        sheet = Sheet.Settings
    }

    fun copyText(text: String, confirmation: Toast? = null) {
        system.copyText(text)
        confirmation?.let(toasts::show)
    }

    fun copyLink(url: String) {
        copyCleanLink(url)
        toasts.show(Toasts.copiedUrlWithoutTrackers())
    }

    fun share(url: String, title: String) {
        system.share(url, title)
    }

    fun shareText(text: String, subject: String? = null) {
        system.shareText(text, subject)
    }

    val mayFocusSearch: Boolean get() = !settings.isShowingOnboarding && !browse.isVoicePresented

    fun openTrayIfWanted() {
        if (!settings.autoOpensKeyboard || settings.isShowingOnboarding || browse.search != null || sheet != null) return
        browse.presentSearch(BrowseSession.SearchOrigin.Home, incognitoOnCancel = isIncognito)
    }

    fun searchSwitchingMode(query: String) {
        if (!switchMode()) return
        openSearch(query)
    }

    fun openSwitchingMode(url: String) {
        if (!switchMode()) return
        openPage(url, TabOrigin.TYPED)
    }

    private fun switchMode(): Boolean {
        val wanted = !isIncognito
        isIncognito = wanted
        if (isIncognito != wanted) return false
        browse.dismissSearch()
        return true
    }

    fun openFromSettings(url: String) {
        if (!PageUrl.isWeb(url)) return
        sheet = null
        isIncognito = false
        openPage(url, TabOrigin.LINK)
    }

    fun exportableTabUrls(): List<String> = tabs.openTabs.filter { !it.isPrivate && BrowserUrl.isSyncable(it.url) }.map { it.url }

    fun showOnboardingFromSettings() {
        sheet = null
        settings.showOnboarding()
    }

    fun requestBrowserRole(launch: (Intent) -> Unit) {
        defaultBrowser.willOpenSystemSettings()
        launch(system.browserRoleRequest() ?: system.defaultAppsSettings())
    }

    fun browserRoleAnswered() {
        defaultBrowser.sceneBecameActive()
    }

    fun warmDemoSnapshots(): Job = demoWarming ?: scope.launch { DemoSnapshotWarmer.warm(this@AppModel) }.also { demoWarming = it }

    internal var demoWarming: Job? = null

    companion object {
        const val WARM_UP_DELAY_MILLIS = 300L
        const val SNAPSHOT_SETTLE_MILLIS = 700L
        const val HANDOFF_TIMEOUT_MILLIS = 150L
        const val SHARE_SYNC_WAIT_MILLIS = 20_000L
        const val ABOUT_BLANK = "about:blank"
        const val COPIED_URL = "Copied URL"
        const val YOUR_MAC = "Your Mac"
        const val SYNC_TO_PIN = "Sync With Your Mac to Pin Tabs"
        const val PINNED = "Pinned to Your Mac"
        const val COULD_NOT_PIN = "Couldn’t Pin to Your Mac"
        const val NO_APP_FOR_LINK = "No App Can Open This Link"
        const val INCOGNITO_NEEDS_WEBVIEW = "Incognito needs a newer Android System WebView"

        @Volatile
        private var shared: AppModel? = null

        fun resetShared() {
            synchronized(this) {
                shared?.close()
                shared = null
            }
        }

        fun couldNotSend(deviceName: String) = "Couldn’t Send to $deviceName"

        const val SAVE_FAILED = "Ardia Can’t Save Tabs and History"

        fun stoppedPrivateDownloads(count: Int) = if (count == 1) "Stopped 1 Private Download" else "Stopped $count Private Downloads"

        fun downloading(fileName: String) = if (fileName.isEmpty()) "Downloading" else "Downloading $fileName"

        fun translationUrl(url: String, language: String): String {
            fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
            return "https://translate.google.com/translate?sl=auto&tl=${encode(language.take(2).ifEmpty { "en" })}&u=${encode(url)}"
        }

        fun obtain(context: Context, intent: Intent?): AppModel = obtain(context, LaunchArguments.fromIntent(intent))

        fun obtain(context: Context, launch: LaunchArguments): AppModel = shared ?: synchronized(this) {
            shared ?: AppModel(launch, AppEnvironment.forApp(context, launch.isDemo)).also { shared = it }
        }
    }
}
