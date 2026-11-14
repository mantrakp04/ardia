package com.ardia.browser

interface DiscardablePage {
    val isLive: Boolean

    fun makeLive()

    fun discard()
}

class LivePageRoster<P : DiscardablePage>(limit: Int) {
    val limit: Int = maxOf(1, limit)
    private val recency = ArrayList<String>()
    private val pages = LinkedHashMap<String, P>()

    val liveIds: List<String> get() = recency.filter { pages[it]?.isLive == true }

    val mostRecent: String? get() = recency.lastOrNull()

    val allPages: Collection<P> get() = pages.values

    fun page(id: String): P? = pages[id]

    fun register(page: P, id: String) {
        pages[id] = page
    }

    fun activate(id: String) {
        val page = pages[id] ?: return
        recency.remove(id)
        recency.add(id)
        if (!page.isLive) page.makeLive()
        trim(keeping = id)
    }

    fun remove(id: String): P? {
        recency.remove(id)
        val page = pages.remove(id) ?: return null
        if (page.isLive) page.discard()
        return page
    }

    fun discardAll(except: String?) {
        for (id in recency) {
            if (id == except) continue
            val page = pages[id] ?: continue
            if (page.isLive) page.discard()
        }
        recency.clear()
        if (except != null && pages[except]?.isLive == true) recency.add(except)
    }

    private fun trim(keeping: String) {
        val live = liveIds.toMutableList()
        while (live.size > limit) {
            val oldest = live.firstOrNull { it != keeping } ?: break
            pages[oldest]?.discard()
            recency.remove(oldest)
            live.remove(oldest)
        }
    }
}
