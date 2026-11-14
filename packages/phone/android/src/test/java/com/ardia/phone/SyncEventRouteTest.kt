package com.ardia.phone

import com.ardia.sync.ReceivedTab
import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncEventRouteTest {
    private val inbox = PhoneInbox(File(Files.createTempDirectory("phone-route").toFile().apply { deleteOnExit() }, "inbox.json"))

    private fun tab(key: String) = ReceivedTab(key, "https://$key.example/", key, "Mac", 1L, "personal", "mac-1")

    @Test
    fun theOldModuleClosingAfterAReloadLeavesTheNewModulesEventsAlone() {
        val old = ArrayList<Map<String, Any?>>()
        val fresh = ArrayList<Map<String, Any?>>()
        val before = SyncEventRoute(inbox, { old += it }) { null }
        SyncEventRoute(inbox, { fresh += it }) { null }
        before.close()
        inbox.receive(listOf(tab("a")))
        assertEquals(listOf("sync.inbox"), fresh.map { it["name"] })
        assertTrue(old.isEmpty())
    }

    @Test
    fun nothingIsSentAfterTheModuleClosedEvenFromACallbackAlreadyInFlight() {
        var sent = 0
        val route = SyncEventRoute(inbox, { sent += 1 }) { null }
        route.close()
        route.emit(mapOf("name" to "sync.status"))
        inbox.receive(listOf(tab("b")))
        assertEquals(0, sent)
    }

    @Test
    fun aSendThatThrowsBecauseTheBridgeIsGoneDoesNotEscape() {
        val route = SyncEventRoute(inbox, { throw IllegalStateException("the bridge is gone") }) { null }
        assertTrue(inbox.receive(listOf(tab("c"))))
        route.emit(mapOf("name" to "sync.status"))
    }
}
