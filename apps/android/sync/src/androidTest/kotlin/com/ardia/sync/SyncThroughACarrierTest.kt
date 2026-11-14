package com.ardia.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.sync.core.FileKeyStore
import com.ardia.sync.core.RecoveryPhrase
import java.util.UUID
import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncThroughACarrierTest {
    private val profile = SyncEndToEndTest.PROFILE
    private val scope = SyncEndToEndTest.SCOPE

    private class Pair(
        val sandbox: Sandbox,
        val carrier: FakeCarrier,
        val mac: FakeMac,
        val source: FakeSource,
        val service: SyncService,
        val phrase: String,
        val clock: TestClock,
    )

    private fun pair(seed: Long): Pair {
        val sandbox = Sandbox()
        val carrier = FakeCarrier(sandbox.root, seed)
        val entropy = RecoveryPhrase.generateEntropy()
        val clock = TestClock()
        val mac = FakeMac(carrier.macFolder, entropy, clock)
        mac.put("app", "dev:${mac.device}", """{"n":"MacBook Pro","k":"mac","f":["send"]}""")
        mac.put("app", "prof:$profile", """{"n":"Personal","c":"blue","i":null,"d":true}""")
        mac.put(scope, "tabs:${mac.device}", """{"n":"MacBook Pro","tabs":[{"u":"https://news.example/","t":"News"}]}""")
        mac.put(scope, "bm:docs", """{"k":"u","p":"bar","t":"Docs","u":"https://docs.example/","a":1,"pos":"1"}""")
        mac.sync(listOf("app", scope))
        val source = FakeSource()
        val service = SyncService(sandbox.state, FileKeyStore(sandbox.keys), testAssets, now = { clock.now })
        service.source = source
        return Pair(sandbox, carrier, mac, source, service, RecoveryPhrase.words(entropy).joinToString(" "), clock)
    }

    private fun titles(items: List<BookmarkItem>): Set<String> = items.flatMap { listOf(it.title) + titles(it.children.orEmpty()) }.toSet()

    private fun phoneBookmarks(pair: Pair) = titles(pair.service.snapshot.defaultProfile?.bookmarks.orEmpty()) - setOf("Bookmarks Bar", "Other Bookmarks")

    private fun macBookmarks(pair: Pair): Set<String> {
        val store = pair.mac.store(scope)
        return store.keyList().filter { it.startsWith("bm:") }.map { store.getJSONObject(it).getString("t") }.toSet()
    }

    @Test
    fun halfWrittenFilesWaitAndThenApply() {
        val pair = pair(1)
        try {
            pair.source.tabs = listOf(LocalTabRecord("https://phone.example/", "On the phone", pair.clock.now, null))
            pair.carrier.deliverEverything()
            assertEquals(ConnectResult.Connected, pair.service.connect(pair.phrase, pair.carrier.phoneFolder))
            pair.service.syncNow()
            assertEquals(setOf("Docs"), phoneBookmarks(pair))
            pair.mac.put(scope, "bm:late", """{"k":"u","p":"bar","t":"Late","u":"https://late.example/","a":2,"pos":"2"}""")
            pair.mac.sync(listOf(scope))
            pair.carrier.deliver(halfWritten = 1.0)
            assertTrue(pair.carrier.halfWrittenDelivered > 0)
            pair.service.syncNow()
            assertEquals(SyncPhase.Updated, pair.service.phase)
            assertEquals(setOf("Docs"), phoneBookmarks(pair))
            pair.carrier.deliverEverything()
            pair.service.syncNow()
            assertEquals(setOf("Docs", "Late"), phoneBookmarks(pair))
            pair.service.stopSyncing()
        } finally {
            pair.mac.close()
            pair.sandbox.remove()
        }
    }

    @Test
    fun lateOutOfOrderAndHalfWrittenDeliveriesConvergeAndEverySentTabArrivesOnce() {
        for (seed in listOf(11L, 23L, 37L)) soak(seed)
    }

    private fun soak(seed: Long) {
        val pair = pair(seed)
        try {
            val random = Random(seed * 7919)
            pair.carrier.deliverEverything()
            assertEquals(ConnectResult.Connected, pair.service.connect(pair.phrase, pair.carrier.phoneFolder))
            pair.service.syncNow()
            pair.carrier.deliverEverything()
            pair.mac.sync(listOf("app", scope))
            val me = pair.service.snapshot.devices.first { it.isCurrent }.id

            val alive = mutableSetOf("Docs")
            var nextBookmark = 0
            val sentToPhone = mutableSetOf<String>()
            val sendsToPhone = mutableSetOf<String>()
            val sentToMac = mutableSetOf<String>()
            var phoneTabs = listOf<String>()
            var macTabs = listOf("https://news.example/")
            val lost = mutableListOf<String>()
            val seen = mutableSetOf<String>()

            for (round in 0 until 50) {
                pair.clock.advance(180)
                if (random.nextDouble() < 0.4) {
                    macTabs = (0 until random.nextInt(1, 4)).map { "https://mac-$round-$it.example/" }
                    pair.mac.put(scope, "tabs:${pair.mac.device}", """{"n":"MacBook Pro","tabs":[${macTabs.joinToString(",") { """{"u":"$it","t":"$it"}""" }}]}""")
                }
                if (random.nextDouble() < 0.6) {
                    nextBookmark++
                    val title = "B$nextBookmark"
                    pair.mac.put(scope, "bm:$title", """{"k":"u","p":"bar","t":"$title","u":"https://${title.lowercase()}.example/","a":${nextBookmark + 1},"pos":"${nextBookmark + 1}"}""")
                    alive += title
                }
                if (random.nextDouble() < 0.2) {
                    alive.filter { it != "Docs" }.sorted().randomOrNull(random)?.let { doomed ->
                        pair.mac.delete(scope, "bm:$doomed")
                        alive -= doomed
                        seen -= doomed
                    }
                }
                if (random.nextDouble() < 0.2) {
                    val url = "https://to-phone-$round.example/"
                    val key = "send:${UUID.randomUUID()}"
                    pair.mac.put(scope, key, """{"u":"$url","t":"Sent $round","to":"$me","from":"${pair.mac.device}","at":${pair.clock.now}}""")
                    sentToPhone += url
                    sendsToPhone += key
                }
                if (random.nextDouble() < 0.6) pair.mac.sync(listOf("app", scope))
                if (random.nextDouble() < 0.3) {
                    phoneTabs = (0 until random.nextInt(1, 4)).map { "https://phone-$round-$it.example/" }
                    pair.source.tabs = phoneTabs.map { LocalTabRecord(it, it, pair.clock.now, null) }
                    pair.service.localDidChange()
                }
                if (random.nextDouble() < 0.15) {
                    pair.service.devicesThatReceiveTabs().firstOrNull()?.let { target ->
                        val url = "https://to-mac-$round.example/"
                        if (pair.service.send(url, "To Mac $round", target)) sentToMac += url
                    }
                }
                pair.carrier.deliver(chance = 0.2 + random.nextDouble() * 0.7, halfWritten = random.nextDouble() * 0.4)
                if (random.nextDouble() < 0.7) {
                    pair.service.syncNow()
                    val now = phoneBookmarks(pair)
                    lost += (seen - now).filter { it in alive }.map { "round $round: $it" }
                    seen += now.intersect(alive)
                }
            }

            repeat(4) {
                pair.clock.advance(60)
                pair.carrier.deliverEverything()
                pair.mac.sync(listOf("app", scope))
                pair.carrier.deliverEverything()
                pair.service.syncNow()
            }

            assertEquals("seed $seed: a bookmark the Mac still has went away on the phone", emptyList<String>(), lost)
            assertTrue("seed $seed: no file arrived half written", pair.carrier.halfWrittenDelivered > 0)
            assertTrue("seed $seed: the Mac never compacted", pair.carrier.deletionsDelivered > 0)
            assertEquals("seed $seed", SyncPhase.Updated, pair.service.phase)
            assertEquals("seed $seed", 0, pair.service.pendingDownloads)
            assertEquals("seed $seed", alive, macBookmarks(pair))
            assertEquals("seed $seed", alive, phoneBookmarks(pair))
            val macDevice = pair.service.snapshot.defaultProfile!!.deviceTabs.first { it.deviceId == pair.mac.device }
            assertEquals("seed $seed", macTabs, macDevice.tabs.map { it.url })
            assertEquals("seed $seed", sentToPhone, pair.source.received.map { it.url }.toSet())
            assertEquals("seed $seed: a tab sent to the phone arrived twice", sentToPhone.size, pair.source.received.size)
            val store = pair.mac.store(scope)
            val sends = store.keyList().filter { it.startsWith("send:") }.map { store.getJSONObject(it) }
            assertTrue("seed $seed: a send to the phone was never cleared", sends.all { it.getString("to") == pair.mac.device })
            assertEquals("seed $seed", sentToMac, sends.map { it.getString("u") }.toSet())
            assertEquals("seed $seed", sentToMac.size, sends.size)
            if (phoneTabs.isNotEmpty()) {
                val tabs = store.getJSONObject("tabs:$me").getJSONArray("tabs")
                assertEquals("seed $seed", phoneTabs, (0 until tabs.length()).map { tabs.getJSONObject(it).getString("u") })
            }
            val logs = listOf("app", scope).associateWith { pair.mac.logs(it, me) }
            for ((name, files) in logs) {
                val seqs = files.map { it.getInt("seq") }
                assertEquals("seed $seed: the phone reused a seq in $name", seqs.toSet().size, seqs.size)
            }
            val keys = logs.values.flatten().flatMap { file -> val ops = file.getJSONArray("ops"); (0 until ops.length()).map { ops.getJSONObject(it).getString("k") } }.toSet()
            assertTrue("seed $seed: the phone wrote $keys", keys.all { it == "dev:$me" || it == "tabs:$me" || it.startsWith("send:") })
            val deletions = logs.values.flatten().flatMap { file -> val ops = file.getJSONArray("ops"); (0 until ops.length()).map { ops.getJSONObject(it) } }.filter { it.isNull("v") }.map { it.getString("k") }
            assertTrue("seed $seed: the phone deleted $deletions", deletions.all { it in sendsToPhone })
            pair.service.stopSyncing()
        } finally {
            pair.mac.close()
            pair.sandbox.remove()
        }
    }
}
