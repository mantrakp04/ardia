package com.ardia.sync.core

import java.io.File
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncVaultTest {
    private val folder: File = Files.createTempDirectory("ardia-sync-vault").toFile()
    private val entropy = RecoveryPhrase.generateEntropy()
    private val vault = SyncVault(FolderStorage(folder), SyncKeys(entropy))

    @After
    fun cleanUp() {
        folder.walkTopDown().forEach { it.setWritable(true); it.setReadable(true); it.setExecutable(true) }
        folder.deleteRecursively()
    }

    @Test
    fun theFolderHoldsNoPlaintext() {
        vault.createChain()
        val secrets = listOf("https://secret-bank.example/login", "Quarterly Plans", "hunter2-password", "alice@example.com")
        vault.write("p:default", secrets.joinToString("\n").toByteArray())
        val files = folder.walkTopDown().filter { it != folder }.toList()
        assertTrue(files.isNotEmpty())
        for (file in files) {
            assertTrue(file.name, Base32.isTag(file.nameWithoutExtension))
            for (secret in secrets + listOf("default", "app")) assertFalse(file.relativeTo(folder).path.contains(secret))
            if (file.isFile) {
                val text = String(file.readBytes(), Charsets.ISO_8859_1)
                for (secret in secrets) assertFalse(text.contains(secret))
            }
        }
    }

    @Test
    fun deletingAChainLeavesOtherPhrases() {
        vault.createChain()
        vault.write("app", "mine".toByteArray())
        val other = SyncVault(FolderStorage(folder), SyncKeys(RecoveryPhrase.generateEntropy()))
        other.createChain()
        other.write("app", "theirs".toByteArray())
        vault.deleteChain()
        assertFalse(vault.chainExists())
        assertEquals(1, other.read("app", emptySet()).files.size)
    }

    @Test
    fun aMissingScopeReadsEmptyButAnUnreadableScopeThrows() {
        vault.createChain()
        assertTrue(vault.read("app", emptySet()).present.isEmpty())
        vault.write("app", "mine".toByteArray())
        val scope = File(File(folder, vault.chain), vault.keys.scopeTag("app"))
        Files.setPosixFilePermissions(scope.toPath(), PosixFilePermissions.fromString("---------"))
        assertThrows(Exception::class.java) { vault.read("app", emptySet()) }
        Files.setPosixFilePermissions(scope.toPath(), PosixFilePermissions.fromString("rwxr-xr-x"))
    }

    @Test
    fun removeSkipsFilesAlreadyGoneAndReportsFailures() {
        vault.createChain()
        val id = vault.write("app", "mine".toByteArray())
        vault.remove("app", listOf("a".repeat(26), id))
        assertTrue(vault.read("app", emptySet()).present.isEmpty())
        val kept = vault.write("app", "kept".toByteArray())
        val scope = File(File(folder, vault.chain), vault.keys.scopeTag("app"))
        Files.setPosixFilePermissions(scope.toPath(), PosixFilePermissions.fromString("r-xr-xr-x"))
        val failure = assertThrows(SyncVault.RemoveFailed::class.java) { vault.remove("app", listOf(kept)) }
        assertEquals(listOf(kept), failure.ids)
        Files.setPosixFilePermissions(scope.toPath(), PosixFilePermissions.fromString("rwxr-xr-x"))
    }

    @Test
    fun halfWrittenFilesAreDamagedPlaceholdersPendingAndStrayFilesIgnored() {
        vault.createChain()
        val whole = vault.write("app", "whole".toByteArray())
        val half = vault.write("app", "half".toByteArray())
        val scope = File(File(folder, vault.chain), vault.keys.scopeTag("app"))
        val halfFile = File(scope, "$half.nns")
        halfFile.writeBytes(halfFile.readBytes().copyOf(halfFile.length().toInt() / 2))
        val waiting = SyncKeys.newFileId()
        File(scope, ".$waiting.nns.icloud").writeBytes("bplist00".toByteArray())
        File(scope, "$whole 2.nns").writeBytes(File(scope, "$whole.nns").readBytes())
        File(scope, ".DS_Store").writeBytes(ByteArray(0))
        val listing = vault.read("app", emptySet())
        assertEquals(listOf("whole"), listing.files.map { String(it.payload) })
        assertEquals(listOf(half), listing.damaged.map { it.id })
        assertEquals(listOf(waiting), listing.pending)
        assertEquals(setOf(whole, half, waiting), listing.present.toSet())
        assertEquals(emptyList<String>(), vault.read("app", setOf(whole, half)).files.map { it.id })
    }
}
