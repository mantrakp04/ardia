package com.ardia.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ardia.sync.core.FileKeyStore
import com.ardia.sync.core.RecoveryPhrase
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncEndToEndTest {
    companion object {
        const val PROFILE = "personal000000000000000000"
        const val SCOPE = "p:$PROFILE"
        const val MAC2 = "mac2000000000000000000000000"
        const val OLD_MAC = "oldmac00000000000000000000"
    }

    private fun seededMac(sandbox: Sandbox, entropy: ByteArray): FakeMac {
        val mac = FakeMac(sandbox.folder, entropy)
        mac.put("app", "dev:${mac.device}", """{"n":"MacBook Pro"}""")
        mac.put("app", "prof:$PROFILE", """{"n":"Personal","c":"blue","i":null,"d":true}""")
        mac.put("app", "set:searchEngine", """{"v":"duckduckgo"}""")
        mac.put("app", "set:appearance", """{"v":"dark"}""")
        mac.put(SCOPE, "tabs:${mac.device}", """{"n":"MacBook Pro","tabs":[{"u":"https://news.example/","t":"News"},{"u":"https://mail.example/","t":"Mail"}]}""")
        mac.put(SCOPE, "pin:t:tile", """{"g":null,"u":"https://calendar.example/","t":null,"i":null,"ti":"Calendar","pos":"1"}""")
        mac.put(SCOPE, "pin:t:row", """{"g":null,"u":"https://notes.example/","t":"Notes","i":null,"ti":"Notes page","pos":"2"}""")
        mac.put(SCOPE, "pinrow:row", "1")
        mac.put(SCOPE, "pin:g:group", """{"n":"Trip","i":null,"c":"orange","pos":"3"}""")
        mac.put(SCOPE, "pin:t:member", """{"g":"group","u":"https://flights.example/","t":null,"i":null,"ti":"Flights","pos":"1"}""")
        mac.put(SCOPE, "bm:folder", """{"k":"f","p":"bar","t":"Reading","a":1,"pos":"1"}""")
        mac.put(SCOPE, "bm:docs", """{"k":"u","p":"folder","t":"Docs","u":"https://docs.example/","a":2,"pos":"1"}""")
        mac.put(SCOPE, "pw:https://bank.example\nluke", """{"o":"https://bank.example","u":"luke","p":"hunter2"}""")
        mac.put(SCOPE, "h:https://read.example/", """{"t":"Reading","n":1,"vt":[${System.currentTimeMillis() - 3_600_000}]}""")
        mac.sync(listOf("app", SCOPE))
        return mac
    }

    private fun service(sandbox: Sandbox, source: FakeSource, clock: TestClock? = null): SyncService =
        SyncService(sandbox.state, FileKeyStore(sandbox.keys), testAssets, now = clock?.let { c -> { c.now } } ?: System::currentTimeMillis).also { it.source = source }

    private fun phrase(entropy: ByteArray) = RecoveryPhrase.words(entropy).joinToString(" ")

    private fun twice(service: SyncService) {
        service.syncNow()
        service.syncNow()
    }

    @Test
    fun wrongPhrasesAreRejectedBeforeAnythingIsWritten() {
        val sandbox = Sandbox()
        try {
            val entropy = RecoveryPhrase.generateEntropy()
            seededMac(sandbox, entropy).close()
            val words = RecoveryPhrase.words(entropy)
            val folderBefore = sandbox.folder.walkTopDown().map { it.path }.toSet()
            val service = service(sandbox, FakeSource())
            val swapped = words.toMutableList().apply { val first = this[0]; this[0] = this[1]; this[1] = first }
            if (runCatching { RecoveryPhrase.entropy(swapped.joinToString(" ")) }.isSuccess) swapped.apply { val second = this[2]; this[2] = this[5]; this[5] = second }
            val cases = listOf(
                words.dropLast(1).joinToString(" ") to ConnectResult.InvalidPhrase("Recovery phrase must be exactly 24 words."),
                (words.dropLast(1) + "zzzzzz").joinToString(" ") to ConnectResult.InvalidPhrase("“zzzzzz” is not a valid recovery phrase word."),
                swapped.joinToString(" ") to ConnectResult.InvalidPhrase("This recovery phrase is not valid. Please check for typos."),
                phrase(RecoveryPhrase.generateEntropy()) to ConnectResult.Mismatch,
            )
            for ((text, expected) in cases) assertEquals(expected, service.connect(text, sandbox.root))
            assertEquals(SyncPhase.Off, service.phase)
            assertFalse(service.isEnabled)
            assertEquals(folderBefore, sandbox.folder.walkTopDown().map { it.path }.toSet())
            assertTrue(sandbox.contents(sandbox.keys).isEmpty())
            assertTrue(sandbox.contents(sandbox.state).isEmpty())
            val empty = java.io.File(sandbox.root, "Empty").apply { mkdirs() }
            assertEquals(ConnectResult.NoSyncData, service.connect(phrase(entropy), empty))
            assertTrue(sandbox.contents(sandbox.keys).isEmpty())
        } finally {
            sandbox.remove()
        }
    }

    @Test
    fun thePhoneJoinsSeesTheMacAndTheMacSeesThePhone() {
        val sandbox = Sandbox()
        val entropy = RecoveryPhrase.generateEntropy()
        val mac = seededMac(sandbox, entropy)
        try {
            val source = FakeSource()
            source.tabs = listOf(LocalTabRecord("https://phone.example/", "On the phone", System.currentTimeMillis(), null))
            val service = service(sandbox, source)
            val kit = RecoveryPhrase.words(entropy).withIndex().joinToString("\n") { "${it.index + 1}. ${it.value.uppercase()}" }
            assertTrue(service.check(kit).isValid)
            assertEquals(ConnectResult.Connected, service.connect(kit, sandbox.root))
            service.syncNow()
            assertEquals(SyncPhase.Updated, service.phase)
            assertEquals("Updated just now", service.statusText)
            assertEquals("Ardia Sync", service.folderName)
            val profile = service.snapshot.defaultProfile!!
            assertEquals("Personal", profile.name)
            assertEquals(listOf("MacBook Pro"), profile.deviceTabs.map { it.deviceName })
            assertEquals(listOf("https://news.example/", "https://mail.example/"), profile.deviceTabs.first().tabs.map { it.url })
            assertEquals(listOf("Calendar"), profile.pinned.tiles.map { it.title })
            assertEquals(listOf("t:row", "g:group"), profile.pinned.sections.map { it.id })
            assertEquals(listOf("Docs"), profile.bookmarks.first().children?.map { it.title })
            assertEquals(listOf("https://read.example/"), profile.history.map { it.url })
            assertEquals("duckduckgo", service.snapshot.search?.engineId)
            val me = service.snapshot.devices.first { it.isCurrent }
            assertEquals("phone", me.kind)
            assertTrue(service.devicesThatReceiveTabs().isEmpty())

            mac.sync(listOf("app", SCOPE))
            assertEquals("phone", mac.store("app").getJSONObject("dev:${me.id}").getString("k"))
            val tabs = mac.store(SCOPE).getJSONObject("tabs:${me.id}").getJSONArray("tabs")
            assertEquals("https://phone.example/", tabs.getJSONObject(0).getString("u"))
            assertEquals(1, tabs.length())

            val sendKey = "send:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
            mac.put(SCOPE, sendKey, """{"u":"https://sent.example/","t":"Sent","to":"${me.id}","from":"${mac.device}","at":${System.currentTimeMillis()}}""")
            mac.sync(listOf(SCOPE))
            twice(service)
            twice(service)
            assertEquals(listOf("https://sent.example/"), source.received.map { it.url })
            assertEquals("MacBook Pro", source.received.first().fromDevice)
            mac.sync(listOf(SCOPE))
            assertFalse(mac.store(SCOPE).has(sendKey))

            mac.put("app", "dev:${mac.device}", """{"n":"MacBook Pro","k":"mac","f":["send"]}""")
            mac.sync(listOf("app"))
            service.syncNow()
            val target = service.devicesThatReceiveTabs().first()
            val shareKey = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB"
            assertTrue(service.send("https://to-mac.example/", "To Mac", target, key = shareKey))
            service.syncNow()
            mac.sync(listOf(SCOPE))
            val sends = mac.store(SCOPE).keyList().filter { it.startsWith("send:") }
            assertEquals(listOf("send:${shareKey.lowercase()}"), sends)
            assertEquals(mac.device, mac.store(SCOPE).getJSONObject(sends.first()).getString("to"))

            service.stopSyncing()
            assertEquals(SyncPhase.Off, service.phase)
            assertTrue(sandbox.contents(sandbox.keys).isEmpty())
            mac.sync(listOf("app", SCOPE))
            assertFalse(mac.store("app").has("dev:${me.id}"))
            assertFalse(mac.store(SCOPE).has("tabs:${me.id}"))
            assertTrue(mac.store(SCOPE).has("bm:docs"))
            assertTrue(mac.store(SCOPE).has("pw:https://bank.example\nluke"))
        } finally {
            mac.close()
            sandbox.remove()
        }
    }

    @Test
    fun thePhoneKeepsEveryRecordKindTheMacWritesAndWritesOnlyItsOwn() {
        val sandbox = Sandbox()
        val entropy = RecoveryPhrase.generateEntropy()
        val mac = seededMac(sandbox, entropy)
        try {
            val now = System.currentTimeMillis()
            mac.put("app", "dev:${mac.device}", """{"n":"MacBook Pro","k":"mac","f":["send"]}""")
            mac.put("app", "dev:$MAC2", """{"n":"Mac mini","k":"mac","f":["send"]}""")
            mac.put("app", "dev:$OLD_MAC", """{"n":"iMac"}""")
            mac.put("app", "prof:work00000000000000000000", """{"n":"Work","c":"green","i":"briefcase","th":{"stops":[],"intensity":0.2}}""")
            mac.put("app", "pth:work00000000000000000000", """{"preset":true}""")
            mac.put("app", "share:work00000000000000000000", """{"o":"$PROFILE"}""")
            mac.put("app", "set:tabLayout", """{"v":"top"}""")
            mac.put("app", "set:windowStyle", """{"v":{"glass":true,"tint":[0.1,0.2]}}""")
            mac.put("app", "set:retired", """{"v":true}""")
            mac.put("app", "future:kind", """["any",1,{"nested":[null,true]}]""")
            mac.put("app", "zz", "42")
            mac.put(SCOPE, "tabs:$MAC2", """{"n":"Mac mini","tabs":[{"u":"https://mini.example/","t":"Mini"}]}""")
            mac.put(SCOPE, "pinn:g:N2", """{"n":"Inner","i":null,"c":null,"p":"group"}""")
            mac.put(SCOPE, "pgc:group", "\"none\"")
            mac.put(SCOPE, "pgh:member", "\"https://home.example/start\"")
            mac.put(SCOPE, "pord:g:group", """{"a":null}""")
            mac.put(SCOPE, "tilefold:n:Empty", """{"n":""}""")
            mac.put(SCOPE, "pws:https://shop.example\nada", """{"o":"https://shop.example","u":"ada","s":"sealed-two"}""")
            mac.put(SCOPE, "ext:abc", """{"on":true,"inc":false,"pin":true}""")
            mac.put(SCOPE, "ext:v:abc", """{"v":"1.2.3","fps":["ab12"]}""")
            mac.put(SCOPE, "pin:t:gone", """{"g":null,"u":"https://gone.example/","t":null,"i":null,"ti":"Gone","pos":"9"}""")
            mac.put(SCOPE, "bm:deleted", """{"k":"u","p":"other","t":"Deleted","u":"https://deleted.example/","a":8,"pos":"9"}""")
            mac.put(SCOPE, "send:44444444-4444-4444-8444-444444444444", """{"u":"https://elsewhere.example/","t":"Elsewhere","to":"$MAC2","from":"${mac.device}","at":$now}""")
            mac.put(SCOPE, "send:55555555-5555-4555-8555-555555555555", """{"u":"https://to-mac.example/","t":"To Mac","to":"${mac.device}","from":"$MAC2","at":$now}""")
            mac.put(SCOPE, "future:profile", """{"anything":"goes"}""")
            mac.sync(listOf("app", SCOPE))
            mac.delete("app", "set:retired")
            mac.delete(SCOPE, "pin:t:gone")
            mac.delete(SCOPE, "bm:deleted")
            mac.sync(listOf("app", SCOPE))

            val source = FakeSource()
            source.tabs = listOf(LocalTabRecord("https://phone.example/", "Phone", now, null))
            source.visits = listOf(LocalVisitRecord("https://phone-only.example/", "Phone only", listOf(now - 60_000), PROFILE))
            val service = service(sandbox, source)
            assertEquals(ConnectResult.Connected, service.connect(phrase(entropy), sandbox.root))
            service.syncNow()
            val me = service.snapshot.devices.first { it.isCurrent }.id
            val toPhone = "send:77777777-7777-4777-8777-777777777777"
            mac.put(SCOPE, toPhone, """{"u":"https://to-phone.example/","t":"To phone","to":"$me","from":"${mac.device}","at":$now}""")
            mac.sync(listOf(SCOPE))
            val own = listOf("dev:$me", "tabs:$me", "h:https://phone-only.example/", toPhone)
            val appBefore = canonical(mac.store("app").without(own))
            val scopeBefore = canonical(mac.store(SCOPE).without(own))
            repeat(6) { round ->
                service.syncNow()
                if (round == 3) mac.sync(listOf("app", SCOPE))
            }
            mac.sync(listOf("app", SCOPE))
            assertEquals(listOf(toPhone), source.received.map { it.key }.distinct())
            assertEquals(1, source.received.size)
            assertEquals(appBefore, canonical(mac.store("app").without(own)))
            assertEquals(scopeBefore, canonical(mac.store(SCOPE).without(own)))
            assertFalse(mac.store(SCOPE).has(toPhone))
            assertTrue(mac.store(SCOPE).has("h:https://phone-only.example/"))

            val ops = listOf("app", SCOPE).flatMap { scope -> mac.logs(scope, me) }.flatMap { file ->
                val list = file.getJSONArray("ops")
                (0 until list.length()).map { list.getJSONObject(it) }
            }
            assertEquals(own.sorted(), ops.map { it.getString("k") }.distinct().sorted())
            assertEquals(listOf(toPhone), ops.filter { it.isNull("v") }.map { it.getString("k") })
            val phoneFiles = listOf("app", SCOPE).flatMap { mac.files(it) }.filter { it.optString("device") == me }
            assertTrue(phoneFiles.all { it.getString("kind") == "log" })
            service.stopSyncing()
        } finally {
            mac.close()
            sandbox.remove()
        }
    }

    @Test
    fun damagedAndHalfWrittenFilesAreNotApplied() {
        val sandbox = Sandbox()
        val entropy = RecoveryPhrase.generateEntropy()
        val mac = seededMac(sandbox, entropy)
        try {
            val service = service(sandbox, FakeSource())
            assertEquals(ConnectResult.Connected, service.connect(phrase(entropy), sandbox.folder))
            service.syncNow()
            val scopeFolder = mac.scopeFolder(SCOPE)
            val before = sandbox.contents(scopeFolder).toSet()
            mac.put(SCOPE, "bm:late", """{"k":"u","p":"other","t":"Late","u":"https://late.example/","a":3,"pos":"5"}""")
            mac.sync(listOf(SCOPE))
            val added = (sandbox.contents(scopeFolder).toSet() - before).single()
            val file = java.io.File(scopeFolder, added)
            val whole = file.readBytes()
            file.writeBytes(whole.copyOf(whole.size / 2))
            java.io.File(scopeFolder, "${"a".repeat(26)}.nns").writeBytes(ByteArray(2048) { 7 })
            service.syncNow()
            assertEquals(SyncPhase.Updated, service.phase)
            assertFalse(service.snapshot.defaultProfile!!.bookmarks.any { it.title == "Late" })
            file.writeBytes(whole)
            service.syncNow()
            assertTrue(service.snapshot.defaultProfile!!.bookmarks.any { it.title == "Late" })
            service.stopSyncing()
        } finally {
            mac.close()
            sandbox.remove()
        }
    }

    @Test
    fun stateSurvivesARelaunchWithNoSeqReused() {
        val sandbox = Sandbox()
        val entropy = RecoveryPhrase.generateEntropy()
        val mac = seededMac(sandbox, entropy)
        try {
            val source = FakeSource()
            source.tabs = listOf(LocalTabRecord("https://one.example/", "One", System.currentTimeMillis(), null))
            val first = service(sandbox, source)
            assertEquals(ConnectResult.Connected, first.connect(phrase(entropy), sandbox.root))
            first.syncNow()
            val me = first.snapshot.devices.first { it.isCurrent }.id
            source.tabs = source.tabs + LocalTabRecord("https://two.example/", "Two", System.currentTimeMillis(), null)
            first.localDidChange()
            first.syncNow()
            first.close()

            val relaunched = service(sandbox, source)
            relaunched.start()
            assertEquals("Personal", relaunched.snapshot.defaultProfile?.name)
            relaunched.syncNow()
            assertEquals(SyncPhase.Updated, relaunched.phase)
            source.tabs = source.tabs + LocalTabRecord("https://three.example/", "Three", System.currentTimeMillis(), null)
            relaunched.localDidChange()
            relaunched.syncNow()
            val seqs = mac.logs(SCOPE, me).map { it.getInt("seq") }
            assertEquals((1..seqs.size).toList(), seqs)
            assertEquals(3, seqs.size)
            assertFalse(sandbox.contents(sandbox.state).contains("sync-journal.nns"))
            assertNotNull(sandbox.contents(sandbox.state).firstOrNull { it == "sync-state.nns" })
            relaunched.stopSyncing()
        } finally {
            mac.close()
            sandbox.remove()
        }
    }

    @Test
    fun aKeystoreKeyOpensOnlyForItsAccount() {
        val sandbox = Sandbox()
        try {
            val store = KeystoreKeyStore(sandbox.keys, "Ardia Sync Key Test")
            val entropy = RecoveryPhrase.generateEntropy()
            assertTrue(store.save(entropy, "device"))
            assertEquals(entropy.toList(), store.load("device")?.toList())
            val sealed = java.io.File(sandbox.keys, "sync-key-device")
            assertFalse(sealed.readBytes().toList().windowed(entropy.size).any { it == entropy.toList() })
            sealed.copyTo(java.io.File(sandbox.keys, "sync-key-other"))
            assertNull(store.load("other"))
            store.delete("device")
            assertNull(store.load("device"))
        } finally {
            sandbox.remove()
        }
    }
}
