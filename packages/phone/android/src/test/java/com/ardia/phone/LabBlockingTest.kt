package com.ardia.phone

import com.ardia.blocking.BlockingSettings
import com.ardia.blocking.ContentBlocker
import com.ardia.blocking.FetchResponse
import com.ardia.blocking.FilterListDownloader
import com.ardia.blocking.FilterLists
import com.ardia.blocking.InMemoryBlockingStore
import com.ardia.blocking.NetworkUnavailableException
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LabBlockingTest {
    private val labPage = "https://lab.ardia.dev/blocking"

    private val labRequests = listOf(
        "https://securepubads.g.doubleclick.net/tag/js/gpt.js",
        "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
        "https://ad.doubleclick.net/ddm/ad/lab.gif",
        "https://www.google-analytics.com/analytics.js",
        "https://connect.facebook.net/en_US/fbevents.js",
        "https://static.hotjar.com/c/hotjar-1.js",
        "https://cdn.taboola.com/libtrc/lab/loader.js",
    )

    private fun blocker(): ContentBlocker {
        val store = InMemoryBlockingStore()
        val offline = object : FilterListDownloader {
            override suspend fun fetch(url: String, etag: String?, lastModified: String?, allowExpensive: Boolean): FetchResponse =
                throw NetworkUnavailableException()
        }
        val directory = Files.createTempDirectory("lab-blocking").toFile().apply { deleteOnExit() }
        return ContentBlocker(BlockingSettings(store), FilterLists(directory, store, offline))
    }

    @Test
    fun theLabPageRequestsAreBlockedBySeedsAlone() {
        val blocker = blocker()
        val blocked = labRequests.filter { blocker.blocks(it, labPage, false) }
        assertEquals(labRequests, blocked)
    }

    @Test
    fun turningBlockersOffForTheLabSiteLetsEveryRequestThrough() {
        val blocker = blocker()
        blocker.setBlockersEnabled(labPage, false)
        assertTrue(labRequests.none { blocker.blocks(it, labPage, false) })
        blocker.setBlockersEnabled(labPage, true)
        assertTrue(labRequests.all { blocker.blocks(it, labPage, false) })
    }
}
