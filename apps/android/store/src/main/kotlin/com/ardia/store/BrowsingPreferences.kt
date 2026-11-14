package com.ardia.store

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

@Serializable
enum class NightShadeMode(val title: String) {
    @SerialName("disabled") DISABLED("Off"),
    @SerialName("automatic") AUTOMATIC("Automatic"),
    @SerialName("always") ALWAYS("Always");

    val raw: String get() = name.lowercase()

    companion object {
        fun of(raw: String?): NightShadeMode? = entries.firstOrNull { it.raw == raw }
    }
}

enum class SwipeNavigationMode(val raw: String, val title: String) {
    ANYWHERE("anywhere", "From Anywhere"),
    SCREEN_EDGES("screenEdges", "From Screen Edges"),
    DISABLED("disabled", "Off");

    companion object {
        fun of(raw: String?): SwipeNavigationMode? = entries.firstOrNull { it.raw == raw }
    }
}

@Serializable
enum class AppLinkPreference(val title: String) {
    @SerialName("ardia") ARDIA("Ardia"),
    @SerialName("app") APP("App");

    val raw: String get() = name.lowercase()

    companion object {
        fun of(raw: String?): AppLinkPreference? = entries.firstOrNull { it.raw == raw }
    }
}

@Serializable
data class SiteSettings(
    val pageZoom: Double? = null,
    val nightShade: NightShadeMode? = null,
    val appLinks: AppLinkPreference? = null,
    val desktopSite: Boolean? = null,
    val blockersOff: Boolean? = null,
) {
    val isEmpty: Boolean get() = this == SiteSettings()
}

data class BrowsingSettings(
    val nightShade: NightShadeMode = NightShadeMode.DISABLED,
    val swipeNavigation: SwipeNavigationMode = SwipeNavigationMode.ANYWHERE,
    val appLinks: AppLinkPreference = AppLinkPreference.ARDIA,
    val searchSuggestions: Boolean = true,
    val searchEngineId: String = "google",
    val sites: Map<String, SiteSettings> = emptyMap(),
    val privateSites: Map<String, SiteSettings> = emptyMap(),
) {
    fun site(host: String?, isPrivate: Boolean = false): SiteSettings {
        val key = host?.let(BrowsingPreferences::normalize) ?: return SiteSettings()
        return (if (isPrivate) privateSites[key] else null) ?: sites[key] ?: SiteSettings()
    }

    fun nightShade(host: String?, isPrivate: Boolean = false): NightShadeMode = site(host, isPrivate).nightShade ?: nightShade

    fun appLinks(host: String?, isPrivate: Boolean = false): AppLinkPreference = site(host, isPrivate).appLinks ?: appLinks

    fun pageZoom(host: String?, isPrivate: Boolean = false): Double = site(host, isPrivate).pageZoom ?: 1.0

    fun desktopSite(host: String?, isPrivate: Boolean = false): Boolean = site(host, isPrivate).desktopSite ?: false

    fun blockersOff(host: String?, isPrivate: Boolean = false): Boolean = site(host, isPrivate).blockersOff ?: false
}

class BrowsingPreferences(private val store: KeyValueStore) {
    private val lock = Any()
    private val _settings = MutableStateFlow(load())

    val settings: StateFlow<BrowsingSettings> = _settings.asStateFlow()
    val current: BrowsingSettings get() = settings.value

    fun setNightShade(mode: NightShadeMode) = change { store.putString(KEYS_NIGHT_SHADE, mode.raw); it.copy(nightShade = mode) }

    fun setSwipeNavigation(mode: SwipeNavigationMode) = change { store.putString(KEYS_SWIPE, mode.raw); it.copy(swipeNavigation = mode) }

    fun setAppLinks(preference: AppLinkPreference) = change { store.putString(KEYS_APP_LINKS, preference.raw); it.copy(appLinks = preference) }

    fun setSearchSuggestions(enabled: Boolean) = change { store.putBoolean(KEYS_SUGGESTIONS, enabled); it.copy(searchSuggestions = enabled) }

    fun setSearchEngine(id: String) = change { store.putString(KEYS_ENGINE, id); it.copy(searchEngineId = id) }

    fun updateSite(host: String, isPrivate: Boolean = false, edit: (SiteSettings) -> SiteSettings) = change { settings ->
        val key = normalize(host)
        if (key.isEmpty()) return@change settings
        if (isPrivate) {
            val before = settings.site(host, isPrivate = true)
            val after = edit(before)
            if (after == before) return@change settings
            return@change settings.copy(privateSites = settings.privateSites + (key to after))
        }
        val before = settings.sites[key] ?: SiteSettings()
        val after = edit(before)
        if (after == before) return@change settings
        val sites = LinkedHashMap(settings.sites)
        sites.remove(key)
        if (!after.isEmpty) sites[key] = after
        while (sites.size > SITE_LIMIT) sites.remove(sites.keys.first())
        store.putString(KEYS_SITES, json.encodeToString(sitesSerializer, sites))
        settings.copy(sites = sites)
    }

    fun endPrivateBrowsing() = change { it.copy(privateSites = emptyMap()) }

    private fun change(transform: (BrowsingSettings) -> BrowsingSettings) = synchronized(lock) {
        _settings.value = transform(_settings.value)
    }

