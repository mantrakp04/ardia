package com.ardia.sync

import android.content.ContentResolver
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.ardia.sync.core.FileKeyStore
import com.ardia.sync.core.RecoveryPhrase
import com.ardia.sync.core.SyncKeys
import com.ardia.sync.core.SyncVault
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

class TrustingTreeAccess(resolver: ContentResolver, timeoutMs: Long = ResolverDocumentTree.DEFAULT_TIMEOUT_MS) : AndroidSyncFolderAccess(resolver, timeoutMs) {
    override fun resolve(location: SyncFolderLocation): SyncFolderGrant? {
        val tree = location as? SyncFolderLocation.Tree ?: return super.resolve(location)
        val documents = ResolverDocumentTree(resolver, android.net.Uri.parse(tree.treeUri), timeoutMs)
        return SyncFolderGrant(DocumentTreeStorage(documents, tree.subfolder, tree.name), tree)
    }

    override fun hasAccess(location: SyncFolderLocation): Boolean = true

    override fun keep(location: SyncFolderLocation): Boolean = true
}

@RunWith(AndroidJUnit4::class)
class SyncThroughAPickedFolderTest {
    private val scope = SyncEndToEndTest.SCOPE
    private val resolver: ContentResolver get() = InstrumentationRegistry.getInstrumentation().targetContext.contentResolver

    private class Drive(val sandbox: Sandbox) {
        val root = File(sandbox.root, "Drive").apply { mkdirs() }
        val folder = File(root, "Ardia Sync").apply { mkdirs() }

        init {
            TestDocumentsProvider.reset(root)
        }
    }

    private fun seededMac(folder: File, entropy: ByteArray): FakeMac {
        val mac = FakeMac(folder, entropy)
        mac.put("app", "dev:${mac.device}", """{"n":"MacBook Pro","k":"mac","f":["send"]}""")
        mac.put("app", "prof:${SyncEndToEndTest.PROFILE}", """{"n":"Personal","c":"blue","i":null,"d":true}""")
        mac.put(scope, "tabs:${mac.device}", """{"n":"MacBook Pro","tabs":[{"u":"https://news.example/","t":"News"}]}""")
        mac.put(scope, "bm:docs", """{"k":"u","p":"bar","t":"Docs","u":"https://docs.example/","a":1,"pos":"1"}""")
        mac.sync(listOf("app", scope))
        return mac
    }

    private fun service(sandbox: Sandbox, source: FakeSource, access: SyncFolderAccess) =
        SyncService(sandbox.state, FileKeyStore(sandbox.keys), testAssets, access).also { it.source = source }

    private fun titles(items: List<BookmarkItem>): List<String> = items.flatMap { listOf(it.title) + titles(it.children.orEmpty()) }

    private fun bookmarks(service: SyncService) = titles(service.snapshot.defaultProfile?.bookmarks.orEmpty())

    @Test
    fun theVaultRoundTripsThroughARealDocumentsProviderWithNoStagingLeft() {
        val drive = Drive(Sandbox())
        try {
            val keys = SyncKeys(RecoveryPhrase.generateEntropy())
            val tree = ResolverDocumentTree(resolver, TestDocumentsProvider.treeUri)
            assertEquals("Ardia Sync", DocumentTreeStorage.locate(tree))
            val vault = SyncVault(DocumentTreeStorage(tree, "Ardia Sync", "Ardia Sync"), keys)
            vault.createChain()
            val ids = (0 until 5).map { vault.write("app", "{\"n\":$it}".toByteArray()) }
            val fromDisk = SyncVault(com.ardia.sync.core.FolderStorage(drive.folder), keys).read("app", emptySet())
            assertEquals(ids.sorted(), fromDisk.files.map { it.id }.sorted())
            assertEquals((0 until 5).map { "{\"n\":$it}" }.toSet(), fromDisk.files.map { String(it.payload) }.toSet())
            val everything = drive.folder.walkTopDown().map { it.name }.toList()
            assertTrue(everything.none { DocumentTreeStorage.isStaging(it) })
            vault.remove("app", ids.take(2))
            assertEquals(ids.drop(2).sorted(), vault.read("app", emptySet()).files.map { it.id }.sorted())
        } finally {
            drive.sandbox.remove()
        }
    }

