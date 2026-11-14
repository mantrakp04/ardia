package com.ardia.store

object DemoSeed {
    data class Page(val url: String, val title: String, val minutesAgo: Double)

    val openPages = listOf(
        Page("https://en.wikipedia.org/wiki/Lisbon", "Lisbon - Wikipedia", 600.0),
        Page("https://www.nytimes.com/section/arts", "Arts - The New York Times", 420.0),
        Page("https://www.apple.com/iphone/", "iPhone - Apple", 240.0),
        Page("https://www.allrecipes.com/recipe/21014/good-old-fashioned-pancakes/", "Good Old-Fashioned Pancakes Recipe", 180.0),
        Page("https://www.bbc.com/news/science_and_environment", "Science - BBC News", 95.0),
        Page("https://www.swift.org/blog/", "Blog | Swift.org", 40.0),
        Page("https://www.theverge.com/", "The Verge", 12.0),
        Page("https://en.wikipedia.org/wiki/Sintra", "Sintra - Wikipedia", 3.0),
    )

    val archivedPages = listOf(
        Page("https://www.timeout.com/lisbon", "Time Out Lisbon", 60.0 * 5),
        Page("https://www.metmuseum.org/", "The Metropolitan Museum of Art", 60.0 * 26),
        Page("https://news.ycombinator.com/", "Hacker News", 60.0 * 30),
        Page("https://www.npr.org/sections/music/", "Music : NPR", 60.0 * 60),
    )

    val history = listOf(
        Page("https://www.google.com/search?q=best+time+to+visit+sintra", "best time to visit sintra - Google Search", 8.0),
        Page("https://www.google.com/search?q=past%C3%A9is+de+nata+recipe", "pastéis de nata recipe - Google Search", 50.0),
        Page("https://www.google.com/search?q=swift+concurrency", "swift concurrency - Google Search", 75.0),
        Page("https://www.apple.com/", "Apple", 30.0),
        Page("https://www.apple.com/iphone/", "iPhone - Apple", 240.0),
        Page("https://en.wikipedia.org/wiki/Lisbon", "Lisbon - Wikipedia", 600.0),
        Page("https://www.allrecipes.com/", "Allrecipes | Recipes, How-Tos, Videos and More", 900.0),
    )

    fun seed(tabs: TabStore, now: Long = System.currentTimeMillis()) {
        if (tabs.openTabs.isNotEmpty()) return
        fun ago(minutes: Double) = now - (minutes * 60_000).toLong()
        for (page in history) tabs.recordVisit(page.url, page.title, VisitTransition.TYPED, null, ago(page.minutesAgo))
        for (page in archivedPages) {
            val tab = tabs.open(TabDestination.Url(page.url), selecting = false)
            tabs.update(tab.id, title = page.title)
            tabs.archive(tab.id)
            tabs.backdate(tab.id, lastActive = ago(page.minutesAgo) - 600_000, archivedAt = ago(page.minutesAgo))
        }
        for (page in openPages) {
            val tab = tabs.open(TabDestination.Url(page.url), selecting = false)
            tabs.update(tab.id, title = page.title)
            tabs.backdate(tab.id, lastActive = ago(page.minutesAgo))
        }
        tabs.openTabs.maxByOrNull { it.lastActive }?.let { tabs.select(it.id) }
    }
}