    private fun load(): BrowsingSettings = BrowsingSettings(
        nightShade = NightShadeMode.of(store.string(KEYS_NIGHT_SHADE)) ?: NightShadeMode.DISABLED,
        swipeNavigation = SwipeNavigationMode.of(store.string(KEYS_SWIPE)) ?: SwipeNavigationMode.ANYWHERE,
        appLinks = AppLinkPreference.of(store.string(KEYS_APP_LINKS)) ?: AppLinkPreference.ARDIA,
        searchSuggestions = store.boolean(KEYS_SUGGESTIONS) ?: true,
        searchEngineId = store.string(KEYS_ENGINE) ?: "google",
        sites = store.string(KEYS_SITES)?.let { runCatching { json.decodeFromString(sitesSerializer, it) }.getOrNull() } ?: emptyMap(),
    )

    companion object {
        const val KEYS_NIGHT_SHADE = "browsing.nightShade"
        const val KEYS_SWIPE = "browsing.swipeNavigation"
        const val KEYS_APP_LINKS = "browsing.appLinks"
        const val KEYS_SUGGESTIONS = "browsing.searchSuggestions"
        const val KEYS_ENGINE = "browsing.searchEngine"
        const val KEYS_SITES = "browsing.sites"
        const val SITE_LIMIT = 500

        private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }
        private val sitesSerializer = MapSerializer(String.serializer(), SiteSettings.serializer())

        fun normalize(host: String): String = host.lowercase().trim('.', ' ').removePrefix("www.")
    }
}

enum class ColorChoice(val raw: String, val title: String) {
    PLUM("plum", "Plum"),
    BLUE("blue", "Blue"),
    PURPLE("purple", "Purple"),
    PINK("pink", "Pink"),
    RED("red", "Red"),
    ORANGE("orange", "Orange"),
    YELLOW("yellow", "Yellow"),
    GREEN("green", "Green"),
    NEUTRAL("neutral", "Neutral");

    companion object {
        val standard = PLUM

        fun of(raw: String?): ColorChoice? = entries.firstOrNull { it.raw == raw }
    }
}

sealed interface LookSource {
    data class Preset(val choice: ColorChoice) : LookSource

    data object MacProfile : LookSource
}

data class AppSettings(
    val collapsesBottomBar: Boolean = false,
    val autoOpensKeyboard: Boolean = true,
    val hasFinishedOnboarding: Boolean = false,
    val archiveCardShown: Boolean = false,
    val colorChoice: ColorChoice? = null,
) {
    val matchesMac: Boolean get() = colorChoice == null

    fun look(syncEnabled: Boolean): LookSource = when {
        colorChoice != null -> LookSource.Preset(colorChoice)
        syncEnabled -> LookSource.MacProfile
        else -> LookSource.Preset(ColorChoice.standard)
    }
}

class AppPreferences(private val store: KeyValueStore) {
    private val lock = Any()
    private val _settings = MutableStateFlow(
        AppSettings(
            collapsesBottomBar = store.boolean(KEY_COLLAPSE_BOTTOM_BAR) ?: false,
            autoOpensKeyboard = store.boolean(KEY_AUTO_OPEN_KEYBOARD) ?: true,
            hasFinishedOnboarding = store.boolean(KEY_FINISHED_ONBOARDING) ?: false,
            archiveCardShown = store.boolean(KEY_ARCHIVE_CARD_SHOWN) ?: false,
            colorChoice = ColorChoice.of(store.string(KEY_COLOR)),
        ),
    )

    val settings: StateFlow<AppSettings> = _settings.asStateFlow()

    fun setColorChoice(choice: ColorChoice?) = synchronized(lock) {
        store.putString(KEY_COLOR, choice?.raw)
        _settings.value = _settings.value.copy(colorChoice = choice)
    }

    fun setMatchesMac(matches: Boolean, shownChoice: ColorChoice? = null) =
        setColorChoice(if (matches) null else settings.value.colorChoice ?: shownChoice ?: ColorChoice.standard)

    fun setCollapsesBottomBar(value: Boolean) = put(KEY_COLLAPSE_BOTTOM_BAR, value) { it.copy(collapsesBottomBar = value) }

    fun setAutoOpensKeyboard(value: Boolean) = put(KEY_AUTO_OPEN_KEYBOARD, value) { it.copy(autoOpensKeyboard = value) }

    fun finishOnboarding() = put(KEY_FINISHED_ONBOARDING, true) { it.copy(hasFinishedOnboarding = true) }

    fun setArchiveCardShown(value: Boolean) = put(KEY_ARCHIVE_CARD_SHOWN, value) { it.copy(archiveCardShown = value) }

    private fun put(key: String, value: Boolean, transform: (AppSettings) -> AppSettings) = synchronized(lock) {
        store.putBoolean(key, value)
        _settings.value = transform(_settings.value)
    }

    companion object {
        const val KEY_COLLAPSE_BOTTOM_BAR = "settings.collapseBottomBar"
        const val KEY_AUTO_OPEN_KEYBOARD = "settings.autoOpenKeyboard"
        const val KEY_FINISHED_ONBOARDING = "settings.finishedOnboarding"
        const val KEY_ARCHIVE_CARD_SHOWN = "tabs.archiveCardShown"
        const val KEY_COLOR = "settings.color"
    }
}
