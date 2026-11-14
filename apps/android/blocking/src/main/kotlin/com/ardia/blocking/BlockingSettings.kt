package com.ardia.blocking

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class BlockingCategory(val rawValue: String, internal val bit: Int) {
    ADS("ads", 1),
    TRACKERS("trackers", 2),
    COOKIE_BANNERS("cookieBanners", 4),
    ;

    companion object {
        fun fromRawValue(value: String?): BlockingCategory? = entries.firstOrNull { it.rawValue == value }
    }
}

data class BlockingSettingsState(
    val blocksAds: Boolean = true,
    val blocksTrackers: Boolean = true,
    val hidesCookieBanners: Boolean = true,
    val exemptHosts: Set<String> = emptySet(),
)

internal class SettingsSnapshot(
    val categoryMask: Int,
    val exemptHosts: LongHashSet,
    val privateExempt: LongHashSet,
    val privateNotExempt: LongHashSet,
) {
    fun isExempt(suffixHashes: LongArray, count: Int, isPrivate: Boolean): Boolean {
        val checksOverrides = isPrivate && (privateExempt.size > 0 || privateNotExempt.size > 0)
        if (exemptHosts.size == 0 && !checksOverrides) return false
        for (index in 0 until count) {
            val hash = suffixHashes[index]
            if (checksOverrides) {
                if (privateExempt.contains(hash)) return true
                if (privateNotExempt.contains(hash)) return false
            }
            if (exemptHosts.contains(hash)) return true
        }
        return false
    }
}

class BlockingSettings(private val store: BlockingStore) {
    private val lock = Any()
    private val privateExemptions = LinkedHashMap<String, Boolean>()
    private val mutableState = MutableStateFlow(
        BlockingSettingsState(
            blocksAds = store.boolean(KEY_ADS) ?: true,
            blocksTrackers = store.boolean(KEY_TRACKERS) ?: true,
            hidesCookieBanners = store.boolean(KEY_COOKIES) ?: true,
            exemptHosts = store.strings(KEY_EXEMPT)?.toSet() ?: emptySet(),
        ),
    )

    @Volatile
    internal var snapshot: SettingsSnapshot = makeSnapshot(mutableState.value)
        private set

    val state: StateFlow<BlockingSettingsState> = mutableState.asStateFlow()

    var blocksAds: Boolean
        get() = mutableState.value.blocksAds
        set(value) = update(KEY_ADS, value) { it.copy(blocksAds = value) }

    var blocksTrackers: Boolean
        get() = mutableState.value.blocksTrackers
        set(value) = update(KEY_TRACKERS, value) { it.copy(blocksTrackers = value) }

    var hidesCookieBanners: Boolean
        get() = mutableState.value.hidesCookieBanners
        set(value) = update(KEY_COOKIES, value) { it.copy(hidesCookieBanners = value) }

    val exemptHosts: Set<String> get() = mutableState.value.exemptHosts

    fun isEnabled(category: BlockingCategory): Boolean = when (category) {
        BlockingCategory.ADS -> blocksAds
        BlockingCategory.TRACKERS -> blocksTrackers
        BlockingCategory.COOKIE_BANNERS -> hidesCookieBanners
    }

    fun isExempt(host: String?, isPrivate: Boolean = false): Boolean {
        val normalized = host?.let(::normalize) ?: return false
        if (normalized.isEmpty()) return false
        val exempt = exemptHosts
        val overrides = synchronized(lock) { if (isPrivate) HashMap(privateExemptions) else emptyMap() }
        if (exempt.isEmpty() && overrides.isEmpty()) return false
        var candidate = normalized
        while (true) {
            overrides[candidate]?.let { return it }
            if (candidate in exempt) return true
            val dot = candidate.indexOf('.')
            if (dot < 0) return false
            candidate = candidate.substring(dot + 1)
        }
    }

    fun setExempt(host: String, exempt: Boolean, isPrivate: Boolean = false) {
        val key = normalize(host)
        if (key.isEmpty()) return
        if (isPrivate) {
            if (isExempt(host, isPrivate = true) == exempt) return
            synchronized(lock) {
                privateExemptions[key] = exempt
                snapshot = makeSnapshot(mutableState.value)
            }
            return
        }
        synchronized(lock) {
            val before = mutableState.value
            val next = if (exempt) before.exemptHosts + key else before.exemptHosts - key
            if (next == before.exemptHosts) return
            store.setStrings(KEY_EXEMPT, next.sorted())
            val state = before.copy(exemptHosts = next)
            snapshot = makeSnapshot(state)
            mutableState.value = state
        }
    }

    fun endPrivateBrowsing() {
        synchronized(lock) {
            if (privateExemptions.isEmpty()) return
            privateExemptions.clear()
            snapshot = makeSnapshot(mutableState.value)
        }
    }

    private fun update(key: String, value: Boolean, change: (BlockingSettingsState) -> BlockingSettingsState) {
        synchronized(lock) {
            val before = mutableState.value
            store.setBoolean(key, value)
            val next = change(before)
            if (next == before) return
            snapshot = makeSnapshot(next)
            mutableState.value = next
        }
    }

    private fun makeSnapshot(state: BlockingSettingsState): SettingsSnapshot {
        var mask = OWNER_BIT
        if (state.blocksAds) mask = mask or BlockingCategory.ADS.bit
        if (state.blocksTrackers) mask = mask or BlockingCategory.TRACKERS.bit
        if (state.hidesCookieBanners) mask = mask or BlockingCategory.COOKIE_BANNERS.bit
        val exempt = LongHashSet(state.exemptHosts.size)
        state.exemptHosts.forEach { exempt.add(HostHash.of(it)) }
        val privateExempt = LongHashSet(4)
        val privateNotExempt = LongHashSet(4)
        privateExemptions.forEach { (host, isExempt) ->
            if (isExempt) privateExempt.add(HostHash.of(host)) else privateNotExempt.add(HostHash.of(host))
        }
        return SettingsSnapshot(mask, exempt, privateExempt, privateNotExempt)
    }

    companion object {
        const val KEY_ADS = "blocking.ads"
        const val KEY_TRACKERS = "blocking.trackers"
        const val KEY_COOKIES = "blocking.cookieBanners"
        const val KEY_EXEMPT = "blocking.exemptHosts"
        internal const val OWNER_BIT = 8

        fun normalize(host: String): String {
            val lower = host.lowercase().trim('.', ' ')
            return if (lower.startsWith("www.")) lower.substring(4) else lower
        }
    }
}

class BlockedResourceCounter {
    private val mutableCount = MutableStateFlow(0)

    val count: StateFlow<Int> = mutableCount.asStateFlow()

    fun reset() {
        if (mutableCount.value != 0) mutableCount.value = 0
    }

    internal fun add(amount: Int) {
        if (amount <= 0) return
        while (true) {
            val current = mutableCount.value
            if (mutableCount.compareAndSet(current, current + amount)) return
        }
    }
}