    @Test
    fun aPhoneJoinsThroughAPickedParentAndWaitsForFilesNotDownloadedYet() {
        val drive = Drive(Sandbox())
        val entropy = RecoveryPhrase.generateEntropy()
        val mac = seededMac(drive.folder, entropy)
        try {
            val source = FakeSource()
            source.tabs = listOf(LocalTabRecord("https://phone.example/", "Phone", System.currentTimeMillis(), null))
            val service = service(drive.sandbox, source, TrustingTreeAccess(resolver))
            val phrase = RecoveryPhrase.words(entropy).joinToString(" ")
            assertEquals(ConnectResult.Connected, service.connect(phrase, SyncFolderPick.Tree(TestDocumentsProvider.treeUri.toString())))
            assertEquals("Ardia Sync", service.folderName)
            service.syncNow()
            assertEquals(SyncPhase.Updated, service.phase)
            assertTrue(bookmarks(service).contains("Docs"))
            val me = service.snapshot.devices.first { it.isCurrent }.id
            mac.sync(listOf("app", scope))
            assertEquals("https://phone.example/", mac.store(scope).getJSONObject("tabs:$me").getJSONArray("tabs").getJSONObject(0).getString("u"))

            val scopeFolder = mac.scopeFolder(scope)
            val before = scopeFolder.list()!!.toSet()
            mac.put(scope, "bm:late", """{"k":"u","p":"bar","t":"Late","u":"https://late.example/","a":2,"pos":"2"}""")
            mac.sync(listOf(scope))
            val added = scopeFolder.list()!!.toSet() - before
            TestDocumentsProvider.pending += added
            service.syncNow()
            assertEquals(SyncPhase.Updated, service.phase)
            assertEquals(added.size, service.pendingDownloads)
            assertTrue(added.isNotEmpty())
            assertEquals("Updated just now · " + SyncStatusText.waitingForDownloads(added.size), service.statusText)
            assertFalse(bookmarks(service).contains("Late"))
            TestDocumentsProvider.pending.clear()
            service.syncNow()
            assertTrue(bookmarks(service).contains("Late"))
            assertEquals(0, service.pendingDownloads)
            assertTrue(drive.folder.walkTopDown().none { DocumentTreeStorage.isStaging(it.name) })
            service.stopSyncing()
            mac.sync(listOf("app", scope))
            assertFalse(mac.store("app").has("dev:$me"))
        } finally {
            mac.close()
            TestDocumentsProvider.release()
            drive.sandbox.remove()
        }
    }

    private class Damage(val label: String, val relaunch: Boolean, val keep: (ByteArray) -> ByteArray)

    @Test
    fun aWriteAPipeBackedProviderLostOrCutShortFailsTheCycleKeepsTheBatchAndPublishesItNextTime() {
        val cases = listOf(
            Damage("lost", relaunch = false) { ByteArray(0) },
            Damage("truncated", relaunch = false) { it.copyOf(it.size / 2) },
            Damage("lost before a relaunch", relaunch = true) { ByteArray(0) },
            Damage("truncated before a relaunch", relaunch = true) { it.copyOf(it.size / 2) },
        )
        for (case in cases) {
            val drive = Drive(Sandbox())
            TestDocumentsProvider.pipeWrites = true
            val entropy = RecoveryPhrase.generateEntropy()
            val mac = seededMac(drive.folder, entropy)
            try {
                val source = FakeSource()
                var phone = service(drive.sandbox, source, TrustingTreeAccess(resolver))
                assertEquals(case.label, ConnectResult.Connected, phone.connect(RecoveryPhrase.words(entropy).joinToString(" "), SyncFolderPick.Tree(TestDocumentsProvider.treeUri.toString())))
                phone.syncNow()
                assertEquals(case.label, SyncPhase.Updated, phone.phase)
                assertTrue(case.label, TestDocumentsProvider.pipeCommits.get() > 0)
                val me = phone.snapshot.devices.first { it.isCurrent }.id
                val url = "https://kept.example/${case.label.replace(' ', '-')}"

                TestDocumentsProvider.damage = case.keep
                TestDocumentsProvider.damageNext.set(1)
                assertTrue(case.label, phone.addBookmark(url, "Kept"))
                phone.syncNow()
                assertEquals(case.label, SyncPhase.Stalled(SyncService.STALLED_MESSAGE), phone.phase)
                assertEquals(case.label, 0, TestDocumentsProvider.damageNext.get())
                mac.sync(listOf(scope))
                assertEquals(case.label, 0, kept(mac, url))
                assertTrue(case.label, mac.vault.read(scope, emptySet()).damaged.isEmpty())
                assertTrue(case.label, drive.folder.walkTopDown().none { DocumentTreeStorage.isStaging(it.name) })

                if (case.relaunch) {
                    phone.close()
                    phone = service(drive.sandbox, source, TrustingTreeAccess(resolver))
                    phone.start()
                }
                phone.syncNow()
                assertEquals(case.label, SyncPhase.Updated, phone.phase)
                mac.sync(listOf(scope))
                assertEquals(case.label, 1, kept(mac, url))
                val seqs = mac.logs(scope, me).map { it.getInt("seq") }
                assertEquals(case.label, (1..seqs.size).toList(), seqs)
                phone.stopSyncing()
            } finally {
                mac.close()
                TestDocumentsProvider.reset(drive.root)
                drive.sandbox.remove()
            }
        }
    }

