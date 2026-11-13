package com.ardia.sync.core

import java.io.File
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test

class SwiftCrossCheckTest {
    private val swiftWrote = System.getProperty("ardia.crossCheck.swiftWrote")?.let(::File)
    private val kotlinWrites = System.getProperty("ardia.crossCheck.kotlinWrites")?.let(::File)

    private fun manifest(folder: File): Map<String, String> =
        File(folder, "manifest.txt").readLines().filter { it.isNotBlank() }.associate { line ->
            val (key, value) = line.split("\t", limit = 2)
            key to value
        }

    private fun bytes(value: String) = Base64.getDecoder().decode(value)

    @Test
    fun filesSwiftWroteOpenInKotlin() {
        assumeTrue("set ardia.crossCheck.swiftWrote to run against the Swift side", swiftWrote != null)
        val folder = swiftWrote!!
        val expected = manifest(folder)
        val keys = SyncKeys(bytes(expected.getValue("entropy")))
        assertEquals(expected.getValue("chain"), keys.chainTag)
        val vault = SyncVault(FolderStorage(File(folder, "Ardia Sync")), keys)
        for (scope in expected.getValue("scopes").split(",")) {
            assertEquals(expected.getValue("scopeTag:$scope"), keys.scopeTag(scope))
            val read = vault.read(scope, emptySet())
            assertEquals(emptyList<String>(), read.damaged.map { it.id })
            val payloads = read.files.map { Base64.getEncoder().encodeToString(it.payload) }.sorted()
            assertEquals(expected.getValue("payloads:$scope").split(",").sorted(), payloads)
        }
        assertEquals(expected.getValue("password"), keys.sealPassword("hunter2 é😀", "https://bank.example", "luke"))
        assertEquals("hunter2 é😀", keys.openPassword(expected.getValue("password"), "https://bank.example", "luke"))
        val local = bytes(expected.getValue("localState"))
        assertEquals("{\"device\":\"swift\"}", String(keys.open(local, "local", "state")))
        assertEquals(expected.getValue("phrase"), RecoveryPhrase.words(bytes(expected.getValue("entropy"))).joinToString(" "))
    }

    @Test
    fun kotlinWritesFilesForSwiftToOpen() {
        assumeTrue("set ardia.crossCheck.kotlinWrites to write files for the Swift side", kotlinWrites != null)
        val folder = kotlinWrites!!
        folder.deleteRecursively()
        val entropy = RecoveryPhrase.generateEntropy()
        val keys = SyncKeys(entropy)
        val vault = SyncVault(FolderStorage(File(folder, "Ardia Sync")), keys)
        vault.createChain()
        val scopes = listOf("app", "p:personal000000000000000000")
        val lines = mutableListOf(
            "entropy\t${Base64.getEncoder().encodeToString(entropy)}",
            "phrase\t${RecoveryPhrase.words(entropy).joinToString(" ")}",
            "chain\t${keys.chainTag}",
            "scopes\t${scopes.joinToString(",")}",
            "password\t${keys.sealPassword("hunter2 é😀", "https://bank.example", "luke")}",
            "localState\t${Base64.getEncoder().encodeToString(keys.seal("{\"device\":\"kotlin\"}".toByteArray(), "local", "state"))}",
        )
        for (scope in scopes) {
            val payloads = listOf(
                "{\"kind\":\"log\",\"device\":\"kotlin\",\"scope\":\"$scope\",\"note\":\"café 😀\"}".toByteArray(),
                ByteArray(1020) { (it % 251).toByte() },
                ByteArray(0),
            )
            payloads.forEach { vault.write(scope, it) }
            lines += "scopeTag:$scope\t${keys.scopeTag(scope)}"
            lines += "payloads:$scope\t${payloads.joinToString(",") { Base64.getEncoder().encodeToString(it) }}"
        }
        File(folder, "manifest.txt").writeText(lines.joinToString("\n") + "\n")
    }
}