    private fun kept(mac: FakeMac, url: String): Int {
        val store = mac.store(scope)
        return store.keyList().filter { it.startsWith("bm:") }.count { store.getJSONObject(it).optString("u") == url }
    }

    @Test
    fun aFolderThatNeverAnswersEndsTheCycleAsOfflineAndTheNextCycleRecovers() {
        val drive = Drive(Sandbox())
        val entropy = RecoveryPhrase.generateEntropy()
        val mac = seededMac(drive.folder, entropy)
        try {
            val service = service(drive.sandbox, FakeSource(), TrustingTreeAccess(resolver, timeoutMs = 300))
            assertEquals(ConnectResult.Connected, service.connect(RecoveryPhrase.words(entropy).joinToString(" "), SyncFolderPick.Tree(TestDocumentsProvider.treeUri.toString())))
            service.syncNow()
            assertEquals(SyncPhase.Updated, service.phase)
            TestDocumentsProvider.hangListings(SyncKeys(entropy).scopeTag(scope))
            val started = System.currentTimeMillis()
            service.syncNow()
            assertTrue(System.currentTimeMillis() - started < 3_000)
            assertEquals(SyncPhase.Offline, service.phase)
            TestDocumentsProvider.release()
            service.syncNow()
            assertEquals(SyncPhase.Updated, service.phase)
            service.stopSyncing()
        } finally {
            mac.close()
            TestDocumentsProvider.release()
            drive.sandbox.remove()
        }
    }

    @Test
    fun withoutAPersistedGrantThePhoneAsksForTheFolderAgainAndChoosingItResumesWithNoSeqReused() {
        val drive = Drive(Sandbox())
        val entropy = RecoveryPhrase.generateEntropy()
        val mac = seededMac(drive.folder, entropy)
        try {
            val source = FakeSource()
            source.tabs = listOf(LocalTabRecord("https://one.example/", "One", System.currentTimeMillis(), null))
            val first = service(drive.sandbox, source, TrustingTreeAccess(resolver))
            val pick = SyncFolderPick.Tree(TestDocumentsProvider.treeUri.toString())
            assertEquals(ConnectResult.Connected, first.connect(RecoveryPhrase.words(entropy).joinToString(" "), pick))
            first.syncNow()
            val me = first.snapshot.devices.first { it.isCurrent }.id
            first.close()

            val strict = service(drive.sandbox, source, AndroidSyncFolderAccess(resolver))
            assertFalse(AndroidSyncFolderAccess(resolver).keep(SyncFolderLocation.Tree(pick.treeUri, "Ardia Sync", "Ardia Sync")))
            strict.start()
            assertEquals(SyncPhase.NeedsFolderAccess, strict.phase)
            assertEquals("Choose your sync folder again to keep syncing.", strict.statusText)
            assertTrue(strict.isEnabled)
            assertEquals(ConnectResult.FolderUnavailable, strict.changeFolder(pick))
            strict.close()

            val again = service(drive.sandbox, source, TrustingTreeAccess(resolver))
            again.start()
            assertEquals(ConnectResult.Connected, again.changeFolder(pick))
            source.tabs = source.tabs + LocalTabRecord("https://two.example/", "Two", System.currentTimeMillis(), null)
            again.localDidChange()
            again.syncNow()
            assertEquals(SyncPhase.Updated, again.phase)
            assertEquals(me, again.snapshot.devices.first { it.isCurrent }.id)
            val seqs = mac.logs(scope, me).map { it.getInt("seq") }
            assertEquals((1..seqs.size).toList(), seqs)
            again.stopSyncing()
        } finally {
            mac.close()
            drive.sandbox.remove()
        }
    }

    @Test
    fun aMissingPickedFolderIsUnavailableNotEmpty() {
        val drive = Drive(Sandbox())
        try {
            val tree = ResolverDocumentTree(resolver, TestDocumentsProvider.treeUri)
            val storage = DocumentTreeStorage(tree, "Ardia Sync", "Ardia Sync")
            assertEquals(emptyList<String>(), storage.names(emptyList()))
            drive.folder.renameTo(File(drive.root, "Away"))
            assertNull(storage.names(emptyList()))
            assertNull(AndroidSyncFolderAccess(resolver).open(SyncFolderPick.Tree("content://${TestDocumentsProvider.AUTHORITY}/tree/nowhere")))
        } finally {
            drive.sandbox.remove()
        }
    }
}
